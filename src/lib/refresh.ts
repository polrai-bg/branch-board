import { loadConfig } from "./config.ts";
import { readSnapshot, writeSnapshot, type Snapshot } from "./cache.ts";
import { collectRepo, GitHubError } from "./github.ts";

// globalThis so route handlers and the instrumentation hook share one in-flight refresh and one timer.
const g = globalThis as unknown as { bbRefresh?: Promise<Snapshot>; bbTimer?: NodeJS.Timeout };

export function refresh(): Promise<Snapshot> {
  g.bbRefresh ??= run().finally(() => (g.bbRefresh = undefined));
  return g.bbRefresh;
}

async function run(): Promise<Snapshot> {
  const prev = readSnapshot();
  const errors: Snapshot["errors"] = [];
  const token = process.env.GITHUB_TOKEN;
  let branches = prev.branches;

  try {
    const cfg = loadConfig();
    if (!token) {
      errors.push({ message: "GITHUB_TOKEN is missing from .env.local.", setup: true });
    } else {
      const results = await Promise.allSettled(cfg.repos.map((r) => collectRepo(token, cfg.github.owner, r.name, r.bases)));
      branches = cfg.repos.flatMap((r, i) => {
        const res = results[i];
        if (res.status === "fulfilled") return res.value;
        const e = res.reason;
        const setup = e instanceof GitHubError && e.status === 401;
        errors.push({ message: `${r.name}: ${setup ? "GitHub token is invalid or expired." : e.message}`, setup });
        // Keep the last good rows for a repo that failed.
        return prev.branches.filter((b) => b.repo === r.name);
      });
    }
  } catch (e) {
    errors.push({ message: (e as Error).message, setup: true });
  }

  const snap = { takenAt: new Date().toISOString(), branches, errors };
  writeSnapshot(snap);
  if (errors.length) console.error("[branch-board] refresh errors:", errors.map((e) => e.message).join("; "));
  return snap;
}

// Refuses to start without a valid config. Never falls back to hard-coded values.
export function startScheduler() {
  if (g.bbTimer) return;
  let minutes: number;
  try {
    minutes = loadConfig().refreshMinutes;
  } catch (e) {
    console.error(`[branch-board] Refusing to start: ${(e as Error).message}`);
    process.exit(1);
  }
  refresh();
  g.bbTimer = setInterval(refresh, minutes * 60_000);
}
