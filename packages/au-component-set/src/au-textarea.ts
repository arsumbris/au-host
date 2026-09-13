import type { FieldContext } from '@arsumbris/component-contract'
import { FieldSemantics } from './field-semantics'
// <au-textarea> — the default set's Lit SHADOW implementation of the `au-textarea` contract.
//
// FORM-ASSOCIATED: `static formAssociated = true` + `attachInternals()`, so the
// element's `value` crosses the shadow boundary into a native `<form>` and honours form reset. An inner
// `<textarea>` is what the user types into; every keystroke mirrors to the element value AND the form
// value, and dispatches composed `au-input` (per keystroke) / `au-change` (on commit).
//
// Mirrors au-input's border / radius / focus / disabled / error on a block box that wraps. `mono` + `size`
// support a code / pattern well; `autoGrow` measures scrollHeight on each change and on a programmatic
// value change, growing to a token cap before scrolling. TOKEN-ONLY.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { controlFocusStyle } from './focus-style'
import { scrollbarStyle } from './scrollbar-style'
export class AuTextareaElement extends AuElement {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('textarea')?.focus(options)
  }

  private fieldSemantics = new FieldSemantics(this, () => this.renderRoot?.querySelector('textarea') ?? null, () => ({invalid: this.error}))

  setFieldContext(owner: object, context: FieldContext | null): void {
    this.fieldSemantics.setContext(owner, context)
  }

  static formAssociated = true

  static properties = {
    _formDisabled: { state: true },
    // Standard host aria-label must name the actual shadow field, including live updates.
    ariaLabel: { type: String, attribute: 'aria-label', reflect: true },
    value: { type: String },
    placeholder: { type: String },
    rows: { type: Number },
    disabled: { type: Boolean, reflect: true },
    error: { type: Boolean, reflect: true },
    autoGrow: { type: Boolean, reflect: true, attribute: 'auto-grow' },
    mono: { type: Boolean, reflect: true },
    size: { type: String, reflect: true },
    spellcheck: { type: Boolean },
  }

  declare value: string
  declare placeholder?: string
  declare rows: number
  declare disabled: boolean
  declare error: boolean
  declare autoGrow: boolean
  declare mono: boolean
  declare size?: 'sm' | 'md' | 'lg'
  declare spellcheck: boolean
  declare private _formDisabled: boolean

  private internals: ElementInternals
  private resizeObserver: ResizeObserver | null = null
  private observedWidth = -1
  private autoSized = false

  override connectedCallback(): void {
    super.connectedCallback()
    this.observedWidth = -1
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === this.observedWidth) return
      this.observedWidth = entry.contentRect.width
      this.resize()
    })
    this.resizeObserver.observe(this)
  }

  override disconnectedCallback(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    super.disconnectedCallback()
  }

  constructor() {
    super()
    this.value = ''
    this.rows = 3
    this.disabled = false
    this._formDisabled = false
    this.error = false
    this.autoGrow = false
    this.mono = false
    this.spellcheck = true
    this.internals = this.attachInternals()
  }

  formResetCallback(): void {
    this.value = ''
    this.internals.setFormValue('')
  }
  formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled
    this.toggleAttribute('data-form-disabled', disabled)
  }

  private get textarea(): HTMLTextAreaElement | null {
    return this.renderRoot.querySelector('textarea')
  }

  // Reset to the rows-derived height, then lock to the content height; CSS max-height caps + scrolls.
  private resize(): void {
    const el = this.textarea
    if (!el) return
    if (!this.autoGrow) {
      if (this.autoSized) el.style.removeProperty('height')
      this.autoSized = false
      return
    }
    el.style.height = 'auto'
    const style = getComputedStyle(el)
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    el.style.height = `${el.scrollHeight + border}px`
    this.autoSized = true
  }

  private onInput(e: Event): void {
    this.value = (e.target as HTMLTextAreaElement).value
    this.internals.setFormValue(this.value)
    this.resize()
    this.dispatchEvent(new CustomEvent('au-input', { bubbles: true, composed: true }))
  }
  private onChange(): void {
    this.dispatchEvent(new CustomEvent('au-change', { bubbles: true, composed: true }))
  }

  updated(): void {
    if (this.textarea) this.textarea.disabled = this.disabled || this._formDisabled
    // Keep the form value in sync with a programmatic value change, and re-fit an auto-grow box.
    this.internals.setFormValue(this.value)
    this.resize()
  }

  static styles = css`
    ${reducedControlMotion}
    ${scrollbarStyle(css`textarea`)}
    :host {
      display: block;
    }
    textarea {
      /* the autoGrow cap — a whole multiple of the 4px base step. */
      --_max: calc(var(--au-space-1, 4px) * 40);
      box-sizing: border-box;
      display: block;
      width: 100%;
      padding-block: var(--au-space-2, 8px);
      padding-inline: var(--au-space-3, 12px);
      border: 1px solid var(--au-line-control);
      border-radius: var(--au-radius-md,8px);
      background: var(--au-color-surface-1, #1e2128);
      color: var(--au-ink-1, #ededed);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      resize: vertical;
      transition:
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([size='sm']) textarea {
      padding-block: var(--au-space-1-5, 6px);
      padding-inline: var(--au-space-2, 8px);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    :host([size='lg']) textarea {
      padding-block: var(--au-space-3, 12px);
      padding-inline: var(--au-space-4, 16px);
      font-size: var(--au-t-body, 16px);
      line-height: var(--au-lh-body,24px);
    }
    :host([mono]) textarea {
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
    }
    :host([auto-grow]) textarea {
      resize: none;
      max-height: var(--_max);
      overflow-y: auto;
    }
    textarea::placeholder {
      color: var(--au-ink-4, #777);
    }
    textarea:hover:not(:disabled),
    :host([data-force-hover]) textarea:not(:disabled) {
      border-color: var(--au-ink-3, #8a8a8a);
    }
    textarea:focus-visible,
    :host([data-force-focus]) textarea {
      ${controlFocusStyle}
      border-color: var(--au-ink-4, #777);
    }
    :host([error]) textarea,
    textarea[aria-invalid='true'],
    :host([data-force-error]) textarea {
      border-color: var(--au-color-danger, #c0392b);
    }
    :host([error]) textarea:focus-visible,
    textarea[aria-invalid='true']:focus-visible,
    :host([error][data-force-focus]) textarea,
    :host([data-force-error][data-force-focus]) textarea {
      outline-color: var(--au-color-danger, #c0392b);
    }
    :host([disabled]) textarea,
    :host([data-form-disabled]) textarea,
    :host([data-force-disabled]) textarea {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
      background: var(--au-color-bg, #14161c);
    }
  `

  render() {
    return html`
      <textarea
        part="textarea"
        rows=${this.rows}
        placeholder=${this.placeholder ?? ''}
        ?disabled=${this.disabled || this._formDisabled}
        spellcheck=${this.spellcheck ? 'true' : 'false'}
        .value=${this.value}
        @input=${this.onInput}
        @change=${this.onChange}
      ></textarea>
    `
  }
}
