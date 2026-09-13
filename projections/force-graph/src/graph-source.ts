// Shared whole-workspace graph source over the engine's link_graph and type_graph
// subscriptions. Each channel supplies an initial snapshot followed by deltas.
// Views share the source by entry path and maintain their own scope value.



import type { MountHost } from '@arsumbris/au-host-sdk'
import type {
  WireParseKind,
  WireReferenceInKind,
  WireGraphNode,
  WireGraphEdge,
  WireTypeGraphNode,
  WireTypeGraphEdge,
  WireTypeGraphRelation,
} from '@arsumbris/au-host-sdk/engine-reads'
import { subscribeLinkGraph, subscribeTypeGraph, type LinkGraphHint, type TypeGraphHint } from '@arsumbris/au-host-sdk/engine-reads'
import type { ForceGraph } from './generated'

// --- seam types -------------------------------------------------------------------

/** A graph node: a vault file today (id = its path), any typed entity later. */
export interface GraphNode {
  id: string // absolute file path — the node identity and the open-intent target
  label?: string
  kind?: WireParseKind
  repo?: string | null
  degree: number // undirected degree; drives node sizing (sizeBy:'degree' is enabled by default)
}

/** A resolved edge, from either merged graph. `kind` is the coarse edge kind for colouring: a
 *  `link_graph` reference kind (field / contributing / navigational) or a `type_graph` relation
 *  (subtype / field-type / instance-of). */
export interface GraphEdge {
  source: string
  target: string
  kind?: WireReferenceInKind | WireTypeGraphRelation
}

export interface GraphSnapshot {
  nodes: GraphNode[]
  edges: GraphEdge[] // may be empty until the first load completes
}

export interface GraphDelta {
  nodesAdded?: GraphNode[]
  nodesRemoved?: string[]
  edgesAdded?: GraphEdge[]
  edgesRemoved?: GraphEdge[]
}

/** Filter half of `base ∘ filter`. The config value is carried by the scope,
 * but the current view does not apply it to the global snapshot. */
export type GraphQuery = unknown

/** The base half of a scope: the universal graph, a local neighbourhood, or a saved view. */
export type ScopeBase =
  | { kind: 'global' }
  | { kind: 'local'; anchors: string[]; depth: number; direction: 'in' | 'out' | 'both' }
  | { kind: 'saved'; savedRef: string }

/** `base ∘ filter` — every view is ONE narrowing mechanism, not a flat union. */
export interface SubgraphScope {
  base: ScopeBase
  filter?: GraphQuery
}

/** ONE per entry (key = host.entry.path) — shares the graph across panes. */
export interface GraphSource {
  open(scope: SubgraphScope): GraphView
  dispose(): void
}

export interface GraphView {
  snapshot(): GraphSnapshot // nodes+edges (may be empty until first load)
  subscribe(onDelta: (d: GraphDelta) => void): () => void // incremental adds/removes
  setScope(next: SubgraphScope): void // depth moved / selection changed / filter edited
  close(): void
}

/** Derive a scope from the saved view config. All supported scope values currently
 * use the global base. The filter value is retained but not applied by this view. */
export function configToScope(cfg?: ForceGraph): SubgraphScope {
  const filter = cfg?.query
  switch (cfg?.scope) {
    case 'local':
      // Local scope currently displays the global base; anchors and depth are not applied.
      return { base: { kind: 'global' }, filter }
    case 'saved':
      // Saved scope currently displays the global base; savedRef is not resolved here.
      return { base: { kind: 'global' }, filter }
    case 'global':
    case undefined:
      return { base: { kind: 'global' }, filter }
    default:
      // `scope` is a SEALED enum now, so a non-vocabulary value cannot type — this arm is
      // defense-in-depth, not the config's error surface.
      console.warn(`[force-graph] unknown scope ${JSON.stringify(cfg?.scope)} — falling back to the global graph`)
      return { base: { kind: 'global' }, filter }
  }
}

// --- EngineGraphSource (merges the reference graph `link_graph` and the schema graph `type_graph`) --

function toNode(n: WireGraphNode): GraphNode {
  // `label` stays derived by the render (from the path); `kind`/`repo` carry for colour rules.
  return { id: n.path, kind: n.kind, repo: n.repo, degree: 0 }
}

function toEdge(e: WireGraphEdge): GraphEdge {
  // `kind` carries for edge colouring (edgeColorBy:'kind'); source/target drive the layout.
  return { source: e.from, target: e.to, kind: e.kind }
}

