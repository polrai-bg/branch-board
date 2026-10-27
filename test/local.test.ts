import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRows, type RemoteBranch } from "../src/lib/merge.ts";
import { collectLocal, gitEnv, liveWorktrees, parseWorktrees, type GitRunner } from "../src/lib/local.ts";
import type { Config } from "../src/lib/config.ts";

const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, env });
}

const cfg: Config = {
  github: { owner: "example-owner" },
  repos: [{ name: "demo-repo", localPath: null, bases: ["main"] }],
  agents: [],
  branchOverrides: [],
  exemptPrefixes: [],
  issuePattern: "^(?:[^/]+/)?(\\d+)-",
  refreshMinutes: 2,
  staleDays: 7,
  stalledReviewDays: 3,
  hideMergedByDefault: true,
};

test("worktree parser skips prunable and missing folders", () => {
  const porcelain = ["worktree /tmp/bb-main", "HEAD abc", "branch refs/heads/main", "", "worktree /tmp/bb-gone", "HEAD def", "branch refs/heads/old", "prunable gitdir file points to non-existent location", "", "worktree /tmp/bb-missing", "HEAD 111", "detached", ""].join("\n");
  const trees = parseWorktrees(porcelain);
  assert.equal(trees.length, 3);
  assert.equal(trees[1].prunable, true);
  const live = liveWorktrees(trees, (path) => path === "/tmp/bb-main");
  assert.deepEqual(live.map((tree) => tree.path), ["/tmp/bb-main"]);
});

test("missing local folder names the folder", async () => {
  const missing = join(tmpdir(), "bb-missing-folder-does-not-exist");
  const scan = await collectLocal("demo-repo", missing, ["main"]);
  assert.equal(scan.records.length, 0);
  assert.ok(scan.error?.includes(missing));
});

