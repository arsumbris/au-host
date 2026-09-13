// THE COMPOSITION POOL — normalize an authored composition into a flat pool, resolve the pool back
// into a mount tree, and validate the reference graph.

// A composition is a `root` reference plus a flat POOL of projection records, each carrying a `^:`
// block-id and cross-referenced by `[[^^id]]`. A container names its children by REFERENCE into the
// pool, never by embedding, so a re-parent is a reference re-point of two independent records and no
// parent ever re-serializes a stale copy of a child. This module is the pure data → data half of
// that model; the HOST wires it into the mount runtime and the save path.


// WHY HERE, beside slot-schema.ts. Both are pure derivations over the type graph and the parsed
// value — no DOM, no React, no daemon. The resolution walk is the natural extension of the slot
// traversal: `deriveContainerSchemas` says WHICH fields hold children; this reads the VALUES at those
// fields and follows the references. Keeping it framework-agnostic means a detached renderer or a
// third-party host resolves a composition the same way, and it is unit-testable without a browser.

// The resolution walk expands child references before handing config to a container.
// Container codecs receive inline child configs; the host owns reference resolution and persistence.

import type { ContainerSchemas, SlotField, SlotSchema } from './slot-schema.ts'
import { bareTypeName } from './slot-schema.ts'
import type { HostDiagnostic } from './diagnostics.ts'

/** The name the engine surfaces a block-id under on a parsed inline record: the literal single caret.
 *  Authored as `^: id`, the `:` is YAML's key/value separator, so the KEY is `^` and the value is the
 *  bare id. Identity-layer, never a declared field. (See `type block-id::au-engine`.) */
const BLOCK_ID_KEY = '^'

/** A parsed projection record: an inline instance carrying a `type`, optionally a `^` block-id, and
 *  whatever fields its type declares. Opaque beyond those two keys. */
export type PoolRecord = { type: string; [BLOCK_ID_KEY]?: string } & Record<string, unknown>

/**
 * A composition normalized to its canonical form.
 *
 * `roots` are the block-ids of the WINDOW records the host opens — one OS window each, the multi-surface
 * pool root. One authority drives every window, so a composition names a SET of windows, not a single
 * root. Single-window is `roots.length === 1`. `records` is the flat pool keyed by block-id, in walk
 * order (insertion order is preserved, so a later whole-file write is stable). Reachability + resolve
 * walk from every root. The primary window's CONTENT (the mounted view) is `primaryContentId(pool)`.
 * A legacy bare instance normalizes to a single non-window root.
 */
export interface CompositionPool {
  roots: string[]
  records: Map<string, PoolRecord>
  /**
   * The ids of records that are LIVE but NEVER persisted — a preview / peek tab, any runtime-only child.
   * The record is a full pool member (routed, view-state, `parentMap` links it via its live edge), so
   * routing reaches it and its siblings; `serializePoolToComposition` DROPS these records AND strips any
   * inbound ref to them, so a transient child never reaches disk and no dangling ref is representable.
   * Runtime-only: nothing on disk is transient, so `normalizeToPool` yields an EMPTY set; only a
   * `createRecord(_, { transient })` mint or a `setTransient` declare fills it. This is POOL metadata
   * ABOUT a record, never a projection config field.
   */
  transient: Set<string>
  /**
   * The composition DOCUMENT's own frontmatter, minus the structural keys (`root`, `windows`, `projections`) —
   * a GENERIC bag, so host-sdk stays value-vocab-free: it carries the `type` claim (with any mixins,
   * e.g. `intent-routing` / `intent-wires`) and every composition-scoped field those mixins declare
   * (`intent-defaults`, `initial-focus`, `wires`), NONE of which this package interprets. The renderer
   * reads intent config off it; the serializer writes it back. Absent for a legacy bare-root instance
   * (no composition document). Composition metadata lives on the document.
   */
  meta?: Record<string, unknown>
}

/** A finding from the reference-graph validator: a `HostDiagnostic` plus the offending id(s), so a
 *  degrade UI can address the exact records without re-deriving them. */
export interface PoolDiagnostic extends HostDiagnostic {
  /** The block-id(s) the finding concerns: the duplicated/cyclic/orphaned record(s). */
  ids: string[]
}

// --- block-referent parsing (the same string form every host surface uses) ---------------------

/**
 * A parsed reference at a `mountable*` child position, cross-file aware.
 *
 * - `{ id }`         a LOCAL block-referent `[[^^id]]` — a record in THIS file's pool.
 * - `{ file, id }`   a CROSS-FILE block-referent `[[file^^id]]` — one record in another file's pool.
 * - `{ file }`       a whole-file reference `[[file]]` — another projection or composition FILE.
 *
 * `file` keeps its `::repo` / `@commit` scope qualifiers verbatim (the reader resolves them); a
 * navigational `#head` is dropped. Returns `undefined` for a non-`[[...]]` value or an empty `[[^]]`.
 * (See `type reference::au-engine` for the fragment grammar.)
 */
export interface ParsedRef {
  /** The referenced file target (name, optionally `::repo` / `@commit`); absent means the same file. */
  file?: string
  /** The block-id after `^` / `^^`; absent means the whole file (a composition's root, or a projection). */
  id?: string
}

/** Parse a `[[...]]` value at a child position into its file + block-id parts, or `undefined`. */
export function parseRef(value: unknown): ParsedRef | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^\[\[([^\]]+)\]\]$/.exec(value.trim())
  if (!m) return undefined
  const inner = m[1].split('|')[0].trim() // drop a |alias
  const caret = inner.indexOf('^') // the first caret opens the block fragment (order: name ::repo @commit #head ^block)
  const filePart = (caret < 0 ? inner : inner.slice(0, caret)).split('#')[0].trim() // #head is navigational, never a target
  const id = caret < 0 ? undefined : inner.slice(caret).replace(/^\^+/, '').trim() || undefined
  const file = filePart.length > 0 ? filePart : undefined
  if (file === undefined && id === undefined) return undefined // [[^]] / [[]] — empty
  return { file, id }
}

/**
 * The block-id a LOCAL block-referent value names, or `undefined` if the value is not one.
 *
 * A block-referent is `[[^^id]]` (double caret = the block is the referent, a VALUE). We tolerate a
 * single-caret local form too. A CROSS-FILE ref (`[[file^^id]]`), a plain `[[name]]`, or a role def-ref
 * like `[[aup-reader::aup-reader]]` is NOT a local block-referent, so this returns `undefined` and the
 * local-only machinery (resolver / analyzer / parentMap) leaves it untouched. Cross-file refs are the
 * LINKER's business (`linkPool`), which folds them and rewrites each to a local qualified ref BEFORE the
 * local machinery runs — so returning `undefined` here for a cross-file ref is correct, not a miss.
 */
export function parseBlockRef(value: unknown): string | undefined {
  const r = parseRef(value)
  return r !== undefined && r.file === undefined ? r.id : undefined
}

/** Whether a value is a local block-referent string. */
export function isBlockRef(value: unknown): boolean {
  return parseBlockRef(value) !== undefined
}

/** Render a block-id as the local block-referent value that resolves to it. */
export function blockRef(id: string): string {
  return `[[^^${id}]]`
}

/** The block-id an inline record carries, if any. */
export function recordId(record: unknown): string | undefined {
  if (record == null || typeof record !== 'object') return undefined
  const id = (record as Record<string, unknown>)[BLOCK_ID_KEY]
  return typeof id === 'string' ? id : undefined
}

// --- occupant classification (generic over ContainerSchemas, no container named) ----------------

type OccupantKind = 'ref' | 'structural-node' | 'slot-wrapper' | 'projection' | 'other'

