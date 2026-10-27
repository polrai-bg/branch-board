// Small helper on port 3010. The Desktop icon opens launcher/index.html, and Start calls this.
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 3010;

function boardUp() {
  return new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port: 3000, method: "GET", timeout: 500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

const starting = `<!doctype html>
<meta charset="utf-8">
<title>Branch Board</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; height: 100vh; display: grid; place-items: center;
    font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
</style>
<p>Starting…</p>
<script>
  async function up() {
    try {
      await fetch("http://127.0.0.1:3000/", { mode: "no-cors", cache: "no-store" });
      return true;
    } catch {
      return false;
    }
  }
  (async () => {
    for (;;) {
      if (await up()) {
        location.replace("http://127.0.0.1:3000/");
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
</script>
`;

function startBoard() {
  const child = spawn("npm", ["run", "dev"], { cwd: root, detached: true, stdio: "ignore" });
  child.unref();
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && req.url === "/start") {
    if (!(await boardUp())) startBoard();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(starting);
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1");
