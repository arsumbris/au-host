import { readInstanceCounts } from '@arsumbris/au-host-sdk/engine-reads'

// Per-type instance COUNT for the inline "N instances" lens, cached across all editor panes in this
// renderer and refreshed on the engine `changes` rebuild — NOT re-read on every file open.
//
// The count comes from one `instance_counts(origins:['file'])` read, the file-only dual of
// `instances_of`: it returns every type's file-origin count in a single round-trip, so one read warms
// the whole renderer and every lens is then a map lookup. The count changes only on a rebuild, so it
// lives in a cache the `changes` feed invalidates, leaving open a pure lookup.
//
// The rows are IDENTITY-keyed: two same-named types in different repos are two rows. A `type:` claim
// joins its row by the `(name, hash)` identity the engine resolved it to (the claim token's `resolved`).
// A type-def's own head has no claim token; the repo its file lives in owns that def, so it joins by
// `(name, owning repo)` over the row's `type_owners`.
//
// Keyed by the engine reader (a WeakMap) so multiple readers in one renderer never bleed counts.
// Concurrent misses share one in-flight read. An invalidation bumps a generation, so a read that was
// already in flight when the graph changed is never stored as current.

type Reader = Parameters<typeof readInstanceCounts>[0]

/** A type identity the lens counts: a resolved claim by `(name, hash)`, or a def by its owning repo. */
export type CountIdentity = { name: string; hash: string } | { name: string; owner: string }

interface Counts {
  byHash: Map<string, number>
  byOwner: Map<string, number>
}
const keyOf = (name: string, part: string): string => `${name}\0${part}`

interface CountCache {
  /** The counts of the current generation, or null until a successful read lands. */
  counts: Counts | null
  generation: number
  inflight: { generation: number; read: Promise<Counts | null> } | null
}
const caches = new WeakMap<Reader, CountCache>()
const cacheFor = (engine: Reader): CountCache => {
  let c = caches.get(engine)
  if (!c) {
    c = { counts: null, generation: 0, inflight: null }
    caches.set(engine, c)
  }
  return c
}

/** One `instance_counts` read as identity-keyed counts, or null when the engine could not answer. */
async function readCounts(engine: Reader): Promise<Counts | null> {
  const out = await readInstanceCounts(engine, undefined, undefined, ['file'])
  if (!('ready' in out) || !out.ready || !out.result) return null
  // by_type is closure-inclusive, so a type's count equals its file-origin `instances_of` drill-in.
  // One identity may be owned by several repos (the same def in each); each owner keys the row.
  const counts: Counts = { byHash: new Map(), byOwner: new Map() }
  for (const row of out.result.by_type) {
    counts.byHash.set(keyOf(row.name, row.hash), row.count)
    for (const owner of row.type_owners) counts.byOwner.set(keyOf(row.name, owner), row.count)
  }
  return counts
}

async function countsFor(engine: Reader): Promise<Counts | null> {
  const cache = cacheFor(engine)
  if (cache.counts) return cache.counts
  if (!cache.inflight || cache.inflight.generation !== cache.generation) {
    const generation = cache.generation
    const read = readCounts(engine).then(
      (counts) => {
        if (counts && cache.generation === generation) cache.counts = counts
        return counts
      },
      () => null,
    )
    cache.inflight = { generation, read }
    void read.finally(() => {
      if (cache.inflight?.read === read) cache.inflight = null
    })
  }
  return cache.inflight.read
}

/**
 * The number of instance FILES claiming the identity, or `undefined` when it is not known: the engine
 * could not answer (not ready, or the read failed). An identity with no instances counts 0.
 */
export async function fileInstanceCount(engine: Reader, identity: CountIdentity): Promise<number | undefined> {
  const counts = await countsFor(engine)
  if (!counts) return undefined
  const found = 'hash' in identity ? counts.byHash.get(keyOf(identity.name, identity.hash)) : counts.byOwner.get(keyOf(identity.name, identity.owner))
  return found ?? 0
}

/**
 * Drop the counts for a reader after a `changes` rebuild, so the next lens refresh re-reads. A read
 * still in flight belongs to the old graph: it still answers the callers already waiting on it, but it
 * is never stored, and the next lookup starts a fresh read.
 */
export function invalidateInstanceCounts(engine: Reader): void {
  const cache = caches.get(engine)
  if (!cache) return
  cache.generation++
  cache.counts = null
  cache.inflight = null
}
