// Fixture names are made up. Tests never read the real config.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../src/lib/config.ts";
import {
  DEFAULT_ISSUE_PATTERN,
  buildRows,
  countsByRepo,
  detectAgent,
  linkIssue,
  pickBase,
  sectionOf,
  STATUS_ORDER,
  statusOf,
  summaryCounts,
  UNFINISHED_STATUSES,
  type IssueInfo,
  type LocalRecord,
  type PR,
  type RemoteBranch,
  type StatusInput,
} from "../src/lib/merge.ts";

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
    { repo: "demo-repo", branch: "override-issue", issue: 5 },
  ],
  exemptPrefixes: ["sync-"],
  issuePattern: DEFAULT_ISSUE_PATTERN,
  refreshMinutes: 2,
  staleDays: 7,
  stalledReviewDays: 3,
  hideMergedByDefault: true,
};

const NOW = Date.parse("2026-01-20T00:00:00Z");
const pr = (state: PR["state"], mergeable: PR["mergeable"] = "MERGEABLE", extra: Partial<PR> = {}): PR => ({
  number: 1,
  url: "u",
  state,
  mergeable,
  baseRefName: "main",
  updatedAt: "2026-01-19T00:00:00Z",
  closingIssues: [],
  ...extra,
});

function branch(p: Partial<RemoteBranch & StatusInput> & { ahead?: number | null }): RemoteBranch & StatusInput {
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
    compare: ahead == null ? null : { base: "main", ahead, behind: 0, mergeBase: "def" },
    baseGuessed: true,
    ...rest,
  };
}

function local(p: Partial<LocalRecord> = {}): LocalRecord {
  return {
    repo: "demo-repo",
    name: "feature-x",
    sha: "abc",
    committedDate: "2026-01-19T00:00:00Z",
    message: "work",
    authorName: null,
    dirty: false,
    unpushed: 0,
    neverPushed: false,
    detached: false,
    offBranch: false,
    localPath: "/tmp/demo-checkout",
    compare: { base: "main", ahead: 2, behind: 0, mergeBase: "def" },
    baseGuessed: true,
    ...p,
  };
}

test("status rules, first match wins", () => {
  assert.equal(statusOf(branch({ prs: [pr("MERGED")], ahead: 3, dirty: true, unpushed: 4 })), "Merged", "merged-with-dirty-copy");
  assert.equal(statusOf(branch({ prs: [pr("CLOSED")], ahead: 0 })), "Merged", "closed PR with commits in base");
  assert.equal(statusOf(branch({ prs: [pr("OPEN", "CONFLICTING")], dirty: true })), "Conflicts");
  assert.equal(statusOf(branch({ prs: [pr("OPEN")], unpushed: 2 })), "Open PR", "open-PR-with-unpushed");
  assert.equal(statusOf(branch({ prs: [pr("OPEN")], ahead: 0, unpushed: 2 })), "Open PR", "unpushed commits are not in the base");
  assert.equal(statusOf(branch({ prs: [pr("OPEN", "UNKNOWN")] })), "Open PR");
  assert.equal(statusOf(branch({ dirty: true, unpushed: 3, neverPushed: true })), "Unsaved", "dirty-and-unpushed");
  assert.equal(statusOf(branch({ unpushed: 2 })), "Unpushed");
  assert.equal(statusOf(branch({ ahead: 4, neverPushed: true })), "Local only", "never-pushed-with-commits");
  assert.equal(statusOf(branch({ prs: [pr("CLOSED")], ahead: 2 })), "WIP");
  assert.equal(statusOf(branch({ ahead: 4 })), "WIP");
  assert.equal(statusOf(branch({ ahead: 0 })), "Empty");
  assert.equal(statusOf(branch({ ahead: null, prs: [pr("OPEN")] })), "Open PR", "deleted PR base leaves no counts");
  assert.equal(statusOf({ prs: [], compare: null, detached: true, offBranch: true }), "WIP");
});

test("agent detection: override, prefix, co-author trailer, author login, unknown", () => {
  const detected = (name: string, extra: Partial<RemoteBranch> = {}) => detectAgent(cfg, branch({ name, ...extra }));
  assert.equal(detected("mystery-branch"), "Me");
  assert.equal(detected("cursor/fix-1a2b"), "Cursor");
  assert.equal(detected("ccr-abc123"), "Claude (cloud)");
  assert.equal(detected("tweak", { message: "x\n\nCo-Authored-By: Claude Opus <noreply@example.com>" }), "Claude");
  assert.equal(detected("tweak", { authorName: "github-actions[bot]" }), "GitHub Actions");
  assert.equal(detected("tweak"), "Unknown");
});

