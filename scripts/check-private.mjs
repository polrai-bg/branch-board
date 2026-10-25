// Fails if any staged file contains the owner or a localPath from the ignored real config.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

if (!existsSync("branchboard.config.json")) process.exit(0);
const cfg = JSON.parse(readFileSync("branchboard.config.json", "utf8"));
const needles = [cfg.github?.owner, ...cfg.repos.map((r) => r.name), ...cfg.repos.flatMap((r) => (r.localPath ? [r.localPath, r.localPath.replace(/^~/, homedir())] : []))]
  .filter((s) => s && s.length > 3);

const files = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

let bad = false;
for (const f of files) {
  const text = execFileSync("git", ["show", `:${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const n of needles) {
    if (text.toLowerCase().includes(n.toLowerCase())) {
      console.error(`pre-commit: ${f} contains a private value from branchboard.config.json`);
      bad = true;
    }
  }
}
process.exit(bad ? 1 : 0);
