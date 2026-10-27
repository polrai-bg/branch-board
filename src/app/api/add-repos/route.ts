import { join } from "node:path";
import { CONFIG_FILE } from "@/lib/config.ts";
import { registerFolders } from "@/lib/register-repo.ts";
import { selectableScanPaths } from "@/lib/scan-session.ts";

// Chosen repos from the last scan only. A path the scan did not return is ignored.
// Only JSON requests: a cross-site page cannot send JSON without a CORS preflight, which this route never approves.
export async function POST(req: Request) {
  if (req.headers.get("content-type") !== "application/json") {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as { paths?: unknown } | null;
  const requested = Array.isArray(body?.paths) ? body.paths.filter((path): path is string => typeof path === "string") : [];
  const paths = selectableScanPaths(requested);
  if (paths.length === 0) {
    return Response.json({ error: "Scan the folder again, then choose the repos to add." }, { status: 400 });
  }

  try {
    const result = await registerFolders(paths, join(process.cwd(), CONFIG_FILE));
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({
      ok: true,
      added: result.added.map((entry) => ({ name: entry.name, localPath: entry.localPath })),
      notices: result.notices.filter((notice): notice is string => Boolean(notice)),
      skipped: result.skipped,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the config." }, { status: 500 });
  }
}