/**
 * What a value at a child position IS, decided from the type graph alone.
 *
 * - `ref`            a `[[^^id]]` block-referent into the pool.
 * - `structural-node` a container's own layout node (bento-node.branch): stays inline, descend it.
 * - `slot-wrapper`   a `container-slot` record carrying a position's rules around a `child`.
 * - `projection`     an inline projection record: the child itself.
 * - `other`          a primitive / null / an unrecognised value: left untouched.
 *
 * Slot-wrapper detection is by the field's DECLARED slot type names. A third-party SUBTYPE of a slot
 * is not matched here (the host installs a closure predicate for that at the placement seam); for the
 * read layer the declared names cover every shipped container, and an unmatched slot subtype degrades
 * to being treated as a projection, which the validator would surface rather than corrupt.
 */
function classifyOccupant(value: unknown, field: SlotField, schemas: ContainerSchemas): OccupantKind {
  if (isBlockRef(value)) return 'ref'
  if (value == null || typeof value !== 'object') return 'other'
  const names = typeNames((value as { type?: unknown }).type)
  if (names.length === 0) return 'other'
  if (names.some((t) => schemas.nodes.has(t))) return 'structural-node'
  if (names.some((t) => field.slotTypes.includes(t))) return 'slot-wrapper'
  return 'projection'
}

/** The bare type names a record claims. A single claim is one name; a MIXIN (`type: [a, b]`) is
 *  several — e.g. a container that mixes in `intent-routing` claims `[dock, intent-routing]`. Reading
 *  only the first would miss the container branch, so every reader below scans all of them. */
function typeNames(type: unknown): string[] {
  if (typeof type === 'string') return [bareTypeName(type)]
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string').map((t) => bareTypeName(t))
  return []
}

/** The child-bearing schema for a record's type (a container), or a structural node, or undefined.
 *  Scans every claim so a mixin-typed container (`type: [dock, intent-routing]`) still resolves. */
function schemaFor(type: unknown, schemas: ContainerSchemas): SlotSchema | undefined {
  for (const t of typeNames(type)) {
    const s = schemas.containers.get(t) ?? schemas.nodes.get(t)
    if (s) return s
  }
  return undefined
}

/** Iterate the occupant VALUES of one child-bearing field, list or single. */
function occupantsOf(record: Record<string, unknown>, field: SlotField): unknown[] {
  const raw = record[field.name]
  if (field.list) return Array.isArray(raw) ? raw : []
  return raw == null ? [] : [raw]
}

// --- 1.1 the read adapter: normalize an authored composition into a flat pool -------------------

/**
 * Normalize an authored composition into a flat pool.
 * Accepts a composition with pooled references, a nested root tree, or a bare projection instance.
 * Inline projection records are hoisted into the pool and their child slots become references.
 * Structural nodes remain inline; slot wrappers keep their rules while their children are hoisted.
 *
 * mintId supplies ids to records that lack them. The host uses engine-backed assignment so the ids
 * persist; tests can supply a deterministic minter.
 */
export function normalizeToPool(
  raw: Record<string, unknown>,
  schemas: ContainerSchemas,
  mintId: () => string,
): CompositionPool {
  const records = new Map<string, PoolRecord>()

  // Hoist an inline projection record into the pool (flattening its children first) and return its
  // id. A value that is already a ref is returned by its id without adding anything.
  const hoist = (value: unknown): string => {
    const asRef = parseBlockRef(value)
    if (asRef !== undefined) return asRef
    const rec = value as Record<string, unknown>
    const id = recordId(rec) ?? mintId()
    // Reserve the id BEFORE flattening children, so a cycle in the input cannot spin forever.
    records.set(id, { [BLOCK_ID_KEY]: id, type: '' } as PoolRecord)
    records.set(id, { ...flattenChildren(rec), [BLOCK_ID_KEY]: id } as PoolRecord)
    return id
  }

  // Replace every child occupant in a container/structural-node record with a reference (hoisting
  // projections), keeping structural nodes and slot-wrappers inline.
  const flattenChildren = (record: Record<string, unknown>): Record<string, unknown> => {
    const schema = schemaFor((record as { type?: string }).type, schemas)
    if (!schema) return { ...record }
    const out: Record<string, unknown> = { ...record }
    for (const field of schema.fields) {
      if (!(field.name in record)) continue
      const occs = occupantsOf(record, field)
      out[field.name] = field.list
        ? occs.map((occ) => flattenOccupant(occ, field))
        : occs.length > 0
          ? flattenOccupant(occs[0], field)
          : record[field.name] // a present-but-null single field stays null
    }
    return out
  }

  const flattenOccupant = (value: unknown, field: SlotField): unknown => {
    switch (classifyOccupant(value, field, schemas)) {
      case 'ref':
        return value
      case 'structural-node':
        return flattenChildren(value as Record<string, unknown>)
      case 'slot-wrapper': {
        const w = value as Record<string, unknown>
        return w['child'] == null ? w : { ...w, child: blockRef(hoist(w['child'])) }
      }
      case 'projection':
        return blockRef(hoist(value))
      default:
        return value
    }
  }

  // type may be a single claim or a mixin list. Recognize a composition when any claim has
  // the bare name composition so its document metadata is retained.
  const typeClaims = Array.isArray(raw['type']) ? (raw['type'] as unknown[]) : raw['type'] != null ? [raw['type']] : []
  const isComposition = typeClaims.some((t) => typeof t === 'string' && bareTypeName(t) === 'composition')

  if (isComposition) {
    // Seed the pool from any already-flat records (idempotent: flattening a record whose children are
    // already refs is a no-op), then resolve the WINDOWS — each a ref naming a window record (an inline
    // window is hoisted). The window records are pool members; their `content` refs the view tree.
    const projections = Array.isArray(raw['projections']) ? (raw['projections'] as unknown[]) : []
    for (const rec of projections) if (rec && typeof rec === 'object') hoist(rec)
    const windowsRaw = Array.isArray(raw['windows'])
      ? (raw['windows'] as unknown[])
      : raw['windows'] != null
        ? [raw['windows']]
        : []
    const roots = windowsRaw.map((w) => hoist(w)).filter((id): id is string => typeof id === 'string' && id.length > 0)
    // Capture document frontmatter except structural keys (root, windows, projections) and the
    // document block-id. Composition fields and type claims pass through generically. Exclude root
    // even when present in an input document so it cannot be re-emitted as metadata.
    const meta: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'root' || k === 'windows' || k === 'projections' || k === BLOCK_ID_KEY) continue
      meta[k] = v
    }
    return Object.keys(meta).length > 0 ? { roots, records, meta, transient: new Set() } : { roots, records, transient: new Set() }
  }

  // A bare instance is the single non-window root; wrap it in a composition pool.
  const root = hoist(raw)
  return { roots: [root], records, transient: new Set() }
}

/**
 * The PRIMARY window's CONTENT id — the mounted view root. Used where one entry tree is wanted
 * rather than the whole window set: a nested composition mounts its primary window's content inline
 * without opening OS windows, and single-tree callers resolve one view root.
 *
 * Resolution: the `primary` window among `roots`, else the first root; then its `content` ref. Falls back
 * to the window id itself when the window has no content (an empty/dormant window), and to `undefined`
 * for an empty pool. A bare root (not a window, no `content`) resolves to itself.
 */
export function primaryContentId(pool: CompositionPool): string | undefined {
  const primary =
    pool.roots.find((id) => (pool.records.get(id) as { primary?: unknown } | undefined)?.primary === true) ??
    pool.roots[0]
  if (primary == null) return undefined
  const contentId = parseBlockRef((pool.records.get(primary) as Record<string, unknown> | undefined)?.['content'])
  return contentId ?? primary
}

