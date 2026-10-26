"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Flag, Row, Status } from "@/lib/merge.ts";
import { FLAG_ORDER, STATUS_ORDER, UNFINISHED_STATUSES, summaryCounts } from "@/lib/merge.ts";

type Data = {
  owner: string;
  takenAt: string | null;
  errors: { message: string; setup?: boolean }[];
  hideMergedByDefault: boolean;
  rows: Row[];
};

const STATUS_CHIP: Record<Status, string> = {
  Conflicts: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  Unsaved: "bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-100",
  Unpushed: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  "Local only": "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  WIP: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "Open PR": "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  Empty: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  Merged: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

const FLAG_CHIP: Record<Flag | "Unfinished local", string> = {
  Orphan: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  Overlap: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  "Stalled review": "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200",
  "Unfinished local": "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  Stale: "bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200",
  "Issue closed": "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};

const SUMMARY = ["Orphan", "Overlap", "Stalled review", "Unfinished local", "Stale", "Issue closed", ...STATUS_ORDER] as const;

function ago(iso: string | null) {
  if (!iso) return "never";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

const days = (d: number) => (d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`);

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
  const counts = useMemo(() => summaryCounts(rows), [rows]);
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
  const select = "rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700";

  function chipClass(name: string) {
    if (name in FLAG_CHIP) return FLAG_CHIP[name as Flag | "Unfinished local"];
    return STATUS_CHIP[name as Status];
  }

  function chipSelected(name: string) {
    return name === "Unfinished local" || (FLAG_ORDER as readonly string[]).includes(name) ? flag === name : status === name;
  }

  function toggleChip(name: string) {
    if (name === "Unfinished local" || (FLAG_ORDER as readonly string[]).includes(name)) setFlag(flag === name ? "" : name);
    else setStatus(status === name ? "" : name);
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 text-sm">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Branch Board</h1>
        <span className="text-zinc-500">last refreshed {ago(data?.takenAt ?? null)}</span>
        <button
          onClick={() => void refreshNow()}
          disabled={busy}
          className="ml-auto rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Refreshing…" : "Refresh now"}
        </button>
      </header>

      {errors.length > 0 && (
        <div role="alert" className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errors.map((error, index) => (
            <div key={index}>
              {error.message}
              {error.setup && <span> See the Setup section of README.md.</span>}
            </div>
          ))}
          {data && <div className="mt-1 text-xs opacity-80">Showing the last good data.</div>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {SUMMARY.map((name) => (
          <button
            key={name}
            onClick={() => toggleChip(name)}
            className={`rounded-full px-3 py-1 font-medium ${chipClass(name)} ${chipSelected(name) ? "ring-2 ring-zinc-500" : ""}`}
          >
            {name} {counts[name] ?? 0}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select aria-label="Repo" value={repo} onChange={(event) => setRepo(event.target.value)} className={select}>
          <option value="">All repos</option>
          {repos.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select aria-label="Agent" value={agent} onChange={(event) => setAgent(event.target.value)} className={select}>
          <option value="">All agents</option>
          {agents.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className={select}>
          <option value="">All statuses</option>
          {STATUS_ORDER.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select aria-label="Flag" value={flag} onChange={(event) => setFlag(event.target.value)} className={select}>
          <option value="">All flags</option>
          {[...FLAG_ORDER, "Unfinished local"].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <input type="search" placeholder="Search branch name" value={search} onChange={(event) => setSearch(event.target.value)} className={`${select} w-56`} />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={!!hideMerged} onChange={(event) => setHideMerged(event.target.checked)} />
          Hide merged
        </label>
        <span className="ml-auto text-zinc-500">
          {visible.length} of {rows.length} branches
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="border-b border-zinc-300 text-xs uppercase text-zinc-500 dark:border-zinc-700">
            <tr>
              {["Repo", "Branch", "Issue", "Agent", "Status", "Flags", "Base", "Ahead", "Behind", "Last commit", "Where", "PR", "Local path"].map((heading) => (
                <th key={heading} className="px-2 py-2 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={`${row.repo}/${row.name}`} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="px-2 py-1.5 text-zinc-500">{row.repo}</td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  {row.where === "Local" ? (
                    <span title={row.detached ? row.localPath ?? undefined : undefined}>{branchLabel(row)}</span>
                  ) : (
                    <a className="hover:underline" href={`${gh}/${row.repo}/tree/${encodeURI(row.name)}`} target="_blank" rel="noreferrer">
                      {row.name}
                    </a>
                  )}
                  {row.attempt && <span className="ml-1 font-sans text-zinc-400">{row.attempt}</span>}
                </td>
                <td className="px-2 py-1.5">
                  {row.issue && (
                    <a className="text-blue-600 hover:underline dark:text-blue-400" title={row.issue.title ?? undefined} href={`${gh}/${row.repo}/issues/${row.issue.number}`} target="_blank" rel="noreferrer">
                      #{row.issue.number}
                    </a>
                  )}
                </td>
                <td className="px-2 py-1.5">{row.agent}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[row.status]}`}>{row.status}</span>
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {row.flags.map((name) => (
                    <span key={name} className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${FLAG_CHIP[name]}`}>
                      {name}
                    </span>
                  ))}
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  {row.compare?.base ?? ""}
                  {row.baseGuessed && row.compare && (
                    <span className="ml-1 font-sans text-zinc-400" title="No PR: base guessed by merge base">
                      guessed
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{row.compare?.ahead ?? ""}</td>
                <td className="px-2 py-1.5 tabular-nums">{row.compare?.behind ?? ""}</td>
                <td className="px-2 py-1.5 whitespace-nowrap" title={row.committedDate}>
                  {days(row.daysAgo)}
                </td>
                <td className="px-2 py-1.5">{row.where}</td>
                <td className="px-2 py-1.5">
                  {row.pr && (
                    <a className="text-blue-600 hover:underline dark:text-blue-400" href={row.pr.url} target="_blank" rel="noreferrer">
                      #{row.pr.number}
                    </a>
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  {row.localPath && (
                    <a className="hover:underline" href={`file://${encodeURI(row.localPath)}`} title={row.localPath}>
                      {displayPath(row.localPath)}
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && visible.length === 0 && <p className="py-8 text-center text-zinc-500">No branches match.</p>}
      </div>
    </main>
  );
}
