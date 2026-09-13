// AuElement — the shared base for EVERY <au-*> element in the default set.
//
// It homes cross-cutting BASELINE behaviour every au-* element should have, so it is not hand-repeated
// or silently missing. First universal: a `title` TOOLTIP that actually surfaces, on a controllable delay.
//
// THE GAP: a native `title` on an au-* host shows no tooltip — Chromium resolves a tooltip from the
// hovered node UP its OWN tree and never crosses from shadow content to the host, and even where it did,
// the native delay (~1.5s) is not adjustable. So AuElement is the universal TRIGGER DRIVER: it watches the
// native `title` (no new prop), and on hover/focus after
// TOOLTIP_DELAY_MS it shows an `<au-tooltip>` bubble through the host overlay's `tooltip` band via the
// shared `showTooltip` seam. The host `title` stays for the accessible name. When no overlay host is
// present (a standalone render) `showTooltip` returns null and we degrade to mirroring the title onto the
// shadow content, where the within-shadow walk-up surfaces the native tooltip.
//
// The LOOK (the bubble) and the WHERE (the claim + anchoring) live in `au-tooltip.ts`; AuElement owns only
// the trigger: hover/focus, the delay, and observing `title`. Behaviour-only + additive — no styles, no
// reactive properties — transparent to every subclass.

import { LitElement } from 'lit'
import { installBackdropMaterial } from './surface-material'
import { showTooltip, type TooltipHandle } from './au-tooltip'

const TOOLTIP_DELAY_MS = 1000

export class AuElement extends LitElement {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot()
    if (root instanceof ShadowRoot) installBackdropMaterial(root)
    return root
  }

  #tipTimer?: ReturnType<typeof setTimeout>
  #tip: TooltipHandle | null = null
  #titleObserver?: MutationObserver
  readonly #onEnter = (): void => this.#scheduleTip()
  readonly #onLeave = (): void => this.#hideTip()

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('pointerenter', this.#onEnter)
    this.addEventListener('pointerleave', this.#onLeave)
    this.addEventListener('pointerdown', this.#onLeave)
    this.addEventListener('focusin', this.#onEnter)
    this.addEventListener('focusout', this.#onLeave)
    // Reflect a live `el.title = '…'` change into a showing tip (or hide it if the title was cleared).
    this.#titleObserver ??= new MutationObserver(() => {
      if (!this.#tip) return
      const t = this.getAttribute('title')
      if (t) this.#tip.update(t)
      else this.#hideTip()
    })
    this.#titleObserver.observe(this, { attributes: true, attributeFilter: ['title'] })
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.removeEventListener('pointerenter', this.#onEnter)
    this.removeEventListener('pointerleave', this.#onLeave)
    this.removeEventListener('pointerdown', this.#onLeave)
    this.removeEventListener('focusin', this.#onEnter)
    this.removeEventListener('focusout', this.#onLeave)
    this.#titleObserver?.disconnect()
    this.#hideTip()
  }

  #scheduleTip(): void {
    if (this.hasAttribute('disabled') || !this.getAttribute('title')) return
    clearTimeout(this.#tipTimer)
    this.#tipTimer = setTimeout(() => this.#showTip(), TOOLTIP_DELAY_MS)
  }

  #showTip(): void {
    const text = this.getAttribute('title')
    if (!text || this.#tip) return
    const handle = showTooltip(this, text)
    if (handle) this.#tip = handle
    else this.#nativeFallback(text) // no overlay host (standalone render) → let the native tooltip show
  }

  #hideTip(): void {
    clearTimeout(this.#tipTimer)
    this.#tipTimer = undefined
    this.#tip?.hide()
    this.#tip = null
    this.#clearNativeFallback()
  }

  // Fallback for a standalone render (no overlay host): mirror the host `title` onto the shadow content,
  // where the within-shadow walk-up surfaces the NATIVE tooltip (browser delay). Cleared on leave.
  #nativeFallback(text: string): void {
    const root = this.renderRoot as ShadowRoot | undefined
    if (!root || !('children' in root)) return
    for (const el of Array.from(root.children)) {
      if (el instanceof HTMLElement && el.tagName !== 'STYLE') el.setAttribute('title', text)
    }
  }

  #clearNativeFallback(): void {
    const root = this.renderRoot as ShadowRoot | undefined
    if (!root || !('children' in root)) return
    for (const el of Array.from(root.children)) {
      if (el instanceof HTMLElement && el.tagName !== 'STYLE') el.removeAttribute('title')
    }
  }
}
