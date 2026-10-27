"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Flag, Row } from "@/lib/merge.ts";
import { FLAG_ORDER, STATUS_ORDER, UNFINISHED_STATUSES, sectionOf } from "@/lib/merge.ts";

type Data = {
  owner: string;
  takenAt: string | null;
  errors: { message: string; setup?: boolean }[];
  hideMergedByDefault: boolean;
  rows: Row[];
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

const days = (d: number) => (d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`);

// Browsers block file:// links, so the server opens the folder. If that fails, copy the path instead.
async function openFolder(path: string) {
  const res = await fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) }).catch(() => null);
  if (res?.ok) return;
  await navigator.clipboard.writeText(path).catch(() => {});
  alert(`Could not open the folder. Path copied:\n${path}`);
}

function displayPath(path: string) {
  const home = /^\/Users\/[^/]+/.exec(path);
  return home ? `~${path.slice(home[0].length)}` : path;
}

type ScanHit = { name: string; path: string; added: boolean };

function isScanHit(value: unknown): value is ScanHit {
  if (!value || typeof value !== "object") return false;
  const hit = value as ScanHit;
  return typeof hit.name === "string" && typeof hit.path === "string" && typeof hit.added === "boolean";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function skipErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const errors: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const error = (item as { error?: unknown }).error;
    if (typeof error === "string" && error) errors.push(error);
  }
  return errors;
}

function branchLabel(row: Row) {
  if (!row.detached) return row.name;
  const path = row.localPath ?? row.name;
  return path.split("/").filter(Boolean).pop() || path;
}

function matchesFlag(row: Row, flag: string) {
  if (!flag) return true;
  if (flag === "Unfinished local") return UNFINISHED_STATUSES.includes(row.status);
  return row.flags.includes(flag as Flag);
}

// Same priority as actionRank, so a section never splits. Bases sit after Merged.
function groupOf(row: Row): string {
  return sectionOf(row);
}

export default function Board() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repo, setRepo] = useState("");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState("");
  const [flag, setFlag] = useState("");
  const [search, setSearch] = useState("");
  const [hideMerged, setHideMerged] = useState<boolean | null>(null);
  const [picking, setPicking] = useState<"add" | "scan" | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reposOpen, setReposOpen] = useState(false);
  const [configured, setConfigured] = useState<{ name: string; localPath: string | null; bases: string[] }[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [hits, setHits] = useState<ScanHit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/branches", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/branches returned ${res.status}`);
      const next: Data = await res.json();
      setData(next);
      setHideMerged((current) => current ?? next.hideMergedByDefault);
      setLoadError(null);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  const refreshNow = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      await load();
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const loadConfigured = useCallback(async () => {
    const res = await fetch("/api/repos", { cache: "no-store" });
    const body = (await res.json()) as { repos?: { name: string; localPath: string | null; bases: string[] }[]; error?: string };
    if (!res.ok) throw new Error(body.error || `Repos failed (${res.status})`);
    setConfigured(body.repos ?? []);
  }, []);

  const showRepos = useCallback(async () => {
    setReposOpen(true);
    try {
      await loadConfigured();
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, [loadConfigured]);

  const removeRepo = useCallback(
    async (name: string) => {
      setNote(null);
      try {
        const res = await fetch("/api/repos", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(body?.error || `Remove failed (${res.status})`);
        await loadConfigured();
        await refreshNow();
      } catch (error) {
        setLoadError((error as Error).message);
      }
    },
    [loadConfigured, refreshNow],
  );

  const addFolder = useCallback(async () => {
    setPicking("add");
    setNote(null);
    try {
      const res = await fetch("/api/add-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => null)) as { error?: unknown; notice?: unknown; cancelled?: unknown } | null;
      if (body?.cancelled === true) return;
      if (!res.ok) {
        const message = typeof body?.error === "string" ? body.error : `Add folder failed (${res.status})`;
        throw new Error(message);
      }
      setPicking(null);
      await refreshNow();
      await loadConfigured();
      if (typeof body?.notice === "string" && body.notice) setNote(body.notice);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setPicking(null);
    }
  }, [loadConfigured, refreshNow]);

  const scanFolder = useCallback(async () => {
    setPicking("scan");
    try {
      const res = await fetch("/api/scan-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => null)) as { error?: unknown; cancelled?: unknown; hits?: unknown } | null;
      if (body?.cancelled === true) return;
      if (!res.ok) {
        const message = typeof body?.error === "string" ? body.error : `Scan folder failed (${res.status})`;
        throw new Error(message);
      }
      setNote(null);
      setLoadError(null);
      setHits(Array.isArray(body?.hits) ? body.hits.filter(isScanHit) : []);
      setSelected(new Set());
      setScanOpen(true);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setPicking(null);
    }
  }, []);

  const addSelected = useCallback(async () => {
    const paths = hits.filter((hit) => !hit.added && selected.has(hit.path)).map((hit) => hit.path);
    if (paths.length === 0) return;
    setAdding(true);
    setNote(null);
    try {
      const res = await fetch("/api/add-repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      const body = (await res.json().catch(() => null)) as { error?: unknown; notices?: unknown; skipped?: unknown; added?: unknown } | null;
      if (!res.ok) {
        const message = typeof body?.error === "string" ? body.error : `Add repos failed (${res.status})`;
        throw new Error(message);
      }
      const added = Array.isArray(body?.added) ? body.added : [];
      const followup = [...stringList(body?.notices), ...skipErrors(body?.skipped)];
      if (added.length === 0) {
        setLoadError(followup.join(" ") || "Nothing was added.");
        return;
      }
      setScanOpen(false);
      setHits([]);
      setSelected(new Set());
      await refreshNow();
      await loadConfigured();
      if (followup.length > 0) setNote(followup.join(" "));
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setAdding(false);
    }
  }, [hits, loadConfigured, refreshNow, selected]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      await load();
      if (!cancel) await refreshNow();
    })();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [load, refreshNow]);

  const rows = data?.rows ?? [];
  const repos = useMemo(() => [...new Set(rows.map((row) => row.repo))].sort(), [rows]);
  const agents = useMemo(() => [...new Set(rows.map((row) => row.agent))].sort(), [rows]);
  const visible = rows.filter(
    (row) =>
      (!repo || row.repo === repo) &&
      (!agent || row.agent === agent) &&
      (!status || row.status === status) &&
      matchesFlag(row, flag) &&
      (!search || row.name.toLowerCase().includes(search.toLowerCase()) || (row.localPath?.toLowerCase().includes(search.toLowerCase()) ?? false)) &&
      (!hideMerged || status === "Merged" || row.status !== "Merged"),
  );

  const locked = busy || picking !== null || adding;
  const selectable = hits.filter((hit) => !hit.added);
  const failures: { message: string; setup?: boolean }[] = [...(data?.errors ?? []), ...(loadError ? [{ message: loadError }] : [])];
  const errors: { message: string; setup?: boolean }[] = [...failures, ...(note ? [{ message: note }] : [])];
  const gh = `https://github.com/${data?.owner}`;
  const groups: { name: string; rows: Row[] }[] = [];
  for (const row of visible) {
    const name = groupOf(row);
    const last = groups.at(-1);
    if (last?.name === name) last.rows.push(row);
    else groups.push({ name, rows: [row] });
  }

  return (
    <main className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="title">Branch Board</span>
          <span className="sub">Updated {ago(data?.takenAt ?? null)}</span>
        </div>
        <input className="search" type="search" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="check">
          <input type="checkbox" checked={!!hideMerged} onChange={(event) => setHideMerged(event.target.checked)} />
          Hide merged
        </label>
        <div className="actions">
          <button className="push" type="button" onClick={() => void showRepos()}>
            Repos
          </button>
          <button className="push" type="button" title="Add Folder" onClick={() => void addFolder()} disabled={locked}>
            {picking === "add" ? "Choosing…" : "Add…"}
          </button>
          <button className="push" type="button" title="Scan Folder" onClick={() => void scanFolder()} disabled={locked}>
            {picking === "scan" ? "Scanning…" : "Scan…"}
          </button>
          <button className="push" onClick={() => void refreshNow()} disabled={locked}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {reposOpen && (
        <section className="scan" aria-label="Configured repositories">
          <ul className="scan-list">
            {configured.map((item) => (
              <li key={item.name} className="scan-row">
                <div className="check">
                  <span className="scan-name">{item.name}</span>
                  <span className="scan-path" title={item.localPath ?? ""}>
                    {item.localPath ? displayPath(item.localPath) : "No local folder"}
                  </span>
                  <span className="sub">{item.bases.join(", ")}</span>
                  <button className="push" type="button" disabled={locked || configured.length < 2} onClick={() => void removeRepo(item.name)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="scan-actions">
            <button className="push" type="button" onClick={() => void addFolder()} disabled={locked}>
              Add…
            </button>
            <button className="push" type="button" onClick={() => void scanFolder()} disabled={locked}>
              Scan…
            </button>
            <button className="push" type="button" onClick={() => setReposOpen(false)}>
              Dismiss
            </button>
          </div>
        </section>
      )}

      {scanOpen && (
        <section className="scan" aria-label="Repositories in this folder">
          {hits.length === 0 ? (
            <p className="empty">No git repos were in that folder.</p>
          ) : (
            <ul className="scan-list">
              {hits.map((hit) => (
                <li key={hit.path} className={hit.added ? "scan-row is-added" : "scan-row"}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!hit.added && selected.has(hit.path)}
                      disabled={hit.added || locked}
                      onChange={() => {
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(hit.path)) next.delete(hit.path);
                          else next.add(hit.path);
                          return next;
                        });
                      }}
                    />
                    <span className="scan-name">{hit.name}</span>
                    <span className="scan-path" title={hit.path}>
                      {displayPath(hit.path)}
                    </span>
                    {hit.added && <span className="sub">added</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="scan-actions">
            {hits.length > 0 && (
              <>
                <button
                  className="push"
                  type="button"
                  disabled={locked || selectable.length === 0}
                  onClick={() => setSelected(new Set(selectable.map((hit) => hit.path)))}
                >
                  Select all
                </button>
                <button className="push" type="button" disabled={locked || selected.size === 0} onClick={() => void addSelected()}>
                  {adding ? "Adding…" : "Add selected"}
                </button>
              </>
            )}
            <button className="push" type="button" disabled={adding || picking === "scan"} onClick={() => { setScanOpen(false); setHits([]); setSelected(new Set()); }}>
              Dismiss
            </button>
          </div>
        </section>
      )}

      {errors.length > 0 && (
        <div role="alert" className="alert">
          {errors.map((error, index) => (
            <div key={index}>
              {error.message}
              {error.setup && <span> See the Setup section of README.md.</span>}
            </div>
          ))}
          {data && failures.length > 0 && <div>Showing the last good data.</div>}
        </div>
      )}

      <div className="scope">
        <select aria-label="Repo" value={repo} onChange={(event) => setRepo(event.target.value)}>
          <option value="">All repos</option>
          {repos.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select aria-label="Agent" value={agent} onChange={(event) => setAgent(event.target.value)}>
          <option value="">All agents</option>
          {agents.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {STATUS_ORDER.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select aria-label="Flag" value={flag} onChange={(event) => setFlag(event.target.value)}>
          <option value="">All flags</option>
          {[...FLAG_ORDER, "Unfinished local"].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <span className="sub grow">
          {visible.length} of {rows.length}
        </span>
      </div>

      <div className="sheet">
        <table>
          <thead>
            <tr>
              {["Repo", "Branch", "Issue", "Agent", "Status", "Flags", "Base", "Ahead", "Behind", "Last commit", "Where", "PR", "Local path"].map((heading) => (
                <th key={heading} className={heading === "Ahead" || heading === "Behind" ? "num" : undefined}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((group) => [
              <tr key={group.name} className="group">
                <td colSpan={13}>
                  {group.name}
                  <span className="n">{group.rows.length}</span>
                </td>
              </tr>,
              ...group.rows.map((row) => (
                <tr key={`${row.repo}/${row.name}`}>
                  <td className="meta">{row.repo}</td>
                  <td className="branch">
                    {row.where === "Local" ? (
                      <span title={row.detached ? row.localPath ?? undefined : undefined}>{branchLabel(row)}</span>
                    ) : (
                      <a className="go" href={`${gh}/${row.repo}/tree/${row.name.split("/").map(encodeURIComponent).join("/")}`} title="Open this branch on GitHub" target="_blank" rel="noreferrer">
                        {row.name}
                      </a>
                    )}
                    {row.attempt && <span className="meta"> {row.attempt}</span>}
                  </td>
                  <td>
                    {row.issue && (
                      <a className="go" title={row.issue.title ?? undefined} href={`${gh}/${row.repo}/issues/${row.issue.number}`} target="_blank" rel="noreferrer">
                        #{row.issue.number}
                      </a>
                    )}
                  </td>
                  <td>{row.agent}</td>
                  <td>
                    <span className="status" data-s={row.status}>
                      <i />
                      {row.status}
                    </span>
                  </td>
                  <td className="meta">{row.flags.join(", ")}</td>
                  <td className="branch">
                    {row.compare?.base ?? ""}
                    {row.baseGuessed && row.compare && (
                      <span className="meta" title="No PR: base guessed by merge base">
                        {" "}
                        guessed
                      </span>
                    )}
                  </td>
                  <td className={row.compare && row.compare.ahead > 0 ? "num pos" : "num"}>{row.compare?.ahead ?? ""}</td>
                  <td className={row.compare && row.compare.behind > 0 ? "num neg" : "num"}>{row.compare?.behind ?? ""}</td>
                  <td className="meta" title={row.committedDate}>
                    {days(row.daysAgo)}
                  </td>
                  <td className="meta">{row.where}</td>
                  <td>
                    {row.pr && (
                      <a className="go" href={row.pr.url} target="_blank" rel="noreferrer">
                        #{row.pr.number}
                      </a>
                    )}
                  </td>
                  <td>
                    {row.localPath && (
                      <button type="button" className="path" title={`Open in Finder: ${row.localPath}`} onClick={() => openFolder(row.localPath!)}>
                        {displayPath(row.localPath)}
                      </button>
                    )}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {data && visible.length === 0 && <p className="empty">No branches match.</p>}
      </div>
    </main>
  );
}
