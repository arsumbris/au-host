// The on-screen bounds of a composition node's slot, resolved from the container substrate's own DOM
// conventions. This is where "how big a node is on screen" lives — a substrate concern — so consumers
// (the spatial chooser, and anything else that needs to draw over a node) ask for a rect instead of
// re-deriving it from `data-*` attributes themselves.

/**
 * The full on-screen bounds of the node whose slot is `[data-pane-id="<anchor>"]`, as ONE rect.
 *
 * A leaf pane is just its own box. A CONTAINER, though, is spread across several PORTALED regions — a
 * tabs group renders its tab-bar header in one place and its content pane in another — so the
 * `[data-pane-id]` slot alone covers only the content and, for a nested container, coincides exactly
 * with the pane it holds. Every region of ONE container declares the SAME `data-container-id` (the tabs
 * header and body both carry it), so the container's true extent is the UNION of every element sharing
 * that id. A leaf carries no `data-container-id` descendant, so it is just its own box — which is how a
 * container is told apart from the leaf it wraps even when their slot boxes are identical.
 *
 * Resolved live from the DOM each call (nothing stored), so a caller re-asking on resize tracks it.
 * Returns null when the slot is absent or off-screen (zero-area).
 */
export function slotBounds(anchor: string): DOMRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(anchor)}"]`)
  if (!el) return null
  const rects = [el.getBoundingClientRect()]
  const groupId = el.querySelector('[data-container-id]')?.getAttribute('data-container-id')
  if (groupId)
    for (const region of document.querySelectorAll(`[data-container-id="${CSS.escape(groupId)}"]`)) rects.push(region.getBoundingClientRect())
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  if (right - left <= 0 || bottom - top <= 0) return null
  return new DOMRect(left, top, right - left, bottom - top)
}
