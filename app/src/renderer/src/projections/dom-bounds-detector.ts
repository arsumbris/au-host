// Detect direct `document.body` children outside the sanctioned composition and overlay roots.
// A projection draws overlays through `host.overlay`; an unsanctioned append reports a diagnostic.
// The detector observes DOM ownership, not layout or paint.

import { reportHostDiagnostic } from '@arsumbris/au-host-sdk'

import { ROOT_CLASS as OVERLAY_ROOT_CLASS } from './overlay-site'

/** What the detector recognizes as a sanctioned owner of a `document.body` child. */
export interface DomBoundsContext {
  /** The composition root element (`#root`). Never re-added in practice, allowlisted defensively. */
  appRoot: Element | null
  /** The overlay site's root class, so its lazy self-append is never flagged. */
  overlayRootClass: string
}

/**
 * Is `node` an out-of-bounds addition to `document.body`?
 *
 * Only ELEMENTS count: a text or comment node is layout noise, not a mount. The composition root and
 * the overlay site's root are the two sanctioned owners; everything else is an escape.
 */
export function isOutOfBounds(node: Node, ctx: DomBoundsContext): boolean {
  if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) return false
  const el = node as Element
  if (el === ctx.appRoot) return false
  if (el.classList.contains(ctx.overlayRootClass)) return false
  return true
}

/** A short, stable label for the offending element: `tag#id.class`. */
export function describeNode(el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const cls = el.classList.length ? `.${[...el.classList].join('.')}` : ''
  return `${el.tagName.toLowerCase()}${id}${cls}`
}

/** The diagnostic code. Open kebab-case; a surfacer matches on this, never the message. */
export const OUT_OF_BOUNDS_CODE = 'host-dom-out-of-bounds'

/**
 * Install the detector over the main renderer's `document.body`. Returns a disconnect handle.
 *
 * The DEV gate is at the CALL SITE (`main.tsx`), not here, so this stays env-agnostic and testable.
 * Installed on the MAIN window only; the surface renderer has its own entry and legitimately
 * hosts a drag overlay on its body.
 */
export function installDomBoundsDetector(): () => void {
  const ctx: DomBoundsContext = {
    appRoot: document.getElementById('root'),
    overlayRootClass: OVERLAY_ROOT_CLASS,
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!isOutOfBounds(node, ctx)) return
        reportHostDiagnostic({
          code: OUT_OF_BOUNDS_CODE,
          severity: 'warning',
          message:
            'a node was added directly to document.body, outside the composition root and the overlay site. Draw through host.overlay (or host.contextMenu) instead, so the host owns the frame and the z-order.',
          subject: describeNode(node as Element),
        })
      })
    }
  })
  observer.observe(document.body, { childList: true })
  return () => observer.disconnect()
}
