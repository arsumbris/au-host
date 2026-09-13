// WHICH FIELDS OF A CONTAINER HOLD ITS CHILDREN — derived from the type graph, never declared.

// Every container names its child-bearing fields differently, on purpose, because the names ARE its
// dialect: sandwich has `left` / `center` / `right`, column has `items`, tabs has `tabs`, dock has
// four edges plus a `center`, and bento's positions sit several levels deep inside a DIFFERENT
// structural type. Nothing in the type system ties those together, and asking the engine to tie
// them was evaluated and REJECTED — a field-shape obligation cannot express bento at all, because
// "is a slot reachable behind another type" is a property of the type GRAPH, not of one record.


// So it is derived, and everything the derivation needs is already on the wire:

//   COLLECT at a field whose occupant is-a `mountable` (CONTENT — a projection or a sub-composition,
//     held as a child) OR is-a `container-node` (STRUCTURE — a `container-slot` position, or a
//     structural node). A `container-slot` subtype adds per-position RULES on top; it is NOT the
//     containment marker (a rule-less child is a bare `mountable*` and is still a position).
//   DESCEND through the `container-node` subtypes the shape names.
//   STOP at `projection` — a child's own config is its business, and recursing into it would
//     flatten a composition into one undifferentiated tree.
//
// CONTAINMENT IS VISIBLE IN THE TYPE: a field whose occupant is-a `mountable` or a
// `container-node` IS a containment field.
// A projection-bearing field that wants NO layout participation declares its OWN type — `bar`'s regions
// are `bar-item[]`, not `mountable`/`projection` — so it is excluded BY TYPE, with no marker and no
// deny-list. The type says what a thing is.


// NOTHING IS ASKED OF THE CONTAINER AUTHOR, which is the whole point: a third-party container gets
// enumerated without cooperating, exactly like it gets `slotFor` enforcement without cooperating.

// WHY HERE. au-host-sdk owns `container-node`, `container-slot` and the `ContainerSlot` interface,
// so it owns what their union MEANS in a type-def. It is also the framework-agnostic CONTRACT half
// of the substrate split, and the derivation is pure data → data: no DOM, no React, no engine
// client. The HOST performs the reads and hands the defs in; this module never talks to a daemon.



import type { WireShape } from '@arsumbris/au-engine-sdk/reads'

/** The structural root every slot and every structural node descends from. Disjoint from
 *  `projection`, which is what makes the union discriminable AND terminates this walk. */
const NODE_ROOT = 'container-node'
/** The slot base. A field naming a subtype of this carries per-position RULES on top of containment. */
const SLOT_ROOT = 'container-slot'
/** The CONTENT root (sealed `[projection, composition]`) — "a thing the host mounts by reference". A
 *  field whose occupant is-a `mountable` holds a child directly, with no rules. The other way to hold a
 *  child is via a `container-node` (a slot with rules, or a structural node). */
const MOUNTABLE_ROOT = 'mountable'

/**
 * Strip a `::repo` qualifier → the bare name. `tabs::tabs` → `tabs`.
 *
 * Type names are workspace-unique, so a qualifier is a SCOPE and never part of the name. Every
 * comparison here is bare, because the same type is authored qualified in one file and bare in
 * another: `bento.root` names `bento-slot` bare (own repo) while `tabs.tabs` names
 * `container-slot::au-host-sdk` qualified (a peer's). A name-equality check that did not strip
 * would see two different types and silently under-collect.
 *
 * THE SINGLE HOME for this three-line helper, and it is here rather than one layer up because
 * au-host-sdk owns the type vocabulary and `container-core` depends on IT, not the reverse.
 * `container-core` re-exports it for its consumers.
 */
export function bareTypeName(t: string | undefined): string {
  if (!t) return ''
  const i = t.indexOf('::')
  return i < 0 ? t : t.slice(0, i)
}

/**
 * A container-holding field, as the type graph describes it.
 *
 * This says nothing about any particular composition. It is the SHAPE: which field, whether it
 * holds one position or a list of them, and which types may sit at a position.
 */
export interface SlotField {
  /** The field name as authored: `left`, `items`, `tabs`, `children`. */
  name: string
  /** A LIST of positions (`items: <…>[]`) rather than one named position (`left: <…>`). */
  list: boolean
  /**
 * Bare slot type names admitted by this field. Preserve all alternatives in the list.
 * A consumer that needs one type must choose explicitly rather than discarding the other names
 * during schema traversal.
 */
  slotTypes: string[]
  /**
   * The STRUCTURAL node types this field's union also admits, BARE — the descent edges. Empty for
   * every container but bento, whose `root` and `bento-node.branch.children` both admit a
   * `bento-node.branch`. Each name is a key into `ContainerSchemas.nodes`.
   */
  nodeTypes: string[]
}

