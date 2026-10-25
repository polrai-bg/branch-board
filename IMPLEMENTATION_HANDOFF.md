# Implementation Handoff

Branch Board, Phase 1: reconciliation snapshot.

You are the implementation engineer for the assignment below.

Only decisions explicitly listed under Approved Decisions are approved and authoritative. Preserve them unless implementation evidence reveals a concrete blocker, security problem, contradiction, destructive requirement, or technical impossibility. Do not implement areas blocked by decisions still requiring approval.

Use full engineering judgment for implementation details inside these boundaries. Do not reopen product strategy or redesign approved architecture merely because you prefer another approach. Read the specified source-of-truth files before modifying code. Implement the assignment, verify it against the acceptance criteria, and leave the required completion handoff.

## Objective

Brennan runs several coding agents (Claude, Cursor, Codex, Grok) that create branches on their own, in the cloud and on his Mac. He is adopting a workflow where every change is tracked by a GitHub issue. Branch Board is the local page that checks what actually exists against those issues, so he can see at a glance:

- work with no issue behind it (orphans),
- issues with more than one undeclared attempt (overlaps),
- stalled reviews,
- unfinished work that exists only on his Mac: uncommitted edits, unpushed commits, branches never pushed.

That last group is the part GitHub cannot show, and it is the main reason the board exists. Success is later measured by whether orphans and overlaps go down, so the board must also record daily counts.

## Assignment

Finish Phase 1 of the spec: the reconciliation snapshot.

1. Add a local collector that scans each configured folder on the Mac.
2. Link every branch to a GitHub issue.
3. Add the Unsaved, Unpushed, and Local only statuses and the five flags.
4. Record daily flag counts.
5. Extend the page with the new columns, chips, and filters.
6. Add fixture tests, including the named failure cases.

Work on a new branch `phase-1-reconciliation` cut from `main`. Stop when the work is committed on that branch and `IMPLEMENTATION_RESULT.md` is written. Do not merge into `main`. There is no Git remote, so do not add one or push.

## Business / User Context

- The board is read-only and runs only on `127.0.0.1`. It never writes to GitHub or to the scanned repos, apart from `git fetch --prune`.
- The repo will be public. Real owner names, repo names, and local paths live only in the git-ignored `branchboard.config.json`, and the pre-commit hook blocks any staged file that contains them. This includes the completion file you write.
- The timer refresh, `launchd` service, row expand, desktop packaging, and hosting all wait until after a 3 to 4 week evaluation. Do not build them.

## Read First

Read these before modifying code, in this order:

1. `IMPLEMENTATION_HANDOFF.md` (this file)
2. `plan/Branch Board Spec.md`. This is the full spec (revised Oct 25, 2026). It is git-ignored and exists only on Brennan's Mac. It contains private repo names: never copy names from it into tracked files. If you cannot read it, this handoff carries what you need.
3. `AGENTS.md` (the repo hygiene rule, plus a Next.js 16 note telling you to check `node_modules/next/dist/docs/` before using Next APIs)
4. `README.md`
5. `src/lib/merge.ts` (pure rules: agent detection, status, base guessing, sort)
6. `src/lib/github.ts` (GitHub collector)
7. `src/lib/refresh.ts` and `src/lib/cache.ts` (refresh orchestration and SQLite snapshot)
8. `test/merge.test.ts` (fixture style and test runner)

## Source of Truth

When sources disagree, use this precedence:

1. Brennan's direct instructions in your session
2. The hygiene rule in `AGENTS.md` (no private names, paths, or tokens in tracked files)
3. This handoff, where it explicitly resolves a spec ambiguity (marked "Clarification")
4. `plan/Branch Board Spec.md`, sections "Agent workflow" through "Build phases"
5. Existing code at commit `d5ef18f`

If the current code contradicts an approved decision here, change the code. If an approved decision cannot work against real Git or GitHub behavior, follow Escalation Conditions rather than quietly substituting a different design.

## Current System State

