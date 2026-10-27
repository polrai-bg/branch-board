type RememberedHit = { path: string; added: boolean };

// Route modules can load this file separately. The process global is the shared last scan.
const SLOT = "__branchboardLastScan";
type Slot = typeof globalThis & { [SLOT]?: RememberedHit[] };

function current(): RememberedHit[] {
  return (globalThis as Slot)[SLOT] ?? [];
}

export function rememberScan(next: RememberedHit[]) {
  (globalThis as Slot)[SLOT] = next.map((hit) => ({ path: hit.path, added: hit.added }));
}

// Already-added rows and paths the scan did not return are dropped.
export function selectableScanPaths(requested: string[]): string[] {
  const allowed = new Set(current().filter((hit) => !hit.added).map((hit) => hit.path));
  const chosen: string[] = [];
  for (const path of requested) {
    if (!allowed.has(path) || chosen.includes(path)) continue;
    chosen.push(path);
  }
  return chosen;
}
