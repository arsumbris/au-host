/** Emit tab-strip gaps for reorder/insert and a body slot rectangle for placement.
 * Emission reads DOM geometry without React state. The shared resolver selects
 * the deepest container target at the pointer; the tab body itself offers no split. */

import {
  CENTER_BAND,
  computeHorizontalInsertIndex,
  dragSourceIsFrom,
  visualToLogicalIndex,
  type ContainerDialect,
  type DragPoint,
  type DragSource,
  type DropTarget,
  type DropTargetShape,
} from '@arsumbris/container-kit'

/** The tabs body (a `slot-rect`): a tabs container has NO split of its own, so a drop
 *  anywhere on the body means "add a tab here". Collapse EVERY geometric zone to
 *  `center`, so the overlay draws ONE centred add-a-tab highlight — not four misleading
 *  edge-split bands (a tabs container is not bento). To split BESIDE the tabs container,
 *  use the PARENT container's frame ring (its own dialect), never the tabs body. */
function tabsSlotRect(slotId: string): DropTarget {
  return { shape: 'slot-rect', containerKind: 'tabs', slotId, zone: 'center', band: CENTER_BAND }
}

/** The public geometry read of the composed <au-tab-bar> — its cells live in the bar's shadow, so the
 *  dialect reads their screen rects through this contract instead of light-DOM `[data-tab-id]`. */
interface TabStripGeometry {
  tabCellRects(): { id: string; left: number; width: number }[]
}

/** The tab strip (a `gap`): a reorder insertion point over the bar's cells. `fromMe` is the DOM-identity
 *  same-container answer (the drag started in THIS tabs). `el` is the light-DOM gap wrapper; the cell
 *  geometry comes from the <au-tab-bar> it holds. */
function tabsGap(
  el: HTMLElement,
  slotId: string,
  point: DragPoint,
  source: DragSource,
  fromMe: boolean,
): DropTarget | null {
  const bar = el.querySelector('au-tab-bar') as unknown as TabStripGeometry | null
  const cells = bar?.tabCellRects() ?? []
  if (cells.length === 0) return null
  const rects = cells.map((c) => ({ left: c.left, width: c.width }))
  const visualIndex = computeHorizontalInsertIndex(rects, point.x)

  let toIndex = visualIndex
  // Same-strip reorder: shift the logical index by the source tab's position. A no-op position (the
  // tab's own neighbourhood) is NOT filtered here: the strip keeps CLAIMING its whole area during a
  // same-strip drag, so the reorder affordance shows over it instead of the enclosing pane's drop
  // falling through. The no-op is enforced at the COMMIT (moveWithin / reorder skip an unchanged move).
  if (fromMe) {
    const sourceIdx = cells.findIndex((c) => c.id === source.localId)
    if (sourceIdx >= 0) toIndex = visualToLogicalIndex(visualIndex, sourceIdx)
  }
  return { shape: 'gap', containerKind: 'tabs', slotId, index: toIndex, visualIndex }
}

/** The tabs drop dialect. A stable singleton — reads live DOM, no React state. */
export const tabsDropDialect: ContainerDialect = {
  resolveTargets(root: Element, point: DragPoint, source: DragSource): DropTarget[] {
    const doc = root.ownerDocument ?? document
    const el = doc.elementFromPoint(point.x, point.y)
    if (!el) return []
    // This tabs' own slot wrapper (tabs' root itself carries the slot attr; the CONTRIBUTED strip
    // wrapper declares one too, so a portaled strip's gap resolves to itself, not the pane owner).
    const mySlotEl = root.matches('[data-layout-container-slot]')
      ? root
      : root.querySelector(':scope > [data-layout-container-slot]') ?? root

    // Nearest tabs-owned droptarget under the cursor that belongs to THIS tabs.
    let cur: Element | null = el
    let dt: HTMLElement | null = null
    const stop = root.parentElement
    while (cur && cur !== stop) {
      const he = cur as HTMLElement
      if (he.dataset?.['containerKind'] === 'tabs' && he.dataset?.['droptargetShape']) {
        if (he.closest('[data-layout-container-slot]') === mySlotEl) {
          dt = he
          break
        }
      }
      cur = cur.parentElement
    }
    if (!dt) return []

    const shape = dt.dataset['droptargetShape'] as DropTargetShape
    const id = dt.dataset['droptargetId']
    if (!id) return []
    // Use the registered container root to identify a same-container source,
    // matching the shared router's ownership check.
    const fromMe = dragSourceIsFrom(root)

    if (shape === 'slot-rect') {
      // ALWAYS claim the body so the enclosing pane's own drop never wins over it. A SAME-tabs drop
      // here is a NO-OP (the tab is already in this tabs — the router's same-container slot-rect rule
      // handles it, keyed by the shared container id); a CROSS-container drop adds a tab (inject).
      return [tabsSlotRect(id)]
    }
    if (shape === 'gap') {
      const t = tabsGap(dt, id, point, source, fromMe)
      return t ? [t] : []
    }
    return []
  },
}