- **Repository:** `branch-board`, a local Git repo on Brennan's Mac. No remote is configured.
- **Branch:** `main`, with no upstream.
- **Latest commit:** `d5ef18f`, "Phase 1: GitHub branch board".
- **Working tree:** clean. This handoff file is the only uncommitted file.
- **Stack:** Next.js 16.4 (app router, Turbopack), React 19, Tailwind 4, TypeScript 7, `better-sqlite3`, Node 24. Tests use `node --test` with native TypeScript stripping (`npm test`). There is no test framework dependency.
- **Implemented baseline:**
  - The GitHub collector makes one GraphQL query per repo for branches, tip commit, and associated PRs, plus REST `compare` calls for ahead, behind, and merge base. It runs on plain `fetch`, not octokit.
  - The merger has statuses Merged, Conflicts, Open PR, WIP, and Empty, plus the Stale flag.
  - Agent detection, base guessing, and sort are in place.
  - The SQLite snapshot cache is in `.branchboard/cache.db`.
  - A 2-minute timer starts from `src/instrumentation.ts`.
  - API routes: `/api/branches` (GET) and `/api/refresh` (POST).
  - The board page has status chips, filters, and a table.
  - The app refuses to start without `branchboard.config.json`.
  - The pre-commit hook in `.githooks/` runs gitleaks and the private-value check.
- **Integration points:**
  - `RemoteBranch` and `Row` types and `buildRows` in `src/lib/merge.ts`.
  - `refresh.ts` `run()`, which assembles the snapshot.
  - `cache.ts`, which uses a one-row `snapshot` table.
  - The `Config` type in `src/lib/config.ts`.
- **Environment:**
  - The real config is present on the Mac. It lists four repos; three have a `localPath` and one is cloud-only.
  - A dev server from an earlier session may already be listening on port 3000.
  - `GITHUB_TOKEN` is not in `.env.local` yet. See Dependencies.

## Approved Decisions

### D-01: The board reconciles. It does not track work.

**Decision:** GitHub Issues, PRs, and CI hold the tracking. The board only reads them and compares them with branches and local work copies.

**Implications:**

- Read-only.
- No issue editing, no comments, no labels written.
- The board reads only issue number, title, and open or closed state.

### D-02: Status order, first match wins

**Decision:**

1. Merged
2. Open PR, conflicts (labelled `Conflicts` in code)
3. Open PR
4. Unsaved changes
5. Unpushed commits
6. Local only
7. WIP
8. Empty

**Rules:**

- **Merged:** any PR from the branch is merged, or the branch has a PR and zero commits not in its base.
- **Empty:** zero commits ahead and no PR at all. This is the existing behavior in `statusOf`. Keep it.
- **Unsaved:** a local work copy of the branch has uncommitted edits.
- **Unpushed:** a local branch has commits that are not on its GitHub branch.
- **Local only:** the branch exists locally and was never pushed.

### D-03: Five flags, which stack and sit next to the status

| Flag | Rule |
| --- | --- |
| Orphan | Not merged, no linked issue, and the branch prefix is not in `exemptPrefixes` |
| Overlap | Two or more unmerged branches in the same repo link to the same issue, and they do not each carry a distinct attempt ID |
| Stalled review | Open PR with no new commits or review activity in `stalledReviewDays` (default 3) |
| Stale | WIP with no commits in `staleDays` (default 7). This already exists |
| Issue closed | The linked issue is closed but the branch is not merged |

"Unfinished local" is a summary group, not a flag: statuses Unsaved, Unpushed, and Local only.

### D-04: Issue linking, first source that yields a number wins

1. A `branchOverrides` entry with an `issue` field. This is a Clarification: it mirrors how overrides already win for agent detection.
2. The PR's closing references (`closingIssuesReferences`, from `Closes #42`).
3. The branch name, matched by `issuePattern`. The default is the first number after the agent prefix: `cursor/42-slug` and `cursor/42-a1-slug` both give 42.
4. The newest commit message, matched by `#<number>`.

**Attempt IDs:** the attempt ID is `a<N>` right after the issue number in the branch name (`cursor/42-a1-slug`). Branches without one count as having no attempt ID.

