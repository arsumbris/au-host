/**
 * The `column` container's drop DIALECT. A column is a VERTICAL stack, so a drop on
 * an item resolves by VERTICAL position: the top third = insert ABOVE, the bottom
 * third = insert BELOW, the middle = wrap-into-tabs (center, the generic router path).
 * Each item section carries a `slot-rect` (tagged `container-kind="column"`); the
 * overlay's rect bands render top/bottom/center directly, no custom overlay needed.
 *
 * Emission is DOM-driven (no React state). deepest-wins resolves the overlap with a
 * nested container in an item (that container's own dialect wins deeper). An empty
 * column emits one whole-column slot-rect (drop = add the first item).
 *
 *
 */

import {
  dragSourceIsFrom,
  type ContainerDialect,
  type BandFrac,
  type DragPoint,
  type DragSource,
  type DropTarget,
  type DropZone,
} from '@arsumbris/container-kit'

/** A column item's vertical zone: top third = insert above, bottom third = below,
 *  middle = center (wrap-into-tabs). Ignores X — a column has no left/right. */
function columnZone(rect: DOMRect, y: number): Extract<DropZone, 'top' | 'bottom' | 'center'> {
  const t = rect.height > 0 ? (y - rect.top) / rect.height : 0.5
  if (t < 0.33) return 'top'
  if (t > 0.67) return 'bottom'
  return 'center'
}

/** The highlight band for a column zone, on column's OWN THIRDS basis — so the overlay draws the third
 *  the drop actually lands in, not a quarter. Matches `columnZone`'s 0.33 / 0.67 boundaries. */
function columnBandFrac(zone: Extract<DropZone, 'top' | 'bottom' | 'center'>): BandFrac {
  switch (zone) {
    case 'top':
      return { x: 0, y: 0, w: 1, h: 0.33 }
    case 'bottom':
      return { x: 0, y: 0.67, w: 1, h: 0.33 }
    case 'center':
      return { x: 0, y: 0.33, w: 1, h: 0.34 }
  }
}

export const columnDropDialect: ContainerDialect = {
  resolveTargets(root: Element, point: DragPoint, source: DragSource): DropTarget[] {
    const doc = root.ownerDocument ?? document
    const el = doc.elementFromPoint(point.x, point.y)
    if (!el) return []
    const mySlotEl = root.matches('[data-layout-container-slot]')
      ? root
      : root.querySelector(':scope > [data-layout-container-slot]') ?? root

    // Nearest column-owned slot-rect under the cursor that belongs to THIS column.
    let cur: Element | null = el
    let dt: HTMLElement | null = null
    const stop = root.parentElement
    while (cur && cur !== stop) {
      const he = cur as HTMLElement
      if (he.dataset?.['containerKind'] === 'column' && he.dataset?.['droptargetShape'] === 'slot-rect') {
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
    // Use the registered container root to identify a same-container source,
    // matching the shared router's ownership check.
    const sameContainer = dragSourceIsFrom(root)
    // An item dropped onto its OWN section is a no-op.
    if (source.localId === id && sameContainer) return []
    const rect = dt.getBoundingClientRect()
    let zone = columnZone(rect, point.y)
    // Same-column drag = REORDER only (never wrap-into-tabs, which would duplicate via
    // extract-then-set on one container). Force a center hit to the nearest edge.
    if (sameContainer && zone === 'center') zone = point.y < rect.top + rect.height / 2 ? 'top' : 'bottom'
    // `allowWrap: false` SUPPRESSES the centre zone rather than refusing it later — a curated
    // column offers stack-above / stack-below and never wrap-into-a-group, so a preview never
    // promises a placement that will not happen.
    //
    // Read off the container's OWN root, which `resolveTargets` already receives.
    // A container declaring on its own element is
    // framework-free and works for a vanilla container too.
    if (zone === 'center' && (root as HTMLElement).dataset?.['allowWrap'] === 'false') {
      zone = point.y < rect.top + rect.height / 2 ? 'top' : 'bottom'
    }
    return [{ shape: 'slot-rect', containerKind: 'column', slotId: id, zone, band: columnBandFrac(zone) }]
  },
}
