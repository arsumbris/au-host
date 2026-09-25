// The TEMPORARY reveal-all-pane-headers signal. `toggle-pane-headers-intent` flips
// `<html data-au-pane-headers="show">`; every container HONOURS it to un-hide a `hideHeader` position's
// header WITHOUT touching the authored layout — the reach for a self-chrome pane whose header (and its ⋯
// actions) is otherwise off-screen. A DOM attribute on the document root (not a view-state channel), so a
// vanilla container observes it the same way a React one does; this module is its single home so no
// container re-implements the observer.

import { useEffect, useState } from 'react'

const ATTR = 'data-au-pane-headers'

/** Whether pane headers are currently force-revealed (the toggle is on). */
export function revealPaneHeadersActive(): boolean {
  return document.documentElement.dataset.auPaneHeaders === 'show'
}

/** Observe the reveal flag; `onChange` fires whenever it flips. Returns a disposer. For vanilla containers. */
export function subscribeRevealPaneHeaders(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] })
  return () => observer.disconnect()
}

/** React binding for the reveal flag — reactive across the toggle, so a container re-renders on flip. */
export function useRevealPaneHeaders(): boolean {
  const [reveal, setReveal] = useState(revealPaneHeadersActive)
  useEffect(() => subscribeRevealPaneHeaders(() => setReveal(revealPaneHeadersActive())), [])
  return reveal
}
