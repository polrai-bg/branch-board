import { DEFAULT_ISSUE_PATTERN, pickBase, pickPR, sameRepo, type Comparison, type IssueInfo, type PR, type RemoteBranch } from "./merge.ts";

const API = "https://api.github.com";

// One call is capped so a hung API cannot stall the refresh.
export const GITHUB_FETCH_TIMEOUT_MS = 45_000;

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type CollectOptions = {
  fetch?: typeof fetch;
  issuePattern?: string;
  extraIssueNumbers?: number[];
};

type FetchImpl = typeof fetch;

async function gh<T>(fetchImpl: FetchImpl, token: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new GitHubError(res.status, `GitHub ${res.status}: ${body.message ?? res.statusText}`);
    if (body.errors?.length) throw new GitHubError(res.status, `GitHub GraphQL: ${body.errors[0].message}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        target { ... on Commit { oid committedDate message author { name user { login } } } }
        associatedPullRequests(first: 5, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            number url state mergeable baseRefName updatedAt
            closingIssuesReferences(first: 20) {
              nodes { number title state repository { nameWithOwner } }
            }
          }
        }
      }
    }
  }
}`;

type RefNode = {
  name: string;
  target: { oid: string; committedDate: string; message: string; author: { name: string | null; user: { login: string } | null } | null } | null;
  associatedPullRequests: {
    nodes: {
      number: number;
      url: string;
      state: PR["state"];
      mergeable: PR["mergeable"];
      baseRefName: string;
      updatedAt?: string | null;
      closingIssuesReferences?: { nodes: { number: number; title?: string; state?: IssueInfo["state"]; repository?: { nameWithOwner?: string } }[] };
    }[];
  } | null;
};

type CompareResponse = { ahead_by: number; behind_by: number; merge_base_commit: { sha: string } | null };

async function compare(fetchImpl: FetchImpl, token: string, owner: string, repo: string, base: string, head: string): Promise<Comparison> {
  const c = await gh<CompareResponse>(fetchImpl, token, `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1`);
  return { base, ahead: c.ahead_by, behind: c.behind_by, mergeBase: c.merge_base_commit?.sha ?? null };
}

function mapPR(node: NonNullable<RefNode["associatedPullRequests"]>["nodes"][number]): PR {
  return {
    number: node.number,
    url: node.url,
    state: node.state,
    mergeable: node.mergeable,
    baseRefName: node.baseRefName,
    updatedAt: node.updatedAt ?? null,
    closingIssues: (node.closingIssuesReferences?.nodes ?? []).filter(Boolean).map((issue) => ({
      number: issue.number,
      nameWithOwner: issue.repository?.nameWithOwner ?? "",
    })),
  };
}

function closingIssueInfo(owner: string, repo: string, nodes: RefNode[]): IssueInfo[] {
  const found = new Map<number, IssueInfo>();
  for (const node of nodes) {
    for (const pr of node.associatedPullRequests?.nodes ?? []) {
      for (const issue of pr.closingIssuesReferences?.nodes ?? []) {
        if (!issue?.number || !issue.state || !issue.title) continue;
        if (!sameRepo(owner, repo, issue.repository?.nameWithOwner ?? "")) continue;
        found.set(issue.number, { repo, number: issue.number, title: issue.title, state: issue.state });
      }
    }
  }
  return [...found.values()];
}

function candidateNumbers(owner: string, repo: string, branches: RemoteBranch[], pattern: string, extra: number[]): number[] {
  const found = new Set(extra.filter((number) => number > 0));
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    re = new RegExp(DEFAULT_ISSUE_PATTERN);
  }
  for (const branch of branches) {
    re.lastIndex = 0;
    const fromName = re.exec(branch.name);
    if (fromName?.[1] && /^\d+$/.test(fromName[1])) found.add(Number(fromName[1]));
    const fromMessage = /#(\d+)/.exec(branch.message);
    if (fromMessage) found.add(Number(fromMessage[1]));
    for (const pr of branch.prs) {
      for (const closing of pr.closingIssues ?? []) {
        if (closing.number > 0 && sameRepo(owner, repo, closing.nameWithOwner)) found.add(closing.number);
      }
    }
  }
  return [...found];
}

async function lookupIssues(fetchImpl: FetchImpl, token: string, owner: string, repo: string, numbers: number[]): Promise<IssueInfo[]> {
  const issues: IssueInfo[] = [];
  for (let start = 0; start < numbers.length; start += 40) {
    const chunk = numbers.slice(start, start + 40);
    const fields = chunk.map((number) => `i_${number}: issue(number: ${number}) { number title state }`).join("\n");
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
    const page = await gh<{ data: { repository: Record<string, { number: number; title: string; state: IssueInfo["state"] } | null> | null } }>(
      fetchImpl,
      token,
      "/graphql",
      { method: "POST", body: JSON.stringify({ query, variables: { owner, name: repo } }) },
    );
    const repository = page.data?.repository;
    if (!repository) continue;
    for (const number of chunk) {
      const issue = repository[`i_${number}`];
      if (issue?.number && issue.title && issue.state) issues.push({ repo, number: issue.number, title: issue.title, state: issue.state });
    }
  }
  return issues;
}

export async function collectRepo(token: string, owner: string, repo: string, bases: string[], opts: CollectOptions = {}): Promise<{ branches: RemoteBranch[]; issues: IssueInfo[] }> {
  const fetchImpl = opts.fetch ?? fetch;
  const nodes: RefNode[] = [];
  for (let cursor: string | null = null; ; ) {
    const page: { data: { repository: { refs: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: RefNode[] } } | null } } = await gh(
      fetchImpl,
      token,
      "/graphql",
      { method: "POST", body: JSON.stringify({ query: QUERY, variables: { owner, name: repo, cursor } }) },
    );
    if (!page.data?.repository) throw new GitHubError(404, "GitHub GraphQL: repository was not found.");
    const refs = page.data.repository.refs;
    nodes.push(...(refs.nodes ?? []).filter(Boolean));
    if (!refs.pageInfo.hasNextPage) break;
    cursor = refs.pageInfo.endCursor;
  }

  const fromClosings = closingIssueInfo(owner, repo, nodes);
  const existingBases = bases.filter((base) => nodes.some((node) => node.name === base));
  // ponytail: compares for a repo fire at once; fine at a few dozen branches.
  const branches = await Promise.all(
    nodes
      .filter((node) => node.target?.oid && !bases.includes(node.name))
      .map(async (node): Promise<RemoteBranch> => {
        const prs = (node.associatedPullRequests?.nodes ?? []).filter(Boolean).map(mapPR);
        const pr = pickPR(prs);
        const candidates = pr ? [pr.baseRefName] : existingBases;
        const comparisons = (
          await Promise.all(
            candidates.map((base) =>
              compare(fetchImpl, token, owner, repo, base, node.name).catch((error) =>
                error instanceof GitHubError && [404, 422].includes(error.status) ? null : Promise.reject(error),
              ),
            ),
          )
        ).filter((item): item is Comparison => item !== null);
        return {
          repo,
          name: node.name,
          sha: node.target!.oid,
          committedDate: node.target!.committedDate,
          message: node.target!.message,
          authorLogin: node.target!.author?.user?.login ?? null,
          authorName: node.target!.author?.name ?? null,
          prs,
          compare: pickBase(comparisons),
          baseGuessed: !pr,
        };
      }),
  );

  const numbers = candidateNumbers(owner, repo, branches, opts.issuePattern ?? DEFAULT_ISSUE_PATTERN, opts.extraIssueNumbers ?? []);
  const lookedUp = numbers.length ? await lookupIssues(fetchImpl, token, owner, repo, numbers) : [];
  const issues = new Map<number, IssueInfo>();
  for (const issue of fromClosings) issues.set(issue.number, issue);
  for (const issue of lookedUp) issues.set(issue.number, issue);
  return { branches, issues: [...issues.values()] };
}