### D-05: Local collector

**Decision:** shell out to the `git` binary from Node `child_process` for every folder in the config whose `localPath` is set.

**Per folder, the collector must:**

1. Run `git fetch --prune` first.
2. Collect local branches with their upstream (`for-each-ref`).
3. Collect worktrees (`worktree list --porcelain`). This finds work copies stored outside the repo folder, such as an agent tool's own worktree directory.
4. Collect uncommitted edits per work copy (`status --porcelain`, run inside that work copy).
5. Count unpushed commits.
6. Detect branches that were never pushed.

**Joining:** local records join remote records on repo plus branch name.

**Where column:** GitHub, Local, or Both.

### D-06: Refresh is on demand, and the existing timer stays

- Page load shows the cached snapshot at once and then triggers a refresh.
- The Refresh button triggers a refresh.
- The 2-minute timer in `instrumentation.ts` stays as it is. Keep the `refreshMinutes` config key working even though the spec's example config omits it.
- Build nothing further on the timer.

### D-07: Daily counts for measurement

- On each refresh, upsert one row per day, per repo, per metric into a new SQLite table in `.branchboard/cache.db`.
- Metrics: orphan, overlap, stalled review, stale, issue closed, unfinished local, empty.
- The last refresh of the day wins.
- Use plain SQL.
- The counts must be readable without opening SQLite by hand.

### D-08: New config keys

| Key | Meaning | Default |
| --- | --- | --- |
| `exemptPrefixes` | Branch prefixes that never get the Orphan flag | `[]` |
| `issuePattern` | Regex whose first group is the issue number | `^(?:[^/]+/)?(\d+)-` |
| `stalledReviewDays` | Days without PR activity before an open PR is flagged | 3 |
| `branchOverrides[].issue` | Issue number to link a branch to by hand | none |

- Update `branchboard.config.example.json` with these keys, using placeholder values.
- Update the real `branchboard.config.json` only by adding these keys. It is git-ignored. Do not change its repos or paths.

### D-09: Detached work copies are shown, not dropped (Clarification)

A worktree with a detached HEAD has no branch name. If it has uncommitted edits or commits not on any branch, show it as its own row, identified by its folder, with status Unsaved or WIP and the Orphan flag. A clean detached worktree at a commit already on a branch may be omitted.

## Architecture Decisions Still Requiring Approval

None block this assignment. These open spec questions are settled for now by config defaults and must not be decided in code:

- **OQ-1:** whether issue status is tracked in labels or in a GitHub Projects field. The board reads only open or closed, so this has no effect here.
- **OQ-2:** whether Grok Bot daily sync branches are auto-ignored once merged. Default: they are shown. Exemption from Orphan comes only through `exemptPrefixes`.
- **OQ-3:** the Stale and Stalled review cutoffs. Use the config defaults, 7 and 3 days.

## Architectural Guardrails

- The collectors and the rules stay independent of the UI. `merge.ts`, or any new pure-rules module, has no I/O and no imports from Next, Node `fs`, or `child_process`. It must stay unit-testable with fixtures.
- Git commands and the token run only on the server. The browser reads only `/api/branches` (plus any metrics route you add).
- Git commands must be read-only, except `git fetch --prune`. Never check out, reset, stash, commit, or delete anything in a scanned repo.
- Run `git` with `execFile` and an argument array, never through a shell. Branch names are untrusted input.
- No tracked file may contain the real owner, repo names, or local paths. That includes tests, fixtures, README, and `IMPLEMENTATION_RESULT.md`. Tests must not read the real config.
- The app still refuses to start without `branchboard.config.json`.
- Bind to `127.0.0.1` only.

## Implementation Autonomy

The approved architecture defines decision boundaries, not every line of code. Use full engineering judgment inside those boundaries.

### Implementer MAY Decide