// --- 1.2 the resolution walk: resolve the pool back into a mount tree ---------------------------

/**
 * Resolve the pool into the nested mount tree the containers consume, following `[[^^id]]` from
 * `root`. Every reference is re-inlined to its pool record (recursively), so a container receives
 * inline children and never sees a ref string.
 *
 * A dangling reference (no such pool record) resolves to `undefined` at its slot — the same shape an
 * empty position has — rather than throwing; the validator reports it. A CYCLE breaks at the repeat:
 * the back-edge resolves to `undefined` (an empty position), never a second mount of the cyclic record.
 *
 * The DUPLICATE degrade (first occurrence mounts, the rest show a placeholder) is NOT decided here.
 * This resolver is per-subtree and cannot know GLOBAL occurrence order; the host runs `analyzePool`
 * ONCE per mount generation to redirect each non-canonical edge to a synthetic placeholder record and
 * resolves this from that MOUNT POOL. Resolving a raw pool here inlines a duplicate at each site.
 *
 * Returns the resolved record, or `undefined` if the starting id dangles. `fromId` defaults to the
 * composition `root`; pass a child's id to resolve just its SUBTREE (what a container mounts for one
 * child — the host hands each container an inline subtree so its read path never sees a ref string).
 */
export function resolvePoolToTree(
  pool: CompositionPool,
  schemas: ContainerSchemas,
  // Defaults to the primary window's CONTENT (the mounted view). Per-window callers pass a window's own
  // `content` id; a container passes a child id to resolve just its subtree.
  fromId: string | undefined = primaryContentId(pool),
): PoolRecord | undefined {
  if (fromId === undefined) return undefined
  const resolveRecord = (id: string, onPath: ReadonlySet<string>): PoolRecord | undefined => {
    const rec = pool.records.get(id)
    if (!rec) return undefined
    if (onPath.has(id)) return undefined // break a cycle at the repeat: an empty position, not a re-mount
    const nextPath = new Set(onPath).add(id)
    return { ...inlineChildren(rec, nextPath), [BLOCK_ID_KEY]: id } as PoolRecord
  }

  const inlineChildren = (record: Record<string, unknown>, onPath: ReadonlySet<string>): Record<string, unknown> => {
    const schema = schemaFor((record as { type?: string }).type, schemas)
    if (!schema) return { ...record }
    const out: Record<string, unknown> = { ...record }
    for (const field of schema.fields) {
      if (!(field.name in record)) continue
      const occs = occupantsOf(record, field)
      out[field.name] = field.list
        ? occs.map((occ) => inlineOccupant(occ, field, onPath))
        : occs.length > 0
          ? inlineOccupant(occs[0], field, onPath) // a dangling single ref resolves to undefined here
          : record[field.name]
    }
    return out
  }

  const inlineOccupant = (value: unknown, field: SlotField, onPath: ReadonlySet<string>): unknown => {
    switch (classifyOccupant(value, field, schemas)) {
      case 'ref':
        return resolveRecord(parseBlockRef(value)!, onPath) // undefined on dangle → empty position
      case 'structural-node':
        return inlineChildren(value as Record<string, unknown>, onPath)
      case 'slot-wrapper': {
        const w = value as Record<string, unknown>
        const child = w['child']
        if (!isBlockRef(child)) return w
        return { ...w, child: resolveRecord(parseBlockRef(child)!, onPath) }
      }
      default:
        return value
    }
  }

  return resolveRecord(fromId, new Set())
}

// --- 1.2c cross-file linking: fold nested composition/projection files into one mount pool -------

/** The entry composition's own scope id. Its records keep BARE ids and are OMITTED from
 *  `ScopeTable.recordScope` (a lookup miss means the entry scope), so a composition with NO nesting
 *  produces an empty scope table and the linked pool equals the plain normalized pool. */
export const ENTRY_SCOPE = 's0'

/**
 * The QUALIFIED id a nested scope's record carries in the linked pool: the entry scope keeps bare ids,
 * a nested scope prefixes `__<scopeId>-`. THE one home for the convention — the linker mints ids this
 * way, and the runtime re-derives a nested composition's own wire/reach ids (authored against the nested
 * file's LOCAL ids) into the qualified ids the mounted nodes carry, so per-scope routing rules match.
 */
export function qualifyScopedId(scopeId: string, id: string): string {
  return scopeId === ENTRY_SCOPE ? id : `__${scopeId}-${id}`
}

/** One nesting scope: an entry composition, or a nested composition folded in at a child position.
 *  Nested-scope dispatch walks `parentScopeId` up the chain to resolve which composition's rules govern a node. */
export interface ScopeInfo {
  /** `s0` for the entry, `s1`, `s2`, … for nested folds (unique per fold, so the same file nested twice
   *  is two independent scopes — two mounts, distinct pane identities — not one shared record). */
  scopeId: string
  /** The resolved path of the file this scope came from (undefined for the in-memory entry). */
  sourcePath?: string
  /** The wikilink target that named this nested scope (for diagnostics). */
  target?: string
  /** The nested composition's own metadata bag (`type` mixin + intent-defaults / wires / initial-focus).
   *  Nested-scope dispatch applies these rules to the subtree. Absent for a nested PROJECTION file (no composition doc). */
  meta?: Record<string, unknown>
  /** The enclosing scope; undefined for the entry. */
  parentScopeId?: string
  /** The qualified id of this scope's root record in the linked pool. */
  rootId: string
}

/** The scope side-structure the linker produces: every mounted node's enclosing composition, and each
 *  composition's rules + parent chain. Consumed by nested-scope dispatch and the pool-write guard;
 *  foreign-scope records are read-only. */
export interface ScopeTable {
  /** scopeId → info. Always holds `ENTRY_SCOPE`; a nested entry per fold. */
  scopes: Map<string, ScopeInfo>
  /** qualified record id → scopeId, for NESTED records only. An entry (bare-id) record is omitted; a
   *  miss means the entry scope. So the no-nesting case is an empty map. */
  recordScope: Map<string, string>
  /**
   * A folded target's qualified id → the ORIGINAL cross-file ref value (`[[file]]` / `[[file^^id]]`).
   * The linker rewrites each cross-file ref to a local qualified ref so the resolver stays single-pool,
   * but a container mounted with that qualified id would re-serialize it into its OWN (entry) record —
   * overwriting the original cross-file ref and corrupting the file. `restoreCrossFileRefs` reverses it
   * at every write into the authoritative entry pool, so `[[nested]]` survives a round-trip. Empty when
   * there is no nesting.
   */
  originRef: Map<string, string>
}

/** The result of linking: the mount pool (all refs local), the scope table, and cross-file diagnostics. */
export interface LinkedPool {
  /**
   * The linked MOUNT pool: the entry pool's records (bare ids, ORIGINAL refs where untouched) plus every
   * nested file's records folded in under QUALIFIED ids, with every cross-file reference rewritten to a
   * LOCAL qualified ref. So the resolver / `analyzePool` / `parentMap` / portal consume it unchanged, as
   * one flat pool. NEVER persisted — the authoritative entry pool (with its original cross-file refs) is
   * what the host writes back; this is mount-only, exactly like the degrade `mountPool`.
   */
  pool: CompositionPool
  scopes: ScopeTable
  /** Cross-file findings: a `composition-cross-file-missing` (a `[[file]]` that did not load) and a
   *  `composition-cross-file-cycle` (A nests B nests A). Routed through the diagnostic seam by the caller. */
  diagnostics: PoolDiagnostic[]
}

