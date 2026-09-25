// Discover projections through the type system. A loadable `projection` subtype carries
// `projection-runtime-meta` with its entry and contract version. Its type name supplies identity;
// its type-definition source locates the owning package, which resolves the metadata entry.

import { readSubtypes, type WireMetaBlock, type WireReader, type WireSubtype } from '@arsumbris/au-host-sdk/engine-reads'
import { refName } from '@arsumbris/type-query'
import { checkProjectionMeta, codeMetaBlock, FIRES_INTENT_META, HANDLES_INTENT_META, metaBlock, PROJECTION_RUNTIME_META } from '@arsumbris/au-host-sdk'
import { EDITS_COMPOSITION_CONFIG_META } from '@arsumbris/intent'

import { packageRootOf } from '../../../shared/package-root'

/** The open base every projection subtype extends. */
const BASE_TYPE = 'projection'
// The meta a projection subtype carries, own or inherited, each read in the same `subtypes` pass:
//  - `projection-runtime-meta`: its loadable code.
//  - `handles-intent-meta`: the intents it HANDLES, so "who handles X" is a client-side filter.
//  - `fires-intent-meta`: the intents it FIRES, a static type-graph fact `host.intent.fire` is gated on.
//  - `edits-composition-config-meta`: the composition-config ASPECTS it may EDIT (a warn-rung gate).

/**
 * A projection subtype that DECLARES loadable code but failed the contract handshake, so it is
 * not mountable. Carried out of discovery rather than dropped: the type-def IS discoverable and
 * the user authored it deliberately, so its absence needs an explanation, not silence.
 *
 * `checkProjectionMeta` supplies the precise rejection message for the host to display.
 */
export interface RejectedProjection {
  /** The subtype name that was rejected. */
  typeName: string
  /** Its owner repo, so a cross-repo rejection is attributable. */
  repo: string
  /** Where the type-def lives, so the author can go fix it. */
  sourceFile: string
  /** `checkProjectionMeta`'s messages, e.g. the version delta. */
  errors: string[]
}

/** What a discovery pass found: the mountable set, plus what was refused and why. */
export interface DiscoveryResult {
  projections: DiscoveredProjection[]
  rejected: RejectedProjection[]
}

/** A projection discovered by the type-system query. Identity is the type name. */
export interface DiscoveredProjection {
  /**
   * The projection subtype name supplies its identity.
   */
  typeName: string
  /** The OWNER repo of this subtype (from the workspace `subtypes` read, deduped to owner copies).
   *  With `typeName` it forms the cross-repo identity `(name, repo)` a qualified `type:` claim matches. */
  repo: string
  /** ESM entry, relative to the owning package root. From the type-def meta. */
  entry: string
  /** The named module export the host mounts (the locator's `export`), default `mount`.
   *  Lets several kind-typed surfaces share one entry. From the type-def meta. */
  export?: string
  /** Mount-contract version the code was built against. From the type-def meta. */
  contractVersion: number
  /** The owning package root on disk: the type-def's source minus `/type/<file>`. */
  packageRoot: string
  /** Token-declaration stylesheet(s), relative to the package root. Declarations-only
   *  (`@property` + `:root` custom-prop defaults). The host eager-loads these at document
   *  level so a theming pane can discover this projection's own `--au-<projection>-*` tokens,
   *  mounted or not. From the type-def meta; absent for most projections. */
  customTokenEntry?: string[]
  /**
   * The KIND closure: every ancestor type name in this projection's closure (its kinds — e.g.
   * `pane-projection` / `bar-item-projection` / `bar-projection` / `container-projection`, plus
   * `projection`). The kind query (a bar listing the `bar-item-projection` subtypes) is just the
   * projections whose `kinds` include the kind — computed here in the SAME `subtypes` pass.
   */
  kinds: string[]
  /**
   * The projection's OWN EFFECTIVE SHAPE: every field name declared by this type or any ancestor
   * in its `kinds` closure. This is the OWNERSHIP boundary — a projection is responsible for these
   * and for nothing else on the instance, and the host guarantees the rest at `saveConfig`.
   *
   * DERIVED, never declared. Read in this same `subtypes` pass from the engine's served effective
   * fields, so there is no second read, no meta to author, and no hand-maintained list that can rot.
   *
   */
  ownedFields: string[]
  /**
   * The intents this projection TYPE declares it HANDLES (bare names, `::repo` stripped), from its
   * `handles-intent-meta` block. The static-declaration layer of the typed-capability model: "which
   * projection types handle intent X" is `found.filter(p => p.handles.includes(x))`, over data this
   * pass already holds. Empty when the subtype declares no `handles` meta. The RUNTIME handler still
   * binds at mount (`host.intent.handle`); this is the pre-mount, discoverable declaration.
   */
  handles: string[]
  /**
   * The intents this projection TYPE declares it handles ONLY WHEN AIMED at it (`handlesTargeted`),
   * NEVER as an ambient candidate. Lets a VIEWER be an open TARGET (replace its own content) without
   * hijacking ambient opens — the runtime folds it into `isAmbientReachable`.
   */
  handlesTargeted: string[]
  /**
   * The intents this projection TYPE declares it FIRES (bare names, `::repo` stripped), from its
   * `fires-intent-meta` block — the mirror of `handles`. Empty when the subtype declares no `fires`
   * meta. Feeds the DECLARED intent census (who can fire what, before any runtime activity) and the
   * runtime `.fire()` gate, which flags a fire the type-def does not declare.
   */
  fires: string[]
  /**
   * The composition-config ASPECTS this projection TYPE declares it may EDIT (bare names, `::repo`
   * stripped), from its `edits-composition-config-meta` block. Empty when the subtype declares none.
   * The bounded composition-edit-rights capability: the host gates a composition-aspect write against
   * this set (warn rung). Distinct axis from `fires`/`handles` (bounded to `composition-config`).

   */
  edits: string[]
  /**
   * Every declared META BLOCK, keyed by bare meta-type name, each body assembled into a plain record.
   * Raw and generic — folded here in the SAME `subtypes` pass and published on
   * `ProjectionDescriptor.meta`, so a container reads a child's declared presentation
   * (`projection-presentation-meta`) with no engine read of its own. The typed fields above
   * (`entry` / `handles` / ...) stay the interpreted path; this is the uninterpreted one, so a
   * consumer reads any meta the host has not given a dedicated field.
   */
  meta: Record<string, Record<string, unknown>>
}

