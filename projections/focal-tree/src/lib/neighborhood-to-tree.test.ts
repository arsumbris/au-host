import { describe, it, expect } from 'vitest'
import { neighborhoodToTree, mergeNeighborhood } from './neighborhood-to-tree'
import type { TreeNode } from './tree'
import type { RadialNodeData } from './neighborhood-to-tree'
import type { WireNeighborhoodResult } from '@arsumbris/au-host-sdk/engine-reads'

/** Minimal node/edge builders for the wire shape (only the fields the adapter reads). */
function n(path: string, depth: number, block_id?: string): any {
  return { path, block_id, depth, repo: undefined, file_kind: 'instance', bytes: null, body_bytes: null }
}
function e(from: string, to: string | null, kind = 'navigational'): any {
  return {
    from: { path: from },
    to: to === null ? null : { path: to },
    kind,
    surface: 'wikilink',
    span_start: 0,
    span_end: 0,
  }
}
function result(nodes: any[], edges: any[]): WireNeighborhoodResult {
  return { nodes, edges, dropped: [] } as unknown as WireNeighborhoodResult
}

describe('neighborhoodToTree', () => {
  it('returns null when the seed is absent from the nodes', () => {
    const { tree } = neighborhoodToTree(result([n('other', 0)], []), 'seed')
    expect(tree).toBeNull()
  })

  it('builds a root-only tree from a lone seed', () => {
    const { tree } = neighborhoodToTree(result([n('seed', 0)], []), 'seed')
    expect(tree).not.toBeNull()
    expect(tree!.id).toBe('seed')
    expect(tree!.data!.direction).toBe('root')
    expect(tree!.children).toHaveLength(0)
  })

  it('attaches depth-1 targets as children, tagged out/in by edge orientation', () => {
    const r = result(
      [n('seed', 0), n('target', 1), n('referrer', 1)],
      [e('seed', 'target'), e('referrer', 'seed')], // seed→target (out); referrer→seed (in)
    )
    const { tree } = neighborhoodToTree(r, 'seed')
    expect(tree!.children).toHaveLength(2)
    const target = tree!.children.find((c) => c.id === 'target')!
    const referrer = tree!.children.find((c) => c.id === 'referrer')!
    expect(target.data!.direction).toBe('out')
    expect(referrer.data!.direction).toBe('in')
  })

  it('carries the edge kind onto the child', () => {
    const r = result([n('seed', 0), n('t', 1)], [e('seed', 't', 'field')])
    const { tree } = neighborhoodToTree(r, 'seed')
    expect(tree!.children[0].data!.edgeKind).toBe('field')
  })

  it('nests depth-2 nodes under their depth-1 parent', () => {
    const r = result(
      [n('seed', 0), n('a', 1), n('b', 2)],
      [e('seed', 'a'), e('a', 'b')],
    )
    const { tree } = neighborhoodToTree(r, 'seed')
    const a = tree!.children.find((c) => c.id === 'a')!
    expect(a.children.map((c) => c.id)).toEqual(['b'])
  })

  it('attaches a multi-parent node once and marks it a duplicate', () => {
    const r = result(
      [n('seed', 0), n('a', 1), n('b', 1), n('shared', 2)],
      [e('seed', 'a'), e('seed', 'b'), e('a', 'shared'), e('b', 'shared')],
    )
    const { tree, duplicates } = neighborhoodToTree(r, 'seed')
    // 'shared' appears under exactly one of a/b, and is flagged.
    const count = tree!.children.flatMap((c) => c.children).filter((c) => c.id === 'shared').length
    expect(count).toBe(1)
    expect(duplicates.has('shared')).toBe(true)
  })

  it('ignores dangling edges (to = null)', () => {
    const r = result([n('seed', 0), n('a', 1)], [e('seed', 'a'), e('seed', null)])
    const { tree } = neighborhoodToTree(r, 'seed')
    expect(tree!.children.map((c) => c.id)).toEqual(['a'])
  })

  it('parents every non-root node exactly once (no id appears twice)', () => {
    const r = result(
      [n('seed', 0), n('a', 1), n('b', 1), n('shared', 2)],
      [e('seed', 'a'), e('seed', 'b'), e('a', 'shared'), e('b', 'shared')],
    )
    const { tree } = neighborhoodToTree(r, 'seed')
    expect(ids(tree!).length).toBe(new Set(ids(tree!)).size)
  })

  it('distinguishes a block node from its file by id', () => {
    const r = result(
      [n('seed', 0), n('doc.md', 1, 'blk')],
      [{ from: { path: 'seed' }, to: { path: 'doc.md', block_id: 'blk' }, kind: 'navigational', surface: 'wikilink', span_start: 0, span_end: 0 }],
    )
    const { tree } = neighborhoodToTree(r, 'seed')
    expect(tree!.children[0].id).toBe('doc.md^blk')
    expect(tree!.children[0].data!.blockId).toBe('blk')
  })
})

