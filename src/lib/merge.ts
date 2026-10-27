// Pure rules: agent detection, issue linking, status, flags, sort. No I/O.
import type { Config } from "./config.ts";

export const DEFAULT_ISSUE_PATTERN = String.raw`^(?:[^/]+/)?(\d+)-`;

export type ClosingIssue = { number: number; nameWithOwner: string };

export type PR = {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  baseRefName: string;
  // Newest of this and the branch tip is "review activity" for Stalled review.
  // GitHub moves updatedAt on pushes, reviews, comments, and edits.
  updatedAt?: string | null;
  closingIssues?: ClosingIssue[];
};

export type Comparison = { base: string; ahead: number; behind: number; mergeBase: string | null };

export type RemoteBranch = {
  repo: string;
  name: string;
  sha: string;
  committedDate: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  prs: PR[];
  compare: Comparison | null;
  baseGuessed: boolean;
};

export type LocalRecord = {
  repo: string;
  name: string;
  sha: string;
  committedDate: string;
  message: string;
  authorName: string | null;
  dirty: boolean;
  unpushed: number;
  neverPushed: boolean;
  detached: boolean;
  offBranch: boolean;
  localPath: string | null;
  compare: Comparison | null;
  baseGuessed: boolean;
};

export type IssueInfo = { repo: string; number: number; title: string; state: "OPEN" | "CLOSED" };

export type IssueLink = { number: number; title: string | null; state: "OPEN" | "CLOSED" | null };

export type Where = "GitHub" | "Local" | "Both";

export type Status = "Conflicts" | "Unsaved" | "Unpushed" | "Local only" | "WIP" | "Open PR" | "Empty" | "Merged" | "Base";

export const STATUS_ORDER: Status[] = ["Conflicts", "Unsaved", "Unpushed", "Local only", "WIP", "Open PR", "Empty", "Merged", "Base"];

export const FLAG_ORDER = ["Orphan", "Overlap", "Stalled review", "Stale", "Issue closed"] as const;

export type Flag = (typeof FLAG_ORDER)[number];

const UNFINISHED_LIST = ["Unsaved", "Unpushed", "Local only"] as const satisfies readonly Status[];

export const UNFINISHED_STATUSES: readonly Status[] = UNFINISHED_LIST;

function isUnfinished(status: Status): status is (typeof UNFINISHED_LIST)[number] {
  return (UNFINISHED_LIST as readonly Status[]).includes(status);
}

// Metrics stored once per day. Chip totals are the sum across repos.
export const COUNT_METRICS = ["Orphan", "Overlap", "Stalled review", "Stale", "Issue closed", "Unfinished local", "Empty"] as const;

export type StatusInput = {
  prs: PR[];
  compare: Comparison | null;
  dirty?: boolean;
  unpushed?: number;
  neverPushed?: boolean;
  detached?: boolean;
  offBranch?: boolean;
};

export type Row = RemoteBranch & {
  agent: string;
  status: Status;
  stale: boolean;
  pr: PR | null;
  daysAgo: number;
  where: Where;
  localPath: string | null;
  issue: IssueLink | null;
  flags: Flag[];
  attempt: string | null;
  dirty: boolean;
  unpushed: number;
  neverPushed: boolean;
  detached: boolean;
};

const AUTHOR_AGENTS: Record<string, string> = {
  "cursor-agent": "Cursor",
  claude: "Claude",
  codex: "Codex",
  "github-actions": "GitHub Actions",
};

export function detectAgent(cfg: Config, b: Pick<RemoteBranch, "repo" | "name" | "message" | "authorLogin" | "authorName">): string {
  const override = cfg.branchOverrides.find((o) => o.repo === b.repo && o.branch === b.name && o.agent);
  if (override?.agent) return override.agent;
  const rule = cfg.agents.find((a) => b.name.startsWith(a.prefix));
  if (rule) return rule.agent;
  if (/co-authored-by:\s*claude/i.test(b.message)) return "Claude";
  for (const who of [b.authorLogin, b.authorName]) {
    const key = who?.toLowerCase().replace(/\[bot\]$/, "");
    if (key && AUTHOR_AGENTS[key]) return AUTHOR_AGENTS[key];
  }
  return "Unknown";
}