test("pickBase prefers fewest commits ahead, ties keep config order", () => {
  const comparison = (base: string, ahead: number) => ({ base, ahead, behind: 0, mergeBase: null });
  assert.equal(pickBase([comparison("main", 9), comparison("development", 2)])?.base, "development");
  assert.equal(pickBase([comparison("main", 2), comparison("development", 2)])?.base, "main");
  assert.equal(pickBase([]), null);
});

test("issue linking order: override, closing reference, branch name, commit message, none", () => {
  const linked = (name: string, extra: Partial<RemoteBranch> = {}) => linkIssue(cfg, branch({ name, ...extra }));
  assert.equal(linked("override-issue", { prs: [pr("OPEN", "MERGEABLE", { closingIssues: [{ number: 9, nameWithOwner: "example-owner/demo-repo" }] })], message: "fix #8" }), 5);
  assert.equal(linked("cursor/1-other", { prs: [pr("OPEN", "MERGEABLE", { closingIssues: [{ number: 9, nameWithOwner: "example-owner/demo-repo" }] })], message: "fix #8" }), 9);
  assert.equal(linked("cursor/1-other", { prs: [pr("OPEN", "MERGEABLE", { closingIssues: [{ number: 9, nameWithOwner: "other-owner/elsewhere" }] })], message: "fix #8" }), 1, "cross-repo closing ref falls through");
  assert.equal(linked("cursor/42-a1-slug", { message: "fix #8" }), 42);
  assert.equal(linked("feature-x", { message: "fix #8 in the subject" }), 8);
  assert.equal(linked("feature-x", { message: "no reference" }), null);
});

test("commit message links only when the branch has commits of its own", () => {
  const linked = (extra: Parameters<typeof branch>[0]) => linkIssue(cfg, branch({ name: "cursor/new-idea", ...extra }));
  // An untouched branch's tip is the base's squash or merge commit.
  assert.equal(linked({ ahead: 0, message: "Add consent banner (#21)" }), null);
  assert.equal(linked({ ahead: 0, message: "Merge pull request #5 from example-owner/feature" }), null);
  assert.equal(linked({ ahead: null, message: "fix #8" }), null, "no comparison means unknown, so no message link");
  assert.equal(linked({ ahead: 2, message: "fix #8" }), 8);
  assert.equal(linked({ ahead: 0, unpushed: 1, message: "fix #8" }), 8, "unpushed commits are the branch's own");
  assert.equal(linked({ ahead: 3, neverPushed: true, message: "fix #8" }), 8);
  assert.equal(linked({ ahead: null, detached: true, offBranch: true, message: "fix #8" }), 8);
  assert.equal(linked({ ahead: null, detached: true, offBranch: false, dirty: true, message: "fix #8" }), null);
  // Overrides, closing references, and branch names still link untouched branches.
  assert.equal(linkIssue(cfg, branch({ name: "cursor/42-slug", ahead: 0, message: "Title (#21)" })), 42);

  const [row] = buildRows(cfg, [branch({ name: "cursor/new-idea", ahead: 0, message: "Add consent banner (#21)" })], NOW);
  assert.equal(row.status, "Empty");
  assert.equal(row.issue, null);
  assert.ok(row.flags.includes("Orphan"));
});

test("flag rules", () => {
  const issues: IssueInfo[] = [
    { repo: "demo-repo", number: 3, title: "Three", state: "OPEN" },
    { repo: "demo-repo", number: 4, title: "Four", state: "CLOSED" },
    { repo: "other-repo", number: 3, title: "Other three", state: "OPEN" },
  ];
  const rows = buildRows(
    cfg,
    [
      branch({ name: "sync-daily", message: "bot" }),
      branch({ name: "cursor/3-one" }),
      branch({ name: "cursor/3-two" }),
      branch({ name: "cursor/7-a1-one" }),
      branch({ name: "cursor/7-a2-two" }),
      branch({ name: "cursor/3-elsewhere", repo: "other-repo" }),
      branch({ name: "cursor/4-closed" }),
      branch({ name: "merged-clean", prs: [pr("MERGED")], message: "no issue" }),
      branch({ name: "merged-closed", prs: [pr("MERGED")], message: "fix #4" }),
      branch({
        name: "cursor/11-stalled",
        prs: [pr("OPEN", "MERGEABLE", { updatedAt: "2026-01-01T00:00:00Z" })],
        committedDate: "2026-01-01T00:00:00Z",
      }),
      branch({ name: "old-tracked", committedDate: "2026-01-01T00:00:00Z", message: "fix #3" }),
    ],
    NOW,
    [],
    issues,
  );
  const flags = (name: string) => rows.find((row) => row.name === name)?.flags;
  assert.deepEqual(flags("sync-daily"), [], "exempt prefix is not Orphan");
  assert.ok(flags("cursor/3-one")?.includes("Overlap"));
  assert.ok(flags("cursor/3-two")?.includes("Overlap"), "two branches on one issue without attempt IDs");
  assert.equal(flags("cursor/7-a1-one")?.includes("Overlap"), false, "distinct attempt IDs are not Overlap");
  assert.equal(flags("cursor/7-a2-two")?.includes("Overlap"), false);
  assert.equal(flags("cursor/3-elsewhere")?.includes("Overlap"), false, "same issue number in another repo");
  assert.ok(flags("cursor/4-closed")?.includes("Issue closed"));
  assert.equal(flags("merged-clean")?.includes("Orphan"), false, "a merged branch gets no Orphan");
  assert.equal(flags("merged-closed")?.includes("Issue closed"), false, "a merged branch gets no Issue closed");
  assert.ok(flags("cursor/11-stalled")?.includes("Stalled review"));
  assert.ok(flags("old-tracked")?.includes("Stale"));
  assert.equal(flags("old-tracked")?.includes("Orphan"), false);
});

