/**
 * Focal layout core — framework-free.
 *
 * A focus-anchored radial layout over the neutral `TreeNode`, with a continuous, edge-constrained
 * re-root.
 *
 * The stability model:
 * - Focus at (edge, t): the focus rides ONE tree edge, so only two candidate roots exist at a time.
 * - Each candidate is a FOCUS-ANCHORED layout: the focus sits at the origin, its neighbors (children
 *   AND the ancestor direction) each get a wedge on ring 1, their neighbors on ring 2, and so on.
 *   Therefore a node's `depth` IS its graph distance from the focus, by construction.
 * - A frame is the per-node LERP of the two candidate layouts by `t`. To keep the lerp from crossing
 *   or snapping, the second layout is built with the first layout's angles as REFERENCE (children are
 *   sorted to preserve angular order) and with the pivot direction pinned (ancestorAngle), so the two
 *   layouts AGREE at the shared pivot — a C0 handoff, no snap.
 *
 * Focus+context comes from two tunable params rather than a per-focus distortion function:
 * `wedgeWeightExp` (how hard angular share follows subtree size) and `shellWidthFactor` (how fast rings
 * compress outward). Both are pure functions of the tree, so they cost nothing in stability.
 */
import type { TreeNode } from './tree'
import { subtreeWeight, subtreeSize } from './tree'

export interface FocalLayoutParams {
  /** Distance between concentric rings. */
  shellWidth: number
  /**
   * Geometric factor for ring width at each depth (1 = constant). Below 1 each ring outward is
   * narrower, so near context spreads and far context compresses — the RADIAL half of focus+context.
   */
  shellWidthFactor: number
  /**
   * How hard a wedge's angular share follows its subtree size: `share ∝ subtreeWeight^exp`.
   * 0 = every wedge equal, 1 = fully proportional. 0.5 (sqrt) keeps a bushy ancestor from swallowing
   * the circle while still giving it room.
   *
   * It travels with the whole params object on purpose: a layout computed with two different exponents
   * would not be canonical, and determinism is what the re-root stability rests on.
   */
  wedgeWeightExp: number
  /**
   * Last ring rendered in full. A node one ring further out that still has descendants collapses into
   * a single CLUSTER node carrying its region's node count; anything beyond is not emitted.
   *
   * Collapse is purely SUBTRACTIVE: every wedge is still sized from the FULL tree's weights, so a
   * visible node's angle and radius are identical with and without it. Moving the focus closer unfolds
   * a cluster into detail INSIDE the wedge it already occupied — no redistribution, no re-fetch.
   *
   * `Infinity` (the default) renders everything.
   */
  visibleDepth: number
}

const DEFAULT_PARAMS: FocalLayoutParams = {
  shellWidth: 120,
  shellWidthFactor: 1.0,
  wedgeWeightExp: 0.5,
  visibleDepth: Infinity,
}

/** The focus rides one tree edge, parameterized by t in [0,1] (0 = at fromId, 1 = at toId). */
export interface EdgePosition {
  fromId: string
  toId: string
  t: number
}

export interface FocalNode<D = unknown> {
  id: string
  label: string
  cx: number
  cy: number
  radius: number
  /** Graph distance (ring) from the current focus. Focus = 0. */
  depth: number
  parentId: string | null
  /** Center angle of this node's wedge (radians). */
  angle: number
  /** Angular width of this node's wedge (radians). */
  arcSpan: number
  /**
   * Set when this node stands in for a COLLAPSED region beyond the visible depth: the number of tree
   * nodes it represents, itself included (always > 1). A cluster is a summary, not a place you can go —
   * the mount paints it as a cluster glyph and does not let you re-root onto it; re-rooting nearer
   * unfolds it.
   */
  cluster?: number
  data?: D
}

export interface FocalEdge {
  sourceId: string
  targetId: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

export interface FocalLayoutResult<D = unknown> {
  nodes: FocalNode<D>[]
  edges: FocalEdge[]
}

// ── angle helpers ──────────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI

function normalizeAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI
}

