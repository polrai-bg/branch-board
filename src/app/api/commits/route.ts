import { loadConfig } from "@/lib/config.ts";
import { localCommits, type CommitLine } from "@/lib/commits.ts";

export const dynamic = "force-dynamic";

type GhCommit = { sha: string; commit?: { message?: string; author?: { name?: string; date?: string } } };

async function githubCommits(token: string, owner: string, repo: string, branch: string): Promise<CommitLine[]> {
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=5`,
    { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as GhCommit[];
  if (!Array.isArray(body)) return [];
  return body.slice(0, 5).map((item) => ({
    sha: item.sha,
    author: item.commit?.author?.name ?? "",
    date: item.commit?.author?.date ?? "",
    subject: item.commit?.message?.split("\n")[0] ?? "",
  }));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo") ?? "";
  const branch = url.searchParams.get("branch") ?? "";
  const cfg = loadConfig();
  const configured = cfg.repos.find((item) => item.name === repo);
  if (!configured) return Response.json({ error: "Unknown repo" }, { status: 404 });
  const local = configured.localPath ? await localCommits(configured.localPath, branch) : null;
  if (local) return Response.json({ commits: local });
  const token = process.env.GITHUB_TOKEN;
  const commits = token ? await githubCommits(token, cfg.github.owner, repo, branch) : [];
  return Response.json({ commits });
}
