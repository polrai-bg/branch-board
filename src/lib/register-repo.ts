// Decide the config entry for a folder the user picked. Read-only git.
// The only write is branchboard.config.json, and only after the decision succeeds.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILE, configFromRaw } from "./config.ts";
import { GIT_COMMAND_TIMEOUT_MS, gitEnv, type GitResult } from "./local.ts";

export type RepoEntry = { name: string; localPath: string; bases: string[] };

export type RepoDecision =
  | { ok: true; entry: RepoEntry; notice: string | null }
  | { ok: false; error: string };

export type ScanHit = { name: string; path: string; added: boolean };

export type RegisteredFolders =
  | { ok: true; added: RepoEntry[]; notices: (string | null)[]; skipped: { path: string; error: string }[] }
  | { ok: false; error: string };

type ConfiguredRepo = { name: string; localPath: string | null };

type BoardFile =
  | { ok: true; text: string; owner: string; repos: ConfiguredRepo[] }
  | { ok: false; error: string };

const BASE_CANDIDATES = ["main", "development"] as const;

function runGit(args: string[], cwd: string): Promise<GitResult> {
  const env = gitEnv();
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_COMMAND_TIMEOUT_MS, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, env },
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
  return text.trim().split("\n")[0] || "failed";
}

function normalizeFolder(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "/" || trimmed === "") return trimmed;
  return trimmed.replace(/\/+$/, "");
}

function expandHome(input: string): string {
  return input.replace(/^~(?=\/|$)/, homedir());
}

function canonicalPath(input: string): string | null {
  const trimmed = normalizeFolder(expandHome(input));
  if (!trimmed) return null;
  try {
    return realpathSync(trimmed);
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  const left = canonicalPath(a);
  const right = canonicalPath(b);
  if (left && right) return left === right;
  return normalizeFolder(expandHome(a)) === normalizeFolder(expandHome(b));
}

function folderName(folder: string): string {
  return folder.split("/").filter(Boolean).pop() || folder;
}

// github.com/owner/name from https or git@ remotes. Anything else is not a GitHub repo name.
export function githubRepoFromOrigin(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim();
  const scp = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(trimmed);
  if (scp?.[1] && scp[2]) return { owner: scp[1], name: scp[2] };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const [owner, rawName] = parsed.pathname.split("/").filter(Boolean);
    const name = rawName?.replace(/\.git$/i, "");
    if (!owner || !name) return null;
    return { owner, name };
  } catch {
    return null;
  }
}

export function basesFromRefNames(refnames: Iterable<string>): string[] {
  const refs = new Set(refnames);
  const found = BASE_CANDIDATES.filter((name) => refs.has(`refs/heads/${name}`) || refs.has(`refs/remotes/origin/${name}`));
  return found.length > 0 ? [...found] : ["main"];
}

// Same check Add Folder uses: the folder exists, git says it is a work tree, and this folder is the root.
async function gitWorkTreeRoot(folderInput: string): Promise<{ ok: true; folder: string } | { ok: false; error: string }> {
  const folder = normalizeFolder(folderInput);
  if (!folder || !existsSync(folder)) return { ok: false, error: `Not a git repository: ${folder || folderInput}` };

  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], folder);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return { ok: false, error: `Not a git repository: ${folder}` };
  }

  const top = await runGit(["rev-parse", "--show-toplevel"], folder);
  const root = top.code === 0 ? top.stdout.trim() : "";
  if (!root || canonicalPath(root) !== canonicalPath(folder)) {
    const where = root ? ` Repository root is ${root}.` : "";
    return { ok: false, error: `Not a git repository: ${folder}.${where}` };
  }
  return { ok: true, folder };
}

async function readOrigin(folder: string): Promise<{ owner: string; name: string } | null> {
  const remote = await runGit(["remote", "get-url", "origin"], folder);
  if (remote.code !== 0) return null;
  return githubRepoFromOrigin(remote.stdout);
}

function duplicateError(name: string, folder: string, repos: ConfiguredRepo[]): string | null {
  const nameTaken = repos.some((repo) => repo.name === name);
  const pathTaken = repos.some((repo) => repo.localPath != null && repo.localPath !== "" && samePath(repo.localPath, folder));
  const reasons: string[] = [];
  if (nameTaken) reasons.push(`name "${name}"`);
  if (pathTaken) reasons.push(`local path ${folder}`);
  if (reasons.length === 0) return null;
  return `Already configured: ${reasons.join(" and ")}.`;
}

