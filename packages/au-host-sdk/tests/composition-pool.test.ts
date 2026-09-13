// The composition pool — normalize, resolve, validate. Pure data → data.
//
// The type corpus mirrors the shapes the daemon reports (the same forms slot-schema.test.ts dumped
// from a live dogfood daemon), so the walk is driven by the REAL derivation, not a hand-tuned one.
// Two containers exercise both position shapes: bento (a single `root` that admits a structural
// `bento-node.branch`, whose `children` list holds the projections) and tabs (a direct list of
// child positions). file-tree / editor-pane are leaf projections — not containers — so they hold no
// children and terminate the walk.

import { describe, expect, it } from 'vitest'

import { deriveContainerSchemas, type SlotTypeView } from '../src/slot-schema.ts'
import {
  analyzePool,
  blockRef,
  detectGhostRefCollapse,
  isPlaceholderRecord,
  normalizeToPool,
  parentMap,
  parseBlockRef,
  parseRef,
  linkPool,
  crossFileTargets,
  restoreCrossFileRefs,
  reachableRecordIds,
  primaryContentId,
  resolveLogicalParent,
  resolvePoolToTree,
  serializePoolToComposition,
  validatePool,
  type CompositionPool,
  type LogicalParentInput,
  type PoolRecord,
} from '../src/composition-pool.ts'

// --------------------------------------------------------------- the corpus

const union = (slot: string, ...nodes: string[]): SlotTypeView['fields'][number]['shape_ast'] => ({
  kind: 'union',
  branches: [
    { kind: 'inline-or-reference', name: 'projection::au-host-sdk' },
    { kind: 'record', name: slot },
    ...nodes.map((n) => ({ kind: 'inline-or-reference' as const, name: n })),
  ],
})
const list = (inner: SlotTypeView['fields'][number]['shape_ast']): SlotTypeView['fields'][number]['shape_ast'] => ({
  kind: 'list',
  min: 0,
  inner: inner!,
})

const NODES: SlotTypeView[] = [
  { name: 'container-slot::au-host-sdk', parents: ['container-node'], fields: [
    { name: 'child', shape_ast: { kind: 'inline-or-reference', name: 'projection' } },
    { name: 'fixed', shape_ast: { kind: 'primitive', name: 'Boolean' } },
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
  { name: 'bento::bento', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'root', shape_ast: union('bento-slot', 'bento-node.branch') },
    { name: 'detached', shape_ast: list({ kind: 'inline-or-reference', name: 'projection::au-host-sdk' }) },
  ] },
  { name: 'tabs::tabs', parents: ['container-projection::au-host-sdk'], fields: [
    { name: 'tabs', shape_ast: list(union('container-slot::au-host-sdk')) },
    { name: 'activeTabIndex', shape_ast: { kind: 'primitive', name: 'Number' } },
  ] },
]
// `window` is a sealed `mountable` branch holding one `content` child — enumerated so a window's content
// is walked (reachability, resolve). A window is NOT a container-projection; it is passed as `windowDefs`.
const WINDOWS: SlotTypeView[] = [
  { name: 'window::au-host-sdk', parents: ['mountable'], fields: [
    { name: 'content', shape_ast: { kind: 'inline-or-reference', name: 'mountable' } },
    { name: 'primary', shape_ast: { kind: 'primitive', name: 'Boolean' } },
  ] },
]
const schemas = deriveContainerSchemas(CONTAINERS, NODES, [], WINDOWS)

/** Wrap a composition's inline/ref root in a primary `window`, the multi-window entry shape. */
const inWindow = (content: unknown): Record<string, unknown> => ({ '^': 'win', type: 'window', primary: true, content })

/** A deterministic id minter for the assertions. */
const minter = (): (() => string) => {
  let n = 0
  return () => `m${++n}`
}

/** An INLINE composition: a bento whose branch leaves are inline projection records. */
const inlineComposition = (): Record<string, unknown> => ({
  type: 'composition',
  windows: [
    inWindow({
      '^': 'grid',
      type: 'bento',
      root: {
        type: 'bento-node.branch',
        direction: 'row',
        ratio: 0.22,
        children: [
          { '^': 'tree', type: 'file-tree' },
          { '^': 'ed', type: 'editor-pane', file: 'notes/x.md' },
        ],
      },
    }),
  ],
})

// --------------------------------------------------------------- parseBlockRef

describe('parseBlockRef', () => {
  it('reads a local double-caret block-referent', () => {
    expect(parseBlockRef('[[^^grid]]')).toBe('grid')
    expect(parseBlockRef('[[^grid]]')).toBe('grid')
  })
  it('is NOT fooled by a role def-ref or a plain wikilink', () => {
    expect(parseBlockRef('[[aup-reader::aup-reader]]')).toBeUndefined()
    expect(parseBlockRef('[[some note]]')).toBeUndefined()
    expect(parseBlockRef('grid')).toBeUndefined()
    expect(parseBlockRef(42)).toBeUndefined()
  })
})

