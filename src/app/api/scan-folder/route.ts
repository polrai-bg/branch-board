import { chooseFolder } from "@/lib/choose-folder.ts";
import { loadConfig } from "@/lib/config.ts";
import { scanWorkFolder } from "@/lib/register-repo.ts";
import { rememberScan } from "@/lib/scan-session.ts";

// The work folder comes from the macOS picker, never from the request body.
// Only JSON requests: a cross-site page cannot send JSON without a CORS preflight, which this route never approves.
export async function POST(req: Request) {
  if (req.headers.get("content-type") !== "application/json") {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }
  await req.json().catch(() => undefined);

  const picked = await chooseFolder("Scan a work folder");
  switch (picked.kind) {
    case "cancelled":
      return Response.json({ cancelled: true });
    case "error":
      return Response.json({ error: picked.error }, { status: 500 });
    case "path":
      break;
    default: {
      const unreachable: never = picked;
      return unreachable;
    }
  }

  try {
    const scanned = await scanWorkFolder(picked.path, loadConfig().repos);
    if (!scanned.ok) return Response.json({ error: scanned.error }, { status: 400 });
    rememberScan(scanned.hits);
    return Response.json({ hits: scanned.hits });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not scan the folder." }, { status: 500 });
  }
}