/** A foreign file the linker folds: its parsed frontmatter, and its resolved path (for cycle detection
 *  by identity — two wikilink spellings of one file share a path). The APP pre-loads these async (the
 *  reads are async, the fold is sync), keyed by wikilink target; the linker looks each up synchronously. */
export type ForeignFile = { raw: Record<string, unknown>; path?: string }

/** Every cross-file target a pool references at a child position — the files the async pre-pass must
 *  load, so it can recurse into each and build the load closure before mounting. Order-preserving,
 *  duplicates included (the caller dedupes by resolved path). */
export function crossFileTargets(pool: CompositionPool, schemas: ContainerSchemas): string[] {
  const targets: string[] = []
  const visitValue = (value: unknown, field: SlotField): void => {
    // Only a raw [[...]] STRING at a child position can be cross-file; a normalized pool holds refs (or
    // structural nodes / slot-wrappers) here, never an inline projection, so this misses nothing.
    if (classifyOccupant(value, field, schemas) === 'structural-node') {
      visitRecord(value as Record<string, unknown>)
      return
    }
    const inner = classifyOccupant(value, field, schemas) === 'slot-wrapper' ? (value as Record<string, unknown>)['child'] : value
    const parsed = parseRef(inner)
    if (parsed?.file !== undefined) targets.push(parsed.file)
  }
  const visitRecord = (rec: Record<string, unknown>): void => {
    const schema = schemaFor((rec as { type?: string }).type, schemas)
    if (!schema) return
    for (const field of schema.fields) for (const occ of occupantsOf(rec, field)) visitValue(occ, field)
  }
  for (const rec of pool.records.values()) visitRecord(rec)
  return targets
}

/**
 * Link an entry pool with its nested files into ONE mount pool, following `[[file]]` / `[[file^^id]]`
 * cross-file references. Fold every nested file's records into the flat pool under
 * qualified ids and rewrite each cross-file ref to a LOCAL qualified ref, so the whole downstream
 * machinery (resolver / `analyzePool` / `parentMap` / portal) stays single-pool and unchanged.
 *
 * The entry pool is NOT mutated. Records with no cross-file ref are shared by reference (cheap); only a
 * record carrying a cross-file ref is copied and rewritten. When there is no nesting the returned pool
 * is the entry pool with an empty scope table — the common case costs one shallow scan.
 *
 * `loadForeign` is a SYNC lookup into files the app pre-loaded (the reads are async; the fold is not).
 * A missing file warns and leaves the ref dangling (an empty position). A cross-file CYCLE (A nests B
 * nests A, by resolved path) warns and breaks the back-edge to an empty position — never an infinite fold.
 *
 * The same file nested at two positions folds TWICE (two scopes, distinct qualified ids), so each is an
 * independent mount with its own pane identity — nesting a sub-layout twice gives two working copies, not
 * a duplicate placeholder. (`loadForeign` caches the raw READ; the FOLD is per reference.)
 */
export function linkPool(
  entryPool: CompositionPool,
  schemas: ContainerSchemas,
  loadForeign: (target: string) => ForeignFile | undefined,
  mintId: () => string = () => `link-${Math.random().toString(36).slice(2)}`,
  entryPath?: string,
): LinkedPool {
  const records = new Map(entryPool.records)
  const scopes = new Map<string, ScopeInfo>([
    [ENTRY_SCOPE, { scopeId: ENTRY_SCOPE, meta: entryPool.meta, rootId: primaryContentId(entryPool) ?? entryPool.roots[0] ?? '' }],
  ])
  const recordScope = new Map<string, string>()
  const originRef = new Map<string, string>()
  const diagnostics: PoolDiagnostic[] = []
  const missing = new Set<string>()
  let scopeSeq = 0

  const qualify = qualifyScopedId
  const crossRefString = (ref: ParsedRef): string => `[[${ref.file}${ref.id !== undefined ? `^^${ref.id}` : ''}]]`

  // Fold the file a cross-file ref names into a fresh scope and return the LOCAL qualified id the ref
  // should point at, or `false` to EMPTY the position (a missing file, a cross-file cycle, or a bad
  // `^^id`) — we warn and the resolver yields an empty position, never a raw ref string a container
  // would throw on.
  const foldRef = (ref: ParsedRef, parentScopeId: string, pathStack: readonly string[]): string | false => {
    const target = ref.file!
    const loaded = loadForeign(target)
    if (!loaded) {
      if (!missing.has(target)) {
        missing.add(target)
        diagnostics.push({
          code: 'composition-cross-file-missing',
          severity: 'warning',
          subject: 'composition',
          message: `nested reference [[${target}]] did not load; its position is empty`,
          ids: [target],
        })
      }
      return false
    }
    const path = loaded.path ?? target
    if (pathStack.includes(path)) {
      diagnostics.push({
        code: 'composition-cross-file-cycle',
        severity: 'warning',
        subject: 'composition',
        message: `nested composition ${path} references itself through a cross-file cycle; the walk breaks at the repeat`,
        ids: [...pathStack, path],
      })
      return false
    }
    const scopeId = `s${++scopeSeq}`
    const sub = normalizeToPool(loaded.raw, schemas, mintId)
    const nextStack = [...pathStack, path]
    // The record actually mounted at this position: a `[[file^^id]]` names one record, a bare `[[file]]`
    // names the sub-composition's PRIMARY WINDOW's CONTENT (a nested composition mounts its view inline,
    // it never opens OS windows for a sub-layout).
    const foldEntry = ref.id ?? primaryContentId(sub) ?? sub.roots[0] ?? ''
    // Fold only the mounted entry's subtree — never the sub's `window` records (roots not reachable from
    // the content), which would otherwise fold in unreferenced and read as orphans.
    const keep = foldEntry ? reachableRecordIds({ roots: [foldEntry], records: sub.records, transient: new Set() }, schemas) : new Set<string>()
    for (const [origId, rec] of sub.records) {
      if (!keep.has(origId)) continue
      const qid = qualify(scopeId, origId)
      records.set(qid, requalify(rec, scopeId, nextStack))
      recordScope.set(qid, scopeId)
    }
    scopes.set(scopeId, { scopeId, sourcePath: path, target, meta: sub.meta, parentScopeId, rootId: qualify(scopeId, foldEntry) })
    if (ref.id !== undefined && !sub.records.has(ref.id)) {
      diagnostics.push({
        code: 'composition-cross-file-missing',
        severity: 'warning',
        subject: 'composition',
        message: `nested reference [[${target}^^${ref.id}]] names no record in ${path}; its position is empty`,
        ids: [`${target}^^${ref.id}`],
      })
      return false
    }
    const qualifiedTarget = qualify(scopeId, foldEntry)
    originRef.set(qualifiedTarget, crossRefString(ref)) // remember the original ref, to restore it on save
    return qualifiedTarget
  }

  // Copy a record with its local refs re-qualified into `scopeId` and its cross-file refs folded. Runs
  // over a NESTED (sub-pool) record; every child edge becomes a local qualified ref (or empties).
  const requalify = (rec: Record<string, unknown>, scopeId: string, pathStack: readonly string[]): PoolRecord =>
    rewriteChildEdges(rec, (parsed) =>
      parsed.file !== undefined ? foldRef(parsed, scopeId, pathStack) : qualify(scopeId, parsed.id!),
    ) as PoolRecord

  // Rewrite an ENTRY record's cross-file refs (its local refs are bare and stay). Returns the same
  // object when it holds no cross-file ref, so untouched entry records are shared.
  const entryStack = entryPath !== undefined ? [entryPath] : []
  const linkEntry = (rec: Record<string, unknown>): PoolRecord =>
    rewriteChildEdges(rec, (parsed) => (parsed.file !== undefined ? foldRef(parsed, ENTRY_SCOPE, entryStack) : undefined)) as PoolRecord

  // The shared edge walk: for each child occupant, `decide(parsedRef)` returns the LOCAL id to point at
  // (a string), `false` to EMPTY the position, or `undefined` to leave the ref unchanged. Descends
  // structural nodes and slot-wrappers like the resolver. Returns the same object when nothing changed.
  function rewriteChildEdges(
    rec: Record<string, unknown>,
    decide: (parsed: ParsedRef) => string | false | undefined,
  ): Record<string, unknown> {
    const schema = schemaFor((rec as { type?: string }).type, schemas)
    if (!schema) return rec
    let changed = false
    const out: Record<string, unknown> = { ...rec }
    const mapOccupant = (value: unknown, field: SlotField): unknown => {
      const kind = classifyOccupant(value, field, schemas)
      if (kind === 'structural-node') {
        const inner = rewriteChildEdges(value as Record<string, unknown>, decide)
        if (inner !== value) changed = true
        return inner
      }
      if (kind === 'slot-wrapper') {
        const w = value as Record<string, unknown>
        const parsed = parseRef(w['child'])
        if (!parsed) return value
        const to = decide(parsed)
        if (to === undefined) return value
        changed = true
        return { ...w, child: to === false ? undefined : blockRef(to) } // false → empty the slot's occupant
      }
      // a raw [[...]] string (local or cross-file) at a direct child position
      const parsed = parseRef(value)
      if (!parsed) return value
      const to = decide(parsed)
      if (to === undefined) return value
      changed = true
      return to === false ? undefined : blockRef(to) // false → empty position (never a raw ref string)
    }
    for (const field of schema.fields) {
      if (!(field.name in rec)) continue
      const occs = occupantsOf(rec, field)
      const mapped = occs.map((occ) => mapOccupant(occ, field))
      out[field.name] = field.list ? mapped : mapped.length > 0 ? mapped[0] : rec[field.name]
    }
    return changed ? out : rec
  }

  for (const [id, rec] of entryPool.records) {
    const linked = linkEntry(rec)
    if (linked !== rec) records.set(id, linked)
  }

  return { pool: { roots: entryPool.roots, records, meta: entryPool.meta, transient: new Set([...entryPool.transient].filter((id) => records.has(id))) }, scopes: { scopes, recordScope, originRef }, diagnostics }
}

