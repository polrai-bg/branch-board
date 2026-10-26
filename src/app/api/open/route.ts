import { execFile } from "node:child_process";
import { readSnapshot } from "@/lib/cache.ts";

// Opens a folder in Finder. Browsers block file:// links from a web page, so the server does it.
// Only folders the last local scan reported, and only JSON requests: a cross-site page cannot send JSON
// without a CORS preflight, which this route never approves.
export async function POST(req: Request) {
  if (req.headers.get("content-type") !== "application/json") {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }
  const { path } = await req.json().catch(() => ({}));
  const known = typeof path === "string" && readSnapshot().locals.some((local) => local.localPath === path);
  if (!known) return Response.json({ error: "Not a folder from the last scan" }, { status: 400 });
  return new Promise<Response>((resolve) =>
    execFile("open", [path], (error) => resolve(error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ ok: true }))),
  );
}