/** Stable id comparator — the CANONICAL child order, so a layout is path-independent. */
function byId<D>(a: TreeNode<D>, b: TreeNode<D>): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Spans proportional to weights, summing to totalSpan. */
function proportional(weights: number[], totalSpan: number): number[] {
  const tot = weights.reduce((s, w) => s + w, 0) || 1
  return weights.map((w) => totalSpan * (w / tot))
}

// Wedge shares scale with subtree size, SOFTENED by a sub-linear power (see `wedgeWeightExp`) so the
// ancestor direction — which holds the whole rest of the tree — does not swallow the circle and squash
// the focus's own children.
function wedgeWeight(rawSubtreeWeight: number, exp: number): number {
  return Math.pow(rawSubtreeWeight, exp)
}

/** Signed angular distance from a center: negative = ccw, positive = cw, in (-pi, pi]. */
function signedAngleDist(angle: number, center: number): number {
  let d = normalizeAngle(angle - center)
  if (d > Math.PI) d -= TWO_PI
  return d
}

/**
 * Sort items by signed angular distance from an arc's midpoint, using reference angles. Preserves
 * the angular ORDER a reference layout established, so a lerp toward this layout cannot cross siblings.
 */
function sortByRefAngle<D>(
  items: TreeNode<D>[],
  arcStart: number,
  arcSpan: number,
  refs: Map<string, number>,
): TreeNode<D>[] {
  const midpoint = normalizeAngle(arcStart + arcSpan / 2)
  return [...items].sort((a, b) => {
    const ra = refs.get(a.id)
    const rb = refs.get(b.id)
    if (ra === undefined || rb === undefined) return 0
    return signedAngleDist(ra, midpoint) - signedAngleDist(rb, midpoint)
  })
}

// ── radii ──────────────────────────────────────────────────────────────

/** Cumulative radius of the ring at a given depth. */
export function ringRadius(depth: number, shellWidth: number, shellWidthFactor: number): number {
  let sum = 0
  for (let i = 0; i < depth; i++) sum += shellWidth * Math.pow(shellWidthFactor, i)
  return sum
}

function nodeRadius(rRing: number, arcSpan: number, shellWidth: number): number {
  const MAX = shellWidth * 0.4
  const MIN = 8
  return Math.max(MIN, Math.min(MAX, rRing * Math.sin(arcSpan / 2)))
}

// ── tree helpers ───────────────────────────────────────────────────────

/** Path from root to target as a node list [root, ..., parent, target], or null. */
export function findPath<D>(node: TreeNode<D>, targetId: string): TreeNode<D>[] | null {
  if (node.id === targetId) return [node]
  for (const child of node.children) {
    const p = findPath(child, targetId)
    if (p) return [node, ...p]
  }
  return null
}

/**
 * The tree PATH between two nodes, as an id sequence [fromId, ..., toId]. The focus animates along
 * this edge-by-edge; each consecutive pair is one navigation step (one edge crossing).
 */
export function pathBetween<D>(root: TreeNode<D>, fromId: string, toId: string): string[] {
  const pf = findPath(root, fromId)
  const pt = findPath(root, toId)
  if (!pf || !pt) return []
  // common prefix length
  let i = 0
  while (i < pf.length && i < pt.length && pf[i].id === pt[i].id) i++
  const up = pf.slice(i - 1).reverse().map((n) => n.id) // fromId ... lca
  const down = pt.slice(i).map((n) => n.id) // (after lca) ... toId
  return [...up, ...down]
}

// ── focus-anchored layout ──────────────────────────────────────────────

/**
 * Focus-anchored radial layout: `focusId` at the origin, each child + the ancestor direction on ring
 * 1 (equal wedges), recursively outward.
 *
 * @param ancestorAngle pins the ancestor wedge to this angle (direction-preserving across a re-root).
 * @param referenceAngles child ordering reference from a prior layout, to prevent lerp crossover.
 */
