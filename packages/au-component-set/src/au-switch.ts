// <au-switch> — the default set's Lit SHADOW implementation of the `au-switch` contract.
//
// FORM-ASSOCIATED: `static formAssociated = true` + `attachInternals()`, so the
// on/off state crosses the shadow boundary into a native `<form>` and honours form reset. A visually-
// hidden native `<input type=checkbox role=switch>` inside the shadow drives a token-built track + thumb,
// so keyboard and AT semantics come for free. Monochrome: "on" is an ink-1 track and the thumb flips to
// canvas and slides right; thumb travel is pure token math (track-w − thumb − 2×inset).
//
// Contract: `checked` / `disabled` / `label` attributes (`label` is the accessible name — a switch has no
// visible text). Emits `au-change` (detail `{ checked }`, composed + bubbling) on toggle. TOKEN-ONLY.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
export class AuSwitchElement extends AuElement {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('input')?.focus(options)
  }

  static formAssociated = true

  static properties = {
    _formDisabled: { state: true },
    checked: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    label: { type: String },
  }

  declare checked: boolean
  declare disabled: boolean
  declare label?: string

  declare private _formDisabled: boolean
  private internals: ElementInternals

  constructor() {
    super()
    this._formDisabled = false
    this.checked = false
    this.disabled = false
    this.internals = this.attachInternals()
    // A wrapping `<label>` activates its control by dispatching a click on the HOST (a form-associated
    // custom element). Forward that to the inner input so a label-area click toggles — but skip when the
    // click already reached the inner input, so a direct track click never double-toggles.
    this.addEventListener('click', (e: MouseEvent) => {
      if (this.disabled || this._formDisabled) return
      if (e.composedPath().some((n) => n instanceof HTMLInputElement)) return
      this.renderRoot.querySelector('input')?.click()
    })
  }

  formResetCallback(): void {
    this.checked = false
    this.internals.setFormValue(null)
  }
  formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled
    this.toggleAttribute('data-form-disabled', disabled)
  }

  private syncForm(): void {
    // An "on" switch contributes its value to the form; an "off" one contributes nothing.
    this.internals.setFormValue(this.checked ? 'on' : null)
  }

  private onChange(e: Event): void {
    this.checked = (e.target as HTMLInputElement).checked
    this.syncForm()
    this.dispatchEvent(new CustomEvent('au-change', { detail: { checked: this.checked }, bubbles: true, composed: true }))
  }

  updated(): void {
    // Attribute reflection may invoke formDisabledCallback during this update.
    const input = this.renderRoot.querySelector<HTMLInputElement>('input')
    if (input) input.disabled = this.disabled || this._formDisabled
    this.syncForm()
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      /* dimension seeds — whole multiples of the 4px base step, so track/thumb/travel scale together. */
      --_track-w: calc(var(--au-space-1, 4px) * 7);
      --_track-h: calc(var(--au-space-1, 4px) * 4);
      --_thumb: calc(var(--au-space-1, 4px) * 3);
      --_inset: var(--au-space-0-5, 2px);
      position: relative;
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      width: var(--_track-w);
      height: var(--_track-h);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: inherit;
    }
    .track {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      box-sizing: border-box;
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-color-surface-3, #2b2f38);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      transition:
        background-color var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    /* Thumb: flex-centred vertically; a token inset holds it off the left rim, the on-state slides it to
     * a symmetric right inset — travel is pure token math. */
    .thumb {
      flex: 0 0 auto;
      width: var(--_thumb);
      height: var(--_thumb);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-ink-3, #8a8a8a);
      transform: translateX(var(--_inset));
      transition:
        transform var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host(:hover) .thumb {
      background: var(--au-ink-2, #c8c8c8);
    }
    /* on (checked) */
    :host([checked]) .track {
      background: var(--au-ink-1, #ededed);
    }
    :host([checked]) .thumb {
      background: var(--au-color-bg, #14161c);
      transform: translateX(calc(var(--_track-w) - var(--_thumb) - var(--_inset)));
    }
    input:focus-visible ~ .track,
    :host(:focus-visible) .track,
    :host([data-force-focus]) .track {
      outline: 2px solid var(--au-focus-outer, #3b82f6);
      outline-offset: 2px;
    }
    @media (forced-colors: active) { input:focus-visible ~ .track { outline-color: Highlight; } }
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
        role="switch"
        .checked=${this.checked}
        ?disabled=${this.disabled || this._formDisabled}
        aria-label=${this.label ?? ''}
        @change=${this.onChange}
      />
      <span class="track" part="track" aria-hidden="true">
        <span class="thumb" part="thumb"></span>
      </span>
    `
  }
}
