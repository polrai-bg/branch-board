// Read Claude Code task lists on this Mac. Pure helpers take strings so tests use fixtures.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaskItem } from "./merge.ts";

export const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TaskListBinding = { list: string; repo: string; branch: string };

export type ClaudeTaskScan = { tasks: TaskItem[]; errors: string[] };

export type ClaudeFs = {
  exists: (path: string) => boolean;
  listDir: (path: string) => string[];
  readText: (path: string) => string;
  readTail: (path: string, bytes: number) => string;
  mtimeMs: (path: string) => number;
  realpath: (path: string) => string;
};

export type ClaudeCollectInput = {
  claudeConfigDir: string;
  taskLists: TaskListBinding[];
  // Real paths that belong to a configured repo (main checkout and worktrees).
  pathToRepo: Map<string, string>;
  fs?: ClaudeFs;
  cache?: Map<string, { mtimeMs: number; tasks: TaskItem[]; errors: string[] }>;
};

const defaultFs: ClaudeFs = {
  exists: existsSync,
  listDir: (path) => readdirSync(path),
  readText: (path) => readFileSync(path, "utf8"),
  readTail: (path, bytes) => {
    const full = readFileSync(path);
    return full.subarray(Math.max(0, full.length - bytes)).toString("utf8");
  },
  mtimeMs: (path) => statSync(path).mtimeMs,
  realpath: (path) => realpathSync(path),
};

export function resolveClaudeConfigDir(configured: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (configured === null) return null;
  const raw = configured ?? env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return raw.replace(/^~(?=\/|$)/, homedir());
}

export function isSessionListId(listId: string): boolean {
  return SESSION_ID.test(listId);
}

export type TranscriptContext = { cwd: string | null; gitBranch: string | null };

// Last line that carries cwd or gitBranch wins. A session can move into a worktree after it starts.
export function parseTranscriptTail(text: string): TranscriptContext {
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const record = obj as Record<string, unknown>;
    if (typeof record.cwd === "string" && record.cwd) cwd = record.cwd;
    if (typeof record.gitBranch === "string" && record.gitBranch) gitBranch = record.gitBranch;
    else if (record.gitBranch === null && "gitBranch" in record) {
      // Keep the previous branch when a nested context clears it.
    }
  }
  return { cwd, gitBranch };
}

export type ParsedTaskFile = {
  task: Omit<TaskItem, "source" | "listId" | "repo" | "branch" | "issue" | "updatedAt"> | null;
  error: string | null;
};

export function parseTaskFile(raw: string, fileHint: string): ParsedTaskFile {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { task: null, error: `Bad JSON in ${fileHint}` };
  }
  if (!obj || typeof obj !== "object") return { task: null, error: `Bad task shape in ${fileHint}` };
  const record = obj as Record<string, unknown>;
  const id = record.id == null ? null : String(record.id);
  const subject = typeof record.subject === "string" ? record.subject : null;
  const statusRaw = typeof record.status === "string" ? record.status : null;
  if (!id || !subject || !statusRaw) return { task: null, error: `Missing id, subject, or status in ${fileHint}` };
  const status = statusRaw === "pending" || statusRaw === "in_progress" || statusRaw === "completed" ? statusRaw : null;
  if (!status) return { task: null, error: `Unknown status in ${fileHint}` };
  const blockedBy = Array.isArray(record.blockedBy) ? record.blockedBy.filter((item): item is string => typeof item === "string") : [];
  const activeForm = typeof record.activeForm === "string" ? record.activeForm : null;
  const owner = typeof record.owner === "string" ? record.owner : null;
  return {
    task: { id, subject, status, activeForm, blockedBy, owner },
    error: null,
  };
}

function findTranscript(projectsDir: string, listId: string, fs: ClaudeFs): string | null {
  if (!fs.exists(projectsDir)) return null;
  for (const folder of fs.listDir(projectsDir)) {
    const candidate = join(projectsDir, folder, `${listId}.jsonl`);
    if (fs.exists(candidate)) return candidate;
  }
  return null;
}

function matchRepo(cwd: string | null, pathToRepo: Map<string, string>, fs: ClaudeFs): string | null {
  if (!cwd) return null;
  let real = cwd;
  try {
    real = fs.realpath(cwd);
  } catch {
    // Keep the raw cwd when the folder is gone (deleted worktree).
  }
  const direct = pathToRepo.get(real) ?? pathToRepo.get(cwd);
  if (direct) return direct;
  // A deleted worktree still sits under the repo folder in the transcript path.
  let best: { repo: string; len: number } | null = null;
  for (const [path, repo] of pathToRepo) {
    if (real === path || real.startsWith(path.endsWith("/") ? path : `${path}/`)) {
      if (!best || path.length > best.len) best = { repo, len: path.length };
    }
    if (cwd === path || cwd.startsWith(path.endsWith("/") ? path : `${path}/`)) {
      if (!best || path.length > best.len) best = { repo, len: path.length };
    }
  }
  return best?.repo ?? null;
}

