# Plan: tasks and to-dos across branches and repos

Status: draft for review. Nothing in this plan is built yet.

## What the research found

| Fact | Where it came from |
| --- | --- |
| Claude Code keeps a task list per session. Each task is one JSON file: `~/.claude/tasks/<list-id>/<n>.json` with `id`, `subject`, `description`, `activeForm`, `status` (`pending`, `in_progress`, `completed`), `blocks`, `blockedBy`, and `owner` when claimed. A `.lock` file sits next to them. | Claude Code docs, plus a file written by Claude Code 2.1.316 in this session |
| The list id is the session id unless `CLAUDE_CODE_TASK_LIST_ID` names a shared list. Agent teams use `~/.claude/tasks/<team-name>/`. | Claude Code docs |
| Each session transcript is `~/.claude/projects/<folder-slug>/<session-id>.jsonl`. Nearly every line carries `cwd` and `gitBranch`. | Claude Code docs, plus this session's transcript |
| So a task list can be tied to a branch in two hops: list id = session id, session transcript = folder and branch. Neither Claude Code nor Cursor shows this join. | Derived |
| Claude Code's cross-repo view (`claude agents`) is a list of sessions, not tasks. Each row has a state (Working, Needs input, Ready for review, Completed, Failed, Stopped), a one-line summary, and a PR link. `claude agents --json` gives the same data to scripts. | Claude Code docs |
| Both tools put each parallel agent in its own git worktree and branch. Claude Code uses `.claude/worktrees/<name>/` on branch `worktree-<name>`. Cursor caps worktrees at 25 per machine and deletes old ones. | Both docs |
| Cursor's to-do list lives in the chat. Its docs do not say where it is stored. Plans are saved to the home folder by default. Projects keep a synced folder of context files. None of this is documented well enough to read from disk. | Cursor docs |
| Branch Board already treats GitHub Issues as the tracker. The work-item template has acceptance criteria as checkboxes. The handoff comment has a Remaining work section. | `workflow/` |

## Decision that shapes everything

The board reads task lists that agents already write. It does not become a second tracker.

This follows the existing rule (handoff D-01: the board reconciles, it does not track work). The sources are the Claude Code task files on this Mac and the checkboxes on GitHub issues and pull requests. Every other agent (Cursor, Codex, Grok) reaches the board through the issue checklist, which is the one place they all write.

The alternative is a task store owned by the board, with an API agents call. That is listed under Decisions needing approval.

## What the user sees when it is done

| Place | Change |
| --- | --- |
| Table | A new Tasks column: `2 of 5` for a row with open tasks, blank when it has none. An in-progress task shows its `activeForm` text in the column, for example `Running tests`. |
| Row detail | A Tasks list under the commits: subject, status, blocked-by, and a source tag (`Claude Code`, `Issue #42`, `PR #51`). |
| View select | A third option, Tasks. It lists every open task across all repos, grouped by repo then branch, with the branch status next to each group. Tasks that could not be tied to a branch sit in a last group, Not tied to a branch. |
| Inbox | A row whose branch is Merged but still has open tasks gets a new flag, Tasks open, and stays in the inbox. |
| Chips | A Tasks open chip next to the existing flag chips. |
| Daily counts | A new metric, Tasks open, so the measurement period can show whether checklists get finished. |

## Data model

One shape for every source:

```ts
type TaskItem = {
  source: "claude-code" | "issue" | "pr";
  listId: string;          // Claude Code list folder, or "issue:42", or "pr:51"
  id: string;              // "1", or the checkbox line number
  subject: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string | null;
  blockedBy: string[];
  owner: string | null;
  repo: string | null;     // null when the task could not be tied to a repo
  branch: string | null;   // null when it could not be tied to a branch
  issue: number | null;
  updatedAt: string;       // file mtime, or the issue/PR updatedAt
};
```

The snapshot gains a `tasks` column, stored as JSON next to `locals` and `issues`. `buildRows` joins tasks to rows on repo plus branch name, the same join it already uses for local records.

