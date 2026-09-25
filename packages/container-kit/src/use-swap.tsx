// Replace a slot's projection in place, retaining its current file when the chosen viewer accepts one.
// setPaneContent resolves the holding container and enforces admits and fixed at the placement seam.
// This hook adds the picker affordance and file carry.
//
// const swap = usePaneSwap(host)
// Use swap.toggle(id) from the header, and swap.swapPicker(id, instance) while swap.isSwapping(id).
// Every call takes the OCCUPANT's own id (its `data-pane-id`), never a position id: the menu, the keyboard
// intent and the render must agree on it, and it is what placementForPane and setPaneContent address.
// Swapping changes the viewer of the current document; it does not choose a different file.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  /** Is this pane currently showing the swap picker? */
  isSwapping: (paneId: string) => boolean;
  /** Open the swap picker on a pane. */
  request: (paneId: string) => void;
  /** Close the swap picker without swapping. */
  cancel: () => void;
  /** Open the picker on a slot, or close it if this slot's picker is already open (wire to a header
   *  swap button — one button toggles it). */
  toggle: (paneId: string) => void;
  /** The swap picker for a slot — render it in the pane BODY while `isSwapping(paneId)`. Returns null
   *  otherwise, so `swap.swapPicker(id, instance)` is safe to place unconditionally. */
  swapPicker: (paneId: string, current: Instance) => ReactNode;
}

/**
 * Register the routed `swap-pane-intent` handler for a container — the keyboard-command form of the ⋯ menu's
 * "Swap pane" row. The container CLAIMS when the window's active pane (`host.focus.activePane`) is one of ITS
 * children (`owns`) in a position that is not `fixed`, and opens the swap picker on it via `swap.request` — so a keyboard swap targets the
 * FOCUSED pane, wherever it lives, through the same picker the menu uses. Only the holding container claims,
 * so the routed-ambient walk reaches it. Refs keep the registration stable across renders (the swap object
 * and the `owns` predicate are fresh each render). Every container that shows a "Swap pane" row calls this,
 * so the shortcut behaves identically across container kinds.
 */
export function useSwapPaneIntent(host: MountHost, swap: PaneSwap, owns: (paneId: string) => boolean): void {
  const swapRef = useRef(swap); swapRef.current = swap;
  const ownsRef = useRef(owns); ownsRef.current = owns;
  useEffect(() => {
    // The focused child, unless its position is `fixed`: the menu hides Swap there, so the command declines
    // too, rather than opening a picker whose every pick the seam refuses.
    const activeChild = (): string | null => {
      const a = host.focus.activePane?.() ?? null;
      if (a == null || !ownsRef.current(a)) return null;
      const placement = placementForPane(a);
      return placement && slotFor(placement, a)?.fixed ? null : a;
    };
    return host.intent?.handle('swap-pane-intent', {
      claim: () => activeChild() != null,
      commit: () => { const a = activeChild(); if (a != null) swapRef.current.request(a); },
    });
  }, [host]);
}

function SwapInteraction({ children }: { children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => ref.current ? holdPaneFrame(ref.current) : undefined, []);
  return <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>{children}</div>;
}

export function usePaneSwap(host: MountHost): PaneSwap {
  const [swapId, setSwapId] = useState<string | null>(null);
  const cancel = (): void => setSwapId(null);
  const isSwapping = (paneId: string): boolean => swapId === paneId;
  return {
    isSwapping,
    request: (paneId) => setSwapId(paneId),
    cancel,
    toggle: (paneId) => setSwapId((cur) => (cur === paneId ? null : paneId)),
    swapPicker: (paneId, current) => {
      if (swapId !== paneId) return null;
      // Offer only viewers the SLOT admits, so a swap is never refused at the seam — the same admits
      // filter the placeholder-picker applies to an empty slot. A slot with no `admits` rule admits
      // everything (`slotAdmits` returns true), so the list is unchanged. A disallowed pick that still
      // reaches the seam by some other path is refused there and surfaced as a notification (the host
      // diagnostics stream), never a silent no-op.
      const placement = placementForPane(paneId);
      const slot = placement ? slotFor(placement, paneId) : null;
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
            if (setPaneContent(paneId, withDocument(id, current))) cancel();
          }}
        />
        </SwapInteraction>
      );
    },
  };
}
