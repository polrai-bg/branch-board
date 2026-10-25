import { readSnapshot } from "@/lib/cache.ts";
import { loadConfig } from "@/lib/config.ts";
import { buildRows } from "@/lib/merge.ts";

export const dynamic = "force-dynamic";

// Rows are built at read time so config edits (overrides, staleDays) and "days ago" are always current.
export function GET() {
  const cfg = loadConfig();
  const snap = readSnapshot();
  return Response.json({
    owner: cfg.github.owner,
    takenAt: snap.takenAt,
    errors: snap.errors,
    hideMergedByDefault: cfg.hideMergedByDefault,
    rows: buildRows(cfg, snap.branches),
  });
}
