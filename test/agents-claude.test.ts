// Fixture JSON only. Never runs the real `claude` binary.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bindAgentSessions,
  buildPathToBranch,
  collectClaudeAgents,
  needsInput,
  normalizeAgentState,
  parseAgentsJson,
} from "../src/lib/agents-claude.ts";

test("normalizeAgentState maps live CLI values onto plan labels", () => {
  assert.equal(normalizeAgentState("busy"), "Working");
  assert.equal(normalizeAgentState("idle"), "Needs input");
  assert.equal(normalizeAgentState("failed"), "Failed");
  assert.equal(normalizeAgentState("ready_for_review"), "Ready for review");
  assert.equal(normalizeAgentState("Needs input"), "Needs input");
  assert.equal(needsInput("idle"), true);
  assert.equal(needsInput("busy"), false);
});

test("parseAgentsJson tolerates missing fields and mixed status/state keys", () => {
  const { sessions, error } = parseAgentsJson(
    JSON.stringify([
      { sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", cwd: "/tmp/demo-checkout", status: "idle", name: "Waiting" },
      { id: "bg-1", cwd: "/tmp/demo-checkout/.claude/worktrees/w1", state: "failed", name: "Background job" },
      { sessionId: "no-cwd", status: "busy" },
      { notASession: true },
    ]),
  );
  assert.equal(error, null);
  assert.equal(sessions.length, 3);
  assert.equal(sessions[0]?.state, "Needs input");
  assert.equal(sessions[0]?.summary, "Waiting");
  assert.equal(sessions[1]?.state, "Failed");
  assert.equal(sessions[1]?.sessionId, "bg-1");
  assert.equal(sessions[2]?.cwd, null);
});

test("bindAgentSessions ties cwd to repo and branch; transcript fills a missing branch", () => {
  const pathToRepo = new Map([["/tmp/demo-checkout", "demo-repo"]]);
  const pathToBranch = new Map([
    ["/tmp/demo-checkout", { repo: "demo-repo", branch: "main" }],
    ["/tmp/demo-checkout/.claude/worktrees/w1", { repo: "demo-repo", branch: "claude/42-auth" }],
  ]);
  const bound = bindAgentSessions(
    [
      {
        sessionId: "s1",
        state: "Working",
        summary: "On worktree",
        cwd: "/tmp/demo-checkout/.claude/worktrees/w1",
        prUrl: null,
        updatedAt: "2026-01-20T00:00:00Z",
      },
      {
        sessionId: "s2",
        state: "Needs input",
        summary: "On main",
        cwd: "/tmp/demo-checkout",
        prUrl: "https://github.com/example-owner/demo-repo/pull/9",
        updatedAt: "2026-01-20T00:00:00Z",
      },
    ],
    { pathToRepo, pathToBranch, claudeConfigDir: null },
  );
  assert.equal(bound[0]?.repo, "demo-repo");
  assert.equal(bound[0]?.branch, "claude/42-auth");
  assert.equal(bound[1]?.branch, "main");
  assert.equal(bound[1]?.prUrl?.includes("/pull/9"), true);
});

test("collectClaudeAgents skips when claude is missing and keeps previous on bad JSON via caller", async () => {
  const missing = await collectClaudeAgents({
    pathToRepo: new Map(),
    pathToBranch: new Map(),
    claudeConfigDir: null,
    run: async () => ({ code: 127, stdout: "", stderr: "", timedOut: false, missing: true }),
  });
  assert.equal(missing.skipped, true);
  assert.deepEqual(missing.sessions, []);

  const bad = await collectClaudeAgents({
    pathToRepo: new Map([["/tmp/demo-checkout", "demo-repo"]]),
    pathToBranch: buildPathToBranch([{ repo: "demo-repo", name: "main", localPath: "/tmp/demo-checkout" }], []),
    claudeConfigDir: null,
    run: async () => ({ code: 0, stdout: "not-json", stderr: "", timedOut: false, missing: false }),
  });
  assert.match(bad.error ?? "", /invalid JSON/);

  const ok = await collectClaudeAgents({
    pathToRepo: new Map([["/tmp/demo-checkout", "demo-repo"]]),
    pathToBranch: buildPathToBranch([{ repo: "demo-repo", name: "feature-x", localPath: "/tmp/demo-checkout" }], []),
    claudeConfigDir: null,
    run: async () => ({
      code: 0,
      stdout: JSON.stringify([{ sessionId: "s1", cwd: "/tmp/demo-checkout", status: "idle", name: "Need a decision" }]),
      stderr: "",
      timedOut: false,
      missing: false,
    }),
  });
  assert.equal(ok.error, null);
  assert.equal(ok.sessions[0]?.state, "Needs input");
  assert.equal(ok.sessions[0]?.branch, "feature-x");
});