// --------------------------------------------------------------- 1.1 read adapter

describe('normalizeToPool — flatten an inline composition', () => {
  const pool = normalizeToPool(inlineComposition(), schemas, minter())

  it('roots at the top record and hoists every projection into a flat pool', () => {
    expect(pool.roots).toEqual(['win']) // the window is the root; its content is the grid
    expect(primaryContentId(pool)).toBe('grid')
    expect([...pool.records.keys()].sort()).toEqual(['ed', 'grid', 'tree', 'win'])
  })

  it('leaves the bento structural node INLINE but replaces its leaves with references', () => {
    const grid = pool.records.get('grid')! as any
    expect(grid.type).toBe('bento')
    expect(grid.root.type).toBe('bento-node.branch') // structural node stays inline
    expect(grid.root.children).toEqual(['[[^^tree]]', '[[^^ed]]']) // projections became refs
  })

  it('preserves a leaf record verbatim in the pool (its own fields + id)', () => {
    expect(pool.records.get('ed')).toEqual({ '^': 'ed', type: 'editor-pane', file: 'notes/x.md' })
  })

  it('mints an id for a record that has none', () => {
    const p = normalizeToPool(
      { type: 'composition', windows: [inWindow({ type: 'bento', root: { type: 'bento-node.branch', direction: 'row', ratio: 0.5, children: [{ type: 'file-tree' }] } })] },
      schemas,
      minter(),
    )
    expect(primaryContentId(p)).toBe('m1') // the bento (the window's content) got the first minted id
    expect(p.records.get('m1')).toBeTruthy()
    expect((p.records.get('m1') as any).root.children).toEqual(['[[^^m2]]']) // the leaf got the next
  })

  it('migrates a legacy BARE instance by wrapping it as the single root', () => {
    const p = normalizeToPool({ '^': 'solo', type: 'file-tree' }, schemas, minter())
    expect(p.roots).toEqual(['solo'])
    expect(p.records.get('solo')).toEqual({ '^': 'solo', type: 'file-tree' })
  })

  it('is idempotent on an already-flat pool composition', () => {
    const poolForm: Record<string, unknown> = {
      type: 'composition',
      windows: ['[[^^win]]'],
      projections: [
        { '^': 'win', type: 'window', primary: true, content: '[[^^grid]]' },
        { '^': 'grid', type: 'bento', root: { type: 'bento-node.branch', direction: 'row', ratio: 0.22, children: ['[[^^tree]]', '[[^^ed]]'] } },
        { '^': 'tree', type: 'file-tree' },
        { '^': 'ed', type: 'editor-pane', file: 'notes/x.md' },
      ],
    }
    const p = normalizeToPool(poolForm, schemas, minter())
    expect(p.roots).toEqual(['win'])
    expect(primaryContentId(p)).toBe('grid')
    expect([...p.records.keys()].sort()).toEqual(['ed', 'grid', 'tree', 'win'])
    expect((p.records.get('grid') as any).root.children).toEqual(['[[^^tree]]', '[[^^ed]]'])
  })

  it('flattens a MIXIN-typed container (type: [bento, intent-routing]) — the container branch is found in the list', () => {
    // A container with mixins claims a type list. Search every claim when finding its container kind
    // so the normalizer flattens its children and nested subtree.
    const mixinRoot: Record<string, unknown> = {
      type: 'composition',
      windows: [
        inWindow({
          '^': 'grid',
          type: ['bento', 'grouping-choice::au-host-sdk'],
          'group-into': '[[tabs::tabs]]',
          root: {
            type: 'bento-node.branch',
            direction: 'row',
            ratio: 0.5,
            children: [{ '^': 'tree', type: 'file-tree' }],
          },
        }),
      ],
    }
    const p = normalizeToPool(mixinRoot, schemas, minter())
    // The mixin root is flattened: its child is now a reference, not an embedded record.
    expect((p.records.get('grid') as any).root.children).toEqual(['[[^^tree]]'])
    // The child is hoisted to a flat sibling, and the mixin type + its metadata survive on the root.
    expect([...p.records.keys()].sort()).toEqual(['grid', 'tree', 'win'])
    expect((p.records.get('grid') as any).type).toEqual(['bento', 'grouping-choice::au-host-sdk'])
    expect((p.records.get('grid') as any)['group-into']).toBe('[[tabs::tabs]]')
  })
})

// --------------------------------------------------------------- 1.2 resolution walk