/**
 * Restore a record's cross-file refs before it is written into the authoritative ENTRY pool. The linker
 * rewrote each `[[file]]` / `[[file^^id]]` to a local qualified ref (`[[^^__s1-grp]]`) so the resolver
 * stays single-pool; a container mounted with that qualified id re-serializes it into its own record,
 * which — for an ENTRY container holding a nested child — would overwrite the original cross-file ref and
 * corrupt the file. This reverses the rewrite at each child edge via `ScopeTable.originRef`, so a plain
 * dialect save (a resize) or a structural edit keeps `[[nested]]` intact. A no-op (returns the same
 * object) when `originRef` is empty (no nesting) or the record carries no qualified ref.
 */
export function restoreCrossFileRefs(
  record: Record<string, unknown>,
  schemas: ContainerSchemas,
  originRef: ReadonlyMap<string, string>,
): Record<string, unknown> {
  if (originRef.size === 0) return record
  const restore = (parsed: ParsedRef): string | undefined =>
    parsed.file === undefined && parsed.id !== undefined && originRef.has(parsed.id) ? originRef.get(parsed.id) : undefined
  const walk = (rec: Record<string, unknown>): Record<string, unknown> => {
    const schema = schemaFor((rec as { type?: string }).type, schemas)
    if (!schema) return rec
    let changed = false
    const out: Record<string, unknown> = { ...rec }
    const mapOccupant = (value: unknown, field: SlotField): unknown => {
      const kind = classifyOccupant(value, field, schemas)
      if (kind === 'structural-node') {
        const inner = walk(value as Record<string, unknown>)
        if (inner !== value) changed = true
        return inner
      }
      if (kind === 'slot-wrapper') {
        const w = value as Record<string, unknown>
        const parsed = parseRef(w['child'])
        const to = parsed && restore(parsed)
        if (!to) return value
        changed = true
        return { ...w, child: to } // `to` is the ORIGINAL [[file]] ref string, written verbatim
      }
      if (kind !== 'ref') return value
      const parsed = parseRef(value)
      const to = parsed && restore(parsed)
      if (!to) return value
      changed = true
      return to
    }
    for (const field of schema.fields) {
      if (!(field.name in rec)) continue
      const occs = occupantsOf(rec, field)
      const mapped = occs.map((occ) => mapOccupant(occ, field))
      out[field.name] = field.list ? mapped : mapped.length > 0 ? mapped[0] : rec[field.name]
    }
    return changed ? out : rec
  }
  return walk(record)
}

// --- 1.2b pool -> composition document (the on-disk POOL FORM) ----------------------------------

/** The composition type's fully-qualified name. Owned by au-host-sdk, always this owner. */
const COMPOSITION_TYPE = 'composition::au-host-sdk'
/** The shared empty id-set: the "treat nothing as transient" stand-in a full serialize uses (see ATOMICITY). */
const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>()

/**
 * Serialize a pool to the canonical on-disk POOL FORM: a `composition` document whose `root` is a
 * `[[^^id]]` reference and whose `projections` is the flat list of pool records (each keeping its
 * `^:`). The inverse of `normalizeToPool` that KEEPS the pool flat (as opposed to `resolvePoolToTree`,
 * which re-inlines it into a mount tree). This is what the host writes to disk.
 *
 * The root record is one pool member like any other, referenced by `root`; nothing is embedded, so no
 * container ever re-serializes a stale child. Composition-scoped metadata (the `intent-routing` aspect
 * record + any future composition-scoped field) rides on `pool.meta`, captured generically, and is spread
 * back onto the DOCUMENT here — so the field survives a round-trip. The composition is ALWAYS
 * `type: composition`: routing is a first-class FIELD, never a mixin claim, so any `type` the meta bag
 * captured is DROPPED (a stale mixin claim can never be re-minted). `root` and `projections` always come
 * from the pool and win over any stale copies in the bag.
 *
 * TRANSIENT records never reach disk: a record in `pool.transient` (a preview / peek tab, any runtime-only
 * child) is skipped, AND every inbound ref to one is stripped from the records that stay — so a live-but-
 * unpersisted child leaves no dangling `[[^^id]]` (the ghost-collapse footgun). Stripping needs the schema
 * graph to know which fields hold children, so `schemas` is required. The strip runs only when something is
 * transient, so stripping leaves a leak-free pool's serialized bytes unchanged.
 *
 * ATOMICITY: the DROP and the ref-STRIP are inseparable — dropping a record without stripping the refs that
 * point at it writes a dangling `[[^^id]]`, the exact footgun this closes. Stripping needs a usable schema
 * graph, so BOTH run only when `schemas` can resolve containers. With an EMPTY schema graph (the not-loaded
 * fallback) we do a FULL serialize — a consistent snapshot, never a HALF drop. This cannot
 * arise in the app (the authority's schemas load before any preview can be minted), so it is a structural
 * floor, not a live path.
 */
