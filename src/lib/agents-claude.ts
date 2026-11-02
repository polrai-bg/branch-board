// Claude Code background/interactive sessions via `claude agents --json`.
// The JSON shape is not pinned by the docs; read only named fields and tolerate missing ones.
import { execFile } from "node:child_process";
import { existsSync, realpathSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "./merge.ts";
import { parseTranscriptTail, readFileTail, TRANSCRIPT_TAIL_BYTES, type ClaudeFs } from "./tasks-claude.ts";

export const AGENTS_TIMEOUT_MS = 10_000;

export type AgentsRunner = () => Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean; missing: boolean }>;

export type AgentsCollectInput = {
  pathToRepo: Map<string, string>;
  // Exact worktree / checkout path -> branch name for that repo.
  pathToBranch: Map<string, { repo: string; branch: string }>;
  claudeConfigDir: string | null;
  run?: AgentsRunner;
  fs?: Pick<ClaudeFs, "exists" | "listDir" | "readTail" | "realpath">;
};

const defaultFs: Pick<ClaudeFs, "exists" | "listDir" | "readTail" | "realpath"> = {
  exists: existsSync,
  listDir: (path) => readdirSync(path),
  readTail: readFileTail,
  realpath: (path) => realpathSync(path),
};

export function defaultAgentsRunner(): AgentsRunner {
  return () =>
    new Promise((resolve) => {
      execFile("claude", ["agents", "--json"], { timeout: AGENTS_TIMEOUT_MS, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const error = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        if (error?.code === "ENOENT") {
          resolve({ code: 127, stdout: "", stderr: stderr ?? "", timedOut: false, missing: true });
          return;
        }
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          timedOut: Boolean(error?.killed),
          missing: false,
        });
      });
    });
}

// Map the live CLI values onto the labels the plan names. Unknown values pass through.
export function normalizeAgentState(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "Unknown";
  const value = raw.trim();
  const key = value.toLowerCase().replace(/_/g, " ");
  const map: Record<string, string> = {
    busy: "Working",
    working: "Working",
    idle: "Needs input",
    "needs input": "Needs input",
    "ready for review": "Ready for review",
    completed: "Completed",
    failed: "Failed",
    stopped: "Stopped",
  };
  return map[key] ?? value;
}

export function needsInput(state: string): boolean {
  return normalizeAgentState(state) === "Needs input";
}

export function parseAgentsJson(text: string): { sessions: Omit<AgentSession, "repo" | "branch">[]; error: string | null } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { sessions: [], error: "claude agents --json returned invalid JSON" };
  }
  if (!Array.isArray(data)) return { sessions: [], error: "claude agents --json did not return an array" };

  const sessions: Omit<AgentSession, "repo" | "branch">[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sessionId =
      typeof row.sessionId === "string" && row.sessionId
        ? row.sessionId
        : typeof row.id === "string" && row.id
          ? row.id
          : null;
    if (!sessionId) continue;
    const stateRaw = row.state ?? row.status;
    const summary = typeof row.name === "string" ? row.name : typeof row.summary === "string" ? row.summary : null;
    const cwd = typeof row.cwd === "string" ? row.cwd : null;
    const prUrl =
      typeof row.prUrl === "string"
        ? row.prUrl
        : typeof row.pr === "string"
          ? row.pr
          : typeof row.pullRequestUrl === "string"
            ? row.pullRequestUrl
            : null;
    const startedAt = typeof row.startedAt === "number" ? new Date(row.startedAt).toISOString() : new Date(0).toISOString();
    sessions.push({
      sessionId,
      state: normalizeAgentState(stateRaw),
      summary,
      cwd,
      prUrl,
      updatedAt: startedAt,
    });
  }
  return { sessions, error: null };
}

