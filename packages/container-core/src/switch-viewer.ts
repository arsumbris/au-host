// VIEWER SWITCH — a user-initiated move of a file pane to a DIFFERENT projection.

// The runtime twin of open-time viewer resolution: `resolveViewer` decides which viewer a fresh OPEN
// lands in; this switch re-shows an ALREADY-open file elsewhere. It splits the targets into two groups,
// each folded from declared meta, never a hardcoded name:
//   - VIEWERS — projections that RENDER this file (`opens-meta` eligible, incl. `*`). The primary group.
//   - OPENERS — projections that can be HANDED this file but are not file-type viewers (`handles`
//     open-intent, no `opens-meta`: radial-tree, focal-tree). The secondary "do something with it" group.

// The pane's OWN current type is excluded from both, read from the placement registry so the caller names
// nothing.



import { bareTypeName, fileConsumersFor } from '@arsumbris/au-host-sdk';
import { extensionOf, viewersFor, viewerPickOptions, type ViewerDefaultEntry, type ViewerPickOption } from './viewer-resolve.ts';
import { placementForPane, resolveAddress, setPaneContent } from './registry.ts';
import { typeOfInstance } from './slots.ts';

/** A descriptor as `describeProjections()` returns it: a type name, its kind closure (the openers gate
 *  needs `pane-projection`), and its meta (opens-meta / handles). */
type ViewerDescriptor = { type: string; kinds?: readonly string[]; meta?: Record<string, Record<string, unknown>> };

/** The slice of the host a switch needs. Structural, so container-core stays decoupled from `MountHost`. */
export interface SwitchHost {
  instanceId?: string;
  describeProjections?: () => readonly ViewerDescriptor[] | undefined;
  viewerDefaults?: () => readonly ViewerDefaultEntry[] | undefined;
  chooser?: { choose(request: { title?: string; options: readonly { id: string; label: string }[] }): Promise<string | null> };
}

/** The two switch groups for a file pane, each labelled + ordered, the pane's current type excluded. */
export interface ViewerSwitchSets {
  /** Viewers that RENDER this file (`opens-meta` eligible, incl. `*`), composition default first. */
  viewers: ViewerPickOption[];
  /** File-consumers handed this file but not viewers (`handles` open-intent, no `opens-meta`). */
  openers: ViewerPickOption[];
}

/** Which group a switch acts over. */
export type SwitchGroup = 'viewers' | 'openers';

/** The outcome of a switch, so the caller reports each case. */
export type SwitchOutcome =
  /** The pane now shows `viewer`. */
  | { kind: 'switched'; viewer: string }
  /** The group is empty — nothing to switch to. */
  | { kind: 'none' }
  /** The user dismissed the picker. */
  | { kind: 'cancelled' }
  /** The pane's slot lock refused the swap (a `fixed` / `admits` position). */
  | { kind: 'refused' };

/** The pane's CURRENT occupant type, read from the placement registry — so the caller names nothing. */
function currentTypeOf(instanceId: string): string | undefined {
  const placement = placementForPane(instanceId);
  if (!placement) return undefined;
  const pos = resolveAddress(placement, instanceId, 'place');
  if (pos == null) return undefined;
  const occupant = placement.getSlotContent(pos);
  const type = occupant ? typeOfInstance(occupant.instance) : undefined;
  return type ? bareTypeName(type) : undefined;
}

/**
 * The two switch groups for `file`, labelled and ordered, the pane's current type excluded. Synchronous,
 * for a caller that labels the affordance (primary name, whether a "more" group exists) before any click.
 * Pass `currentType` to override the registry read (already-bared or a `type::repo` form both work).
 */
export function viewerSwitchSets(host: SwitchHost, file: string, currentType?: string): ViewerSwitchSets {
  const id = host.instanceId;
  const current = currentType ? bareTypeName(currentType) : id ? currentTypeOf(id) : undefined;
  const descriptors = host.describeProjections?.();

  const eligible = viewersFor(file, descriptors).filter((v) => v !== current);
  const ext = extensionOf(file);
  const preferred = host
    .viewerDefaults?.()
    ?.find((d) => (d.opens === ext || d.opens === '*') && eligible.includes(d.viewer))?.viewer;
  const orderedViewers = preferred ? [preferred, ...eligible.filter((v) => v !== preferred)] : eligible;

  const openers = fileConsumersFor(descriptors).filter((v) => v !== current);
  return {
    viewers: viewerPickOptions(orderedViewers, descriptors),
    openers: viewerPickOptions(openers, descriptors),
  };
}

/**
 * Run the switch for one group: 0 eligible → `none`, 1 → switch directly (no picker), 2+ → the host picker
 * then swap. Owns the picker and the in-place swap; the caller only routes the affordance's two events here.
 */
export async function runViewerSwitch(host: SwitchHost, file: string, group: SwitchGroup, currentType?: string): Promise<SwitchOutcome> {
  const id = host.instanceId;
  if (!id) return { kind: 'none' };
  const sets = viewerSwitchSets(host, file, currentType);
  const options = group === 'viewers' ? sets.viewers : sets.openers;
  if (options.length === 0) return { kind: 'none' };
  const chosen = options.length === 1 ? options[0].id : await host.chooser?.choose({ title: 'Open with', options });
  if (!chosen) return { kind: 'cancelled' };
  return setPaneContent(id, { type: chosen, file }) ? { kind: 'switched', viewer: chosen } : { kind: 'refused' };
}
