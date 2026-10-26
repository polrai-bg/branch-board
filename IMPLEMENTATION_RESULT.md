# Implementation result

Assignment: Phase 1, the reconciliation snapshot.
Status: Partial.

The board reconciles GitHub rows with local branches, links issues, applies the new statuses and five flags, and stores daily counts. Live GitHub refresh was not run because `GITHUB_TOKEN` is not set, so this is not Complete.

## Implemented work

- Local collector joins GitHub rows on repo plus branch name. Where is GitHub, Local, or Both.
- Status order, first match wins: Merged, Conflicts, Open PR, Unsaved, Unpushed, Local only, WIP, Empty.
- Issue linking, first hit wins: override, same-repo PR closing reference, branch name, newest commit message. Attempt id is `a<N>` right after the issue number in the branch name.
- Flags: Orphan, Overlap, Stalled review, Stale, Issue closed. Unfinished local is the group Unsaved, Unpushed, and Local only.
- Detached work copies: a dirty one or one whose commit is on no branch is its own row. A clean detached work copy already on a branch is omitted. Prunable or missing worktree folders are skipped.
- Daily counts in `.branchboard/cache.db`, last refresh of the local calendar day wins, including zeros. Read them at `/api/counts` or `npm run counts`.
- Page: cached snapshot, then refresh on load. Refresh button. Flag chips, an Unfinished local chip, a flag dropdown, and columns Issue, Flags, Where, and Local path (`file://`, home shown as `~`).
- Config keys `exemptPrefixes` (default `[]`), `issuePattern` (default `^(?:[^/]+/)?(\d+)-`), and `stalledReviewDays` (default 3). `refreshMinutes` stays. The real config file gained only those keys. `exemptPrefixes` was left empty.
- A tiny `public/favicon.ico` so the page does not log a 404 for `/favicon.ico`.

## Files changed

- `src/lib/merge.ts`, `src/lib/local.ts`, `src/lib/assemble.ts`, `src/lib/github.ts`, `src/lib/refresh.ts`, `src/lib/cache.ts`, `src/lib/config.ts`
- `src/app/page.tsx`, `src/app/api/branches/route.ts`, `src/app/api/counts/route.ts`
- `scripts/print-counts.mjs`, `package.json`
- `branchboard.config.example.json`, `README.md`, `public/favicon.ico`
- `test/merge.test.ts`, `test/local.test.ts`, `test/github.test.ts`, `test/assemble.test.ts`, `test/cache.test.ts`, `test/config.test.ts`
- `IMPLEMENTATION_RESULT.md`

## Verification

| Check | Result |
| --- | --- |
| `npm test` | PASS (19 tests) |
| `npx tsc --noEmit -p .` | PASS |
| `npm run build` | PASS |
| Page load at `http://127.0.0.1:3000` | PASS |
| Flag chips filter | PASS |
| Flag dropdown filters | PASS |
| Refresh button | PASS |
| Issue, Flags, Where, Local path columns | PASS |
| Console errors | PASS |
| Missing-folder banner on a scratch config, then restore | PASS |
| Live GitHub refresh | NOT RUN (no `GITHUB_TOKEN`) |

`node --test` prints `MODULE_TYPELESS_PACKAGE_JSON` warnings. Those were already the project's style. `"type": "module"` was not added.

## Acceptance criteria

| ID | Result |
| --- | --- |
| AC-01 Status precedence | PASS. Fixtures include merged-with-dirty, open-PR-with-unpushed, dirty-and-unpushed, and never-pushed-with-commits. |
| AC-02 Flag rules | PASS. Includes exempt prefix, `a1`/`a2` not Overlap, no attempt ids Overlap, merged gets neither Orphan nor Issue closed. |
| AC-03 Issue linking order | PASS. Override, closing reference, branch name, commit message, and none. |
| AC-04 Failure cases | PASS. Missing folder, 401, compare 404, `mergeable` UNKNOWN, and a detached worktree with edits. |
| AC-05 Local only, live | PASS. `bb-verify-local-only` showed Where Local, status Local only, and Orphan, then was deleted. Nothing else in that repo was changed. |
| AC-06 Unchanged GitHub rows | PASS for GitHub-only rows against the pre-change snapshot. Seven rows stayed GitHub and kept the same status and base. One snapshot row is now Both because that branch also exists locally. |
| AC-07 Daily counts | PASS. `/api/counts` and `npm run counts` match the chip totals for today. |
| AC-08 Hygiene | PASS. The pre-commit hook ran and exited 0 (gitleaks and the private-value check). The diff against `main` adds no git-ignored files. Tests do not read the real config. |

## Deviations

| ID | Deviation |
| --- | --- |
| D-01 | None. |
| D-02 | None. |
| D-03 | None. |
| D-04 | None. |
| D-05 | None. This Git build rejects `for-each-ref -z` and prints `%xNN` as text in ref formats. The collector uses one line per ref with a literal field separator, then `git log -1 --format=%B` for the message body. |
| D-06 | None. The 2-minute timer and `refreshMinutes` stay. The 30-second page poll stays. |
| D-07 | None. |
| D-08 | None. The example file includes the sample exempt prefix from the spec. The real file's `exemptPrefixes` is empty. |
| D-09 | None. |

## Choices

- Stalled review activity is the newer of the branch tip commit time and the open PR `updatedAt`. There is no separate reviews query. GitHub moves `updatedAt` on pushes, reviews, comments, and edits.
- Unpushed local commits count as commits not in the base. An open PR whose GitHub ahead count is 0, plus unpushed commits, stays Open PR. A merged PR still wins.
- A null GitHub compare is left null. It is not filled from the local ahead/behind count.
- Unpushed count is `rev-list --count` from `refs/remotes/origin/<branch>` to the local branch, and only when that remote ref exists. Otherwise the branch was never pushed. The remote is assumed to be `origin` with the same branch name.
- Local ahead/behind uses `rev-list --left-right --count` and the existing base guess. Configured base branches are omitted from both collectors.
- Counts live in `daily_counts(day, repo, metric, count)`. The read path is `GET /api/counts` and `npm run counts`.
- Timeouts: `git fetch` 60 seconds, other git commands 20 seconds, GitHub 45 seconds. Worktree status runs with a pool of 4.
- Open questions OQ-1, OQ-2, and OQ-3 are not decided in code. Defaults are show every branch, `staleDays` 7, `stalledReviewDays` 3, and `exemptPrefixes` `[]`.

## Issues and follow-up

- `GITHUB_TOKEN` is absent from `.env.local` and from the environment, so a live GitHub refresh was not run. Cached GitHub rows were kept, and local scans still ran. Put a fine-grained token in `.env.local` (Contents, Pull requests, Issues, Metadata) and refresh once so issue titles come from GitHub.
- No product follow-up inside Phase 1 other than that refresh.

## Git

- Branch: `phase-1-reconciliation`, cut from `main` at `f333a16`.
- Latest commit: the tip of `phase-1-reconciliation`. Read it with `git rev-parse --short HEAD`.
- Uncommitted state: clean, aside from git-ignored local files (`branchboard.config.json`, `.branchboard/`).
- Not merged. No remote was added. Not pushed.

## Recommended next task

Add `GITHUB_TOKEN` and run one live refresh to confirm GitHub issue titles and closing references on the real board. Then start Phase 0 (workflow text, issue and handoff templates, the commit-msg hook, and the PR check). Phase 2 waits until the Phase 0 and Phase 1 evaluation.
