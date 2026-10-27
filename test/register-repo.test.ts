import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rememberScan, selectableScanPaths } from "../src/lib/scan-session.ts";
import { basesFromRefNames, decideRepoEntry, githubRepoFromOrigin, registerFolder, registerFolders, removeRepos, scanWorkFolder } from "../src/lib/register-repo.ts";

const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, env });
}

async function initRepo(folder: string) {
  await mkdir(folder, { recursive: true });
  git(folder, ["init", "-b", "main"]);
  git(folder, ["commit", "--allow-empty", "-m", "init"]);
}

function configText(repos: { name: string; localPath: string | null; bases?: string[] }[]) {
  return `${JSON.stringify(
    {
      github: { owner: "example-owner", note: "keep" },
      repos: repos.map((repo) => ({ ...repo, note: "keep-repo" })),
      agents: [{ prefix: "cursor/", agent: "Cursor" }],
      zoom: true,
    },
    null,
    2,
  )}\n`;
}

test("github origin urls and base ref order", () => {
  assert.deepEqual(githubRepoFromOrigin("https://github.com/example-owner/demo-widget.git"), { owner: "example-owner", name: "demo-widget" });
  assert.deepEqual(githubRepoFromOrigin("git@github.com:example-owner/demo-widget.git"), { owner: "example-owner", name: "demo-widget" });
  assert.equal(githubRepoFromOrigin("https://gitlab.com/example-owner/demo-widget.git"), null);
  assert.deepEqual(basesFromRefNames(["refs/heads/development", "refs/remotes/origin/main"]), ["main", "development"]);
  assert.deepEqual(basesFromRefNames(["refs/heads/topic"]), ["main"]);
});

