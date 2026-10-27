// Writes a launchd agent that runs the board at login and restarts it if it exits.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const label = "local.branchboard";
const root = process.cwd();
const plistPath = join(homedir(), "Library/LaunchAgents", `${label}.plist`);

function plist() {
  const logs = join(root, ".branchboard", "logs");
  mkdirSync(logs, { recursive: true });
  const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
  const path = `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>WorkingDirectory</key>
  <string>${root}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${nextBin}</string>
    <string>dev</string>
    <string>-H</string>
    <string>127.0.0.1</string>
    <string>-p</string>
    <string>3000</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(logs, "launchd.out.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(logs, "launchd.err.log")}</string>
</dict>
</plist>
`;
}

const uid = process.getuid?.();
if (uid == null) {
  console.error("install-service only works on macOS");
  process.exit(1);
}
writeFileSync(plistPath, plist());
spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "ignore" });
const boot = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { encoding: "utf8" });
if (boot.status !== 0) {
  console.error(boot.stderr || "launchctl bootstrap failed");
  process.exit(boot.status ?? 1);
}
console.log(`Installed ${plistPath}`);
console.log("Branch Board will start at login on http://127.0.0.1:3000 and restart if it exits.");