describe('resolvePoolToTree — re-inline the pool for mount', () => {
  it('resolves references back into the nested inline tree', () => {
    const pool = normalizeToPool(inlineComposition(), schemas, minter())
    const tree = resolvePoolToTree(pool, schemas) as any
    expect(tree.type).toBe('bento')
    expect(tree.root.children).toEqual([
      { '^': 'tree', type: 'file-tree' },
      { '^': 'ed', type: 'editor-pane', file: 'notes/x.md' },
    ])
  })

  it('an INLINE composition and its POOL form resolve to the SAME mount tree', () => {
    const fromInline = resolvePoolToTree(normalizeToPool(inlineComposition(), schemas, minter()), schemas)
    const poolForm: Record<string, unknown> = {
      type: 'composition',
      windows: ['[[^^win]]'],
      projections: [
        { '^': 'win', type: 'window', primary: true, content: '[[^^grid]]' },
        { '^': 'grid', type: 'bento', root: { type: 'bento-node.branch', direction: 'row', ratio: 0.22, children: ['[[^^tree]]', '[[^^ed]]'] } },
        { '^': 'tree', type: 'file-tree' },
        { '^': 'ed', type: 'editor-pane', file: 'notes/x.md' },
      ],
    }
    const fromPool = resolvePoolToTree(normalizeToPool(poolForm, schemas, minter()), schemas)
    expect(fromInline).toEqual(fromPool)
  })

  it('a dangling reference resolves to an empty position, not the raw ref string', () => {
    const pool: CompositionPool = {
      roots: ['grid'],
      records: new Map<string, PoolRecord>([
        ['grid', { '^': 'grid', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^gone]]'] }],
      ]),
      transient: new Set(),
    }
    const tree = resolvePoolToTree(pool, schemas) as any
    expect(tree.tabs).toEqual([undefined])
  })
})

// --------------------------------------------------------------- 1.3 validator

const poolOf = (root: string, records: Record<string, PoolRecord>): CompositionPool => ({
  roots: [root],
  records: new Map(Object.entries(records)),
  transient: new Set(),
})
const codes = (pool: CompositionPool): string[] => validatePool(pool, schemas).map((d) => d.code).sort()

describe('validatePool — the three graph invariants', () => {
  it('passes a clean pool', () => {
    expect(codes(normalizeToPool(inlineComposition(), schemas, minter()))).toEqual([])
  })

  it('flags a record referenced twice in one tree ONCE', () => {
    const pool = poolOf('root', {
      root: { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^dup]]', '[[^^dup]]'] },
      dup: { '^': 'dup', type: 'file-tree' },
    })
    const found = validatePool(pool, schemas)
    expect(found.filter((d) => d.code === 'composition-duplicate-in-tree')).toHaveLength(1)
    expect(found.find((d) => d.code === 'composition-duplicate-in-tree')!.ids).toEqual(['dup'])
  })

  it('flags a reference cycle and does not spin', () => {
    const pool = poolOf('a', {
      a: { '^': 'a', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^b]]'] },
      b: { '^': 'b', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^a]]'] },
    })
    expect(codes(pool)).toContain('composition-reference-cycle')
  })

  it('flags an orphan record no walk reaches', () => {
    const pool = poolOf('root', {
      root: { '^': 'root', type: 'file-tree' },
      lonely: { '^': 'lonely', type: 'editor-pane' },
    })
    const found = validatePool(pool, schemas)
    expect(found.map((d) => d.code)).toEqual(['composition-orphan'])
    expect(found[0]!.ids).toEqual(['lonely'])
  })

  it('flags a dangling reference to a missing record', () => {
    const pool = poolOf('root', {
      root: { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^gone]]'] },
    })
    expect(codes(pool)).toContain('composition-dangling-reference')
  })

  it('flags a root that names no record, as an error', () => {
    const pool = poolOf('nope', { other: { '^': 'other', type: 'file-tree' } })
    const found = validatePool(pool, schemas)
    expect(found.some((d) => d.code === 'composition-dangling-reference' && d.severity === 'error')).toBe(true)
  })
})

// -------------------------------------------- detectGhostRefCollapse — the pane-identity footgun net

