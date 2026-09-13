// <au-list-row> — the generic dense row every list composes: an optional `leading` slot (icon / dot),
// a `primary` label with an optional `secondary` line under it, an optional right-aligned `meta` slot,
// and an optional `trailing` slot. The body ellipsises so long text never breaks the row. `interactive`
// opts into the hover-lift + focus ring + keyboard focus; `selected` rests one surface step up; both
// emphasise with surface tint + ink weight, NEVER a leading accent bar. Empty leading/meta/trailing wrappers are hidden so the flex gap never opens beside a missing part.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { pickerRow, pickerRowHover, pickerRowFocus, pickerRowSelected } from './picker-style'
export class AuListRowElement extends AuElement {
  static properties = {
    primary: { type: String },
    wrap: { type: Boolean, reflect: true },
    secondary: { type: String },
    interactive: { type: Boolean, reflect: true },
    selected: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    _has: { state: true },
  }
  declare wrap: boolean
  declare primary?: string
  declare secondary?: string
  declare interactive: boolean
  declare selected: boolean
  declare disabled: boolean
  declare _has: { leading: boolean; meta: boolean; trailing: boolean }

  constructor() {
    super()
    this.wrap = false
    this.interactive = false
    this.selected = false
    this.disabled = false
    this._has = { leading: false, meta: false, trailing: false }
  }

  static styles = css`
    :host {
      ${pickerRow}
      min-width: 0;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      cursor: default;
    }
    :host([interactive]) { cursor: pointer; }
    :host([interactive]:hover) { ${pickerRowHover} }
    :host([interactive]:focus-visible) { ${pickerRowFocus} }
    :host([selected]) { ${pickerRowSelected} }
    :host([disabled]) {
      color: var(--au-ink-5, #555);
      background: transparent;
      cursor: not-allowed;
      pointer-events: none;
    }
    .leading {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      color: var(--au-ink-3, #9a9a9a);
    }
    :host([selected]) .leading,
    :host([interactive]:hover) .leading {
      color: var(--au-ink-1, #e8e8e8);
    }
    .body {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      flex-direction: column;
      gap: var(--au-space-0-5, 2px);
    }
    .primary {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: var(--au-w-medium, 500);
      color: inherit;
    }
    .secondary {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--au-ink-4, #777);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      font-weight: var(--au-w-body, 400);
    }
    :host([wrap]) { align-items: flex-start; }
    :host([wrap]) .primary, :host([wrap]) .secondary {
      white-space: normal;
      overflow-wrap: anywhere;
      text-overflow: clip;
    }
    .meta {
      flex: none;
      color: var(--au-ink-4, #777);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      font-variant-numeric: tabular-nums;
    }
    .trailing {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--au-space-1, 4px);
      color: var(--au-ink-3, #9a9a9a);
    }
    [hidden] {
      display: none !important;
    }
  `

  private recompute = (): void => {
    this._has = {
      leading: !!this.querySelector(':scope > [slot="leading"]'),
      meta: !!this.querySelector(':scope > [slot="meta"]'),
      trailing: !!this.querySelector(':scope > [slot="trailing"]'),
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.composedPath()[0] !== this || !this.interactive || this.disabled || event.repeat) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.click()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.removeEventListener('keydown', this.onKeyDown)
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('keydown', this.onKeyDown)
    queueMicrotask(this.recompute)
  }

  updated(): void {
    if (this.interactive) {
      this.setAttribute('role', 'button')
      this.setAttribute('tabindex', this.disabled ? '-1' : '0')
    } else {
      this.removeAttribute('role')
      this.removeAttribute('tabindex')
    }
    if (this.disabled) this.setAttribute('aria-disabled', 'true')
    else this.removeAttribute('aria-disabled')
  }

  render() {
    return html`
      <span class="leading" part="leading" ?hidden=${!this._has.leading}>
        <slot name="leading" @slotchange=${this.recompute}></slot>
      </span>
      <span class="body">
        <span class="primary" part="primary">${this.primary ?? ''}</span>
        ${this.secondary ? html`<span class="secondary" part="secondary">${this.secondary}</span>` : ''}
      </span>
      <span class="meta" part="meta" ?hidden=${!this._has.meta}>
        <slot name="meta" @slotchange=${this.recompute}></slot>
      </span>
      <span class="trailing" part="trailing" ?hidden=${!this._has.trailing}>
        <slot name="trailing" @slotchange=${this.recompute}></slot>
      </span>
    `
  }
}