export function layoutFocusAnchored<D>(
  root: TreeNode<D>,
  focusId: string,
  params: Partial<FocalLayoutParams> = {},
  ancestorAngle?: number,
  referenceAngles?: Map<string, number>,
): FocalNode<D>[] {
  const { shellWidth, shellWidthFactor, wedgeWeightExp, visibleDepth } = { ...DEFAULT_PARAMS, ...params }
  const result: FocalNode<D>[] = []

  const path = findPath(root, focusId)
  if (!path) return result

  const focusNode = path[path.length - 1]
  const hasAncestor = path.length > 1
  const nWedges = focusNode.children.length + (hasAncestor ? 1 : 0)

  result.push({
    id: focusNode.id,
    label: focusNode.label,
    cx: 0,
    cy: 0,
    radius: shellWidth * 0.4,
    depth: 0,
    parentId: hasAncestor ? path[path.length - 2].id : null,
    angle: 0,
    arcSpan: TWO_PI,
    data: focusNode.data,
  })

  if (nWedges === 0) return result

  // Weighted wedges: each child gets a share proportional to its subtree, and the ANCESTOR direction
  // (which holds the whole rest of the tree) gets a share proportional to that. So a bushy ancestor
  // keeps most of the circle regardless of the focus's child count — the layout barely rescales on
  // re-root, and the transition motion stays small.
  const totalW = subtreeWeight(root)
  const ancW = hasAncestor ? wedgeWeight(Math.max(1, totalW - subtreeWeight(focusNode)), wedgeWeightExp) : 0
  const sortedKids = referenceAngles
    ? sortByRefAngle(focusNode.children, 0, TWO_PI, referenceAngles)
    : [...focusNode.children].sort(byId)
  const kidW = sortedKids.map((c) => wedgeWeight(subtreeWeight(c), wedgeWeightExp))
  const total = kidW.reduce((s, w) => s + w, 0) + ancW
  const ancSpan = hasAncestor ? TWO_PI * (ancW / total) : 0
  const kidSpans = proportional(kidW, TWO_PI - ancSpan)

  const ctx: PlaceCtx<D> = {
    shellWidth,
    shellWidthFactor,
    wedgeWeightExp,
    visibleDepth,
    totalW,
    totalNodes: subtreeSize(root),
    result,
    path,
  }

  const placeKids = (startAt: number): void => {
    let start = startAt
    for (let i = 0; i < sortedKids.length; i++) {
      placeSubtree(sortedKids[i], 1, focusNode.id, start, kidSpans[i], ctx)
      start = normalizeAngle(start + kidSpans[i])
    }
  }

  if (hasAncestor && ancestorAngle !== undefined) {
    const aAngle = normalizeAngle(ancestorAngle)
    placeKids(normalizeAngle(aAngle + ancSpan / 2))
    placeAncestorChain(path.length - 2, focusNode.id, normalizeAngle(aAngle - ancSpan / 2), ancSpan, 1, ctx)
  } else {
    const startAngle = !hasAncestor && ancestorAngle !== undefined ? normalizeAngle(ancestorAngle + ancSpan / 2) : 0
    placeKids(startAngle)
    if (hasAncestor) {
      placeAncestorChain(path.length - 2, focusNode.id, normalizeAngle(startAngle + (TWO_PI - ancSpan)), ancSpan, 1, ctx)
    }
  }

  return result
}

/** Everything the recursive placers need, bundled so the collapse rule travels with them. */
interface PlaceCtx<D> {
  shellWidth: number
  shellWidthFactor: number
  wedgeWeightExp: number
  visibleDepth: number
  /** Full-tree subtree weight, for the ancestor-direction share. */
  totalW: number
  /** Full-tree node count, for the ancestor-direction cluster count. */
  totalNodes: number
  result: FocalNode<D>[]
  /** root → focus, the ancestor chain the layout walks back up. */
  path: TreeNode<D>[]
}

