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
});

test("invalid issuePattern is refused", () => {
  assert.throws(() => configFromRaw({ github: { owner: "example-owner" }, repos: [{ name: "demo-repo" }], issuePattern: "(" }), /issuePattern/);
});