// Open PR wins, then merged, then the newest one GitHub returned.
export function pickPR(prs: PR[]): PR | null {
  return prs.find((p) => p.state === "OPEN") ?? prs.find((p) => p.state === "MERGED") ?? prs[0] ?? null;
}

// No PR: the candidate base whose merge base is closest to the branch tip (fewest commits ahead) wins; ties keep config order.
export function pickBase(candidates: Comparison[]): Comparison | null {
  return candidates.reduce<Comparison | null>((best, c) => (!best || c.ahead < best.ahead ? c : best), null);
}

// GitHub's ahead count misses commits that were never pushed. Those are also "not in the base".
function commitsNotInBase(b: StatusInput): number | null {
  const ahead = b.compare?.ahead;
  if (ahead == null) return null;
  if (b.neverPushed) return ahead;
  return ahead + (b.unpushed ?? 0);
}

// The tip commit belongs to this branch only if the branch has commits of its own. An untouched branch's tip is a
// base commit, whose message ("Title (#21)", "Merge pull request #5") must not link the branch to an issue.
export function hasOwnCommits(b: StatusInput): boolean {
  if (b.detached) return Boolean(b.offBranch);
  const ahead = commitsNotInBase(b);
  return ahead != null && ahead > 0;
}

// First match wins. Zero-ahead with no PR at all is Empty, not Merged: an untouched agent branch and a branch
// fast-forward merged by hand look identical by commit count, and the first is far more common. Zero-ahead with a PR is Merged.
export function statusOf(b: StatusInput): Status {
  const pr = pickPR(b.prs);
  const ahead = commitsNotInBase(b);
  if (b.prs.some((p) => p.state === "MERGED") || (pr && ahead === 0)) return "Merged";
  if (pr?.state === "OPEN") return pr.mergeable === "CONFLICTING" ? "Conflicts" : "Open PR";
  if (b.dirty) return "Unsaved";
  if (!b.neverPushed && (b.unpushed ?? 0) > 0) return "Unpushed";
  if (b.neverPushed) return "Local only";
  if (b.detached && b.offBranch) return "WIP";
  if (ahead === 0) return "Empty";
  return "WIP";
}

export function attemptId(name: string): string | null {
  return /^(?:[^/]+\/)?\d+-(a\d+)(?:-|$)/.exec(name)?.[1] ?? null;
}

function patternFor(source: string): RegExp {
  try {
    return new RegExp(source);
  } catch {
    return new RegExp(DEFAULT_ISSUE_PATTERN);
  }
}

export function sameRepo(owner: string, repo: string, nameWithOwner: string): boolean {
  return nameWithOwner.toLowerCase() === `${owner}/${repo}`.toLowerCase();
}

// First source that yields a positive issue number wins.
export function linkIssue(cfg: Config, item: Pick<RemoteBranch, "repo" | "name" | "message" | "prs"> & StatusInput): number | null {
  const override = cfg.branchOverrides.find(
    (o) => o.repo === item.repo && o.branch === item.name && typeof o.issue === "number" && o.issue > 0,
  );
  if (override?.issue) return override.issue;

  const primary = pickPR(item.prs);
  const prs = primary ? [primary, ...item.prs.filter((p) => p !== primary)] : item.prs;
  for (const pr of prs) {
    for (const closing of pr.closingIssues ?? []) {
      if (closing.number > 0 && sameRepo(cfg.github.owner, item.repo, closing.nameWithOwner)) return closing.number;
    }
  }

  const fromName = patternFor(cfg.issuePattern).exec(item.name);
  if (fromName?.[1] && /^\d+$/.test(fromName[1])) return Number(fromName[1]);

  if (!hasOwnCommits(item)) return null;
  const fromMessage = /#(\d+)/.exec(item.message);
  return fromMessage ? Number(fromMessage[1]) : null;
}

function activityAt(committedDate: string, prs: PR[]): number {
  const pr = pickPR(prs);
  const times = [Date.parse(committedDate)];
  if (pr?.state === "OPEN" && pr.updatedAt) times.push(Date.parse(pr.updatedAt));
  const latest = Math.max(...times.filter((t) => !Number.isNaN(t)));
  return Number.isFinite(latest) ? latest : 0;
}