/** Index the discovered subtypes by bare NAME — the key a parent ref resolves to (names are
 *  workspace-unique, so `refName` strips any `::repo` and looks up here). */
function defIndex(all: WireSubtype[]): Map<string, WireSubtype> {
  return new Map(all.map((d) => [d.name, d]))
}

/**
 * The transitive ancestor closure of a subtype — its KIND set, as bare names (the role-as-kind
 * aggregation key). Resolves parents by NAME (`refName` drops any `::repo`; names are unique). A
 * parent name is emitted even when its def is absent from `byName` (e.g. the `projection` base, which
 * the `subtypes` read excludes) — the walk only recurses through defs that ARE present.
 *
 * This client walk runs once per discovered subtype inside the ONE `subtypes` pass — a hot path re-run
 * on every type-graph change — over data already in hand. Kind membership needs only ancestor NAMES
 * (which the `subtypes` set fully contains); there is no cross-repo hash subtlety here, unlike the
 * field/origin walks where the engine's effective-field authority matters. Adopting `type_closure`
 * here would be N extra round-trips per discovery for zero correctness gain. Do NOT "fix" it.
 */
function kindClosureOf(def: WireSubtype, byName: ReadonlyMap<string, WireSubtype>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (d: WireSubtype): void => {
    for (const parent of d.parents ?? []) {
      const name = refName(parent)
      if (seen.has(name)) continue
      seen.add(name)
      out.push(name)
      const parentDef = byName.get(name)
      if (parentDef) walk(parentDef)
    }
  }
  walk(def)
  return out
}

/** The field names a projection owns: its engine-served EFFECTIVE fields, own and inherited. A divergent
 *  field is one entry per origin on the wire and one owned name here. */
function ownedFieldsOf(def: WireSubtype): string[] {
  return [...new Set(def.effective_fields.map((f) => f.name))]
}

/** Assemble a meta block's body (`[{name, value}]`) into a plain record. */
function metaRecord(block: WireMetaBlock): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of block.body) out[field.name] = field.value
  return out
}

/** Every meta a subtype carries, own or inherited, keyed by bare meta-type name, each body assembled
 *  into a record. A conflicting meta (several surviving blocks) is left out: the engine reports it and the
 *  host picks no winner. The generic carrier behind `ProjectionDescriptor.meta`; the typed folds
 *  (`handlesOf`, the runtime meta) stay separate because they INTERPRET their block. */
export function metaMap(def: WireSubtype): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const { meta_type, blocks } of def.effective_meta) {
    if (blocks.length === 1) out[meta_type.name] = metaRecord(blocks[0]!)
  }
  return out
}

/** The bare NAME of a def-ref wikilink value (`[[ui-intent-highlight::intent|x]]` -> `ui-intent-highlight`).
 *  Strips the `[[ ]]`, any `|display` / `#anchor`, and the `::repo` qualifier — matching the bare intent
 *  names a fired intent's `type` carries. Undefined for a non-string / empty value. */
function refBareName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined
  const inner = ref.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0]?.trim() ?? ''
  const name = inner.split('::')[0]?.trim() ?? ''
  return name || undefined
}

/** The intents a projection subtype declares it handles: the bare names in its `handles-intent-meta`
 *  block's `handles` def-ref list. Empty when the subtype carries no such meta. */
