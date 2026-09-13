// MAIN-OWNED restorable view-state auto-store: `~/.arsumbris/au-host/data/view-state.json`.

// High-frequency RESTORABLE view-state (editor cursor/scroll/folds, file-tree expansion) kept LOCAL and
// per-machine, outside the git-tracked composition config. Keyed by composition id + pool `^:` node id +
// a projection sub-key. MAIN-owned (not the renderer's localStorage) so it is keyed by AUTHORITY-owned
// IDENTITY, not the window: a floated pane keeps its view-state because the key is its pool id, and every
// window (authority + each surface) reads the ONE main-owned store, mirroring the main-owned per-pane pty.


// A BOUNDED CACHE, not a ledger: an LRU cap bounds growth; prune-on-save / drop-on-delete remove dead panes
// and compositions. The DISK write is DEBOUNCED (cursor moves are frequent); the in-memory map is the truth
// between flushes, so a read is always current. Per-machine, NON-git, disposable — a missing / corrupt file
// behaves as first-run and NEVER errors.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { hostDataDir } from './device-paths'

/** The view-state file: `~/.arsumbris/au-host/data/view-state.json`. */
export function viewStateFile(): string {
  return path.join(hostDataDir(), 'view-state.json')
}

interface Entry {
  v: unknown
  t: number // last-touched epoch ms — the LRU recency key.
}
// compositionId -> nodeId -> subKey -> Entry. subKey is '' when the projection supplies none.
type Store = Record<string, Record<string, Record<string, Entry>>>

const MAX_ENTRIES = 1000
const FLUSH_DEBOUNCE_MS = 400

export class ViewStateStore {
  private store: Store | null = null // lazily loaded on first access.
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  private load(): Store {
    if (this.store) return this.store
    try {
      this.store = JSON.parse(fs.readFileSync(viewStateFile(), 'utf8')) as Store
    } catch {
      this.store = {} // missing / corrupt → first-run, never an error.
    }
    return this.store
  }

  /** Schedule a debounced disk write (frequent cursor moves coalesce into one flush). */
  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushNow()
    }, FLUSH_DEBOUNCE_MS)
  }

  /** Write the in-memory store to disk now (best-effort; a failure never breaks the host). */
  flushNow(): void {
    if (!this.store) return
    try {
      fs.mkdirSync(path.dirname(viewStateFile()), { recursive: true })
      fs.writeFileSync(viewStateFile(), JSON.stringify(this.store))
    } catch {
      // storage full / unavailable — view-state is best-effort, drop silently.
    }
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
    const nodes = this.load()[comp] ?? {}
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
    const subs = this.load()[comp]?.[node] ?? {}
    const out: Record<string, unknown> = {}
    for (const [sub, entry] of Object.entries(subs)) out[sub] = entry.v
    return out
  }

  /** Write one (composition, node, subKey) value; refresh recency, cap, schedule a flush. */
  set(comp: string, node: string, sub: string, value: unknown): void {
    const store = this.load()
    ;((store[comp] ??= {})[node] ??= {})[sub] = { v: value, t: Date.now() }
    this.evict(store)
    this.scheduleFlush()
  }

  /** Drop a composition's entries whose node is NOT live (removed from the saved layout / transient previews). */
  prune(comp: string, liveNodeIds: string[]): void {
    const store = this.load()
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
    if (changed) this.scheduleFlush()
  }

  /** Drop every entry for a composition (it was deleted). */
  drop(comp: string): void {
    const store = this.load()
    if (!(comp in store)) return
    delete store[comp]
    this.scheduleFlush()
  }

  /** Flush pending writes on app quit (so the last cursor position survives a restart). */
  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flushNow()
  }
}
