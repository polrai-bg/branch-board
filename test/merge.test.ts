// Fixture names are made up. Tests never read the real config.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../src/lib/config.ts";
import { buildRows, detectAgent, pickBase, statusOf, type PR, type RemoteBranch } from "../src/lib/merge.ts";

const cfg: Config = {
  github: { owner: "example-owner" },
  repos: [{ name: "demo-repo", localPath: null, bases: ["main", "development"] }],
  agents: [
    { prefix: "cursor/", agent: "Cursor" },
    { prefix: "ccr-", agent: "Claude (cloud)" },
  ],
  branchOverrides: [
    { repo: "demo-repo", branch: "mystery-branch", agent: "Me" },
    { repo: "demo-repo", branch: "hand-squashed", ignore: true },
  ],
  refreshMinutes: 2,
  staleDays: 7,
  hideMergedByDefault: true,
};

const NOW = Date.parse("2026-01-20T00:00:00Z");
const pr = (state: PR["state"], mergeable: PR["mergeable"] = "MERGEABLE"): PR => ({ number: 1, url: "u", state, mergeable, baseRefName: "main" });

function branch(p: Partial<RemoteBranch> & { ahead?: number }): RemoteBranch {
  const { ahead = 1, ...rest } = p;
  return {
    repo: "demo-repo",
    name: "feature-x",
    sha: "abc",
    committedDate: "2026-01-19T00:00:00Z",
    message: "work",
    authorLogin: null,
    authorName: null,
    prs: [],
    compare: { base: "main", ahead, behind: 0, mergeBase: "def" },
    baseGuessed: true,
    ...rest,
  };
}

test("status rules, first match wins", () => {
  assert.equal(statusOf(branch({ prs: [pr("MERGED")], ahead: 3 })), "Merged", "squash-merged PR beats commit count");
  assert.equal(statusOf(branch({ prs: [pr("CLOSED")], ahead: 0 })), "Merged", "closed PR with commits in base");
  assert.equal(statusOf(branch({ prs: [pr("OPEN", "CONFLICTING")] })), "Conflicts");
  assert.equal(statusOf(branch({ prs: [pr("OPEN")] })), "Open PR");
  assert.equal(statusOf(branch({ prs: [pr("OPEN", "UNKNOWN")] })), "Open PR");
  assert.equal(statusOf(branch({ prs: [pr("CLOSED")], ahead: 2 })), "WIP");
  assert.equal(statusOf(branch({ ahead: 4 })), "WIP");
  assert.equal(statusOf(branch({ ahead: 0 })), "Empty");
});

test("agent detection: override, prefix, co-author trailer, author login, unknown", () => {
  const b = (name: string, extra: Partial<RemoteBranch> = {}) => detectAgent(cfg, branch({ name, ...extra }));
  assert.equal(b("mystery-branch"), "Me");
  assert.equal(b("cursor/fix-1a2b"), "Cursor");
  assert.equal(b("ccr-abc123"), "Claude (cloud)");
  assert.equal(b("tweak", { message: "x\n\nCo-Authored-By: Claude Opus <noreply@example.com>" }), "Claude");
  assert.equal(b("tweak", { authorName: "github-actions[bot]" }), "GitHub Actions");
  assert.equal(b("tweak"), "Unknown");
});

test("pickBase prefers fewest commits ahead, ties keep config order", () => {
  const c = (base: string, ahead: number) => ({ base, ahead, behind: 0, mergeBase: null });
  assert.equal(pickBase([c("main", 9), c("development", 2)])?.base, "development");
  assert.equal(pickBase([c("main", 2), c("development", 2)])?.base, "main");
  assert.equal(pickBase([]), null);
});

test("buildRows: ignore, stale flag, sort order", () => {
  const rows = buildRows(
    cfg,
    [
      branch({ name: "merged-one", prs: [pr("MERGED")] }),
      branch({ name: "hand-squashed" }),
      branch({ name: "fresh-wip" }),
      branch({ name: "old-wip", committedDate: "2026-01-01T00:00:00Z" }),
      branch({ name: "conflicted", prs: [pr("OPEN", "CONFLICTING")] }),
      branch({ name: "empty-one", ahead: 0 }),
    ],
    NOW,
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["conflicted", "old-wip", "fresh-wip", "empty-one", "merged-one"],
  );
  assert.equal(rows.find((r) => r.name === "old-wip")?.stale, true);
  assert.equal(rows.find((r) => r.name === "fresh-wip")?.stale, false);
});
