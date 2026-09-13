/**
 * `makePoolEdit` — the paved path for a container's `ContainerPlacement.poolEdit`.
 *
 * A container that keeps a runtime MODEL and serializes it to a record supplies four PURE model
 * transforms (remove / place / reorder / wrap) plus its `toConfig` and its owned top-level field
 * names; this builds the seam the drop router batches into one atomic commit. The transforms never
 * touch React state or persist — the router collects the source + target records and the host
 * re-derives the tree once (a re-parent is a reference RE-POINT, so no in-place tree mutation and no
 * stale-snapshot re-serialize). Present only when the runtime owns a pool (absent → the mutating
 * `extract`/`inject` fallback runs, for callers without a pool).
 *
 *
 */

import type {
  ContainerPlacement,
  DropTarget,
  MountHost,
  Occupant,
  OpaqueConfig,
  PaneId,
  PaneInstance,
  StagedMint,
} from '@arsumbris/au-host-sdk';
import { POOL_EDIT_NOOP } from '@arsumbris/au-host-sdk';

/**
 * Carry the composition-scoped fields a container does NOT own from `host.config` onto its rebuilt
 * record, so a structural REMOUNT re-reads a COMPLETE record (a root container's `intent-defaults` /
 * `initial-focus` survive a re-parent). This is `mergeOwned` expressed at the container: the emitted
 * record controls the OWNED fields (including by omission); everything else is carried verbatim. `^`
 * is excluded — the host stamps it on the merge.
 */
export function withCarry(
  host: MountHost,
  owned: object,
  ownedKeys: Iterable<string>,
): Record<string, unknown> {
  const ownedRec = owned as Record<string, unknown>;
  const prev = host.config as Record<string, unknown> | undefined;
  if (prev == null || typeof prev !== 'object') return ownedRec;
  const skip = new Set<string>(['^', ...ownedKeys]);
  const carried: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prev)) if (!skip.has(k)) carried[k] = v;
  const merged = { ...carried, ...ownedRec };
  // `type` is the DECLARED composition type, kept verbatim — never the container's bare emission. A
  // root claiming `type: [bento, intent-routing]` must keep BOTH claims: a container serializes only
  // its OWN type name, so emitting it here would strip the mixin (and with it the routing rule). This
  // mirrors `stampingSaveConfig`'s `type: declared`, which the saveConfig path already does.
  if (prev['type'] !== undefined) merged['type'] = prev['type'];
  return merged;
}

/** The container-specific model transforms `makePoolEdit` drives. Each is PURE: given the live model,
 *  return the new model (or occupant), never committing or persisting. */
export interface PoolEditModel<M> {
  host: MountHost;
  /** The live (post-commit) model — read at call time, never a render closure. */
  live: () => M | null;
  /** This container's OWN top-level field names; everything else on `host.config` is carried. */
  ownedKeys: readonly string[];
  /** Serialize a model to this container's own record (its owned fields; `withCarry` adds the rest).
   *  Returns the container's generated config type (an `object`), which `withCarry` reads as a record. */
  toConfig: (model: M) => object;
  /** Remove the pane `localId`; return the new model + the occupant that left, or null. */
  remove: (model: M, localId: string) => { model: M; occupant: Occupant } | null;
  /** Place `occupant` at `target`; new model or null if refused. */
  place: (model: M, occupant: Occupant, target: DropTarget) => M | null;
  /** Reorder `sourceLocalId` to `target` within this container. New model, or `POOL_EDIT_NOOP` when
   *  the source lands on its own position (nothing to commit, NOT a refusal), or null if refused. */
  reorder: (model: M, sourceLocalId: string, target: DropTarget) => M | typeof POOL_EDIT_NOOP | null;
  /** Repoint `slotId` at the group `groupId` (occupant instance `groupInstance`), and — for a
   *  SAME-container wrap — drop `removeLocalId` in the same model. New model or null. */
  wrap: (
    model: M,
    slotId: string,
    groupId: PaneId,
    groupInstance: PaneInstance,
    removeLocalId?: string,
  ) => M | null;
}

export function makePoolEdit<M>(m: PoolEditModel<M>): NonNullable<ContainerPlacement['poolEdit']> | undefined {
  const pool = m.host.children.pool;
  if (!pool) return undefined;
  const toRecord = (model: M): PaneInstance => withCarry(m.host, m.toConfig(model), m.ownedKeys);
  return {
    recordId: () => (m.host.config as { ['^']?: string } | undefined)?.['^'] ?? '',
    extractEdit: (localId) => {
      const model = m.live();
      if (model == null) return null;
      const r = m.remove(model, localId);
      return r ? { record: toRecord(r.model), occupant: r.occupant } : null;
    },
    injectEdit: (instance, id, target) => {
      const model = m.live();
      if (model == null) return null;
      const next = m.place(model, { instance, id }, target);
      return next ? toRecord(next) : null;
    },
    moveWithinEdit: (sourceLocalId, target) => {
      const model = m.live();
      if (model == null) return null;
      const next = m.reorder(model, sourceLocalId, target);
      if (next === POOL_EDIT_NOOP) return POOL_EDIT_NOOP; // no change — the router commits nothing, warns nothing
      return next ? toRecord(next) : null;
    },
    wrapEdit: (slotId, groupInstance, groupId, removeLocalId) => {
      const model = m.live();
      if (model == null) return null;
      const next = m.wrap(model, slotId, groupId, groupInstance, removeLocalId);
      return next ? toRecord(next) : null;
    },
    // The STRUCTURAL channel: STAGE the mint (draw an id, no pool write) so the record rides the same
    // `propose` batch as the wrap/inject edit — a refused proposal leaves no orphan. The bounded
    // new-content mint (`createChild` → `pool.createRecord`, host-pooled) is a separate channel.
    createRecord: (record) => pool.stageRecord(record as OpaqueConfig) as StagedMint,
    createGroup: (groupInstance) => pool.stageGroup(groupInstance as OpaqueConfig) as StagedMint,
    // THE ASK: hand the batch to the host. `propose` is the substrate's ONLY write channel; the host applies it.
    // Falls back to `applyStructural` for a host that predates `propose` (transition guard).
    propose: (edits) => (pool.propose ?? pool.applyStructural)(edits as ReadonlyArray<{ id: string; record: OpaqueConfig }>),
  };
}
