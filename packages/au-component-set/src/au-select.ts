import { installBackdropMaterial } from './surface-material'
import { pickerKeyframes, pickerExitMotion } from './picker-motion'
// <au-select> — the default set's Lit SHADOW implementation of the `au-select` contract.
//
// A form value-picker: a field TRIGGER (matching au-input's box so a select + an input line up) and a
// floating LISTBOX of `options`. DATA-DRIVEN (`options` is a au-select-option[]), like au-segmented-control /
// au-radio-group.
//
// The listbox uses a layer claimed from `host.overlay` (the dropdown band) via ClaimOverlay.
// The host owns insertion, clip escape and `--au-z-*` stacking;
// this component owns the whole listbox UI, its placement off the trigger rect, light-dismiss, and the
// listbox keyboard (Arrow/Home/End move the roving cursor skipping disabled, Enter/Space pick, Escape/Tab
// dismiss). When no host is present (a standalone gallery render) `claimOverlay` returns null and the
// trigger simply does not open — render-resilient, never a throw.
//
// FORM-ASSOCIATED: the chosen value crosses the shadow boundary into a native
// `<form>` + reset. Emits `au-change` (detail `{ value }`, composed + bubbling) on pick. TOKEN-ONLY on both
// the trigger shadow and the listbox's own shadow.

import { css, html, nothing, render, type PropertyValues } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { pickerSurface, pickerRow, pickerRowHover, pickerRowSeparation, pickerRowFocus, pickerRowSelected } from './picker-style'
import { controlFocusStyle } from './focus-style'
import { FieldSemantics } from './field-semantics'
import type { FieldContext, OverlayLayer } from '@arsumbris/component-contract'
import { ClaimOverlay } from './claim-overlay'
import { closePicker } from './picker-motion'

/** One option: a stable value, its label, an optional leading au-icon glyph name, and a disabled flag. */
export interface AuSelectOption {
  value: string
  label: string
  icon?: string
  disabled?: boolean
}

const GAP = 4 // ~ --au-space-1: the listbox sits just under (or over) the trigger
const MARGIN = 8 // keep this far off the window edge