type Work = {
  repo: string;
  name: string;
  sha: string;
  committedDate: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  prs: PR[];
  compare: Comparison | null;
  baseGuessed: boolean;
  where: Where;
  localPath: string | null;
  dirty: boolean;
  unpushed: number;
  neverPushed: boolean;
  detached: boolean;
  offBranch: boolean;
};

function join(remotes: RemoteBranch[], locals: LocalRecord[]): Work[] {
  const remoteByKey = new Map(remotes.map((r) => [`${r.repo}\0${r.name}`, r]));
  const localByKey = new Map(locals.filter((l) => !l.detached).map((l) => [`${l.repo}\0${l.name}`, l]));
  const works: Work[] = [];
  for (const key of new Set([...remoteByKey.keys(), ...localByKey.keys()])) {
    const remote = remoteByKey.get(key);
    const local = localByKey.get(key);
    const source = local ?? remote;
    if (!source) continue;
    works.push({
      repo: source.repo,
      name: source.name,
      sha: local?.sha ?? remote!.sha,
      committedDate: local?.committedDate ?? remote!.committedDate,
      message: local?.message ?? remote!.message,
      authorLogin: remote?.authorLogin ?? null,
      authorName: local?.authorName ?? remote?.authorName ?? null,
      prs: remote?.prs ?? [],
      // A missing GitHub compare stays empty. Do not fill it from the local scan.
      compare: remote ? remote.compare : (local?.compare ?? null),
      baseGuessed: remote ? remote.baseGuessed : true,
      where: remote && local ? "Both" : remote ? "GitHub" : "Local",
      localPath: local?.localPath ?? null,
      dirty: local?.dirty ?? false,
      unpushed: local?.unpushed ?? 0,
      neverPushed: Boolean(local?.neverPushed) && !remote,
      detached: false,
      offBranch: false,
    });
  }
  for (const local of locals.filter((l) => l.detached)) {
    works.push({
      repo: local.repo,
      name: local.name,
      sha: local.sha,
      committedDate: local.committedDate,
      message: local.message,
      authorLogin: null,
      authorName: local.authorName,
      prs: [],
      compare: null,
      baseGuessed: true,
      where: "Local",
      localPath: local.localPath,
      dirty: local.dirty,
      unpushed: 0,
      neverPushed: false,
      detached: true,
      offBranch: local.offBranch,
    });
  }
  return works;
}

