"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Row, Status } from "@/lib/merge.ts";
import { STATUS_ORDER } from "@/lib/merge.ts";

type Data = {
  owner: string;
  takenAt: string | null;
  errors: { message: string; setup?: boolean }[];
  hideMergedByDefault: boolean;
  rows: Row[];
};

const CHIP: Record<Status | "Stale", string> = {
  Conflicts: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  WIP: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  Stale: "bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200",
  "Open PR": "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  Empty: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  Merged: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

const days = (d: number) => (d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`);

export default function Board() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repo, setRepo] = useState("");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [hideMerged, setHideMerged] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/branches", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/branches returned ${res.status}`);
      const d: Data = await res.json();
      setData(d);
      setHideMerged((h) => h ?? d.hideMergedByDefault);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function refreshNow() {
    setBusy(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.rows ?? [];
  const repos = useMemo(() => [...new Set(rows.map((r) => r.repo))].sort(), [rows]);
  const agents = useMemo(() => [...new Set(rows.map((r) => r.agent))].sort(), [rows]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { Stale: rows.filter((r) => r.stale).length };
    for (const s of STATUS_ORDER) c[s] = rows.filter((r) => r.status === s).length;
    return c;
  }, [rows]);

  const visible = rows.filter(
    (r) =>
      (!repo || r.repo === repo) &&
      (!agent || r.agent === agent) &&
      (status === "Stale" ? r.stale : !status || r.status === status) &&
      (!search || r.name.toLowerCase().includes(search.toLowerCase())) &&
      (!hideMerged || status === "Merged" || r.status !== "Merged"),
  );

  const errors = [...(data?.errors ?? []), ...(loadError ? [{ message: loadError }] : [])];
  const gh = `https://github.com/${data?.owner}`;
  const select = "rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700";

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 text-sm">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Branch Board</h1>
        <span className="text-zinc-500">last refreshed {ago(data?.takenAt ?? null)}</span>
        <button
          onClick={refreshNow}
          disabled={busy}
          className="ml-auto rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Refreshing…" : "Refresh now"}
        </button>
      </header>

      {errors.length > 0 && (
        <div role="alert" className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errors.map((e, i) => (
            <div key={i}>
              {e.message}
              {e.setup && <span> See the Setup section of README.md.</span>}
            </div>
          ))}
          {data && <div className="mt-1 text-xs opacity-80">Showing the last good data.</div>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(["Conflicts", "WIP", "Stale", "Open PR", "Empty", "Merged"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(status === s ? "" : s)}
            className={`rounded-full px-3 py-1 font-medium ${CHIP[s]} ${status === s ? "ring-2 ring-zinc-500" : ""}`}
          >
            {s} {counts[s] ?? 0}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select aria-label="Repo" value={repo} onChange={(e) => setRepo(e.target.value)} className={select}>
          <option value="">All repos</option>
          {repos.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)} className={select}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={select}>
          <option value="">All statuses</option>
          {[...STATUS_ORDER, "Stale"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search branch name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${select} w-56`}
        />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={!!hideMerged} onChange={(e) => setHideMerged(e.target.checked)} />
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
              {["Repo", "Branch", "Agent", "Status", "Base", "Ahead", "Behind", "Last commit", "PR"].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={`${r.repo}/${r.name}`} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="px-2 py-1.5 text-zinc-500">{r.repo}</td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  <a className="hover:underline" href={`${gh}/${r.repo}/tree/${encodeURI(r.name)}`} target="_blank" rel="noreferrer">
                    {r.name}
                  </a>
                </td>
                <td className="px-2 py-1.5">{r.agent}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[r.status]}`}>{r.status}</span>
                  {r.stale && <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${CHIP.Stale}`}>Stale</span>}
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  {r.compare?.base ?? "?"}
                  {r.baseGuessed && r.compare && <span className="ml-1 font-sans text-zinc-400" title="No PR: base guessed by merge base">guessed</span>}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{r.compare?.ahead ?? ""}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.compare?.behind ?? ""}</td>
                <td className="px-2 py-1.5 whitespace-nowrap" title={r.committedDate}>
                  {days(r.daysAgo)}
                </td>
                <td className="px-2 py-1.5">
                  {r.pr && (
                    <a className="text-blue-600 hover:underline dark:text-blue-400" href={r.pr.url} target="_blank" rel="noreferrer">
                      #{r.pr.number}
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
