// Editor preview fallback for hosts without a preview capability. The shared hovercard owns the
// surface; this adapter owns viewport clamping, pointer containment, dismissal and asynchronous fill.

import type { FillFn } from '@arsumbris/preview-content'
export type { FillFn }

export interface HoverCard {
  /** Show `key`'s content (built by `fill`), anchored to `rect`, clamped to the viewport. The
   *  `linkResolver` (nesting) is accepted for signature-compat with the host surface; this local
   *  FALLBACK card is a singleton and ignores it (no nesting without the host stack). */
  show(key: string, rect: DOMRect, fill: FillFn, linkResolver?: (path: string) => FillFn): void
  hide(): void
  isOver(x: number, y: number): boolean
  isShowing(key: string): boolean
  dispose(): void
}

const MARGIN = 8

// The hover-card's component CSS. The card mounts INTO the editor's own root subtree, so the editor
// folds this into its ONE `host.styles.inject(..., container)` call (a second inject on the same root
// would overwrite the `data-au-scope` marker and un-scope the editor's own sheet). Exported for that.
export const HOVER_CARD_CSS = `
.au-pcard { position: fixed; z-index: var(--au-z-popover); box-sizing: border-box; width: 460px; max-width: calc(100vw - 16px);
  overflow: auto; font: var(--au-t-xs)/var(--au-lh-xs) var(--au-font-mono); }
.au-pcard-header { position: sticky; top: 0; background: var(--au-elev-5-fill); padding: var(--au-space-2) var(--au-space-2-5);
  border-bottom: 1px solid var(--au-color-border); font-weight: var(--au-w-strong); display: flex; gap: var(--au-space-2); align-items: baseline; flex-wrap: wrap; }
.au-pcard-name { color: var(--au-color-accent); }
.au-pcard-types { color: var(--au-ink-3); font-weight: var(--au-w-body); font-size: var(--au-t-2xs); }
.au-pcard-section { padding: var(--au-space-2) var(--au-space-2-5); border-bottom: 1px solid color-mix(in srgb, var(--au-color-border) 60%, transparent); }
.au-pcard-section:last-child { border-bottom: none; }
.au-pcard-label { font-size: var(--au-t-2xs); font-weight: var(--au-w-medium); color: var(--au-ink-3); margin-bottom: var(--au-space-1); }
.au-pcard-pre { margin: 0; white-space: pre-wrap; word-break: break-word; line-height: var(--au-lh-base); }
.au-pcard-sub { color: var(--au-ink-3); margin-top: var(--au-space-1); }
.au-pcard-doc { color: var(--au-ink-2); margin-top: var(--au-space-1); white-space: pre-wrap; }
/* gutter-numbered code (context / body) */
.au-pcard-code { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: var(--au-space-2); line-height: var(--au-lh-base); }
.au-pcard-gutter { text-align: right; color: var(--au-ink-4); user-select: none; -webkit-user-select: none; white-space: pre; }
.au-pcard-codeline { white-space: pre-wrap; overflow-wrap: anywhere; }
.au-pcard-codeline.target { background: color-mix(in srgb, var(--au-color-accent) 16%, transparent); border-radius: var(--au-radius-sm); }
.au-pcard-gutter.target { color: var(--au-color-accent); }
.au-pcard-muted { color: var(--au-ink-4); padding: var(--au-space-2) var(--au-space-2-5); }
.au-pcard-error { color: var(--au-color-danger); padding: var(--au-space-2) var(--au-space-2-5); }
/* Inline error line INSIDE a section, which already pads — so this one must not. */
.au-pcard-error-text { color: var(--au-color-danger); }
/* highlight classes (own copy — the editor's are scoped to .cm-content, so they don't reach here) */
.au-pcard .au-tok-key { color: var(--au-color-accent); }
.au-pcard .au-tok-heading { color: var(--au-color-text); font-weight: var(--au-w-strong); }
.au-pcard .au-tok-comment { color: var(--au-color-muted); font-style: italic; }
.au-pcard .au-tok-val-string { color: var(--au-color-ok); }
.au-pcard .au-tok-val-number { color: var(--au-color-warn); }
.au-pcard .au-tok-val-bool { color: var(--au-color-cyan); }
.au-pcard .au-tok-val-ref { color: var(--au-color-accent); }
.au-pcard .au-tok-wikilink { color: var(--au-color-accent); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--au-color-accent) 40%, transparent); }
.au-pcard .au-tok-broken-wikilink { color: var(--au-color-danger); }
.au-pcard .au-tok-blockid { color: var(--au-color-anchor); }
`

export function createHoverCard(deps: { root: HTMLElement }): HoverCard {
  const { root } = deps

  // No own `<style>`: the editor injects `HOVER_CARD_CSS` in its single scoped sheet (see the const
  // above). The card mounts under `root`, so the editor's `@scope` marker reaches it.

  let el: HTMLElement | null = null
  let currentKey: string | null = null
  let gen = 0
  let onKey: ((e: KeyboardEvent) => void) | null = null

  function ensureEl(): HTMLElement {
    if (!el) {
      el = document.createElement('au-hovercard')
      el.className = 'au-pcard'
      root.appendChild(el)
      onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') hide()
      }
      document.addEventListener('keydown', onKey)
    }
    return el
  }

  // Clamp to the viewport: pick the side (above/below the anchor) with more room, cap max-height
  // to it (the card scrolls inside), and keep the left edge on screen.
  function clamp(card: HTMLElement, rect: DOMRect): void {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(card.offsetWidth || 460, vw - 2 * MARGIN)
    const left = Math.max(MARGIN, Math.min(rect.left, vw - width - MARGIN))
    card.style.left = `${left}px`
    const below = vh - rect.bottom - MARGIN
    const above = rect.top - MARGIN
    if (below >= above) {
      card.style.top = `${rect.bottom + 4}px`
      card.style.bottom = ''
      card.style.maxHeight = `${Math.max(80, below)}px`
    } else {
      card.style.bottom = `${vh - rect.top + 4}px`
      card.style.top = ''
      card.style.maxHeight = `${Math.max(80, above)}px`
    }
  }

  function show(key: string, rect: DOMRect, fill: FillFn): void {
    const myGen = ++gen
    currentKey = key
    const card = ensureEl()
    card.replaceChildren()
    clamp(card, rect) // size from the anchor up front (width is fixed); content scrolls within
    const isCurrent = (): boolean => myGen === gen
    void Promise.resolve(fill(card, isCurrent)).then(() => {
      if (isCurrent()) clamp(card, rect) // re-clamp once content settled (left edge vs final width)
    })
  }

  function hide(): void {
    gen++ // drop any in-flight fill
    currentKey = null
    if (el) {
      el.remove()
      el = null
    }
    if (onKey) {
      document.removeEventListener('keydown', onKey)
      onKey = null
    }
  }

  return {
    show,
    hide,
    isShowing: (key) => currentKey === key,
    isOver(x, y) {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    },
    dispose() {
      hide()
    },
  }
}
