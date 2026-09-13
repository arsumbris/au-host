// <au-field> — the default set's Lit SHADOW implementation of the `au-field` contract.
//
// The form-ROW composition primitive: wraps ANY control with a label, an optional hint, and — on
// `error` — a danger-ink message in the hint slot (tinted TEXT only, never a rail). The control is
// the DEFAULT slot; a rich label rides the `label` slot (a simple string rides the `label` prop as
// slot fallback). `stack` = label above the control, `inline` = a two-column grid.
//
// Optional field participation associates one directly slotted control through its public capability.
// The control owns native accessibility; no cross-shadow selectors or authored-name replacement.
// Rich label slots retain explicit control names, and multi-control/wrapped rows require a group policy.
// Label-click focus remains available for nonparticipating controls.
//
// TOKEN-ONLY: base `--au-*` tokens with literal floors.

import { css, html } from 'lit'
import type { FieldParticipant } from '@arsumbris/component-contract'
import { AuElement } from './au-element'
export class AuFieldElement extends AuElement {
  static properties = {
    label: { type: String },
    hint: { type: String },
    error: { type: String },
    required: { type: Boolean, reflect: true },
    layout: { type: String, reflect: true },
    labelSlotFilled: { state: true },
  }

  declare label?: string
  declare hint?: string
  declare error?: string
  declare required: boolean
  declare layout: 'stack' | 'inline'
  private labelSlotFilled = false

  private participant: (Element & FieldParticipant) | null = null

  private get errorMessage(): string | undefined {
    return this.error?.trim() ? this.error : undefined
  }

  private get hintMessage(): string | undefined {
    return this.hint?.trim() ? this.hint : undefined
  }

  private associateControl(): void {
    const elements = this.renderRoot.querySelector<HTMLSlotElement>('slot:not([name])')?.assignedElements({flatten: true}) ?? []
    const candidate = elements.length === 1 ? elements[0] as Element & Partial<FieldParticipant> : null
    const next = candidate && typeof candidate.setFieldContext === 'function' && typeof candidate.focus === 'function'
      ? candidate as Element & FieldParticipant : null
    if (this.participant !== next) this.participant?.setFieldContext(this, null)
    this.participant = next
    next?.setFieldContext(this, {
      label: this.labelSlotFilled ? undefined : this.label,
      description: this.errorMessage ?? this.hintMessage,
      invalid: this.errorMessage !== undefined,
      required: this.required,
    })
  }

  updated(): void { this.associateControl() }

  override connectedCallback(): void {
    super.connectedCallback()
    // Retained panes reconnect without changing properties or slot assignments.
    // Re-publish the association cleared during disconnect.
    this.requestUpdate()
  }

  override disconnectedCallback(): void {
    this.participant?.setFieldContext(this, null)
    this.participant = null
    super.disconnectedCallback()
  }

  constructor() {
    super()
    this.required = false
    this.layout = 'stack'
  }

  private onLabelSlot(e: Event): void {
    this.labelSlotFilled = (e.target as HTMLSlotElement).assignedNodes({ flatten: true }).length > 0
  }

  // Label-click → focus the slotted control (the cross-shadow label↔control tie).
  private focusControl(): void {
    const slot = this.renderRoot.querySelector<HTMLSlotElement>('slot:not([name])')
    for (const node of slot?.assignedElements({ flatten: true }) ?? []) {
      const focusable = (node as HTMLElement).matches?.(FOCUSABLE)
        ? (node as HTMLElement)
        : (node as HTMLElement).querySelector<HTMLElement>(FOCUSABLE)
      if (focusable) {
        focusable.focus()
        return
      }
    }
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--au-space-2, 8px);
      min-width: 0;
    }
    :host([layout='inline']) {
      container: au-field-inline / inline-size;
      display: grid;
      grid-template-columns: fit-content(35%) minmax(0, 1fr);
      align-items: center;
      column-gap: var(--au-space-3, 12px);
      row-gap: var(--au-space-1, 4px);
    }
    .label {
      min-width: 0;
      overflow-wrap: anywhere;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      color: var(--au-ink-2, #c8c8c8);
      cursor: default;
    }
    :host([layout='inline']) .label {
      grid-column: 1;
    }
    .required {
      margin-inline-start: var(--au-space-0-5, 2px);
      color: var(--au-ink-4, #777);
    }
    .control {
      display: block;
      min-width: 0;
    }
    :host([layout='inline']) .control {
      grid-column: 2;
    }
    .msg {
      overflow-wrap: anywhere;
      margin: 0;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    :host([layout='inline']) .msg {
      grid-column: 2;
    }
    @container au-field-inline (max-width: 18rem) {
      :host([layout='inline']) .label, :host([layout='inline']) .control, :host([layout='inline']) .msg { grid-column: 1 / -1; }
    }
    .hint {
      color: var(--au-ink-3, #a09c92);
    }
    :host(:not([layout='inline'])) .msg {
      margin-block-start: calc(-1 * var(--au-space-1, 4px));
    }
    .error {
      color: var(--au-color-danger, #c0392b);
    }
    /* Hide an empty label region so the grid/gap does not open space beside a missing label. */
    .label.empty {
      display: none;
    }
  `

  render() {
    // The label region shows when the `label` slot has assigned content OR the `label` string prop
    // is set (the prop rides as slot fallback); hidden entirely when neither is present, so the
    // grid/gap never opens space beside a missing label.
    const hasLabel = this.labelSlotFilled || (this.label !== undefined && this.label !== '')
    return html`
      <label
        class="label${hasLabel ? '' : ' empty'}"
        part="label"
        @click=${this.focusControl}
      >
        <slot name="label" @slotchange=${this.onLabelSlot}>${this.label ?? ''}</slot>
        ${this.required ? html`<span class="required" aria-hidden="true">*</span>` : ''}
      </label>
      <div class="control" part="control"><slot @slotchange=${this.associateControl}></slot></div>
      ${this.errorMessage !== undefined
        ? html`<p class="msg error" part="error">${this.errorMessage}</p>`
        : this.hintMessage !== undefined
          ? html`<p class="msg hint" part="hint">${this.hintMessage}</p>`
          : ''}
    `
  }
}

const FOCUSABLE =
  'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), ' +
  '[tabindex]:not([disabled]), a[href], ' +
  'au-input, au-textarea, au-number-input, au-checkbox, au-switch, au-slider, au-select, ' +
  'au-combobox, au-color-picker, au-radio-group, au-segmented-control'
