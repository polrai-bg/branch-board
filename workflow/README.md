# Work-item workflow

Copy these files into another repository. Append `WORKFLOW.md` to agent instructions that are already there. Do not delete existing instructions.

| File | Destination |
| --- | --- |
| `WORKFLOW.md` | Append to `AGENTS.md`, `CLAUDE.md`, and a Cursor rule |
| `work-item.md` | `.github/ISSUE_TEMPLATE/work-item.md` |
| `handoff-comment.md` | `workflow/handoff-comment.md` |
| `commit-msg` | `.githooks/commit-msg` (executable) |
| `exempt-prefixes` | `.github/exempt-prefixes` |
| `require-issue.sh` | `workflow/require-issue.sh` |
| `require-issue.yml` | `.github/workflows/require-issue.yml` |

For a new Cursor rule, save `WORKFLOW.md` as `.cursor/rules/work-item.mdc` with this front matter:

```yaml
---
description: Work-item workflow. Follow it before writing code.
alwaysApply: true
---
```

The `commit-msg` hook rejects a message with no `#<number>`. Merge commits pass. A branch whose name starts with a prefix in `exempt-prefixes` passes. The sample prefix in that file is an example, not a required name.

Point Git at the hook with `git config core.hooksPath .githooks` when this clone has no other hooks directory. If a hook runner is already installed, call `.githooks/commit-msg` from its `commit-msg` command and pass the message file. Do not replace an existing hooks path that other hooks depend on.

The pull request check fails unless the title or body has a closing keyword (`Closes #<issue>`) or the head branch matches `^(?:[^/]+/)?(\d+)-`. The same exempt prefixes skip the check. The check's name is `PR links an issue`.

Require that check in branch protection only after this workflow file is on the default branch. Leave repository admins able to bypass, so the owner is not locked out.
