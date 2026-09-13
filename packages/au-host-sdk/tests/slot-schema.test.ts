// Slot traversal fixtures contain shape_ast values captured from a live daemon.
// The traversal must reach a bento position behind a structural node and exclude bento.detached,
// whose projection-bearing field describes a floated window rather than a content slot.

import { describe, expect, it } from 'vitest'

import { bareTypeName, deriveContainerSchemas, type SlotTypeView } from '../src/slot-schema.ts'

// --------------------------------------------------------------- the real corpus

/** `<projection::au-host-sdk& | X>` — the per-branch-suffix union every container carries. */
const union = (slot: string, ...nodes: string[]): SlotTypeView['fields'][number]['shape_ast'] => ({
  kind: 'union',
  branches: [
    { kind: 'inline-or-reference', name: 'projection::au-host-sdk' },
    { kind: 'record', name: slot },
    ...nodes.map((n) => ({ kind: 'inline-or-reference' as const, name: n })),
  ],
})

const list = (
  inner: SlotTypeView['fields'][number]['shape_ast'],
): SlotTypeView['fields'][number]['shape_ast'] => ({ kind: 'list', min: 0, inner: inner! })

const NODES: SlotTypeView[] = [
  { name: 'container-slot::au-host-sdk', parents: ['container-node'], fields: [
    { name: 'child', shape_ast: { kind: 'inline-or-reference', name: 'projection' } },
    { name: 'admits', shape_ast: { kind: 'list', min: 1, inner: { kind: 'def-reference', bound: { kind: 'single', name: 'projection' } } } },
    { name: 'fixed', shape_ast: { kind: 'primitive', name: 'Boolean' } },
    { name: 'label', shape_ast: { kind: 'primitive', name: 'String' } },
  ] },
  { name: 'sandwich-slot::sandwich', parents: ['container-slot::au-host-sdk'], fields: [
    { name: 'size', shape_ast: { kind: 'primitive', name: 'Number' } },
    { name: 'collapsed', shape_ast: { kind: 'primitive', name: 'Boolean' } },
  ] },
  { name: 'column-slot::column', parents: ['container-slot::au-host-sdk'], fields: [
    { name: 'size', shape_ast: { kind: 'primitive', name: 'Number' } },
    { name: 'collapsed', shape_ast: { kind: 'primitive', name: 'Boolean' } },
  ] },
  { name: 'bento-slot::bento', parents: ['container-slot::au-host-sdk'], fields: [] },
  { name: 'bento-node::bento', parents: ['container-node::au-host-sdk'], fields: [] },
  { name: 'bento-node.branch::bento', parents: ['bento-node'], fields: [
    { name: 'direction', shape_ast: { kind: 'enum', members: ['row', 'column'] } },
    { name: 'ratio', shape_ast: { kind: 'primitive', name: 'Number' } },
    { name: 'children', shape_ast: list(union('bento-slot', 'bento-node.branch')) },
  ] },
]

