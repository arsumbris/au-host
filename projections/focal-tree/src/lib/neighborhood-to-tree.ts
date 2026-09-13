/**
 * Adapter: a schema-20 `neighborhood` read → the neutral `TreeNode` the radial layout consumes.
 *
 * The neighborhood is a GRAPH (nodes + traversed edges); a radial tree needs a rooted TREE. We
 * build a spanning tree by BFS over the nodes' `depth` (the minimum hop count from the seed),
 * which is orientation-agnostic: a depth d+1 node becomes a child of the first depth-d node it
 * shares an edge with. A node reachable from several depth-d parents is attached once and marked
 * a DUPLICATE. Edge orientation is preserved as a per-node hemisphere: a node the parent
 * REFERENCES is `out`, a node that references the parent is `in`.
 *
 * The tree also GROWS: `mergeNeighborhood` unions a neighborhood fetched around some node already in
 * the tree into that tree, MONOTONICALLY — an existing node keeps its existing parent (first-assigned
 * wins), nothing is removed or re-parented, only new nodes attach at the frontier. That is what keeps
 * every already-placed node's canonical layout unchanged as the graph expands.
 *
 * Framework-free. Imports only the SDK's neighborhood wire types.
 */
import type {
  WireNeighborhoodResult,
  WireNeighborhoodNode,
  WireNeighborhoodNodeRef,
  WireParseKind,
  WireNeighborhoodKind,
} from '@arsumbris/au-host-sdk/engine-reads'
import { cloneTree, type TreeNode } from './tree'

/** Render metadata carried onto each positioned node (opaque to the layout). */
export interface RadialNodeData {
  path: string
  blockId?: string
  fileKind: WireParseKind
  /** Hemisphere relative to the parent: an outbound target (`out`), an inbound referrer (`in`), or the `root`. */
  direction: 'root' | 'out' | 'in'
  /** The connecting edge's coarse kind (absent on the root). */
  edgeKind?: WireNeighborhoodKind
}

export interface NeighborhoodTree {
  tree: TreeNode<RadialNodeData> | null
  /** Ids that were reachable from more than one parent (attached once, flagged). */
  duplicates: Set<string>
}

/** A node's stable id: its path, plus `^blockId` for a block node. */
function nodeId(n: { path: string; block_id?: string }): string {
  return n.block_id ? `${n.path}^${n.block_id}` : n.path
}

function refId(r: WireNeighborhoodNodeRef): string {
  return r.block_id ? `${r.path}^${r.block_id}` : r.path
}

/** The last path segment, for a compact node label. */
function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i < 0 ? trimmed : trimmed.slice(i + 1)
}

interface Adj {
  id: string
  kind: WireNeighborhoodKind
  direction: 'out' | 'in'
}

/** Index the wire nodes by their stable id. */
function indexNodes(result: WireNeighborhoodResult): Map<string, WireNeighborhoodNode> {
  const byId = new Map<string, WireNeighborhoodNode>()
  for (const n of result.nodes) byId.set(nodeId(n), n)
  return byId
}

/**
 * Undirected adjacency with the orientation recorded per side.
 * Edge from=A to=B means A references B: B is `out` of A, A is `in` of B.
 */
function buildAdjacency(
  result: WireNeighborhoodResult,
  byId: Map<string, WireNeighborhoodNode>,
): Map<string, Adj[]> {
  const neighbors = new Map<string, Adj[]>()
  const push = (a: string, entry: Adj): void => {
    const list = neighbors.get(a)
    if (list) list.push(entry)
    else neighbors.set(a, [entry])
  }
  for (const e of result.edges) {
    if (!e.to) continue // dangling / excluded target — not a tree edge
    const fromId = refId(e.from)
    const toId = refId(e.to)
    if (!byId.has(fromId) || !byId.has(toId)) continue
    push(fromId, { id: toId, kind: e.kind, direction: 'out' })
    push(toId, { id: fromId, kind: e.kind, direction: 'in' })
  }
  return neighbors
}

function makeNode(
  id: string,
  node: WireNeighborhoodNode,
  direction: RadialNodeData['direction'],
  edgeKind?: WireNeighborhoodKind,
): TreeNode<RadialNodeData> {
  return {
    id,
    label: basename(node.path) + (node.block_id ? `^${node.block_id}` : ''),
    children: [],
    data: { path: node.path, blockId: node.block_id, fileKind: node.file_kind, direction, edgeKind },
  }
}

const byIdAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Grow `treeById` outward from `startIds` over the fetched graph, one wire-depth level at a time.
 *
 * A node ALREADY in the tree is never re-parented — it just joins the next frontier so its own new
 * neighbors can attach through it. A node not in the tree attaches to the first (id-sorted) frontier
 * node that reaches it. Frontiers are sorted, so the result is deterministic.
 */
function expand(
  byId: Map<string, WireNeighborhoodNode>,
  neighbors: Map<string, Adj[]>,
  treeById: Map<string, TreeNode<RadialNodeData>>,
  startIds: string[],
  duplicates: Set<string>,
  maxDepth: number,
  startDepth: number,
): string[] {
  const added: string[] = []
  let frontier = [...startIds]
  for (let d = startDepth; d < maxDepth; d++) {
    frontier.sort(byIdAsc)
    const next: string[] = []
    const queued = new Set<string>()
    for (const pid of frontier) {
      const parentTree = treeById.get(pid)!
      const adj = (neighbors.get(pid) ?? [])
        .filter((e) => (byId.get(e.id)?.depth ?? -1) === d + 1)
        .sort((a, b) => byIdAsc(a.id, b.id))
      for (const e of adj) {
        if (treeById.has(e.id)) {
          // Already placed (earlier parent, or a pre-existing node): keep its parent, but let it host.
          if (!queued.has(e.id)) {
            queued.add(e.id)
            next.push(e.id)
          }
          duplicates.add(e.id)
          continue
        }
        const child = makeNode(e.id, byId.get(e.id)!, e.direction, e.kind)
        parentTree.children.push(child)
        treeById.set(e.id, child)
        queued.add(e.id)
        next.push(e.id)
        added.push(e.id)
      }
    }
    frontier = next
  }
  return added
}

/** Index an existing tree by node id. */
function indexTree(root: TreeNode<RadialNodeData>): Map<string, TreeNode<RadialNodeData>> {
  const m = new Map<string, TreeNode<RadialNodeData>>()
  const walk = (n: TreeNode<RadialNodeData>): void => {
    m.set(n.id, n)
    n.children.forEach(walk)
  }
  walk(root)
  return m
}

/**
 * Build the spanning tree rooted at `seedPath` (the seed is always a plain file node, no block id).
 */
export function neighborhoodToTree(result: WireNeighborhoodResult, seedPath: string): NeighborhoodTree {
  const duplicates = new Set<string>()
  const byId = indexNodes(result)

  const rootNode = byId.get(seedPath)
  if (!rootNode) return { tree: null, duplicates }

  const neighbors = buildAdjacency(result, byId)
  const root = makeNode(seedPath, rootNode, 'root')
  const treeById = new Map<string, TreeNode<RadialNodeData>>([[seedPath, root]])
  const maxDepth = result.nodes.reduce((m, n) => Math.max(m, n.depth), 0)

  expand(byId, neighbors, treeById, [seedPath], duplicates, maxDepth, 0)
  duplicates.delete(seedPath)

  return { tree: root, duplicates }
}

export interface MergeResult {
  /** A NEW tree object (clone + additions); the input tree is left untouched. */
  tree: TreeNode<RadialNodeData>
  /** Ids of the nodes this merge added. Empty means the fetch revealed nothing new. */
  added: string[]
  duplicates: Set<string>
}

/**
 * Union a neighborhood fetched around `centerId` into an existing tree, MONOTONICALLY.
 *
 * The contract that makes progressive expansion safe:
 * - nothing is removed and nothing is re-parented — an existing node keeps its first-assigned parent,
 *   so its canonical layout is unchanged;
 * - new nodes attach at the frontier, in a deterministic (id-sorted, level-by-level) order;
 * - the returned tree is a clone, so React sees a new identity while ids and child order are preserved.
 *
 * `centerId` must already be in the tree (it is the settled focus). If it is not, or the fetch does not
 * contain it, the tree comes back unchanged with no additions.
 */
export function mergeNeighborhood(
  existing: TreeNode<RadialNodeData>,
  result: WireNeighborhoodResult,
  centerId: string,
): MergeResult {
  const duplicates = new Set<string>()
  const tree = cloneTree(existing)
  const treeById = indexTree(tree)
  const byId = indexNodes(result)
  if (!treeById.has(centerId) || !byId.has(centerId)) return { tree, added: [], duplicates }

  const neighbors = buildAdjacency(result, byId)
  const maxDepth = result.nodes.reduce((m, n) => Math.max(m, n.depth), 0)
  const added = expand(byId, neighbors, treeById, [centerId], duplicates, maxDepth, 0)

  return { tree, added, duplicates }
}