function toTypeNode(n: WireTypeGraphNode): GraphNode {
  // type nodes carry the same `path` identity, so they MERGE with link_graph nodes by path; `kind`
  // ('type-def' | 'instance') is a subset of WireParseKind, so it colours via the same KIND_COLORS.
  return { id: n.path, kind: n.kind, repo: n.repo, degree: 0 }
}

function toTypeEdge(e: WireTypeGraphEdge): GraphEdge {
  // the relation (subtype / field-type / instance-of) is the edge's `kind` for colouring.
  return { source: e.from, target: e.to, kind: e.relation }
}

/** type_graph edges are unique per (from, to, relation) and UPSERT — this composes their store key. */
function typeEdgeKey(from: string, to: string, relation: WireTypeGraphRelation): string {
  return `${from}\0${to}\0${relation}`
}

/**
 * `GraphSource` over BOTH engine whole-graph channels, drawn together and merged by `path`:
 * - `link_graph` — the reference (wikilink) graph. Its edge delta is a MULTISET (append on add, drop
 *   ONE matching on remove), so preserved multiplicity carries.
 * - `type_graph` — the schema graph (subtype / field-type / instance-of edges). Its edge delta UPSERTs
 *   per `(from, to, relation)`: a `count` change re-emits in `edges_added` ONLY, so the store is keyed
 *   and REPLACED, never appended. (schema 23)
 *
 * The two are held in SEPARATE stores because their delta semantics differ, then unioned in
 * `rebuildMerged()`: nodes merge by path (a type-def file is one node in both graphs), edges are the
 * union, and degree is recomputed over the merged edge set so a node's size reflects total connectivity
 * across references AND type relations. The initial value of each subscription is the whole graph; then
 * deltas apply in place — never re-reading (the payloads are large; that is the point of the channels).
 *
 * The current view draws the whole workspace without client narrowing.
 */
export class EngineGraphSource implements GraphSource {
  // link_graph stores — multiset edges.
  private readonly linkNodes = new Map<string, GraphNode>()
  private linkEdges: GraphEdge[] = []
  // type_graph stores — edges keyed by (from,to,relation) for UPSERT.
  private readonly typeNodes = new Map<string, GraphNode>()
  private readonly typeEdges = new Map<string, GraphEdge>()
  // the merged view the render reads.
  private readonly merged = new Map<string, GraphNode>()
  private mergedEdges: GraphEdge[] = []

  private readonly views = new Set<EngineGraphView>()
  private offLink: (() => void) | null = null
  private offType: (() => void) | null = null
  private offReady: (() => void) | null = null
  private disposed = false

  constructor(
    private readonly engine: MountHost['engine'],
    private readonly engineReady?: MountHost['engineReady'],
  ) {
    this.connect()
    // Recover when the daemon becomes reachable (a mount-time subscribe may have found no daemon).
    this.offReady = this.engineReady?.subscribe((ready) => {
      if (ready && !this.disposed) this.connect()
    }) ?? null
  }

  open(scope: SubgraphScope): GraphView {
    const view = new EngineGraphView(this, scope)
    this.views.add(view)
    return view
  }

  dispose(): void {
    this.disposed = true
    this.offLink?.()
    this.offType?.()
    this.offReady?.()
    this.offLink = this.offType = this.offReady = null
    for (const v of this.views) v.detach()
    this.views.clear()
  }

  /** The current global merged snapshot. */
  snapshot(): GraphSnapshot {
    return { nodes: [...this.merged.values()], edges: this.mergedEdges }
  }

  removeView(view: EngineGraphView): void {
    this.views.delete(view)
  }

  private notify(): void {
    for (const v of this.views) v.emit()
  }

  private connect(): void {
    this.offLink?.()
    this.offLink = subscribeLinkGraph(
      this.engine,
      (event) => {
        if (this.disposed) return
        if (event.kind === 'initial-value') this.rebuildLink(event.result.nodes, event.result.edges)
        else if (event.kind === 'change') this.applyLinkDelta(event.scopeHint)
      },
      { scope: 'all' },
    )
    this.offType?.()
    this.offType = subscribeTypeGraph(
      this.engine,
      (event) => {
        if (this.disposed) return
        if (event.kind === 'initial-value') this.rebuildType(event.result.nodes, event.result.edges)
        else if (event.kind === 'change') this.applyTypeDelta(event.scopeHint)
      },
      // the type relations to draw beside the references: subtype + instance-of;
      // field-type carries the schema backbone. `meta` is left out.
      { scope: 'all', edges: ['subtype', 'field-type', 'instance-of'] },
    )
  }