- Module layout. A new `src/lib/local.ts` for the local collector is the expected shape, but it is not mandated.
- The exact GraphQL fields and query shape for closing references, PR activity, and issue lookup. One option is per-repo aliased `issue(number:)` lookups.
- What counts as "review activity" for Stalled review, within the D-03 rule. Examples: PR `updatedAt`, latest review time, newest commit. Record the choice in the result file.
- How unpushed commits are counted. Examples: `%(upstream:track)` or `rev-list --count`.
- How ahead, behind, and base are computed for local-only branches, provided the existing base-guessing rule is kept.
- The daily-count table schema, and how the counts are exposed (a JSON route or an npm script).
- Timeouts, and the concurrency of git commands.
- How collectors are made testable: injected `fetch` or an exec function, temporary Git repos created inside the test, or similar.
- UI layout, chip colors, and component structure.
- Whether the 30-second polling on the page stays.
- Small refactors of existing code that serve the assignment.

### Implementer MUST NOT Change Without Escalation

- The status order and rules in D-02, the flag rules in D-03, and the issue-linking order in D-04.
- Read-only behavior. No write actions to GitHub or to scanned repos.
- Adding a runtime dependency, or replacing `better-sqlite3`, Next.js, or plain `fetch`.
- Adding the `launchd` service, row expand, remembered filters, or any hosting or portability work.
- The privacy model: token server-side only, private values only in git-ignored files.
- Anything in Phase 0 (workflow docs, issue templates, the PR check Action, commit hooks for other repos).

## Scope

### In Scope

- Local collector and the join with GitHub records.
- New statuses (Unsaved, Unpushed, Local only) and the Where column.
- Detached worktree rows (D-09).
- Issue linking and issue lookup: number, title, state.
- The five flags.
- Daily counts, plus a way to read them.
- New config keys, and updates to the example config.
- Page changes:
  - Issue, Flags, Where, and Local path columns.
  - Flag chips and an "Unfinished local" chip.
  - A flag filter dropdown.
  - Default sort with action-needed rows first.
  - Refresh on page load.
- Error handling: a missing local folder names the folder in the banner and skips that repo's local rows; a failed fetch is reported and the scan continues with the existing remote-tracking refs.
- Fixture tests for all rules and the named failure cases.
- README updates covering the new statuses, flags, config keys, and the Issues read permission for the token.

### Out of Scope

- Phase 0: workflow text, issue and handoff templates, the `commit-msg` hook for other repos, the PR check Action, branch protection, and rollout to the four repos.
- The `launchd` service, timer tuning, row expand with commit history, and remembered filters.
- Desktop packaging, a hosted version, and authentication.
- Any write action: deleting or renaming branches, closing PRs, commenting.
- Cloud agent APIs. Cloud work stays invisible until it is pushed.
- A metrics dashboard UI. Readable counts are enough.
- An AGPL `LICENSE` file. Brennan adds it separately.

## Functional Requirements

### FR-01: Local branches appear

Every local branch in each configured folder appears as a row. If it also exists on GitHub, it is one row with Where = Both.

### FR-02: Local statuses

- A branch never pushed shows Local only.
- A branch with commits not on its GitHub branch shows Unpushed.
- A branch whose work copy has uncommitted edits shows Unsaved.

In all three cases, Merged, Conflicts, and Open PR still take precedence, per D-02.

### FR-03: Issue column

Every row with a linked issue shows `#N` linked to the issue on GitHub, with its title on hover.

### FR-04: Flags

Flags appear as chips next to the status, and can be filtered by chip or by dropdown.

### FR-05: Summary counts

The summary row shows a count for each flag, for Unfinished local, and for each status.

### FR-06: Default sort

Rows needing action sort first, in this order:

1. Conflicts
2. Unfinished local
3. Overlap
4. Orphan
5. Stalled review
6. Stale

After those come WIP, Open PR, Empty, and Merged. Within each group, the oldest last commit comes first.

### FR-07: Local path column

The Local path column links to the folder through `file://`.

### FR-08: Daily counts

Each refresh records the daily counts, and they can be read as JSON or printed.

### FR-09: Failure banners

A missing local folder, a failed `git fetch`, a bad or missing token, and GitHub errors each produce a banner message. The board keeps showing the last good data for the affected repo.

## Technical Requirements