function overlapKeys(rows: { repo: string; status: Status; issue: IssueLink | null; attempt: string | null }[]): Set<string> {
  const groups = new Map<string, { attempt: string | null }[]>();
  for (const row of rows) {
    if (row.status === "Merged" || row.status === "Base" || !row.issue) continue;
    const key = `${row.repo}#${row.issue.number}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const keys = new Set<string>();
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const attempts = list.map((r) => r.attempt);
    const eachDistinct = attempts.every(Boolean) && new Set(attempts).size === attempts.length;
    if (!eachDistinct) keys.add(key);
  }
  return keys;
}

function flagsFor(cfg: Config, row: { name: string; status: Status; issue: IssueLink | null; daysAgo: number; committedDate: string; prs: PR[] }, overlap: boolean, now: number): Flag[] {
  if (row.status === "Base") return [];
  const flags: Flag[] = [];
  const exempt = (cfg.exemptPrefixes ?? []).filter(Boolean).some((prefix) => row.name.startsWith(prefix));
  if (row.status !== "Merged" && !row.issue && !exempt) flags.push("Orphan");
  if (overlap) flags.push("Overlap");
  if (row.status === "Open PR" || row.status === "Conflicts") {
    const days = Math.floor((now - activityAt(row.committedDate, row.prs)) / 86_400_000);
    if (days >= cfg.stalledReviewDays) flags.push("Stalled review");
  }
  if (row.status === "WIP" && row.daysAgo >= cfg.staleDays) flags.push("Stale");
  if (row.issue?.state === "CLOSED" && row.status !== "Merged") flags.push("Issue closed");
  return flags;
}

// One order for the sort and the page sections, so a section never splits.
function placement(row: { status: Status; flags: readonly Flag[] }): { rank: number; section: string } {
  if (row.status === "Conflicts") return { rank: 0, section: "Conflicts" };
  if (isUnfinished(row.status)) return { rank: 1, section: "On this Mac" };
  if (row.flags.includes("Overlap")) return { rank: 2, section: "Overlapping" };
  if (row.flags.includes("Orphan")) return { rank: 3, section: "No issue" };
  if (row.flags.includes("Stalled review")) return { rank: 4, section: "Stalled" };
  if (row.flags.includes("Stale")) return { rank: 5, section: "Stale" };
  if (row.status === "WIP") return { rank: 6, section: "In progress" };
  if (row.status === "Open PR") return { rank: 7, section: "In review" };
  if (row.status === "Empty") return { rank: 8, section: "Empty" };
  if (row.status === "Merged") return { rank: 9, section: "Merged" };
  if (row.status === "Base") return { rank: 10, section: "Bases" };
  const unreachable: never = row.status;
  return unreachable;
}

function actionRank(row: Row): number {
  return placement(row).rank;
}

export function sectionOf(row: { status: Status; flags: readonly Flag[] }): string {
  return placement(row).section;
}

function isConfiguredBase(cfg: Config, repo: string, name: string): boolean {
  return cfg.repos.some((item) => item.name === repo && item.bases.includes(name));
}

export function buildRows(cfg: Config, remotes: RemoteBranch[], now = Date.now(), locals: LocalRecord[] = [], issues: IssueInfo[] = []): Row[] {
  const known = new Map(issues.map((issue) => [`${issue.repo}#${issue.number}`, issue]));
  const draft = join(remotes, locals)
    .filter((item) => !cfg.branchOverrides.some((o) => o.repo === item.repo && o.branch === item.name && o.ignore))
    .map((item) => {
      // A configured base is the trunk, not unfinished work. statusOf would mark it Empty or Local only.
      const isBase = isConfiguredBase(cfg, item.repo, item.name);
      const source = isBase ? { ...item, compare: null, baseGuessed: false } : item;
      const parsed = Date.parse(source.committedDate);
      const daysAgo = Number.isNaN(parsed) ? 0 : Math.floor((now - parsed) / 86_400_000);
      const number = linkIssue(cfg, source);
      const hit = number == null ? undefined : known.get(`${source.repo}#${number}`);
      const issue: IssueLink | null = number == null ? null : { number, title: hit?.title ?? null, state: hit?.state ?? null };
      const status = isBase ? "Base" : statusOf(source);
      return {
        ...source,
        agent: detectAgent(cfg, source),
        status,
        stale: status === "WIP" && daysAgo >= cfg.staleDays,
        pr: pickPR(item.prs),
        daysAgo,
        issue,
        attempt: attemptId(item.name),
        flags: [] as Flag[],
      };
    });
  const overlapped = overlapKeys(draft);
  const rows = draft.map((row) => ({
    ...row,
    flags: flagsFor(cfg, row, row.issue != null && overlapped.has(`${row.repo}#${row.issue.number}`), now),
  }));
  return rows.sort(
    (a, b) => actionRank(a) - actionRank(b) || a.committedDate.localeCompare(b.committedDate) || a.repo.localeCompare(b.repo) || a.name.localeCompare(b.name),
  );
}

export function summaryCounts(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const flag of FLAG_ORDER) counts[flag] = rows.filter((row) => row.flags.includes(flag)).length;
  counts["Unfinished local"] = rows.filter((row) => UNFINISHED_STATUSES.includes(row.status)).length;
  for (const status of STATUS_ORDER) counts[status] = rows.filter((row) => row.status === status).length;
  return counts;
}

export function countsByRepo(rows: Row[], repos: string[]): { repo: string; metric: string; count: number }[] {
  return repos.flatMap((repo) => {
    const summary = summaryCounts(rows.filter((row) => row.repo === repo));
    return COUNT_METRICS.map((metric) => ({ repo, metric, count: summary[metric] ?? 0 }));
  });
}
