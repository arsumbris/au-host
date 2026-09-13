// <au-nav-item> — the default set's Lit SHADOW implementation of the `au-nav-item` contract.
//
// The sidebar / nav-list ROW: a shadow `<button>` with a leading `icon` slot, the default-slot label,
// and a `trailing` slot (a count / status dot). Emphasis is monochrome — rest is quiet ink on no
// fill, hover LIFTS the surface, selected firms to surface-2 with a hairline ring (no accent rail).
//
// SLOT CHROME: the icon / trail wrappers are hidden until their slot has content (a `slotchange`
// reflects `has-icon` / `has-trailing` on the host), so an icon-less row carries no empty gap.
//
// Contract discipline (mirrors <au-button>): `au-activate` is composed + bubbling; `disabled` reflects
// and suppresses activation; the gallery forces states via host `data-force-*` attributes. TOKEN-ONLY.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import { reducedControlMotion } from './control-motion'
export class AuNavItemElement extends AuElement {
  static properties = {
    selected: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    hasIcon: { type: Boolean, reflect: true, attribute: 'has-icon' },
    hasTrailing: { type: Boolean, reflect: true, attribute: 'has-trailing' },
  }

  declare selected: boolean
  declare disabled: boolean
  declare hasIcon: boolean
  declare hasTrailing: boolean

  constructor() {
    super()
    this.selected = false
    this.disabled = false
    this.hasIcon = false
    this.hasTrailing = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
    }
    button {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      width: 100%;
      min-height: var(--au-row-h, 32px);
      padding-inline: var(--au-space-2, 8px);
      border: 0;
      border-radius: var(--au-radius-row, 8px);
      background: none;
      color: var(--au-ink-3, #8a8a8a);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      text-align: start;
      cursor: pointer;
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .icon,
    .trail {
      display: none;
    }
    :host([has-icon]) .icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      color: var(--au-ink-4, #777);
      transition: color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    :host([has-trailing]) .trail {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--au-space-1, 4px);
      color: var(--au-ink-4, #777);
      font-variant-numeric: tabular-nums;
      transition: color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }

    /* ── hover (translucent lift, not a surface-ladder step) ── */
    button:hover:not(:disabled):not([data-sel]),
    :host([data-force-hover]:not([disabled]):not([data-force-disabled])) button:not([data-sel]) {
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.05));
      color: var(--au-ink-2, #c8c8c8);
    }
    button:active:not(:disabled):not([data-sel]),
    :host([data-force-active]:not([disabled]):not([data-force-disabled])) button:not([data-sel]) {
      background: var(--au-chrome-active, rgba(255, 255, 255, 0.09));
    }

    /* ── selected / current (surface-2 + hairline ring; NO left bar) ── */
    :host([selected]) button {
      background: var(--au-color-surface-2, #2a2a2a);
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
      color: var(--au-ink-1, #ededed);
    }
    :host([selected]) .icon,
    :host([selected]) .trail {
      color: var(--au-ink-2, #c8c8c8);
    }

    /* ── focus ── */
    button:focus-visible,
    :host([data-force-focus]) button {
      ${controlFocusStyle}
    }
    :host([selected]) button:focus-visible,
    :host([selected][data-force-focus]) button {
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
    }

    /* ── disabled ── */
    :host([disabled]) button,
    :host([data-force-disabled]) button {
      color: var(--au-ink-5, #555);
      background: none;
      box-shadow: none;
      cursor: default;
    }
    :host([disabled]) .icon,
    :host([disabled]) .trail,
    :host([data-force-disabled]) .icon,
    :host([data-force-disabled]) .trail {
      color: var(--au-ink-5, #555);
    }
  `

  private onClick(e: MouseEvent): void {
    if (this.disabled) {
      e.stopImmediatePropagation()
      return
    }
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  private onSlot(e: Event): void {
    const slot = e.target as HTMLSlotElement
    const has = slot
      .assignedNodes({ flatten: true })
      .some((n) => n.nodeType === Node.ELEMENT_NODE || (n.textContent ?? '').trim() !== '')
    if (slot.name === 'icon') this.hasIcon = has
    else if (slot.name === 'trailing') this.hasTrailing = has
  }

  render() {
    // `data-sel` mirrors `selected` onto the button so the `:not([data-sel])` hover/active guards work
    // inside the shadow (a `:host([selected])`-scoped `:not()` cannot reach back to the inner button).
    return html`
      <button
        part="button"
        type="button"
        ?disabled=${this.disabled}
        aria-current=${this.selected ? 'page' : nothing}
        ?data-sel=${this.selected}
        @click=${this.onClick}
      >
        <span class="icon" part="icon" aria-hidden="true"><slot name="icon" @slotchange=${this.onSlot}></slot></span>
        <span class="label" part="label"><slot></slot></span>
        <span class="trail" part="trail"><slot name="trailing" @slotchange=${this.onSlot}></slot></span>
      </button>
    `
  }
}
