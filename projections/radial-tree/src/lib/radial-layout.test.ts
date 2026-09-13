import { describe, it, expect } from 'vitest'
import { computeRadialLayout } from './radial-layout'
import type { TreeNode } from './tree'

/** Build a TreeNode; children default empty (a leaf). */
function node(id: string, children: TreeNode[] = []): TreeNode {
  return { id, label: id, children }
}

describe('computeRadialLayout', () => {
  it('returns an empty result for a null tree', () => {
    const result = computeRadialLayout(null)
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('places the root at the centre with weight', () => {
    const result = computeRadialLayout(node('index', [node('topic-a')]))
    const root = result.nodes.find((n) => n.kind === 'root')
    expect(root).toBeDefined()
    expect(root!.x).toBe(0)
    expect(root!.y).toBe(0)
    expect(root!.depth).toBe(0)
    expect(root!.id).toBe('index')
    expect(root!.weight).toBeGreaterThan(0)
  })

  it('positions a single child on the first shell', () => {
    const result = computeRadialLayout(node('index', [node('topic-a')]))
    const child = result.nodes.find((n) => n.id === 'topic-a')
    expect(child).toBeDefined()
    expect(child!.kind).toBe('leaf') // no children of its own
    expect(child!.depth).toBe(1)
    expect(child!.radius).toBeGreaterThan(0)
    expect(child!.parentId).toBe('index')
    expect(child!.weight).toBe(1)
  })

  it('marks a node with children as a branch', () => {
    const result = computeRadialLayout(node('index', [node('topic-a', [node('sub')])]))
    expect(result.nodes.find((n) => n.id === 'topic-a')!.kind).toBe('branch')
    expect(result.nodes.find((n) => n.id === 'sub')!.kind).toBe('leaf')
  })

  it('distributes multiple children evenly around the circle', () => {
    const result = computeRadialLayout(node('index', [node('a'), node('b'), node('c')]))
    const ring = result.nodes.filter((n) => n.depth === 1)
    expect(ring).toHaveLength(3)

    // all at the same radius
    expect(new Set(ring.map((m) => m.radius)).size).toBe(1)

    // equal-weight children are evenly spaced (120° apart)
    const angles = ring.map((m) => m.angle).sort((a, b) => a - b)
    expect(angles[1] - angles[0]).toBeCloseTo(angles[2] - angles[1], 1)
  })

  it('positions nested nodes at increasing shells', () => {
    const result = computeRadialLayout(node('index', [node('a', [node('a1', [node('a1x')])])]))
    const a = result.nodes.find((n) => n.id === 'a')!
    const a1 = result.nodes.find((n) => n.id === 'a1')!
    const a1x = result.nodes.find((n) => n.id === 'a1x')!
    expect(a.depth).toBe(1)
    expect(a1.depth).toBe(2)
    expect(a1x.depth).toBe(3)
    expect(a1.radius).toBeGreaterThan(a.radius)
    expect(a1x.radius).toBeGreaterThan(a1.radius)
  })

  it('marks duplicate ids from the config', () => {
    const tree = node('index', [
      node('topic-a', [node('shared')]),
      node('topic-b', [node('shared')]),
    ])
    const result = computeRadialLayout(tree, { duplicates: new Set(['shared']) })
    const shared = result.nodes.filter((n) => n.id === 'shared')
    expect(shared).toHaveLength(2)
    for (const n of shared) expect(n.isDuplicate).toBe(true)
  })

  it('generates one spine edge per parent→child', () => {
    const tree = node('index', [node('a', [node('a1'), node('a2')]), node('b')])
    const result = computeRadialLayout(tree)
    // index→a, index→b, a→a1, a→a2
    expect(result.edges).toHaveLength(4)
    const rootToA = result.edges.find((e) => e.sourceId === 'index' && e.targetId === 'a')
    expect(rootToA).toBeDefined()
    expect(rootToA!.sourceX).toBe(0)
    expect(rootToA!.sourceY).toBe(0)
  })

  it('scales node size by subtree weight', () => {
    const heavy = node('heavy', [node('l1'), node('l2'), node('l3'), node('l4'), node('l5')])
    const light = node('light', [node('l6')])
    const result = computeRadialLayout(node('index', [heavy, light]))
    const h = result.nodes.find((n) => n.id === 'heavy')!
    const l = result.nodes.find((n) => n.id === 'light')!
    expect(h.weight).toBe(5)
    expect(l.weight).toBe(1)
    expect(h.size).toBeGreaterThan(l.size)
  })

  it('gives a larger angular allocation to a heavier subtree', () => {
    const heavy = node('a', [node('l1'), node('l2'), node('l3'), node('l4'), node('l5')])
    const light = node('b', [node('l6')])
    const result = computeRadialLayout(node('index', [heavy, light]))
    const a = result.nodes.find((n) => n.id === 'a')!
    const b = result.nodes.find((n) => n.id === 'b')!
    expect(a.angle).not.toBeCloseTo(b.angle, 0)
  })

  it('confines the tree to a sector via startAngle / angleSpan (hemisphere)', () => {
    const result = computeRadialLayout(node('index', [node('a'), node('b'), node('c')]), {
      startAngle: -90,
      angleSpan: 180,
    })
    for (const n of result.nodes.filter((x) => x.depth === 1)) {
      expect(n.angle).toBeGreaterThanOrEqual(-90)
      expect(n.angle).toBeLessThanOrEqual(90)
    }
  })

  it('respects a custom shellWidth', () => {
    const result = computeRadialLayout(node('index', [node('a')]), { shellWidth: 200 })
    expect(result.nodes.find((n) => n.id === 'a')!.radius).toBe(200)
  })

  it('carries opaque data through onto the positioned node', () => {
    const tree: TreeNode<{ dir: string }> = {
      id: 'index',
      label: 'index',
      children: [{ id: 'a', label: 'a', children: [], data: { dir: 'out' } }],
    }
    const result = computeRadialLayout(tree)
    expect(result.nodes.find((n) => n.id === 'a')!.data).toEqual({ dir: 'out' })
  })

  it('exposes a weight >= 1 on every node', () => {
    const result = computeRadialLayout(node('index', [node('a', [node('a1')])]))
    for (const n of result.nodes) {
      expect(n.weight).toBeGreaterThanOrEqual(1)
    }
  })
})