function listNewestMtime(dir: string, names: string[], fs: ClaudeFs): number {
  let newest = 0;
  for (const name of names) {
    try {
      newest = Math.max(newest, fs.mtimeMs(join(dir, name)));
    } catch {
      // Skip vanished files.
    }
  }
  return newest;
}

export function collectClaudeTasks(input: ClaudeCollectInput): ClaudeTaskScan {
  const fs = input.fs ?? defaultFs;
  const cache = input.cache;
  const tasksRoot = join(input.claudeConfigDir, "tasks");
  const projectsDir = join(input.claudeConfigDir, "projects");
  const binding = new Map(input.taskLists.map((entry) => [entry.list, entry]));
  const tasks: TaskItem[] = [];
  const errors: string[] = [];

  if (!fs.exists(tasksRoot)) return { tasks, errors };

  let listIds: string[];
  try {
    listIds = fs.listDir(tasksRoot).filter((name) => name && !name.startsWith(".") && name !== ".lock");
  } catch (error) {
    return { tasks, errors: [`Claude tasks: ${(error as Error).message}`] };
  }

  for (const listId of listIds) {
    const listDir = join(tasksRoot, listId);
    let entries: string[];
    try {
      entries = fs.listDir(listDir).filter((name) => name.endsWith(".json"));
    } catch {
      continue;
    }
    const mtime = listNewestMtime(listDir, entries, fs);
    const cached = cache?.get(listId);
    if (cached && cached.mtimeMs === mtime) {
      tasks.push(...cached.tasks);
      errors.push(...cached.errors);
      continue;
    }

    const listTasks: TaskItem[] = [];
    const listErrors: string[] = [];
    for (const entry of entries) {
      const file = join(listDir, entry);
      let raw: string;
      try {
        raw = fs.readText(file);
      } catch (error) {
        listErrors.push(`Unreadable ${listId}/${entry}: ${(error as Error).message}`);
        continue;
      }
      const parsed = parseTaskFile(raw, `${listId}/${entry}`);
      if (parsed.error) {
        listErrors.push(parsed.error);
        continue;
      }
      if (!parsed.task) continue;
      let updatedAt: string;
      try {
        updatedAt = new Date(fs.mtimeMs(file)).toISOString();
      } catch {
        updatedAt = new Date(0).toISOString();
      }
      listTasks.push({
        source: "claude-code",
        listId,
        ...parsed.task,
        repo: null,
        branch: null,
        issue: null,
        updatedAt,
      });
    }

    let repo: string | null = null;
    let branch: string | null = null;
    const override = binding.get(listId);
    if (override) {
      repo = override.repo;
      branch = override.branch;
    } else if (isSessionListId(listId)) {
      const transcript = findTranscript(projectsDir, listId, fs);
      if (transcript) {
        try {
          const ctx = parseTranscriptTail(fs.readTail(transcript, TRANSCRIPT_TAIL_BYTES));
          repo = matchRepo(ctx.cwd, input.pathToRepo, fs);
          branch = ctx.gitBranch;
          if (repo && !branch) branch = null;
        } catch (error) {
          listErrors.push(`Transcript ${listId}: ${(error as Error).message}`);
        }
      }
    }

    for (const task of listTasks) {
      task.repo = repo;
      task.branch = branch;
    }

    // A fully completed list is noise. Hide it.
    const open = listTasks.some((task) => task.status !== "completed");
    if (open) {
      tasks.push(...listTasks);
      cache?.set(listId, { mtimeMs: mtime, tasks: listTasks, errors: listErrors });
    } else {
      cache?.set(listId, { mtimeMs: mtime, tasks: [], errors: listErrors });
    }
    errors.push(...listErrors);
  }

  return { tasks, errors };
}

// Build realpath -> repo from configured checkouts and live worktree paths.
export function buildPathToRepo(
  repos: { name: string; localPath: string | null }[],
  worktrees: { repo: string; path: string }[],
  realpath: (path: string) => string = (path) => realpathSync(path),
): Map<string, string> {
  const map = new Map<string, string>();
  const add = (repo: string, path: string | null) => {
    if (!path) return;
    map.set(path, repo);
    try {
      map.set(realpath(path), repo);
    } catch {
      // Keep the raw path when the folder is gone.
    }
  };
  for (const repo of repos) add(repo.name, repo.localPath);
  for (const tree of worktrees) add(tree.repo, tree.path);
  return map;
}
