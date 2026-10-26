import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ISSUE_PATTERN } from "./merge.ts";

export type BranchOverride = { repo: string; branch: string; agent?: string; ignore?: boolean; issue?: number };

export type Config = {
  github: { owner: string };
  repos: { name: string; localPath: string | null; bases: string[] }[];
  agents: { prefix: string; agent: string }[];
  branchOverrides: BranchOverride[];
  exemptPrefixes: string[];
  issuePattern: string;
  refreshMinutes: number;
  staleDays: number;
  stalledReviewDays: number;
  hideMergedByDefault: boolean;
};

export const CONFIG_FILE = "branchboard.config.json";

type Raw = {
  github?: { owner?: string };
  repos?: { name: string; localPath?: string | null; bases?: string[] }[];
  agents?: Config["agents"];
  branchOverrides?: BranchOverride[];
  exemptPrefixes?: unknown;
  issuePattern?: unknown;
  refreshMinutes?: number;
  staleDays?: number;
  stalledReviewDays?: number;
  hideMergedByDefault?: boolean;
};

// Read on every refresh so edits apply without a restart. Never falls back to defaults for owner or repos.
export function loadConfig(): Config {
  const file = join(process.cwd(), CONFIG_FILE);
  if (!existsSync(file)) {
    throw new Error(`${CONFIG_FILE} is missing. Copy branchboard.config.example.json to ${CONFIG_FILE} and fill it in.`);
  }
  return configFromRaw(JSON.parse(readFileSync(file, "utf8")));
}

export function configFromRaw(raw: Raw): Config {
  if (!raw?.github?.owner || !Array.isArray(raw.repos) || raw.repos.length === 0) {
    throw new Error(`${CONFIG_FILE} needs github.owner and at least one repo.`);
  }
  const issuePattern = typeof raw.issuePattern === "string" && raw.issuePattern ? raw.issuePattern : DEFAULT_ISSUE_PATTERN;
  try {
    new RegExp(issuePattern);
  } catch {
    throw new Error(`${CONFIG_FILE} issuePattern is not a valid regular expression.`);
  }
  return {
    github: { owner: raw.github.owner },
    repos: raw.repos.map((repo) => ({
      name: repo.name,
      localPath: repo.localPath ? repo.localPath.replace(/^~(?=\/|$)/, homedir()) : null,
      bases: repo.bases?.length ? repo.bases : ["main"],
    })),
    agents: raw.agents ?? [],
    branchOverrides: (raw.branchOverrides ?? []).map((override) => ({
      repo: override.repo,
      branch: override.branch,
      agent: override.agent,
      ignore: override.ignore,
      issue: typeof override.issue === "number" && override.issue > 0 ? override.issue : undefined,
    })),
    exemptPrefixes: Array.isArray(raw.exemptPrefixes) ? raw.exemptPrefixes.filter((prefix): prefix is string => typeof prefix === "string" && prefix.length > 0) : [],
    issuePattern,
    refreshMinutes: raw.refreshMinutes ?? 2,
    staleDays: raw.staleDays ?? 7,
    stalledReviewDays: raw.stalledReviewDays ?? 3,
    hideMergedByDefault: raw.hideMergedByDefault ?? true,
  };
}
