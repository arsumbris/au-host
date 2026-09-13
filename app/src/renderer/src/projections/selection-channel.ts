// The host-side selection channel: the implementation behind `host.selection`.
//
// Payload-OPAQUE by design. The host carries `unknown` and never reads a
// selection value — the selection/range vocabulary lives in first-party packages
// (`@arsumbris/selection`), and only projections interpret it.
//
//
// One tree per runtime (per entry), keyed by the STABLE `^:` pool node id — NOT the ephemeral
// per-mount publisher. A view publishes its OWN selection; it bubbles up the mount tree; a consumer
// follows its ENCLOSING container's (parent's) selection. Keying by `^:` is what keeps a follower
// attached across a container REMOUNT: the parent's publisher changes, but its `^:` does not, so the
// registration on the parent survives. The runtime
// bridges publisher -> node id at the edges (publish / follow arrive as publishers). Bubbling is
// last-writer-wins within a subtree. A view is never echoed its own selection.

import type { PublisherId } from '@arsumbris/au-host-sdk'

import type { SelectionChannel } from './host-config'

/** A stable pool `^:` node id. Distinct from the ephemeral per-mount `PublisherId`. */
type NodeId = string

type Listener = (value: unknown) => void

interface Aggregate {
  value: unknown
  from: NodeId
}

interface Follower {
  owner: NodeId
  listener: Listener
}

export class SelectionTree {
  // node id -> the latest selection anywhere in its subtree (last-writer-wins).
  private readonly subtree = new Map<NodeId, Aggregate>()
  // container node id -> the children following it as their enclosing container.
  private readonly followers = new Map<NodeId, Set<Follower>>()

  constructor(
    // The POOL parent of a node id (child `^:` -> parent `^:`), or null at a pool root.
    private readonly parentOfNode: (nodeId: NodeId) => NodeId | null,
    // A publisher's CURRENT `^:` (null for a synthetic / id-less node). publish / follow arrive as
    // publishers and resolve to a node id.
    private readonly toNodeId: (publisher: PublisherId) => NodeId | null,
  ) {}

  /** The selection surface bound to one view's node. */
  forNode(node: PublisherId): SelectionChannel {
    return {
      publish: (value) => this.publish(node, value),
      follow: (onValue) => this.follow(node, onValue),
    }
  }

  private publish(node: PublisherId, value: unknown): void {
    const nodeId = this.toNodeId(node)
    if (nodeId == null) return
    // Bubble: this node id and every ancestor reflect {value, from: nodeId}.
    let cur: NodeId | null = nodeId
    while (cur != null) {
      this.subtree.set(cur, { value, from: nodeId })
      const subs = this.followers.get(cur)
      if (subs) {
        for (const sub of [...subs]) {
          if (sub.owner === nodeId) continue // never echo a view its own selection
          sub.listener(value)
        }
      }
      cur = this.parentOfNode(cur)
    }
  }

  private follow(node: PublisherId, listener: Listener): () => void {
    const nodeId = this.toNodeId(node)
    if (nodeId == null) return () => {}
    const parent = this.parentOfNode(nodeId)
    if (parent == null) return () => {} // the root has no enclosing container to follow.
    let subs = this.followers.get(parent)
    if (!subs) {
      subs = new Set()
      this.followers.set(parent, subs)
    }
    const follower: Follower = { owner: nodeId, listener }
    subs.add(follower)
    // Deliver the current value, unless this view is the one that published it.
    const current = this.subtree.get(parent)
    if (current && current.from !== nodeId) listener(current.value)
    return () => subs.delete(follower)
  }

  /** A record was REAPED (its `^:` left the pool): drop its aggregate and any follow it registered on its
   *  parent. Keyed by node id, and dropped at the REAP (not a publisher teardown that is a remount), so a
   *  remount keeps the follower attached. `parentNodeId` is the parent `^:` (or null at a pool root). */
  dropNode(nodeId: NodeId, parentNodeId: NodeId | null): void {
    this.subtree.delete(nodeId)
    this.followers.delete(nodeId) // its children's registrations; the cascade already tore them down.
    if (parentNodeId != null) {
      const subs = this.followers.get(parentNodeId)
      if (subs) for (const sub of [...subs]) if (sub.owner === nodeId) subs.delete(sub)
    }
  }
}
