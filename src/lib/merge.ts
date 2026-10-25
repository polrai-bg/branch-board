// Pure rules: agent detection, status, sort. No I/O so it can be unit tested and reused when hosted.
import type { Config } from "./config.ts";

export type PR = {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  baseRefName: string;
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

export type Status = "Conflicts" | "WIP" | "Open PR" | "Empty" | "Merged";

export type Row = RemoteBranch & { agent: string; status: Status; stale: boolean; pr: PR | null; daysAgo: number };

// Sort and chip order. Stale is a flag on WIP, not its own status.
export const STATUS_ORDER: Status[] = ["Conflicts", "WIP", "Open PR", "Empty", "Merged"];

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

// Spec rule order, first match wins. Zero-ahead with no PR at all is Empty, not Merged: an agent branch that was
// never committed to and a branch fast-forward merged by hand look identical by commit count, and the first is far
// more common here. Zero-ahead with a closed PR counts as Merged.
export function statusOf(b: RemoteBranch): Status {
  const pr = pickPR(b.prs);
  const ahead = b.compare?.ahead ?? null;
  if (b.prs.some((p) => p.state === "MERGED") || (pr && ahead === 0)) return "Merged";
  if (pr?.state === "OPEN") return pr.mergeable === "CONFLICTING" ? "Conflicts" : "Open PR";
  if (ahead === 0) return "Empty";
  return "WIP";
}

export function buildRows(cfg: Config, branches: RemoteBranch[], now = Date.now()): Row[] {
  const rows = branches
    .filter((b) => !cfg.branchOverrides.some((o) => o.repo === b.repo && o.branch === b.name && o.ignore))
    .map((b) => {
      const status = statusOf(b);
      const daysAgo = Math.floor((now - Date.parse(b.committedDate)) / 86_400_000);
      return { ...b, agent: detectAgent(cfg, b), status, stale: status === "WIP" && daysAgo >= cfg.staleDays, pr: pickPR(b.prs), daysAgo };
    });
  return rows.sort((a, b) => rank(a) - rank(b) || a.committedDate.localeCompare(b.committedDate));
}

function rank(r: Row): number {
  // Stale WIP sorts ahead of fresh WIP.
  return STATUS_ORDER.indexOf(r.status) * 2 + (r.status === "WIP" && !r.stale ? 1 : 0);
}
