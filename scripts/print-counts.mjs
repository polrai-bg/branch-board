import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";

const file = join(process.cwd(), ".branchboard", "cache.db");
if (!existsSync(file)) {
  console.error("No cache yet. Refresh the board once, then run this again.");
  process.exit(1);
}

const db = new Database(file, { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT day, repo, metric, count FROM daily_counts ORDER BY day, repo, metric").all();
if (rows.length === 0) {
  console.log("No daily counts stored yet.");
  process.exit(0);
}

const today = localDay();
const totals = {};
for (const row of rows) {
  console.log(`${row.day}\t${row.repo}\t${row.metric}\t${row.count}`);
  if (row.day !== today) continue;
  totals[row.metric] = (totals[row.metric] ?? 0) + row.count;
}

function localDay(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
console.log(`# ${today} totals`);
for (const [metric, count] of Object.entries(totals)) console.log(`${today}\t*\t${metric}\t${count}`);
