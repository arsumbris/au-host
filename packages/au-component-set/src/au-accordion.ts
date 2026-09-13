// <au-accordion> — the collapsible / disclosure GROUP that coordinates its <au-accordion-item> children.
//
// This Lit group coordinates its items by (a) propagating `variant` / `density` onto each item (a descendant
// selector cannot cross the shadow boundary, so the item styles itself from its own attributes), (b) owning
// the open-state policy on the bubbled `au-toggle` — `single` (opening one closes its siblings, optionally
// `collapsible`) or `multiple` (independent), and (c) keyboard roving Arrow/Home/End across item triggers.
//
// A grouped item does NOT self-toggle (it defers to the group); a lone <au-accordion-item> with no group
// parent toggles itself. Emits `au-change` (detail `{ open: string[] }`, the open values). TOKEN-ONLY
// (the group paints its own container frame; the item paints its rows).

import { css, html } from 'lit'
import { AuElement } from './au-element'
import type { AuAccordionItemElement } from './au-accordion-item'

export class AuAccordionElement extends AuElement {
  static properties = {
    mode: { type: String, reflect: true },
    variant: { type: String, reflect: true },
    density: { type: String, reflect: true },
    collapsible: { type: Boolean },
  }

  declare mode: 'single' | 'multiple'
  declare variant: 'flush' | 'card' | 'inline'
  declare density: 'compact' | 'default' | 'relaxed'
  declare collapsible: boolean

  constructor() {
    super()
    this.mode = 'multiple'
    this.variant = 'flush'
    this.density = 'default'
    this.collapsible = false
    this.addEventListener('au-toggle', this.#onToggle as EventListener)
    this.addEventListener('keydown', this.#onKeyDown)
  }

  #items(): AuAccordionItemElement[] {
    return Array.from(this.querySelectorAll(':scope > au-accordion-item')) as AuAccordionItemElement[]
  }

  // Propagate the container treatment onto each item and set flush dividers (every item but the first).
  #syncItems(): void {
    const flush = this.variant === 'flush'
    this.#items().forEach((it, i) => {
      it.setAttribute('variant', this.variant)
      it.setAttribute('density', this.density)
      it.toggleAttribute('data-divided', flush && i > 0)
    })
  }

  updated(): void {
    this.#syncItems()
  }

  #emitChange(): void {
    const open = this.#items().filter((it) => it.open).map((it) => it.value)
    this.dispatchEvent(new CustomEvent('au-change', { detail: { open }, bubbles: true, composed: true }))
  }

  #onToggle = (e: CustomEvent): void => {
    const item = e.target as AuAccordionItemElement
    if (item.closest('au-accordion') !== this) return // belongs to a nested group
    const isOpen = item.open
    if (this.mode === 'single') {
      if (isOpen) {
        if (this.collapsible) item.open = false
        else return
      } else {
        for (const it of this.#items()) it.open = false
        item.open = true
      }
    } else {
      item.open = !isOpen
    }
    this.#emitChange()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = this.#items().filter((it) => !it.disabled)
    if (items.length === 0) return
    const path = e.composedPath()
    const cur = items.findIndex((it) => path.includes(it))
    if (cur < 0) return
    let next = cur
    if (e.key === 'ArrowDown') next = (cur + 1) % items.length
    else if (e.key === 'ArrowUp') next = (cur - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    e.preventDefault()
    items[next]?.focusTrigger()
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    :host([variant='flush']) {
      border-radius: var(--au-radius-row, 8px);
      box-shadow: inset 0 0 0 1px var(--au-line-1, rgba(255, 255, 255, 0.08));
      overflow: hidden;
    }
    :host([variant='card']),
    :host([variant='inline']) {
      display: flex;
      flex-direction: column;
      gap: var(--au-space-2, 8px);
    }
  `

  render() {
    return html`<slot @slotchange=${() => this.#syncItems()}></slot>`
  }
}
