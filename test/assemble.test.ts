import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRepoError, mergeCollections } from "../src/lib/assemble.ts";
import { GitHubError } from "../src/lib/github.ts";
import type { RemoteBranch } from "../src/lib/merge.ts";

const remote: RemoteBranch = {
  repo: "demo-repo",
  name: "cursor/1-slug",
  sha: "abc",
  committedDate: "2026-01-19T00:00:00Z",
  message: "work",
  authorLogin: null,
  authorName: null,
  prs: [],
  compare: { base: "main", ahead: 1, behind: 0, mergeBase: "def" },
  baseGuessed: true,
};

test("401 is a setup problem and the previous rows remain", () => {
  const error = describeRepoError("demo-repo", new GitHubError(401, "GitHub 401: Bad credentials"));
  assert.equal(error.setup, true);
  assert.match(error.message, /invalid or expired/);

  const merged = mergeCollections(
    [{ name: "demo-repo", localPath: "/tmp/demo-checkout" }],
    { branches: [remote], locals: [], issues: [] },
    [{ status: "rejected", reason: new GitHubError(401, "GitHub 401: Bad credentials") }],
    [{ records: [], error: null }],
  );
  assert.equal(merged.errors[0].setup, true);
  assert.equal(merged.branches[0].name, "cursor/1-slug");
});

test("missing local folder names the folder and keeps remote rows", () => {
  const folder = "/tmp/bb-missing-folder";
  const merged = mergeCollections(
    [{ name: "demo-repo", localPath: folder }],
    { branches: [remote], locals: [{ ...remote, dirty: true, unpushed: 0, neverPushed: true, detached: false, offBranch: false, localPath: folder, authorName: null }], issues: [] },
    [{ status: "fulfilled", value: { branches: [remote], issues: [] } }],
    [{ records: [], error: `Local folder missing: ${folder}` }],
  );
  assert.equal(merged.branches.length, 1);
  assert.equal(merged.locals.length, 0);
  assert.ok(merged.errors.some((error) => error.message.includes(folder)));
});
