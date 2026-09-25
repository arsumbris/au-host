/**
 * RE-SEED a container's model from its AUTHORITATIVE pool record when the SUBSTRATE changed that record
 * without going through the container's own commit: a drag re-parent, a `closePane`, a `wrapPane`, or a
 * container's own structural `propose`. Those write the pool record directly (`applyStructural`), so a
 * container's local model, and the anchors it renders, go stale until it re-reads.
 *
 * Framework-agnostic: a vanilla container calls it directly, and container-kit's `useContainerModel`
 * binds it for React. Every container that keeps a model over its pool record needs it.
 *
 * On each pool change it re-reads `resolveRecord(host.instanceId)`, rebuilds the model with the container's
 * own `fromConfig`, and re-seeds ONLY when that diverges from the current model. The re-seed is a model
 * advance, never a save, so there is no loop. Pool changes are coalesced (one per gesture), so a
 * multi-step drop re-seeds once, to its final state.
 */

import type { MountHost } from '@arsumbris/au-host-sdk';
import { event, on } from '@arsumbris/au-host-sdk';
import { assertDeterministicRead } from './model-cell.ts';

/** A cheap structural equality for the re-seed gate. Models are plain data (records / lists), so JSON is
 *  total here, and `fromConfig` is deterministic, so an unchanged record round-trips equal. */
export function sameModel<T>(a: T, b: T): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export interface RecordResync<T> {
  host: MountHost;
  /** Rebuild the model from a raw pool record (the container's own `fromConfig`). */
  fromConfig: (raw: unknown) => T;
  /**
   * The container's SAVE serializer, OPTIONAL. When given, the re-seed gate compares in CONFIG space
   * (`toConfig(current)` vs `toConfig(fromPool)`), so RUNTIME-ONLY state the serializer strips (tabs'
   * preview) never counts as a divergence and is not re-seeded away. Without it, model space.
   */
  toConfig?: (model: T) => unknown;
  /** The container's current model. */
  current: () => T;
  /** Advance the model to `next` and re-render. Never saves. */
  reseed: (next: T) => void;
}

/** Keep a container's model tracking its pool record. Returns the unsubscribe; a no-op without a pool. */
export function watchOwnRecord<T>(r: RecordResync<T>): () => void {
  const subscribe = r.host.children.pool?.subscribe;
  if (!subscribe) return () => {};
  const subject = (r.host.config as { type?: string } | undefined)?.type ?? 'container';
  // THE ROUND-TRIP GUARD runs ONCE (a container's read determinism does not change). It asserts the
  // RE-SEED READ — the EXACT predicate the gate compares, `toConfig ∘ fromConfig` when a serializer is
  // given, else `fromConfig` — is deterministic: the resync churns iff two reads of the SAME record differ
  // THROUGH the gate. `fromConfig` alone would false-positive a container whose `fromConfig` mints a
  // runtime position id that its `toConfig` strips. Not dev-gated: projections load a production bundle.
  let guarded = false;
  return subscribe(() => {
    const id = r.host.instanceId;
    if (!id) return;
    const raw = r.host.children.pool?.resolveRecord(id);
    if (raw === undefined) return; // transiently unresolvable — leave the model; the next event resyncs.
    if (!guarded) {
      guarded = true;
      const gateRead = r.toConfig ? (x: unknown) => r.toConfig!(r.fromConfig(x)) : r.fromConfig;
      assertDeterministicRead(subject, raw, gateRead);
    }
    const fresh = r.fromConfig(raw);
    const diverged = r.toConfig ? !sameModel(r.toConfig(r.current()), r.toConfig(fresh)) : !sameModel(fresh, r.current());
    if (!diverged) return;
    // Traced under the ambient cause, so a moved-in / moved-out pane reads under the drag's own pass.
    if (on('resync')) event('resync', 're-seed', { subject, id });
    r.reseed(fresh);
  });
}
