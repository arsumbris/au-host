/**
 * Radial layout for a rooted tree.
 *
 * Pure function: a `TreeNode` → positioned nodes + spine edges. No rendering,
 * no DOM, no React.
 *
 * The root sits at the centre; every other node sits on a concentric shell at
 * its depth, and each subtree claims an angular sector proportional to its
 * weight. So a heavy branch fans wide and a light one stays narrow, and the
 * whole thing stays balanced.
 *
 * This core lays every node on its depth shell uniformly (a clean ring at depth 1,
 * a balanced tree deeper), which generalizes to any reference neighborhood.
 */
import type { TreeNode } from './tree'
import { subtreeWeight } from './tree'

// ── Types ──────────────────────────────────────────────────────────────

export interface RadialLayoutConfig {
  /** Distance between concentric shells. */
  shellWidth: number
  /** Geometric scale factor for shell width at each depth (1 = constant). */
  shellWidthFactor: number
  /** Base visual radius for a node. */
  nodeSize: number
  /** Scale factor for node size at each depth (<1 = shrink outward). */
  nodeSizeFactor: number
  /** Sector start angle in degrees (0 = right, 90 = down). Default 0. */
  startAngle: number
  /** Sector angular span in degrees. Default 360 (the full circle). */
  angleSpan: number
  /** Ids that appear under more than one parent; marked `isDuplicate`. */
  duplicates: Set<string>
}

export interface PositionedNode<D = unknown> {
  id: string
  label: string
  /** `root` at depth 0, `leaf` with no children, else `branch`. */
  kind: 'root' | 'branch' | 'leaf'
  x: number
  y: number
  /** Distance from centre. */
  radius: number
  /** Angle in degrees (0 = right, 90 = down). */
  angle: number
  /** Visual size (base scaled by depth and weight). */
  size: number
  /** Depth from the root (root = 0). */
  depth: number
  /** Subtree weight (a leaf = 1). */
  weight: number
  /** Id of the parent node (null for root). */
  parentId: string | null
  /** True if this id appears under multiple parents. */
  isDuplicate: boolean
  /** The source node's opaque render metadata, carried through untouched. */
  data?: D
}

export interface SpineEdge {
  sourceId: string
  targetId: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

export interface RadialLayoutResult<D = unknown> {
  nodes: PositionedNode<D>[]
  edges: SpineEdge[]
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: RadialLayoutConfig = {
  shellWidth: 160,
  shellWidthFactor: 0.85,
  nodeSize: 10,
  nodeSizeFactor: 0.85,
  startAngle: 0,
  angleSpan: 360,
  duplicates: new Set(),
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Compute a radial layout for a rooted tree.
 *
 * Pass `startAngle` / `angleSpan` to confine the tree to a sector (e.g. a
 * hemisphere per reference direction: outbound in `[-90, 90]`, inbound in
 * `[90, 270]`).
 */
export function computeRadialLayout<D>(
  root: TreeNode<D> | null,
  config: Partial<RadialLayoutConfig> = {},
): RadialLayoutResult<D> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const nodes: PositionedNode<D>[] = []
  const edges: SpineEdge[] = []

  if (!root) return { nodes, edges }

  const rootWeight = subtreeWeight(root)

  const rootNode: PositionedNode<D> = {
    id: root.id,
    label: root.label,
    kind: 'root',
    x: 0,
    y: 0,
    radius: 0,
    angle: 0,
    size: nodeSizeForWeight(cfg.nodeSize * 1.2, rootWeight),
    depth: 0,
    weight: rootWeight,
    parentId: null,
    isDuplicate: false,
    data: root.data,
  }
  nodes.push(rootNode)

  layoutChildren(root.children, rootNode, 1, cfg.startAngle, cfg.angleSpan, cfg, nodes, edges)

  return { nodes, edges }
}

// ── Internals ──────────────────────────────────────────────────────────

/** Scale a node's dot size by its subtree weight (logarithmic, capped at 2x). */
function nodeSizeForWeight(baseSize: number, weight: number): number {
  const scaled = baseSize * (1 + Math.log2(Math.max(weight, 1)) * 0.15)
  return Math.min(scaled, baseSize * 2)
}

/** Radius for a depth, with geometric shell-width scaling. */
function radiusForDepth(depth: number, shellWidth: number, shellWidthFactor: number): number {
  let sum = 0
  for (let i = 0; i < depth; i++) {
    sum += shellWidth * Math.pow(shellWidthFactor, i)
  }
  return sum
}

/** Polar (degrees, radius) → Cartesian. */
function polarToCartesian(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) }
}

/** Node size scaled by depth. */
function sizeAtDepth(baseSize: number, sizeFactor: number, depth: number): number {
  return baseSize * Math.pow(sizeFactor, depth)
}

/**
 * Lay out a node's children within an angular sector, weight-balanced, then
 * recurse into each child's own sub-sector.
 */
function layoutChildren<D>(
  children: TreeNode<D>[],
  parent: PositionedNode<D>,
  depth: number,
  startAngle: number,
  angleSpan: number,
  cfg: RadialLayoutConfig,
  nodes: PositionedNode<D>[],
  edges: SpineEdge[],
): void {
  const weights = children.map((c) => subtreeWeight(c))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (totalWeight === 0) return

  const radius = radiusForDepth(depth, cfg.shellWidth, cfg.shellWidthFactor)
  let currentAngle = startAngle

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const weight = weights[i]
    const itemAngleSpan = angleSpan * (weight / totalWeight)
    const centerAngle = currentAngle + itemAngleSpan / 2
    const pos = polarToCartesian(centerAngle, radius)

    const node: PositionedNode<D> = {
      id: child.id,
      label: child.label,
      kind: child.children.length > 0 ? 'branch' : 'leaf',
      x: pos.x,
      y: pos.y,
      radius,
      angle: centerAngle,
      size: nodeSizeForWeight(sizeAtDepth(cfg.nodeSize, cfg.nodeSizeFactor, depth), weight),
      depth,
      weight,
      parentId: parent.id,
      isDuplicate: cfg.duplicates.has(child.id),
      data: child.data,
    }
    nodes.push(node)

    edges.push({
      sourceId: parent.id,
      targetId: node.id,
      sourceX: parent.x,
      sourceY: parent.y,
      targetX: node.x,
      targetY: node.y,
    })

    if (child.children.length > 0) {
      layoutChildren(child.children, node, depth + 1, currentAngle, itemAngleSpan, cfg, nodes, edges)
    }

    currentAngle += itemAngleSpan
  }
}
