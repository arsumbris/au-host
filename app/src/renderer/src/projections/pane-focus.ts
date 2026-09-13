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
