/** Dock participates in the shared drag protocol without React. It offers no drop
 * targets: bars are added, moved and removed through dock's own menu.
 * The container occupying the centre owns its own drop targets. */

import type { ContainerDialect, DragPoint, DragSource, DropTarget } from '@arsumbris/container-core'

/** This container's kind tag, as it appears in the DOM (`data-container-kind`). */
export const DOCK_KIND = 'dock'

export const dockDropDialect: ContainerDialect = {
  // Edges offer no targets; the centre belongs to its child container.
  resolveTargets(_root: Element, _point: DragPoint, _source: DragSource): DropTarget[] {
    return []
  },
}
