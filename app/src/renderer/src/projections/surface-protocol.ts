// The mount / proxy command protocol — the renderer-side seam.
//
// The message types (SurfaceCommand / SurfaceEvent / SlotDescriptor) live in the shared IPC types
// (`app/src/shared/daemon-api.ts`) because they cross the main↔renderer boundary. This file owns the
// two RENDERER-side pieces both endpoints share: the transport SEAM the authority drives a surface
// through, and the generation guard a surface applies to drop stale commands.
//
// ONE model, two transports: an in-process transport for surface 0 resolves to local
// calls; an IPC transport for a secondary surface crosses the process boundary. Both satisfy
// `SurfaceTransport`, so the authority's drive code (composition.ts) and the mount agent (mount-agent.ts,
// booted by surface.tsx) never branch on which window they are in — only the transport differs.

import type { SurfaceCommand, SurfaceEvent } from '../../../shared/daemon-api'

/**
 * The seam the authority drives a surface through, and receives the surface's events back on. Bound to
 * ONE surface (the transport knows which window; the commands are per-record). An in-process transport
 * (surface 0) calls the local mount agent directly; an IPC transport (a secondary window) sends over
 * `window.main`'s surface channel. Identical `SurfaceCommand` / `SurfaceEvent` types both ways.
 */
export interface SurfaceTransport {
  /** Drive a command onto the surface (authority → surface). */
  sendCommand(command: SurfaceCommand): void
  /** Subscribe to the surface's reported events (surface → authority). Returns an unsubscribe. */
  onEvent(listener: (event: SurfaceEvent) => void): () => void
  /** Tear the transport down (the surface closed). Idempotent. */
  dispose(): void
}

/**
 * The surface-side generation guard: max-gen-wins, per record.
 *
 * A surface applies a command IFF its generation is at least the last generation already applied for
 * that record; a command whose generation is BELOW the last applied is stale and dropped. Because the
 * authority advances a record's generation on every `mount` / `remount` / `unmount`, this:
 * - makes a fast float (mount → unmount → mount) correct under reordering: a late `unmount(gen=2)`
 *   arriving after `mount(gen=3)` is dropped, so the record stays mounted at its newest generation.
 * - drops an in-flight command to a record the surface has already advanced past (a closing surface's
 *   late delivery, a reconnect replay).
 *
 * A `reflect` rides the record's CURRENT generation, so it applies while that generation is live and is
 * dropped once a later `remount` advances past it (reflecting onto a torn-down instance is a no-op).
 *
 * The applied generation is KEPT after an `unmount` (not cleared): a stale re-mount at a lower
 * generation must stay dropped, and a legitimate re-mount (a float back to this surface) arrives at a
 * higher generation and is admitted by the same rule. The map therefore grows with DISTINCT record ids
 * ever seen — bounded, since ids are monotonic and never reused.
 */
export class GenerationGuard {
  private readonly appliedGen = new Map<string, number>()

  /** Whether `command` should be applied. Records its generation as the new high-water mark when so. Only
   *  the per-record LIFECYCLE commands are generation-guarded; `pool-sync` / `grant` / `claim` / `commit` /
   *  `selection-deliver` / `windows-changed` / `confirm-close` / `gather-close-guard` / `active-chords` /
   *  `active-pane` / `close-pane` (pool state, id grants, the gather-then-commit dispatch queries, the
   *  cross-window selection channel, the window-set list, the close prompt, the close-guard gather, the
   *  mirrored bound-chord set, the active-pane ring, and the delegated pane close — none a record lifecycle)
   *  are handled by the agent before the guard and never reach here. */
  admit(command: Exclude<SurfaceCommand, { op: 'pool-sync' | 'grant' | 'claim' | 'commit' | 'selection-deliver' | 'windows-changed' | 'confirm-close' | 'gather-close-guard' | 'active-chords' | 'active-pane' | 'close-pane' }>): boolean {
    const last = this.appliedGen.get(command.id)
    if (last !== undefined && command.gen < last) return false // stale — dropped
    this.appliedGen.set(command.id, command.gen)
    return true
  }

  /** The last generation applied for a record, or undefined if none. For diagnostics / tests. */
  applied(id: string): number | undefined {
    return this.appliedGen.get(id)
  }
}

/**
 * The authority distinguishes three remote commit outcomes.
 * `acted`: the handler completed and dispatch is done.
 * `declined`: the handler did not act and left no effects, so another claimer may receive the intent.
 * `timeout`: no reply arrived and completion is unknown. Do not retry elsewhere, since a slow handler
 * could still act and cause a duplicate operation; surface the missed acknowledgement instead.
 */
export type CommitOutcome = 'acted' | 'declined' | 'timeout'

/**
 * Correlates an authority→surface query (`claim` / `commit`) with its surface→authority reply, the
 * gather-then-commit remote-candidate primitive the parallel gather awaits.
 *
 * Transport-agnostic (it takes a `send` callback, so it is pure and probe-testable): `deliver` allocates a
 * correlation id, hands it to `send`, and returns a promise that resolves when `settle(cid, value)` is
 * called with that id — or `timeoutValue` after `timeoutMs`, so a HUNG or CLOSED surface never stalls the
 * gather. Queries are independent: overlapping ones each resolve once with their own value, and a `settle`
 * for an unknown or already-settled cid is a no-op. `settleAll` resolves every outstanding delivery at once
 * (a surface closed, or the runtime disposed).
 *
 * Generic over the reply type so ONE mechanism serves both the CLAIM path (`Correlator<boolean>`, timeout =
 * `false` = decline) and the COMMIT path (`Correlator<CommitOutcome>`, timeout = `'timeout'`, kept DISTINCT
 * from a `'declined'` reply — that distinction is the whole point: a timeout must not re-home).
 */
export class Correlator<T> {
  private seq = 0
  private readonly pending = new Map<number, { resolve: (value: T) => void; timer: ReturnType<typeof setTimeout> }>()

  constructor(private readonly timeoutValue: T) {}

  /** Allocate a cid, `send` it, and await the correlated reply (or `timeoutValue` after the timeout). */
  deliver(send: (cid: number) => void, timeoutMs: number): Promise<T> {
    const cid = ++this.seq
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => this.settle(cid, this.timeoutValue), timeoutMs)
      this.pending.set(cid, { resolve, timer })
      send(cid)
    })
  }

  /** Resolve the delivery correlated by `cid` with the surface's reply. Unknown/settled cid → no-op. */
  settle(cid: number, value: T): void {
    const p = this.pending.get(cid)
    if (!p) return
    this.pending.delete(cid)
    clearTimeout(p.timer)
    p.resolve(value)
  }

  /** Resolve every outstanding delivery at once (a surface closed, or the runtime disposed). Defaults to the
   *  timeout value; a caller passes an explicit value when a close means something sharper (a surface that
   *  went away definitively DECLINED, so its commit acks resolve `'declined'` and re-home to a live window). */
  settleAll(value: T = this.timeoutValue): void {
    for (const cid of [...this.pending.keys()]) this.settle(cid, value)
  }
}
