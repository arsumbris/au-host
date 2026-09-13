// <au-input> — the default set's Lit SHADOW implementation of the `au-input` contract.
//
// FORM-ASSOCIATED: `static formAssociated = true` + `attachInternals()`, so
// the element's `value` crosses the shadow boundary into a native `<form>` and honours form reset. The
// inner `<input>` is what the user types into; every keystroke mirrors to the element value AND the
// form value, and dispatches composed `au-input` (per keystroke) / `au-change` (on commit).
//
// TOKEN-ONLY: base `--au-*` tokens with literal floors. `data-force-*` twins on
// the host let the gallery states matrix force hover/focus/error/disabled.

import { css, html } from 'lit'
import type { FieldContext } from '@arsumbris/component-contract'
import { FieldSemantics } from './field-semantics'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { controlFocusStyle } from './focus-style'
export class AuInputElement extends AuElement {
  private fieldSemantics = new FieldSemantics(this, () => this.renderRoot?.querySelector('input') ?? null, () => ({invalid: this.error}))

  setFieldContext(owner: object, context: FieldContext | null): void {
    this.fieldSemantics.setContext(owner, context)
  }

  static formAssociated = true
  // Delegate focus to the inner <input> so host.focus() (and a `[main-field]`/label click, an autofocus
  // consumer like the editor find bar) reaches the real field across the shadow boundary.
  static shadowRootOptions = { ...AuElement.shadowRootOptions, delegatesFocus: true }

  static properties = {
    _formDisabled: { state: true },
    // Standard host aria-label must name the actual shadow field, including live updates.
    ariaLabel: { type: String, attribute: 'aria-label', reflect: true },
    value: { type: String },
    placeholder: { type: String },
    inputType: { type: String },
    size: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    error: { type: Boolean, reflect: true },
    borderless: { type: Boolean, reflect: true },
    spellcheck: { type: Boolean },
  }

  /** Select all text in the inner field (a consumer seeding + selecting a value, e.g. a find/rename box). */
  select(): void {
    ;(this.renderRoot?.querySelector('input') as HTMLInputElement | null)?.select()
  }

  /** Select a sub-range of the inner field, focusing it first. For a rename box selecting the stem and
   *  not the extension (`selectRange(0, name.lastIndexOf('.'))`), the partial-selection case `select()`
   *  cannot express. */
  selectRange(start: number, end: number): void {
    void this.updateComplete.then(() => {
      if (!this.isConnected) return
      const el = this.renderRoot?.querySelector('input') as HTMLInputElement | null
      if (!el) return
      el.focus()
      el.setSelectionRange(start, end)
    })
  }

  declare value: string
  declare placeholder?: string
  declare inputType: string
  declare size?: 'sm' | 'md' | 'lg'
  declare disabled: boolean
  declare error: boolean
  declare borderless: boolean
  declare spellcheck: boolean
  declare private _formDisabled: boolean

  private internals: ElementInternals

  constructor() {
    super()
    this.value = ''
    this.inputType = 'text'
    this.disabled = false
    this._formDisabled = false
    this.error = false
    this.borderless = false
    this.spellcheck = true
    this.internals = this.attachInternals()
  }

  // Form-associated lifecycle: a native form reset clears the field; a disabled fieldset disables it.
  formResetCallback(): void {
    this.value = ''
    this.internals.setFormValue('')
  }
  formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled
    this.toggleAttribute('data-form-disabled', disabled)
  }

  private onInput(e: Event): void {
    this.value = (e.target as HTMLInputElement).value
    this.internals.setFormValue(this.value)
    this.dispatchEvent(new CustomEvent('au-input', { bubbles: true, composed: true }))
  }
  private onChange(): void {
    this.dispatchEvent(new CustomEvent('au-change', { bubbles: true, composed: true }))
  }

  updated(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>('input')
    if (input) input.disabled = this.disabled || this._formDisabled
    // Keep the form value in sync with a programmatic value change (not just user input).
    this.internals.setFormValue(this.value)
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
    }
    input {
      box-sizing: border-box;
      display: block;
      width: 100%;
      height: calc(var(--au-space-1, 4px) * 8);
      padding-inline: var(--au-space-3, 12px);
      border: 1px solid var(--au-line-control);
      border-radius: var(--au-radius-md,8px);
      background: var(--au-color-surface-1, #1e2128);
      color: var(--au-ink-1, #ededed);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      transition:
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([size='sm']) input {
      height: calc(var(--au-space-1, 4px) * 7);
      padding-inline: var(--au-space-2, 8px);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    :host([size='lg']) input {
      height: calc(var(--au-space-1, 4px) * 10);
      padding-inline: var(--au-space-4, 16px);
      font-size: var(--au-t-body, 16px);
      line-height: var(--au-lh-body,24px);
    }
    input::placeholder {
      color: var(--au-ink-4, #777);
    }
    input:hover:not(:disabled),
    :host([data-force-hover]) input:not(:disabled) {
      border-color: var(--au-ink-3, #8a8a8a);
    }
    input:focus-visible,
    :host([data-force-focus]) input {
      ${controlFocusStyle}
      border-color: var(--au-ink-4, #777);
    }
    :host([error]) input,
    input[aria-invalid='true'],
    :host([data-force-error]) input {
      border-color: var(--au-color-danger, #c0392b);
    }
    :host([error]) input:focus-visible,
    input[aria-invalid='true']:focus-visible,
    :host([error][data-force-focus]) input,
    :host([data-force-error][data-force-focus]) input {
      outline-color: var(--au-color-danger, #c0392b);
    }
    :host([disabled]) input,
    :host([data-form-disabled]) input,
    :host([data-force-disabled]) input {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
      background: var(--au-color-bg, #14161c);
    }
    /* borderless — for a field inside a frame that already draws the boundary. */
    :host([borderless]) input,
    :host([borderless]) input:hover,
    :host([borderless]) input:focus-visible {
      border-color: transparent;
      border-radius: 0;
      background: transparent;
      outline: none;
    }
  `

  render() {
    return html`
      <input
        part="input"
        type=${this.inputType}
        .value=${this.value}
        placeholder=${this.placeholder ?? ''}
        ?disabled=${this.disabled || this._formDisabled}
        spellcheck=${this.spellcheck ? 'true' : 'false'}
        @input=${this.onInput}
        @change=${this.onChange}
      />
    `
  }
}
