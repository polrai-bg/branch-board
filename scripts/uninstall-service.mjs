import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const label = "local.branchboard";
const plistPath = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
const uid = process.getuid?.();
if (uid != null) spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "ignore" });
rmSync(plistPath, { force: true });
console.log(`Removed ${plistPath}`);
