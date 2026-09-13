// <au-radio-group> — the default set's Lit SHADOW implementation of the `au-radio-group` contract.
//
// DATA-DRIVEN single element (the set's single-select-group idiom, shared with au-segmented-control): the
// whole group is ONE element rendering its `items` (au-radio-item[]) as ring+dot rows, so native arrow-
// roving and form-association stay clean — one shadow root, one form value. A Lit element owns the model + roving, no cross-shadow radio grouping to fight.
//
// FORM-ASSOCIATED: `static formAssociated = true` + `attachInternals()`, so the
// selected value crosses the shadow boundary into a native `<form>` and honours reset. Roving tabindex —
// only the selected option (or the first, when none) is in the tab order; ArrowUp/Down/Left/Right +
// Home/End move selection with focus following it. Emits `au-change` (detail `{ value }`, composed +
// bubbling) on select. Monochrome: selection is an ink-1 rim + ink-1 centre dot. TOKEN-ONLY.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
/** One radio option: a stable value, its label, and an optional per-item disabled flag. */
export interface AuRadioItem {
  value: string
  label: string
  disabled?: boolean
}

export class AuRadioGroupElement extends AuElement {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('button[tabindex="0"]')?.focus(options)
  }

  static formAssociated = true

  static properties = {
    _formDisabled: { state: true },
    items: { attribute: false },
    value: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    label: { type: String },
  }

  declare items: AuRadioItem[]
  declare value: string
  declare disabled: boolean
  declare label?: string
  declare private _formDisabled: boolean

  private internals: ElementInternals

  constructor() {
    super()
    this.items = []
    this.value = ''
    this.disabled = false
    this._formDisabled = false
    this.internals = this.attachInternals()
  }

  formResetCallback(): void {
    this.value = ''
    this.internals.setFormValue(null)
  }
  formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled
    this.toggleAttribute('data-form-disabled', disabled)
  }

  private syncForm(): void {
    this.internals.setFormValue(this.value === '' ? null : this.value)
  }

  updated(): void {
    this.renderRoot.querySelectorAll<HTMLButtonElement>('button[data-radio-value]').forEach((button, index) => {
      button.disabled = this.disabled || this._formDisabled || !!this.items[index]?.disabled
    })
    this.syncForm()
  }

  /** The options a keyboard walk may land on (a per-item disabled one is skipped). */
  private get enabledIndices(): number[] {
    if (this.disabled || this._formDisabled) return []
    return this.items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
  }

  private choose(value: string): void {
    if (this.disabled || this._formDisabled || value === this.value) return
    this.value = value
    this.syncForm()
    this.dispatchEvent(new CustomEvent('au-change', { detail: { value }, bubbles: true, composed: true }))
  }

  private focusOptionAt(index: number): void {
    const rows = this.renderRoot.querySelectorAll<HTMLButtonElement>('button[data-radio-value]')
    rows[index]?.focus()
  }

  private onKeyDown(e: KeyboardEvent): void {
    const enabled = this.enabledIndices
    if (enabled.length === 0) return
    const cur = enabled.indexOf(this.items.findIndex((it) => it.value === this.value))
    let pos: number | null = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') pos = cur >= enabled.length - 1 ? 0 : cur + 1
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') pos = cur <= 0 ? enabled.length - 1 : cur - 1
    else if (e.key === 'Home') pos = 0
    else if (e.key === 'End') pos = enabled.length - 1
    if (pos === null) return
    e.preventDefault()
    const index = enabled[pos]
    const item = this.items[index]
    if (!item) return
    this.choose(item.value)
    requestAnimationFrame(() => this.focusOptionAt(index))
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      /* dimension seeds — whole multiples of the 4px base step. */
      --_ring: calc(var(--au-space-1, 4px) * 4);
      --_dot: calc(var(--au-space-1, 4px) * 2);
      display: flex;
      flex-direction: column;
      gap: var(--au-space-2, 8px);
    }
    :host([disabled]), :host([data-form-disabled]) {
      opacity: var(--au-opacity-disabled, 0.5);
      pointer-events: none;
    }
    button {
      position: relative;
      display: inline-flex;
      align-items: flex-start;
      min-width: 0;
      gap: var(--au-space-2, 8px);
      padding: 0;
      border: 0;
      /* The ring below owns the visible keyboard focus treatment. */
      outline: none;
      background: none;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      font: inherit;
      text-align: start;
    }
    :host(:not([disabled]):not([data-form-disabled])) button[data-disabled='true'] {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
    }
    .ring {
      margin-top: max(0px, calc((var(--au-lh-sm,16px) - var(--_ring)) / 2));
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      box-sizing: border-box;
      width: var(--_ring);
      height: var(--_ring);
      border: 1px solid var(--au-ink-3, #8a8a8a);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-color-surface-1, #1e2128);
      transition: border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .dot {
      width: var(--_dot);
      height: var(--_dot);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-ink-1, #ededed);
      opacity: 0;
      transform: scale(0.4);
      transition:
        opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    /* hover — declared before selected so a selected ring keeps its ink rim. */
    button:hover:not(:disabled):not([data-checked='true']) .ring,
    button[data-force-hover]:not(:disabled):not([data-checked='true']) .ring {
      border-color: var(--au-ink-2, #c8c8c8);
    }
    button[data-checked='true'] .ring {
      border-color: var(--au-ink-1, #ededed);
    }
    button[data-checked='true'] .dot {
      opacity: 1;
      transform: none;
    }
    button:focus-visible .ring,
    button[data-force-focus] .ring {
      outline: 2px solid var(--au-focus-outer, #3b82f6);
      outline-offset: 2px;
    }
    /* Gallery freeze: a host-level force outlines the selected option's ring (per-child data-force-*
     * cannot be set on an inner button from outside, so the group exposes the hook at the host). */
    :host([data-force-focus]) button[data-checked='true'] .ring {
      outline: 2px solid var(--au-focus-outer, #3b82f6);
      outline-offset: 2px;
    }
    .label {
      min-width: 0;
      overflow-wrap: anywhere;
      padding-top: max(0px, calc((var(--_ring) - var(--au-lh-sm,16px)) / 2));
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      color: var(--au-ink-2, #c8c8c8);
    }
    @media (forced-colors: active) {
      .dot {
        forced-color-adjust: none;
        background: CanvasText;
      }
      button:disabled .dot { background: GrayText; }
      button:focus-visible .ring,
      :host([data-force-focus]) button[data-checked='true'] .ring {
        outline-color: Highlight;
      }
    }
  `

  render() {
    const hasSelection = this.items.some((it) => !it.disabled && it.value === this.value)
    return html`
      <div role="radiogroup" aria-label=${this.label ?? nothing} style="display: contents;" @keydown=${this.onKeyDown}>
        ${this.items.map((it, i) => {
          const checked = it.value === this.value
          const disabled = this.disabled || this._formDisabled || !!it.disabled
          // Roving tabindex: the selected option is in the tab order; with no selection, the first
          // enabled option is, so the group is reachable by Tab.
          const isTabStop = checked || (!hasSelection && this.enabledIndices[0] === i)
          return html`
            <button
              type="button"
              role="radio"
              aria-checked=${checked}
              tabindex=${disabled ? -1 : isTabStop ? 0 : -1}
              data-radio-value=${it.value}
              data-checked=${checked ? 'true' : 'false'}
              data-disabled=${disabled ? 'true' : 'false'}
              ?disabled=${disabled}
              @click=${() => !disabled && this.choose(it.value)}
            >
              <span class="ring" part="ring" aria-hidden="true"><span class="dot" part="dot"></span></span>
              <span class="label" part="label">${it.label}</span>
            </button>
          `
        })}
      </div>
    `
  }
}
