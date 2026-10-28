import { loadConfig } from "@/lib/config.ts";
import { defaultGit } from "@/lib/local.ts";

function firstLine(text: string): string {
  return text.trim().split("\n")[0] || "could not delete the branch";
}

// Deletes a non-base branch on this Mac, then on GitHub if origin still has it.
export async function POST(req: Request) {
  if (req.headers.get("content-type") !== "application/json") {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as { repo?: unknown; branch?: unknown } | null;
  const repoName = typeof body?.repo === "string" ? body.repo : "";
  const branch = typeof body?.branch === "string" ? body.branch : "";
  if (!repoName || !branch || branch.startsWith("-") || branch.includes("..")) {
    return Response.json({ error: "Missing repo or branch." }, { status: 400 });
  }
  const cfg = loadConfig();
  const repo = cfg.repos.find((item) => item.name === repoName);
  if (!repo?.localPath) return Response.json({ error: "This repo has no local folder, so the branch was not deleted." }, { status: 400 });
  if (repo.bases.includes(branch)) return Response.json({ error: "That branch is a base and was not deleted." }, { status: 400 });

  const git = defaultGit();
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"], repo.localPath);
  if (head.stdout.trim() === branch) {
    return Response.json({ error: "That branch is checked out. Switch off it before deleting it." }, { status: 400 });
  }
  const local = await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repo.localPath);
  if (local.code === 0) {
    const deleted = await git(["branch", "-D", branch], repo.localPath);
    if (deleted.code !== 0) return Response.json({ error: firstLine(deleted.stderr || deleted.stdout) }, { status: 500 });
  }
  const remote = await git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], repo.localPath);
  if (remote.code !== 0) return Response.json({ ok: true, github: false });
  const pushed = await git(["push", "origin", "--delete", branch], repo.localPath);
  if (pushed.code !== 0) {
    return Response.json({ error: `Removed it on this Mac. GitHub was not changed: ${firstLine(pushed.stderr || pushed.stdout)}` }, { status: 500 });
  }
  return Response.json({ ok: true, github: true });
}