function matchPath<T>(cwd: string | null, map: Map<string, T>, fs: Pick<ClaudeFs, "realpath">): T | null {
  if (!cwd) return null;
  let real = cwd;
  try {
    real = fs.realpath(cwd);
  } catch {
    // Keep the raw cwd when the folder is gone.
  }
  if (map.has(real)) return map.get(real)!;
  if (map.has(cwd)) return map.get(cwd)!;
  let best: { value: T; len: number } | null = null;
  for (const [path, value] of map) {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    if (real === path || real.startsWith(prefix) || cwd === path || cwd.startsWith(prefix)) {
      if (!best || path.length > best.len) best = { value, len: path.length };
    }
  }
  return best?.value ?? null;
}

function findTranscript(projectsDir: string, sessionId: string, fs: Pick<ClaudeFs, "exists" | "listDir">): string | null {
  if (!fs.exists(projectsDir)) return null;
  for (const folder of fs.listDir(projectsDir)) {
    const candidate = join(projectsDir, folder, `${sessionId}.jsonl`);
    if (fs.exists(candidate)) return candidate;
  }
  return null;
}

export function bindAgentSessions(
  raw: Omit<AgentSession, "repo" | "branch">[],
  input: Pick<AgentsCollectInput, "pathToRepo" | "pathToBranch" | "claudeConfigDir">,
  fs: Pick<ClaudeFs, "exists" | "listDir" | "readTail" | "realpath"> = defaultFs,
): AgentSession[] {
  const projectsDir = input.claudeConfigDir ? join(input.claudeConfigDir, "projects") : null;
  return raw.map((session) => {
    const hit = matchPath(session.cwd, input.pathToBranch, fs);
    let repo = hit?.repo ?? matchPath(session.cwd, input.pathToRepo, fs);
    let branch = hit?.branch ?? null;
    if ((!repo || !branch) && projectsDir && session.sessionId) {
      const transcript = findTranscript(projectsDir, session.sessionId, fs);
      if (transcript) {
        try {
          const ctx = parseTranscriptTail(fs.readTail(transcript, TRANSCRIPT_TAIL_BYTES));
          if (!repo) repo = matchPath(ctx.cwd ?? session.cwd, input.pathToRepo, fs);
          if (!branch) branch = ctx.gitBranch;
        } catch {
          // Transcript is optional.
        }
      }
    }
    return { ...session, repo, branch };
  });
}

export async function collectClaudeAgents(input: AgentsCollectInput): Promise<{ sessions: AgentSession[]; error: string | null; skipped: boolean }> {
  const run = input.run ?? defaultAgentsRunner();
  const fs = input.fs ?? defaultFs;
  const result = await run();
  if (result.missing) return { sessions: [], error: null, skipped: true };
  if (result.timedOut) return { sessions: [], error: "claude agents --json timed out", skipped: false };
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split("\n")[0] || `exit ${result.code}`;
    return { sessions: [], error: `claude agents --json failed: ${detail}`, skipped: false };
  }
  const parsed = parseAgentsJson(result.stdout);
  if (parsed.error) return { sessions: [], error: parsed.error, skipped: false };
  return { sessions: bindAgentSessions(parsed.sessions, input, fs), error: null, skipped: false };
}

export function buildPathToBranch(
  locals: { repo: string; name: string; localPath: string | null; detached?: boolean }[],
  worktrees: { repo: string; path: string; branch: string | null }[],
  realpath: (path: string) => string = (path) => realpathSync(path),
): Map<string, { repo: string; branch: string }> {
  const map = new Map<string, { repo: string; branch: string }>();
  const add = (repo: string, branch: string, path: string | null) => {
    if (!path || !branch) return;
    const value = { repo, branch };
    map.set(path, value);
    try {
      map.set(realpath(path), value);
    } catch {
      // Keep the raw path when the folder is gone.
    }
  };
  for (const local of locals) {
    if (local.detached) continue;
    add(local.repo, local.name, local.localPath);
  }
  for (const tree of worktrees) {
    if (tree.branch) add(tree.repo, tree.branch, tree.path);
  }
  return map;
}
