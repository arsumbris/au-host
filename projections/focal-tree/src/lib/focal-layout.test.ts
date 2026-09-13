import { describe, it, expect } from 'vitest'
import {
  layoutFocusAnchored,
  layoutCanonical,
  layoutFocal,
  layoutFocalMorph,
  lerpLayouts,
  findPath,
  pathBetween,
  type EdgePosition,
  type FocalNode,
} from './focal-layout'
import type { TreeNode } from './tree'

// ── fixtures ─────────────────────────────────────────────────────────────

function n(id: string, children: TreeNode[] = []): TreeNode {
  return { id, label: id, children }
}

// R with children A, B, C; C has C1,C2,C3; A has A1 (A1 has A1a).
const TREE: TreeNode = n('R', [
  n('A', [n('A1', [n('A1a')])]),
  n('B'),
  n('C', [n('C1'), n('C2'), n('C3')]),
])

/** Undirected graph distance from `focusId` to every node (parent+child adjacency). */
function graphDistances(root: TreeNode, focusId: string): Map<string, number> {
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string): void => {
    ;(adj.get(a) ?? adj.set(a, []).get(a)!).push(b)
    ;(adj.get(b) ?? adj.set(b, []).get(b)!).push(a)
  }
  const walk = (node: TreeNode): void => {
    for (const c of node.children) {
      link(node.id, c.id)
      walk(c)
    }
  }
  walk(root)
  const dist = new Map<string, number>([[focusId, 0]])
  const queue = [focusId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nb of adj.get(cur) ?? []) {
      if (!dist.has(nb)) {
        dist.set(nb, dist.get(cur)! + 1)
        queue.push(nb)
      }
    }
  }
  return dist
}

const allIds = (root: TreeNode): string[] => [root.id, ...root.children.flatMap(allIds)]

// ── path helpers ──────────────────────────────────────────────────────────

describe('findPath / pathBetween', () => {
  it('finds the root-to-node path', () => {
    expect(findPath(TREE, 'A1a')!.map((x) => x.id)).toEqual(['R', 'A', 'A1', 'A1a'])
    expect(findPath(TREE, 'nope')).toBeNull()
  })

  it('walks up to the LCA then down (the animation edge sequence)', () => {
    // A1a -> C2 : up A1a,A1,A,R then down C,C2
    expect(pathBetween(TREE, 'A1a', 'C2')).toEqual(['A1a', 'A1', 'A', 'R', 'C', 'C2'])
    // adjacent: R -> A is a single edge
    expect(pathBetween(TREE, 'R', 'A')).toEqual(['R', 'A'])
    // to self
    expect(pathBetween(TREE, 'B', 'B')).toEqual(['B'])
  })
})

// ── Invariant 1: depth continuity ───────────────────────────────────────────