export function serializePoolToComposition(pool: CompositionPool, schemas: ContainerSchemas): Record<string, unknown> {
  const { type: _type, ...restMeta } = pool.meta ?? {}
  // The transient drop is enabled ONLY when refs can also be stripped (schemas resolve containers). Empty
  // schemas → treat NOTHING as transient → a full serialize, so a drop is never half-applied. See ATOMICITY.
  const canDropTransient = pool.transient.size > 0 && schemas.containers.size > 0
  const transient: ReadonlySet<string> = canDropTransient ? pool.transient : EMPTY_ID_SET
  const projections: PoolRecord[] = []
  for (const [id, rec] of pool.records) {
    if (transient.has(id)) continue // a transient record never reaches disk
    projections.push(transient.size > 0 ? (stripTransientRefs(rec, transient, schemas) as PoolRecord) : rec)
  }
  return {
    type: COMPOSITION_TYPE,
    ...restMeta,
    windows: pool.roots.map(blockRef),
    projections,
  }
}

/**
 * Strip every inbound reference to a TRANSIENT record from `record`, so serialize drops the transient
 * record without leaving a dangling `[[^^id]]` behind. Mirrors `restoreCrossFileRefs`'s occupant walk, but
 * FILTERS child occupants instead of mapping them: a ref or slot-wrapper pointing at a transient id is
 * dropped, a structural node recurses. A single (non-list) child slot whose sole occupant was transient
 * loses the field — the child is genuinely gone from disk. Returns the same object when nothing changed.
 */
function stripTransientRefs(record: Record<string, unknown>, transient: ReadonlySet<string>, schemas: ContainerSchemas): Record<string, unknown> {
  const isTransientRef = (v: unknown): boolean => {
    const parsed = parseRef(v)
    return parsed?.file === undefined && parsed?.id !== undefined && transient.has(parsed.id)
  }
  const walk = (rec: Record<string, unknown>): Record<string, unknown> => {
    const schema = schemaFor((rec as { type?: string }).type, schemas)
    if (!schema) return rec
    let changed = false
    const out: Record<string, unknown> = { ...rec }
    for (const field of schema.fields) {
      if (!(field.name in rec)) continue
      const kept: unknown[] = []
      for (const occ of occupantsOf(rec, field)) {
        const kind = classifyOccupant(occ, field, schemas)
        if (kind === 'ref') {
          if (isTransientRef(occ)) changed = true
          else kept.push(occ)
        } else if (kind === 'slot-wrapper') {
          if (isTransientRef((occ as Record<string, unknown>)['child'])) changed = true
          else kept.push(occ)
        } else if (kind === 'structural-node') {
          const inner = walk(occ as Record<string, unknown>)
          if (inner !== occ) changed = true
          kept.push(inner)
        } else {
          kept.push(occ)
        }
      }
      if (field.list) out[field.name] = kept
      else if (kept.length > 0) out[field.name] = kept[0]
      else {
        // A non-list child slot whose SOLE occupant was transient loses the field — the child is genuinely
        // gone from disk. INVARIANT: a REQUIRED single-child slot must not be a transient/preview target, or
        // the serialized config drops a required field and fails (advisory) validation. Holds today because
        // every preview target is a list slot with no arity floor (tabs); a single-slot preview target would
        // first need an empty-slot form.
        delete out[field.name]
        changed = true
      }
    }
    return changed ? out : rec
  }
  return walk(record)
}

/**
 * Return the projection type used to mount a record. A string claim is the type name; a mixin list
 * uses its first claim as the projection base. Return undefined when no string type is present.
 */
export function recordMountType(record: unknown): string | undefined {
  const t = (record as { type?: unknown } | null | undefined)?.type
  if (typeof t === 'string') return t
  if (Array.isArray(t) && typeof t[0] === 'string') return t[0]
  return undefined
}

export function poolRootType(doc: Record<string, unknown>): string | undefined {
  // A bare projection instance names its own mount module.
  if (!typeNames(doc['type']).includes('composition')) return recordMountType(doc)
  // A composition document: the module is the PRIMARY WINDOW's CONTENT type — the mounted view. Resolve
  // `windows` -> the primary window record -> its `content` ref -> that record's type.
  const projections = Array.isArray(doc['projections']) ? (doc['projections'] as unknown[]) : []
  const byId = (id: string | undefined): Record<string, unknown> | undefined =>
    id == null
      ? undefined
      : (projections.find((r) => r && typeof r === 'object' && recordId(r) === id) as Record<string, unknown> | undefined)
  const windowsRaw = Array.isArray(doc['windows']) ? (doc['windows'] as unknown[]) : doc['windows'] != null ? [doc['windows']] : []
  const windowIds = windowsRaw.map((w) => parseBlockRef(w)).filter((x): x is string => x != null)
  const primaryId = windowIds.find((id) => byId(id)?.['primary'] === true) ?? windowIds[0]
  const contentRec = byId(parseBlockRef(byId(primaryId)?.['content']))
  return recordMountType(contentRec)
}

// --- 1.3 the reference-graph analyzer: the mount-pool degrade + the graph diagnostics -----------

/**
 * The sentinel `type` of a synthetic DIAGNOSTIC PLACEHOLDER record. It is NOT a real projection
 * type-def and never touches disk — `analyzePool` mints it into the MOUNT POOL only, at each
 * non-canonical duplicate edge, so the host renders a diagnostic pane there instead of a second
 * mount of the collided record. The host mount seam special-cases this type (see `PaneProjection`).
 */
export const COMPOSITION_PLACEHOLDER_TYPE = 'composition-placeholder'

/** Whether a resolved record is a synthetic duplicate placeholder (the host renders a diagnostic pane). */
export function isPlaceholderRecord(record: unknown): record is PoolRecord & { kind: string; collidedId: string } {
  return (
    record != null &&
    typeof record === 'object' &&
    (record as { type?: unknown }).type === COMPOSITION_PLACEHOLDER_TYPE
  )
}

/**
 * The result of one whole-pool analysis: the reference-graph diagnostics, plus a MOUNT POOL that
 * degrades the duplicate case by construction.
 */
export interface PoolAnalysis {
  /** Reference-graph findings computed with the mount pool and reported through the diagnostic seam. */
  diagnostics: PoolDiagnostic[]
  /**
   * The pool to MOUNT from. Identical to the input pool except at DUPLICATE edges: the first
   * occurrence (document order) keeps its real reference; each later edge is redirected to a fresh
   * synthetic placeholder record. So resolving this pool — even the per-child re-resolve keyed by id
   * alone — yields the real record once and a placeholder at every other site, without any per-site
   * context. Referentially the SAME object as the input when there are no duplicates (the common case).
   */
  mountPool: CompositionPool
}

/**
 * Analyze the pool's reference graph in ONE document-order walk from `root`, producing both the
 * diagnostics and the degrade-ready mount pool.
 *
 * The invariants the type system cannot express (it validates each record and that a reference
 * RESOLVES, not the global graph shape), and how each degrades:
 * - `composition-duplicate-in-tree` a record reached by more than one edge: the FIRST edge mounts it,
 *   every later edge is redirected to a synthetic placeholder record (the mount pool carries both).
 * - `composition-reference-cycle`   a record reached again on its own path: the edge is left as-is and
 *   the resolver breaks it to an empty position; the finding warns.
 * - `composition-orphan`            a pool record no walk reaches: warned; the host offers a prune.
 * - `composition-dangling-reference` a reference to a missing record: left dangling (an empty position)
 *   and warned. A dangling ROOT is an error.
 *
 * The placeholder redirect is per non-canonical EDGE (N references → N-1 placeholders), but the
 * duplicate diagnostic is emitted ONCE per collided id. The mount pool is a shallow derivation: only
 * records that carry a redirected edge are copied, plus the placeholder records; everything else is
 * shared, and the input pool is returned unchanged when the graph is clean.
 */
