/**
 * The SAFE-CENTER re-parent producer.
 *
 * Places an existing pool record (`incoming`) into a target slot under the safe-center rule: an
 * OCCUPIED, NON-GROUPING slot WRAPS its occupant and the incoming pane into a grouping container, so a
 * center drop never REPLACES the occupant; an empty or grouping slot takes a plain inject. When the
 * incoming pane is currently held by a source container, that container's reference is dropped in the
 * same result: a SAME-container move folds the drop into the one wrap/move record; a CROSS-container
 * move adds the source's extract record.
 *
 * PURE: it computes and RETURNS the record edits, and commits NOTHING. One authority applies them
 * (`CompositionRuntime.applyStructural`), so a caller bundles these edits with its own — dock adds the
 * window-root splice — into ONE atomic commit.
 *
 *
 */

import type { ContainerKind, ContainerPlacement, DropTarget, Occupant, PaneId, PaneInstance } from '@arsumbris/au-host-sdk';
import { POOL_EDIT_NOOP } from '@arsumbris/au-host-sdk';
import { isGroupingKind } from './grouping.ts';
import type { GroupingCapability } from './grouping.ts';

type PoolEditSeam = NonNullable<ContainerPlacement['poolEdit']>;

/** One record edit for the single commit authority: pool record `id` becomes `record`. */
export interface StructuralEdit {
  id: PaneId;
  record: PaneInstance;
}

/** The pane whose reference is dropped when it re-parents FROM a source container. */
export interface ReparentSource {
  poolEdit: PoolEditSeam;
  /** The pane's LOCAL id in the source container (its layout address, not its pool `^:`). */
  localId: string;
}

export interface ReparentArgs {
  /** The record to place — already in the pool, carrying its `^:` id. */
  incoming: Occupant;
  /** The target slot's current occupant, or null when the slot is empty. */
  existing: Occupant | null;
  target: {
    poolEdit: PoolEditSeam;
    containerKind: ContainerKind;
    /** The target slot's id — a position address, distinct from any occupant's `^:`. */
    slotId: string;
    /** The drop descriptor a plain inject / move places against. */
    descriptor: DropTarget;
  };
  /** Present when `incoming` is currently held by a container that must drop its reference; null when
   *  the caller drops the reference itself (dock splices the window root out of the roots). */
  source?: ReparentSource | null;
  /** The grouping container to wrap with, ALREADY resolved by the caller (its override-or-default). It
   *  is consulted only on the occupied-non-grouping path, where a null means no group can be built. */
  grouping: GroupingCapability | null;
}

export type ReparentOutcome = 'wrap' | 'inject' | 'move' | 'noop';

export type Reparented =
  | { ok: true; edits: StructuralEdit[]; outcome: ReparentOutcome }
  | { ok: false; reason: 'no-grouping-declared' | 'refused' };

/** A source extract that a builder refused, distinct from "no source". */
const REFUSED: unique symbol = Symbol('reparent-source-refused');

/** The source container's extract edit (dropping its reference to `incoming`), or null when there is
 *  no source to drop, or REFUSED when the source slot refuses release. */
function dropSourceEdit(source: ReparentSource | null | undefined): StructuralEdit | null | typeof REFUSED {
  if (!source) return null;
  const ex = source.poolEdit.extractEdit(source.localId);
  if (!ex) return REFUSED;
  return { id: source.poolEdit.recordId(), record: ex.record };
}

export function reparentSafeCenter(args: ReparentArgs): Reparented {
  const { incoming, existing, target, source, grouping } = args;
  const t = target.poolEdit;
  const tgtId = t.recordId();
  const srcId = source ? source.poolEdit.recordId() : '';
  // Same record = same container (a container owns one pool record). The empty guard keeps two
  // id-less seams from reading as "same".
  const sameContainer = source != null && srcId !== '' && srcId === tgtId;

  // OCCUPIED + NON-GROUPING → wrap the occupant + the incoming pane into a grouping container. The
  // occupant is never replaced.
  if (existing != null && !isGroupingKind(target.containerKind)) {
    if (!grouping) return { ok: false, reason: 'no-grouping-declared' };
    const group = grouping.build([
      { id: existing.id, instance: existing.instance },
      { id: incoming.id, instance: incoming.instance },
    ]) as PaneInstance;
    // STAGE the group (draw its id, no pool write): its record edits ride THIS batch, so the whole
    // wrap — group + slot re-point + source drop — is one atomic proposal the host can refuse cleanly.
    const { rootId: groupId, edits: groupEdits } = t.createGroup(group);
    if (sameContainer) {
      // The dragged pane also lives here: wrap the slot AND drop the pane in ONE record — two edits
      // to the same `^:` would conflict.
      const rec = t.wrapEdit(target.slotId, group, groupId, source!.localId);
      return rec == null
        ? { ok: false, reason: 'refused' }
        : { ok: true, edits: [...groupEdits, { id: tgtId, record: rec }], outcome: 'wrap' };
    }
    const tgtRec = t.wrapEdit(target.slotId, group, groupId);
    if (tgtRec == null) return { ok: false, reason: 'refused' };
    const src = dropSourceEdit(source);
    if (src === REFUSED) return { ok: false, reason: 'refused' };
    const edits: StructuralEdit[] = [...groupEdits, { id: tgtId, record: tgtRec }];
    if (src) edits.push(src);
    return { ok: true, edits, outcome: 'wrap' };
  }

  // EMPTY or GROUPING slot → plain place.
  if (sameContainer) {
    const rec = t.moveWithinEdit(source!.localId, target.descriptor);
    if (rec === POOL_EDIT_NOOP) return { ok: true, edits: [], outcome: 'noop' };
    return rec == null
      ? { ok: false, reason: 'refused' }
      : { ok: true, edits: [{ id: tgtId, record: rec }], outcome: 'move' };
  }
  const tgtRec = t.injectEdit(incoming.instance, incoming.id, target.descriptor);
  if (tgtRec == null) return { ok: false, reason: 'refused' };
  const src = dropSourceEdit(source);
  if (src === REFUSED) return { ok: false, reason: 'refused' };
  const edits: StructuralEdit[] = [{ id: tgtId, record: tgtRec }];
  if (src) edits.push(src);
  return { ok: true, edits, outcome: 'inject' };
}