test("buildRows joins local status, where, and sort", () => {
  const rows = buildRows(
    cfg,
    [
      branch({ name: "merged-one", prs: [pr("MERGED")] }),
      branch({ name: "hand-squashed" }),
      branch({ name: "fresh-wip", message: "fix #3" }),
      branch({ name: "old-wip", committedDate: "2026-01-01T00:00:00Z" }),
      branch({ name: "conflicted", prs: [pr("OPEN", "CONFLICTING")] }),
      branch({ name: "empty-one", ahead: 0, message: "fix #30" }),
      branch({ name: "open-stalled", prs: [pr("OPEN", "MERGEABLE", { updatedAt: "2026-01-01T00:00:00Z" })], committedDate: "2026-01-01T00:00:00Z", message: "fix #11" }),
      branch({ name: "open-fresh", prs: [pr("OPEN")], message: "fix #12" }),
    ],
    NOW,
    [
      local({ name: "dirty-local", dirty: true, neverPushed: true, committedDate: "2026-01-18T00:00:00Z" }),
      local({ name: "ahead", unpushed: 1, neverPushed: false, committedDate: "2026-01-17T00:00:00Z" }),
      local({ name: "open-fresh", unpushed: 4, dirty: true, message: "fix #12" }),
      local({ name: "only-local", neverPushed: true, dirty: false, committedDate: "2026-01-16T00:00:00Z", compare: { base: "main", ahead: 3, behind: 1, mergeBase: "m" } }),
      local({ name: "detached-wt", detached: true, dirty: true, offBranch: false, localPath: "/tmp/demo-detached", committedDate: "2026-01-15T00:00:00Z" }),
    ],
    [{ repo: "demo-repo", number: 3, title: "Three", state: "OPEN" }],
  );
  assert.equal(rows.find((row) => row.name === "hand-squashed"), undefined);
  assert.equal(rows.find((row) => row.name === "open-fresh")?.status, "Open PR");
  assert.equal(rows.find((row) => row.name === "open-fresh")?.where, "Both");
  assert.equal(rows.find((row) => row.name === "dirty-local")?.status, "Unsaved");
  assert.equal(rows.find((row) => row.name === "ahead")?.status, "Unpushed");
  assert.equal(rows.find((row) => row.name === "only-local")?.status, "Local only");
  assert.equal(rows.find((row) => row.name === "only-local")?.where, "Local");
  assert.equal(rows.find((row) => row.name === "detached-wt")?.status, "Unsaved");
  assert.ok(rows.find((row) => row.name === "detached-wt")?.flags.includes("Orphan"));
  assert.equal(rows.find((row) => row.name === "old-wip")?.stale, true);
  assert.equal(rows.find((row) => row.name === "fresh-wip")?.issue?.number, 3);
  assert.equal(rows.find((row) => row.name === "fresh-wip")?.issue?.title, "Three");
  assert.deepEqual(
    rows.map((row) => row.name),
    ["conflicted", "detached-wt", "only-local", "ahead", "dirty-local", "old-wip", "empty-one", "open-stalled", "fresh-wip", "open-fresh", "merged-one"],
  );
  // No commits of its own, so its tip message ("fix #30") is a base commit and does not link it.
  assert.equal(rows.find((row) => row.name === "empty-one")?.issue, null);
  assert.ok(rows.find((row) => row.name === "empty-one")?.flags.includes("Orphan"));
  const totals = summaryCounts(rows);
  const stored = countsByRepo(rows, ["demo-repo"]);
  for (const metric of ["Orphan", "Overlap", "Stalled review", "Stale", "Issue closed", "Unfinished local", "Empty"] as const) {
    assert.equal(stored.find((entry) => entry.metric === metric)?.count, totals[metric], metric);
  }
});

