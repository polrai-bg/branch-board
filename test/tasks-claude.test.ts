// Fixture paths only. Never reads the real home folder or branchboard.config.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  buildPathToRepo,
  collectClaudeTasks,
  isSessionListId,
  parseTaskFile,
  parseTranscriptTail,
  type ClaudeFs,
} from "../src/lib/tasks-claude.ts";

const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function memoryFs(files: Record<string, string>, dirs: Record<string, string[]>): ClaudeFs {
  return {
    exists: (path) => path in files || path in dirs,
    listDir: (path) => dirs[path] ?? [],
    readText: (path) => {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path]!;
    },
    readTail: (path, bytes) => {
      const text = files[path];
      if (text == null) throw new Error(`missing ${path}`);
      return text.slice(Math.max(0, text.length - bytes));
    },
    mtimeMs: () => 1,
    realpath: (path) => path,
  };
}

test("session id recognition", () => {
  assert.equal(isSessionListId(SESSION), true);
  assert.equal(isSessionListId("feature-auth"), false);
});

test("task file requires id, subject, status and ignores unknown fields", () => {
  const ok = parseTaskFile(JSON.stringify({ id: 1, subject: "Run tests", status: "in_progress", activeForm: "Running tests", extra: true }), "1.json");
  assert.equal(ok.error, null);
  assert.equal(ok.task?.id, "1");
  assert.equal(ok.task?.activeForm, "Running tests");

  const bad = parseTaskFile("{", "bad.json");
  assert.match(bad.error ?? "", /Bad JSON/);
});

test("transcript tail: last cwd and gitBranch win (moved into a worktree)", () => {
  const lines = [
    JSON.stringify({ type: "user", cwd: "/tmp/demo-checkout", gitBranch: "main" }),
    JSON.stringify({ type: "assistant", cwd: "/tmp/demo-checkout/.claude/worktrees/w1", gitBranch: "claude/42-auth" }),
  ].join("\n");
  const ctx = parseTranscriptTail(lines);
  assert.equal(ctx.cwd, "/tmp/demo-checkout/.claude/worktrees/w1");
  assert.equal(ctx.gitBranch, "claude/42-auth");
});

test("transcript with no gitBranch keeps branch null", () => {
  const ctx = parseTranscriptTail(JSON.stringify({ type: "user", cwd: "/tmp/demo-checkout" }));
  assert.equal(ctx.cwd, "/tmp/demo-checkout");
  assert.equal(ctx.gitBranch, null);
});

