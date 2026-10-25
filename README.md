# Branch Board

A local web page that lists every branch across your GitHub repos, which agent made it (Claude, Cursor, Codex, and others), its base, and whether it is merged, in review, or still in progress. Read-only. Runs on your Mac at `http://127.0.0.1:3000`.

## Setup

Requirements: Node 20+, Git 2.40+, a GitHub fine-grained personal access token.

1. `npm install`
2. Copy `branchboard.config.example.json` to `branchboard.config.json` and fill in your GitHub owner and repos. Each repo lists the branches that count as a base, in order.
3. Create `.env.local` with one line: `GITHUB_TOKEN=github_pat_...`. The token needs read access to Contents, Pull requests, and Metadata on each listed repo.
4. `npm run dev` and open `http://127.0.0.1:3000`.

The app refuses to start without `branchboard.config.json`. It refreshes from GitHub every `refreshMinutes` (default 2) and the page polls every 30 seconds.

## Statuses

First match wins:

| Status | Rule |
| --- | --- |
| Merged | A PR from the branch is merged, or it has a PR and zero commits not in its base |
| Conflicts | Open PR that GitHub says cannot merge cleanly |
| Open PR | Open PR that can merge, or GitHub has not decided yet |
| WIP | No open PR, at least one commit not in its base. Flagged Stale after `staleDays` without a commit |
| Empty | No PR and zero commits of its own |

For branches with no PR, the base is guessed: the configured base with the fewest commits between it and the branch tip wins. Those rows say "guessed".

A branch squash-merged by hand without a PR shows as WIP. Hide it with a `branchOverrides` entry and `"ignore": true`. Use `"agent": "..."` in the same list to label a branch by hand.

## Keeping personal data out of the repo

`branchboard.config.json`, `.env.local`, and `.branchboard/` are git-ignored. `npm install` points Git at `.githooks/`, whose pre-commit hook runs `gitleaks` and blocks any staged file containing the owner, a repo name, or a local path from your real config.

## Tests

`npm test`

## License

AGPL-3.0-only.
