import { join } from "node:path";
import { CONFIG_FILE } from "@/lib/config.ts";
import { chooseFolder } from "@/lib/choose-folder.ts";
import { registerFolder } from "@/lib/register-repo.ts";

// The folder comes from the macOS picker, never from the request body.
// Only JSON requests: a cross-site page cannot send JSON without a CORS preflight, which this route never approves.
export async function POST(req: Request) {
  if (req.headers.get("content-type") !== "application/json") {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }
  // Drain whatever the page sent. A path in this body is ignored.
  await req.json().catch(() => undefined);

  const picked = await chooseFolder("Add a repository");
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
    const result = await registerFolder(picked.path, join(process.cwd(), CONFIG_FILE));
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true, notice: result.notice });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the config." }, { status: 500 });
  }
}
