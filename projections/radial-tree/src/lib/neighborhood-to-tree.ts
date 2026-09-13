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
 * Framework-free. Imports only the SDK's neighborhood wire types.
 */
import type {
  WireNeighborhoodResult,
  WireNeighborhoodNode,
  WireNeighborhoodNodeRef,
  WireParseKind,
  WireNeighborhoodKind,
} from '@arsumbris/au-host-sdk/engine-reads'
import type { TreeNode } from './tree'

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

/**
 * Build the spanning tree rooted at `seedPath` (the seed is always a plain file node, no block id).
 */
export function neighborhoodToTree(result: WireNeighborhoodResult, seedPath: string): NeighborhoodTree {
  const duplicates = new Set<string>()
  const byId = new Map<string, WireNeighborhoodNode>()
  for (const n of result.nodes) byId.set(nodeId(n), n)

  const rootId = seedPath
  const rootNode = byId.get(rootId)
  if (!rootNode) return { tree: null, duplicates }

  // Undirected adjacency with the orientation recorded per side.
  // Edge from=A to=B means A references B: B is `out` of A, A is `in` of B.
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

  const make = (
    id: string,
    node: WireNeighborhoodNode,
    direction: RadialNodeData['direction'],
    edgeKind?: WireNeighborhoodKind,
  ): TreeNode<RadialNodeData> => ({
    id,
    label: basename(node.path) + (node.block_id ? `^${node.block_id}` : ''),
    children: [],
    data: { path: node.path, blockId: node.block_id, fileKind: node.file_kind, direction, edgeKind },
  })

  const root = make(rootId, rootNode, 'root')
  const treeById = new Map<string, TreeNode<RadialNodeData>>([[rootId, root]])
  const visited = new Set<string>([rootId])

  const maxDepth = result.nodes.reduce((m, n) => Math.max(m, n.depth), 0)
  let frontier = [rootId]
  for (let d = 0; d < maxDepth; d++) {
    frontier.sort()
    const next: string[] = []
    for (const pid of frontier) {
      const parentTree = treeById.get(pid)!
      const adj = (neighbors.get(pid) ?? [])
        .filter((e) => (byId.get(e.id)?.depth ?? -1) === d + 1)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      for (const e of adj) {
        if (visited.has(e.id)) {
          duplicates.add(e.id) // reachable from an earlier parent too
          continue
        }
        visited.add(e.id)
        const child = make(e.id, byId.get(e.id)!, e.direction, e.kind)
        parentTree.children.push(child)
        treeById.set(e.id, child)
        next.push(e.id)
      }
    }
    frontier = next
  }

  return { tree: root, duplicates }
}
