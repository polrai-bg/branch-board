import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localCommits, parseCommitLog } from "../src/lib/commits.ts";

const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

test("parseCommitLog splits the field record", () => {
  const parsed = parseCommitLog("abc\x1fAda\x1f2026-01-01T00:00:00Z\x1ffirst line\n");
  assert.deepEqual(parsed, [{ sha: "abc", author: "Ada", date: "2026-01-01T00:00:00Z", subject: "first line" }]);
});

test("localCommits returns the newest commits on the branch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-commits-"));
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: dir, env });
    execFileSync("git", ["commit", "--allow-empty", "-m", "one"], { cwd: dir, env });
    execFileSync("git", ["commit", "--allow-empty", "-m", "two"], { cwd: dir, env });
    const commits = await localCommits(dir, "main");
    assert.ok(commits);
    assert.equal(commits?.[0]?.subject, "two");
    assert.equal(commits?.[1]?.subject, "one");
    assert.equal(await localCommits(dir, "missing"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