/** The child-bearing shape of ONE type: a container subtype, or a structural node reached by descent. */
export interface SlotSchema {
  /** Bare type name. */
  type: string
  /** Its child-bearing fields, in declared order. Empty for a type that holds no children. */
  fields: SlotField[]
}

/**
 * The derived answer for a whole workspace.
 *
 * The two maps are what keeps the walk finite. `bento-node.branch.children` admits a
 * `bento-node.branch`, so an INLINED traversal would not terminate; representing a structural node
 * ONCE, by name, turns the recursion into an ordinary graph edge a consumer follows on demand.
 */
export interface ContainerSchemas {
  /** Every container subtype that holds children, by BARE name. A container holding none is absent. */
  containers: ReadonlyMap<string, SlotSchema>
  /** Every structural `container-node` type reachable by descent, by BARE name. */
  nodes: ReadonlyMap<string, SlotSchema>
}

/**
 * The slice of a type-def this derivation reads.
 *
 * Deliberately NARROW rather than the wire's `WireTypeDef`: it states exactly what the walk
 * depends on, and `WireTypeDef[]` satisfies it structurally, so the host passes the `subtypes`
 * read straight in with no adapter. `shape_ast` keeps its wire type, because the AST is the one
 * thing that must never drift from the engine's.
 */
export interface SlotTypeView {
  name: string
  /** Declared direct parents, verbatim; a cross-repo parent reads `name::repo`. */
  parents: string[]
  fields: ReadonlyArray<{ name: string; shape_ast: WireShape | null }>
}

/** Every ancestor of `name`, plus `name` itself. Bare throughout. Cycle-safe (the engine already
 *  refuses a cyclic `type:` chain, but a defensive `seen` costs nothing and the walk is hot). */
function closureOf(name: string, byName: ReadonlyMap<string, SlotTypeView>): Set<string> {
  const out = new Set<string>()
  const walk = (n: string): void => {
    if (out.has(n)) return
    out.add(n)
    for (const p of byName.get(n)?.parents ?? []) walk(bareTypeName(p))
  }
  walk(bareTypeName(name))
  return out
}

/**
 * Collect possible occupant type names and whether the field holds a list of positions.
 * The caller decides which gathered names describe slots. Slot-only fields are allowed; a union
 * with a bare projection branch is not required.
 *
 * Do not descend into def-ref bounds: type<projection>* names a type definition, not an occupant.
 * Read both branch-suffixed unions (<projection& | sandwich-slot>) and compound references
 * (<projection | sandwich-slot>&), so equivalent field spellings produce the same traversal.
 */
function occupantNames(shape: WireShape | null): { list: boolean; names: string[] } {
  const none = { list: false, names: [] as string[] }
  if (!shape) return none
  switch (shape.kind) {
    // `[]` / `[+]`, and the `*@` enforced-pin wrapper. Both are wrappers, so unwrap and keep going;
    // only `list` changes the answer.
    case 'list':
      return { list: true, names: occupantNames(shape.inner).names }
    case 'pinned':
      return occupantNames(shape.inner)
    case 'union':
      return { list: false, names: shape.branches.flatMap((b) => occupantNames(b).names) }
    case 'compound-reference':
      // An intersection demands ONE value satisfying both, so it is not a choice of occupant.
      return shape.op === 'union' ? { list: false, names: shape.branches.map(bareTypeName) } : none
    // The three shapes that name a type a VALUE can be: an inline record, a reference, or either.
    case 'record':
    case 'reference':
    case 'inline-or-reference':
      return { list: false, names: [bareTypeName(shape.name)] }
    default:
      // A primitive, an enum, a bare `any`, or a def-reference. None names an occupant.
      return none
  }
}