test("collect: worktree session, named list, bad JSON, deleted worktree, completed list hidden", () => {
  const root = "/tmp/bb-claude";
  const tasksRoot = join(root, "tasks");
  const projects = join(root, "projects");
  const sessionDir = join(tasksRoot, SESSION);
  const namedDir = join(tasksRoot, "feature-auth");
  const doneDir = join(tasksRoot, "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");
  const projectSlug = join(projects, "-tmp-demo-checkout");

  const files: Record<string, string> = {
    [join(sessionDir, "1.json")]: JSON.stringify({ id: "1", subject: "Wire board", status: "pending" }),
    [join(sessionDir, "2.json")]: JSON.stringify({ id: "2", subject: "Run tests", status: "in_progress", activeForm: "Running tests" }),
    [join(sessionDir, "bad.json")]: "{not-json",
    [join(namedDir, "1.json")]: JSON.stringify({ id: "1", subject: "Shared item", status: "pending" }),
    [join(doneDir, "1.json")]: JSON.stringify({ id: "1", subject: "Finished", status: "completed" }),
    [join(projectSlug, `${SESSION}.jsonl`)]: [
      JSON.stringify({ cwd: "/tmp/demo-checkout", gitBranch: "main" }),
      JSON.stringify({ cwd: "/tmp/demo-checkout/.claude/worktrees/w1", gitBranch: "claude/42-auth" }),
    ].join("\n"),
    [join(projectSlug, "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl")]: JSON.stringify({
      cwd: "/tmp/demo-checkout",
      gitBranch: "main",
    }),
  };

  const dirs: Record<string, string[]> = {
    [tasksRoot]: [SESSION, "feature-auth", "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", ".lock"],
    [sessionDir]: ["1.json", "2.json", "bad.json"],
    [namedDir]: ["1.json"],
    [doneDir]: ["1.json"],
    [projects]: ["-tmp-demo-checkout"],
    [projectSlug]: [`${SESSION}.jsonl`, "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"],
  };

  const pathToRepo = buildPathToRepo(
    [{ name: "demo-repo", localPath: "/tmp/demo-checkout" }],
    [{ repo: "demo-repo", path: "/tmp/demo-checkout/.claude/worktrees/w1" }],
    (path) => path,
  );

  const scan = collectClaudeTasks({
    claudeConfigDir: root,
    taskLists: [],
    pathToRepo,
    fs: memoryFs(files, dirs),
  });

  assert.ok(scan.errors.some((message) => /Bad JSON/.test(message)));
  const subjects = scan.tasks.map((task) => task.subject).sort();
  assert.deepEqual(subjects, ["Run tests", "Shared item", "Wire board"]);

  const wired = scan.tasks.filter((task) => task.subject === "Wire board")[0]!;
  assert.equal(wired.repo, "demo-repo");
  assert.equal(wired.branch, "claude/42-auth");

  const shared = scan.tasks.find((task) => task.subject === "Shared item")!;
  assert.equal(shared.repo, null);
  assert.equal(shared.branch, null);

  // Named list with a taskLists override ties to the named row.
  const bound = collectClaudeTasks({
    claudeConfigDir: root,
    taskLists: [{ list: "feature-auth", repo: "demo-repo", branch: "claude/42-auth" }],
    pathToRepo,
    fs: memoryFs(files, dirs),
  });
  const boundShared = bound.tasks.find((task) => task.subject === "Shared item")!;
  assert.equal(boundShared.repo, "demo-repo");
  assert.equal(boundShared.branch, "claude/42-auth");

  // Deleted worktree: path no longer in git worktree list, but cwd is still under localPath.
  const gone = collectClaudeTasks({
    claudeConfigDir: root,
    taskLists: [],
    pathToRepo: buildPathToRepo([{ name: "demo-repo", localPath: "/tmp/demo-checkout" }], [], (path) => path),
    fs: memoryFs(files, dirs),
  });
  const kept = gone.tasks.find((task) => task.subject === "Wire board")!;
  assert.equal(kept.repo, "demo-repo");
  assert.equal(kept.branch, "claude/42-auth");
});

test("deleted worktree still matches via prefix under localPath when pathToRepo has the worktree path", () => {
  // AC: repo matched but branch not in snapshot — collector still emits repo+branch.
  const root = "/tmp/bb-claude-gone";
  const tasksRoot = join(root, "tasks");
  const sessionDir = join(tasksRoot, SESSION);
  const projectSlug = join(root, "projects", "slug");
  const files: Record<string, string> = {
    [join(sessionDir, "1.json")]: JSON.stringify({ id: "1", subject: "Keep me", status: "pending" }),
    [join(projectSlug, `${SESSION}.jsonl`)]: JSON.stringify({
      cwd: "/tmp/demo-checkout/.claude/worktrees/deleted",
      gitBranch: "claude/99-gone",
    }),
  };
  const dirs: Record<string, string[]> = {
    [tasksRoot]: [SESSION],
    [sessionDir]: ["1.json"],
    [join(root, "projects")]: ["slug"],
    [projectSlug]: [`${SESSION}.jsonl`],
  };
  const pathToRepo = new Map([
    ["/tmp/demo-checkout", "demo-repo"],
    ["/tmp/demo-checkout/.claude/worktrees/deleted", "demo-repo"],
  ]);
  const scan = collectClaudeTasks({
    claudeConfigDir: root,
    taskLists: [],
    pathToRepo,
    fs: memoryFs(files, dirs),
  });
  assert.equal(scan.tasks[0]?.repo, "demo-repo");
  assert.equal(scan.tasks[0]?.branch, "claude/99-gone");
});
