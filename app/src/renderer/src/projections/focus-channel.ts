// The host-side focus channel: the implementation behind `host.focus`.
//
// The STATE sibling of the selection channel and the COMMAND (intent) channel. It
// tracks the ACTIVE pane per scope — the most-recently-focused node — and RETAINS it
// when focus moves elsewhere (e.g. into the file tree). It is what lets a fired intent
// route to the active editor group without the firer naming it: `IntentTree.setFocusRanker`
// resolves through `rankByFocus` here (the ordered most-recently-focused walk of the
// responder-chain AMBIENT dispatch).
//
//
// Recency is keyed by the STABLE `^:` pool node id, NOT the ephemeral per-mount publisher.
// A container REMOUNT (same `^:`, new publisher) therefore keeps its recency position, and an
// entry is removed only when its RECORD is REAPED (the `^:` genuinely leaves the pool), never on
// a publisher teardown that is a remount. The runtime bridges publisher <-> node id at the edges:
// reports and dispatch candidates arrive as publishers; this channel speaks node ids.
//
// Two report paths feed the one recency: `reportNode` (the per-window DOM-focus tracker resolves a
// pane `^:` directly) and `reportPublisher` (the `initial-focus` cold-load seed / legacy container
// report, which arrive as publishers and resolve to a node id). Recency is never cleared on blur —
// that is the "retained across focus moves" guarantee.
//
// This tree is WINDOW-AGNOSTIC: it holds the ONE aggregate recency across every window (the router's
// focus-MRU). The PER-WINDOW active-pane head that drives each window's ring is derived by the AUTHORITY
// as this aggregate FILTERED to a window's nodes, gated by that window's OS-focus. So the ring
// signal lives in the authority's `focus`-channel wiring, not here.


import { event, on, type PublisherId } from '@arsumbris/au-host-sdk'

import type { FocusChannel } from './host-config'

/** A stable pool `^:` node id. Distinct from the ephemeral per-mount `PublisherId`. */
type NodeId = string

export class FocusTree {
  // Focus reports as STABLE `^:` node ids, most-recently-focused first. Never cleared on blur
  // (retained); an entry is removed only at the record reap (`dropNode`).
  private recency: NodeId[] = []

  constructor(
    // The POOL parent of a node id (child `^:` -> parent `^:`), or null at a pool root. The node-id
    // walk `rankByFocus` ascends to find a candidate ancestor.
    private readonly parentOfNode: (nodeId: NodeId) => NodeId | null,
    // A publisher's CURRENT `^:` (null for a synthetic / id-less node). The forward bridge: reports and
    // dispatch candidates arrive as publishers, recency speaks node ids.
    private readonly toNodeId: (publisher: PublisherId) => NodeId | null,
    // Fired whenever the recency ARRAY changes (a report that moves the head, or any real drop). The
    // authority uses it to re-mirror the focus-scoped active-chord set to floated windows AND to recompute
    // every window's scoped active-pane head (the ring). Fired on ANY mutation, not only a head change,
    // because a non-head drop can still change another window's scoped head.
    private readonly onChange?: () => void,
  ) {}

  /** The focus surface bound to one view's node. Reports the container's ACTIVE VIEW (a focused child),
   *  or the container itself when none is given. Both arrive as publishers and resolve to a node id. The
   *  window-scoped `activePane` / `watchActive` (the ring) are composed by the AUTHORITY, not here. */
  forNode(node: PublisherId): FocusChannel {
    return {
      report: (activeView) => this.reportPublisher((activeView as PublisherId | undefined) ?? node),
    }
  }

  /** Report a publisher's focus (the `initial-focus` seed / legacy container-report path); resolves the
   *  publisher to its current node id. A publisher with no node id (synthetic / id-less) is ignored. */
  private reportPublisher(publisher: PublisherId): void {
    const nodeId = this.toNodeId(publisher)
    if (nodeId == null) return
    this.reportNode(nodeId)
  }

  /** Report a node id directly — the per-window DOM-focus tracker's path (it resolves a focused pane's
   *  `^:` straight from the DOM). The single authoritative feeder in the steady state. */
  reportNode(nodeId: NodeId): void {
    const changed = this.recency[0] !== nodeId
    this.recency = [nodeId, ...this.recency.filter((x) => x !== nodeId)]
    if (changed) {
      // The active pane changed — a runtime decision worth a trace (the event-substrate policy). Gated, so
      // an off category allocates nothing.
      if (on('focus')) event('focus', 'active', { node: nodeId })
      this.onChange?.() // the authority re-derives every window's scoped head (the ring) + re-mirrors chords
    }
  }

  /** The whole aggregate recency, most-recently-focused first. The authority filters it per window to
   *  derive each window's scoped active-pane head (`activePaneForWindow`). */
  recencyList(): readonly NodeId[] {
    return this.recency
  }

  /** The most-recently-focused NODE ID across ALL windows (the aggregate head), or null. The transient
   *  close-view fallback reads this (the retained head when focus sits in chrome). NOT the ring driver —
   *  the ring is the per-window scoped head the authority derives. */
  activeNodeId(): NodeId | null {
    return this.recency[0] ?? null
  }

  /**
   * RANK `candidates` most-recently-focused first — the active pane is the head. A candidate ranks by the
   * recency of the focus it holds or ENCLOSES (walking node-id ancestors). Candidates that never
   * held/enclosed focus are appended LAST in their given order (so the caller's own tie-break — e.g. tree
   * proximity — is preserved for the unfocused tail). Drives the responder-chain AMBIENT walk.

   *
   * Candidates arrive as publishers; each maps to its current node id, ranks over the node-id recency, and
   * returns as a publisher. A candidate with no node id (a synthetic host node) never matches recency, so
   * it lands in the unfocused tail — the same place it sits today, since it never reports focus.
   *
   * Ranks EVERY candidate: there is no exclusion list. A candidate that does not want this intent DECLINES
   * at its own handler. Retention is emergent from this capability-filtered ranking.
   */
  rankByFocus(candidates: PublisherId[]): PublisherId[] {
    const publisherOfNode = new Map<NodeId, PublisherId>()
    for (const c of candidates) {
      const n = this.toNodeId(c)
      if (n != null && !publisherOfNode.has(n)) publisherOfNode.set(n, c)
    }
    const ranked: PublisherId[] = []
    const seen = new Set<NodeId>()
    for (const focused of this.recency) {
      // The candidate whose node id IS this focus, or the nearest ancestor node id that is a candidate.
      let cur: NodeId | null = focused
      while (cur != null) {
        if (publisherOfNode.has(cur) && !seen.has(cur)) {
          ranked.push(publisherOfNode.get(cur)!)
          seen.add(cur)
          break
        }
        cur = this.parentOfNode(cur)
      }
    }
    // Never-focused candidates keep the caller's order (their tie-break) after the focused ones.
    for (const c of candidates) {
      const n = this.toNodeId(c)
      if (n == null || !seen.has(n)) ranked.push(c)
    }
    return ranked
  }

  /** A record was REAPED (its `^:` left the pool): drop it from the recency. Keyed by node id — a publisher
   *  teardown that is a REMOUNT leaves the entry intact, so the active pane survives a re-render. Fires
   *  `onChange` on ANY real removal (not only the aggregate head): reaping a non-head node can still change
   *  another window's scoped active-pane head, so the authority must re-derive the ring. */
  dropNode(nodeId: NodeId): void {
    const had = this.recency.includes(nodeId)
    if (!had) return
    this.recency = this.recency.filter((x) => x !== nodeId)
    this.onChange?.()
  }
}