const CONTAINERS: SlotTypeView[] = [
  { name: 'sandwich::sandwich', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'left', shape_ast: union('sandwich-slot') },
    { name: 'center', shape_ast: union('sandwich-slot') },
    { name: 'right', shape_ast: union('sandwich-slot') },
  ] },
  { name: 'column::column', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'items', shape_ast: list(union('column-slot')) },
    { name: 'showItemHeaders', shape_ast: { kind: 'primitive', name: 'Boolean' } },
    { name: 'allowWrap', shape_ast: { kind: 'primitive', name: 'Boolean' } },
  ] },
  { name: 'tabs::tabs', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'tabs', shape_ast: list(union('container-slot::au-host-sdk')) },
    { name: 'activeTabIndex', shape_ast: { kind: 'primitive', name: 'Number' } },
  ] },
  { name: 'dock::dock', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'top', shape_ast: list(union('container-slot::au-host-sdk')) },
    { name: 'bottom', shape_ast: list(union('container-slot::au-host-sdk')) },
    { name: 'left', shape_ast: list(union('container-slot::au-host-sdk')) },
    { name: 'right', shape_ast: list(union('container-slot::au-host-sdk')) },
    { name: 'center', shape_ast: union('container-slot::au-host-sdk') },
  ] },
  { name: 'bento::bento', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'root', shape_ast: union('bento-slot', 'bento-node.branch') },
    { name: 'detached', shape_ast: list({ kind: 'inline-or-reference', name: 'projection::au-host-sdk' }) },
    { name: 'groupNewPanes', shape_ast: { kind: 'primitive', name: 'Boolean' } },
  ] },
  // `bar` holds NO layout positions: it lays out chrome it aggregates, with no placement seam. So its
  // three regions are `bar-item[]` — bar's OWN type, holding the widget in `view` — which is neither a
  // `mountable` nor a `container-node`, so the walk skips a bar BY TYPE.
  { name: 'bar::bar', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'orientation', shape_ast: { kind: 'enum', members: ['horizontal', 'vertical'] } },
    { name: 'role', shape_ast: { kind: 'def-reference', bound: { kind: 'single', name: 'projection::au-host-sdk' } } },
    { name: 'start', shape_ast: list({ kind: 'record', name: 'bar-item::bar' }) },
    { name: 'center', shape_ast: list({ kind: 'record', name: 'bar-item::bar' }) },
    { name: 'end', shape_ast: list({ kind: 'record', name: 'bar-item::bar' }) },
  ] },
  // `aup-workspace-sidebar` holds ONE child in a BARE `mountable*` position — no slot union, so no per-slot rules.
  // Its occupant is-a `mountable`, so it is a position; a slot type would be optional. Shape dumped
  // from the live daemon verbatim.
  { name: 'aup-workspace-sidebar::aup-workspace-sidebar', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'body', shape_ast: { kind: 'reference', name: 'mountable::au-host-sdk' } },
  ] },
]

// The `mountable` family, so `is-a mountable` resolves a `projection&` / subtype occupant by closure
// (a bare `mountable*` needs no family — a type's closure includes itself). The host reads these as
// `subtypes('mountable')`; the unit corpus states the edges it needs.
const MOUNTABLE: SlotTypeView[] = [
  { name: 'projection::au-host-sdk', parents: ['mountable::au-host-sdk'], fields: [] },
  { name: 'composition::au-host-sdk', parents: ['mountable::au-host-sdk'], fields: [] },
  { name: 'editor-pane::editor', parents: ['projection::au-host-sdk'], fields: [] },
]

const derived = deriveContainerSchemas(CONTAINERS, NODES, MOUNTABLE)
const fieldNames = (t: string): string[] => (derived.containers.get(t)?.fields ?? []).map((f) => f.name)

// --------------------------------------------------------------- the checks

describe('bareTypeName', () => {
  it('strips a `::repo` qualifier and tolerates absence', () => {
    expect(bareTypeName('tabs::tabs')).toBe('tabs')
    expect(bareTypeName('tabs')).toBe('tabs')
    expect(bareTypeName(undefined)).toBe('')
  })
})

describe('deriveContainerSchemas — the four dialects', () => {
  it('finds sandwich\'s three NAMED positions, and nothing else', () => {
    expect(fieldNames('sandwich')).toEqual(['left', 'center', 'right'])
    expect(derived.containers.get('sandwich')!.fields.every((f) => !f.list)).toBe(true)
  })

  it('finds column\'s LIST position and skips its two policy scalars', () => {
    expect(fieldNames('column')).toEqual(['items'])
    expect(derived.containers.get('column')!.fields[0]!.list).toBe(true)
  })

  it('reads a container that names the BASE slot directly', () => {
    expect(fieldNames('tabs')).toEqual(['tabs'])
    expect(derived.containers.get('tabs')!.fields[0]!.slotTypes).toEqual(['container-slot'])
  })

  it('finds all five dock positions, list and single alike', () => {
    expect(fieldNames('dock')).toEqual(['top', 'bottom', 'left', 'right', 'center'])
    expect(derived.containers.get('dock')!.fields.map((f) => f.list)).toEqual([true, true, true, true, false])
  })

  it('reports a BARE `mountable*` position — content is the marker, a slot is optional', () => {
    // A field whose occupant is-a `mountable` (aup-workspace-sidebar's `body`) IS a position — content, no rules.
    // A `container-slot` subtype is optional (rules only), NOT what recognizes containment; requiring
    // one orphaned this subtree. slotTypes / nodeTypes are empty because the position carries no rules
    // and descends no structural node, but the field IS a position.
    expect(fieldNames('aup-workspace-sidebar')).toEqual(['body'])
    const body = derived.containers.get('aup-workspace-sidebar')!.fields[0]!
    expect(body.slotTypes).toEqual([])
    expect(body.nodeTypes).toEqual([])
    expect(body.list).toBe(false)
  })
})

