import { refresh } from "@/lib/refresh.ts";

export async function POST() {
  const snap = await refresh();
  return Response.json({ takenAt: snap.takenAt, errors: snap.errors });
}
