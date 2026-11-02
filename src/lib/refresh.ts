import { collectClaudeAgents, buildPathToBranch } from "./agents-claude.ts";
import { mergeCollections } from "./assemble.ts";
import { localDay, readSnapshot, writeDailyCounts, writeSnapshot, type Snapshot } from "./cache.ts";
import { loadConfig } from "./config.ts";
import { collectRepo } from "./github.ts";
import { collectLocal, defaultGit, parseWorktrees, liveWorktrees } from "./local.ts";
import { buildRows, countsByRepo, type AgentSession, type TaskItem } from "./merge.ts";
import { checklistTasksFromSnapshot } from "./tasks.ts";
import { buildPathToRepo, collectClaudeTasks } from "./tasks-claude.ts";

// globalThis so route handlers and the instrumentation hook share one in-flight refresh and one timer.
const g = globalThis as unknown as {
  bbRefresh?: Promise<Snapshot>;
  bbTimer?: NodeJS.Timeout;
  bbTaskCache?: Map<string, { mtimeMs: number; tasks: TaskItem[]; errors: string[] }>;
};

export function refresh(): Promise<Snapshot> {
  g.bbRefresh ??= run().finally(() => {
    g.bbRefresh = undefined;
  });
  return g.bbRefresh;
}

async function worktreeInfos(repos: { name: string; localPath: string | null }[]): Promise<{ repo: string; path: string; branch: string | null }[]> {
  const git = defaultGit();
  const out: { repo: string; path: string; branch: string | null }[] = [];
  for (const repo of repos) {
    if (!repo.localPath) continue;
    try {
      const listed = await git(["worktree", "list", "--porcelain"], repo.localPath);
      if (listed.code !== 0) continue;
      for (const tree of liveWorktrees(parseWorktrees(listed.stdout))) {
        out.push({ repo: repo.name, path: tree.path, branch: tree.branch });
      }
    } catch {
      // A missing folder is already reported by the local collector.
    }
  }
  return out;
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

    const trees = await worktreeInfos(cfg.repos);
    const pathToRepo = buildPathToRepo(
      cfg.repos,
      trees.map((tree) => ({ repo: tree.repo, path: tree.path })),
    );
    const pathToBranch = buildPathToBranch(merged.locals, trees);

    const checklist = checklistTasksFromSnapshot(merged.branches, merged.issues);
    let claudeTasks: TaskItem[] = [];
    // Config already resolved the default (~/.claude). null means the Claude source is off.
    const claudeDir = cfg.claudeConfigDir;
    if (claudeDir) {
      try {
        g.bbTaskCache ??= new Map();
        const scan = collectClaudeTasks({
          claudeConfigDir: claudeDir,
          taskLists: cfg.taskLists,
          pathToRepo,
          cache: g.bbTaskCache,
        });
        claudeTasks = scan.tasks;
        for (const message of scan.errors) errors.push({ message: `Claude tasks: ${message}` });
      } catch (error) {
        errors.push({ message: `Claude tasks: ${(error as Error).message}` });
        claudeTasks = prev.tasks.filter((task) => task.source === "claude-code");
      }
    }

    let sessions: AgentSession[] = [];
    try {
      const agents = await collectClaudeAgents({
        pathToRepo,
        pathToBranch,
        claudeConfigDir: claudeDir,
      });
      if (agents.error) {
        errors.push({ message: agents.error });
        sessions = prev.sessions;
      } else if (!agents.skipped) {
        sessions = agents.sessions;
      }
    } catch (error) {
      errors.push({ message: `Claude agents: ${(error as Error).message}` });
      sessions = prev.sessions;
    }

    const tasks = [...claudeTasks, ...checklist];
    const rows = buildRows(cfg, merged.branches, Date.now(), merged.locals, merged.issues, tasks, sessions);
    writeDailyCounts(
      localDay(),
      countsByRepo(
        rows,
        cfg.repos.map((repo) => repo.name),
      ),
    );
    const snap: Snapshot = {
      takenAt: new Date().toISOString(),
      branches: merged.branches,
      locals: merged.locals,
      issues: merged.issues,
      tasks,
      sessions,
      errors,
    };
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
