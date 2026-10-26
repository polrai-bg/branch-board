## Work-item workflow

GitHub Issues are the tracker. Follow this before writing code.

### Reuse check

1. Search open and recently closed issues, branches, and pull requests for the same or overlapping work.
2. Read the implementation, not just the titles.
3. Extend existing work. That is the default.
4. If you replace existing work, record why on the issue.

### Steps

1. Claim an existing issue (assign yourself or comment) or create one from `.github/ISSUE_TEMPLATE/work-item.md`.
2. On the issue, write the scope, the acceptance criteria, and what the reuse check found.
3. Name the branch `<agent-prefix>/<issue>-<slug>`. Example: `cursor/42-consent-banner`.
4. Comment on the issue when progress or a blocker changes.
5. Open the pull request with `Closes #<issue>` in the body.
6. Put `#<issue>` in every commit message, for example `Add consent banner (#42)`. Do not commit without it.
7. When you stop, comment on the issue using `workflow/handoff-comment.md`: verification done, remaining work, and the next owner.

Merge commits, and branches whose names start with a prefix in `.github/exempt-prefixes`, may omit the issue number. The hook script is `.githooks/commit-msg`. It runs when that directory is Git's hooks path, or when another hook runner calls it.

### Parallel attempts

Intentional parallel attempts share one issue. Each branch includes an attempt id: `<agent-prefix>/<issue>-a1-<slug>` and `<agent-prefix>/<issue>-a2-<slug>`. Name an integration owner on the issue. That person picks or merges the result. A second attempt with no attempt id is an undeclared overlap.
