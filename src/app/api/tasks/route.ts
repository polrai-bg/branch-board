import { readSnapshot } from "@/lib/cache.ts";
import { loadConfig } from "@/lib/config.ts";
import { buildRows, openTaskIndex, openTasks, type TaskItem } from "@/lib/merge.ts";

export const dynamic = "force-dynamic";

export type TaskGroup = {
  repo: string | null;
  branch: string | null;
  status: string | null;
  branchGone: boolean;
  tasks: TaskItem[];
};

export function GET() {
  const cfg = loadConfig();
  const snap = readSnapshot();
  const rows = buildRows(cfg, snap.branches, Date.now(), snap.locals, snap.issues, snap.tasks, snap.sessions);
  const rowByKey = new Map(rows.map((row) => [`${row.repo}\0${row.name}`, row]));

  const attached = new Set<string>();
  const groups = new Map<string, TaskGroup>();

  for (const row of rows) {
    const open = openTasks(row.tasks);
    if (open.length === 0) continue;
    const key = `${row.repo}\0${row.name}`;
    for (const task of open) attached.add(`${task.source}\0${task.listId}\0${task.id}`);
    groups.set(key, {
      repo: row.repo,
      branch: row.name,
      status: row.status,
      branchGone: false,
      tasks: open,
    });
  }

  // Claude lists tied to a deleted worktree, and named lists with no override, sit here.
  for (const task of openTaskIndex(snap.tasks)) {
    const id = `${task.source}\0${task.listId}\0${task.id}`;
    if (attached.has(id)) continue;
    if (task.repo && task.branch) {
      const key = `${task.repo}\0${task.branch}`;
      if (!rowByKey.has(key)) {
        const group = groups.get(key) ?? {
          repo: task.repo,
          branch: task.branch,
          status: null,
          branchGone: true,
          tasks: [],
        };
        group.tasks.push(task);
        groups.set(key, group);
        continue;
      }
    }
    const loose = groups.get("\0") ?? {
      repo: null,
      branch: null,
      status: null,
      branchGone: false,
      tasks: [],
    };
    loose.tasks.push(task);
    groups.set("\0", loose);
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.repo == null && b.repo != null) return 1;
    if (a.repo != null && b.repo == null) return -1;
    const repo = (a.repo ?? "").localeCompare(b.repo ?? "");
    if (repo) return repo;
    return (a.branch ?? "").localeCompare(b.branch ?? "");
  });

  return Response.json({ takenAt: snap.takenAt, groups: ordered });
}