// Given a folder path, decide the repo entry. Does not write config and does not open a dialog.
export async function decideRepoEntry(folderInput: string, configured: { owner: string; repos: ConfiguredRepo[] }): Promise<RepoDecision> {
  const rootCheck = await gitWorkTreeRoot(folderInput);
  if (!rootCheck.ok) return rootCheck;
  const folder = rootCheck.folder;

  const origin = await readOrigin(folder);
  const name = origin?.name || folderName(folder);

  const listed = await runGit(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"], folder);
  if (listed.code !== 0) {
    const detail = listed.timedOut ? "timed out" : firstLine(listed.stderr || listed.stdout);
    return { ok: false, error: `Could not read refs in ${folder}: ${detail}` };
  }
  const bases = basesFromRefNames(listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean));

  const duplicate = duplicateError(name, folder, configured.repos);
  if (duplicate) return { ok: false, error: duplicate };

  const ownerDiffers = origin != null && origin.owner.toLowerCase() !== configured.owner.toLowerCase();
  const notice = ownerDiffers
    ? `Origin on GitHub is ${origin.owner}/${origin.name}. This board's GitHub owner is ${configured.owner}. The folder was added so the local scan works.`
    : null;

  return { ok: true, entry: { name, localPath: folder, bases }, notice };
}

function appendReposToConfigText(text: string, entries: RepoEntry[]): string {
  const raw = JSON.parse(text) as { repos?: unknown };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.repos)) {
    throw new Error(`${CONFIG_FILE} needs a repos array.`);
  }
  for (const entry of entries) {
    raw.repos.push({ name: entry.name, localPath: entry.localPath, bases: [...entry.bases] });
  }
  return `${JSON.stringify(raw, null, 2)}\n`;
}

function readBoard(configPath: string): BoardFile {
  if (!existsSync(configPath)) {
    return { ok: false, error: `${CONFIG_FILE} is missing. Copy branchboard.config.example.json to ${CONFIG_FILE} and fill it in.` };
  }
  const text = readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `${CONFIG_FILE} is not valid JSON.` };
  }
  try {
    const cfg = configFromRaw(parsed as Parameters<typeof configFromRaw>[0]);
    return { ok: true, text, owner: cfg.github.owner, repos: cfg.repos };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `${CONFIG_FILE} could not be read.` };
  }
}

export function readRepoConfig(configPath: string): { ok: true; owner: string; repos: ConfiguredRepo[] } | { ok: false; error: string } {
  const board = readBoard(configPath);
  if (!board.ok) return board;
  return { ok: true, owner: board.owner, repos: board.repos };
}

// Child directories of a work folder. Does not recurse, does not write config, and does not open a dialog.
export async function scanWorkFolder(folderInput: string, configured: { localPath: string | null }[]): Promise<{ ok: true; hits: ScanHit[] } | { ok: false; error: string }> {
  const folder = normalizeFolder(folderInput);
  if (!folder || !existsSync(folder)) return { ok: false, error: `Folder not found: ${folder || folderInput}` };
  let info: Stats;
  try {
    info = statSync(folder);
  } catch {
    return { ok: false, error: `Folder not found: ${folder}` };
  }
  if (!info.isDirectory()) return { ok: false, error: `Not a folder: ${folder}` };

  const children: string[] = [];
  for (const name of readdirSync(folder)) {
    if (name.startsWith(".")) continue;
    const child = join(folder, name);
    try {
      if (!statSync(child).isDirectory()) continue;
    } catch {
      continue;
    }
    children.push(child);
  }

  const hits: ScanHit[] = [];
  await Promise.all(
    children.map(async (child) => {
      const root = await gitWorkTreeRoot(child);
      if (!root.ok) return;
      const origin = await readOrigin(root.folder);
      const name = origin?.name || folderName(root.folder);
      const added = configured.some((repo) => repo.localPath != null && repo.localPath !== "" && samePath(repo.localPath, root.folder));
      hits.push({ name, path: root.folder, added });
    }),
  );
  hits.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return { ok: true, hits };
}

// Decide every folder, then write the ones that pass in a single config update.
export async function registerFolders(folders: string[], configPath: string): Promise<RegisteredFolders> {
  const board = readBoard(configPath);
  if (!board.ok) return board;

  const repos = board.repos.map((repo) => ({ name: repo.name, localPath: repo.localPath }));
  const added: RepoEntry[] = [];
  const notices: (string | null)[] = [];
  const skipped: { path: string; error: string }[] = [];

  for (const folder of folders) {
    const decision = await decideRepoEntry(folder, { owner: board.owner, repos });
    if (!decision.ok) {
      skipped.push({ path: folder, error: decision.error });
      continue;
    }
    added.push(decision.entry);
    notices.push(decision.notice);
    repos.push({ name: decision.entry.name, localPath: decision.entry.localPath });
  }

  if (added.length > 0) writeFileSync(configPath, appendReposToConfigText(board.text, added));
  return { ok: true, added, notices, skipped };
}

export async function registerFolder(folder: string, configPath: string): Promise<RepoDecision> {
  const result = await registerFolders([folder], configPath);
  if (!result.ok) return result;
  if (result.added.length === 1) return { ok: true, entry: result.added[0], notice: result.notices[0] ?? null };
  return { ok: false, error: result.skipped[0]?.error ?? "Could not add the folder." };
}