/** All ids in the tree, pre-order. */
function ids(t: TreeNode<RadialNodeData>): string[] {
  return [t.id, ...t.children.flatMap(ids)]
}

/** id → parent id, for every node but the root. */
function parents(t: TreeNode<RadialNodeData>): Map<string, string> {
  const m = new Map<string, string>()
  const walk = (n: TreeNode<RadialNodeData>): void => {
    for (const c of n.children) {
      m.set(c.id, n.id)
      walk(c)
    }
  }
  walk(t)
  return m
}

/** A stable structural fingerprint (ids + child order), for determinism assertions. */
function shape(t: TreeNode<RadialNodeData>): string {
  return `${t.id}(${t.children.map(shape).join(',')})`
}

describe('mergeNeighborhood (progressive expansion)', () => {
  // seed -- a -- x        (the loaded tree: depth 2 around `seed`)
  //      \- b
  const base = (): TreeNode<RadialNodeData> =>
    neighborhoodToTree(
      result([n('seed', 0), n('a', 1), n('b', 1), n('x', 2)], [e('seed', 'a'), e('seed', 'b'), e('a', 'x')]),
      'seed',
    ).tree!

  // A fetch centred on `x`: it re-sees `a` (its neighbor, already in the tree) and reveals `y`, `z`.
  const aroundX = (): WireNeighborhoodResult =>
    result([n('x', 0), n('a', 1), n('y', 1), n('z', 2)], [e('a', 'x'), e('x', 'y'), e('y', 'z')])

  it('attaches the newly revealed nodes at the frontier', () => {
    const { tree, added } = mergeNeighborhood(base(), aroundX(), 'x')
    expect(added.sort()).toEqual(['y', 'z'])
    const p = parents(tree)
    expect(p.get('y')).toBe('x')
    expect(p.get('z')).toBe('y')
  })

  it('never re-parents an existing node — `a` stays under `seed`, not under `x`', () => {
    const { tree } = mergeNeighborhood(base(), aroundX(), 'x')
    expect(parents(tree).get('a')).toBe('seed')
  })

  it('is monotonic: every pre-existing node survives with its parent unchanged', () => {
    const before = base()
    const beforeParents = parents(before)
    const { tree } = mergeNeighborhood(before, aroundX(), 'x')
    const afterParents = parents(tree)
    for (const id of ids(before)) expect(ids(tree)).toContain(id)
    for (const [id, parent] of beforeParents) expect(afterParents.get(id)).toBe(parent)
  })

  it('leaves the input tree untouched (returns a clone)', () => {
    const before = base()
    const snapshot = shape(before)
    const { tree } = mergeNeighborhood(before, aroundX(), 'x')
    expect(shape(before)).toBe(snapshot)
    expect(tree).not.toBe(before)
    expect(shape(tree)).not.toBe(snapshot)
  })

  it('is deterministic — the same merge twice yields the same shape', () => {
    const one = mergeNeighborhood(base(), aroundX(), 'x').tree
    const two = mergeNeighborhood(base(), aroundX(), 'x').tree
    expect(shape(one)).toBe(shape(two))
  })

  it('is idempotent — re-merging the same fetch adds nothing', () => {
    const once = mergeNeighborhood(base(), aroundX(), 'x').tree
    const twice = mergeNeighborhood(once, aroundX(), 'x')
    expect(twice.added).toEqual([])
    expect(shape(twice.tree)).toBe(shape(once))
  })

  it('does nothing when the centre is not in the tree', () => {
    const before = base()
    const { tree, added } = mergeNeighborhood(before, aroundX(), 'nowhere')
    expect(added).toEqual([])
    expect(shape(tree)).toBe(shape(before))
  })

  it('carries direction and edge kind onto a merged node', () => {
    const r = result([n('x', 0), n('y', 1)], [e('y', 'x', 'field')]) // y references x → `in`
    const { tree } = mergeNeighborhood(base(), r, 'x')
    const y = ids(tree).includes('y') ? parents(tree) : null
    expect(y!.get('y')).toBe('x')
    const node = (function find(t: TreeNode<RadialNodeData>): TreeNode<RadialNodeData> | null {
      if (t.id === 'y') return t
      for (const c of t.children) {
        const f = find(c)
        if (f) return f
      }
      return null
    })(tree)!
    expect(node.data!.direction).toBe('in')
    expect(node.data!.edgeKind).toBe('field')
  })
})