## How a Claude Code task is tied to a branch

1. List the folders in `~/.claude/tasks/`. Skip `.lock`. Read every `<n>.json`.
2. For a folder whose name looks like a session id, find `~/.claude/projects/*/<session-id>.jsonl`. Read the last 64 KB of the file, not the whole thing. Take `cwd` and `gitBranch` from the last line that has them. The last line wins because a session can move into a worktree after it starts.
3. Match `cwd` to a configured repo: it equals the repo's `localPath`, or it is one of that repo's worktree paths from `git worktree list --porcelain`, which the local collector already parses. Compare real paths so symlinks do not break the match.
4. The branch is `gitBranch`. If the repo matched but the branch is not in the snapshot (the worktree was deleted), keep the repo and branch anyway. The row then appears only in the Tasks view under that repo, marked branch gone.
5. A folder whose name is not a session id (a shared list or a team name) has no transcript. It goes to Not tied to a branch unless a config override names its repo and branch.

Transcript files can be hundreds of megabytes. Reading the tail only keeps a refresh under a second for a few dozen lists. The collector keys its results by file mtime so a list that did not change is not read again.

## How an issue or PR checklist becomes tasks

The GitHub collector already fetches linked issues (number, title, state). It will also fetch `body` for those issues and for the open PR on each branch. A checkbox line is a task:

| Line | Status |
| --- | --- |
| `- [ ] text` | pending |
| `- [x] text` | completed |

Checkboxes under a heading named `Acceptance criteria` or `Remaining work` count. Checkboxes under `Reuse check` do not. An issue's tasks attach to every branch that links to that issue, so two attempts at one issue show the same checklist.

The handoff comment's Remaining work is plain text in a comment, not in the body. Fetching comments is one more request per issue. That is Phase T2, and only for issues with an open branch.

## Config

Two new keys. Both optional.

```json
{
  "claudeConfigDir": "~/.claude",
  "taskLists": [
    { "list": "feature-auth", "repo": "repo-one", "branch": "claude/42-auth" }
  ]
}
```

`claudeConfigDir` defaults to `~/.claude`, or `CLAUDE_CONFIG_DIR` when that is set. `taskLists` ties a named shared list to a repo and branch. Setting `claudeConfigDir` to `null` turns the Claude Code source off.

## Phases

### Phase T1: Claude Code task lists on this Mac

1. `src/lib/tasks-claude.ts`: read task folders, parse task files, read transcript tails, map to repo and branch. Pure parsing functions take strings so tests use fixtures, not the real home folder.
2. `src/lib/cache.ts`: `tasks` column, with the same migration pattern as `locals`.
3. `src/lib/refresh.ts`: run the task collector next to the local scans. A failure is one error banner, and the previous tasks are kept.
4. `src/lib/merge.ts`: `TaskItem` type, join into `Row` as `tasks: TaskItem[]`, the Tasks open flag, the Tasks open count metric, and `inInbox` keeps a Merged row with open tasks.
5. `src/app/api/branches/route.ts`: rows carry tasks. New `src/app/api/tasks/route.ts` returns the flat list for the Tasks view.
6. `src/app/page.tsx`: Tasks column, row detail list, Tasks view, chip.
7. Tests: `test/tasks-claude.test.ts` with fixture task files and transcript tails, including a session that moved into a worktree, a deleted worktree, a named list, a list with a bad JSON file, and a transcript with no `gitBranch`.
8. README: a Tasks section explaining the sources and the two config keys.

### Phase T2: Issue and PR checklists

1. `src/lib/github.ts`: add `body` to the issue and PR queries. Add a comments query for the newest comment that starts with `## Handoff`, only for issues with an unmerged branch.
2. `src/lib/tasks-checklist.ts`: parse checkbox lines under the named headings. Pure, string in, tasks out.
3. Join by issue number to every branch linked to that issue.
4. Tests for the parser: nested lists, headings in different cases, checkboxes outside the named headings, a body with no checkboxes.

### Phase T3: Claude Code background sessions

