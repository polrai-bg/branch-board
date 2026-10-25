// One-row snapshot table. Plain SQL only, so it can move to Cloudflare D1 later.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RemoteBranch } from "./merge.ts";

export type Snapshot = {
  takenAt: string | null;
  branches: RemoteBranch[];
  errors: { message: string; setup?: boolean }[];
};

const g = globalThis as unknown as { bbDb?: Database.Database };

function db() {
  if (!g.bbDb) {
    const dir = join(process.cwd(), ".branchboard");
    mkdirSync(dir, { recursive: true });
    g.bbDb = new Database(join(dir, "cache.db"));
    g.bbDb.exec("CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), taken_at TEXT, branches TEXT, errors TEXT)");
  }
  return g.bbDb;
}

export function readSnapshot(): Snapshot {
  const row = db().prepare("SELECT taken_at, branches, errors FROM snapshot WHERE id = 1").get() as
    | { taken_at: string; branches: string; errors: string }
    | undefined;
  if (!row) return { takenAt: null, branches: [], errors: [] };
  return { takenAt: row.taken_at, branches: JSON.parse(row.branches), errors: JSON.parse(row.errors) };
}

export function writeSnapshot(s: Snapshot) {
  db()
    .prepare("INSERT OR REPLACE INTO snapshot (id, taken_at, branches, errors) VALUES (1, ?, ?, ?)")
    .run(s.takenAt, JSON.stringify(s.branches), JSON.stringify(s.errors));
}
