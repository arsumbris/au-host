/**
 * Shared cross-container drag store built on zustand/vanilla.
 * Sources start a drag; the overlay updates its resolved hover target; end delivers the source
 * and current target to the subscribed router. The hovered target is the committed target.
 *
 * A window-global singleton shares the store across projection bundles. container-kit provides
 * the useLayoutDrag React binding. Placement stays in the external router, wired through onDrop.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DragContent, DragSource, DragState, DropHit } from './types.ts';
import type { GroupingCapability } from './grouping.ts';

/** Context the drop router needs beyond the (source, target) descriptors. */
export interface DropContext {
  /** The source's DOM element; the router walks up to its container root. */
  sourceEl: Element | null;
  /** The CONTENT this drag carries, when it did not start inside a container. Its PRESENCE makes the
   *  router take the content branch (mint-and-place) instead of the pane branch (extract/inject). Opaque
   *  here; the host-installed resolver narrows it. See {@link DragContent}. */
  content?: DragContent;
  /** The grouping container a center-WRAP must use, pre-resolved. When present, `routeDrop` uses it
   *  instead of the provider default — the seam by which an async wrapper (`routeDropWithGrouping`)
   *  asks the host chooser BEFORE the synchronous drop, so a >=2-way choice is never silently defaulted.
   *  Absent = today's behaviour (the provider's name-sorted pick). */
  groupingOverride?: GroupingCapability;
}

export interface LayoutDragStore {
  drag: DragState | null;

  /** The drop router, installed once by the host-mounted overlay. Receives the
   *  resolved drop hit + context. A `DropHit` is a container zone (`DropTarget`) OR a
   *  content-destination (`ContentDropHit`); `null` = canceled / no target. */
  onDrop: ((source: DragSource, target: DropHit | null, ctx: DropContext) => void) | null;

  start: (
    source: DragSource,
    startOffset?: { x: number; y: number },
    sourceEl?: Element | null,
    content?: DragContent,
  ) => void;
  setHover: (hover: DropHit | null) => void;
  /** End the drag: commit the current `hover` (the resolved target) to the
   *  router. Deepest-wins-live — no menu. */
  end: () => void;
  cancel: () => void;
  setOnDrop: (cb: ((source: DragSource, target: DropHit | null, ctx: DropContext) => void) | null) => void;
}

/** Create a fresh drag store. Called ONCE per window by `singletons.ts`; every
 *  bundle's `useLayoutDrag` binds the one shared instance. */
export function createDragStore(): StoreApi<LayoutDragStore> {
  return createStore<LayoutDragStore>((set, get) => ({
    drag: null,
    onDrop: null,

    start: (source, startOffset = { x: 0, y: 0 }, sourceEl = null, content = undefined) => {
      set({ drag: { source, sourceEl, hover: null, startOffset, content } });
    },

    setHover: (hover) => {
      const current = get().drag;
      if (!current) return;
      set({ drag: { ...current, hover } });
    },

    end: () => {
      const { drag, onDrop } = get();
      if (!drag) return;
      set({ drag: null });
      onDrop?.(drag.source, drag.hover, { sourceEl: drag.sourceEl, content: drag.content });
    },

    cancel: () => {
      set({ drag: null });
    },

    setOnDrop: (cb) => set({ onDrop: cb }),
  }));
}