- TypeScript strict mode. `npx tsc --noEmit -p .` must stay clean.
- Keep `.ts` extension imports between lib modules so `node --test` can load them, as the existing code does.
- The token needs Issues read access in addition to Contents, Pull requests, and Metadata. Document this in the README.
- `git fetch --prune` must not block a refresh indefinitely. Use a timeout.
- Respect the existing behavior that a failed repo keeps its previous rows (see `refresh.ts`).

## Data / API Contracts

- **`/api/branches`:** keep the current response shape (`owner`, `takenAt`, `errors`, `hideMergedByDefault`, `rows`). Each row gains:
  - `where`
  - `localPath`
  - `issue`: `{ number, title, state } | null`
  - `flags`: a string array
  - `attempt`
  - the local status fields.

  Existing fields keep their names.
- **Cache:** the `snapshot` table stays. Add the daily-counts table next to it. Store raw collector output and build rows at read time, as now, so config edits apply without a refresh.
- **Config:** as in D-08. The spec's "Configuration" section has the full example.

## Implementation Sequence

1. Create the branch `phase-1-reconciliation` from `main`.
2. Extend the types and pure rules in `merge.ts`, covering local fields, issue linking, attempt parsing, the new statuses, flags, and sort. Write the fixture tests first or alongside.
3. Extend the GitHub collector with PR closing references, PR activity, and issue lookup. Add failure-path tests with a stubbed fetch.
4. Write the local collector. Test it against temporary Git repos created inside the test: an unpushed branch, a dirty worktree, a detached worktree, a missing folder.
5. Wire the local collector into `refresh.ts`, add the daily-counts table, and add the counts read path.
6. Update the page and the README.
7. Run the full verification and write `IMPLEMENTATION_RESULT.md`. Commit on the branch.

The Implementer may reorder steps when dependencies require it, provided scope and approved architecture remain unchanged.

## Acceptance Criteria

### AC-01: Status precedence

Fixture tests prove the D-02 order. Each status must be reachable, and each higher rule must win over a lower one. At minimum:

- merged-with-dirty-copy gives Merged
- open-PR-with-unpushed gives Open PR
- dirty-and-unpushed gives Unsaved
- never-pushed-with-commits gives Local only

### AC-02: Flag rules

Fixture tests prove each D-03 flag, including these negative cases:

- an exempt prefix is not Orphan
- two branches on one issue with `a1` and `a2` are not Overlap
- two branches on one issue without attempt IDs are Overlap
- a merged branch gets no Orphan or Issue closed

### AC-03: Issue linking order

Fixture tests prove the D-04 precedence across all four sources, plus a branch with no source.

### AC-04: Failure cases

Tests cover each of these:

| Case | Expected result |
| --- | --- |
| Missing local folder | Error names the folder, and remote rows remain |
| 401 token | Error marked as a setup problem |
| Deleted PR base, compare returns 404 | Row kept, with no counts |
| GitHub `mergeable` is UNKNOWN | Open PR |
| Detached worktree with edits | Row shown per D-09 |

### AC-05: Local only, live

On the Mac:

1. In one configured local repo, run `git branch bb-verify-local-only` without checking it out.
2. Click Refresh.
3. The board shows that branch with Where = Local, status Local only, and the Orphan flag.
4. Remove it with `git branch -D bb-verify-local-only`.

Touch nothing else in that repo.

### AC-06: Unchanged GitHub rows

The GitHub-only branches that the board showed at `d5ef18f` still show the same status and base. They now also show Where and any issue link.

### AC-07: Daily counts

After a refresh, today's counts can be read as JSON or printed, and they match the chip counts on the page.

### AC-08: Hygiene

- `git diff main --name-only` shows no git-ignored files.
- The pre-commit hook passes on the final commit.
- `grep` of the tracked tree finds no value from `branchboard.config.json`.

## Verification Requirements

Before declaring completion:

- `npm test`: all tests pass, including the new fixture and failure tests.
- `npx tsc --noEmit -p .`: clean.
- `npm run build`: succeeds.
- Real-browser check at `http://127.0.0.1:3000` against the real config:
  - the page loads,
  - the chips filter,
  - the flag dropdown filters,
  - Refresh works,
  - the new columns render,
  - there are no console errors,
  - AC-05 passes.
