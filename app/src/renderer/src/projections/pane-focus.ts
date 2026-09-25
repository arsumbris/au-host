// The host-side "which pane holds DOM focus" resolver — shared by every window's focus tracker (the main
// window's authority tracker and each surface window's tracker). DOM focus is the host's single focus
// source; this maps `document.activeElement` to the pane `^:` it sits in.


/** The `^:` of the pane holding DOM focus in THIS window, or undefined. Descends into shadow roots to the
 *  DEEPEST active element (a focused element inside an `<au-*>` component), then walks UP — crossing shadow
 *  boundaries via each root's `host` — to the nearest `[data-pane-id]` (a pane host tags its box with its
 *  `^:`). The resolver behind the per-window focus tracker, the close-view target, and keybind arbitration. */
export function paneIdOfActiveElement(): string | undefined {
  let el: Element | null = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  while (el) {
    const id = el.getAttribute('data-pane-id')
    if (id) return id
    const parent = el.parentElement
    if (parent) { el = parent; continue }
    const root = el.getRootNode()
    el = root instanceof ShadowRoot ? root.host : null
  }
  return undefined
}

/**
 * Move REAL DOM focus into the pane with this `^:`, in THIS window's document. The lightweight core of a
 * pane focus: find the pane's flat host box (`[data-pane-id]`, excluding the hover-frame host), focus the
 * best focusable element inside it, else the box itself. Idempotent — a no-op when that pane already holds
 * focus, so a redundant call never disrupts a selection or scroll. Used where the richer app `focusPane`
 * (with its remembered-target restore + `activatePane`) is not reachable — notably a surface window's
 * mount-agent, so a floated container's visible-child change moves focus the same as the main window's.
 * Returns whether focus landed inside the pane.
 */
export function focusWithinPane(nodeId: string): boolean {
  const box = document.querySelector<HTMLElement>(
    `[data-pane-id="${CSS.escape(nodeId)}"]:not([data-pane-host])`,
  )
  if (!box) return false
  const candidates = box.querySelectorAll<HTMLElement>(
    '[contenteditable="true"],textarea,input:not([type="hidden"]),button:not(:disabled),[tabindex="0"]',
  )
  for (const candidate of candidates) {
    if (!candidate.getClientRects().length || candidate.closest('[hidden],[inert]') || getComputedStyle(candidate).visibility === 'hidden') continue
    candidate.focus({ preventScroll: true })
    if (paneIdOfActiveElement() === nodeId) return true
  }
  box.tabIndex = -1
  box.focus({ preventScroll: true })
  return false // fell back to the box: content not yet focusable
}

/**
 * The timing-tolerant {@link focusWithinPane}: the surface twin of the main window's `focusPaneWhenReady`.
 * Retry over up to `frames` frames until a real content element in the pane takes focus, aborting if focus
 * lands in a DIFFERENT pane meanwhile (a user click). A bare box focus in the interim already fixes routing
 * / close-view, so an exhausted retry that only reached the box is still correct.
 */
export function focusWithinPaneWhenReady(nodeId: string, frames = 40): void {
  let placed = false // set once the pane's box or content has taken focus
  const attempt = (left: number): void => {
    // Abort only AFTER we placed focus AND focus moved to a DIFFERENT PANE (a real user action). A transient
    // blur to nothing during a remount-churn must not abort (it stranded the survivor on a close); before we
    // place focus, the current pane is the OPENER we move away from, so it must not abort either.
    const cur = paneIdOfActiveElement()
    if (placed && cur != null && cur !== nodeId) return
    const box = document.querySelector(`[data-pane-id="${CSS.escape(nodeId)}"]:not([data-pane-host])`)
    if (box) {
      placed = true
      if (focusWithinPane(nodeId)) return // real content focused — done
    }
    if (left <= 0) return
    requestAnimationFrame(() => attempt(left - 1))
  }
  requestAnimationFrame(() => attempt(frames))
}
