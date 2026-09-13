import type { FieldContext } from '@arsumbris/component-contract'
import { FieldSemantics } from './field-semantics'
// <au-number-input> — the default set's Lit SHADOW implementation of the `au-number-input` contract.
//
// The dev-tool spinbutton: a naked numeric field in a hairline-ring wrapper (mirroring au-input's ring so
// the two never drift), with three affordance variants — trailing stacked carets (`stepper`, default), a
// hover-in column over a borderless grid field (`scrub`), or a `− value +` capsule (`split`). It owns the
// numeric behaviour (keyboard ±step / Shift·Page ±largeStep / Home·End = min·max, wheel-while-focused,
// hold-to-repeat on the carets, drag the value field left/right to scrub it — right = increase, left =
// decrease, in every variant — clamp + round to `precision` on commit, optional `wrap`) while the consumer
// owns `value`. A plain click still focuses to type; only a horizontal DRAG scrubs. Digits render tabular
// mono so they hold their box.
//
// FORM-ASSOCIATED: the committed value crosses the shadow boundary into a native
// `<form>` + reset. Emits `au-input` (per keystroke, uncommitted) / `au-change` (on commit), both detail
// `{ value }` (a number or null). `format` is a JS-only property (functions are not a data field). Composes
// au-icon / au-icon-button / au-spinner. TOKEN-ONLY.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { controlFocusStyle } from './focus-style'
function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0
  const s = String(n)
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

