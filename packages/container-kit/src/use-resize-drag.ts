/**
 * The shared pointer-capture boilerplate for a container's resize sash.
 *
 * A sash drag is the same lifecycle in every dialect: capture the pointer on
 * pointerdown, follow pointermove, release on pointerup / pointercancel, clean
 * up the listeners. Authored ONCE here so every container composes it instead of
 * re-rolling the capture + listener + cleanup dance and drifting.
 *
 * The PHYSICS stays per-container (bento maps a delta to a split ratio, a column
 * to a row height), so the hook owns none of it: `begin` runs on pointerdown, the
 * consumer reads its own start geometry there and returns the move / end handlers
 * (or `null` to decline the gesture, e.g. a zero-size parent). `dragging` reflects
 * the in-flight state, so a sash element (`<au-splitter dragging>`) lifts its look
 * for free.
 *
 */

import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface ResizeDragHandlers {
  /** Follows every pointermove while the gesture is live. */
  onMove: (e: PointerEvent) => void
  /** Ends the gesture. `commit` is true on pointerup, false on pointercancel. */
  onEnd?: (commit: boolean) => void
}

/**
 * `begin` fires on pointerdown with the React event, so the consumer captures its
 * own start geometry there and returns the move / end handlers. Returning `null`
 * declines the gesture (nothing is captured, no listeners bind).
 */
export function useResizeDrag(
  begin: (e: ReactPointerEvent) => ResizeDragHandlers | null,
): { onPointerDown: (e: ReactPointerEvent) => void; dragging: boolean } {
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const el = e.currentTarget as HTMLElement
      const handlers = begin(e)
      if (!handlers) return
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      setDragging(true)

      const onMove = (ev: PointerEvent): void => handlers.onMove(ev)
      const onUp = (ev: PointerEvent): void => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
        setDragging(false)
        handlers.onEnd?.(ev.type === 'pointerup')
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
    },
    [begin],
  )

  return { onPointerDown, dragging }
}