describe('detectGhostRefCollapse — the ghost-ref collapse fingerprint', () => {
  // A grid referencing two panes A + B. reachable = {grid, A, B}.
  const twoPaneGrid = (): CompositionPool =>
    poolOf('grid', {
      grid: { '^': 'grid', type: 'bento', root: { type: 'bento-node.branch', direction: 'row', ratio: 0.5, children: ['[[^^A]]', '[[^^B]]'] } },
      A: { '^': 'A', type: 'editor-pane' },
      B: { '^': 'B', type: 'editor-pane' },
    })

  it('FIRES: a mint-without-pool-id re-serialize orphans A+B and references a ghost', () => {
    const prev = reachableRecordIds(twoPaneGrid(), schemas)
    // The footgun: the grid re-serializes referencing a FRESH id G (never a record); A + B remain in
    // the pool but unreferenced (the reaper is about to delete them). Ghost ref + mass orphan.
    const next = poolOf('grid', {
      grid: { '^': 'grid', type: 'bento', root: { type: 'bento-node.branch', direction: 'row', ratio: 0.5, children: ['[[^^G]]'] } },
      A: { '^': 'A', type: 'editor-pane' },
      B: { '^': 'B', type: 'editor-pane' },
    })
    const hit = detectGhostRefCollapse(prev, next, schemas)
    expect(hit).not.toBeNull()
    expect(hit!.reaped.sort()).toEqual(['A', 'B'])
    expect(hit!.ghosts).toEqual(['G'])
  })

  it('SILENT: a single legit close reaps one record and introduces no ghost', () => {
    const prev = reachableRecordIds(twoPaneGrid(), schemas)
    // User closed B: the grid drops its edge AND B's record. One reap, no dangling ref.
    const next = poolOf('grid', {
      grid: { '^': 'grid', type: 'bento', root: { type: 'bento-node.branch', direction: 'row', ratio: 0.5, children: ['[[^^A]]'] } },
      A: { '^': 'A', type: 'editor-pane' },
    })
    expect(detectGhostRefCollapse(prev, next, schemas)).toBeNull()
  })

  it('SILENT: a legit BULK close reaps two but introduces no ghost (co-occurrence required)', () => {
    const prev = reachableRecordIds(
      poolOf('grid', {
        grid: { '^': 'grid', type: 'bento', root: { type: 'bento-node.branch', direction: 'row', ratio: 0.5, children: ['[[^^A]]', '[[^^B]]', '[[^^C]]'] } },
        A: { '^': 'A', type: 'editor-pane' },
        B: { '^': 'B', type: 'editor-pane' },
        C: { '^': 'C', type: 'editor-pane' },
      }),
      schemas,
    )
    // User closed B + C: two records reaped, but the grid removed their edges too — NO dangling ref.
    const next = poolOf('grid', {
      grid: { '^': 'grid', type: 'bento', root: { type: 'bento-node.branch', direction: 'row', ratio: 0.5, children: ['[[^^A]]'] } },
      A: { '^': 'A', type: 'editor-pane' },
    })
    expect(detectGhostRefCollapse(prev, next, schemas)).toBeNull()
  })
})

// --------------------------------------------------- parentMap — pool-topology parentage (portal)

describe('parentMap — the child → parent map the portal routes by', () => {
  it('maps each child to its referring record; the root has no entry', () => {
    // root tabs → [child-a, group]; group tabs → [child-b].
    const pool = poolOf('root', {
      root: { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^a]]', '[[^^group]]'] },
      a: { '^': 'a', type: 'file-tree' },
      group: { '^': 'group', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^b]]'] },
      b: { '^': 'b', type: 'editor-pane' },
    })
    const parents = parentMap(pool, schemas)
    expect(parents.get('a')).toBe('root')
    expect(parents.get('group')).toBe('root')
    expect(parents.get('b')).toBe('group') // nested container parents its own child, not the root
    expect(parents.has('root')).toBe(false) // the composition root is top; it walks to null
  })

  it('resolves a duplicated child to its FIRST referrer (the canonical edge)', () => {
    const pool = poolOf('root', {
      root: { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^dup]]', '[[^^g]]'] },
      g: { '^': 'g', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^dup]]'] },
      dup: { '^': 'dup', type: 'file-tree' },
    })
    // root is iterated before g (insertion order), so root wins — matching the mount pool's canonical
    // edge (the first site mounts the real record, the rest degrade to placeholders).
    expect(parentMap(pool, schemas).get('dup')).toBe('root')
  })
})

// --------------------------------------------------- resolveLogicalParent — THE ROUTING-PARENTAGE BRIDGE
//
// The conformance backstop for the routing HALF of the portal bridge (its occupant-op half lives in
// container-core's placement-for-pane test). The whole reason this bridge exists: the portal mounts
// every pane FLAT (each a top-level host under the kernel root), so the mount-CALL parent would put
// every pane under the root and collapse intent/focus/selection nesting. These pin that parentage is
// derived from the POOL topology instead — including the two cases where the pool/mount parent DIVERGES
// from the flat mount (a nested container, and a duplicate placeholder that lives only in the mount pool).

