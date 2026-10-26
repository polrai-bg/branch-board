import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createCache, localDay } from "../src/lib/cache.ts";

test("local day uses the calendar date", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 30, 0)), "2026-01-05");
});

test("daily counts: last write for the day wins, and an old snapshot still opens", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-cache-"));
  const file = join(dir, "cache.db");
  try {
    const legacy = new Database(file);
    legacy.exec("CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), taken_at TEXT, branches TEXT, errors TEXT)");
    legacy.prepare("INSERT INTO snapshot (id, taken_at, branches, errors) VALUES (1, 'then', '[]', '[]')").run();
    legacy.close();

    const cache = createCache(file);
    const opened = cache.readSnapshot();
    assert.equal(opened.takenAt, "then");
    assert.deepEqual(opened.locals, []);
    assert.deepEqual(opened.issues, []);

    cache.writeDailyCounts("2026-01-20", [{ repo: "demo-repo", metric: "Orphan", count: 4 }]);
    cache.writeDailyCounts("2026-01-20", [
      { repo: "demo-repo", metric: "Orphan", count: 0 },
      { repo: "demo-repo", metric: "Empty", count: 1 },
    ]);
    const counts = cache.readDailyCounts();
    assert.equal(counts.find((row) => row.metric === "Orphan")?.count, 0);
    assert.equal(counts.find((row) => row.metric === "Empty")?.count, 1);
    assert.equal(counts.filter((row) => row.metric === "Orphan").length, 1);
    cache.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
