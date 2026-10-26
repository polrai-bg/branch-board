"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Flag, Row } from "@/lib/merge.ts";
import { FLAG_ORDER, STATUS_ORDER, UNFINISHED_STATUSES } from "@/lib/merge.ts";

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

// Same priority as the row sort, so a section never splits.
function groupOf(row: Row): string {
  if (row.status === "Conflicts") return "Conflicts";
  if (UNFINISHED_STATUSES.includes(row.status)) return "On this Mac";
  if (row.flags.includes("Overlap")) return "Overlapping";
  if (row.flags.includes("Orphan")) return "No issue";
  if (row.flags.includes("Stalled review")) return "Stalled";
  if (row.flags.includes("Stale")) return "Stale";
  if (row.status === "WIP") return "In progress";
  if (row.status === "Open PR") return "In review";
  if (row.status === "Empty") return "Empty";
  return "Merged";
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

  const errors = [...(data?.errors ?? []), ...(loadError ? [{ message: loadError }] : [])];
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
        <div>
          <span className="title">Branch Board</span>
          <span className="sub">Updated {ago(data?.takenAt ?? null)}</span>
        </div>
        <input className="search" type="search" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="check">
          <input type="checkbox" checked={!!hideMerged} onChange={(event) => setHideMerged(event.target.checked)} />
          Hide merged
        </label>
        <button className="push" onClick={() => void refreshNow()} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {errors.length > 0 && (
        <div role="alert" className="alert">
          {errors.map((error, index) => (
            <div key={index}>
              {error.message}
              {error.setup && <span> See the Setup section of README.md.</span>}
            </div>
          ))}
          {data && <div>Showing the last good data.</div>}
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