function handlesOf(def: WireSubtype): string[] {
  const block = metaBlock(def, HANDLES_INTENT_META)
  if (!block) return []
  const value = metaRecord(block).handles
  if (!Array.isArray(value)) return []
  return value.map(refBareName).filter((n): n is string => n !== undefined)
}

/** The intents a projection subtype declares it handles ONLY WHEN AIMED — the bare names in its
 *  `handles-intent-meta` block's `handlesTargeted` list. Empty when absent. Sibling of `handlesOf`;
 *  feeds the runtime's ambient-reachability fold so a targeted-only handler is not an ambient candidate. */
function handlesTargetedOf(def: WireSubtype): string[] {
  const block = metaBlock(def, HANDLES_INTENT_META)
  if (!block) return []
  const value = metaRecord(block).handlesTargeted
  if (!Array.isArray(value)) return []
  return value.map(refBareName).filter((n): n is string => n !== undefined)
}

/** The intents a projection subtype declares it FIRES: the bare names in its `fires-intent-meta`
 *  block's `fires` def-ref list. Empty when the subtype carries no such meta. Mirror of `handlesOf`. */
function firesOf(def: WireSubtype): string[] {
  const block = metaBlock(def, FIRES_INTENT_META)
  if (!block) return []
  const value = metaRecord(block).fires
  if (!Array.isArray(value)) return []
  return value.map(refBareName).filter((n): n is string => n !== undefined)
}

/** The composition-config ASPECTS a projection subtype declares it may EDIT: the bare names in its
 *  `edits-composition-config-meta` block's `edits` def-ref list. Empty when the subtype carries no such
 *  meta. Mirror of `firesOf`, one axis over — the list is bounded to `composition-config`, not `intent`. */
function editsOf(def: WireSubtype): string[] {
  const block = metaBlock(def, EDITS_COMPOSITION_CONFIG_META)
  if (!block) return []
  const value = metaRecord(block).edits
  if (!Array.isArray(value)) return []
  return value.map(refBareName).filter((n): n is string => n !== undefined)
}

// Shared package-root resolution for all discovery consumers.
export { packageRootOf }

/**
 * Discover loadable projections by querying the type graph: the workspace's
 * `projection` subtypes, each kept when it carries a `projection-runtime-meta`
 * block whose meta passes the contract handshake (`checkProjectionMeta`). The
 * `subtypes` read already returns the owner copy (which carries the meta), so a
 * subtype without loadable meta is simply not a mountable projection.
 */
export async function discoverProjections(reader: WireReader): Promise<DiscoveryResult> {
  const result = await readSubtypes(reader, BASE_TYPE)
  if (!('ready' in result) || !result.ready || !result.result) return { projections: [], rejected: [] }
  const all = result.result.subtypes as WireSubtype[]
  // The def index spans ALL subtypes — including the abstract kind defs (pane / container / bar /
  // bar-item) — so a concrete projection's kind closure resolves transitively by name.
  const byName = defIndex(all)

  const found: DiscoveredProjection[] = []
  const rejected: RejectedProjection[] = []
  for (const def of all) {
    // An abstract subtype is never mounted.
    if (def.abstract) continue
    // Its runtime meta is its OWN block, never an ancestor's: a type loads only code it declares itself.
    const code = codeMetaBlock(def, PROJECTION_RUNTIME_META)
    if (code.kind === 'absent') continue // declares no code and none is required: not a loadable projection
    if (code.kind === 'not-own') {
      // A concrete projection that cannot load is told, never silently missing.
      rejected.push({ typeName: def.name, repo: def.repo, sourceFile: def.source.file, errors: [code.reason] })
      continue
    }
    const block = code.block
    const check = checkProjectionMeta(metaRecord(block))
    if (!check.ok) {
      // NOT a silent `continue`. This subtype declares loadable code and failed the handshake,
      // which is a deliberate authoring act that did not work — the one case that must be told.
      rejected.push({ typeName: def.name, repo: def.repo, sourceFile: def.source.file, errors: check.errors })
      continue
    }
    found.push({
      typeName: def.name,
      repo: def.repo,
      entry: check.meta.entry,
      export: check.meta.export,
      contractVersion: check.meta.contractVersion,
      packageRoot: packageRootOf(def.source.file),
      kinds: kindClosureOf(def, byName),
      ownedFields: ownedFieldsOf(def),
      handles: handlesOf(def),
      handlesTargeted: handlesTargetedOf(def),
      fires: firesOf(def),
      edits: editsOf(def),
      meta: metaMap(def),
      ...(check.meta.customTokenEntry ? { customTokenEntry: check.meta.customTokenEntry } : {}),
    })
  }
  // `subtypes` is already name-sorted; keep it stable regardless.
  found.sort((a, b) => a.typeName.localeCompare(b.typeName))
  rejected.sort((a, b) => a.typeName.localeCompare(b.typeName))
  return { projections: found, rejected }
}
