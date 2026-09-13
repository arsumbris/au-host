// <au-segmented-control> — the default set's Lit SHADOW implementation of the `au-segmented-control`
// contract. An exclusive choice group: a quiet pill-in-tray where only the ACTIVE segment is in the
// tab order (roving tabindex), and Arrow keys + Home/End move selection with focus
// following it.
//
// Contract: `items` PROPERTY (an array of `{ value, label, icon? }`, set in JS) + a `value` attribute.
// Emits `au-change` (detail `{ value }`, composed + bubbling) on select. `icon` is an au-icon glyph
// NAME (a string), not a framework node — the data-driven rule.
//
// TOKEN-ONLY: base `--au-*` tokens with literal floors. A
// `data-force-*` twin on a segment lets the gallery states matrix force hover/focus.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { controlFocusStyle } from './focus-style'
/** One segment: a stable value, its label, and an optional leading au-icon glyph name. */
export interface AuSegmentItem {
  value: string
  label: string
  icon?: string
}

export class AuSegmentedControlElement extends AuElement {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('button[tabindex="0"]')?.focus(options)
  }

  static properties = {
    items: { attribute: false },
    value: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    label: { type: String }, // accessible name for the choice group
  }

  declare items: AuSegmentItem[]
  declare value: string
  declare disabled: boolean
  declare label?: string

  constructor() {
    super()
    this.items = []
    this.value = ''
    this.disabled = false
  }

  private get activeIndex(): number {
    return this.items.findIndex((it) => it.value === this.value)
  }

  private choose(value: string): void {
    if (this.disabled || value === this.value) return
    this.value = value
    this.dispatchEvent(new CustomEvent('au-change', { detail: { value }, bubbles: true, composed: true }))
  }

  private focusSegmentAt(index: number): void {
    const buttons = this.renderRoot.querySelectorAll<HTMLButtonElement>('button[data-segment-value]')
    buttons[index]?.focus()
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.disabled) return
    const n = this.items.length
    if (n === 0) return
    const last = n - 1
    const inToolbar = e.composedPath().some(node => node instanceof Element && node.getAttribute('role') === 'toolbar')
    const focused = e.composedPath().find(node => node instanceof HTMLElement && node.hasAttribute('data-segment-value')) as HTMLElement | undefined
    const cur = inToolbar && focused ? this.items.findIndex(item => item.value === focused.dataset.segmentValue) : this.activeIndex
    let next: number | null = null
    const rtl = getComputedStyle(this).direction === 'rtl'
    if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') || e.key === 'ArrowDown') next = cur >= last ? 0 : cur + 1
    else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') || e.key === 'ArrowUp') next = cur <= 0 ? last : cur - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    const forward = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') || e.key === 'ArrowDown'
    if (inToolbar && (e.key === 'Home' || e.key === 'End' || (forward ? cur === last : cur === 0))) return
    e.preventDefault()
    const item = this.items[next]
    if (!item) return
    if (!inToolbar) this.choose(item.value)
    const target = next
    requestAnimationFrame(() => this.focusSegmentAt(target))
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: inline-flex;
      box-sizing: border-box;
      min-width: 0;
      max-width: 100%;
      gap: var(--au-space-1, 4px);
      padding: var(--au-space-0-5, 2px);
      background: var(--au-color-surface-1, #1e2128);
      border: 1px solid var(--au-line-1, rgba(255, 255, 255, 0.08));
      border-radius: var(--au-radius-row, 8px);
    }
    :host([disabled]) {
      opacity: var(--au-opacity-disabled, 0.5);
      pointer-events: none;
    }
    button {
      position: relative;
      box-sizing: border-box;
      flex: 1 1 auto;
      min-width: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--au-space-1, 4px);
      height: calc(var(--au-space-1, 4px) * 7);
      padding-inline: var(--au-space-3, 12px);
      border: 0;
      border-radius: var(--au-radius-chip, 6px);
      background: none;
      color: var(--au-ink-4, #777);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      white-space: nowrap;
      cursor: pointer;
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    button:hover:not([data-active='true']),
    button[data-force-hover]:not([data-active='true']) {
      color: var(--au-ink-2, #c8c8c8);
      background: var(--au-chrome-hover, rgba(245, 243, 238, 0.045));
    }
    button[data-active='true'] {
      background: var(--au-color-surface-3, #2b2f38);
      color: var(--au-ink-1, #ededed);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
    }
    button > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    @media (forced-colors: active) {
      button[data-active='true'] { outline: 1px solid Highlight; outline-offset: -1px; }
    }
    button:focus-visible,
    button[data-force-focus] {
      ${controlFocusStyle}
    }
    .icon {
      flex: 0 0 auto;
    }
  `

  render() {
    return html`
      <div
        role="radiogroup"
        aria-label=${this.label ?? nothing}
        style="display: contents;"
        @keydown=${this.onKeyDown}
      >
        ${this.items.map((it) => {
          const active = it.value === this.value
          return html`
            <button
              type="button"
              title=${it.label}
              role="radio"
              aria-checked=${active}
              ?disabled=${this.disabled}
              tabindex=${!this.disabled && (active || (this.activeIndex < 0 && it === this.items[0])) ? 0 : -1}
              data-segment-value=${it.value}
              data-active=${active ? 'true' : 'false'}
              @click=${() => this.choose(it.value)}
            >
              ${it.icon ? html`<au-icon class="icon" size="sm" name=${it.icon} aria-hidden="true"></au-icon>` : nothing}
              <span>${it.label}</span>
            </button>
          `
        })}
      </div>
    `
  }
}
