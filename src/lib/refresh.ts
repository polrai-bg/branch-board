import { mergeCollections } from "./assemble.ts";
import { localDay, readSnapshot, writeDailyCounts, writeSnapshot, type Snapshot } from "./cache.ts";
import { loadConfig } from "./config.ts";
import { collectRepo } from "./github.ts";
import { collectLocal } from "./local.ts";
import { buildRows, countsByRepo } from "./merge.ts";

// globalThis so route handlers and the instrumentation hook share one in-flight refresh and one timer.
const g = globalThis as unknown as { bbRefresh?: Promise<Snapshot>; bbTimer?: NodeJS.Timeout };

export function refresh(): Promise<Snapshot> {
  g.bbRefresh ??= run().finally(() => {
    g.bbRefresh = undefined;
  });
  return g.bbRefresh;
}

async function run(): Promise<Snapshot> {
  const prev = readSnapshot();
  const errors: Snapshot["errors"] = [];
  try {
    const cfg = loadConfig();
    const token = process.env.GITHUB_TOKEN;
    let remoteResults: PromiseSettledResult<{ branches: Snapshot["branches"]; issues: Snapshot["issues"] }>[] | null = null;
    if (!token) {
      errors.push({ message: "GITHUB_TOKEN is missing from .env.local.", setup: true });
    } else {
      remoteResults = await Promise.allSettled(
        cfg.repos.map((repo) =>
          collectRepo(token, cfg.github.owner, repo.name, repo.bases, {
            issuePattern: cfg.issuePattern,
            extraIssueNumbers: cfg.branchOverrides.filter((override) => override.repo === repo.name && override.issue).map((override) => override.issue!),
          }),
        ),
      );
    }

    const localScans = await Promise.all(
      cfg.repos.map(async (repo) => {
        if (!repo.localPath) return null;
        try {
          return await collectLocal(repo.name, repo.localPath, repo.bases);
        } catch (error) {
          return { records: [], error: `${repo.localPath}: ${(error as Error).message}` };
        }
      }),
    );

    const merged = mergeCollections(cfg.repos, prev, remoteResults, localScans);
    errors.push(...merged.errors);
    const rows = buildRows(cfg, merged.branches, Date.now(), merged.locals, merged.issues);
    writeDailyCounts(localDay(), countsByRepo(rows, cfg.repos.map((repo) => repo.name)));
    const snap: Snapshot = { takenAt: new Date().toISOString(), branches: merged.branches, locals: merged.locals, issues: merged.issues, errors };
    writeSnapshot(snap);
    if (errors.length) console.error("[branch-board] refresh errors:", errors.map((error) => error.message).join("; "));
    return snap;
  } catch (error) {
    errors.push({ message: (error as Error).message, setup: true });
    const snap: Snapshot = { ...prev, takenAt: new Date().toISOString(), errors };
    writeSnapshot(snap);
    console.error("[branch-board] refresh errors:", errors.map((item) => item.message).join("; "));
    return snap;
  }
}

// Refuses to start without a valid config. Never falls back to hard-coded values.
export function startScheduler() {
  if (g.bbTimer) return;
  let minutes: number;
  try {
    minutes = loadConfig().refreshMinutes;
  } catch (error) {
    console.error(`[branch-board] Refusing to start: ${(error as Error).message}`);
    process.exit(1);
  }
  refresh();
  g.bbTimer = setInterval(refresh, minutes * 60_000);
}
