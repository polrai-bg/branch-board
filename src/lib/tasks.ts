// Join Claude Code tasks and GitHub checklists into one TaskItem list for the snapshot.
import type { IssueInfo, RemoteBranch, TaskItem } from "./merge.ts";
import { parseChecklistBody } from "./tasks-checklist.ts";

function keepOpenLists(tasks: TaskItem[]): TaskItem[] {
  const byList = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    const key = `${task.source}\0${task.listId}\0${task.repo ?? ""}\0${task.branch ?? ""}\0${task.issue ?? ""}`;
    const list = byList.get(key) ?? [];
    list.push(task);
    byList.set(key, list);
  }
  const kept: TaskItem[] = [];
  for (const list of byList.values()) {
    if (list.every((task) => task.status === "completed")) continue;
    kept.push(...list);
  }
  return kept;
}

export function checklistTasksFromSnapshot(branches: RemoteBranch[], issues: IssueInfo[]): TaskItem[] {
  const tasks: TaskItem[] = [];

  for (const branch of branches) {
    for (const pr of branch.prs) {
      if (!pr.body) continue;
      tasks.push(
        ...parseChecklistBody(pr.body, {
          source: "pr",
          listId: `pr:${pr.number}`,
          repo: branch.repo,
          branch: branch.name,
          issue: null,
          updatedAt: pr.updatedAt ?? branch.committedDate,
        }),
      );
    }
  }

  for (const issue of issues) {
    if (!issue.body) continue;
    // Branch is filled in by buildRows for every branch that links this issue.
    tasks.push(
      ...parseChecklistBody(issue.body, {
        source: "issue",
        listId: `issue:${issue.number}`,
        repo: issue.repo,
        branch: null,
        issue: issue.number,
        updatedAt: issue.updatedAt ?? new Date(0).toISOString(),
      }),
    );
  }

  return keepOpenLists(tasks);
}
