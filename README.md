# Branch Board

A local web page that lists every branch across your GitHub repos, which agent made it (Claude, Cursor, Codex, and others), its base, and whether it is merged, in review, or still in progress. Read-only. Runs on your Mac at `http://127.0.0.1:3000`.

## Setup

Requirements: Node 20+, Git 2.40+, a GitHub fine-grained personal access token.

1. `npm install`
2. Copy `branchboard.config.example.json` to `branchboard.config.json` and fill in your GitHub owner and repos. Each repo lists the branches that count as a base, in order.
3. Create `.env.local` with one line: `GITHUB_TOKEN=github_pat_...`. The token needs read access to Contents, Pull requests, Issues, and Metadata on each listed repo.
4. `npm run dev` and open `http://127.0.0.1:3000`.

The app refuses to start without `branchboard.config.json`. It refreshes from GitHub every `refreshMinutes` (default 2). The page shows the cached snapshot on load, then refreshes, and polls every 30 seconds.

## Statuses

First match wins:

| Status | Rule |
| --- | --- |
| Merged | A PR from the branch is merged, or it has a PR and zero commits not in its base |
| Conflicts | Open PR that GitHub says cannot merge cleanly |
| Open PR | Open PR that can merge, or GitHub has not decided yet |
| Unsaved | A local work copy has uncommitted edits |
| Unpushed | A local branch has commits that are not on its GitHub branch |
| Local only | The branch exists on this Mac and was never pushed |
| WIP | No open PR, at least one commit not in its base. Flagged Stale after `staleDays` without a commit |
| Empty | No PR and zero commits of its own |

Unsaved, Unpushed, and Local only are the Unfinished local group. The Where column says GitHub, Local, or Both.

## Flags

Flags sit next to the status and can stack.

| Flag | Rule |
| --- | --- |
| Orphan | Not merged, no linked issue, and the branch prefix is not in `exemptPrefixes` |
| Overlap | Two or more unmerged branches in the same repo link to the same issue and do not each carry a distinct attempt ID (`a1`, `a2`, right after the issue number) |
| Stalled review | Open PR with no new commit or PR activity in `stalledReviewDays` (default 3) |
| Stale | WIP with no commits in `staleDays` (default 7) |
| Issue closed | The linked issue is closed and the branch is not merged |

A branch's issue is the first of: a `branchOverrides` entry with `issue`, the PR's closing reference in the same repo, `issuePattern` on the branch name, then `#123` in the newest commit message. The message counts only when the branch has commits of its own: an untouched branch's newest commit belongs to its base, so a squash message like `Title (#21)` there does not link it.

## Daily counts

Each refresh stores that day's flag counts, per repo, in `.branchboard/cache.db`. The last refresh of the day replaces that day's rows. Read them at `/api/counts` or with `npm run counts`.

For branches with no PR, the base is guessed: the configured base with the fewest commits between it and the branch tip wins. Those rows say "guessed".

A branch squash-merged by hand without a PR shows as WIP. Hide it with a `branchOverrides` entry and `"ignore": true`. Use `"agent": "..."` in the same list to label a branch by hand, and `"issue": 12` to link a branch to an issue by hand.

`exemptPrefixes` lists branch prefixes that never get the Orphan flag. `issuePattern` is a regular expression whose first group is the issue number in a branch name. `stalledReviewDays` is how long an open PR can sit without activity before it is flagged. `repos[].localPath` is the folder on this Mac, or `null` when the repo is cloud-only. A missing folder is named in the error banner and that repo's local rows are skipped. `git fetch --prune` runs before the local scan. If the fetch fails, the banner says so and the scan continues with the remote-tracking refs already on disk.

## Keeping personal data out of the repo

`branchboard.config.json`, `.env.local`, and `.branchboard/` are git-ignored. `npm install` points Git at `.githooks/`, whose pre-commit hook runs `gitleaks` and blocks any staged file containing the owner, a repo name, or a local path from your real config.

## Tests

`npm test`

## License

AGPL-3.0-only.
