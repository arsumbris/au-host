/**
 * `useContainerModel` — the React binding over `container-core`'s `ModelCell`, and the paved path
 * for a container that keeps a runtime model and rebuilds its config from it.
 *
 * A container gets three things and should use all three:
 *   - `model`  — for RENDER. It is state, so rendering reflects the commit that caused it.
 *   - `live()` — for every MUTATION and every `ContainerPlacement` method. It is the last committed
 *                value, readable synchronously, which is what render-time state cannot be.
 *   - `commit` — advance the model and persist it, in that order.
 *
 * THE RULE, and the only thing to remember: a seam method reads `live()`, never `model`. One drop
 * drives the seam several times in ONE tick, so the captured `model` is stale by the second call
 * and a mutation built on it resurrects what the first one removed. See `ModelCell` for the full
 * mechanism. Each mutation must read the current model before constructing its edit.
 *
 * A container that gets it wrong anyway is caught by the substrate's detector, which needs no
 * cooperation — this hook makes the right thing easy, the detector makes the wrong thing loud.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MountHost } from '@arsumbris/au-host-sdk';
import { event, on } from '@arsumbris/au-host-sdk';
import { assertDeterministicRead, createModelCell, type ModelCell } from '@arsumbris/container-core';

export interface ContainerModel<T> {
  /** The rendered model. Use in RENDER only. */
  model: T;
  /** The LIVE model. Use in every mutation and every seam method. */
  live: () => T;
  /** Advance the model and persist it. Readable through `live()` immediately. */
  commit: (next: T) => void;
}

/**
 * How a container RE-SEEDS its model when the SUBSTRATE changed its record without going through the
 * container's own `commit` — a drag re-parent, a `closePane` from a placeholder, a `wrapPane`. These
 * write the container's pool record directly (`applyStructural`), so its local model, and thus the
 * anchors it renders, go stale. The hook re-reads `resolveRecord(host.instanceId)` on each pool change
 * and rebuilds the model with the container's own `fromConfig`. See the effect below.
 */
export interface ContainerModelResync<T> {
  host: MountHost;
  /** Rebuild the model from a raw pool record (the container's own `fromConfig`). */
  fromConfig: (raw: unknown) => T;
  /**
   * The container's SAVE serializer (its `toConfig` / `persistableConfig`), OPTIONAL. When given, the
   * re-seed gate compares in CONFIG space (`toConfig(current)` vs `toConfig(fromPool)`) instead of model
   * space, so RUNTIME-ONLY state the serializer strips (tabs' preview) never counts as a divergence and
   * is not re-seeded away. Only a genuine change to the container's OWN config re-seeds. A container with
   * no runtime-only state may omit it (model space and config space then agree).
   */
  toConfig?: (model: T) => unknown;
}

/** A cheap structural equality for the re-seed gate. Models are plain data (records / lists), so
 *  JSON is total here, and `fromConfig` is deterministic, so an unchanged record round-trips equal.
 *  Exported so a probe can drive the exact gate predicate (see probe-container-resync-churn.ts). */
export function sameModel<T>(a: T, b: T): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * `save` is called with each committed model. It is held in a ref, so a container may pass a fresh
 * closure every render without the cell being rebuilt — the cell must survive re-renders or it
 * would reset the model on each one.
 *
 * `resync` (optional) makes the model track its AUTHORITATIVE pool record on external structural edits.
 */
export function useContainerModel<T>(
  initial: T,
  save: (next: T) => void,
  resync?: ContainerModelResync<T>,
): ContainerModel<T> {
  const cellRef = useRef<ModelCell<T> | null>(null);
  if (cellRef.current === null) cellRef.current = createModelCell(initial);
  const cell = cellRef.current;

  const saveRef = useRef(save);
  saveRef.current = save;

  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  const [model, setModel] = useState<T>(() => cell.read());

  useEffect(() => cell.subscribe(setModel), [cell]);

  // RE-SEED from the pool on an EXTERNAL structural edit. Re-read this container's record and, if it
  // DIVERGES from the current model, advance the CELL ONLY (`cell.commit`, NOT the hook's `commit`) — so
  // NO save-back fires and there is no loop. Pool changes are coalesced (one per gesture), so a multi-step
  // drop re-seeds once, to the final state. A normal React re-render (anchors kept by key), never a
  // remount. A same-record round-trip (the container's OWN commit) is a no-op via the equality gate.
  useEffect(() => {
    const subscribe = resyncRef.current?.host.children.pool?.subscribe;
    if (!subscribe) return;
    // THE ROUND-TRIP GUARD runs ONCE per mount (a container's read determinism does not change). It
    // asserts the RE-SEED READ — the EXACT predicate the gate below compares, `toConfig ∘ fromConfig`
    // when a serializer is given, else `fromConfig` — is deterministic. That is precisely the churn
    // condition: the resync re-seeds iff two reads of the SAME record differ THROUGH the gate. Checking
    // `fromConfig` alone would false-positive a container whose `fromConfig` mints a runtime id (a
    // position id via genId) but whose `toConfig` STRIPS it (bento) — churn-safe, yet flagged. Runs in
    // the built dist (NOT dev-gated: projections load a production bundle, where an `import.meta.env.DEV`
    // gate would tree-shake it away).
    let guarded = false;
    return subscribe(() => {
      const r = resyncRef.current;
      const id = r?.host.instanceId;
      if (!r || !id) return;
      const raw = r.host.children.pool?.resolveRecord(id);
      if (raw === undefined) return; // transiently unresolvable — leave the model; the next event resyncs.
      if (!guarded) {
        guarded = true;
        const gateRead = r.toConfig ? (x: unknown) => r.toConfig!(r.fromConfig(x)) : r.fromConfig;
        assertDeterministicRead((r.host.config as { type?: string } | undefined)?.type ?? 'container', raw, gateRead);
      }
      const fresh = r.fromConfig(raw);
      // Gate in CONFIG space when a serializer is given: runtime-only state the save strips (tabs' preview)
      // must not read as a divergence, or an unrelated pool event re-seeds it away. Only a genuine change
      // to this container's OWN config re-seeds. Without a serializer, fall back to model-space equality.
      const willReseed = r.toConfig
        ? !sameModel(r.toConfig(cell.read()), r.toConfig(fresh))
        : !sameModel(fresh, cell.read());
      if (!willReseed) return;
      // A re-seed from an EXTERNAL structural edit (a drag re-parent, a placeholder close). Trace it under
      // the ambient cause so a moved-in / moved-out pane reads under the drag's own pass.
      if (on('resync')) event('resync', 're-seed', { subject: (r.host.config as { type?: string } | undefined)?.type ?? 'container', id });
      cell.commit(fresh);
    });
  }, [cell]);

  const commit = useCallback(
    (next: T): void => {
      cell.commit(next); // advances FIRST, so a same-tick re-entrant commit builds on it
      saveRef.current(next);
    },
    [cell],
  );

  // `live` is stable and always reads through the cell, so a seam method captured in any render
  // still sees the latest committed value.
  const live = useCallback((): T => cell.read(), [cell]);

  return { model, live, commit };
}
