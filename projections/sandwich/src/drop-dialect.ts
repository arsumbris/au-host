/**
 * The `sandwich` container's drop DIALECT: how it emits drop targets at a cursor
 * point. A sandwich REGION is a single placement slot with NO split of its own, so
 * a drop anywhere in a region means "place here" — one centred `slot-rect` per
 * region (center = wrap-into-tabs / add / place, driven by the generic router).
 * Split-BESIDE is not a sandwich gesture; its three regions are fixed positions.
 *
 * Emission is DOM-driven (no React state): each region body carries the generic
 * `data-droptarget-*` attrs (shape `slot-rect`, kind `sandwich`, id = the region's
 * slot id) + `data-layout-container-slot` on the sandwich root for scoping.
 * Structurally mirrors the tabs / bento dialects; deepest-wins resolves the overlap
 * with a nested container in a region (that container's own dialect wins deeper).
 *
 *
 */

import {
  CENTER_BAND,
  dragSourceIsFrom,
  type ContainerDialect,
  type DragPoint,
  type DropTarget,
} from '@arsumbris/container-kit'

export const sandwichDropDialect: ContainerDialect = {
  // `source` is intentionally omitted: sandwich's only same-container test is DOM identity
  // (`dragSourceIsFrom`), so it reads nothing off the source descriptor.
  resolveTargets(root: Element, point: DragPoint): DropTarget[] {
    const doc = root.ownerDocument ?? document
    const el = doc.elementFromPoint(point.x, point.y)
    if (!el) return []
    // This sandwich's own slot wrapper (its root carries the slot attr).
    const mySlotEl = root.matches('[data-layout-container-slot]')
      ? root
      : root.querySelector(':scope > [data-layout-container-slot]') ?? root

    // Nearest sandwich-owned droptarget under the cursor that belongs to THIS sandwich.
    let cur: Element | null = el
    let dt: HTMLElement | null = null
    const stop = root.parentElement
    while (cur && cur !== stop) {
      const he = cur as HTMLElement
      if (he.dataset?.['containerKind'] === 'sandwich' && he.dataset?.['droptargetShape'] === 'slot-rect') {
        if (he.closest('[data-layout-container-slot]') === mySlotEl) {
          dt = he
          break
        }
      }
      cur = cur.parentElement
    }
    if (!dt) return []

    const id = dt.dataset['droptargetId']
    if (!id) return []
    // Same-sandwich drag = no target (regions are fixed positions; you drag content OUT
    // to another container, not between the sandwich's own regions). This also avoids the
    // same-container extract-then-wrap that would duplicate. Same-container by DOM IDENTITY
    // (`root` is this sandwich's registration element) — the one truthmaker the router uses too.
    if (dragSourceIsFrom(root)) return []
    // A region has no split — collapse to a single centred place-here target.
    return [{ shape: 'slot-rect', containerKind: 'sandwich', slotId: id, zone: 'center', band: CENTER_BAND }]
  },
}