function placeSubtree<D>(
  node: TreeNode<D>,
  ringDepth: number,
  parentId: string,
  arcStart: number,
  arcSpan: number,
  ctx: PlaceCtx<D>,
): void {
  const { shellWidth, shellWidthFactor, visibleDepth, result } = ctx
  const r = ringRadius(ringDepth, shellWidth, shellWidthFactor)
  const angle = arcStart + arcSpan / 2
  // Past the visible depth this node stands in for its whole subtree: one cluster, no recursion.
  const collapsed = ringDepth > visibleDepth && node.children.length > 0
  result.push({
    id: node.id,
    label: node.label,
    cx: r * Math.cos(angle),
    cy: r * Math.sin(angle),
    radius: nodeRadius(r, arcSpan, shellWidth),
    depth: ringDepth,
    parentId,
    angle,
    arcSpan,
    ...(collapsed ? { cluster: subtreeSize(node) } : {}),
    data: node.data,
  })
  if (node.children.length === 0 || ringDepth > visibleDepth) return
  const kids = [...node.children].sort(byId)
  const spans = proportional(kids.map((c) => wedgeWeight(subtreeWeight(c), ctx.wedgeWeightExp)), arcSpan)
  let childStart = arcStart
  for (let i = 0; i < kids.length; i++) {
    placeSubtree(kids[i], ringDepth + 1, node.id, childStart, spans[i], ctx)
    childStart += spans[i]
  }
}

/** Walk up the ancestor chain, placing each ancestor + its other-children on successive rings. */
function placeAncestorChain<D>(
  ancestorIndex: number,
  cameFromId: string,
  arcStart: number,
  arcSpan: number,
  ringDepth: number,
  ctx: PlaceCtx<D>,
): void {
  const { shellWidth, shellWidthFactor, wedgeWeightExp, visibleDepth, totalW, totalNodes, result, path } = ctx
  const ancestor = path[ancestorIndex]
  const actualParentId = ancestorIndex > 0 ? path[ancestorIndex - 1].id : null

  const r = ringRadius(ringDepth, shellWidth, shellWidthFactor)
  const angle = arcStart + arcSpan / 2
  // Past the visible depth the ancestor stands in for its whole side of the pivot edge: everything
  // NOT under the node we came from.
  const beyond = totalNodes - subtreeSize(path[ancestorIndex + 1])
  const collapsed = ringDepth > visibleDepth && beyond > 1
  result.push({
    id: ancestor.id,
    label: ancestor.label,
    cx: r * Math.cos(angle),
    cy: r * Math.sin(angle),
    radius: nodeRadius(r, arcSpan, shellWidth),
    depth: ringDepth,
    parentId: actualParentId,
    angle,
    arcSpan,
    ...(collapsed ? { cluster: beyond } : {}),
    data: ancestor.data,
  })
  if (ringDepth > visibleDepth) return

  const otherChildren = ancestor.children.filter((c) => c.id !== cameFromId)
  const hasGrandparent = ancestorIndex > 0
  if (otherChildren.length + (hasGrandparent ? 1 : 0) === 0) return

  type Dir<E> = { kind: 'child'; node: TreeNode<E> } | { kind: 'grandparent' }
  const gpId = hasGrandparent ? path[ancestorIndex - 1].id : ''
  const dirs: Dir<D>[] = [
    ...otherChildren.map((node) => ({ kind: 'child' as const, node })),
    ...(hasGrandparent ? [{ kind: 'grandparent' as const }] : []),
  ]
  const dirId = (d: Dir<D>): string => (d.kind === 'child' ? d.node.id : gpId)

  // Order the ancestor's OTHER directions by their arrangement around the ancestor IN THE ANCESTOR'S
  // OWN canonical frame, relative to the direction we came from (toward the focus). Placing them in
  // that order across the wedge keeps the ancestor's subtree in the same rotational sense whether the
  // ancestor is the focus or above it — so it does not reflect/swap on re-root.
  const canon = canonicalNeighborAngles(path[0], ancestor.id, totalW, wedgeWeightExp)
  const cameFromAngle = canon.get(cameFromId) ?? 0
  const offset = (d: Dir<D>): number => normalizeAngle((canon.get(dirId(d)) ?? 0) - cameFromAngle)
  dirs.sort((a, b) => offset(a) - offset(b) || (dirId(a) < dirId(b) ? -1 : 1))

  // Weighted: the grandparent direction (everything above this ancestor) gets a share proportional to
  // its subtree, softened the same way as everywhere else.
  const grandparentW = wedgeWeight(Math.max(1, totalW - subtreeWeight(ancestor)), wedgeWeightExp)
  const dirW = dirs.map((d) => (d.kind === 'child' ? wedgeWeight(subtreeWeight(d.node), wedgeWeightExp) : grandparentW))
  const spans = proportional(dirW, arcSpan)

  let subStart = arcStart
  for (let k = 0; k < dirs.length; k++) {
    const dir = dirs[k]
    if (dir.kind === 'child') {
      placeSubtree(dir.node, ringDepth + 1, ancestor.id, subStart, spans[k], ctx)
    } else {
      placeAncestorChain(ancestorIndex - 1, ancestor.id, subStart, spans[k], ringDepth + 1, ctx)
    }
    subStart += spans[k]
  }
}

