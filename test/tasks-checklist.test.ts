import { test } from "node:test";
import assert from "node:assert/strict";
import { isHandoffComment, parseChecklistBody } from "../src/lib/tasks-checklist.ts";

const base = {
  source: "issue" as const,
  listId: "issue:42",
  repo: "demo-repo",
  branch: "cursor/42-login",
  issue: 42,
  updatedAt: "2026-01-20T00:00:00Z",
};

test("Acceptance criteria and Remaining work count; Reuse check does not", () => {
  const body = `
## Summary
- [ ] ignored outside

## Acceptance criteria
- [ ] First criterion
- [x] Second criterion
  - [ ] Nested pending

## Reuse check
- [ ] Do not count

## Remaining work
- [ ] Still open

## Other
- [ ] also ignored
`;
  const tasks = parseChecklistBody(body, base);
  assert.deepEqual(
    tasks.map((task) => [task.subject, task.status]),
    [
      ["First criterion", "pending"],
      ["Second criterion", "completed"],
      ["Nested pending", "pending"],
      ["Still open", "pending"],
    ],
  );
});

test("heading case does not matter", () => {
  const tasks = parseChecklistBody("## ACCEPTANCE CRITERIA\n* [ ] One\n", base);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.subject, "One");
});

test("body with no checkboxes is empty", () => {
  assert.deepEqual(parseChecklistBody("## Acceptance criteria\nNo boxes yet.", base), []);
  assert.deepEqual(parseChecklistBody(null, base), []);
});

test("handoff comment detection", () => {
  assert.equal(isHandoffComment("## Handoff\n\n## Remaining work\n- [ ] ship"), true);
  assert.equal(isHandoffComment("Just a comment"), false);
});
