/**
 * Bento's drop DIALECT: how bento emits its drop targets at a cursor point.
 *
 * The generic layer (container-core's `resolveTargetsAll`) walks the container
 * nesting at the cursor and asks each registered container's dialect for its
 * targets, keeping the deepest (deepest-wins). This is bento's contribution: given
 * a cursor point, it finds bento's OWN droptarget under it (a leaf `slot-rect` — the
 * only shape bento declares) and computes the target — the logic that
 * is owned by bento; the shared resolver chooses the deepest matching container.
 *
 * Emission is DOM-driven (no React state): bento's leaves/strips already carry the
 * generic `data-droptarget-*` attrs + bento's own `data-bento-*` reads. The
 * PRESENTATION half (the drag-time frame-inset) is bento's own render observing
 * the drag store — see `BentoLayout` — not a method here.
 *
 * SCOPING: `resolveTargets` emits ONLY for droptargets owned by THIS bento, not a
 * nested container (or a nested bento). A droptarget belongs to this bento iff its
 * nearest `data-layout-container-slot` ancestor is this bento's own layout wrapper.
 * A nested container's droptargets sit under their own slot wrapper, so they are
 * excluded here and emitted by that container's own dialect (deepest-wins across
 * containers resolves the overlap).
 */

import {
  computeRectZone,
  bandFracFor,
  dragSourceIsFrom,
  type ContainerDialect,
  type DragPoint,
  type DragSource,
  type DropTarget,
  type DropTargetShape,
} from '@arsumbris/container-kit';

/** A content slot rendered as a rect, with TBLRC zones (a bento leaf). Mirrors the
 *  former core `hitSlotRect`, bento-scoped. This is bento's ONLY target shape —
 *  `BentoLayout` declares `slot-rect` and nothing else. */
function bentoSlotRect(
  el: HTMLElement,
  slotId: string,
  point: DragPoint,
  source: DragSource,
  fromMe: boolean,
): DropTarget | null {
  const rect = el.getBoundingClientRect();
  const zone = computeRectZone(rect, point.x, point.y);

  // Source dropped onto its OWN slot's CENTRE is a no-op (a pane onto itself). `fromMe` is the
  // DOM-identity same-container answer. Edge zones stay valid — an "extract from the group" gesture.
  if (source.localId === slotId && fromMe) {
    if (zone === 'center') return null;
  }

  // Emit the exact highlight band from the SAME edgeBandPx basis the zone was picked with, so the
  // overlay draws where the drop lands (not a hardcoded fraction that drifts on a capped-band pane).
  return { shape: 'slot-rect', containerKind: 'bento', slotId, zone, band: bandFracFor(rect, zone) };
}


/** Bento's drop dialect. A stable singleton — emission reads live DOM, no React
 *  state, so bento registers this one object via `useContainerDialect`. */
export const bentoDropDialect: ContainerDialect = {
  resolveTargets(root: Element, point: DragPoint, source: DragSource): DropTarget[] {
    const doc = root.ownerDocument ?? document;
    const el = doc.elementFromPoint(point.x, point.y);
    if (!el) return [];
    // This bento's own layout wrapper (the direct child carrying the slot attr) —
    // the scoping anchor for "is this droptarget mine?".
    const mySlotEl = root.querySelector(':scope > [data-layout-container-slot]') ?? root;

    // Nearest bento-owned droptarget under the cursor that belongs to THIS bento.
    let cur: Element | null = el;
    let dt: HTMLElement | null = null;
    const stop = root.parentElement;
    while (cur && cur !== stop) {
      const he = cur as HTMLElement;
      if (he.dataset?.['containerKind'] === 'bento' && he.dataset?.['droptargetShape']) {
        // Belongs to this bento iff its nearest slot wrapper is ours (else it is a
        // nested container's target, emitted by that container's own dialect).
        if (he.closest('[data-layout-container-slot]') === mySlotEl) {
          dt = he;
          break;
        }
      }
      cur = cur.parentElement;
    }
    if (!dt) return [];

    const shape = dt.dataset['droptargetShape'] as DropTargetShape;
    const id = dt.dataset['droptargetId'];
    if (!id) return [];
    // Use the registered container root to identify a same-container source,
    // matching the shared router's ownership check.
    const fromMe = dragSourceIsFrom(root);

    if (shape === 'slot-rect') {
      const t = bentoSlotRect(dt, id, point, source, fromMe);
      return t ? [t] : [];
    }
    return [];
  },
};
