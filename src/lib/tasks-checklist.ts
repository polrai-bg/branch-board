// Parse GitHub issue/PR checkbox lists into TaskItem rows. Pure: string in, tasks out.
import type { TaskItem } from "./merge.ts";

const CHECKBOX = /^\s*(?:[-*]|\d+\.)\s+\[([ xX])\]\s+(.+?)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*$/;

const INCLUDE = new Set(["acceptance criteria", "remaining work"]);
const EXCLUDE = new Set(["reuse check"]);

export type ChecklistSource = "issue" | "pr";

function normalizeHeading(text: string): string {
  return text.replace(/[:：]\s*$/, "").trim().toLowerCase();
}

export function parseChecklistBody(
  body: string | null | undefined,
  opts: {
    source: ChecklistSource;
    listId: string;
    repo: string;
    branch: string | null;
    issue: number | null;
    updatedAt: string;
  },
): TaskItem[] {
  if (!body) return [];
  const tasks: TaskItem[] = [];
  let section: "include" | "exclude" | "other" = "other";
  let lineNo = 0;
  for (const line of body.split(/\r?\n/)) {
    lineNo += 1;
    const heading = HEADING.exec(line);
    if (heading) {
      const name = normalizeHeading(heading[1] ?? "");
      if (INCLUDE.has(name)) section = "include";
      else if (EXCLUDE.has(name)) section = "exclude";
      else section = "other";
      continue;
    }
    if (section !== "include") continue;
    const box = CHECKBOX.exec(line);
    if (!box) continue;
    const marked = (box[1] ?? " ").toLowerCase() === "x";
    const subject = (box[2] ?? "").trim();
    if (!subject) continue;
    tasks.push({
      source: opts.source,
      listId: opts.listId,
      id: String(lineNo),
      subject,
      status: marked ? "completed" : "pending",
      activeForm: null,
      blockedBy: [],
      owner: null,
      repo: opts.repo,
      branch: opts.branch,
      issue: opts.issue,
      updatedAt: opts.updatedAt,
    });
  }
  return tasks;
}

// A handoff comment body may start with "## Handoff" and carry Remaining work below.
export function isHandoffComment(body: string | null | undefined): boolean {
  if (!body) return false;
  return /^\s*##\s+Handoff\b/i.test(body);
}
