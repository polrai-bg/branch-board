import type { Comparison, PR, RemoteBranch } from "./merge.ts";
import { pickBase, pickPR } from "./merge.ts";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GitHubError(res.status, `GitHub ${res.status}: ${body.message ?? res.statusText}`);
  if (body.errors?.length) throw new GitHubError(res.status, `GitHub GraphQL: ${body.errors[0].message}`);
  return body;
}

const QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        target { ... on Commit { oid committedDate message author { name user { login } } } }
        associatedPullRequests(first: 5, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { number url state mergeable baseRefName }
        }
      }
    }
  }
}`;

type RefNode = {
  name: string;
  target: { oid: string; committedDate: string; message: string; author: { name: string | null; user: { login: string } | null } };
  associatedPullRequests: { nodes: PR[] };
};

type CompareResponse = { ahead_by: number; behind_by: number; merge_base_commit: { sha: string } | null };

async function compare(token: string, owner: string, repo: string, base: string, head: string): Promise<Comparison> {
  const c = await gh<CompareResponse>(
    token,
    `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1`,
  );
  return { base, ahead: c.ahead_by, behind: c.behind_by, mergeBase: c.merge_base_commit?.sha ?? null };
}

export async function collectRepo(token: string, owner: string, repo: string, bases: string[]): Promise<RemoteBranch[]> {
  const nodes: RefNode[] = [];
  for (let cursor: string | null = null; ; ) {
    const page: { data: { repository: { refs: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: RefNode[] } } } } =
      await gh(token, "/graphql", { method: "POST", body: JSON.stringify({ query: QUERY, variables: { owner, name: repo, cursor } }) });
    const refs = page.data.repository.refs;
    nodes.push(...refs.nodes);
    if (!refs.pageInfo.hasNextPage) break;
    cursor = refs.pageInfo.endCursor;
  }

  const existingBases = bases.filter((b) => nodes.some((n) => n.name === b));
  // ponytail: all compares for a repo fire at once; fine at ~30 branches, add a concurrency cap if GitHub's secondary rate limit trips.
  return Promise.all(
    nodes
      .filter((n) => !bases.includes(n.name))
      .map(async (n): Promise<RemoteBranch> => {
        const prs = n.associatedPullRequests.nodes;
        const pr = pickPR(prs);
        const candidates = pr ? [pr.baseRefName] : existingBases;
        // A PR whose base branch was deleted cannot be compared; that branch just shows no counts.
        const comparisons = (
          await Promise.all(
            candidates.map((base) =>
              compare(token, owner, repo, base, n.name).catch((e) => (e instanceof GitHubError && [404, 422].includes(e.status) ? null : Promise.reject(e))),
            ),
          )
        ).filter((c): c is Comparison => c !== null);
        return {
          repo,
          name: n.name,
          sha: n.target.oid,
          committedDate: n.target.committedDate,
          message: n.target.message,
          authorLogin: n.target.author.user?.login ?? null,
          authorName: n.target.author.name,
          prs,
          compare: pickBase(comparisons),
          baseGuessed: !pr,
        };
      }),
  );
}
