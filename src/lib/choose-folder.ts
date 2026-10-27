import { execFile } from "node:child_process";

export type PickedFolder = { kind: "path"; path: string } | { kind: "cancelled" } | { kind: "error"; error: string };

// macOS folder picker. The path comes from this dialog, never from a request body.
export function chooseFolder(prompt: string): Promise<PickedFolder> {
  const script = `POSIX path of (choose folder with prompt "${prompt}")`;
  return new Promise((resolve) => {
    execFile("osascript", ["-e", script], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) {
        const path = String(stdout ?? "").trim();
        if (!path) resolve({ kind: "error", error: "The folder picker returned an empty path." });
        else resolve({ kind: "path", path });
        return;
      }
      const detail = `${stderr ?? ""}\n${error.message}`;
      if (detail.includes("User canceled") || detail.includes("-128")) {
        resolve({ kind: "cancelled" });
        return;
      }
      resolve({ kind: "error", error: stderr?.trim() || error.message });
    });
  });
}