test("a temp git repo detects the GitHub name and base refs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-add-repo-"));
  try {
    const folder = join(dir, "checkout");
    await mkdir(folder);
    git(folder, ["init", "-b", "main"]);
    git(folder, ["commit", "--allow-empty", "-m", "init"]);
    git(folder, ["remote", "add", "origin", "https://github.com/example-owner/demo-widget.git"]);
    git(folder, ["update-ref", "refs/remotes/origin/development", "HEAD"]);

    const https = await decideRepoEntry(folder, { owner: "example-owner", repos: [] });
    assert.equal(https.ok, true);
    if (!https.ok) return;
    assert.equal(https.entry.name, "demo-widget");
    assert.equal(https.entry.localPath, folder);
    assert.deepEqual(https.entry.bases, ["main", "development"]);
    assert.equal(https.notice, null);

    git(folder, ["remote", "set-url", "origin", "git@github.com:example-owner/demo-widget.git"]);
    const ssh = await decideRepoEntry(`${folder}/`, { owner: "example-owner", repos: [] });
    assert.equal(ssh.ok, true);
    if (!ssh.ok) return;
    assert.equal(ssh.entry.name, "demo-widget");
    assert.equal(ssh.entry.localPath, folder);
    assert.deepEqual(ssh.entry.bases, ["main", "development"]);

    const plain = join(dir, "plain-folder");
    await mkdir(plain);
    git(plain, ["init", "-b", "topic"]);
    git(plain, ["commit", "--allow-empty", "-m", "init"]);
    const fallback = await decideRepoEntry(plain, { owner: "example-owner", repos: [] });
    assert.equal(fallback.ok, true);
    if (!fallback.ok) return;
    assert.equal(fallback.entry.name, "plain-folder");
    assert.deepEqual(fallback.entry.bases, ["main"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a folder that is not a git repo is refused and config is not written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-add-norepo-"));
  const folder = join(dir, "notes");
  const configPath = join(dir, "branchboard.config.json");
  const original = configText([{ name: "demo-repo", localPath: null, bases: ["main"] }]);
  try {
    await mkdir(folder);
    await writeFile(configPath, original);
    const decision = await registerFolder(folder, configPath);
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.match(decision.error, /Not a git repository/);
    assert.match(decision.error, /notes/);
    assert.equal(await readFile(configPath, "utf8"), original);

    const nested = join(dir, "checkout", "src");
    await mkdir(join(dir, "checkout"));
    git(join(dir, "checkout"), ["init", "-b", "main"]);
    git(join(dir, "checkout"), ["commit", "--allow-empty", "-m", "init"]);
    await mkdir(nested);
    const inside = await registerFolder(nested, configPath);
    assert.equal(inside.ok, false);
    if (inside.ok) return;
    assert.match(inside.error, /Not a git repository/);
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a duplicate name or local path is refused and config is not written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-add-dup-"));
  const folder = join(dir, "checkout");
  try {
    await mkdir(folder);
    git(folder, ["init", "-b", "main"]);
    git(folder, ["commit", "--allow-empty", "-m", "init"]);
    git(folder, ["remote", "add", "origin", "https://github.com/example-owner/demo-widget.git"]);

    const nameConfig = join(dir, "name.json");
    const nameOriginal = configText([{ name: "demo-widget", localPath: join(dir, "other"), bases: ["main"] }]);
    await writeFile(nameConfig, nameOriginal);
    const byName = await registerFolder(folder, nameConfig);
    assert.equal(byName.ok, false);
    if (byName.ok) return;
    assert.match(byName.error, /name "demo-widget"/);
    assert.equal(byName.error.includes("local path"), false);
    assert.equal(await readFile(nameConfig, "utf8"), nameOriginal);

    const pathConfig = join(dir, "path.json");
    const pathOriginal = configText([{ name: "other-repo", localPath: folder, bases: ["main"] }]);
    await writeFile(pathConfig, pathOriginal);
    const byPath = await registerFolder(folder, pathConfig);
    assert.equal(byPath.ok, false);
    if (byPath.ok) return;
    assert.match(byPath.error, /local path/);
    assert.match(byPath.error, /checkout/);
    assert.equal(byPath.error.includes('name "demo-widget"'), false);
    assert.equal(await readFile(pathConfig, "utf8"), pathOriginal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a different origin owner is noted, the folder is still added, and existing keys stay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-add-owner-"));
  const folder = join(dir, "checkout");
  const configPath = join(dir, "branchboard.config.json");
  const original = configText([{ name: "demo-repo", localPath: null, bases: ["main"] }]);
  try {
    await mkdir(folder);
    git(folder, ["init", "-b", "development"]);
    git(folder, ["commit", "--allow-empty", "-m", "init"]);
    git(folder, ["remote", "add", "origin", "git@github.com:other-owner/demo-widget.git"]);
    await writeFile(configPath, original);

    const decision = await registerFolder(folder, configPath);
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.entry.name, "demo-widget");
    assert.deepEqual(decision.entry.bases, ["development"]);
    assert.match(decision.notice ?? "", /other-owner\/demo-widget/);
    assert.match(decision.notice ?? "", /example-owner/);

    const written = await readFile(configPath, "utf8");
    assert.equal(written.endsWith("\n"), true);
    const before = JSON.parse(original) as { github: { owner: string; note: string }; repos: { note: string }[]; zoom: boolean };
    const after = JSON.parse(written) as {
      github: { owner: string; note: string };
      repos: { name: string; localPath: string | null; bases: string[]; note?: string }[];
      agents: unknown[];
      zoom: boolean;
    };
    assert.deepEqual(Object.keys(after), Object.keys(before));
    assert.equal(after.github.owner, "example-owner");
    assert.equal(after.github.note, "keep");
    assert.equal(after.zoom, true);
    assert.equal(after.repos[0].name, "demo-repo");
    assert.equal(after.repos[0].note, "keep-repo");
    assert.equal(after.repos.length, 2);
    assert.deepEqual(Object.keys(after.repos[1]), ["name", "localPath", "bases"]);
    assert.equal(after.repos[1].name, "demo-widget");
    assert.equal(after.repos[1].localPath, folder);
    assert.deepEqual(after.repos[1].bases, ["development"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a work folder scan returns only child git repos and marks a configured path added", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-scan-"));
  const work = join(dir, "work");
  const alpha = join(work, "alpha");
  const beta = join(work, "beta");
  const hidden = join(work, ".hidden-repo");
  const nested = join(work, "notes", "nested");
  try {
    await mkdir(work);
    await mkdir(join(work, "notes"));
    await writeFile(join(work, "readme.txt"), "notes");
    const empty = await scanWorkFolder(work, []);
    assert.equal(empty.ok, true);
    if (!empty.ok) return;
    assert.deepEqual(empty.hits, []);

    await initRepo(alpha);
    await initRepo(beta);
    git(beta, ["remote", "add", "origin", "https://github.com/example-owner/beta-widget.git"]);
    await initRepo(hidden);
    await initRepo(nested);

    const scanned = await scanWorkFolder(work, [{ localPath: alpha }]);
    assert.equal(scanned.ok, true);
    if (!scanned.ok) return;
    assert.deepEqual(
      scanned.hits.map((hit) => ({ name: hit.name, path: hit.path, added: hit.added })),
      [
        { name: "alpha", path: alpha, added: true },
        { name: "beta-widget", path: beta, added: false },
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bulk add appends only the checked repos and does not duplicate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-scan-add-"));
  const work = join(dir, "work");
  const alpha = join(work, "alpha");
  const beta = join(work, "beta");
  const gamma = join(work, "gamma");
  const configPath = join(dir, "branchboard.config.json");
  const original = configText([{ name: "alpha", localPath: alpha, bases: ["main"] }]);
  try {
    await initRepo(alpha);
    await initRepo(beta);
    git(beta, ["remote", "add", "origin", "git@github.com:other-owner/beta-widget.git"]);
    git(beta, ["update-ref", "refs/remotes/origin/development", "HEAD"]);
    await initRepo(gamma);
    await mkdir(join(work, "notes"));
    await writeFile(configPath, original);

    const checked = await registerFolders([beta, gamma], configPath);
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.deepEqual(
      checked.added.map((entry) => entry.name),
      ["beta-widget", "gamma"],
    );
    assert.deepEqual(checked.added[0]?.bases, ["main", "development"]);
    assert.deepEqual(checked.added[1]?.bases, ["main"]);
    assert.match(checked.notices[0] ?? "", /other-owner\/beta-widget/);
    assert.match(checked.notices[0] ?? "", /example-owner/);
    assert.equal(checked.skipped.length, 0);

    const written = await readFile(configPath, "utf8");
    assert.equal(written.endsWith("\n"), true);
    const after = JSON.parse(written) as {
      github: { owner: string; note: string };
      repos: { name: string; localPath: string | null; bases: string[]; note?: string }[];
      zoom: boolean;
    };
    assert.equal(after.github.owner, "example-owner");
    assert.equal(after.github.note, "keep");
    assert.equal(after.zoom, true);
    assert.equal(after.repos.length, 3);
    assert.equal(after.repos[0].name, "alpha");
    assert.equal(after.repos[0].localPath, alpha);
    assert.equal(after.repos[0].note, "keep-repo");
    assert.equal(after.repos.filter((repo) => repo.localPath === alpha).length, 1);
    assert.deepEqual(Object.keys(after.repos[1]), ["name", "localPath", "bases"]);
    assert.equal(after.repos[1].name, "beta-widget");
    assert.equal(after.repos[1].localPath, beta);
    assert.deepEqual(after.repos[1].bases, ["main", "development"]);
    assert.equal(after.repos[2].name, "gamma");
    assert.equal(after.repos[2].localPath, gamma);
    assert.equal(after.repos.some((repo) => String(repo.localPath).endsWith("/notes")), false);

    const snapshot = written;
    const again = await registerFolders([alpha, beta, gamma], configPath);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.added.length, 0);
    assert.equal(again.skipped.length, 3);
    assert.equal(await readFile(configPath, "utf8"), snapshot);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeRepos drops a named repo and keeps the rest of the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-remove-"));
  const configPath = join(dir, "branchboard.config.json");
  try {
    const original = configText([
      { name: "alpha", localPath: "/tmp/alpha", bases: ["main"] },
      { name: "beta", localPath: "/tmp/beta", bases: ["main", "development"] },
    ]);
    await writeFile(configPath, original);
    const gone = removeRepos(["beta"], configPath);
    assert.equal(gone.ok, true);
    const after = JSON.parse(await readFile(configPath, "utf8")) as { github: { note: string }; repos: { name: string }[]; zoom: boolean };
    assert.deepEqual(after.repos.map((repo) => repo.name), ["alpha"]);
    assert.equal(after.github.note, "keep");
    assert.equal(after.zoom, true);
    const last = removeRepos(["alpha"], configPath);
    assert.equal(last.ok, false);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")).repos.map((repo: { name: string }) => repo.name), ["alpha"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("add selected keeps paths that the last scan did not already include", () => {
  rememberScan([
    { path: "/tmp/bb-alpha", added: true },
    { path: "/tmp/bb-beta", added: false },
  ]);
  try {
    assert.deepEqual(selectableScanPaths(["/tmp/bb-beta", "/tmp/bb-alpha", "/tmp/bb-other", "/tmp/bb-beta"]), ["/tmp/bb-beta"]);
  } finally {
    rememberScan([]);
  }
});