describe('deriveContainerSchemas — the nested case', () => {
  it('descends a structural node to reach a position bento never names directly', () => {
    // The derived traversal finds a slot nested inside a structural
    // node. `bento.root` names `bento-node.branch`, and only THAT type names `children`. `detached`
    // (a `projection&[]` field) is ALSO reported now — its occupant is-a `mountable`, so it is a
    // position under the current rule. It is empty in every composition.
    expect(fieldNames('bento')).toEqual(['root', 'detached'])
    expect(derived.containers.get('bento')!.fields[0]!.nodeTypes).toEqual(['bento-node.branch'])
    expect(derived.nodes.get('bento-node.branch')!.fields.map((f) => f.name)).toEqual(['children'])
  })

  it('terminates on a node type that admits itself', () => {
    // `bento-node.branch.children` admits a `bento-node.branch`, so an inlined walk would not halt.
    const children = derived.nodes.get('bento-node.branch')!.fields[0]!
    expect(children.nodeTypes).toEqual(['bento-node.branch'])
    expect(children.list).toBe(true)
  })

  it('does not report a slot type as a descent edge', () => {
    // A slot IS a container-node, so without the subtraction every field would claim to descend
    // into its own slot type and the walk would report slots as structural nodes.
    expect(derived.containers.get('sandwich')!.fields[0]!.nodeTypes).toEqual([])
    expect(derived.nodes.has('sandwich-slot')).toBe(false)
  })

  it('reaches a structural node by CLOSURE when a union names its base', () => {
    // Resolving only the exact base name would omit its structural subtypes.
    const viaBase: SlotTypeView[] = [
      { name: 'other::x', parents: ['container-projection::au-host-sdk'], fields: [
        { name: 'root', shape_ast: union('container-slot::au-host-sdk', 'bento-node::bento') },
      ] },
    ]
    const d = deriveContainerSchemas(viaBase, NODES)
    // `bento-node` itself holds nothing; its BRANCH is where the positions are.
    expect(d.nodes.has('bento-node')).toBe(true)
    expect(d.nodes.get('bento-node.branch')!.fields.map((f) => f.name)).toEqual(['children'])
  })
})

