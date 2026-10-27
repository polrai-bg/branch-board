// Last few commits for a row. Local git when the branch is on disk, otherwise GitHub.
import { GIT_COMMAND_TIMEOUT_MS, defaultGit, type GitRunner } from "./local.ts";

export type CommitLine = { sha: string; author: string; date: string; subject: string };

const FIELD = "\x1f";

export function parseCommitLog(stdout: string): CommitLine[] {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, subject] = line.split(FIELD);
      return { sha: sha ?? "", author: author ?? "", date: date ?? "", subject: subject ?? "" };
    })
    .filter((commit) => commit.sha);
}

export async function localCommits(localPath: string, branch: string, git: GitRunner = defaultGit(), limit = 5): Promise<CommitLine[] | null> {
  if (!branch || branch.startsWith("-") || branch.includes("\0")) return null;
  const ref = `refs/heads/${branch}`;
  const exists = await git(["rev-parse", "--verify", "--quiet", ref], localPath, GIT_COMMAND_TIMEOUT_MS);
  if (exists.code !== 0) return null;
  const log = await git(["log", `-${limit}`, `--format=%H${FIELD}%an${FIELD}%cI${FIELD}%s`, ref], localPath, GIT_COMMAND_TIMEOUT_MS);
  if (log.code !== 0) return null;
  return parseCommitLog(log.stdout);
}
