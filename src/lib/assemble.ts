import { GitHubError } from "./github.ts";
import type { IssueInfo, LocalRecord, RemoteBranch } from "./merge.ts";
import type { LocalScan } from "./local.ts";

export type Collected = { branches: RemoteBranch[]; issues: IssueInfo[] };

export type RepoError = { message: string; setup?: boolean };

export function describeRepoError(repo: string, error: unknown): RepoError {
  const setup = error instanceof GitHubError && error.status === 401;
  const detail = error instanceof Error ? error.message : "unknown error";
  return {
    message: setup ? `${repo}: GitHub token is invalid or expired.` : `${repo}: ${detail}`,
    setup: setup || undefined,
  };
}

// Remote failure keeps the previous rows for that repo. A missing local folder drops that repo's local rows.
export function mergeCollections(
  repos: { name: string; localPath: string | null }[],
  prev: { branches: RemoteBranch[]; locals: LocalRecord[]; issues: IssueInfo[] },
  remoteResults: PromiseSettledResult<Collected>[] | null,
  localScans: (LocalScan | null)[],
): { branches: RemoteBranch[]; locals: LocalRecord[]; issues: IssueInfo[]; errors: RepoError[] } {
  const branches: RemoteBranch[] = [];
  const locals: LocalRecord[] = [];
  const issues: IssueInfo[] = [];
  const errors: RepoError[] = [];

  repos.forEach((repo, index) => {
    const remote = remoteResults?.[index];
    if (!remote) {
      branches.push(...prev.branches.filter((branch) => branch.repo === repo.name));
      issues.push(...prev.issues.filter((issue) => issue.repo === repo.name));
    } else if (remote.status === "fulfilled") {
      branches.push(...remote.value.branches);
      issues.push(...remote.value.issues);
    } else {
      errors.push(describeRepoError(repo.name, remote.reason));
      branches.push(...prev.branches.filter((branch) => branch.repo === repo.name));
      issues.push(...prev.issues.filter((issue) => issue.repo === repo.name));
    }

    const scan = localScans[index];
    if (!repo.localPath || !scan) return;
    if (scan.error) errors.push({ message: scan.error });
    if (scan.error && scan.records.length === 0) return;
    locals.push(...scan.records);
  });

  return { branches, locals, issues, errors };
}
