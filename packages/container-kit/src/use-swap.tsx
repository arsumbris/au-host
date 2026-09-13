// Replace a slot's projection in place, retaining its current file when the chosen viewer accepts one.
// setPaneContent resolves the holding container and enforces admits and fixed at the placement seam.
// This hook adds the picker affordance and file carry.
//
// const swap = usePaneSwap(host)
// Use swap.toggle(id) from the header, and swap.swapPicker(id, instance) while swap.isSwapping(id).
// The id is the pane's own id, resolved through placementForPane and the container's slot lookup.
// Swapping changes the viewer of the current document; it does not choose a different file.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { holdPaneFrame } from './hold-pane-frame';
import type { MountHost, ProjectionDescriptor } from '@arsumbris/au-host-sdk';
import { placementForPane, setPaneContent, slotAdmits, slotFor } from '@arsumbris/container-core';
import { admitsNoteFor, PanePicker, describeForPicker } from './PanePicker';

/** The slice of a projection instance the swap reads and writes: its optional `type`, and an optional
 *  `file` it carries across. `type` mirrors the projection record shape (an inline record's `type` is
 *  optional, inferred from its slot), and the swap never reads `current.type` — the swapped-in type is
 *  the picker's pick. Deliberately NOT the container's full instance type — a swap changes the VIEWER
 *  and carries only the document, never a reader's config fields onto an editor. */
type Instance = { type?: string; file?: string };

/** Carry a file-backed pane's document onto the swapped-in type — swapping a reader for an editor
 *  keeps the same file. A non-file pane swaps to a bare `{ type }`. */
function withDocument(type: string, current: Instance): Instance {
  return current.file !== undefined ? { type, file: current.file } : { type };
}

export interface PaneSwap {
  /** Is this slot currently showing the swap picker? */
  isSwapping: (slotId: string) => boolean;
  /** Open the swap picker on a slot. */
  request: (slotId: string) => void;
  /** Close the swap picker without swapping. */
  cancel: () => void;
  /** Open the picker on a slot, or close it if this slot's picker is already open (wire to a header
   *  swap button — one button toggles it). */
  toggle: (slotId: string) => void;
  /** The swap picker for a slot — render it in the pane BODY while `isSwapping(slotId)`. Returns null
   *  otherwise, so `swap.swapPicker(id, instance)` is safe to place unconditionally. */
  swapPicker: (slotId: string, current: Instance) => ReactNode;
}

function SwapInteraction({ children }: { children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => ref.current ? holdPaneFrame(ref.current) : undefined, []);
  return <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>{children}</div>;
}

export function usePaneSwap(host: MountHost): PaneSwap {
  const [swapId, setSwapId] = useState<string | null>(null);
  const cancel = (): void => setSwapId(null);
  const isSwapping = (slotId: string): boolean => swapId === slotId;
  return {
    isSwapping,
    request: (slotId) => setSwapId(slotId),
    cancel,
    toggle: (slotId) => setSwapId((cur) => (cur === slotId ? null : slotId)),
    swapPicker: (slotId, current) => {
      if (swapId !== slotId) return null;
      // Offer only viewers the SLOT admits, so a swap is never refused at the seam — the same admits
      // filter the placeholder-picker applies to an empty slot. A slot with no `admits` rule admits
      // everything (`slotAdmits` returns true), so the list is unchanged. A disallowed pick that still
      // reaches the seam by some other path is refused there and surfaced as a notification (the host
      // diagnostics stream), never a silent no-op.
      const placement = placementForPane(slotId);
      const slot = placement ? slotFor(placement, slotId) : null;
      const all = describeForPicker(host);
      const descriptors: readonly ProjectionDescriptor[] = all.filter((d) => slotAdmits(slot, d.type));
      const admitsNote = admitsNoteFor(slot, all.length, descriptors.length);
      return (
        <SwapInteraction>
        <PanePicker
          descriptors={descriptors}
          admitsNote={admitsNote}
          title="Swap this pane"
          onCancel={cancel}
          onPick={(id) => {
            // The ONE seam, with no third arg: `setPaneContent` keeps the current occupant's `^:` id, so
            // the pane keeps its identity (view-state, pty) and only its projection changes. `false` is a
            // real refusal (a `fixed` or `admits`-restricted slot) — keep the picker open then, so a
            // refusal reads differently from a completed swap rather than looking like a misclick.
            if (setPaneContent(slotId, withDocument(id, current))) cancel();
          }}
        />
        </SwapInteraction>
      );
    },
  };
}