/** The child-bearing fields of one type, in declared order. */
function fieldsOf(
  def: SlotTypeView,
  isSlot: (n: string) => boolean,
  isNode: (n: string) => boolean,
  isMountable: (n: string) => boolean,
): SlotField[] {
  const out: SlotField[] = []
  for (const f of def.fields) {
    const { list, names } = occupantNames(f.shape_ast)
    const slotTypes = names.filter(isSlot)
    // A CHILD-BEARING POSITION's occupant is-a `mountable` (content — a bare child) OR is-a
    // `container-node` (structure — a `container-slot` with rules, or a structural node). Both are
    // is-a checks, like `isSlot`/`isNode`. `container-slot` being a `container-node` recognizes a
    // rules-required field (`left?: my-slot`) that carries no bare `mountable*`. A field naming NEITHER
    // is not a position: `bar`'s `bar-item[]` regions and every `admits` def-ref reach here and leave.
    // (A slot's own `child: mountable*` is a mountable too, but a slot is only ever read as a
    // `slot-wrapper` occupant, never descended as a node, so a `child` field collected here is never
    // followed.)
    if (!names.some(isMountable) && !names.some(isNode)) continue
    out.push({
      name: f.name,
      list,
      slotTypes,
      // A slot IS a container-node, so subtract the slots or every field would claim to descend
      // into its own slot type.
      nodeTypes: names.filter((n) => isNode(n) && !isSlot(n)),
    })
  }
  return out
}

/**
 * Derive which fields hold children, for every container in the workspace.
 *
 * `containerDefs` are the `container-projection` subtypes; `nodeDefs` are the `container-node`
 * subtypes (the slots and the structural nodes). Both come from one `subtypes` read each, and the
 * two sets are disjoint by construction — that disjointness is what the walk's stop rule rests on.
 *
 * Pass the same defs twice with no ill effect: everything is keyed by bare name and deduped.
 */
export function deriveContainerSchemas(
  containerDefs: readonly SlotTypeView[],
  nodeDefs: readonly SlotTypeView[],
  // The `mountable` subtypes (`projection`, `composition`, `window`, and every projection subtype), so an
  // occupant's closure can reach `mountable`. Optional: a bare `mountable*` field — every real slot —
  // resolves is-a `mountable` WITHOUT it (a type's closure includes itself), and a slotted field
  // resolves via `isNode`; the family is only needed to recognize a slot typed to a NARROWER mountable
  // subtype (`window*` on `composition.windows`, `composition*`), which the host passes for.
  mountableDefs: readonly SlotTypeView[] = [],
  // The `window` subtype(s). A window is a `mountable` branch (NOT a container-projection) that holds one
  // child (`content: mountable*`), so its child-bearing field must be enumerated too, or reachability
  // would not descend `window.content` and a window's view subtree would be reaped. Enumerated into
  // `containers` (which `schemaFor` reads) alongside the container-projections — "holds a child" is the
  // question this derivation answers, and a window does, even though it is not a container-projection.
  windowDefs: readonly SlotTypeView[] = [],
): ContainerSchemas {
  const byName = new Map<string, SlotTypeView>()
  for (const d of [...containerDefs, ...nodeDefs, ...mountableDefs, ...windowDefs]) byName.set(bareTypeName(d.name), d)

  const isSlot = (n: string): boolean => closureOf(n, byName).has(SLOT_ROOT)
  const isNode = (n: string): boolean => closureOf(n, byName).has(NODE_ROOT)
  const isMountable = (n: string): boolean => closureOf(n, byName).has(MOUNTABLE_ROOT)

  const containers = new Map<string, SlotSchema>()
  const nodes = new Map<string, SlotSchema>()

  /**
   * Descend into a structural node type, and into every SUBTYPE of it.
   *
   * BY CLOSURE, not by exact name, because a union naming a node ADMITS its subtypes: a field
   * shaped `<projection& | bento-node&>` may hold any branch, so resolving only the named type
   * would under-collect the moment a container names a base.
   *
   * `nodes.has` is the termination guard: `bento-node.branch.children` admits a
   * `bento-node.branch`, so the second visit is the one that stops.
   */
  const descend = (typeName: string): void => {
    for (const [name, def] of byName) {
      if (name !== typeName && !closureOf(name, byName).has(typeName)) continue
      if (nodes.has(name)) continue
      const fields = fieldsOf(def, isSlot, isNode, isMountable)
      nodes.set(name, { type: name, fields })
      for (const f of fields) for (const n of f.nodeTypes) descend(n)
    }
  }

  // The container-projections plus the window branch: both hold children (a container lays out N,
  // a window holds its one `content`), so both are enumerated into `containers`.
  for (const def of [...containerDefs, ...windowDefs]) {
    const name = bareTypeName(def.name)
    const fields = fieldsOf(def, isSlot, isNode, isMountable)
    // A container-projection holding no children is not absent by accident. `bar` genuinely holds
    // none: it AGGREGATES a role via `readSubtypes(kind)`, so it registers no placement seam and
    // has no positions to govern. Omitting it keeps "has slots" and "has a seam" agreeing.
    if (fields.length === 0) continue
    containers.set(name, { type: name, fields })
    for (const f of fields) for (const n of f.nodeTypes) descend(n)
  }

  return { containers, nodes }
}
