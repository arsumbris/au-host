import { describe, it, expect } from 'vitest'
import { neighborhoodToTree } from './neighborhood-to-tree'
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
