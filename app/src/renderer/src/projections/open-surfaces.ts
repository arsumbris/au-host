// The host-owned OPEN-SURFACES index, a per-window singleton (like the overlay site + the preview
// surface). It folds three sources into one live index of the many-to-many content↔surface relation:

//   - EXISTENCE is host-known — the composition runtime registers a surface on mount and drops it on
//     unmount (`registerSurface` / `dropSurface`), keyed by the mount PUBLISHER (unique per mount).
//   - CONTENT is projection-declared — a projection pushes opaque `{identity, payload}` items via
//     `host.openSurfaces.setContent` (→ `setContent` here). The index stores the payload but reads only
//     the identity string: it DEDUPES by the identity set, so an intra-content navigation (a cursor hop
//     re-declaring the same file) never fires a subscriber.
//   - the TRANSIENT flag is DERIVED, not stored: a surface is transient iff its `^:` is in the authority's
//     `pool.transient` (the single source of truth — set at mint by `createRecord({transient})`, cleared at
//     promote by `setTransient(id,false)`). The runtime injects that predicate (`setTransientSource`) and
//     nudges a `refresh()` when the set changes. So the italic and the serialize-drop read ONE fact, and it
//     is cross-window-correct for free (`pool.transient` holds every window's transient ids).

// Reads (`list` / `find` / `subscribe`) are host-wide. Cross-window aggregation merges each secondary
// surface's open surfaces in under their own window id; this index is single-window (`LOCAL_WINDOW`).



import type { OpenContent, OpenSurface, OpenSurfaces } from '@arsumbris/au-host-sdk'

/** The window tag for surfaces in THIS window. Per-window; cross-window aggregation gives secondary
 *  surfaces their own ids and merges them here. */
export const LOCAL_WINDOW = 'local'

/** Existence meta the runtime knows at mount, plus the projection-declared content. Transient-ness is
 *  NOT stored here — it is derived from `pool.transient` at list time, so it needs no side-map and no
 *  race handling (the fact lives in the pool from the mint, independent of when the surface registers). */
interface SurfaceEntry {
  surfaceId?: string
  projection: string
  windowId: string
  contents: OpenContent[]
}

/** True when two content lists carry the SAME set of identities (order-independent). The dedupe key:
 *  a re-declaration that does not change the identity set is not a change the index reports. */
function sameIdentitySet(a: readonly OpenContent[], b: readonly OpenContent[]): boolean {
  if (a.length !== b.length) return false
  const ai = a.map((c) => c.identity).sort()
  const bi = b.map((c) => c.identity).sort()
  return ai.every((x, i) => x === bi[i])
}

export class OpenSurfacesIndex {
  // This window's surfaces, keyed by mount publisher (unique per mount, so a selective remount that
  // registers the new publisher before the old drops never collides).
  private readonly surfaces = new Map<string, SurfaceEntry>()
  // Transient-ness is DERIVED from the authority's `pool.transient` via this predicate (injected by the
  // runtime through `setTransientSource`). Default `false` until wired, so a bare index is inert, never wrong.
  private isTransient: (surfaceId: string) => boolean = () => false
  private readonly listeners = new Set<(surfaces: OpenSurface[]) => void>()

  private toSurface(entry: SurfaceEntry): OpenSurface {
    return {
      ...(entry.surfaceId !== undefined ? { surfaceId: entry.surfaceId } : {}),
      projection: entry.projection,
      contents: entry.contents.map((c) => ({ identity: c.identity, payload: c.payload })),
      ...(entry.surfaceId !== undefined && this.isTransient(entry.surfaceId) ? { transient: true } : {}),
      windowId: entry.windowId,
    }
  }

  // EXISTENCE (host-driven).
  registerSurface(key: string, meta: { surfaceId?: string; projection: string; windowId: string }): void {
    this.surfaces.set(key, { ...meta, contents: [] })
    this.emit()
  }

  dropSurface(key: string): void {
    if (this.surfaces.delete(key)) this.emit()
  }

  // CONTENT (projection-declared). Always store the latest payloads; emit only when the identity set
  // changed, so a same-file cursor hop never churns subscribers.
  setContent(key: string, items: OpenContent[]): void {
    const entry = this.surfaces.get(key)
    if (!entry) return // existence not registered (mount registers first; a stray call is a no-op).
    const changed = !sameIdentitySet(entry.contents, items)
    entry.contents = items
    if (changed) this.emit()
  }

  // TRANSIENT SOURCE (runtime-injected): the predicate that says whether a surfaceId is transient, hooked
  // to the authority's `pool.transient`. Injected once at setup; the runtime calls `refresh()` when the set
  // changes so subscribers re-derive.
  setTransientSource(isTransient: (surfaceId: string) => boolean): void {
    this.isTransient = isTransient
  }

  /** Re-emit so subscribers re-derive the transient flag. Called by the runtime after a `pool.transient`
   *  change (a preview opened / promoted), since that fact lives outside this index. */
  refresh(): void {
    this.emit()
  }

  // READS (host-wide).
  list(): OpenSurface[] {
    return [...this.surfaces.values()].map((e) => this.toSurface(e))
  }

  find(identity: string): OpenSurface[] {
    return this.list().filter((s) => s.contents.some((c) => c.identity === identity))
  }

  subscribe(onChange: (surfaces: OpenSurface[]) => void): () => void {
    onChange(this.list()) // deliver the current set immediately, then each change.
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  private emit(): void {
    const snapshot = this.list()
    for (const listener of this.listeners) listener(snapshot)
  }
}

let singleton: OpenSurfacesIndex | null = null

/** The per-window open-surfaces index singleton, created on first use. */
export function getOpenSurfacesIndex(): OpenSurfacesIndex {
  return (singleton ??= new OpenSurfacesIndex())
}

/** Build the per-node `OpenSurfaces` capability bound to one mount `publisher`: `setContent` writes this
 *  surface's content; the reads are host-wide off the singleton. */
export function makeOpenSurfaces(publisher: string, onSetTransient?: (surfaceId: string, transient: boolean) => void): OpenSurfaces {
  const index = getOpenSurfacesIndex()
  return {
    setContent: (items) => index.setContent(publisher, items),
    // `setTransient` mutates the ONE source — `pool.transient` — via `onSetTransient` (the authority sets it
    // directly, a floated surface relays it up as `set-transient`). It does NOT write the index: the italic
    // DERIVES from `pool.transient`. Birth is `createRecord({transient})`; this is the promote/demote clear.
    setTransient: (surfaceId, transient) => onSetTransient?.(surfaceId, transient),
    list: () => index.list(),
    find: (identity) => index.find(identity),
    subscribe: (onChange) => index.subscribe(onChange),
  }
}
