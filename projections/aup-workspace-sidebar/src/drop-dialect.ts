/**
 * The `rail` container's drop DIALECT: how it emits drop targets at a cursor point. The rail is a
 * top | body | foot frame; only the BODY is a placement slot, and it holds a container (a column), so:
 *
 *   - the top / foot CHROME carry no `data-droptarget-*` attrs → they resolve to no target, so a drag
 *     never lands on the workspace switcher or the settings row. The frame is curated, not a drop zone.
 *   - the BODY emits a single centred `slot-rect` (place-here), exactly like a sandwich region. The
 *     column nested inside emits its own stacking zones and wins deeper (deepest-wins), so "drop a view
 *     into the sidebar" is the column's job, not the rail's.
 *
 * Emission is DOM-driven (no React state): the body carries the generic `data-droptarget-*` attrs +
 * `data-layout-container-slot` on the rail root for scoping. Structurally mirrors the sandwich dialect,
 * narrowed to one region.
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

export const railDropDialect: ContainerDialect = {
  resolveTargets(root: Element, point: DragPoint): DropTarget[] {
    const doc = root.ownerDocument ?? document
    const el = doc.elementFromPoint(point.x, point.y)
    if (!el) return []
    // This rail's own slot wrapper (its root carries the slot attr).
    const mySlotEl = root.matches('[data-layout-container-slot]')
      ? root
      : root.querySelector(':scope > [data-layout-container-slot]') ?? root

    // Nearest rail-owned droptarget under the cursor that belongs to THIS rail.
    let cur: Element | null = el
    let dt: HTMLElement | null = null
    const stop = root.parentElement
    while (cur && cur !== stop) {
      const he = cur as HTMLElement
      if (he.dataset?.['containerKind'] === 'rail' && he.dataset?.['droptargetShape'] === 'slot-rect') {
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
    // Same-rail drag = no target (the body is one fixed region; you drag content OUT to another
    // container, not within). Same-container by DOM IDENTITY — the one truthmaker the router uses too.
    if (dragSourceIsFrom(root)) return []
    // The body has no split — one centred place-here target.
    return [{ shape: 'slot-rect', containerKind: 'rail', slotId: id, zone: 'center', band: CENTER_BAND }]
  },
}