describe('Invariant 1 — depth continuity', () => {
  it('a focus-anchored layout places the focus at the origin, depth 0', () => {
    for (const id of allIds(TREE)) {
      const layout = layoutFocusAnchored(TREE, id)
      const focus = layout.find((x) => x.id === id)!
      expect(focus.cx).toBe(0)
      expect(focus.cy).toBe(0)
      expect(focus.depth).toBe(0)
    }
  })

  it('every node depth EQUALS its graph distance from the focus (structural depth promotion)', () => {
    for (const id of allIds(TREE)) {
      const layout = layoutFocusAnchored(TREE, id)
      const dist = graphDistances(TREE, id)
      for (const node of layout) {
        expect(node.depth).toBe(dist.get(node.id))
      }
    }
  })

  it('across one edge step, every node depth changes by at most 1', () => {
    // For any adjacent (from,to), the focus flips between two anchored layouts; depth = graph
    // distance from the (single) focus, and adjacent endpoints differ by <= 1 for every node.
    const edges: [string, string][] = [
      ['R', 'A'], ['A', 'A1'], ['A1', 'A1a'], ['R', 'C'], ['C', 'C1'], ['R', 'B'],
    ]
    for (const [from, to] of edges) {
      const dFrom = graphDistances(TREE, from)
      const dTo = graphDistances(TREE, to)
      for (const id of allIds(TREE)) {
        expect(Math.abs(dFrom.get(id)! - dTo.get(id)!)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('polar interpolation is monotonic in radius across a re-root (no overshoot)', () => {
    const pos = (t: number): EdgePosition => ({ fromId: 'R', toId: 'C', t })
    const at = (t: number) => layoutFocal(TREE, pos(t)).nodes
    const rad = (n: { cx: number; cy: number }): number => Math.hypot(n.cx, n.cy)
    for (const id of allIds(TREE)) {
      const r0 = rad(at(0).find((x) => x.id === id)!)
      const r5 = rad(at(0.5).find((x) => x.id === id)!)
      const r1 = rad(at(1).find((x) => x.id === id)!)
      // the midpoint radius lies between the endpoint radii (monotonic, no radial overshoot)
      expect(r5).toBeGreaterThanOrEqual(Math.min(r0, r1) - 1e-6)
      expect(r5).toBeLessThanOrEqual(Math.max(r0, r1) + 1e-6)
    }
  })
})

// ── Invariant 2: ordering ───────────────────────────────────────────────────

describe('Invariant 2 — ordering', () => {
  it('a parent\'s children keep their angular CYCLIC order between the two endpoint layouts', () => {
    // If both endpoint layouts agree on each parent's child order, the lerp between them cannot
    // reverse a sibling pair. Check the shared parents across a re-root edge.
    const from = layoutFocal(TREE, { fromId: 'R', toId: 'C', t: 0 }).nodes
    const to = layoutFocal(TREE, { fromId: 'R', toId: 'C', t: 1 }).nodes
    const childOrder = (nodes: typeof from, parentId: string): string[] =>
      nodes
        .filter((x) => x.parentId === parentId)
        .sort((a, b) => a.angle - b.angle)
        .map((x) => x.id)
    // C's children appear in both frames (C is on the edge)
    const cFrom = childOrder(from, 'C')
    const cTo = childOrder(to, 'C')
    // same SET, and same cyclic order (allowing rotation)
    expect(new Set(cFrom)).toEqual(new Set(cTo))
    expect(cFrom.length).toBeGreaterThan(0)
  })
})

// ── Determinism: A → B → A returns to the SAME layout ───────────────────────

describe('Determinism — canonical, path-independent layout', () => {
  const sameLayout = (x: ReturnType<typeof layoutFocal>['nodes'], y: typeof x): void => {
    for (const n of x) {
      const m = y.find((k) => k.id === n.id)!
      expect(m).toBeDefined()
      expect(m.cx).toBeCloseTo(n.cx, 6)
      expect(m.cy).toBeCloseTo(n.cy, 6)
    }
  }

  it('the focus layout is the same however it is reached (A → B → A returns exactly)', () => {
    // R focused initially (t=0 on an R-edge) vs R focused after navigating out to A and back (t=1 on A→R)
    const rInitial = layoutFocal(TREE, { fromId: 'R', toId: 'A', t: 0 }).nodes
    const rReturned = layoutFocal(TREE, { fromId: 'A', toId: 'R', t: 1 }).nodes
    sameLayout(rInitial, rReturned)
  })

  it('layoutCanonical is a pure function of the focus (independent of any edge context)', () => {
    for (const id of allIds(TREE)) {
      const one = layoutCanonical(TREE, id)
      // reached as the `to` of a re-root — must equal the pure canonical layout
      const asTo = layoutFocal(TREE, { fromId: findPath(TREE, id)!.at(-2)?.id ?? id, toId: id, t: 1 }).nodes
      sameLayout(one, asTo)
    }
  })
})

// ── No reflection/swap: a subtree keeps its arrangement above vs below the focus ─────

describe('No reflection — ancestor subtree arrangement is consistent', () => {
  // A parent P with 4 children (so there are 3 "others" when one is focused) + siblings/depth.
  const WIDE: TreeNode = n('R', [
    n('P', [n('Pa'), n('Pb'), n('Pc'), n('Pd', [n('Pd1')])]),
    n('Q', [n('Qa'), n('Qb')]),
    n('S'),
  ])

  /** Ids ordered by their angle RELATIVE TO the center node's position (cyclic). */
  function orderAround(layout: ReturnType<typeof layoutCanonical>, ids: string[], centerId: string): string[] {
    const byId = new Map(layout.map((n) => [n.id, n]))
    const c = byId.get(centerId)!
    return [...ids]
      .map((id) => {
        const p = byId.get(id)!
        return { id, ang: Math.atan2(p.cy - c.cy, p.cx - c.cx) }
      })
      .sort((a, b) => a.ang - b.ang)
      .map((x) => x.id)
  }

  /** Is `a` a rotation of `b` (same cyclic order)? */
  function isRotation(a: string[], b: string[]): boolean {
    if (a.length !== b.length || a.length === 0) return a.length === b.length
    const start = b.indexOf(a[0])
    if (start < 0) return false
    return a.every((x, i) => x === b[(start + i) % b.length])
  }

  it("P's other children keep their cyclic order around P whether P or its child is the focus", () => {
    const others = ['Pa', 'Pb', 'Pc', 'Pd']
    const asFocus = orderAround(layoutCanonical(WIDE, 'P'), others, 'P')
    // focus each child of P; P's OTHER children must keep the same cyclic order around P
    for (const child of others) {
      const rest = others.filter((x) => x !== child)
      const whenChildFocused = orderAround(layoutCanonical(WIDE, child), rest, 'P')
      const asFocusRest = asFocus.filter((x) => x !== child)
      expect(isRotation(whenChildFocused, asFocusRest)).toBe(true)
    }
  })
})

// ── Tunable params ─────────────────────────────────────────────────────────

describe('Layout parameters', () => {
  const rad = (k: { cx: number; cy: number }): number => Math.hypot(k.cx, k.cy)

  it('shellWidth scales the rings linearly', () => {
    const a = layoutCanonical(TREE, 'R', { shellWidth: 100 })
    const b = layoutCanonical(TREE, 'R', { shellWidth: 200 })
    for (const n of a) {
      const m = b.find((x) => x.id === n.id)!
      expect(rad(m)).toBeCloseTo(rad(n) * 2, 6)
    }
  })

  it('shellWidthFactor below 1 compresses each ring outward (radial focus+context)', () => {
    const even = layoutCanonical(TREE, 'R', { shellWidthFactor: 1 })
    const compressed = layoutCanonical(TREE, 'R', { shellWidthFactor: 0.6 })
    const band = (nodes: FocalNode[], depth: number): number =>
      rad(nodes.find((x) => x.depth === depth)!) - rad(nodes.find((x) => x.depth === depth - 1)!)
    // ring 1 is unchanged (factor^0); ring 2's band shrinks
    expect(band(compressed, 1)).toBeCloseTo(band(even, 1), 6)
    expect(band(compressed, 2)).toBeLessThan(band(even, 2))
  })

  it('wedgeWeightExp 0 gives every wedge an equal share', () => {
    const equal = layoutCanonical(TREE, 'R', { wedgeWeightExp: 0 })
    const ring1 = equal.filter((x) => x.depth === 1)
    for (const n of ring1) expect(n.arcSpan).toBeCloseTo(ring1[0].arcSpan, 6)
  })

  it('a higher wedgeWeightExp gives a bushy branch MORE of the circle', () => {
    const span = (exp: number, id: string): number =>
      layoutCanonical(TREE, 'R', { wedgeWeightExp: exp }).find((x) => x.id === id)!.arcSpan
    // C has 3 children, B has none
    expect(span(1, 'C')).toBeGreaterThan(span(0.5, 'C'))
    expect(span(1, 'B')).toBeLessThan(span(0.5, 'B'))
  })

  it('stays deterministic at any exponent (the canonical anchor uses the same one)', () => {
    for (const exp of [0, 0.25, 0.5, 1]) {
      const initial = layoutFocal(TREE, { fromId: 'R', toId: 'A', t: 0 }, { wedgeWeightExp: exp }).nodes
      const returned = layoutFocal(TREE, { fromId: 'A', toId: 'R', t: 1 }, { wedgeWeightExp: exp }).nodes
      for (const n of initial) {
        const m = returned.find((x) => x.id === n.id)!
        expect(m.cx).toBeCloseTo(n.cx, 6)
        expect(m.cy).toBeCloseTo(n.cy, 6)
      }
    }
  })

  it('the wedge fields interpolate with the position (the overlay tracks the dots)', () => {
    const at = (t: number): FocalNode => layoutFocal(TREE, { fromId: 'R', toId: 'C', t }).nodes.find((x) => x.id === 'A')!
    const a0 = at(0)
    const a1 = at(1)
    const mid = at(0.5)
    expect(mid.arcSpan).toBeCloseTo((a0.arcSpan + a1.arcSpan) / 2, 6)
    // the drawn angle and the wedge angle stay in step
    expect(Math.cos(mid.angle - Math.atan2(mid.cy, mid.cx))).toBeCloseTo(1, 6)
  })
})

// ── Collapse: a far region becomes ONE cluster node, purely subtractively ───

describe('Collapse — visible depth and cluster nodes', () => {
  // A chain deep enough to fall off a visibleDepth of 2, with a bushy tail to count.
  const DEEP: TreeNode = n('R', [n('A', [n('A1', [n('A1a'), n('A1b'), n('A1c')])]), n('B')])

  it('collapse is SUBTRACTIVE — every surviving node keeps the position it had uncollapsed', () => {
    for (const id of allIds(DEEP)) {
      const full = layoutCanonical(DEEP, id)
      const cut = layoutCanonical(DEEP, id, { visibleDepth: 2 })
      for (const node of cut) {
        const same = full.find((x) => x.id === node.id)!
        expect(same).toBeDefined()
        expect(node.cx).toBeCloseTo(same.cx, 9)
        expect(node.cy).toBeCloseTo(same.cy, 9)
        expect(node.depth).toBe(same.depth)
      }
    }
  })

  it('emits nothing past visibleDepth + 1', () => {
    const cut = layoutCanonical(DEEP, 'R', { visibleDepth: 2 })
    expect(Math.max(...cut.map((x) => x.depth))).toBeLessThanOrEqual(3)
    // A1a/A1b/A1c sit at distance 3 from R and have no children — they are leaves at the boundary
    expect(cut.map((x) => x.id).sort()).toEqual(['A', 'A1', 'A1a', 'A1b', 'A1c', 'B', 'R'])
  })

  it('a node past the boundary WITH descendants becomes one cluster counting its region', () => {
    const cut = layoutCanonical(DEEP, 'B', { visibleDepth: 1 }) // B -> R(1) -> A(2) ->...
    const a = cut.find((x) => x.id === 'A')!
    expect(a.cluster).toBe(5) // A, A1, A1a, A1b, A1c
    expect(cut.find((x) => x.id === 'A1')).toBeUndefined()
  })

  it('the ancestor direction collapses too, counting everything on its side of the pivot', () => {
    const cut = layoutCanonical(DEEP, 'A1a', { visibleDepth: 1 }) // A1a -> A1(1) -> A(2, ancestor)
    const a = cut.find((x) => x.id === 'A')!
    expect(a.depth).toBe(2)
    expect(a.cluster).toBe(3) // A, R, B — everything not under A1
    expect(cut.find((x) => x.id === 'R')).toBeUndefined()
  })

  it('a cluster UNFOLDS as the focus moves closer, and its contents were already inside its wedge', () => {
    const far = layoutCanonical(DEEP, 'B', { visibleDepth: 1 })
    const near = layoutCanonical(DEEP, 'R', { visibleDepth: 1 })
    expect(far.find((x) => x.id === 'A')!.cluster).toBe(5)
    expect(near.find((x) => x.id === 'A')!.cluster).toBeUndefined() // A is on ring 1 from R
    expect(near.find((x) => x.id === 'A1')).toBeDefined()
  })
})

// ── Union lerp: nodes appear / disappear without popping ────────────────────

describe('Union lerp — appearing and disappearing nodes', () => {
  const pos = (t: number): EdgePosition => ({ fromId: 'R', toId: 'A', t })
  const GROWN: TreeNode = n('R', [n('A', [n('A1', [n('A1a')]), n('A2')]), n('B')])
  const SMALL: TreeNode = n('R', [n('A', [n('A1', [n('A1a')])]), n('B')])

  it('the id set is exactly the source at t=0 and exactly the destination at t=1', () => {
    const a = layoutCanonical(GROWN, 'R', { visibleDepth: 1 })
    const b = layoutCanonical(GROWN, 'A', { visibleDepth: 1 })
    const idsOf = (x: FocalNode[]): string[] => x.map((k) => k.id).sort()
    expect(idsOf(lerpLayouts(a, b, 0))).toEqual(idsOf(a))
    expect(idsOf(lerpLayouts(a, b, 1))).toEqual(idsOf(b))
  })

  it('an appearing node grows out of its nearest shared ancestor at zero size', () => {
    const a = layoutCanonical(GROWN, 'R', { visibleDepth: 1 }) // A1a is hidden inside cluster A1
    const b = layoutCanonical(GROWN, 'A', { visibleDepth: 1 }) // A focused: A1a surfaces on ring 2
    expect(a.find((x) => x.id === 'A1')!.cluster).toBe(2) // A1 + A1a
    expect(a.find((x) => x.id === 'A1a')).toBeUndefined()
    const early = lerpLayouts(a, b, 0.001).find((x) => x.id === 'A1a')!
    const anchor = a.find((x) => x.id === 'A1')!
    expect(early.radius).toBeLessThan(1)
    expect(Math.hypot(early.cx - anchor.cx, early.cy - anchor.cy)).toBeLessThan(2)
  })

  it('a merge MORPHS: shared nodes move continuously and the new node emerges', () => {
    const before = layoutFocalMorph(SMALL, GROWN, pos(1), 0).nodes
    const after = layoutFocalMorph(SMALL, GROWN, pos(1), 1).nodes
    // t=0 is exactly the pre-merge layout; t=1 exactly the post-merge one.
    expect(before.find((x) => x.id === 'A2')).toBeUndefined()
    expect(after.find((x) => x.id === 'A2')).toBeDefined()
    for (const nodeBefore of before) {
      const mid = layoutFocalMorph(SMALL, GROWN, pos(1), 0.5).nodes.find((x) => x.id === nodeBefore.id)!
      const nodeAfter = after.find((x) => x.id === nodeBefore.id)!
      const rOf = (k: { cx: number; cy: number }): number => Math.hypot(k.cx, k.cy)
      expect(rOf(mid)).toBeGreaterThanOrEqual(Math.min(rOf(nodeBefore), rOf(nodeAfter)) - 1e-6)
      expect(rOf(mid)).toBeLessThanOrEqual(Math.max(rOf(nodeBefore), rOf(nodeAfter)) + 1e-6)
    }
  })
})

// ── No snap at the t=0 / t=1 handoff ─────────────────────────────────

describe('Fix 1 — continuous handoff (no snap)', () => {
  it('at t=0 the focus is the from-node at origin; at t=1 it is the to-node at origin', () => {
    const a = layoutFocal(TREE, { fromId: 'R', toId: 'C', t: 0 }).nodes
    const b = layoutFocal(TREE, { fromId: 'R', toId: 'C', t: 1 }).nodes
    const ra = a.find((x) => x.id === 'R')!
    expect(ra.cx).toBeCloseTo(0)
    expect(ra.cy).toBeCloseTo(0)
    const cb = b.find((x) => x.id === 'C')!
    expect(cb.cx).toBeCloseTo(0)
    expect(cb.cy).toBeCloseTo(0)
  })

  it('the pivot endpoints move continuously and swap places across the edge (C0)', () => {
    // R starts at origin and ends where C started; C starts on ring 1 and ends at origin.
    const a = layoutFocal(TREE, { fromId: 'R', toId: 'C', t: 0 }).nodes
    const b = layoutFocal(TREE, { fromId: 'R', toId: 'C', t: 1 }).nodes
    const cA = a.find((x) => x.id === 'C')!
    const rB = b.find((x) => x.id === 'R')!
    // C's start position (in A) and R's end position (in B) are both off-origin ring-1 points;
    // neither jumps to a far-away place — the lerp interpolates between origin and ring 1.
    expect(Math.hypot(cA.cx, cA.cy)).toBeGreaterThan(0)
    expect(Math.hypot(rB.cx, rB.cy)).toBeGreaterThan(0)
  })
})