// ── canonical (path-independent) layout ────────────────────────────────

/**
 * The CANONICAL ancestor angle for `focusId`: the fixed direction its parent points, derived purely
 * from the tree (child counts + id order along root→focus), NOT from how the focus was reached.
 *
 * It walks root→focus, and at each step reads where the next node sits in the current node's
 * canonical layout, pinning the reverse direction (`+ pi`). So the edge parent→child is the same ray
 * whether the parent or the child is focused, and every node has ONE layout regardless of path.
 */
export function canonicalAnchor<D>(
  root: TreeNode<D>,
  focusId: string,
  wedgeWeightExp: number = DEFAULT_PARAMS.wedgeWeightExp,
): number | undefined {
  const path = findPath(root, focusId)
  if (!path || path.length < 2) return undefined // the root has no ancestor
  const totalW = subtreeWeight(root)
  let anchor: number | undefined = undefined
  for (let i = 0; i < path.length - 1; i++) {
    const node = path[i]
    const nextId = path[i + 1].id
    const hasAncestor = i > 0
    const kids = [...node.children].sort(byId)
    const kidW = kids.map((c) => wedgeWeight(subtreeWeight(c), wedgeWeightExp))
    const ancW = hasAncestor ? wedgeWeight(Math.max(1, totalW - subtreeWeight(node)), wedgeWeightExp) : 0
    const total = kidW.reduce((s, w) => s + w, 0) + ancW
    const ancSpan = hasAncestor ? TWO_PI * (ancW / total) : 0
    const kidSpans = proportional(kidW, TWO_PI - ancSpan)
    let a = hasAncestor ? normalizeAngle((anchor as number) + ancSpan / 2) : 0
    let childAngle = 0
    for (let j = 0; j < kids.length; j++) {
      if (kids[j].id === nextId) {
        childAngle = normalizeAngle(a + kidSpans[j] / 2)
        break
      }
      a += kidSpans[j]
    }
    anchor = normalizeAngle(childAngle + Math.PI)
  }
  return anchor
}

/**
 * The canonical angle of each of `nodeId`'s neighbors (its children + its parent) IN nodeId's own
 * canonical frame, computed analytically (no recursion). Used to place an ancestor's subtree in the
 * same rotational arrangement it has when that node is itself the focus — so a subtree does not
 * reflect/rotate when it moves from below the focus to above it.
 */
