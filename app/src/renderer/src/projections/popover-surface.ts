// The host's POPOVER SURFACE: an INTERACTIVE floating panel anchored to a trigger — the click-opened,
// focus-holding sibling of the preview peek and the rows-only context menu.
//
// The host owns the CHROME: claiming the overlay layer, anchoring to the trigger rect with viewport
// edge-flip, and dismissal (Escape / outside pointerdown / window blur / window resize / handle.close()).
// The caller supplies the CONTENT via a `fill`, the same frame-vs-content seam as `preview.show` and the
// confirm modal. Unlike the context menu it holds arbitrary interactive controls (an input, a select);
// unlike the preview it does NOT dismiss on pointer-move, so you can move the mouse to a field and type.
//
// IT DRAWS INTO THE OVERLAY SITE at the `dropdown` band — a click-opened menu belongs there, beside the
// context menu — so it never touches `document.body`: the site owns the layer + the stacking, this owns
// the panel. A per-window singleton, like the other host surfaces.

import type { FillFn, OverlaySite, PopoverHandle, PopoverSurface } from '@arsumbris/au-host-sdk'

/** Viewport gap kept when the panel is flipped or clamped at an edge. */
const MARGIN = 8
/** Gap between the trigger and the panel. */
const GAP = 4

export function createPopoverSurface(site: OverlaySite): PopoverSurface {
  const layer = site.claim({ level: 'dropdown' })
  // The overlay ROOT (parent of every claimed layer). A pointerdown that lands anywhere in it is a
  // click on chrome ABOVE the composition — a nested overlay control the panel itself raised, an
  // `au-select` listbox above all others — never an "outside" click. The root and its layers are
  // `pointer-events:none`, so a click on the composition beneath targets the app element instead and
  // is NOT contained here. This is the general form of the reasoning `au-select` states for its own
  // out-of-element listbox ("treat it as inside too"), applied to any control the panel hosts.
  const overlayRoot = layer.el.parentElement

  /** The live panel, or null when nothing is open. */
  let panel: HTMLElement | null = null
  let anchor: DOMRect | null = null
  let onDismiss: (() => void) | null = null
  let ro: ResizeObserver | null = null
  /** Bumped on every open, so a superseded handle goes inert. */
  let generation = 0
  let finishExit: (() => void) | null = null

  /** Anchor below the trigger, flipping above when it would overflow the bottom; clamp horizontally. */
  function place(): void {
    if (!panel || !anchor) return
    const w = panel.offsetWidth
    const h = panel.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = anchor.left
    if (left + w > vw - MARGIN) left = vw - MARGIN - w
    left = Math.max(MARGIN, left)
    const below = vh - anchor.bottom - GAP
    let top = anchor.bottom + GAP
    if (h > below && anchor.top - GAP > below) top = Math.max(MARGIN, anchor.top - GAP - h)
    top = Math.min(top, Math.max(MARGIN, vh - MARGIN - h))
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
  }

  function close(): void {
    if (!panel) return
    ro?.disconnect()
    ro = null
    const closing = panel
    closing.inert = true
    closing.style.pointerEvents = 'none'
    panel = null
    anchor = null
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', close)
    window.removeEventListener('resize', close)
    // Fire ONCE, and null it BEFORE calling so a re-entrant close from the callback is a no-op.
    const cb = onDismiss
    onDismiss = null
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      closing.remove()
      if (finishExit === finish) finishExit = null
      cb?.()
    }
    finishExit = finish
    // Presentation elements declare their own exit; the host knows no component-set timing.
    const surfaces = Array.from(closing.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
    surfaces.forEach(el => el.setAttribute('data-state', 'closed'))
    const animations = surfaces.flatMap(el => el.getAnimations()).filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
    if (!animations.length) finish()
    else void Promise.allSettled(animations.map(a => a.finished)).then(finish)
  }

  function onOutside(e: PointerEvent): void {
    if (!panel) return
    const target = e.target as Node
    // Inside the panel, or inside any overlay layer (a nested control's raised menu) → keep open.
    if (panel.contains(target) || overlayRoot?.contains(target)) return
    // A pointerdown on the ANCHOR (the trigger) is not an outside click: let the trigger's own click
    // handler toggle the popover, rather than closing it here a frame before that click reopens it.
    if (anchor && e.clientX >= anchor.left && e.clientX <= anchor.right && e.clientY >= anchor.top && e.clientY <= anchor.bottom) return
    close()
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return {
    open(triggerRect, fill: FillFn, dismissCb): PopoverHandle {
      close() // supersede any live popover
      finishExit?.()
      const mine = ++generation
      anchor = triggerRect
      onDismiss = dismissCb ?? null
      const el = document.createElement('div')
      // The layer is `pointer-events:none` so the app beneath stays live; the panel re-enables itself.
      el.style.cssText = 'position:fixed;pointer-events:auto;'
      layer.el.appendChild(el)
      panel = el
      const isCurrent = (): boolean => generation === mine && panel === el
      // Re-place whenever the filled content changes size — a React/portal fill mounts its content
      // AFTER `fill` returns, so the first `place` below sees an empty box; the observer corrects it.
      ro = new ResizeObserver(() => {
        if (isCurrent()) place()
      })
      ro.observe(el)
      void Promise.resolve(fill(el, isCurrent)).then(() => {
        if (isCurrent()) place()
      })
      place()
      // Keyboard is live immediately; the outside-pointerdown listener is deferred one tick so the
      // opening click does not dismiss the popover it just summoned (the context menu's asymmetry).
      document.addEventListener('keydown', onKey, true)
      window.addEventListener('blur', close)
      window.addEventListener('resize', close)
      setTimeout(() => {
        if (isCurrent()) document.addEventListener('pointerdown', onOutside, true)
      })
      return {
        close(): void {
          // INERT once superseded: a stale handle must not close the popover that replaced it.
          if (generation === mine) close()
        },
      }
    },
  }
}

// Per-window singleton, like the other host surfaces. Built over the overlay SITE, so it names neither
// `document.body` nor a z-index.
let singleton: PopoverSurface | null = null
export function getPopoverSurface(site: OverlaySite): PopoverSurface {
  return (singleton ??= createPopoverSurface(site))
}
