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
import { createModelCell, watchOwnRecord, type ModelCell } from '@arsumbris/container-core';

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
 * container's own `commit` (a drag re-parent, a `closePane`, a `wrapPane`). The React binding of
 * container-core's `watchOwnRecord`, which owns the gate; see it for the mechanism.
 */
export interface ContainerModelResync<T> {
  host: MountHost;
  /** Rebuild the model from a raw pool record (the container's own `fromConfig`). */
  fromConfig: (raw: unknown) => T;
  /** The container's SAVE serializer, OPTIONAL: gates the re-seed in config space. See `RecordResync.toConfig`. */
  toConfig?: (model: T) => unknown;
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

  // RE-SEED from the pool on an EXTERNAL structural edit: advance the CELL ONLY (`cell.commit`, NOT the
  // hook's `commit`), so no save-back fires. A normal React re-render (anchors kept by key), never a remount.
  useEffect(() => {
    const r = resyncRef.current;
    if (!r) return;
    return watchOwnRecord<T>({
      host: r.host,
      fromConfig: (raw) => resyncRef.current!.fromConfig(raw),
      // Read through the ref on every call, presence included: the latest render's serializer, or the
      // model itself when it declares none (the gate then compares models, the same as no serializer).
      toConfig: (m: T) => resyncRef.current?.toConfig?.(m) ?? m,
      current: () => cell.read(),
      reseed: (next) => cell.commit(next),
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
