import { localDay, readDailyCounts } from "@/lib/cache.ts";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = readDailyCounts();
  const today = localDay();
  const totals: Record<string, number> = {};
  for (const row of rows) {
    if (row.day !== today) continue;
    totals[row.metric] = (totals[row.metric] ?? 0) + row.count;
  }
  return Response.json({ today, totals, rows });
}