- A deliberately broken `localPath` in a scratch copy of the config shows the folder banner. Restore the config afterwards.
- The pre-commit hook runs on your commit, without `--no-verify`.

Compilation alone is not browser verification. If `GITHUB_TOKEN` is unavailable, the live checks are `NOT RUN` and the assignment is `Partial`, not `Complete`.

## Known Risks and Gotchas

- **Remote name and joining:** scanned repos may have upstreams that do not use the branch's own name. Join on branch name, and assume the remote is `origin`. Note any repo where that fails.
- **`git fetch --prune` needs credentials and network:**
  - It can prompt for credentials. Set `GIT_TERMINAL_PROMPT=0`.
  - It can hang. Time it out.
  - A failure is a banner, not a crash.
- **Stale worktrees:** a worktree whose folder was deleted shows as `prunable` in the porcelain output. Do not run `git status` in a missing folder.
- **Squash merges:** these leave local branches whose commits are not in the base. The PR record must still mark them Merged, and the D-02 order handles this if the remote record is joined correctly.
- **`mergeable`:** GitHub computes it lazily. Treat UNKNOWN as Open PR, as now.
- **Closing references:** these can point to issues in other repos. Link only issues in the same repo, or keep the repo in the link. Either way, do not resolve them as the wrong repo's issue.
- **Next.js 16 changes:** Next.js 16 rewrites `tsconfig.json` and appends a block to `AGENTS.md` on `next dev`. Committing that block is fine.
- **Private values in commits:** the pre-commit check matches the owner, repo names, and local paths case-insensitively. Ordinary words in docs can trip it if a repo name is a common word, so write fixtures with clearly made-up names.

## Dependencies

- `GITHUB_TOKEN` in `.env.local`. It needs a fine-grained token with read access to Contents, Pull requests, Issues, and Metadata. If it is missing, ask Brennan, and run the GitHub-dependent live checks only once it is present.
- Git 2.40 or newer and Node 20 or newer on the Mac. Both are already present.
- `gitleaks`, used by the pre-commit hook. Already installed.

## Escalation Conditions

Do not change approved architecture merely to make implementation easier. Pause the affected work and report the issue if:

1. An approved design is technically impossible.
2. Implementation reveals a material security or data-integrity risk.
3. Existing behavior contradicts a foundational architecture assumption.
4. A required dependency or API lacks an assumed capability. For example, GitHub GraphQL does not return the closing references or activity data needed for D-03 and D-04.
5. A destructive or irreversible operation is required but was not approved.
6. Meeting acceptance criteria requires changing product scope.
7. Authoritative specifications materially contradict one another.

When escalating, report the conflicting decision, evidence, impact, viable options, and recommended resolution. Continue unaffected work when safe and practical.

## Definition of Done

The assignment is complete only when:

- all in-scope functionality is implemented
- AC-01 through AC-08 pass
- the required verification passes
- the build and browser verification complete successfully
- no known critical regression remains in the GitHub-only rows
- deviations and outstanding issues are documented
- `IMPLEMENTATION_RESULT.md` is written and committed on `phase-1-reconciliation`

## Completion Handoff Requirements

Write `IMPLEMENTATION_RESULT.md` at the repo root, using generic names only, with:

- assignment and status: `Complete`, `Partial`, or `Blocked`
- implemented work
- files changed
- verification commands and `PASS`, `FAIL`, or `NOT RUN` results
- the status of AC-01 through AC-08
- deviations from D-01 through D-09, by ID
- the choices made under "Implementer MAY Decide" that affect behavior: the Stalled review activity source, the counts read path, and the timeouts
- issues and follow-up work
- branch, latest commit, and uncommitted state
- recommended next task

Before switching implementation environments, finish or deliberately stop the assignment, identify uncommitted changes, run relevant verification, and update this completion state. Do not assume that the same model in another environment shares conversation or tool history.