describe('resolveLogicalParent — parentage from the pool, not the flat mount', () => {
  // root tabs → [a, group]; group tabs → [b]. Under the portal, a/group/b all mount as flat top-level
  // hosts (mount-call parent = the kernel root), so ONLY the pool topology carries the real tree.
  const nested = poolOf('root', {
    root: { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^a]]', '[[^^group]]'] },
    a: { '^': 'a', type: 'file-tree' },
    group: { '^': 'group', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^b]]'] },
    b: { '^': 'b', type: 'editor-pane' },
  })
  const KERNEL = 'pub:kernel-root' // the flat mount-call parent every portal pane is mounted under
  const ROOTPUB = 'pub:root' // the composition root's publisher (mainRoot)
  const pubs = new Map<string, string>([['group', 'pub:group'], ['a', 'pub:a'], ['b', 'pub:b']])

  const resolve = (nodeId: string, over: Partial<LogicalParentInput> = {}): string | null =>
    resolveLogicalParent({
      nodeId,
      mountParentId: KERNEL,
      hasPool: true,
      poolRoots: ['root'],
      poolParents: parentMap(nested, schemas),
      nodeIdToPublisher: pubs,
      rootPublisher: ROOTPUB,
      ...over,
    })

  it('a nested child resolves to its OWN container, not the flat mount parent or the root', () => {
    // b lives inside group; the pool says so even though it mounts flat under the kernel root.
    expect(resolve('b')).toBe('pub:group')
    expect(resolve('b')).not.toBe(KERNEL) // NOT the flat mount parent
    expect(resolve('b')).not.toBe(ROOTPUB) // NOT the composition root
  })

  it('a top-level child resolves to the composition root publisher', () => {
    expect(resolve('a')).toBe(ROOTPUB) // its pool parent IS the root record
    expect(resolve('group')).toBe(ROOTPUB)
  })

  it('the root record (an id-less mount) falls back to its mount-call parent (top)', () => {
    // The runtime mounts the root with an empty nodeId — parentage comes from the mount call (null).
    expect(resolve('', { nodeId: '', mountParentId: null })).toBeNull()
  })

  it('no pool wired (a detached-window runtime) falls back to the mount-call parent', () => {
    expect(resolve('b', { hasPool: false, mountParentId: 'pub:detached-root' })).toBe('pub:detached-root')
  })

  it('an orphan (a nodeId with no parent edge) resolves to the top', () => {
    expect(resolve('nobody')).toBeNull()
  })

  it('4b — a parent that is NOT YET MOUNTED resolves to null (a transient of the async flat-mount settle)', () => {
    // b's pool parent is group, but group's publisher has not registered yet. There is no publisher to
    // name at this instant, so the resolver yields the top; it re-resolves once group mounts (routing is
    // queried lazily, at dispatch). The durable cure for a mid-cascade query is mount ORDERING, not here.
    expect(resolve('b', { nodeIdToPublisher: new Map([['a', 'pub:a']]) })).toBeNull()
  })

  it('4c — a duplicate placeholder routes to its real container ONLY when the map is built from the MOUNT pool', () => {
    // dup is referenced twice: canonically under root, and a second time under group. analyzePool mints a
    // placeholder for the second edge, present ONLY in the mount pool, parented to group.
    const dupPool = poolOf('root', {
      root: { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^dup]]', '[[^^group]]'] },
      group: { '^': 'group', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^dup]]'] },
      dup: { '^': 'dup', type: 'file-tree' },
    })
    const { mountPool } = analyzePool(dupPool, schemas)
    const phId = [...mountPool.records.keys()].find(
      (id) => isPlaceholderRecord(mountPool.records.get(id)) && mountPool.records.get(id)!.collidedId === 'dup',
    )!
    expect(phId).toBeDefined()
    const args = { nodeId: phId, mountParentId: KERNEL, hasPool: true as const, poolRoots: ['root'], nodeIdToPublisher: pubs, rootPublisher: ROOTPUB }

    // parentMap over the MOUNT pool carries the placeholder's edge → it routes to its container.
    expect(resolveLogicalParent({ ...args, poolParents: parentMap(mountPool, schemas) })).toBe('pub:group')
    // The canonical pool has no placeholder, so it would route the placeholder to
    // the top — the divergence recomputePoolParents avoids by reading `mountPool ?? pool`.
    expect(resolveLogicalParent({ ...args, poolParents: parentMap(dupPool, schemas) })).toBeNull()
  })
})

// --------------------------------------------------- 1.3b analyzePool — the degrade mount pool

describe('analyzePool — the duplicate degrade mount pool', () => {
  it('returns the SAME pool object when the graph is clean', () => {
    const pool = normalizeToPool(inlineComposition(), schemas, minter())
    expect(analyzePool(pool, schemas).mountPool).toBe(pool)
  })

  it('redirects the SECOND edge of a duplicate to a placeholder, keeping the first real', () => {
    const pool = poolOf('root', {
      root: { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^dup]]', '[[^^dup]]'] },
      dup: { '^': 'dup', type: 'file-tree' },
    })
    const { mountPool } = analyzePool(pool, schemas)
    const tree = resolvePoolToTree(mountPool, schemas) as any
    // First tab is the real record; second is a diagnostic placeholder naming the collision.
    expect(tree.tabs[0]).toMatchObject({ type: 'file-tree', '^': 'dup' })
    expect(isPlaceholderRecord(tree.tabs[1])).toBe(true)
    expect(tree.tabs[1]).toMatchObject({ kind: 'duplicate', collidedId: 'dup' })
  })

  it('mints one placeholder PER extra edge (N refs → N-1 placeholders) but warns once', () => {
    const pool = poolOf('root', {
      root: { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^dup]]', '[[^^dup]]', '[[^^dup]]'] },
      dup: { '^': 'dup', type: 'file-tree' },
    })
    const { mountPool, diagnostics } = analyzePool(pool, schemas)
    expect(diagnostics.filter((d) => d.code === 'composition-duplicate-in-tree')).toHaveLength(1)
    const tree = resolvePoolToTree(mountPool, schemas) as any
    expect(tree.tabs.filter((t: unknown) => isPlaceholderRecord(t))).toHaveLength(2)
    // The authoritative pool is untouched — the degrade lives only in the mount pool.
    expect(pool.records.get('root')!.tabs).toEqual(['[[^^dup]]', '[[^^dup]]', '[[^^dup]]'])
  })

  it('breaks a cycle to an empty position on resolve', () => {
    const pool = poolOf('a', {
      a: { '^': 'a', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^b]]'] },
      b: { '^': 'b', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^a]]'] },
    })
    const tree = resolvePoolToTree(analyzePool(pool, schemas).mountPool, schemas) as any
    expect(tree.tabs[0].tabs).toEqual([undefined]) // b's back-edge to a breaks to empty, no re-mount
  })
})

