// Renderer-side view-state auto-store: a SYNC cache over the MAIN-owned store (view-state-store.ts).

// High-frequency RESTORABLE view-state (editor cursor/scroll/folds, file-tree expansion), kept LOCAL and
// per-machine, outside the git-tracked composition config. The BACKING is MAIN-owned (keyed by AUTHORITY
// identity — composition + pool `^:` id — not the window), so a floated pane keeps its view-state and every
// window reads the ONE store, mirroring the main-owned per-pane pty. This renderer file holds a CACHE of the
// current composition (hydrated from main at boot) so `ViewStore.get` stays SYNCHRONOUS (the editor restores
// its cursor on mount); a `set` writes the cache AND sends through to main immediately (main coalesces the
// disk flush), so the high write frequency never touches the authority wire.


// Distinct from the live `viewState` bus on the contract (publish/follow of live cursors, never persisted).

import type { ViewStore } from '@arsumbris/au-host-sdk'

export type { ViewStore }

// compositionId -> nodeId -> subKey -> value. Seeded from main by `hydrate`; the sync read surface.
type Cache = Record<string, Record<string, Record<string, unknown>>>
const cache: Cache = {}

/** HYDRATE the cache for a composition from the main-owned store, SYNCHRONOUSLY (a `sendSync`), so it runs
 *  BEFORE the first pane's sync `get` without a race. Called at composition load in every renderer (the
 *  authority's `mountRoot`, a surface's first mount), so a floated pane reads the shared truth. Idempotent:
 *  re-hydrating refreshes the composition's subtree from main. */
export function hydrate(comp: string): void {
  if (!comp || cache[comp]) return
  try {
    cache[comp] = window.main.viewState.load(comp)
  } catch {
    cache[comp] = {} // main unreachable — behave as first-run, never error.
  }
}

/** The current view-state value for (composition, node, subKey) from the cache, or undefined. */
export function getView(comp: string, node: string, sub: string): unknown | undefined {
  return cache[comp]?.[node]?.[sub]
}

/** REFRESH one node's slot from the authoritative main store. The bulk `hydrate` is a per-renderer,
 *  hydrate-ONCE-at-boot cache; a pane MOVED into an already-open window lands in a renderer whose cache
 *  predates the pane's latest state, so its restore would read STALE local data even though main holds the
 *  truth (main's `set` is synchronous, so its memory is always current). Pulling the node on mount — restore
 *  is the only moment freshness matters — is the right granularity, over a push-on-every-write broadcast. */
export function refreshNode(comp: string, node: string): void {
  if (!comp || !node) return
  try {
    ;(cache[comp] ??= {})[node] = window.main.viewState.loadNode(comp, node)
  } catch {
    // main unreachable — keep whatever the cache already holds, never error.
  }
}

/** Write the view-state value for (composition, node, subKey): update the cache (so a subsequent sync read
 *  is current) and send it through to main (fire-and-forget; main debounces the disk flush). */
export function setView(comp: string, node: string, sub: string, value: unknown): void {
  ((cache[comp] ??= {})[node] ??= {})[sub] = value
  window.main.viewState.set(comp, node, sub, value)
}

/** Drop this composition's cache + main entries whose node is NOT in `liveNodeIds` (panes removed from the
 *  saved layout, incl. transient previews). Called after a composition save. */
export function pruneToNodes(comp: string, liveNodeIds: Set<string>): void {
  const nodes = cache[comp]
  if (nodes) for (const node of Object.keys(nodes)) if (!liveNodeIds.has(node)) delete nodes[node]
  window.main.viewState.prune(comp, [...liveNodeIds])
}

/** Drop every entry for a composition — called when it is deleted. */
export function dropComposition(comp: string): void {
  delete cache[comp]
  window.main.viewState.drop(comp)
}

/** Build a per-instance slot. An empty `nodeId` (e.g. the composition root, which has no restorable
 *  view-state) yields a no-op slot. */
export function createViewStore(compositionId: () => string, nodeId: string): ViewStore {
  if (!nodeId) return { get: () => undefined, set: () => {} }
  // Refresh this node from the authoritative store the FIRST time it is read (its restore), so a pane that
  // moved in from another window reads the truth, not this window's boot-time cache. Once per slot: after the
  // first read the local cache is current (this window owns subsequent writes). See `refreshNode`.
  let refreshed = false
  return {
    get: (subKey = '') => {
      const comp = compositionId()
      if (!comp) return undefined
      if (!refreshed) {
        refreshNode(comp, nodeId)
        refreshed = true
      }
      return getView(comp, nodeId, subKey)
    },
    set: (value, subKey = '') => {
      const comp = compositionId()
      if (comp) setView(comp, nodeId, subKey, value)
    },
  }
}

/** Collect every stable `^:` node id in a composition config tree (for prune-on-save). */
export function collectNodeIds(config: unknown): Set<string> {
  const ids = new Set<string>()
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(walk)
      return
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === '^' && typeof val === 'string') ids.add(val)
        else walk(val)
      }
    }
  }
  walk(config)
  return ids
}