export function analyzePool(pool: CompositionPool, schemas: ContainerSchemas): PoolAnalysis {
  const diagnostics: PoolDiagnostic[] = []
  const reached = new Set<string>() // every record reached at least once
  const seenDup = new Set<string>() // reported duplicates, so N edges warn once
  const seenDangling = new Set<string>()
  const rewritten = new Map<string, PoolRecord>() // parentId -> a copy with its non-canonical edges redirected
  const placeholders = new Map<string, PoolRecord>()
  let phSeq = 0

  // Decide one child reference edge: emit any diagnostic, recurse into a canonical child, and return
  // the id the edge should reference — the SAME id to keep it, or a fresh placeholder id to redirect it.
  const decideEdge = (childId: string, onPath: ReadonlySet<string>): string => {
    if (!pool.records.has(childId)) {
      if (!seenDangling.has(childId)) {
        seenDangling.add(childId)
        diagnostics.push({
          code: 'composition-dangling-reference',
          severity: 'warning',
          subject: 'composition',
          message: `references ^${childId}, which is not in the pool`,
          ids: [childId],
        })
      }
      return childId // leave dangling: the resolver yields an empty position, and this warns
    }
    if (onPath.has(childId)) {
      diagnostics.push({
        code: 'composition-reference-cycle',
        severity: 'warning',
        subject: 'composition',
        message: `record ^${childId} references itself through a cycle; the walk breaks at the repeat`,
        ids: [...onPath, childId],
      })
      return childId // leave it: the resolver breaks the cycle to an empty position, and this warns
    }
    if (reached.has(childId)) {
      if (!seenDup.has(childId)) {
        seenDup.add(childId)
        diagnostics.push({
          code: 'composition-duplicate-in-tree',
          severity: 'warning',
          subject: 'composition',
          message: `record ^${childId} is referenced more than once in one mounted tree; the first mounts, the rest show a placeholder`,
          ids: [childId],
        })
      }
      const phId = `__ph-${++phSeq}-${childId}`
      placeholders.set(phId, {
        [BLOCK_ID_KEY]: phId,
        type: COMPOSITION_PLACEHOLDER_TYPE,
        kind: 'duplicate',
        collidedId: childId,
      } as PoolRecord)
      return phId // redirect this non-canonical edge to its own placeholder
    }
    walk(childId, onPath) // canonical: descend, keep the edge
    return childId
  }

  // Rewrite a record's child structure by deciding each ref edge, descending structural nodes and
  // slot-wrappers exactly as the resolver does. Returns the same object when nothing was redirected.
  const rewriteRecord = (rec: Record<string, unknown>, onPath: ReadonlySet<string>): Record<string, unknown> => {
    const schema = schemaFor((rec as { type?: string }).type, schemas)
    if (!schema) return rec
    let changed = false
    const out: Record<string, unknown> = { ...rec }
    for (const field of schema.fields) {
      if (!(field.name in rec)) continue
      const occs = occupantsOf(rec, field)
      const mapped = occs.map((occ) => {
        const [val, didChange] = rewriteOccupant(occ, field, onPath)
        if (didChange) changed = true
        return val
      })
      out[field.name] = field.list ? mapped : mapped.length > 0 ? mapped[0] : rec[field.name]
    }
    return changed ? out : rec
  }

  const rewriteOccupant = (value: unknown, field: SlotField, onPath: ReadonlySet<string>): [unknown, boolean] => {
    switch (classifyOccupant(value, field, schemas)) {
      case 'ref': {
        const childId = parseBlockRef(value)!
        const decided = decideEdge(childId, onPath)
        return decided === childId ? [value, false] : [blockRef(decided), true]
      }
      case 'structural-node': {
        const inner = rewriteRecord(value as Record<string, unknown>, onPath)
        return [inner, inner !== value]
      }
      case 'slot-wrapper': {
        const w = value as Record<string, unknown>
        if (!isBlockRef(w['child'])) return [value, false]
        const childId = parseBlockRef(w['child'])!
        const decided = decideEdge(childId, onPath)
        return decided === childId ? [value, false] : [{ ...w, child: blockRef(decided) }, true]
      }
      default:
        return [value, false]
    }
  }

  const walk = (id: string, onPath: ReadonlySet<string>): void => {
    reached.add(id)
    const rec = pool.records.get(id)
    if (!rec) return
    const nextPath = new Set(onPath).add(id)
    const next = rewriteRecord(rec, nextPath)
    if (next !== rec) rewritten.set(id, next as PoolRecord)
  }

  for (const root of pool.roots) {
    if (!pool.records.has(root)) {
      diagnostics.push({
        code: 'composition-dangling-reference',
        severity: 'error',
        subject: 'composition',
        message: `window ^${root} names no record in the pool`,
        ids: [root],
      })
    } else {
      walk(root, new Set())
    }
  }

  for (const id of pool.records.keys()) {
    if (!reached.has(id)) {
      diagnostics.push({
        code: 'composition-orphan',
        severity: 'warning',
        subject: 'composition',
        message: `record ^${id} is in the pool but no root walk reaches it`,
        ids: [id],
      })
    }
  }

  let mountPool = pool
  if (rewritten.size > 0 || placeholders.size > 0) {
    const records = new Map(pool.records)
    for (const [id, rec] of rewritten) records.set(id, rec)
    for (const [id, rec] of placeholders) records.set(id, rec)
    mountPool = { roots: pool.roots, records, transient: new Set([...pool.transient].filter((id) => records.has(id))) }
  }
  return { diagnostics, mountPool }
}

/**
 * Validate the pool's reference graph (detection only). A thin wrapper over `analyzePool`, so the walk
 * is defined ONCE; the degrade (the mount pool) is discarded here. Findings are warnings (plus a
 * root-dangling error) routed through the diagnostic seam by the caller.
 */
export function validatePool(pool: CompositionPool, schemas: ContainerSchemas): PoolDiagnostic[] {
  return analyzePool(pool, schemas).diagnostics
}

/**
 * Every record id REACHABLE from `root` by following child references (the mount-tree walk). The
 * reaper's truthmaker: a record NOT in this set is an orphan — a closed pane whose reference nobody
 * re-added — and `applyStructural` drops it. A moved pane stays reachable (the target now references
 * it), so a MOVE keeps its record. A cycle or a duplicate reference is followed once (both are
 * reachable), so the reaper never deletes a live-but-mis-referenced record; the validator owns those.
 */
export function reachableRecordIds(pool: CompositionPool, schemas: ContainerSchemas): Set<string> {
  const reached = new Set<string>()
  const walk = (id: string): void => {
    if (reached.has(id)) return
    reached.add(id)
    const rec = pool.records.get(id)
    if (!rec) return
    for (const childId of childRefIds(rec, schemas)) walk(childId)
  }
  for (const root of pool.roots) if (pool.records.has(root)) walk(root)
  return reached
}

/**
 * The records reachable from ONE root id (its subtree), rather than every window root. A SURFACE mounts
 * only the records under ITS window's content, so the primary-window portal scopes its flat mount set to
 * `reachableFromRoot(pool, schemas, primaryContentId)` — otherwise a record floated under a SECONDARY
 * window (still in the pool, reachable via that window's root) would be mounted by the primary portal AND
 * the surface agent (a double mount, and two consumers on one per-pane pty). Single-window is unchanged:
 * the primary content root reaches the whole tree. `rootId` itself is included.
 */
export function reachableFromRoot(pool: CompositionPool, schemas: ContainerSchemas, rootId: string): Set<string> {
  const reached = new Set<string>()
  const walk = (id: string): void => {
    if (reached.has(id)) return
    reached.add(id)
    const rec = pool.records.get(id)
    if (!rec) return
    for (const childId of childRefIds(rec, schemas)) walk(childId)
  }
  if (pool.records.has(rootId)) walk(rootId)
  return reached
}

