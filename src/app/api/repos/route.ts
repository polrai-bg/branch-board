import { join } from "node:path";
import { CONFIG_FILE, loadConfig } from "@/lib/config.ts";
import { removeRepos } from "@/lib/register-repo.ts";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const cfg = loadConfig();
    return Response.json({
      repos: cfg.repos.map((repo) => ({ name: repo.name, localPath: repo.localPath, bases: repo.bases })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read the config." }, { status: 400 });
  }
}

// Removes repos by name. Only JSON, so a cross-site page cannot send this without a preflight.
export async function POST(req: Request) {
  if (req.headers.get("content-type") !== "application/json") {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const result = removeRepos([name], join(process.cwd(), CONFIG_FILE));
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, removed: result.removed });
}
