// Local collector. Read-only git, except `git fetch --prune`. Never invoked through a shell.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { pickBase, type Comparison, type LocalRecord } from "./merge.ts";

export const GIT_FETCH_TIMEOUT_MS = 60_000;
export const GIT_COMMAND_TIMEOUT_MS = 20_000;

export type GitResult = { code: number; stdout: string; stderr: string; timedOut: boolean };
export type GitRunner = (args: string[], cwd: string, timeout?: number) => Promise<GitResult>;

export type LocalScan = { records: LocalRecord[]; error: string | null };

export type WorktreeInfo = { path: string; sha: string; branch: string | null; detached: boolean; prunable: boolean };

// One line per ref. This Git build has no `for-each-ref -z`, and its ref format
// copies `%x1f` through as text (`git log --format` still expands it). %(subject) cannot contain a newline.
const FIELD = "\x1f";
const REF_FORMAT = `%(refname:short)${FIELD}%(objectname)${FIELD}%(upstream:short)${FIELD}%(committerdate:iso-strict)${FIELD}%(authorname)${FIELD}%(subject)`;

// The board's GitHub token must not reach git. A gh credential helper prefers GITHUB_TOKEN and GH_TOKEN over the
// user's login, so git would fetch with the board's read-only token instead of the user's own credentials.
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { GITHUB_TOKEN: _github, GH_TOKEN: _gh, ...rest } = env;
  return { ...rest, GIT_TERMINAL_PROMPT: "0" };
}

export function defaultGit(): GitRunner {
  return (args, cwd, timeout = GIT_COMMAND_TIMEOUT_MS) =>
    new Promise((resolve) => {
      execFile(
        "git",
        args,
        {
          cwd,
          timeout,
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
          env: gitEnv(),
        },
        (err, stdout, stderr) => {
          const error = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          resolve({
            code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            timedOut: Boolean(error?.killed),
          });
        },
      );
    });
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "failed";
}

export function parseRefs(stdout: string): { name: string; sha: string; committedDate: string; authorName: string | null; message: string }[] {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((record) => {
      const [name, sha, , committedDate, authorName, ...message] = record.split("\x1f");
      return { name, sha, committedDate, authorName: authorName || null, message: message.join("\x1f").trim() };
    })
    .filter((record) => record.name && record.sha);
}

export function parseWorktrees(porcelain: string): WorktreeInfo[] {
  return porcelain
    .split(/\n(?=worktree )/)
    .filter((block) => block.startsWith("worktree "))
    .map((block) => {
      const lines = block.split("\n");
      let sha = "";
      let branch: string | null = null;
      let detached = false;
      let prunable = false;
      for (const line of lines.slice(1)) {
        if (line.startsWith("HEAD ")) sha = line.slice("HEAD ".length).trim();
        else if (line.startsWith("branch ")) {
          const ref = line.slice("branch ".length).trim();
          branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
        } else if (line === "detached") detached = true;
        else if (line.startsWith("prunable")) prunable = true;
      }
      return { path: lines[0].slice("worktree ".length).trim(), sha, branch, detached, prunable };
    });
}