// A guard on the shared helper the round-trip relies on.
describe('blockRef / parseBlockRef round-trip', () => {
  it('render then parse is identity', () => {
    for (const id of ['grid', 'tree', 'bento-1', 'x']) expect(parseBlockRef(blockRef(id))).toBe(id)
  })
})

// --------------------------------------------------------------- 6.2 cross-file linking

describe('parseRef (cross-file aware)', () => {
  it('parses local, cross-file block, and whole-file refs', () => {
    expect(parseRef('[[^^grid]]')).toEqual({ file: undefined, id: 'grid' })
    expect(parseRef('[[editor-layout^^grid]]')).toEqual({ file: 'editor-layout', id: 'grid' })
    expect(parseRef('[[editor-layout]]')).toEqual({ file: 'editor-layout', id: undefined })
    expect(parseRef('[[dir/sub.composition^^main]]')).toEqual({ file: 'dir/sub.composition', id: 'main' })
    expect(parseRef('[[layout::other-repo]]')).toEqual({ file: 'layout::other-repo', id: undefined })
  })
  it('drops |alias and a navigational #head from the file target', () => {
    expect(parseRef('[[layout#Heading]]')).toEqual({ file: 'layout', id: undefined })
    expect(parseRef('[[layout^^x|nice name]]')).toEqual({ file: 'layout', id: 'x' })
  })
  it('returns undefined for a non-ref or empty value', () => {
    expect(parseRef('not a ref')).toBeUndefined()
    expect(parseRef('[[^]]')).toBeUndefined()
    expect(parseRef(42)).toBeUndefined()
  })
  it('parseBlockRef stays LOCAL-ONLY: a cross-file ref is not a local block-ref (the latent bug)', () => {
    expect(parseBlockRef('[[^^grid]]')).toBe('grid')
    expect(parseBlockRef('[[editor-layout^^grid]]')).toBeUndefined() // The expected parent follows the linked mount topology.
    expect(parseBlockRef('[[editor-layout]]')).toBeUndefined()
  })
})