function parseBuffer(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export class AuNumberInputElement extends AuElement {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('input')?.focus(options)
  }

  private fieldSemantics = new FieldSemantics(this, () => this.renderRoot?.querySelector('input') ?? null, () => ({invalid: this.showError, label: this.label}))

  setFieldContext(owner: object, context: FieldContext | null): void {
    this.fieldSemantics.setContext(owner, context)
  }

  static formAssociated = true

  static properties = {
    _formDisabled: { state: true },
    // Standard host aria-label must name the actual shadow field, including live updates.
    ariaLabel: { type: String, attribute: 'aria-label', reflect: true },
    value: { type: Number },
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
    largeStep: { type: Number, attribute: 'large-step' },
    fineStep: { type: Number, attribute: 'fine-step' },
    precision: { type: Number },
    wrap: { type: Boolean },
    unit: { type: String },
    leading: { type: String },
    variant: { type: String, reflect: true },
    align: { type: String, reflect: true },
    size: { type: String, reflect: true },
    scrubbable: { type: Boolean },
    loading: { type: Boolean, reflect: true },
    error: { type: Boolean, reflect: true },
    placeholder: { type: String },
    disabled: { type: Boolean, reflect: true },
    readonly: { type: Boolean, reflect: true },
    label: { type: String },
    _buffer: { state: true },
    _focused: { state: true },
  }

  declare value: number | null
  declare min?: number
  declare max?: number
  declare step: number
  declare largeStep?: number
  declare fineStep?: number
  declare precision?: number
  declare wrap: boolean
  declare unit?: string
  declare leading?: string
  declare variant: 'stepper' | 'scrub' | 'split'
  declare align: 'left' | 'right'
  declare size?: 'sm' | 'md' | 'lg'
  declare scrubbable?: boolean
  declare loading: boolean
  declare error: boolean
  declare placeholder?: string
  declare disabled: boolean
  declare private _formDisabled: boolean
  declare readonly: boolean
  declare label?: string

  /** JS-only display formatter (not a data field). Default: Intl.NumberFormat with grouping. */
  format?: (n: number) => string

  private _buffer: string | null = null
  private _focused = false

  private internals: ElementInternals
  private holdTimer?: number
  private scrub: { startX: number; base: number } | null = null
  // Scrubbable fields distinguish a horizontal adjustment from a plain click-to-type.
  private fieldScrub: { startX: number; base: number; pointerId: number; active: boolean } | null = null

  constructor() {
    super()
    this.value = null
    this.step = 1
    this.wrap = false
    this.variant = 'stepper'
    this.align = 'left'
    this.loading = false
    this.error = false
    this.disabled = false
    this._formDisabled = false
    this.readonly = false
    this.internals = this.attachInternals()
  }

  formResetCallback(): void {
    this.value = null
    this._buffer = null
    this.internals.setFormValue(null)
  }
  formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled
    this.toggleAttribute('data-form-disabled', disabled)
  }

  private get precisionEff(): number {
    return this.precision ?? decimalsOf(this.step)
  }
  private get largeStepEff(): number {
    return this.largeStep ?? this.step * 10
  }
  private get fineStepEff(): number {
    return this.fineStep ?? this.step / 10
  }
  private get interactive(): boolean {
    return !this.disabled && !this._formDisabled && !this.readonly
  }
  private get scrubEnabled(): boolean {
    return (this.scrubbable ?? this.variant === 'scrub') && this.interactive
  }

  private get field(): HTMLInputElement | null {
    return this.renderRoot.querySelector('input')
  }

  private fmt(n: number): string {
    if (this.format) return this.format(n)
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: this.precisionEff,
      useGrouping: true,
    }).format(n)
  }

  private clampRound(n: number): number {
    let v = n
    if (this.wrap && this.min !== undefined && this.max !== undefined && this.max > this.min) {
      const span = this.max - this.min
      v = this.min + (((v - this.min) % span) + span) % span
    } else {
      if (this.min !== undefined) v = Math.max(this.min, v)
      if (this.max !== undefined) v = Math.min(this.max, v)
    }
    const p = Math.max(0, Math.min(20, this.precisionEff))
    return Number(v.toFixed(p))
  }

  private baseNumeric(): number {
    const fromBuffer = this._buffer !== null ? parseBuffer(this._buffer) : null
    if (fromBuffer !== null) return fromBuffer
    if (this.value != null) return this.value
    return this.min ?? 0
  }

  private syncForm(): void {
    // A React wrapper may set the property to `undefined` to clear it; treat null / undefined alike.
    this.internals.setFormValue(this.value == null ? null : String(this.value))
  }

  private commit(n: number): void {
    this.value = n
    this._buffer = this._focused ? String(n) : null
    this.syncForm()
    this.dispatchEvent(new CustomEvent('au-change', { detail: { value: this.value }, bubbles: true, composed: true }))
  }

  private stepBy(dir: 1 | -1, magnitude: number): void {
    if (!this.interactive) return
    this.commit(this.clampRound(this.baseNumeric() + dir * magnitude))
  }

  private commitBuffer(): void {
    if (this._buffer === null) return
    const parsed = parseBuffer(this._buffer)
    if (parsed === null) {
      if (this._buffer.trim() === '') {
        this.value = null
        this.syncForm()
        this.dispatchEvent(new CustomEvent('au-change', { detail: { value: null }, bubbles: true, composed: true }))
      }
      this._buffer = null
      return
    }
    this.commit(this.clampRound(parsed))
    this._buffer = null
  }

  // ── numeric / constraint state ────────────────────────────────────────────────────────────────
  private get liveNumeric(): number | null {
    return this._buffer !== null ? parseBuffer(this._buffer) : this.value
  }
  private get atMax(): boolean {
    return !this.wrap && this.max !== undefined && this.liveNumeric !== null && this.liveNumeric >= this.max
  }
  private get atMin(): boolean {
    return !this.wrap && this.min !== undefined && this.liveNumeric !== null && this.liveNumeric <= this.min
  }
  private get showError(): boolean {
    const n = this.liveNumeric
    const outOfRange = n !== null && ((this.min !== undefined && n < this.min) || (this.max !== undefined && n > this.max))
    const unparseable = this._buffer !== null && this._buffer.trim() !== '' && parseBuffer(this._buffer) === null
    return this.error || unparseable || outOfRange
  }

  private get displayValue(): string {
    if (this._buffer !== null) return this._buffer
    if (this.value == null) return ''
    return this._focused ? String(this.value) : this.fmt(this.value)
  }

  // ── input handlers ──────────────────────────────────────────────────────────────────────────
  private onInput(e: Event): void {
    this._buffer = (e.target as HTMLInputElement).value
    this.dispatchEvent(new CustomEvent('au-input', { detail: { value: parseBuffer(this._buffer) }, bubbles: true, composed: true }))
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.interactive) return
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        this.stepBy(1, e.shiftKey ? this.largeStepEff : this.step)
        break
      case 'ArrowDown':
        e.preventDefault()
        this.stepBy(-1, e.shiftKey ? this.largeStepEff : this.step)
        break
      case 'PageUp':
        e.preventDefault()
        this.stepBy(1, this.largeStepEff)
        break
      case 'PageDown':
        e.preventDefault()
        this.stepBy(-1, this.largeStepEff)
        break
      case 'Home':
        if (this.min !== undefined) {
          e.preventDefault()
          this.commit(this.clampRound(this.min))
        }
        break
      case 'End':
        if (this.max !== undefined) {
          e.preventDefault()
          this.commit(this.clampRound(this.max))
        }
        break
      case 'Enter':
        this.commitBuffer()
        break
    }
  }

  private onFocus(): void {
    this._focused = true
    this._buffer = this.value === null ? '' : String(this.value)
  }
  private onBlur(): void {
    this._focused = false
    this.commitBuffer()
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this._focused || !this.interactive) return
    e.preventDefault()
    this.stepBy(e.deltaY < 0 ? 1 : -1, e.shiftKey ? this.largeStepEff : this.step)
  }

  // ── hold-to-repeat on the carets ──────────────────────────────────────────────────────────────
  private stopHold = (): void => {
    if (this.holdTimer !== undefined) {
      window.clearTimeout(this.holdTimer)
      this.holdTimer = undefined
    }
  }
  private startHold(dir: 1 | -1): void {
    if (!this.interactive) return
    this.stepBy(dir, this.step)
    let ticks = 0
    const tick = (): void => {
      ticks += 1
      this.stepBy(dir, this.step)
      this.holdTimer = window.setTimeout(tick, ticks > 12 ? 30 : 60)
    }
    this.holdTimer = window.setTimeout(tick, 300)
    window.addEventListener('pointerup', this.stopHold, { once: true })
    window.addEventListener('pointercancel', this.stopHold, { once: true })
  }

  // ── drag-scrub on the leading label ───────────────────────────────────────────────────────────
  private onLeadDown(e: PointerEvent): void {
    if (!this.scrubEnabled) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    this.scrub = { startX: e.clientX, base: this.value ?? this.min ?? 0 }
    this.toggleAttribute('scrubbing', true) // drives :host([scrubbing]); no re-render needed
  }
  private onLeadMove(e: PointerEvent): void {
    if (this.scrub === null) return
    const magnitude = e.altKey ? this.fineStepEff : e.shiftKey ? this.largeStepEff : this.step
    const steps = Math.round((e.clientX - this.scrub.startX) / 2)
    this.commit(this.clampRound(this.scrub.base + steps * magnitude))
  }
  private endScrub(e: PointerEvent): void {
    if (this.scrub === null) return
    this.scrub = null
    this.toggleAttribute('scrubbing', false)
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }

  // ── field drag-scrub ─────────────────────────────────────────────────────────────────────────
  private onFieldDown(e: PointerEvent): void {
    // Left button / primary pointer, interactive only. preventDefault suppresses focus + text-selection
    // so a horizontal DRAG scrubs; a plain click (no drag past the threshold) focuses to type on pointerup.
    if (!this.scrubEnabled || e.button !== 0) return
    e.preventDefault()
    this.field?.setPointerCapture(e.pointerId)
    this.fieldScrub = { startX: e.clientX, base: this.value ?? this.min ?? 0, pointerId: e.pointerId, active: false }
  }
  private onFieldMove(e: PointerEvent): void {
    const s = this.fieldScrub
    if (s === null) return
    const dx = e.clientX - s.startX
    if (!s.active) {
      if (Math.abs(dx) < 3) return // still within the click threshold
      s.active = true
      this.toggleAttribute('scrubbing', true)
    }
    const magnitude = e.altKey ? this.fineStepEff : e.shiftKey ? this.largeStepEff : this.step
    const steps = Math.round(dx / 2) // 2px per step, matching the leading-label scrub
    this.commit(this.clampRound(s.base + steps * magnitude))
  }
  private onFieldUp(e: PointerEvent): void {
    const s = this.fieldScrub
    if (s === null) return
    this.fieldScrub = null
    const input = this.field
    if (input?.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId)
    if (s.active) this.toggleAttribute('scrubbing', false)
    else input?.focus() // a plain click: focus was suppressed at pointerdown, so grant it now
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────
  connectedCallback(): void {
    super.connectedCallback()
    this.requestUpdate()
  }
  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.stopHold()
    this.field?.removeEventListener('wheel', this.onWheel)
  }
  updated(): void {
    // A retained field can reconnect without rendering a new input.
    this.field?.addEventListener('wheel', this.onWheel, { passive: false })
    if (this.field) this.field.disabled = this.disabled || this._formDisabled
    this.toggleAttribute('data-invalid', this.field?.getAttribute('aria-invalid') === 'true')
    this.syncForm()
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      --_h: calc(var(--au-space-1, 4px) * 8);
      --_col-w: var(--au-space-5, 20px);
      box-sizing: border-box;
      display: inline-flex;
      align-items: stretch;
      height: var(--_h);
      min-width: 0;
      border: 1px solid var(--au-line-control);
      border-radius: var(--au-radius-md,8px);
      background: var(--au-color-surface-1, #1e2128);
      color: var(--au-ink-1, #e2dfda);
      overflow: hidden;
      transition:
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([size='sm']) {
      --_h: calc(var(--au-space-1, 4px) * 7);
      --_col-w: var(--au-space-4, 16px);
    }
    :host([size='lg']) {
      --_h: calc(var(--au-space-1, 4px) * 10);
    }
    :host(:hover),
    :host([data-force-hover]) {
      border-color: var(--au-ink-3, #a09c92);
    }
    :host(:focus-within),
    :host([data-force-focus]) {
      ${controlFocusStyle}
      border-color: var(--au-ink-4, #959083);
    }
    :host([error]),
    :host([data-invalid]),
    :host([data-force-error]) {
      border-color: var(--au-color-danger, #c0392b);
    }
    :host([error]:focus-within),
    :host([data-invalid]:focus-within),
    :host([data-invalid][data-force-focus]),
    :host([error][data-force-focus]),
    :host([data-force-error][data-force-focus]) {
      outline-color: var(--au-color-danger, #c0392b);
    }
    :host([disabled]),
    :host([data-form-disabled]),
    :host([data-force-disabled]) {
      opacity: var(--au-opacity-disabled, 0.5);
      pointer-events: none;
    }
    /* value input — naked, mono, tabular */
    input {
      flex: 1 1 auto;
      min-width: 0;
      align-self: stretch;
      box-sizing: border-box;
      margin: 0;
      border: 0;
      background: none;
      color: var(--au-ink-1, #e2dfda);
      padding-block: 0;
      padding-inline: var(--au-space-3, 12px) var(--au-space-2, 8px);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-variant-numeric: tabular-nums;
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      text-align: left;
    }
    input:focus {
      outline: none;
    }
    input::placeholder {
      color: var(--au-ink-4, #959083);
    }
    :host([size='sm']) input {
      padding-inline: var(--au-space-2, 8px);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    :host([align='right']) input {
      text-align: right;
    }
    :host([data-has-lead]) input {
      padding-inline-start: var(--au-space-2, 8px);
    }
    :host([data-has-unit]) input {
      padding-inline-end: 0;
    }
    /* leading label / scrub handle */
    .lead {
      display: inline-flex;
      align-items: center;
      align-self: stretch;
      padding-inline-start: var(--au-space-3, 12px);
      color: var(--au-ink-4, #959083);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      user-select: none;
      transition: color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([size='sm']) .lead {
      padding-inline-start: var(--au-space-2, 8px);
    }
    .lead[data-scrubbable] {
      cursor: ew-resize;
      touch-action: none;
    }
    .lead[data-scrubbable]:hover {
      color: var(--au-ink-2, #d9d6cd);
    }
    /* unit suffix */
    .unit {
      display: inline-flex;
      align-items: center;
      align-self: stretch;
      padding-inline: var(--au-space-1, 4px) var(--au-space-2, 8px);
      color: var(--au-ink-4, #959083);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      user-select: none;
      pointer-events: none;
      white-space: nowrap;
    }
    /* stacked stepper column */
    .steppers {
      flex: 0 0 auto;
      width: var(--_col-w);
      display: flex;
      flex-direction: column;
      align-self: stretch;
      border-inline-start: 1px solid var(--au-line-2, #3a3a3a);
    }
    .caret {
      flex: 1 1 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--au-ink-4, #959083);
      cursor: pointer;
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .caret.up {
      border-bottom: 1px solid var(--au-line-2, #3a3a3a);
    }
    .caret:hover {
      background: var(--au-chrome-hover);
      color: var(--au-ink-1, #e2dfda);
    }
    .caret:active {
      background: var(--au-chrome-active, rgba(245, 243, 238, 0.075));
      color: var(--au-ink-1, #e2dfda);
      transform: scale(0.94);
    }
    .caret:disabled {
      color: var(--au-ink-5, #3f3c36);
      cursor: not-allowed;
    }
    /* gallery freeze: press the up-caret from the host (the states matrix). */
    :host([data-force-active]) .caret.up {
      background: var(--au-chrome-active, rgba(245, 243, 238, 0.075));
      color: var(--au-ink-1, #e2dfda);
    }
    /* split variant — [−] value [+] */
    :host([variant='split']) input {
      text-align: center;
      border-inline: 1px solid var(--au-line-2, #3a3a3a);
      padding-inline: var(--au-space-2, 8px);
    }
    .pm {
      flex: 0 0 auto;
      align-self: center;
    }
    /* scrub variant — borderless in the grid; column fades in on hover / focus */
    :host([variant='scrub']) {
      border-color: transparent;
      background: none;
    }
    :host([variant='scrub']:hover),
    :host([variant='scrub'][data-force-hover]) {
      border-color: var(--au-line-2, #3a3a3a);
      background: var(--au-color-surface-1, #1e2128);
    }
    :host([variant='scrub']:focus-within),
    :host([variant='scrub'][data-force-focus]) {
      border-color: var(--au-ink-4, #959083);
      background: var(--au-color-surface-1, #1e2128);
    }
    :host([variant='scrub'][data-invalid]),
    :host([variant='scrub'][error]),
    :host([variant='scrub'][data-force-error]) {
      border-color: var(--au-color-danger, #c0392b);
    }
    :host([variant='scrub']) .steppers {
      opacity: 0;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([variant='scrub']:hover) .steppers,
    :host([variant='scrub']:focus-within) .steppers,
    :host([variant='scrub'][data-force-hover]) .steppers,
    :host([variant='scrub'][data-force-focus]) .steppers {
      opacity: 1;
    }
    :host([scrubbing]),
    :host([data-force-scrubbing]) {
      cursor: ew-resize;
    }
    :host([scrubbing]) .steppers,
    :host([data-force-scrubbing]) .steppers {
      opacity: 0;
    }
    :host([scrubbing]) .lead,
    :host([data-force-scrubbing]) .lead {
      color: var(--au-ink-2, #d9d6cd);
    }
    :host([scrubbing]) input,
    :host([data-force-scrubbing]) input {
      user-select: none;
    }
    /* loading — spinner in the trailing slot; value dims */
    :host([loading]) input {
      opacity: var(--au-opacity-muted,0.65);
    }
    .spin {
      display: inline-flex;
      align-items: center;
      align-self: center;
      padding-inline: var(--au-space-2, 8px);
    }
    @media (prefers-reduced-motion: reduce) {
      .caret:active {
        transform: none;
      }
    }
  `

  render() {
    const hasLead = this.leading != null && this.leading !== ''
    const hasUnit = this.unit != null && this.unit !== ''
    if (hasLead) this.setAttribute('data-has-lead', '')
    else this.removeAttribute('data-has-lead')
    if (hasUnit) this.setAttribute('data-has-unit', '')
    else this.removeAttribute('data-has-unit')

    const valueText =
      this.value == null ? undefined : `${this.fmt(this.value)}${hasUnit ? ` ${this.unit}` : ''}`

    const steppers =
      this.variant !== 'split'
        ? html`
            <div class="steppers" part="steppers">
              <button
                class="caret up" part="caret-up" type="button" tabindex="-1" aria-label="Increment"
                ?disabled=${!this.interactive || this.atMax}
                @pointerdown=${() => this.startHold(1)} @pointerup=${this.stopHold} @pointerleave=${this.stopHold}
              ><au-icon name="chevron-up" size="xs"></au-icon></button>
              <button
                class="caret down" part="caret-down" type="button" tabindex="-1" aria-label="Decrement"
                ?disabled=${!this.interactive || this.atMin}
                @pointerdown=${() => this.startHold(-1)} @pointerup=${this.stopHold} @pointerleave=${this.stopHold}
              ><au-icon name="chevron-down" size="xs"></au-icon></button>
            </div>
          `
        : nothing

    return html`
      ${this.variant === 'split'
        ? html`<au-icon-button class="pm" size="xs" aria-label="Decrement" tabindex="-1"
              ?disabled=${!this.interactive || this.atMin}
              @pointerdown=${() => this.startHold(-1)} @pointerup=${this.stopHold} @pointerleave=${this.stopHold}
            ><au-icon name="minus" size="sm"></au-icon></au-icon-button>`
        : nothing}
      ${hasLead
        ? html`<span class="lead" part="lead" aria-hidden="true" ?data-scrubbable=${this.scrubEnabled}
              @pointerdown=${this.onLeadDown} @pointermove=${this.onLeadMove} @pointerup=${this.endScrub} @pointercancel=${this.endScrub}
            >${this.leading}</span>`
        : nothing}
      <input
        part="field"
        type="text"
        inputmode="decimal"
        role="spinbutton"
        autocomplete="off"
        spellcheck="false"
        aria-valuenow=${this.value ?? nothing}
        aria-valuemin=${this.min ?? nothing}
        aria-valuemax=${this.max ?? nothing}
        aria-valuetext=${valueText ?? nothing}
        aria-busy=${this.loading ? 'true' : nothing}
        placeholder=${this.placeholder ?? ''}
        ?disabled=${this.disabled || this._formDisabled}
        ?readonly=${this.readonly}
        .value=${this.displayValue}
        @input=${this.onInput}
        @keydown=${this.onKeyDown}
        @focus=${this.onFocus}
        @blur=${this.onBlur}
        @pointerdown=${this.onFieldDown}
        @pointermove=${this.onFieldMove}
        @pointerup=${this.onFieldUp}
        @pointercancel=${this.onFieldUp}
      />
      ${hasUnit ? html`<span class="unit" part="unit" aria-hidden="true">${this.unit}</span>` : nothing}
      ${this.loading ? html`<span class="spin"><au-spinner size="sm"></au-spinner></span>` : steppers}
      ${this.variant === 'split'
        ? html`<au-icon-button class="pm" size="xs" aria-label="Increment" tabindex="-1"
              ?disabled=${!this.interactive || this.atMax}
              @pointerdown=${() => this.startHold(1)} @pointerup=${this.stopHold} @pointerleave=${this.stopHold}
            ><au-icon name="plus" size="sm"></au-icon></au-icon-button>`
        : nothing}
    `
  }
}
