import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromRaw } from "../src/lib/config.ts";
import { DEFAULT_ISSUE_PATTERN } from "../src/lib/merge.ts";

test("config defaults fill the phase 1 keys", () => {
  const cfg = configFromRaw({ github: { owner: "example-owner" }, repos: [{ name: "demo-repo", localPath: "~/code/repo-one" }] });
  assert.deepEqual(cfg.exemptPrefixes, []);
  assert.equal(cfg.issuePattern, DEFAULT_ISSUE_PATTERN);
  assert.equal(cfg.stalledReviewDays, 3);
  assert.equal(cfg.refreshMinutes, 2);
  assert.deepEqual(cfg.repos[0].bases, ["main"]);
  assert.ok(cfg.repos[0].localPath?.endsWith("/code/repo-one"));
  assert.ok(cfg.claudeConfigDir?.endsWith("/.claude") || cfg.claudeConfigDir?.includes("claude"));
  assert.deepEqual(cfg.taskLists, []);
});

test("claudeConfigDir null turns the source off; taskLists bind a named list", () => {
  const off = configFromRaw({ github: { owner: "example-owner" }, repos: [{ name: "demo-repo" }], claudeConfigDir: null });
  assert.equal(off.claudeConfigDir, null);
  const on = configFromRaw({
    github: { owner: "example-owner" },
    repos: [{ name: "demo-repo" }],
    claudeConfigDir: "~/.claude-alt",
    taskLists: [{ list: "feature-auth", repo: "demo-repo", branch: "claude/42-auth" }],
  });
  assert.ok(on.claudeConfigDir?.endsWith("/.claude-alt"));
  assert.deepEqual(on.taskLists, [{ list: "feature-auth", repo: "demo-repo", branch: "claude/42-auth" }]);
});

test("invalid issuePattern is refused", () => {
  assert.throws(() => configFromRaw({ github: { owner: "example-owner" }, repos: [{ name: "demo-repo" }], issuePattern: "(" }), /issuePattern/);
});
