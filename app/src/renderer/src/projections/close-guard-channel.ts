// The host-side close-guard channel: the implementation behind `host.closeGuard`.

// The projection-side participation in the host's REMOVAL LIFECYCLE. A projection REGISTERS a
// guard ("may I be closed?"); the host GATHERS the guards in a closing subtree and removes only
// on full consent. The projection owns the veto DECISION (save / discard / cancel); the host owns
// the removal.


// CONSENSUS, gathered SEQUENTIALLY. Unlike the intent channel's PURE `claim` (gathered in parallel,
// commit the first claimer), a close-guard is INTERACTIVE — it may show a dialog — so the guards
// are asked one at a time and the walk STOPS at the first refusal (never popping a second dialog
// for a close already cancelled). All must consent, or the close aborts. There is no re-home: a
// refusal ends the transaction, it does not hand the target to a sibling.

import { reportHostDiagnostic } from '@arsumbris/au-host-sdk'
import type { CloseGuard, CloseGuardChannel, PublisherId } from '@arsumbris/au-host-sdk'

export class CloseGuardTree {
  // publisher -> the guards it registered. A Set so a node may register more than one (and a
  // second registration never clobbers the first); insertion order is the ask order.
  private readonly guards = new Map<PublisherId, Set<CloseGuard>>()

  /** The close-guard surface bound to one view's node. */
  forNode(node: PublisherId): CloseGuardChannel {
    return {
      register: (guard) => this.register(node, guard),
    }
  }

  private register(node: PublisherId, guard: CloseGuard): () => void {
    let set = this.guards.get(node)
    if (!set) this.guards.set(node, (set = new Set()))
    set.add(guard)
    return () => {
      const s = this.guards.get(node)
      if (!s) return
      s.delete(guard)
      if (s.size === 0) this.guards.delete(node)
    }
  }

  /**
   * Does ANY of `publishers` hold a registered guard? A SYNCHRONOUS registry check — the fast-path gate
   * the commit core uses BEFORE deciding to suspend. The caller passes the publishers of the records an
   * edit would reap (each orphaned record maps to its own publisher); because the orphaned set already
   * includes the whole cascade, checking each orphaned record's OWN publisher covers the subtree — no
   * mount-tree walk, so no dependency on a `parentOf` map that is stale at reap time. When this is false
   * (the common case) the reap stays fully synchronous and pays only this cheap membership check.
   */
  hasGuardAmong(publishers: Iterable<PublisherId>): boolean {
    for (const p of publishers) if (this.guards.has(p)) return true
    return false
  }

  /**
   * GATHER consent from every guard registered on `publishers` — the consensus veto. Ask them one at a
   * time, in registration order, and STOP at the first refusal (short-circuit, so a cancelled close never
   * asks the rest). Returns whether ALL consented. No guard among them consents (`true`).
   *
   * A guard that THROWS fails CLOSED (counts as a refusal) and is reported: the host cannot confirm
   * consent, so the content-preserving direction is not to remove. A buggy guard blocks its own close,
   * which the diagnostic surfaces, rather than risking the loss of unsaved work.
   */
  async gatherAmong(publishers: Iterable<PublisherId>): Promise<boolean> {
    for (const owner of publishers) {
      const set = this.guards.get(owner)
      if (!set) continue
      for (const guard of set) {
        let consented: boolean
        try {
          consented = await guard()
        } catch (err) {
          reportHostDiagnostic({
            code: 'close-guard-threw',
            severity: 'warning',
            subject: owner,
            message: `a close-guard threw while deciding whether to close; treated as a refusal (the close is blocked so unsaved work is not lost): ${err instanceof Error ? err.message : String(err)}`,
            detail: { node: owner },
          })
          consented = false
        }
        if (!consented) return false // first refusal aborts; the rest are not asked.
      }
    }
    return true
  }

  /** A node unmounted: drop the guards it registered. */
  dropNode(node: PublisherId): void {
    this.guards.delete(node)
  }
}