function canonicalNeighborAngles<D>(
  root: TreeNode<D>,
  nodeId: string,
  totalW: number,
  wedgeWeightExp: number,
): Map<string, number> {
  const map = new Map<string, number>()
  const path = findPath(root, nodeId)
  if (!path) return map
  const node = path[path.length - 1]
  const hasAncestor = path.length > 1
  const anchor = canonicalAnchor(root, nodeId, wedgeWeightExp)
  const kids = [...node.children].sort(byId)
  const kidW = kids.map((c) => wedgeWeight(subtreeWeight(c), wedgeWeightExp))
  const ancW = hasAncestor ? wedgeWeight(Math.max(1, totalW - subtreeWeight(node)), wedgeWeightExp) : 0
  const total = kidW.reduce((s, w) => s + w, 0) + ancW
  const ancSpan = hasAncestor ? TWO_PI * (ancW / total) : 0
  const kidSpans = proportional(kidW, TWO_PI - ancSpan)
  let a = hasAncestor ? normalizeAngle((anchor as number) + ancSpan / 2) : 0
  for (let i = 0; i < kids.length; i++) {
    map.set(kids[i].id, normalizeAngle(a + kidSpans[i] / 2))
    a += kidSpans[i]
  }
  if (hasAncestor) map.set(path[path.length - 2].id, normalizeAngle(anchor as number))
  return map
}

/** The canonical, path-independent focus-anchored layout of `focusId` (id order + canonical anchor). */
export function layoutCanonical<D>(
  root: TreeNode<D>,
  focusId: string,
  params: Partial<FocalLayoutParams> = {},
): FocalNode<D>[] {
  const exp = params.wedgeWeightExp ?? DEFAULT_PARAMS.wedgeWeightExp
  return layoutFocusAnchored(root, focusId, params, canonicalAnchor(root, focusId, exp))
}

// ── blend ──────────────────────────────────────────────────────────────

const EPS = 1e-6

/** Polar blend of one node's two poses: orbit along the shortest arc, radius interpolated. */
function blendNode<D>(na: FocalNode<D>, nb: FocalNode<D>, t: number): FocalNode<D> {
  const ra = Math.hypot(na.cx, na.cy)
  const rb = Math.hypot(nb.cx, nb.cy)
  const angA = ra < EPS ? Math.atan2(nb.cy, nb.cx) : Math.atan2(na.cy, na.cx)
  const angB = rb < EPS ? Math.atan2(na.cy, na.cx) : Math.atan2(nb.cy, nb.cx)
  let diff = angB - angA
  while (diff > Math.PI) diff -= TWO_PI
  while (diff < -Math.PI) diff += TWO_PI
  const ang = angA + diff * t
  const r = ra + (rb - ra) * t
  const near = t < 0.5 ? na : nb // discrete properties take the nearer endpoint's value
  // The wedge fields interpolate too: they are what the structure overlay draws, so leaving them at
  // the source's values would make the sectors lag the dots for the whole animation.
  let wedgeDiff = nb.angle - na.angle
  while (wedgeDiff > Math.PI) wedgeDiff -= TWO_PI
  while (wedgeDiff < -Math.PI) wedgeDiff += TWO_PI
  return {
    ...na,
    cx: r * Math.cos(ang),
    cy: r * Math.sin(ang),
    radius: na.radius + (nb.radius - na.radius) * t,
    angle: na.angle + wedgeDiff * t,
    arcSpan: na.arcSpan + (nb.arcSpan - na.arcSpan) * t,
    depth: near.depth,
    cluster: near.cluster,
  }
}

/**
 * Where a node that exists in only ONE layout comes from (or goes to) in the other: the position of
 * its nearest ancestor that DOES exist there, so it grows out of / shrinks into its parent rather than
 * popping. Falls back to its own position when no ancestor is shared.
 */
function anchorInOther<D>(
  node: FocalNode<D>,
  own: Map<string, FocalNode<D>>,
  other: Map<string, FocalNode<D>>,
): { cx: number; cy: number } {
  let cur: FocalNode<D> | undefined = node
  const seen = new Set<string>()
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    const inOther = other.get(cur.parentId)
    if (inOther) return { cx: inOther.cx, cy: inOther.cy }
    cur = own.get(cur.parentId)
  }
  return { cx: node.cx, cy: node.cy }
}