// The listbox has a separate shadow root inside its claimed layer.
// Document-root design tokens inherit across that boundary.
const LISTBOX_STYLES = css`
  ${pickerKeyframes}
  .popup[data-state='closed'] { ${pickerExitMotion} }
  ${reducedControlMotion}
  :host {
    display: block;
  }
  .popup { ${pickerSurface} }
  .viewport {
    max-height: min(calc(var(--au-space-1, 4px) * 72), var(--_select-available-height, 100vh));
    outline: none;
  }
  .option { ${pickerRow} }
  .option + .option { ${pickerRowSeparation} }
  .option[aria-selected='true'] { ${pickerRowSelected} }
  .option:hover, .option[data-active] { ${pickerRowHover} }
  .viewport:focus-visible .option[data-active] { ${pickerRowFocus} }
  .option[aria-disabled='true'] {
    color: var(--au-ink-5, #3f3c36);
    background: transparent;
    cursor: not-allowed;
    pointer-events: none;
  }
  /* Reserve the trailing selection slot on every row so labels align. */
  .check,
  .opticon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--au-t-body, 16px);
    height: var(--au-t-body, 16px);
  }
  .check {
    color: var(--au-ink-1, #e2dfda);
  }
  .opticon {
    color: var(--au-ink-3, #a09c92);
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

export class AuSelectElement extends ClaimOverlay(AuElement) {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('.trigger')?.focus(options)
  }

  private triggerSemantics = new FieldSemantics(this,
    () => this.renderRoot?.querySelector('.trigger') ?? null,
    () => ({ label: this.label, supportsRequired: false }))
  private listSemantics = new FieldSemantics(this,
    () => this.#menuHost?.shadowRoot?.querySelector('.viewport') ?? null,
    () => ({ label: this.label }))

  setFieldContext(owner: object, context: FieldContext | null): void {
    this.triggerSemantics.setContext(owner, context)
    this.listSemantics.setContext(owner, context)
  }

  static formAssociated = true

  static properties = {
    _formDisabled: { state: true },
    options: { attribute: false },
    value: { type: String },
    placeholder: { type: String },
    disabled: { type: Boolean, reflect: true },
    size: { type: String, reflect: true },
    label: { type: String },
    open: { type: Boolean, reflect: true },
    triggerIcon: { type: String, attribute: 'trigger-icon', reflect: true },
  }

  declare options: AuSelectOption[]
  declare value: string
  declare placeholder?: string
  declare disabled: boolean
  declare size?: 'sm' | 'md' | 'lg'
  declare label?: string
  declare open: boolean
  declare triggerIcon?: string

  declare private _formDisabled: boolean

  private get unavailable(): boolean { return this.disabled || this._formDisabled }

  private internals: ElementInternals
  #layer: OverlayLayer | null = null
  #menuHost: HTMLDivElement | null = null
  #activeIndex = -1
  #typedPrefix = ''
  #typedAt = 0

  constructor() {
    super()
    this.options = []
    this.value = ''
    this.disabled = false
    this._formDisabled = false
    this.open = false
    this.internals = this.attachInternals()
  }

  formResetCallback(): void {
    this.value = ''
    this.internals.setFormValue(null)
  }
  formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled
    this.toggleAttribute('data-form-disabled', disabled)
    // Attribute reflection can invoke this callback during Lit's current update,
    // after render has read the previous form state. Schedule its follow-up
    // after that update so re-enabling cannot leave a stale disabled trigger.
    queueMicrotask(() => this.requestUpdate())
  }

  private syncForm(): void {
    this.internals.setFormValue(this.value === '' ? null : this.value)
  }

  updated(changed: PropertyValues): void {
    this.syncForm()
    if (this.open && this.unavailable) this.#close(false)
    if (this.open && this.#menuHost && (changed.has('options') || changed.has('value'))) {
      if (!this.options[this.#activeIndex] || this.options[this.#activeIndex]?.disabled) this.#activeIndex = this.firstEnabled
      this.#renderMenu()
    }
  }

  private get selectedIndex(): number {
    return this.options.findIndex((o) => o.value === this.value)
  }
  private get firstEnabled(): number {
    return this.options.findIndex((o) => !o.disabled)
  }
  private get lastEnabled(): number {
    for (let i = this.options.length - 1; i >= 0; i--) if (!this.options[i]?.disabled) return i
    return -1
  }

  // Advance the cursor to the next enabled row in `dir`, clamping at the ends (no wrap).
  #stepCursor(from: number, dir: 1 | -1): number {
    const n = this.options.length
    let i = from
    for (let c = 0; c < n; c++) {
      i += dir
      if (i < 0 || i >= n) return from
      if (!this.options[i]?.disabled) return i
    }
    return from
  }

  #choose(index: number): void {
    const opt = this.options[index]
    if (!opt || opt.disabled) return
    this.value = opt.value
    this.syncForm()
    this.dispatchEvent(new CustomEvent('au-change', { detail: { value: this.value }, bubbles: true, composed: true }))
    this.#close(true)
  }

  #onTrigger(): void {
    if (this.unavailable) return
    if (this.open) this.#close(false)
    else this.#openMenu('first')
  }

  #onTriggerKey(e: KeyboardEvent): void {
    if (this.unavailable || this.open) return
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.#openMenu('first')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.#openMenu('last')
    }
  }

  #onListKey = (e: KeyboardEvent): void => {
    if (e.isComposing) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        this.#setActive(this.#stepCursor(this.#activeIndex, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        this.#setActive(this.#stepCursor(this.#activeIndex, -1))
        break
      case 'Home':
        e.preventDefault()
        this.#setActive(this.firstEnabled)
        break
      case 'End':
        e.preventDefault()
        this.#setActive(this.lastEnabled)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        this.#choose(this.#activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        this.#close(true)
        break
      case 'Tab':
        // Restore the trigger synchronously, then let native Tab traverse from its place
        // in the document (the popup lives in a separate overlay). Do not trap focus.
        this.#close(false)
        this.focus()
        break
      default:
        if (!e.ctrlKey && !e.metaKey && !e.altKey && [...e.key].length === 1) {
          e.preventDefault()
          this.#findPrefix(e.key)
        }
    }
  }

  #findPrefix(key: string): void {
    const now = performance.now()
    // A typing cadence, not an animation duration: repeated letters cycle matching rows.
    this.#typedPrefix = (now - this.#typedAt > 700 ? '' : this.#typedPrefix) + key.toLocaleLowerCase()
    this.#typedAt = now
    const letters = [...this.#typedPrefix]
    const cycling = letters.every(letter => letter === letters[0])
    const prefix = cycling ? letters[0]! : this.#typedPrefix
    const start = this.#activeIndex + (cycling ? 1 : 0)
    for (let step = 0; step < this.options.length; step++) {
      const index = (Math.max(0, start) + step) % this.options.length
      const option = this.options[index]!
      if (!option.disabled && option.label.trimStart().toLocaleLowerCase().startsWith(prefix)) {
        this.#setActive(index)
        return
      }
    }
  }

  #setActive(index: number): void {
    if (index < 0) return
    this.#activeIndex = index
    this.#renderMenu()
    // Scroll the cursor row into view within the listbox viewport.
    const vp = this.#menuHost?.shadowRoot?.querySelector('.viewport')
    vp?.querySelectorAll('.option')[index]?.scrollIntoView({ block: 'nearest' })
  }

  #optionsTemplate() {
    return html`
      <div class="popup" part="popup">
        <au-scroll-area axis="y"
          class="viewport"
          role="listbox"
          tabindex="-1"
          aria-activedescendant=${this.#activeIndex >= 0 ? `option-${this.#activeIndex}` : nothing}
          @keydown=${this.#onListKey}
        >
          ${this.options.map((opt, i) => {
            const selected = i === this.selectedIndex
            const active = i === this.#activeIndex
            return html`
              <div
                id=${`option-${i}`}
                class="option"
                role="option"
                aria-selected=${selected ? 'true' : 'false'}
                aria-disabled=${opt.disabled ? 'true' : nothing}
                ?data-active=${active}
                @click=${() => this.#choose(i)}
              >
                ${opt.icon ? html`<span class="opticon" aria-hidden="true"><au-icon name=${opt.icon} size="sm"></au-icon></span>` : nothing}
                <span class="label">${opt.label}</span>
                <span class="check" aria-hidden="true">${selected ? html`<au-icon name="check" size="sm"></au-icon>` : nothing}</span>
              </div>
            `
          })}
        </au-scroll-area>
      </div>
    `
  }

  #renderMenu(): void {
    const shadow = this.#menuHost?.shadowRoot
    if (shadow) render(this.#optionsTemplate(), shadow)
    this.listSemantics.hostUpdated()
  }

  #triggerObserver: ResizeObserver | null = null

  #openMenu(fallback: 'first' | 'last'): void {
    const sel = this.selectedIndex
    this.#activeIndex = sel >= 0 && !this.options[sel]?.disabled ? sel : fallback === 'last' ? this.lastEnabled : this.firstEnabled

    const layer = this.claimOverlay('dropdown')
    if (!layer) return // no host present (standalone render) — degrade to a no-op, never throw
    this.#layer = layer

    const menuHost = document.createElement('div')
    menuHost.style.position = 'fixed'
    menuHost.style.visibility = 'hidden' // hidden for the pre-measure paint; revealed once placed
    menuHost.style.pointerEvents = 'auto' // the layer is transparent; the listbox re-enables events
    const menuRoot = menuHost.attachShadow({ mode: 'open' })
    installBackdropMaterial(menuRoot)
    menuRoot.adoptedStyleSheets = [LISTBOX_STYLES.styleSheet as CSSStyleSheet]
    layer.el.appendChild(menuHost)
    this.#menuHost = menuHost
    this.#renderMenu()

    this.open = true
    this.#place()
    if (!this.open) return
    const trigger = this.renderRoot.querySelector('.trigger')
    this.#triggerObserver = new ResizeObserver(this.#place)
    if (trigger) this.#triggerObserver.observe(trigger)
    requestAnimationFrame(() => {
      if (!this.open || this.#menuHost !== menuHost) return
      this.#place() // second pass once content settled its real size
      if (!this.open || this.#menuHost !== menuHost) return
      ;(menuHost.shadowRoot?.querySelector('.viewport') as HTMLElement | null)?.focus() // arrows land on the listbox
      menuHost.shadowRoot?.querySelectorAll('.option')[this.#activeIndex]?.scrollIntoView({ block: 'nearest' })
    })
    window.addEventListener('resize', this.#place, true)
    window.addEventListener('scroll', this.#place, true)
    document.addEventListener('pointerdown', this.#onDocPointer, true)
  }

  #close(refocus: boolean): void {
    if (!this.open) return
    this.open = false
    this.#typedPrefix = ''
    this.#typedAt = 0
    this.#triggerObserver?.disconnect()
    this.#triggerObserver = null
    window.removeEventListener('resize', this.#place, true)
    window.removeEventListener('scroll', this.#place, true)
    document.removeEventListener('pointerdown', this.#onDocPointer, true)
    const surface = this.#menuHost?.shadowRoot?.querySelector<HTMLElement>('.popup') ?? null
    const layer = this.#layer
    if (this.#menuHost) { this.#menuHost.inert = true; this.#menuHost.setAttribute('aria-hidden', 'true') }
    this.#menuHost = null
    this.#layer = null
    closePicker(surface, () => layer?.release())
    if (refocus) requestAnimationFrame(() => { if (this.isConnected && !this.open) this.focus() })
  }

  // Measure the trigger, place the listbox below or above according to available space,
  // and clamp it to the viewport.
  #place = (): void => {
    const menuHost = this.#menuHost
    const trigger = this.renderRoot.querySelector('.trigger')
    if (!menuHost || !trigger) return
    const r = trigger.getBoundingClientRect()
    // Responsive composition may hide the trigger without unmounting its component.
    // A hidden anchor cannot own a visible dropdown or reclaim keyboard focus.
    if (!this.isConnected || !trigger.checkVisibility({ checkVisibilityCSS: true }) || r.width <= 0 || r.height <= 0) {
      this.#close(false)
      return
    }
    const vw = window.innerWidth
    const vh = window.innerHeight

    const availableWidth = Math.max(0, vw - MARGIN * 2)
    menuHost.style.minWidth = `${Math.min(r.width, availableWidth)}px`
    menuHost.style.maxWidth = `${availableWidth}px`
    menuHost.style.removeProperty('--_select-available-height')

    const below = Math.max(0, vh - r.bottom - GAP - MARGIN)
    const above = Math.max(0, r.top - GAP - MARGIN)
    const naturalHeight = menuHost.offsetHeight
    const placeBelow = naturalHeight <= below || below >= above
    const availableHeight = placeBelow ? below : above
    const popup = menuHost.shadowRoot?.querySelector<HTMLElement>('.popup')
    const viewport = menuHost.shadowRoot?.querySelector<HTMLElement>('.viewport')
    const frameHeight = popup && viewport ? popup.offsetHeight - viewport.offsetHeight : 0
    // Geometry constraint, not a theme override; keep the existing density-derived menu maximum.
    menuHost.style.setProperty('--_select-available-height', `${Math.max(0, availableHeight - frameHeight)}px`)
    const menuW = menuHost.offsetWidth
    const menuH = menuHost.offsetHeight
    const left = Math.max(MARGIN, Math.min(r.left, vw - MARGIN - menuW))
    const top = placeBelow ? r.bottom + GAP : Math.max(MARGIN, r.top - GAP - menuH)
    menuHost.style.top = `${top}px`
    menuHost.style.left = `${left}px`
    menuHost.style.visibility = 'visible'
  }

  #onDocPointer = (e: PointerEvent): void => {
    const path = e.composedPath()
    // The listbox lives OUTSIDE this element (in the overlay layer), so treat it as inside too — else a
    // click on an option reads as outside and tears the listbox down before the option's click lands.
    if (path.includes(this) || (this.#menuHost && path.includes(this.#menuHost))) return
    this.#close(false)
  }

  override disconnectedCallback(): void {
    this.#close(false)
    super.disconnectedCallback()
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      width: 100%;
    }
    .trigger {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      width: 100%;
      height: calc(var(--au-space-1, 4px) * 8);
      padding-inline: var(--au-space-3, 12px);
      border: 1px solid var(--au-line-control);
      border-radius: var(--au-radius-md,8px);
      background: var(--au-color-surface-1, #1e2128);
      color: var(--au-ink-1, #e2dfda);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      text-align: start;
      cursor: pointer;
      transition:
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([size='sm']) .trigger {
      height: calc(var(--au-space-1, 4px) * 7);
      padding-inline: var(--au-space-2, 8px);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    :host([size='lg']) .trigger {
      height: calc(var(--au-space-1, 4px) * 10);
      padding-inline: var(--au-space-4, 16px);
      font-size: var(--au-t-body, 16px);
    }
    :host([trigger-icon]) { width: auto; display: inline-flex; }
    :host([trigger-icon]) .trigger {
      width: calc(var(--au-space-1, 4px) * 8);
      justify-content: center; padding: 0; border: 0; background: transparent;
      color: var(--au-ink-3, #a09c92);
    }
    :host([trigger-icon][size='sm']) .trigger { width: calc(var(--au-space-1, 4px) * 7); }
    :host([trigger-icon][size='lg']) .trigger { width: calc(var(--au-space-1, 4px) * 10); }
    :host([trigger-icon]) .trigger:hover,
    :host([trigger-icon][open]) .trigger { ${pickerRowHover} }
    .trigger:hover,
    :host([data-force-hover]) .trigger {
      border-color: var(--au-ink-3);
    }
    .trigger:focus-visible,
    :host([data-force-focus]) .trigger {
      ${controlFocusStyle}
      border-color: var(--au-ink-4, #959083);
    }
    :host([open]) .trigger,
    :host([data-force-open]) .trigger {
      border-color: var(--au-ink-4, #959083);
    }
    :host([disabled]) .trigger,
    :host([data-form-disabled]) .trigger,
    :host([data-force-disabled]) .trigger {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
      background: var(--au-color-bg, #14161c);
    }
    .trigger[aria-invalid='true'],
    .trigger[aria-invalid='true']:hover {
      border-color: var(--au-color-danger, #c0392b);
    }
    .icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: var(--au-t-body, 16px);
      height: var(--au-t-body, 16px);
      color: var(--au-ink-3, #a09c92);
    }
    .value {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .value[data-placeholder] {
      color: var(--au-ink-4, #959083);
    }
    .chevron {
      display: inline-flex;
      flex: none;
      color: var(--au-ink-4, #959083);
      transition:
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .trigger:hover .chevron {
      color: var(--au-ink-2, #d9d6cd);
    }
    :host([open]) .chevron,
    :host([data-force-open]) .chevron {
      color: var(--au-ink-2, #d9d6cd);
      transform: rotate(180deg);
    }
  `

  render() {
    const opt = this.options[this.selectedIndex]
    return html`
      <button
        class="trigger"
        part="trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded=${this.open ? 'true' : 'false'}
        ?disabled=${this.unavailable}
        ?data-open=${this.open}
        @click=${this.#onTrigger}
        @keydown=${this.#onTriggerKey}
      >
        ${this.triggerIcon ? html`<au-icon name=${this.triggerIcon} size="sm" aria-hidden="true"></au-icon>` : html`
        ${opt?.icon ? html`<span class="icon" part="icon" aria-hidden="true"><au-icon name=${opt.icon} size="sm"></au-icon></span>` : nothing}
        <span class="value" part="value" ?data-placeholder=${!opt}>${opt ? opt.label : this.placeholder ?? ''}</span>
        <span class="chevron" part="chevron" aria-hidden="true"><au-icon name="chevron-down" size="xs"></au-icon></span>
        `}
      </button>
    `
  }
}