// A deleted worktree folder is listed as prunable. Never run git status there.
export function liveWorktrees(trees: WorktreeInfo[], exists: (path: string) => boolean = existsSync): WorktreeInfo[] {
  return trees.filter((tree) => !tree.prunable && tree.path && exists(tree.path));
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function localCompare(git: GitRunner, cwd: string, branch: string, bases: string[]): Promise<Comparison | null> {
  const candidates: Comparison[] = [];
  for (const base of bases) {
    if (base === branch) continue;
    const baseRef = `refs/heads/${base}`;
    if ((await git(["rev-parse", "--verify", "--quiet", baseRef], cwd)).code !== 0) continue;
    const headRef = `refs/heads/${branch}`;
    const counts = await git(["rev-list", "--left-right", "--count", `${baseRef}...${headRef}`], cwd);
    if (counts.code !== 0) continue;
    const [behindRaw, aheadRaw] = counts.stdout.trim().split(/\s+/);
    const behind = Number(behindRaw);
    const ahead = Number(aheadRaw);
    if (!Number.isInteger(ahead) || !Number.isInteger(behind)) continue;
    const mergeBase = await git(["merge-base", baseRef, headRef], cwd);
    candidates.push({ base, ahead, behind, mergeBase: mergeBase.code === 0 ? mergeBase.stdout.trim() || null : null });
  }
  return pickBase(candidates);
}

export async function collectLocal(repo: string, localPath: string, bases: string[], git: GitRunner = defaultGit()): Promise<LocalScan> {
  if (!existsSync(localPath)) return { records: [], error: `Local folder missing: ${localPath}` };

  const fetched = await git(["fetch", "--prune", "origin"], localPath, GIT_FETCH_TIMEOUT_MS);
  const fetchError = fetched.code === 0 ? null : `git fetch failed in ${localPath}: ${fetched.timedOut ? "timed out" : firstLine(fetched.stderr || fetched.stdout)}`;

  const refs = await git(["for-each-ref", `--format=${REF_FORMAT}`, "refs/heads"], localPath);
  if (refs.code !== 0) {
    return { records: [], error: fetchError ?? `git for-each-ref failed in ${localPath}: ${firstLine(refs.stderr)}` };
  }
  const branches = parseRefs(refs.stdout);
  const listed = await git(["worktree", "list", "--porcelain"], localPath);
  const trees = listed.code === 0 ? liveWorktrees(parseWorktrees(listed.stdout)) : [];

  const status = await mapPool(trees, 4, async (tree) => {
    const result = await git(["status", "--porcelain"], tree.path);
    return { tree, dirty: result.code === 0 && result.stdout.trim().length > 0 };
  });

  const dirtyPath = new Map<string, string>();
  const checkout = new Map<string, string>();
  for (const { tree, dirty } of status) {
    if (!tree.detached && tree.branch) {
      if (!checkout.has(tree.branch)) checkout.set(tree.branch, tree.path);
      if (dirty) dirtyPath.set(tree.branch, tree.path);
    }
  }

  const records: LocalRecord[] = [];
  for (const branch of branches) {
    const remoteRef = `refs/remotes/origin/${branch.name}`;
    const neverPushed = (await git(["rev-parse", "--verify", "--quiet", remoteRef], localPath)).code !== 0;
    let unpushed = 0;
    if (!neverPushed) {
      const count = await git(["rev-list", "--count", `${remoteRef}..refs/heads/${branch.name}`], localPath);
      unpushed = count.code === 0 ? Number.parseInt(count.stdout.trim(), 10) || 0 : 0;
    }
    const fullMessage = await git(["log", "-1", "--format=%B", `refs/heads/${branch.name}`], localPath);
    const isBase = bases.includes(branch.name);
    records.push({
      repo,
      name: branch.name,
      sha: branch.sha,
      committedDate: branch.committedDate,
      message: fullMessage.code === 0 && fullMessage.stdout.trim() ? fullMessage.stdout.trim() : branch.message,
      authorName: branch.authorName,
      dirty: dirtyPath.has(branch.name),
      unpushed,
      neverPushed,
      detached: false,
      offBranch: false,
      localPath: dirtyPath.get(branch.name) ?? checkout.get(branch.name) ?? null,
      compare: isBase ? null : await localCompare(git, localPath, branch.name, bases),
      baseGuessed: !isBase,
    });
  }

  for (const { tree, dirty } of status) {
    if (!tree.detached || !tree.sha) continue;
    const contained = await git(["for-each-ref", "--contains", tree.sha, "--format=%(refname)", "refs/heads", "refs/remotes"], localPath);
    const offBranch = contained.code !== 0 || contained.stdout.trim().length === 0;
    if (!dirty && !offBranch) continue;
    const meta = await git(["log", "-1", "--format=%cI%x1f%an%x1f%B", tree.sha], localPath);
    const [committedDate, authorName, ...message] = (meta.code === 0 ? meta.stdout : "").split("\x1f");
    records.push({
      repo,
      name: tree.path,
      sha: tree.sha,
      committedDate: committedDate?.trim() || new Date(0).toISOString(),
      message: message.join("\x1f").trim(),
      authorName: authorName?.trim() || null,
      dirty,
      unpushed: 0,
      neverPushed: false,
      detached: true,
      offBranch,
      localPath: tree.path,
      compare: null,
      baseGuessed: true,
    });
  }

  return { records, error: fetchError };
}