describe('linkPool (fold nested files into one mount pool)', () => {
  // A reusable nested sub-layout FILE: a tabs of two leaves.
  const nested = (): Record<string, unknown> => ({
    type: 'composition',
    windows: ['[[^^win]]'],
    projections: [
      { '^': 'win', type: 'window', primary: true, content: '[[^^grp]]' },
      { '^': 'grp', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^a]]', '[[^^b]]'] },
      { '^': 'a', type: 'file-tree' },
      { '^': 'b', type: 'editor-pane', file: 'nested/x.md' },
    ],
  })
  // An ENTRY that nests it at a `mountable*` child position: bento( file-tree | [[nested]] ).
  const entryNesting = (target = 'nested'): Record<string, unknown> => ({
    type: 'composition',
    windows: ['[[^^win]]'],
    projections: [
      { '^': 'win', type: 'window', primary: true, content: '[[^^grid]]' },
      {
        '^': 'grid',
        type: 'bento',
        root: { type: 'bento-node.branch', direction: 'row', ratio: 0.3, children: ['[[^^tree]]', `[[${target}]]`] },
      },
      { '^': 'tree', type: 'file-tree' },
    ],
  })

  const loaderFor = (files: Record<string, Record<string, unknown>>) => (target: string) =>
    files[target] ? { raw: files[target], path: `/vault/${target}.yaml` } : undefined

  it('crossFileTargets lists the files a pool references at child positions', () => {
    const entry = normalizeToPool(entryNesting(), schemas, minter())
    expect(crossFileTargets(entry, schemas)).toEqual(['nested'])
  })

  it('a no-nesting composition links to itself with an empty scope table', () => {
    const entry = normalizeToPool(inlineComposition(), schemas, minter())
    const linked = linkPool(entry, schemas, loaderFor({}))
    expect(linked.diagnostics).toEqual([])
    expect(linked.scopes.recordScope.size).toBe(0) // no nested records
    expect([...linked.scopes.scopes.keys()]).toEqual(['s0']) // only the entry scope
    expect(resolvePoolToTree(linked.pool, schemas)).toEqual(resolvePoolToTree(entry, schemas))
  })

  it('folds a nested composition and mounts its subtree at the child slot', () => {
    const entry = normalizeToPool(entryNesting(), schemas, minter())
    const linked = linkPool(entry, schemas, loaderFor({ nested: nested() }))
    expect(linked.diagnostics).toEqual([])
    // the nested records are folded under qualified ids in scope s1
    expect(linked.scopes.recordScope.get('__s1-grp')).toBe('s1')
    expect(linked.scopes.scopes.get('s1')!.rootId).toBe('__s1-grp')
    expect(linked.scopes.scopes.get('s1')!.parentScopeId).toBe('s0')
    // the entry's cross-file ref was rewritten to a LOCAL qualified ref (entry pool untouched)
    expect(entry.records.get('grid')!.root).toMatchObject({ children: ['[[^^tree]]', '[[nested]]'] })
    // resolving the linked pool inlines the nested tabs subtree into the bento's second child
    const tree = resolvePoolToTree(linked.pool, schemas) as any
    const [treePane, nestedGrp] = tree.root.children
    expect(treePane.type).toBe('file-tree')
    expect(nestedGrp.type).toBe('tabs')
    expect(nestedGrp.tabs.map((t: any) => t.type)).toEqual(['file-tree', 'editor-pane'])
  })

  it('carries the nested composition metadata onto its scope (for 6.4)', () => {
    const withMeta = { ...nested(), type: ['composition', 'intent-routing'], 'initial-focus': '[[file-tree::file-tree]]' }
    const entry = normalizeToPool(entryNesting(), schemas, minter())
    const linked = linkPool(entry, schemas, loaderFor({ nested: withMeta }))
    expect(linked.scopes.scopes.get('s1')!.meta).toMatchObject({ 'initial-focus': '[[file-tree::file-tree]]' })
  })

  it('the same file nested twice folds into two independent scopes (two mounts, not a duplicate)', () => {
    const entry = normalizeToPool(
      {
        type: 'composition',
        windows: ['[[^^win]]'],
        projections: [
          { '^': 'win', type: 'window', primary: true, content: '[[^^grid]]' },
          { '^': 'grid', type: 'tabs', activeTabIndex: 0, tabs: ['[[nested]]', '[[nested]]'] },
        ],
      },
      schemas,
      minter(),
    )
    const linked = linkPool(entry, schemas, loaderFor({ nested: nested() }))
    expect(linked.diagnostics).toEqual([]) // NOT a duplicate — two distinct scopes
    expect(linked.scopes.scopes.get('s1')!.rootId).toBe('__s1-grp')
    expect(linked.scopes.scopes.get('s2')!.rootId).toBe('__s2-grp')
    // analyzePool over the linked pool sees no duplicate: the two mounts have distinct ids
    expect(analyzePool(linked.pool, schemas).diagnostics.filter((d) => d.code === 'composition-duplicate-in-tree')).toEqual([])
  })

  it('warns and empties the position for a missing nested file', () => {
    const entry = normalizeToPool(entryNesting('gone'), schemas, minter())
    const linked = linkPool(entry, schemas, loaderFor({}))
    expect(linked.diagnostics.map((d) => d.code)).toContain('composition-cross-file-missing')
    const tree = resolvePoolToTree(linked.pool, schemas) as any
    expect(tree.root.children).toEqual([expect.objectContaining({ type: 'file-tree' }), undefined])
  })

  it('breaks a cross-file cycle (A nests B nests A) and warns', () => {
    // A references B; B references A back (by path). The back-edge must not fold forever.
    const a = (): Record<string, unknown> => ({
      type: 'composition',
      windows: ['[[^^win]]'],
      projections: [
        { '^': 'win', type: 'window', primary: true, content: '[[^^ra]]' },
        { '^': 'ra', type: 'tabs', activeTabIndex: 0, tabs: ['[[b]]'] },
      ],
    })
    const b = (): Record<string, unknown> => ({
      type: 'composition',
      windows: ['[[^^win]]'],
      projections: [
        { '^': 'win', type: 'window', primary: true, content: '[[^^rb]]' },
        { '^': 'rb', type: 'tabs', activeTabIndex: 0, tabs: ['[[a]]'] },
      ],
    })
    const entry = normalizeToPool(a(), schemas, minter())
    const linked = linkPool(entry, schemas, loaderFor({ a: a(), b: b() }), minter(), '/vault/a.yaml')
    expect(linked.diagnostics.map((d) => d.code)).toContain('composition-cross-file-cycle')
    // it terminates (no throw / no infinite loop) and resolves
    expect(() => resolvePoolToTree(linked.pool, schemas)).not.toThrow()
  })

  it('restoreCrossFileRefs reverses the qualified ref on save, so the entry file keeps [[nested]]', () => {
    const entry = normalizeToPool(entryNesting(), schemas, minter())
    const linked = linkPool(entry, schemas, loaderFor({ nested: nested() }))
    // The entry bento, as a container would RE-SERIALIZE it after mounting: the nested child appears by
    // its qualified id. Restoring must turn it back into the original cross-file ref before it persists.
    const reserialized = {
      '^': 'grid',
      type: 'bento',
      root: { type: 'bento-node.branch', direction: 'row', ratio: 0.3, children: ['[[^^tree]]', `[[^^${linked.scopes.scopes.get('s1')!.rootId}]]`] },
    }
    const restored = restoreCrossFileRefs(reserialized, schemas, linked.scopes.originRef) as any
    expect(restored.root.children).toEqual(['[[^^tree]]', '[[nested]]']) // qualified ref → original cross-file ref
  })

  it('restoreCrossFileRefs is a no-op with no nesting', () => {
    const rec = { '^': 'grid', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^a]]'] }
    expect(restoreCrossFileRefs(rec, schemas, new Map())).toBe(rec)
  })

  it('a [[file^^id]] names one specific record in another file pool', () => {
    const entry = normalizeToPool(entryNesting('nested^^b'), schemas, minter())
    const linked = linkPool(entry, schemas, loaderFor({ nested: nested() }))
    expect(linked.diagnostics).toEqual([])
    const tree = resolvePoolToTree(linked.pool, schemas) as any
    expect(tree.root.children[1]).toMatchObject({ type: 'editor-pane', file: 'nested/x.md' })
  })
})