test("a timed-out fetch is reported and the local branch is still collected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-fake-git-"));
  const gitRunner: GitRunner = async (args) => {
    if (args[0] === "fetch") return { code: 1, stdout: "", stderr: "", timedOut: true };
    if (args[0] === "for-each-ref" && args.at(-1) === "refs/heads") {
      return { code: 0, stdout: ["feature-x", "abc123", "", "2026-01-01T00:00:00Z", "Test", "work #4"].join("\x1f") + "\n", stderr: "", timedOut: false };
    }
    if (args[0] === "rev-parse" && args.at(-1) === "refs/heads/main") return { code: 0, stdout: "def\n", stderr: "", timedOut: false };
    if (args[0] === "rev-list") return { code: 0, stdout: "0\t2\n", stderr: "", timedOut: false };
    if (args[0] === "merge-base") return { code: 0, stdout: "def\n", stderr: "", timedOut: false };
    return { code: args[0] === "rev-parse" ? 1 : 0, stdout: "", stderr: "", timedOut: false };
  };
  try {
    const scan = await collectLocal("demo-repo", dir, ["main"], gitRunner);
    assert.match(scan.error ?? "", /timed out/);
    assert.equal(scan.records[0]?.name, "feature-x");
    assert.equal(scan.records[0]?.neverPushed, true);
    assert.equal(scan.records[0]?.compare?.ahead, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local git: never pushed, dirty, detached, and unpushed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-local-"));
  try {
    const repo = join(dir, "repo");
    await mkdir(repo);
    git(repo, ["init", "-b", "main"]);
    await writeFile(join(repo, "a.txt"), "a\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-m", "init"]);

    git(repo, ["switch", "-c", "local-only"]);
    await writeFile(join(repo, "b.txt"), "b\n");
    git(repo, ["add", "b.txt"]);
    git(repo, ["commit", "-m", "local only work"]);

    git(repo, ["switch", "-c", "feature-x"]);
    await writeFile(join(repo, "a.txt"), "dirty\n");

    const detached = join(dir, "detached");
    git(repo, ["worktree", "add", "--detach", detached, "HEAD"]);
    await writeFile(join(detached, "w.txt"), "w\n");

    const clean = join(dir, "clean");
    git(repo, ["worktree", "add", "--detach", clean, "main"]);

    const off = join(dir, "off");
    git(repo, ["worktree", "add", "--detach", off, "HEAD"]);
    git(off, ["commit", "--allow-empty", "-m", "off branch"]);

    const scan = await collectLocal("demo-repo", repo, ["main"]);
    assert.ok(scan.error?.includes(repo), scan.error ?? "expected a fetch error");
    const feature = scan.records.find((record) => record.name === "feature-x");
    const only = scan.records.find((record) => record.name === "local-only");
    // Git stores the resolved path. On macOS that is /private/var, not the /var symlink from tmpdir().
    const detachedPath = realpathSync(detached);
    const offPath = realpathSync(off);
    const cleanPath = realpathSync(clean);
    assert.equal(feature?.dirty, true);
    assert.equal(feature?.neverPushed, true);
    assert.equal(only?.neverPushed, true);
    assert.equal(only?.dirty, false);
    assert.ok((only?.compare?.ahead ?? 0) >= 1);
    assert.ok(scan.records.some((record) => record.detached && record.dirty && record.localPath === detachedPath));
    assert.ok(scan.records.some((record) => record.detached && record.offBranch && record.localPath === offPath));
    assert.equal(scan.records.some((record) => record.localPath === cleanPath), false);

    const rows = buildRows(cfg, [], Date.parse("2026-10-25T00:00:00Z"), scan.records, []);
    assert.equal(rows.find((row) => row.name === "feature-x")?.status, "Unsaved");
    assert.equal(rows.find((row) => row.name === "local-only")?.status, "Local only");
    assert.equal(rows.find((row) => row.localPath === detachedPath)?.status, "Unsaved");
    assert.ok(rows.find((row) => row.localPath === detachedPath)?.flags.includes("Orphan"));
    assert.equal(rows.find((row) => row.localPath === offPath)?.status, "WIP");

    const origin = join(dir, "origin.git");
    const clone = join(dir, "clone");
    git(dir, ["clone", "--bare", repo, origin]);
    git(dir, ["clone", origin, clone]);
    git(clone, ["switch", "-c", "synced"]);
    await writeFile(join(clone, "c.txt"), "c\n");
    git(clone, ["add", "c.txt"]);
    git(clone, ["commit", "-m", "synced"]);
    git(clone, ["push", "-u", "origin", "synced"]);
    git(clone, ["switch", "-c", "ahead"]);
    await writeFile(join(clone, "d.txt"), "d\n");
    git(clone, ["add", "d.txt"]);
    git(clone, ["commit", "-m", "pushed"]);
    git(clone, ["push", "-u", "origin", "ahead"]);
    await writeFile(join(clone, "d.txt"), "more\n");
    git(clone, ["add", "d.txt"]);
    git(clone, ["commit", "-m", "not pushed"]);

    const pushed = await collectLocal("demo-repo", clone, ["main"]);
    assert.equal(pushed.error, null, pushed.error ?? "");
    assert.equal(pushed.records.find((record) => record.name === "ahead")?.unpushed, 1);
    assert.equal(pushed.records.find((record) => record.name === "ahead")?.neverPushed, false);
    assert.equal(pushed.records.find((record) => record.name === "synced")?.unpushed, 0);

    const remote: RemoteBranch = {
      repo: "demo-repo",
      name: "ahead",
      sha: "old",
      committedDate: "2026-01-01T00:00:00Z",
      message: "pushed",
      authorLogin: null,
      authorName: null,
      prs: [],
      compare: { base: "main", ahead: 2, behind: 0, mergeBase: "m" },
      baseGuessed: true,
    };
    const joined = buildRows(cfg, [remote], Date.parse("2026-10-25T00:00:00Z"), pushed.records, []);
    assert.equal(joined.find((row) => row.name === "ahead")?.status, "Unpushed");
    assert.equal(joined.find((row) => row.name === "ahead")?.where, "Both");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("configured bases are collected and not compared", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-bases-"));
  const calls: string[][] = [];
  const row = (name: string) => [name, "abc", "", "2026-01-01T00:00:00Z", "Test", "init"].join("\x1f");
  const gitRunner: GitRunner = async (args) => {
    calls.push(args);
    if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "", timedOut: false };
    if (args[0] === "for-each-ref" && args.at(-1) === "refs/heads") {
      return { code: 0, stdout: `${row("main")}\n${row("development")}\n${row("feature-x")}\n`, stderr: "", timedOut: false };
    }
    if (args[0] === "rev-list" && args[1] === "--left-right") return { code: 0, stdout: "0\t4\n", stderr: "", timedOut: false };
    if (args[0] === "merge-base") return { code: 0, stdout: "abc\n", stderr: "", timedOut: false };
    if (args[0] === "rev-parse" && String(args.at(-1)).startsWith("refs/remotes/")) return { code: 1, stdout: "", stderr: "", timedOut: false };
    if (args[0] === "rev-parse") return { code: 0, stdout: "abc\n", stderr: "", timedOut: false };
    if (args[0] === "worktree") return { code: 0, stdout: "", stderr: "", timedOut: false };
    if (args[0] === "log") return { code: 0, stdout: "init\n", stderr: "", timedOut: false };
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  };
  try {
    const scan = await collectLocal("demo-repo", dir, ["main", "development"], gitRunner);
    const main = scan.records.find((record) => record.name === "main");
    const development = scan.records.find((record) => record.name === "development");
    const feature = scan.records.find((record) => record.name === "feature-x");
    assert.equal(main?.compare, null);
    assert.equal(development?.compare, null);
    assert.equal(main?.baseGuessed, false);
    assert.equal(development?.baseGuessed, false);
    assert.equal(feature?.compare?.ahead, 4);
    assert.equal(feature?.baseGuessed, true);
    const heads = calls
      .filter((args) => args[0] === "rev-list" && args[1] === "--left-right")
      .map((args) => args.find((arg) => arg.includes("..."))?.split("...")[1]);
    assert.equal(heads.includes("refs/heads/main"), false);
    assert.equal(heads.includes("refs/heads/development"), false);
    const rows = buildRows(cfg, [], Date.parse("2026-10-25T00:00:00Z"), scan.records, []);
    assert.equal(rows.find((row) => row.name === "main")?.status, "Base");
    assert.deepEqual(rows.find((row) => row.name === "main")?.flags, []);
    assert.equal(rows.find((row) => row.name === "main")?.compare, null);
    assert.notEqual(rows.find((row) => row.name === "development")?.status, "Base");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git never sees the board's GitHub token", () => {
  const env = gitEnv({ PATH: "/usr/bin", HOME: "/home/demo", GITHUB_TOKEN: "board-token", GH_TOKEN: "other-token" } as unknown as NodeJS.ProcessEnv);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/demo");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
});
