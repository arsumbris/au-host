// Vendored checkmark attribution: third-party/lucide-LICENSE and third-party/feather-LICENSE in this package.
// <au-checkbox> — the default set's Lit SHADOW implementation of the `au-checkbox` contract.
//
// FORM-ASSOCIATED (the recipe's form seam): `static formAssociated = true` + `attachInternals()`, so the
// checked state crosses the shadow boundary into a native `<form>` and honours form reset. A visually-
// hidden native `<input type=checkbox>` inside the shadow drives a token-built box + glyph, so keyboard
// and AT semantics (including `:indeterminate` → aria mixed) come for free. Monochrome: the "on" box is
// an ink-1 fill with a canvas glyph — a check when checked, a dash when indeterminate.
//
// Contract: `checked` / `indeterminate` / `disabled` / `label` attributes. Emits `au-change` (detail
// `{ checked }`, composed + bubbling) on toggle. The check + minus glyphs are inlined (not a nested
// `<au-icon>`) for render-resilience. TOKEN-ONLY.

import { css, html, svg } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
export class AuCheckboxElement extends AuElement {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('input')?.focus(options)
  }

  static formAssociated = true

  static properties = {
    ariaLabel: { type: String, attribute: 'aria-label', reflect: true },
    _formDisabled: { state: true },
    checked: { type: Boolean, reflect: true },
    indeterminate: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    size: { type: String, reflect: true },
    label: { type: String },
  }

  declare checked: boolean
  declare indeterminate: boolean
  declare disabled: boolean
  declare size?: 'sm' | 'md' | 'lg'
  declare label?: string

  declare private _formDisabled: boolean
  private internals: ElementInternals

  constructor() {
    super()
    this._formDisabled = false
    this.checked = false
    this.indeterminate = false
    this.disabled = false
    this.internals = this.attachInternals()
    // A wrapping `<label>` activates its control by dispatching a click on the HOST (a form-associated
    // custom element). Forward that to the inner input so a label-area click toggles — but skip when the
    // click already reached the inner input (a direct box click), so a box click never double-toggles.
    this.addEventListener('click', (e: MouseEvent) => {
      if (this.disabled || this._formDisabled) return
      if (e.composedPath().some((n) => n instanceof HTMLInputElement)) return
      this.renderRoot.querySelector('input')?.click()
    })
  }

  formResetCallback(): void {
    this.checked = false
    this.indeterminate = false
    this.internals.setFormValue(null)
  }
  formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled
    this.toggleAttribute('data-form-disabled', disabled)
  }

  private syncForm(): void {
    // A checked box contributes its `on` value to the form; an unchecked one contributes nothing.
    this.internals.setFormValue(this.checked ? 'on' : null)
  }

  private onChange(e: Event): void {
    this.checked = (e.target as HTMLInputElement).checked
    this.indeterminate = false // a user toggle clears the mixed state, like a native checkbox
    this.syncForm()
    this.dispatchEvent(new CustomEvent('au-change', { detail: { checked: this.checked }, bubbles: true, composed: true }))
  }

  updated(): void {
    // `indeterminate` is a DOM PROPERTY on the inner input, not an attribute — mirror it.
    const input = this.renderRoot.querySelector<HTMLInputElement>('input')
    if (input) {
      input.indeterminate = this.indeterminate
      // Attribute reflection may invoke formDisabledCallback during this update.
      input.disabled = this.disabled || this._formDisabled
    }
    this.syncForm()
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      /* box dimension — md; sm is the dense-list size, lg the roomy one. */
      --_size: calc(var(--au-space-1, 4px) * 4);
      position: relative;
      display: inline-flex;
      align-items: flex-start;
      gap: var(--au-space-2, 8px);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    :host([size='sm']) {
      --_size: calc(var(--au-space-1, 4px) * 3.5);
      gap: var(--au-space-1-5, 6px);
    }
    :host([size='lg']) {
      --_size: calc(var(--au-space-1, 4px) * 4.5);
    }
    input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: inherit;
    }
    .box {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      margin-top: max(0px, calc((var(--au-lh-sm, 16px) - var(--_size)) / 2));
      width: var(--_size);
      height: var(--_size);
      box-sizing: border-box;
      border: 1px solid var(--au-line-control);
      border-radius: var(--au-radius-sm,5px);
      background: var(--au-color-surface-1, #1e2128);
      color: var(--au-color-bg, #14161c);
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .glyph {
      grid-area: 1 / 1;
      /* scale with the box so every size reads proportional. */
      width: calc(var(--_size) * 0.68);
      height: calc(var(--_size) * 0.68);
      opacity: 0;
      transform: scale(0.6);
      transition:
        opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host(:hover) .box {
      border-color: var(--au-line-3, #4a4a4a);
    }
    /* on: checked or indeterminate → ink-1 fill */
    :host([checked]) .box,
    :host([indeterminate]) .box {
      background: var(--au-ink-1, #ededed);
      border-color: var(--au-ink-1, #ededed);
    }
    :host([checked]:not([indeterminate])) .check {
      opacity: 1;
      transform: none;
    }
    :host([indeterminate]) .dash {
      opacity: 1;
      transform: none;
    }
    input:focus-visible ~ .box,
    :host(:focus-visible) .box,
    :host([data-force-focus]) .box {
      outline: 2px solid var(--au-focus-outer, #3b82f6);
      outline-offset: 2px;
    }
    .label {
      min-width: 0;
      overflow-wrap: anywhere;
      padding-top: max(0px, calc((var(--_size) - var(--au-lh-sm, 16px)) / 2));
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      color: var(--au-ink-2, #c8c8c8);
    }
    @media (forced-colors: active) { input:focus-visible ~ .box { outline-color: Highlight; } }
    :host([disabled]),
    :host([data-form-disabled]) {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
    }
  `

  render() {
    return html`
      <input
        type="checkbox"
        .checked=${this.checked}
        ?disabled=${this.disabled || this._formDisabled}
        aria-label=${this.ariaLabel || this.label || ''}
        @change=${this.onChange}
      />
      <span class="box" part="box" aria-hidden="true">
        <svg class="glyph check" part="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          ${svg`<path d="M20 6 9 17l-5-5" />`}
        </svg>
        <svg class="glyph dash" part="dash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          ${svg`<path d="M5 12h14" />`}
        </svg>
      </span>
      ${this.label !== undefined && this.label !== '' ? html`<span class="label" part="label">${this.label}</span>` : ''}
    `
  }
}