/**
 * Per-node blend of two layouts by t, in POLAR space: each node ORBITS along the shortest angular
 * arc while its radius interpolates, instead of sliding on a straight cartesian line through the
 * centre. A large re-anchoring then reads as smooth rotation, not nodes flying across the middle. A
 * node at the origin (the focus) has no meaningful angle, so it borrows the other end's and moves
 * purely radially.
 *
 * The two layouts need NOT share an id set — collapse means a node can appear (a cluster unfolding,
 * the tree growing) or disappear (a region passing beyond the visible depth). Such a node grows out of
 * / shrinks into its nearest shared ancestor, at zero size, and only exists strictly inside the
 * transition: the id set is exactly `a`'s at t=0 and exactly `b`'s at t=1.
 */
export function lerpLayouts<D>(a: FocalNode<D>[], b: FocalNode<D>[], t: number): FocalNode<D>[] {
  const aMap = new Map<string, FocalNode<D>>()
  for (const n of a) aMap.set(n.id, n)
  const bMap = new Map<string, FocalNode<D>>()
  for (const n of b) bMap.set(n.id, n)

  const out: FocalNode<D>[] = []
  for (const na of a) {
    const nb = bMap.get(na.id)
    if (nb) out.push(blendNode(na, nb, t))
    else if (t < 1) {
      const to = anchorInOther(na, aMap, bMap)
      out.push(blendNode(na, { ...na, ...to, radius: 0 }, t))
    }
  }
  for (const nb of b) {
    if (aMap.has(nb.id) || t <= 0) continue
    const from = anchorInOther(nb, bMap, aMap)
    out.push(blendNode({ ...nb, ...from, radius: 0 }, nb, t))
  }
  return out
}

function edgesFrom<D>(nodes: FocalNode<D>[]): FocalEdge[] {
  const byId = new Map<string, FocalNode<D>>()
  for (const n of nodes) byId.set(n.id, n)
  const edges: FocalEdge[] = []
  for (const n of nodes) {
    if (n.parentId == null) continue
    const p = byId.get(n.parentId)
    if (!p) continue
    edges.push({ sourceId: p.id, targetId: n.id, sourceX: p.cx, sourceY: p.cy, targetX: n.cx, targetY: n.cy })
  }
  return edges
}

/**
 * The frame at focus position (edge, t): the lerp of the two endpoints' CANONICAL layouts.
 *
 * Because each endpoint layout is canonical (path-independent), the frame is deterministic — the same
 * focus always yields the same layout, so A→B→A returns exactly. The canonical anchor is edge-aligned
 * (parent→child is one ray), so the pivot slides straight with minimal rotation; and both endpoints
 * share the id child-order, so no sibling pair reverses during the lerp. A multi-edge animation is
 * seamless: the `to` of one edge and the `from` of the next are the SAME canonical layout.
 */
export function layoutFocal<D>(
  root: TreeNode<D>,
  pos: EdgePosition,
  params: Partial<FocalLayoutParams> = {},
): FocalLayoutResult<D> {
  const a = layoutCanonical(root, pos.fromId, params)
  const b = layoutCanonical(root, pos.toId, params)
  const nodes = lerpLayouts(a, b, pos.t)
  return { nodes, edges: edgesFrom(nodes) }
}

/**
 * The frame MID-GROWTH: the same focus position laid out over two versions of the tree, blended by
 * `t`. Progressive expansion merges new nodes in, which widens their ancestors' wedges slightly (spans
 * are weight-proportional), so the arrival is animated rather than snapped — existing nodes orbit the
 * few degrees they shift, and the new ones grow out of their parent.
 */
export function layoutFocalMorph<D>(
  prevTree: TreeNode<D>,
  nextTree: TreeNode<D>,
  pos: EdgePosition,
  t: number,
  params: Partial<FocalLayoutParams> = {},
): FocalLayoutResult<D> {
  const a = layoutFocal(prevTree, pos, params).nodes
  const b = layoutFocal(nextTree, pos, params).nodes
  const nodes = lerpLayouts(a, b, t)
  return { nodes, edges: edgesFrom(nodes) }
}