/**
 * The ghost-ref COLLAPSE fingerprint — the loud host surface for the pane-identity footgun.
 *
 * A container that mints a content-bearing child WITHOUT its `^:` pool id makes serialize emit a
 * FRESH id the render side never used. The parent then references a GHOST (a dangling edge) while the
 * real child records go unreferenced, so the reaper deletes them — a NON-LOCAL, catastrophic collapse
 * where one bad pane wipes OTHERS, usually down to a single empty pane. `analyzePool` already warns
 * each dangling ref and each orphan, but per-record and WITHOUT HISTORY, so the collapse reads as a
 * scatter of ordinary warnings rather than the disaster it is.
 *
 * This detects the DELTA only the footgun produces, by comparing one generation to the next:
 * - `≥2` records reachable LAST generation are gone-or-orphaned THIS one (a real close reaps one), AND
 * - the new pool carries a dangling reference (a legit multi-close removes its edges too, so it
 *   orphans records but introduces NO dangling ref — the co-occurrence is the fingerprint).
 *
 * Returns the reaped ids + the ghost ids so the host raises ONE loud `composition-mass-reap`, or
 * `null` when the transition is benign. The reference-unit model (a host-assigned id, container-core's
 * `createChild`) makes the footgun unreachable; this is the net for any container — including a non-kit third party — that still
 * trips it.
 */
export function detectGhostRefCollapse(
  prevReachable: ReadonlySet<string>,
  nextPool: CompositionPool,
  schemas: ContainerSchemas,
): { reaped: string[]; ghosts: string[] } | null {
  const nextReachable = reachableRecordIds(nextPool, schemas)
  const reaped = [...prevReachable].filter((id) => !nextReachable.has(id))
  if (reaped.length < 2) return null // a real close reaps one; a mass reap is the footgun's signature
  const ghosts = [
    ...new Set(
      analyzePool(nextPool, schemas)
        .diagnostics.filter((d) => d.code === 'composition-dangling-reference')
        .flatMap((d) => d.ids ?? []),
    ),
  ]
  if (ghosts.length === 0) return null // orphaning without a dangling ref is a legit bulk close
  return { reaped, ghosts }
}

/**
 * The child → PARENT map over the pool's reference graph: each record id maps to the id of the
 * record that references it at a child position. The composition root (and any orphan) has no entry.
 *
 * This is the pool's TRUE mount topology, known synchronously and completely — the portal layer mounts
 * every pane FLAT (each a top-level host, so a re-parent never triggers a React unmount), which
 * collapses the mount-CALL nesting the runtime's intent/focus/selection channels walk. Deriving
 * parentage from HERE instead restores it, order-independently and across remounts. A duplicate
 * reference resolves to the FIRST referrer (document order), matching the mount pool's canonical edge.
 *
 */
export function parentMap(pool: CompositionPool, schemas: ContainerSchemas): Map<string, string> {
  const parent = new Map<string, string>()
  for (const [id, rec] of pool.records) {
    for (const childId of childRefIds(rec, schemas)) {
      if (!parent.has(childId)) parent.set(childId, id) // first referrer wins (canonical edge)
    }
  }
  return parent
}

/** A publisher's opaque runtime id (host-sdk `PublisherId`, restated as a bare string so this pure
 *  module carries no runtime import). */
type PublisherRef = string

/** The maps the runtime feeds `resolveLogicalParent`, one mount generation's worth. */
export interface LogicalParentInput {
  /** The node's own stable `^:` id. `''`/`undefined` for the root or an id-less legacy mount. */
  nodeId: string | undefined
  /** The mount-CALL parent — the fallback when there is no pool topology to read. */
  mountParentId: PublisherRef | null
  /** True when the host owns a pool for this mount generation (false in a detached-window runtime). */
  hasPool: boolean
  /** The pool's window-root ids (`pool.roots`); a node whose parent IS a window (the multi-surface root
   *  layer) maps to `rootPublisher` — the window is the logical top, its content hangs under the owner. */
  poolRoots: readonly string[]
  /** child `^:` → parent `^:`, from `parentMap` over the MOUNT pool — so a duplicate PLACEHOLDER (present
   *  only in the mount pool) carries a parent edge and does not fall through to the top. */
  poolParents: ReadonlyMap<string, string>
  /** A mounted pane's stable `^:` → its live publisher, maintained on mount/unmount. */
  nodeIdToPublisher: ReadonlyMap<string, PublisherRef>
  /** The publisher of the composition root (the runtime's `mainRoot ?? rootPublisher`). */
  rootPublisher: PublisherRef | null
}

/**
 * THE PARENTAGE BRIDGE, pure. Resolve a mounted node's LOGICAL parent publisher from the POOL topology
 * rather than the mount call. The portal mounts every pane FLAT (each a top-level host under the kernel
 * root), so the mount-call parent would collapse the whole tree onto the root and break intent/focus/
 * selection nesting. The pool's reference graph is the true tree, so parentage comes from there.
 *
 * Branches, in order:
 * - no pool wired, or an id-less mount (window node / legacy) → the mount-call parent (`mountParentId`).
 * - the node's `^:` has no parent edge (a window root, or an orphan) → `null` (top of the tree).
 * - the parent edge IS a window root → the composition root's publisher (`rootPublisher`); a window is
 *   the logical top layer (its own node is unmounted), so its content maps to the owner.
 * - otherwise → the parent `^:`'s live publisher, or `null` when that parent is NOT YET MOUNTED. That
 *   null is a transient of the async flat-mount settle, not a resolver defect: at that instant there is
 *   no publisher to name. It re-resolves correctly once the parent registers (routing is queried lazily,
 *   at dispatch, not at mount). The durable cure for a mid-cascade query is mount ORDERING, not here.
 *
 * The caller owns the node lookup (`!node → null`); this takes only the resolved node's fields.
 */
export function resolveLogicalParent(input: LogicalParentInput): PublisherRef | null {
  const { nodeId, mountParentId, hasPool, poolRoots, poolParents, nodeIdToPublisher, rootPublisher } = input
  if (!hasPool || !nodeId) return mountParentId // window node / id-less / no pool → mount-call parent
  const parentNodeId = poolParents.get(nodeId)
  if (parentNodeId === undefined) return null // a window root (or an orphan) has no parent → top
  if (poolRoots.includes(parentNodeId)) return rootPublisher // its parent IS a window (the root layer)
  return nodeIdToPublisher.get(parentNodeId) ?? null // parent not yet mounted → transient top (see doc)
}

/** Every block-id a record references at its child positions (refs and slot-wrapper children),
 *  descending structural nodes inline. Order-preserving, duplicates included. */
export function childRefIds(record: Record<string, unknown>, schemas: ContainerSchemas): string[] {
  const ids: string[] = []
  const visit = (rec: Record<string, unknown>): void => {
    const schema = schemaFor((rec as { type?: string }).type, schemas)
    if (!schema) return
    for (const field of schema.fields) {
      for (const occ of occupantsOf(rec, field)) {
        switch (classifyOccupant(occ, field, schemas)) {
          case 'ref':
            ids.push(parseBlockRef(occ)!)
            break
          case 'structural-node':
            visit(occ as Record<string, unknown>)
            break
          case 'slot-wrapper': {
            const child = (occ as Record<string, unknown>)['child']
            if (isBlockRef(child)) ids.push(parseBlockRef(child)!)
            break
          }
          // a 'projection' inline record at a pool site is not a reference; a normalized pool has none
        }
      }
    }
  }
  visit(record)
  return ids
}