describe('deriveContainerSchemas — what it must NOT report', () => {
  it('omits a container that opts OUT with its OWN item type', () => {
    // `bar` holds `bar-item[]` — its own type, neither a `mountable` (content) nor a `container-node`
    // (structure) — so the walk skips it BY TYPE. A bar has no placement seam; its items are the bar
    // record's own inline config, not re-parentable pool members.
    expect(derived.containers.has('bar')).toBe(false)
  })

  it('never treats a slot\'s own `child` as a position, which would recurse into a projection', () => {
    // The STOP rule. A slot is a `container-node`, but a slot is only ever read as a `slot-wrapper`
    // occupant, never DESCENDED as a node, so its own `child` is never enumerated as a container's field.
    expect(derived.nodes.has('container-slot')).toBe(false)
  })

  it('a projection union with no slot IS a position (a rule-less multi-type child)', () => {
    // A <projection | editor-pane> field is a position: both alternatives are mountable occupants.
    // bar uses its own bar-item wrapper type and is excluded from this bare-child case.
    const picker: SlotTypeView[] = [
      { name: 'picker::x', parents: ['container-projection::au-host-sdk'], fields: [
        { name: 'shown', shape_ast: { kind: 'union', branches: [
          { kind: 'inline-or-reference', name: 'projection::au-host-sdk' },
          { kind: 'record', name: 'editor-pane::editor' },
        ] } },
      ] },
    ]
    expect(deriveContainerSchemas(picker, NODES, MOUNTABLE).containers.get('picker')!.fields.map((f) => f.name)).toEqual(['shown'])
  })

  it('ignores a field whose shape did not parse', () => {
    const broken: SlotTypeView[] = [
      { name: 'busted::x', parents: ['container-projection::au-host-sdk'], fields: [{ name: 'oops', shape_ast: null }] },
    ]
    expect(deriveContainerSchemas(broken, NODES).containers.has('busted')).toBe(false)
  })

  it('never reads a def-ref BOUND as an occupant', () => {
    // `admits: type<projection>*[+]` mentions a type, but as the CEILING a pointer must satisfy.
    // Reading a bound as an occupant would make every `admits` list read as a position — and would
    // do it on `container-slot` itself, so every slot would appear to contain slots.
    const bounded: SlotTypeView[] = [
      { name: 'boundy::x', parents: ['container-projection::au-host-sdk'], fields: [
        { name: 'allowed', shape_ast: { kind: 'list', min: 1, inner: { kind: 'def-reference', bound: { kind: 'single', name: 'container-slot::au-host-sdk' } } } },
      ] },
    ]
    expect(deriveContainerSchemas(bounded, NODES).containers.has('boundy')).toBe(false)
  })
})

describe('deriveContainerSchemas — a slot-ONLY position', () => {
  it('enumerates a field that names a slot with no bare-child branch', () => {
    // The spec collects at a field that MENTIONS a slot type; it does not require the union. A
    // container may legitimately declare "every position here carries rules", and refusing to
    // enumerate it while still enforcing its slots would serve only the shape we happen to write.
    const strict: SlotTypeView[] = [
      { name: 'frame::third-party', parents: ['container-projection::au-host-sdk'], fields: [
        { name: 'header', shape_ast: { kind: 'record', name: 'container-slot::au-host-sdk' } },
        { name: 'rows', shape_ast: { kind: 'list', min: 0, inner: { kind: 'record', name: 'container-slot::au-host-sdk' } } },
      ] },
    ]
    expect(deriveContainerSchemas(strict, NODES).containers.get('frame')!.fields).toEqual([
      { name: 'header', list: false, slotTypes: ['container-slot'], nodeTypes: [] },
      { name: 'rows', list: true, slotTypes: ['container-slot'], nodeTypes: [] },
    ])
  })
})

describe('deriveContainerSchemas — spellings a third party may use', () => {
  it('reads the whole-compound suffix form as well as the per-branch one', () => {
    // `<projection | container-slot>&` is the same statement the grammar spells differently. Serving
    // only the form our own containers happen to use would make the traversal first-party-only.
    const other: SlotTypeView[] = [
      { name: 'carousel::third-party', parents: ['container-projection::au-host-sdk'], fields: [
        { name: 'slides', shape_ast: { kind: 'list', min: 0, inner: { kind: 'compound-reference', mode: 'inline-or-ref', op: 'union', branches: ['projection::au-host-sdk', 'container-slot::au-host-sdk'] } } },
      ] },
    ]
    const d = deriveContainerSchemas(other, NODES)
    expect(d.containers.get('carousel')!.fields).toEqual([
      { name: 'slides', list: true, slotTypes: ['container-slot'], nodeTypes: [] },
    ])
  })

  it('does not read an INTERSECTION as a choice of occupant', () => {
    const bad: SlotTypeView[] = [
      { name: 'weird::x', parents: ['container-projection::au-host-sdk'], fields: [
        { name: 'both', shape_ast: { kind: 'compound-reference', mode: 'inline-or-ref', op: 'intersection', branches: ['projection::au-host-sdk', 'container-slot::au-host-sdk'] } },
      ] },
    ]
    expect(deriveContainerSchemas(bad, NODES).containers.has('weird')).toBe(false)
  })
})