// ------------------------------------------------- 1.2c serialize drops transient records

describe('serializePoolToComposition drops transient records and their inbound refs', () => {
  it('drops a transient record and strips the parent ref to it, keeping non-transient siblings', () => {
    const pool: CompositionPool = {
      roots: ['root'],
      records: new Map<string, PoolRecord>([
        ['root', { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^keep]]', '[[^^prev]]'] }],
        ['keep', { '^': 'keep', type: 'bento' }],
        ['prev', { '^': 'prev', type: 'bento' }], // the preview tab, marked transient below
      ]),
      transient: new Set(['prev']),
    }
    const doc = serializePoolToComposition(pool, schemas)
    const projections = doc.projections as Array<Record<string, unknown>>
    // the transient record itself never reaches disk
    expect(projections.map((r) => r['^'])).toEqual(['root', 'keep'])
    // and the inbound ref is stripped, so no dangling `[[^^prev]]` is written
    expect(projections.find((r) => r['^'] === 'root')!.tabs).toEqual(['[[^^keep]]'])
  })

  it('is the identity (same record objects) when nothing is transient', () => {
    const root = { '^': 'root', type: 'tabs', activeTabIndex: 0, tabs: ['[[^^keep]]'] }
    const pool: CompositionPool = {
      roots: ['root'],
      records: new Map<string, PoolRecord>([
        ['root', root],
        ['keep', { '^': 'keep', type: 'bento' }],
      ]),
      transient: new Set(),
    }
    const doc = serializePoolToComposition(pool, schemas)
    // fast path: the record is pushed unchanged, not cloned (byte-identical serialize)
    expect((doc.projections as unknown[])[0]).toBe(root)
  })

  it('W1.2: with EMPTY schemas the drop is ATOMIC — a FULL serialize, never a dropped record with a kept ref', () => {
    const pool: CompositionPool = {
      roots: ['root'],
      records: new Map<string, PoolRecord>([
        ['root', { '^': 'root', type: 'tabs', tabs: ['[[^^keep]]', '[[^^prev]]'] }],
        ['keep', { '^': 'keep', type: 'bento' }],
        ['prev', { '^': 'prev', type: 'bento' }], // transient, but schemas cannot strip its inbound ref
      ]),
      transient: new Set(['prev']),
    }
    // The not-loaded fallback: no container schema graph, so `stripTransientRefs` could not remove the
    // `[[^^prev]]` ref. The drop must therefore NOT happen either — a full, pre-transient serialize.
    const emptySchemas = { containers: new Map(), nodes: new Map() } as typeof schemas
    const doc = serializePoolToComposition(pool, emptySchemas)
    const projections = doc.projections as Array<Record<string, unknown>>
    // ATOMIC: the transient record is KEPT (not dropped) because its ref could not be stripped...
    expect(projections.map((r) => r['^'])).toEqual(['root', 'keep', 'prev'])
    // ...and the ref stays intact — so there is never a dropped record with a dangling `[[^^prev]]`.
    expect(projections.find((r) => r['^'] === 'root')!.tabs).toEqual(['[[^^keep]]', '[[^^prev]]'])
  })
})
