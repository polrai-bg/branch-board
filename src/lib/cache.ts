// Snapshot plus one daily-count row per repo per metric. Plain SQL only.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IssueInfo, LocalRecord, RemoteBranch } from "./merge.ts";

export type Snapshot = {
  takenAt: string | null;
  branches: RemoteBranch[];
  locals: LocalRecord[];
  issues: IssueInfo[];
  errors: { message: string; setup?: boolean }[];
};

export type CountRow = { day: string; repo: string; metric: string; count: number };

export type CacheStore = {
  readSnapshot: () => Snapshot;
  writeSnapshot: (snapshot: Snapshot) => void;
  writeDailyCounts: (day: string, entries: { repo: string; metric: string; count: number }[]) => void;
  readDailyCounts: () => CountRow[];
  close: () => void;
};

type SnapshotRow = { taken_at: string; branches: string; errors: string; locals: string | null; issues: string | null };

function migrate(database: Database.Database) {
  database.exec("CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), taken_at TEXT, branches TEXT, errors TEXT)");
  const columns = database.prepare("PRAGMA table_info(snapshot)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "locals")) database.exec("ALTER TABLE snapshot ADD COLUMN locals TEXT");
  if (!columns.some((column) => column.name === "issues")) database.exec("ALTER TABLE snapshot ADD COLUMN issues TEXT");
  database.exec(
    "CREATE TABLE IF NOT EXISTS daily_counts (day TEXT NOT NULL, repo TEXT NOT NULL, metric TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, repo, metric))",
  );
}

function emptySnapshot(): Snapshot {
  return { takenAt: null, branches: [], locals: [], issues: [], errors: [] };
}

export function createCache(file: string): CacheStore {
  const database = new Database(file);
  migrate(database);
  return {
    readSnapshot() {
      const row = database.prepare("SELECT taken_at, branches, errors, locals, issues FROM snapshot WHERE id = 1").get() as SnapshotRow | undefined;
      if (!row) return emptySnapshot();
      return {
        takenAt: row.taken_at,
        branches: JSON.parse(row.branches),
        errors: JSON.parse(row.errors),
        locals: row.locals ? JSON.parse(row.locals) : [],
        issues: row.issues ? JSON.parse(row.issues) : [],
      };
    },
    writeSnapshot(snapshot) {
      database
        .prepare("INSERT OR REPLACE INTO snapshot (id, taken_at, branches, errors, locals, issues) VALUES (1, ?, ?, ?, ?, ?)")
        .run(snapshot.takenAt, JSON.stringify(snapshot.branches), JSON.stringify(snapshot.errors), JSON.stringify(snapshot.locals), JSON.stringify(snapshot.issues));
    },
    writeDailyCounts(day, entries) {
      const replace = database.transaction(() => {
        database.prepare("DELETE FROM daily_counts WHERE day = ?").run(day);
        const insert = database.prepare("INSERT INTO daily_counts (day, repo, metric, count) VALUES (?, ?, ?, ?)");
        for (const entry of entries) insert.run(day, entry.repo, entry.metric, entry.count);
      });
      replace();
    },
    readDailyCounts() {
      return database.prepare("SELECT day, repo, metric, count FROM daily_counts ORDER BY day, repo, metric").all() as CountRow[];
    },
    close() {
      database.close();
    },
  };
}

const g = globalThis as unknown as { bbCache?: CacheStore };

function store() {
  if (!g.bbCache) {
    const dir = join(process.cwd(), ".branchboard");
    mkdirSync(dir, { recursive: true });
    g.bbCache = createCache(join(dir, "cache.db"));
  }
  return g.bbCache;
}

export function readSnapshot(): Snapshot {
  return store().readSnapshot();
}

export function writeSnapshot(snapshot: Snapshot) {
  store().writeSnapshot(snapshot);
}

export function writeDailyCounts(day: string, entries: { repo: string; metric: string; count: number }[]) {
  store().writeDailyCounts(day, entries);
}

export function readDailyCounts(): CountRow[] {
  return store().readDailyCounts();
}

export function localDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
