import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Config = {
  github: { owner: string };
  repos: { name: string; localPath: string | null; bases: string[] }[];
  agents: { prefix: string; agent: string }[];
  branchOverrides: { repo: string; branch: string; agent?: string; ignore?: boolean }[];
  refreshMinutes: number;
  staleDays: number;
  hideMergedByDefault: boolean;
};

export const CONFIG_FILE = "branchboard.config.json";

// Read on every refresh so edits apply without a restart. Never falls back to defaults for owner or repos.
export function loadConfig(): Config {
  const file = join(process.cwd(), CONFIG_FILE);
  if (!existsSync(file)) {
    throw new Error(`${CONFIG_FILE} is missing. Copy branchboard.config.example.json to ${CONFIG_FILE} and fill it in.`);
  }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!raw.github?.owner || !Array.isArray(raw.repos) || raw.repos.length === 0) {
    throw new Error(`${CONFIG_FILE} needs github.owner and at least one repo.`);
  }
  return {
    github: raw.github,
    repos: raw.repos.map((r: Config["repos"][number]) => ({
      name: r.name,
      localPath: r.localPath ? r.localPath.replace(/^~(?=\/|$)/, homedir()) : null,
      bases: r.bases?.length ? r.bases : ["main"],
    })),
    agents: raw.agents ?? [],
    branchOverrides: raw.branchOverrides ?? [],
    refreshMinutes: raw.refreshMinutes ?? 2,
    staleDays: raw.staleDays ?? 7,
    hideMergedByDefault: raw.hideMergedByDefault ?? true,
  };
}