  private rebuildLink(nodes: WireGraphNode[], edges: WireGraphEdge[]): void {
    this.linkNodes.clear()
    for (const n of nodes) this.linkNodes.set(n.path, toNode(n))
    this.linkEdges = edges.map(toEdge)
    this.rebuildMerged()
  }

  private applyLinkDelta(hint: LinkGraphHint): void {
    for (const n of hint.nodes_added) this.linkNodes.set(n.path, toNode(n)) // a node re-emits on any record change
    for (const path of hint.nodes_removed) this.linkNodes.delete(path)
    for (const e of hint.edges_added) this.linkEdges.push(toEdge(e))
    for (const e of hint.edges_removed) {
      // Multiset removal: drop ONE matching instance per removed record, so preserved multiplicity carries.
      const i = this.linkEdges.findIndex((x) => x.source === e.from && x.target === e.to)
      if (i >= 0) this.linkEdges.splice(i, 1)
    }
    this.rebuildMerged()
  }

  private rebuildType(nodes: WireTypeGraphNode[], edges: WireTypeGraphEdge[]): void {
    this.typeNodes.clear()
    for (const n of nodes) this.typeNodes.set(n.path, toTypeNode(n))
    this.typeEdges.clear()
    for (const e of edges) this.typeEdges.set(typeEdgeKey(e.from, e.to, e.relation), toTypeEdge(e))
    this.rebuildMerged()
  }

  private applyTypeDelta(hint: TypeGraphHint): void {
    for (const n of hint.nodes_added) this.typeNodes.set(n.path, toTypeNode(n))
    for (const path of hint.nodes_removed) this.typeNodes.delete(path)
    // UPSERT by (from,to,relation): a `count` change re-emits in edges_added ONLY, so REPLACE, never append.
    for (const e of hint.edges_added) this.typeEdges.set(typeEdgeKey(e.from, e.to, e.relation), toTypeEdge(e))
    for (const e of hint.edges_removed) this.typeEdges.delete(typeEdgeKey(e.from, e.to, e.relation))
    this.rebuildMerged()
  }

  /** Union the two graphs by path, then recompute undirected degree over the MERGED edge set (drives
   *  sizeBy:'degree'). Called after every delta from either channel. O(nodes + edges), cheap against
   *  the render's own re-snapshot. */
  private rebuildMerged(): void {
    this.merged.clear()
    for (const [p, n] of this.linkNodes) this.merged.set(p, { ...n })
    for (const [p, n] of this.typeNodes) {
      const ex = this.merged.get(p)
      if (ex) {
        // Same file in both graphs — the kinds agree (a.type.yaml is 'type-def' in both). Keep the
        // type kind for type-ness; fill repo if the link node lacked it.
        ex.kind = n.kind ?? ex.kind
        if (ex.repo == null) ex.repo = n.repo
      } else {
        this.merged.set(p, { ...n })
      }
    }
    this.mergedEdges = [...this.linkEdges, ...this.typeEdges.values()]
    for (const n of this.merged.values()) n.degree = 0
    for (const e of this.mergedEdges) {
      const s = this.merged.get(e.source)
      const t = this.merged.get(e.target)
      if (s) s.degree++
      if (t) t.degree++
    }
    this.notify()
  }
}

/** A view over EngineGraphSource. It stores its scope, but currently exposes
 * the source's global merged snapshot without narrowing. */
class EngineGraphView implements GraphView {
  private readonly listeners = new Set<(d: GraphDelta) => void>()
  private attached = true

  constructor(
    private readonly source: EngineGraphSource,
    private scope: SubgraphScope,
  ) {}

  snapshot(): GraphSnapshot {
    const global = this.source.snapshot()
    // Every scope currently resolves to the full graph; no client narrowing is applied.
    if (this.scope.base.kind === 'global' && !this.scope.filter) return global
    return global
  }

  subscribe(onDelta: (d: GraphDelta) => void): () => void {
    this.listeners.add(onDelta)
    return () => this.listeners.delete(onDelta)
  }

  setScope(next: SubgraphScope): void {
    // Retain the requested scope even though this view currently displays the global graph.
    this.scope = next
  }

  close(): void {
    this.listeners.clear()
    this.source.removeView(this)
    this.attached = false
  }

  emit(): void {
    // The render re-reads snapshot() on any signal (no engine round-trip); the delta object is unused.
    if (!this.attached) return
    for (const l of this.listeners) l({})
  }

  detach(): void {
    this.attached = false
    this.listeners.clear()
  }
}