test("buildRows: ignore, stale flag, and action sort", () => {
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
    rows.map((row) => row.name),
    ["conflicted", "old-wip", "empty-one", "fresh-wip", "merged-one"],
  );
  assert.equal(rows.find((row) => row.name === "old-wip")?.stale, true);
  assert.equal(rows.find((row) => row.name === "fresh-wip")?.stale, false);
  assert.equal(rows.find((row) => row.name === "conflicted")?.where, "GitHub");
});

test("a configured base is Base, has no flags, and sorts after Merged", () => {
  const mixed: Config = {
    ...cfg,
    repos: [
      { name: "demo-repo", localPath: null, bases: ["main", "development"] },
      { name: "side-repo", localPath: null, bases: ["main"] },
    ],
  };
  const rows = buildRows(
    mixed,
    [
      branch({ name: "merged-one", prs: [pr("MERGED")] }),
      branch({
        name: "main",
        message: "Add consent banner (#21)",
        prs: [pr("MERGED")],
        compare: { base: "main", ahead: 0, behind: 0, mergeBase: "abc" },
        baseGuessed: true,
      }),
      branch({ name: "development", message: "Merge pull request #5" }),
      branch({ name: "feature-x", message: "fix #3" }),
      branch({ repo: "side-repo", name: "development", ahead: 0, message: "Title (#21)" }),
      branch({ repo: "side-repo", name: "main", ahead: 0, message: "init (#4)" }),
    ],
    NOW,
    [
      local({
        name: "main",
        dirty: true,
        neverPushed: true,
        localPath: "/tmp/demo-main",
        compare: { base: "development", ahead: 3, behind: 1, mergeBase: "m" },
        baseGuessed: true,
      }),
    ],
    [
      { repo: "demo-repo", number: 3, title: "Three", state: "OPEN" },
      { repo: "demo-repo", number: 21, title: "Consent", state: "CLOSED" },
    ],
  );

  const main = rows.find((row) => row.repo === "demo-repo" && row.name === "main");
  assert.ok(main);
  assert.equal(main.status, "Base");
  assert.deepEqual(main.flags, []);
  assert.equal(main.compare, null);
  assert.equal(main.baseGuessed, false);
  assert.equal(main.where, "Both");
  assert.equal(main.localPath, "/tmp/demo-main");
  assert.equal(main.pr?.state, "MERGED");
  assert.equal(main.issue, null);
  assert.equal(sectionOf(main), "Bases");
  assert.equal(UNFINISHED_STATUSES.includes(main.status), false);

  const development = rows.find((row) => row.repo === "demo-repo" && row.name === "development");
  assert.equal(development?.status, "Base");
  assert.deepEqual(development?.flags, []);
  assert.equal(development?.compare, null);
  assert.equal(development?.baseGuessed, false);
  assert.equal(sectionOf(development!), "Bases");

  const sideMain = rows.find((row) => row.repo === "side-repo" && row.name === "main");
  assert.equal(sideMain?.status, "Base");
  assert.deepEqual(sideMain?.flags, []);
  assert.equal(sectionOf(sideMain!), "Bases");

  const sideDevelopment = rows.find((row) => row.repo === "side-repo" && row.name === "development");
  assert.equal(sideDevelopment?.status, "Empty", "a branch is Base only when its own repo lists that name");
  assert.ok(sideDevelopment?.flags.includes("Orphan"));
  assert.equal(sectionOf(sideDevelopment!), "No issue");

  const demo = rows.filter((row) => row.repo === "demo-repo").map((row) => row.name);
  assert.deepEqual(demo, ["feature-x", "merged-one", "development", "main"]);
  assert.ok(demo.indexOf("merged-one") < demo.indexOf("development"));
  assert.ok(demo.indexOf("merged-one") < demo.indexOf("main"));
  assert.equal(STATUS_ORDER.at(-1), "Base");

  const localOnly = buildRows(
    cfg,
    [],
    NOW,
    [local({ name: "main", dirty: true, neverPushed: true, compare: { base: "main", ahead: 0, behind: 0, mergeBase: "m" }, baseGuessed: true })],
  );
  assert.equal(localOnly[0]?.status, "Base");
  assert.equal(localOnly[0]?.where, "Local");
  assert.equal(localOnly[0]?.compare, null);
  assert.equal(localOnly[0]?.baseGuessed, false);
  assert.deepEqual(localOnly[0]?.flags, []);
  assert.equal(sectionOf(localOnly[0]!), "Bases");
});