Only if `claude` is on the PATH. Run `claude agents --json` with a 10 second timeout on each refresh. Each session has a state, a summary, a `cwd`, and a PR link. Tie it to a row the same way as a task list. The row detail shows the session state and summary. A session in Needs input puts its row in the inbox.

This phase is separate because it runs another program on every refresh and depends on a command whose JSON shape the docs describe but do not pin down.

### Not in this plan

- Cursor to-dos and plans. Storage is undocumented. Cursor work reaches the board through issue checklists.
- Writing tasks. The board never writes to `~/.claude/` or to GitHub.
- A board-owned task store. See below.

## Decisions needing approval

| # | Question | Facts |
| --- | --- | --- |
| 1 | Read-only sources, as planned, or a task store the board owns with an API agents call? | Read-only means no new place to keep in sync and nothing for agents to learn. A board store means tasks survive when a session's folder is cleaned up (Claude Code deletes task folders after `cleanupPeriodDays`), and agents on other machines could post to it. Both tools researched keep their lists outside the repo. |
| 2 | Hide a list once every task in it is completed? | Completed lists are noise in the Tasks view. Hiding them means the column goes blank on a finished branch, and the Tasks open flag never fires for it, which is the intended state. The plan hides them. |
| 3 | Does Tasks open keep a Merged row in the inbox? | The branch is done but the issue checklist is not. The plan says yes, because the checklist is what the workflow says is done. |
| 4 | Build Phase T3? | It adds a subprocess per refresh and a second source of truth for session state. Without it, the board still shows tasks, just not whether an agent is waiting on input. |
| 5 | Comments fetch in Phase T2? | One extra GitHub request per issue with an unmerged branch. The handoff comment is the only place Remaining work is written today. |

## Acceptance criteria

| ID | Check |
| --- | --- |
| AC-T1 | A task list from a session that ran in a worktree under a configured repo appears on that branch's row with the correct open count. |
| AC-T2 | A session that started in the main checkout and moved into a worktree is tied to the worktree's branch, not the base. |
| AC-T3 | A named list with no transcript appears under Not tied to a branch. With a `taskLists` entry it appears on the named row. |
| AC-T4 | A task folder with one unreadable JSON file loses that one task, not the list, and shows one error banner. |
| AC-T5 | A Merged row with an open task shows the Tasks open flag and stays in the inbox. A Merged row whose tasks are all completed shows nothing. |
| AC-T6 | Issue checkboxes under Acceptance criteria appear on every branch linked to the issue. Checkboxes under Reuse check do not. |
| AC-T7 | The Tasks view groups by repo then branch and matches the column counts. |
| AC-T8 | The Tasks open metric is in `/api/counts` and `npm run counts` and matches the chip total. |
| AC-T9 | A refresh with a 200 MB transcript on disk completes in under two seconds more than today. |
| AC-T10 | Tests run on fixtures only. No test reads the real home folder or `branchboard.config.json`. No real repo name, owner, or path is in any tracked file. |

## Risks

| Risk | What it means for the plan |
| --- | --- |
| The task file format is not documented. The fields above come from one file written by Claude Code 2.1.316. | The parser accepts unknown fields and ignores them. Required fields are `id`, `subject`, `status`. A file missing any of those is one error, not a crash. |
| The list id equals the session id by convention, not by contract. | A folder that has no matching transcript is handled, not assumed. |
| Transcript lines carry `gitBranch` at the time of each line. | The collector takes the last line, which is the branch at the end of the session. |
| Claude Code cleans up task folders after `cleanupPeriodDays`. | Tasks disappear from the board when the folder goes. The issue checklist does not, which is why T2 matters. |
| `claude agents --json` shape can change between versions. | T3 reads only the fields the docs name and tolerates missing ones. |
| Reading `~/.claude/` touches private data on this Mac. | The board reads only task files and the `cwd` and `gitBranch` fields of transcripts. It stores subjects and descriptions in `.branchboard/cache.db`, which is git-ignored. Nothing from it is written to a tracked file. |
