// MAIN-OWNED restorable view-state auto-store: one file per workspace,
// `~/.arsumbris/au-host/data/view-state/<workspaceKey>.json`, bound to the workspace this instance has CLAIMED,
// so exactly one process writes it (see `local-store-file.ts` for the atomic write).

// High-frequency RESTORABLE view-state (editor cursor/scroll/folds, file-tree expansion) kept LOCAL and
// per-machine, outside the git-tracked composition config. Keyed by composition id + pool `^:` node id +
// a projection sub-key. MAIN-owned (not the renderer's localStorage) so it is keyed by AUTHORITY-owned
// IDENTITY, not the window: a floated pane keeps its view-state because the key is its pool id, and every
// window (authority + each surface) reads the ONE main-owned store, mirroring the main-owned per-pane pty.


// A BOUNDED CACHE, not a ledger: an LRU cap bounds growth; prune-on-save / drop-on-delete remove dead panes
// and compositions. The DISK write is DEBOUNCED (cursor moves are frequent) and atomic; the in-memory map is the truth
// between flushes, so a read is always current. Per-machine, NON-git, disposable — a missing / corrupt file
// behaves as first-run and NEVER errors.

import { workspaceStoreFile } from './device-paths'
import { LocalStoreFile } from './local-store-file'

interface Entry {
  v: unknown
  t: number // last-touched epoch ms — the LRU recency key.
}
// compositionId -> nodeId -> subKey -> Entry. subKey is '' when the projection supplies none.
type Store = Record<string, Record<string, Record<string, Entry>>>

const MAX_ENTRIES = 1000

export class ViewStateStore {
  private file: LocalStoreFile<Store> | null = null

  /** Bind to the CLAIMED workspace's file. Rebinding flushes the previous one first. */
  open(entry: string): void {
    this.close()
    this.file = new LocalStoreFile<Store>(workspaceStoreFile('view-state', entry), () => ({}))
  }

  /** Flush and unbind (the workspace closed, or the app quits). Unbound, reads are empty and writes drop. */
  close(): void {
    this.file?.flushNow()
    this.file = null
  }

  /** The bound workspace's value, or a throwaway empty one while unbound (so a write before a claim drops). */
  private store(): Store {
    return this.file?.get() ?? {}
  }

  /** Evict least-recently-used entries until within MAX_ENTRIES. */
  private evict(store: Store): void {
    const all: { comp: string; node: string; sub: string; t: number }[] = []
    for (const [comp, nodes] of Object.entries(store))
      for (const [node, subs] of Object.entries(nodes))
        for (const [sub, entry] of Object.entries(subs)) all.push({ comp, node, sub, t: entry.t })
    if (all.length <= MAX_ENTRIES) return
    all.sort((a, b) => a.t - b.t)
    for (const e of all.slice(0, all.length - MAX_ENTRIES)) {
      delete store[e.comp]?.[e.node]?.[e.sub]
      if (store[e.comp]?.[e.node] && Object.keys(store[e.comp][e.node]).length === 0) delete store[e.comp][e.node]
      if (store[e.comp] && Object.keys(store[e.comp]).length === 0) delete store[e.comp]
    }
  }

  /** One composition's entire node->sub->value subtree, for a renderer to hydrate its cache. */
  loadComposition(comp: string): Record<string, Record<string, unknown>> {
    const nodes = this.store()[comp] ?? {}
    const out: Record<string, Record<string, unknown>> = {}
    for (const [node, subs] of Object.entries(nodes)) {
      out[node] = {}
      for (const [sub, entry] of Object.entries(subs)) out[node][sub] = entry.v
    }
    return out
  }

  /** One (composition, node) subtree of sub->value, for a renderer to REFRESH a single pane's slot from the
   *  authoritative store on mount. A pane MOVED into an already-open window lands in a renderer whose cache
   *  was hydrated at ITS boot and predates the pane's latest state; the destination refreshes just this node
   *  so restore reads authoritative truth rather than the stale local cache. */
  loadNode(comp: string, node: string): Record<string, unknown> {
    const subs = this.store()[comp]?.[node] ?? {}
    const out: Record<string, unknown> = {}
    for (const [sub, entry] of Object.entries(subs)) out[sub] = entry.v
    return out
  }

  /** Write one (composition, node, subKey) value; refresh recency, cap, schedule a flush. */
  set(comp: string, node: string, sub: string, value: unknown): void {
    const store = this.store()
    ;((store[comp] ??= {})[node] ??= {})[sub] = { v: value, t: Date.now() }
    this.evict(store)
    this.file?.touch()
  }

  /** Drop a composition's entries whose node is NOT live (removed from the saved layout / transient previews). */
  prune(comp: string, liveNodeIds: string[]): void {
    const store = this.store()
    const nodes = store[comp]
    if (!nodes) return
    const live = new Set(liveNodeIds)
    let changed = false
    for (const node of Object.keys(nodes)) {
      if (!live.has(node)) {
        delete nodes[node]
        changed = true
      }
    }
    if (Object.keys(nodes).length === 0) delete store[comp]
    if (changed) this.file?.touch()
  }

  /** Drop every entry for a composition (it was deleted). */
  drop(comp: string): void {
    const store = this.store()
    if (!(comp in store)) return
    delete store[comp]
    this.file?.touch()
  }

}
