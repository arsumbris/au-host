import { installBackdropMaterial } from './surface-material'
// <au-combobox> — the default set's Lit SHADOW implementation of the `au-combobox` contract.
//
// SELECT THAT FILTERS. Shares the picker surface and row-state recipes with au-select, plus
// the states only a filtered list has: a borderless SEARCH
// field, an ink-WEIGHT match highlight (never hue), a no-match empty block, an optional monochrome
// CREATE row, an async spinner/skeleton path, and an optional multi-select chip field. DATA-DRIVEN
// (`options` is a au-combobox-option[]), like au-select / au-segmented-control.
//
// The host owns overlay insertion, clipping escape and stacking. The component owns scoped popup
// content, positioning, light dismissal and keyboard navigation. A missing overlay host leaves
// the control closed. Options live in the claimed layer's light DOM so inline inputs can expose
// accessible control/active-option relationships without duplicate hidden lists.
//
// FORM-ASSOCIATED: the committed value(s) cross the shadow boundary into a native `<form>` + reset.
// Emits `au-change` ({ value } single / { values } multi), `au-input` ({ query }) per keystroke, and
// `au-create` ({ query }) when the create row runs. All composed + bubbling.

import { css, html, nothing, render, type PropertyValues, type TemplateResult } from 'lit'
import { AuElement } from './au-element'
import { FieldSemantics } from './field-semantics'
import type { FieldContext } from '@arsumbris/component-contract'
import { reducedControlMotion } from './control-motion'
import { pickerSurface, pickerRow, pickerRowHover, pickerRowFocus, pickerRowSelected, pickerRowSeparation, pickerScrollInset } from './picker-style'
import { scrollbarStyle } from './scrollbar-style'
import { pickerKeyframes, pickerExitMotion, closePicker } from './picker-motion'
import { controlFocusStyle } from './focus-style'
import type { OverlayLayer } from '@arsumbris/component-contract'
import { ClaimOverlay } from './claim-overlay'

/** One option: a stable value, its label, an optional leading glyph (au-icon name OR raw emoji/text),
 *  an optional muted secondary line, an optional right-aligned mono meta, and a disabled flag. */
export interface AuComboboxOption {
  value: string
  label: string
  icon?: string
  secondary?: string
  meta?: string
  disabled?: boolean
}

const GAP = 4 // ~ --au-space-1: the popup sits just under (or over) the field
const MARGIN = 8 // keep this far off the window edge

// An au-icon glyph NAME looks like `chevron-down`; anything else (an emoji flag, an initial) renders raw.
const GLYPH_NAME = /^[a-z][a-z0-9-]*$/

// The popup uses scoped light DOM in the claimed layer so inline inputs can reference its options.
// Each popup owns and releases its scoped stylesheet with its exit lifecycle.
const POPUP_STYLES = css`
  ${pickerKeyframes}
  .popup[data-state='closed'] { ${pickerExitMotion} }
  ${reducedControlMotion}
  :host {
    display: block;
  }
  .popup { ${pickerSurface} }
  /* SEARCH row (trigger mode) — a borderless field sealed off by one hairline. */
  .search {
    display: flex;
    align-items: center;
    gap: var(--au-space-2, 8px);
    height: calc(var(--au-space-1, 4px) * 9);
    padding-inline: var(--au-space-2, 8px);
    border-bottom: 1px solid var(--au-line-1, rgba(255, 255, 255, 0.08));
    margin-bottom: var(--au-space-1, 4px);
  }
  .search-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--au-t-body, 16px);
    height: var(--au-t-body, 16px);
    color: var(--au-ink-3, #a09c92);
  }
  .search-input {
    all: unset;
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: 100%;
    color: var(--au-ink-1, #e2dfda);
    font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    font-size: var(--au-t-base, 14px);
    line-height: var(--au-lh-base,20px);
  }
  .search-input::placeholder {
    color: var(--au-ink-4, #959083);
  }
  .viewport {
    ${pickerScrollInset}
    max-height: min(calc(var(--au-space-1, 4px) * 72), var(--_combobox-available-height, 100vh));
    overflow-y: auto;
    outline: none;
  }
  .viewport[data-loading] .label {
    color: var(--au-ink-3, #a09c92);
  }
  ${scrollbarStyle(css`.viewport`)}
  .option { ${pickerRow} }
  .option + .option { ${pickerRowSeparation} }
  .option[aria-selected='true'] { ${pickerRowSelected} }
  .option:hover, .option[data-active] { ${pickerRowHover} }
  .popup[data-navigation='keyboard'] .option[data-active] { ${pickerRowFocus} }
  .option[aria-disabled='true'] {
    color: var(--au-ink-5, #3f3c36);
    background: transparent;
    cursor: not-allowed;
    pointer-events: none;
  }
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
    font-size: var(--au-t-xs, 12px);
  }
  .option:hover .opticon,
  .option[data-active] .opticon {
    color: var(--au-ink-1, #e2dfda);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--au-space-0-5, 2px);
    flex: 1 1 auto;
    min-width: 0;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label mark {
    color: var(--au-ink-1, #e2dfda);
    background: transparent;
    font-weight: var(--au-w-strong,590);
  }
  .secondary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--au-ink-4, #959083);
    font-size: var(--au-t-xs, 12px);
    line-height: var(--au-lh-xs,16px);
  }
  .meta {
    flex: none;
    margin-left: var(--au-space-2, 8px);
    color: var(--au-ink-4, #959083);
    font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
    font-size: var(--au-t-xs, 12px);
    line-height: var(--au-lh-xs,16px);
    font-variant-numeric: tabular-nums;
  }
  /* CREATE-NEW row — a monochrome actionable row emphasized through ink weight. */
  .create .label {
    color: var(--au-ink-2, #d9d6cd);
    font-weight: var(--au-w-medium, 500);
  }
  .create:hover .label,
  .create[data-active] .label {
    color: var(--au-ink-1, #e2dfda);
  }
  .create-query {
    color: var(--au-ink-1, #e2dfda);
  }
  .empty {
    padding: var(--au-space-6, 24px) var(--au-space-3, 12px);
    text-align: center;
    color: var(--au-ink-4, #959083);
  }
  .empty-title {
    color: var(--au-ink-2, #d9d6cd);
    font-size: var(--au-t-sm, 13px);
  }
  .empty-hint {
    margin-top: var(--au-space-1, 4px);
    font-size: var(--au-t-xs, 12px);
  }
  /* async skeleton rows — a self-contained shimmer (no dependency on au-skeleton). */
  .skeleton-row {
    ${pickerRow}
    cursor: default;
  }
  .skeleton-row + .skeleton-row { ${pickerRowSeparation} }
  .skeleton-bar { flex: 1; min-width: 0; }

`

export class AuComboboxElement extends ClaimOverlay(AuElement) {
  private controlSemantics = new FieldSemantics(this,
    () => this.renderRoot?.querySelector('.trigger, .control-input') ?? null,
    () => ({ label: this.label, supportsRequired: this.mode === 'inline' }))
  private searchSemantics = new FieldSemantics(this,
    () => this.#menuHost?.querySelector('.search-input') ?? null,
    () => ({ label: this.label }))
  private listSemantics = new FieldSemantics(this,
    () => this.#menuHost?.querySelector('.viewport') ?? null,
    () => ({ label: this.label }))

  setFieldContext(owner: object, context: FieldContext | null): void {
    this.controlSemantics.setContext(owner, context)
    this.searchSemantics.setContext(owner, context)
    this.listSemantics.setContext(owner, context)
  }

  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('.trigger, .control-input')?.focus(options)
  }

  static formAssociated = true

  static properties = {
    options: { attribute: false },
    value: { type: String },
    values: { attribute: false },
    multiple: { type: Boolean, reflect: true },
    mode: { type: String, reflect: true },
    placeholder: { type: String },
    searchPlaceholder: { type: String, attribute: 'search-placeholder' },
    filterable: { type: Boolean },
    remote: { type: Boolean },
    loading: { type: Boolean, reflect: true },
    creatable: { type: Boolean },
    disabled: { type: Boolean, reflect: true },
    label: { type: String },
    open: { type: Boolean, reflect: true },
    query: { type: String },
  }

  declare options: AuComboboxOption[]
  declare value: string
  declare values: string[]
  declare multiple: boolean
  declare mode: 'trigger' | 'inline'
  declare placeholder?: string
  declare searchPlaceholder?: string
  declare filterable: boolean
  declare remote: boolean
  declare loading: boolean
  declare creatable: boolean
  declare disabled: boolean
  declare label?: string
  declare open: boolean
  declare query: string

  private internals: ElementInternals
  #popupId = `au-combobox-${crypto.randomUUID()}`
  #removePopupStyle: (() => void) | null = null
  #layer: OverlayLayer | null = null
  #menuHost: HTMLDivElement | null = null
  #activeIndex = -1
  #pointerNavigation = false

  constructor() {
    super()
    this.options = []
    this.value = ''
    this.values = []
    this.multiple = false
    this.mode = 'trigger'
    this.filterable = true
    this.remote = false
    this.loading = false
    this.creatable = false
    this.disabled = false
    this.open = false
    this.query = ''
    this.internals = this.attachInternals()
  }

  formResetCallback(): void {
    this.value = ''
    this.values = []
    this.internals.setFormValue(null)
  }
  formDisabledCallback(disabled: boolean): void {
    this.disabled = disabled
  }

  #syncForm(): void {
    const v = this.multiple ? this.values.join(',') : this.value
    this.internals.setFormValue(v === '' ? null : v)
  }

  updated(changed: PropertyValues): void {
    this.#syncForm()
    if (changed.has('open')) {
      if (this.open && !this.#menuHost) this.#openMenu()
      else if (!this.open && this.#menuHost) this.#teardown(false)
    } else if (this.#menuHost) {
      this.#renderMenu()
      this.#place()
    }
  }

  // ── filtering ──────────────────────────────────────────────────────────────────────────────────
  private get trimmed(): string {
    return this.query.trim()
  }
  private get filtered(): AuComboboxOption[] {
    const needle = this.trimmed.toLowerCase()
    if (this.remote || !this.filterable || needle === '') return this.options
    return this.options.filter(
      (o) => o.label.toLowerCase().includes(needle) || (o.secondary?.toLowerCase().includes(needle) ?? false),
    )
  }
  private get showCreate(): boolean {
    const needle = this.trimmed.toLowerCase()
    return this.creatable && needle !== '' && !this.options.some((o) => o.label.toLowerCase() === needle)
  }
  // The navigable rows, flattened into one cursor space (create pinned first when present).
  private get navRows(): ({ create: true } | { opt: AuComboboxOption })[] {
    const rows: ({ create: true } | { opt: AuComboboxOption })[] = this.filtered.map((opt) => ({ opt }))
    if (this.showCreate) rows.unshift({ create: true })
    return rows
  }
  #enabled(r: { create: true } | { opt: AuComboboxOption } | undefined): boolean {
    return r != null && ('create' in r || r.opt.disabled !== true)
  }
  private get firstEnabled(): number {
    return this.navRows.findIndex((r) => this.#enabled(r))
  }
  private get lastEnabled(): number {
    const rows = this.navRows
    for (let i = rows.length - 1; i >= 0; i--) if (this.#enabled(rows[i])) return i
    return -1
  }
  #stepCursor(from: number, dir: 1 | -1): number {
    const rows = this.navRows
    let i = from
    for (let c = 0; c < rows.length; c++) {
      i += dir
      if (i < 0 || i >= rows.length) return from
      if (this.#enabled(rows[i])) return i
    }
    return from
  }

  #isSelected(o: AuComboboxOption): boolean {
    return this.multiple ? this.values.includes(o.value) : o.value === this.value
  }

  // ── picking / creating ───────────────────────────────────────────────────────────────────────────
  #pick(opt: AuComboboxOption): void {
    if (opt.disabled) return
    if (this.multiple) {
      this.values = this.values.includes(opt.value)
        ? this.values.filter((v) => v !== opt.value)
        : [...this.values, opt.value]
      this.#emit('au-change', { values: this.values })
      this.#setQuery('')
      this.#focusInput() // stay in the field; the popup stays open across picks
    } else {
      this.value = opt.value
      this.#emit('au-change', { value: this.value })
      this.query = this.mode === 'inline' ? opt.label : ''
      this.#close(true)
    }
  }
  #runCreate(): void {
    const q = this.trimmed
    if (q === '') return
    this.#emit('au-create', { query: q })
    if (this.multiple) {
      this.#setQuery('')
      this.#focusInput()
    } else {
      this.#setQuery(this.mode === 'inline' ? q : '')
      this.#close(true)
    }
  }
  #removeValue(v: string): void {
    if (!this.multiple) return
    this.values = this.values.filter((x) => x !== v)
    this.#emit('au-change', { values: this.values })
  }
  #commitActive(): void {
    const row = this.navRows[this.#activeIndex]
    if (row == null) return
    if ('create' in row) this.#runCreate()
    else this.#pick(row.opt)
  }

  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }
  #setQuery(q: string): void {
    this.query = q
    this.#emit('au-input', { query: q })
  }
  #onQueryInput = (e: Event): void => {
    if (!this.open) this.open = true
    this.#setQuery((e.target as HTMLInputElement).value)
    this.#activeIndex = this.firstEnabled
  }

  #focusInput(): void {
    requestAnimationFrame(() => this.#inputEl()?.focus())
  }
  #inputEl(): HTMLInputElement | null {
    if (this.mode === 'inline') return this.renderRoot.querySelector<HTMLInputElement>('.control-input')
    return this.#menuHost?.querySelector<HTMLInputElement>('.search-input') ?? null
  }

  // ── keyboard (shared by both modes' input) ───────────────────────────────────────────────────────
  #onInputKey = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        this.#pointerNavigation = false
        if (!this.open) this.open = true
        else this.#setActive(this.#stepCursor(this.#activeIndex, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        this.#pointerNavigation = false
        if (!this.open) this.open = true
        else this.#setActive(this.#stepCursor(this.#activeIndex, -1))
        break
      case 'Home':
        if (!this.open) break
        e.preventDefault()
        this.#setActive(this.firstEnabled)
        break
      case 'End':
        if (!this.open) break
        e.preventDefault()
        this.#setActive(this.lastEnabled)
        break
      case 'Enter':
        if (!this.open) break
        e.preventDefault()
        this.#commitActive()
        break
      case 'Escape':
        e.preventDefault()
        if (this.trimmed !== '') this.#setQuery('')
        else this.#close(true)
        break
      case 'Tab':
        if (this.open) this.#close(false)
        break
      case 'Backspace':
        if (this.multiple && this.query === '' && this.values.length > 0) {
          e.preventDefault()
          this.#removeValue(this.values[this.values.length - 1] as string)
        }
        break
    }
  }

  #onTriggerKey = (e: KeyboardEvent): void => {
    if (this.disabled || this.open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.#pointerNavigation = false
      this.open = true
    }
  }
  #onTrigger = (): void => {
    if (this.disabled) return
    this.#pointerNavigation = true
    this.open = !this.open
  }
  #onControl = (): void => {
    if (this.disabled) return
    this.#pointerNavigation = true
    this.open = true
    this.#focusInput()
  }

  #setActive(index: number, pointer = false): void {
    if (index < 0) return
    this.#activeIndex = index
    this.#pointerNavigation = pointer
    this.#renderMenu()
    const vp = this.#menuHost?.querySelector('.viewport')
    vp?.querySelectorAll('.option, .create')[index]?.scrollIntoView({ block: 'nearest' })
  }

  // ── the popup, drawn into the claimed layer ─────────────────────────────────────────
  #renderIcon(icon: string): TemplateResult {
    return GLYPH_NAME.test(icon)
      ? html`<au-icon name=${icon} size="sm"></au-icon>`
      : html`${icon}`
  }
  #highlight(label: string): TemplateResult | string {
    const needle = this.trimmed
    if (needle === '') return label
    const at = label.toLowerCase().indexOf(needle.toLowerCase())
    if (at === -1) return label
    return html`${label.slice(0, at)}<mark>${label.slice(at, at + needle.length)}</mark>${label.slice(
      at + needle.length,
    )}`
  }

  #listBody(): TemplateResult {
    const rows = this.navRows
    if (this.loading && this.filtered.length === 0) {
      return html`${[72, 64, 56, 48].map(
        (w) => html`
          <div class="skeleton-row" aria-hidden="true">
            <span class="opticon"></span>
            <au-skeleton class="skeleton-bar" variant="text" .width=${`${w}%`}></au-skeleton>
            <span class="check"></span>
          </div>
        `,
      )}`
    }
    if (rows.length === 0) {
      const q = this.trimmed
      return html`
        <div class="empty" role="status">
          <div class="empty-title">${q !== '' ? `No matches for “${q}”` : 'No options'}</div>
          ${q !== '' ? html`<div class="empty-hint">Try fewer or different words.</div>` : nothing}
        </div>
      `
    }
    return html`${rows.map((row, i) => {
      const active = i === this.#activeIndex
      if ('create' in row) {
        return html`
          <div
            class="option create"
            id=${`${this.#popupId}-option-${i}`}
            role="option"
            aria-selected="false"
            ?data-active=${active}
            @click=${() => this.#runCreate()}
            @mousemove=${() => this.#setActive(i, true)}
          >
            <span class="opticon" aria-hidden="true"><au-icon name="plus" size="sm"></au-icon></span>
            <span class="body"><span class="label">Add “<span class="create-query">${this.trimmed}</span>”</span></span>
            <span class="check" aria-hidden="true"></span>
          </div>
        `
      }
      const opt = row.opt
      const selected = this.#isSelected(opt)
      return html`
        <div
          class="option"
          id=${`${this.#popupId}-option-${i}`}
          role="option"
          aria-selected=${selected ? 'true' : 'false'}
          aria-disabled=${opt.disabled ? 'true' : nothing}
          ?data-active=${active}
          @click=${() => this.#pick(opt)}
          @mousemove=${() => this.#setActive(i, true)}
        >
          ${opt.icon ? html`<span class="opticon" aria-hidden="true">${this.#renderIcon(opt.icon)}</span>` : nothing}
          <span class="body">
            <span class="label">${this.#highlight(opt.label)}</span>
            ${opt.secondary ? html`<span class="secondary">${opt.secondary}</span>` : nothing}
          </span>
          ${opt.meta ? html`<span class="meta">${opt.meta}</span>` : nothing}
          <span class="check" aria-hidden="true">${selected ? html`<au-icon name="check" size="sm"></au-icon>` : nothing}</span>
        </div>
      `
    })}`
  }

  #popupTemplate(): TemplateResult {
    const dataLoading = this.loading && this.filtered.length > 0
    return html`
      <div class="popup" part="popup" data-navigation=${this.#pointerNavigation ? 'pointer' : 'keyboard'}>
        ${this.mode === 'trigger'
          ? html`
              <div class="search">
                <span class="search-icon" aria-hidden="true">
                  ${this.loading
                    ? html`<au-spinner size="sm"></au-spinner>`
                    : html`<au-icon name="search" size="sm"></au-icon>`}
                </span>
                <input
                  class="search-input"
                  .value=${this.query}
                  placeholder=${this.searchPlaceholder ?? 'Search…'}
                  role="combobox"
                  aria-expanded="true"
                  aria-autocomplete="list"
                  aria-controls=${`${this.#popupId}-options`}
                  aria-activedescendant=${this.#activeIndex >= 0 && !(this.loading && this.filtered.length === 0) && this.navRows[this.#activeIndex] ? `${this.#popupId}-option-${this.#activeIndex}` : nothing}
                  autocomplete="off"
                  spellcheck="false"
                  @input=${this.#onQueryInput}
                  @keydown=${this.#onInputKey}
                />
              </div>
            `
          : nothing}
        <div id=${`${this.#popupId}-options`} class="viewport" role="listbox" tabindex="-1" aria-label=${this.label ?? nothing} aria-multiselectable=${this.multiple ? 'true' : nothing} aria-busy=${this.loading ? 'true' : 'false'} ?data-loading=${dataLoading}>
          ${this.#listBody()}
        </div>
      </div>
    `
  }

  #renderMenu(): void {
    if (this.#menuHost) render(this.#popupTemplate(), this.#menuHost)
    this.#syncPopupRelationships()
    this.searchSemantics.hostUpdated()
    this.listSemantics.hostUpdated()
  }

  #syncPopupRelationships(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>('.control-input')
    const trigger = this.renderRoot.querySelector<HTMLButtonElement>('.trigger')
    const list = this.#menuHost?.querySelector<HTMLElement>('.viewport') ?? null
    const active = this.#menuHost?.querySelector<HTMLElement>('.option[data-active]') ?? null
    if (trigger) trigger.ariaControlsElements = list ? [list] : []
    if (input) {
      input.ariaControlsElements = list ? [list] : []
      input.ariaActiveDescendantElement = active
    }
  }

  #openMenu(): void {
    // seat the cursor: on the chosen value (single, idle) else the first enabled row
    const selIdx =
      !this.multiple && this.value !== '' && this.trimmed === ''
        ? this.navRows.findIndex((r) => 'opt' in r && r.opt.value === this.value && r.opt.disabled !== true)
        : -1
    this.#activeIndex = selIdx >= 0 ? selIdx : this.firstEnabled

    const layer = this.claimOverlay('dropdown')
    if (!layer) {
      this.open = false // no host — degrade to a no-op, never throw
      return
    }
    this.#layer = layer

    const menuHost = document.createElement('div')
    menuHost.style.position = 'fixed'
    menuHost.style.visibility = 'hidden'
    menuHost.style.pointerEvents = 'auto'
    menuHost.dataset.auComboboxPopup = this.#popupId
    layer.el.appendChild(menuHost)
    const root = menuHost.getRootNode() as Document | ShadowRoot
    installBackdropMaterial(root)
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`@scope ([data-au-combobox-popup="${this.#popupId}"]) { ${POPUP_STYLES.cssText.replaceAll(':host', ':scope')} }`)
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
    this.#removePopupStyle = () => {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter(candidate => candidate !== sheet)
    }
    this.#menuHost = menuHost
    this.#renderMenu()

    this.#place()
    requestAnimationFrame(() => {
      this.#place()
      this.#inputEl()?.focus()
    })
    window.addEventListener('resize', this.#place, true)
    window.addEventListener('scroll', this.#place, true)
    document.addEventListener('pointerdown', this.#onDocPointer, true)
  }

  #teardown(refocus: boolean): void {
    window.removeEventListener('resize', this.#place, true)
    window.removeEventListener('scroll', this.#place, true)
    document.removeEventListener('pointerdown', this.#onDocPointer, true)
    const surface = this.#menuHost?.querySelector<HTMLElement>('.popup') ?? null
    const layer = this.#layer
    if (this.#menuHost) {
      this.#menuHost.inert = true
      this.#menuHost.setAttribute('aria-hidden', 'true')
    }
    this.#menuHost = null
    this.#syncPopupRelationships()
    this.#layer = null
    const removeStyle = this.#removePopupStyle
    this.#removePopupStyle = null
    closePicker(surface, () => { removeStyle?.(); layer?.release() })
    if (refocus)
      requestAnimationFrame(() =>
        this.renderRoot.querySelector<HTMLElement>('.trigger, .control-input')?.focus(),
      )
  }
  #close(refocus: boolean): void {
    if (!this.open) return
    this.open = false // updated() runs #teardown
    if (refocus)
      requestAnimationFrame(() =>
        this.renderRoot.querySelector<HTMLElement>('.trigger, .control-input')?.focus(),
      )
  }

  #place = (): void => {
    const menuHost = this.#menuHost
    const anchor = this.renderRoot.querySelector('.trigger, .control')
    if (!menuHost || !anchor) return
    const r = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (!this.isConnected || !anchor.checkVisibility({ checkVisibilityCSS: true }) || r.width <= 0 || r.height <= 0) {
      this.#close(false)
      return
    }
    const availableWidth = Math.max(0, vw - MARGIN * 2)
    menuHost.style.minWidth = `${Math.min(r.width, availableWidth)}px`
    menuHost.style.maxWidth = `${availableWidth}px`
    menuHost.style.removeProperty('--_combobox-available-height')

    const below = Math.max(0, vh - r.bottom - GAP - MARGIN)
    const above = Math.max(0, r.top - GAP - MARGIN)
    const naturalHeight = menuHost.offsetHeight
    const placeBelow = naturalHeight <= below || below >= above
    const availableHeight = placeBelow ? below : above
    const popup = menuHost.querySelector<HTMLElement>('.popup')
    const viewport = menuHost.querySelector<HTMLElement>('.viewport')
    const frameHeight = popup && viewport ? popup.offsetHeight - viewport.offsetHeight : 0
    menuHost.style.setProperty('--_combobox-available-height', `${Math.max(0, availableHeight - frameHeight)}px`)
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
    if (path.includes(this) || (this.#menuHost && path.includes(this.#menuHost))) return
    this.#close(false)
  }

  override disconnectedCallback(): void {
    if (this.#menuHost) this.#teardown(false)
    super.disconnectedCallback()
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      width: 100%;
    }
    /* ── TRIGGER (mode=trigger) — an Input in button clothing, matches au-input's box. ── */
    .trigger {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      width: 100%;
      height: calc(var(--au-space-1, 4px) * 8);
      padding-inline: var(--au-space-3, 12px);
      border: 1px solid var(--au-line-2, #3a3a3a);
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
    .trigger:hover,
    :host([data-force-hover]) .trigger {
      border-color: var(--au-line-3, #4a4a4a);
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
    :host([data-force-disabled]) .trigger {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
      background: var(--au-color-bg, #14161c);
    }
    /* ── CONTROL (mode=inline) — the editable field IS the filter, may hold chips. ── */
    .control {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--au-space-1, 4px);
      width: 100%;
      min-height: calc(var(--au-space-1, 4px) * 8);
      padding-inline: var(--au-space-2, 8px);
      padding-block: var(--au-space-0-5, 2px);
      border: 1px solid var(--au-line-2, #3a3a3a);
      border-radius: var(--au-radius-md,8px);
      background: var(--au-color-surface-1, #1e2128);
      color: var(--au-ink-1, #e2dfda);
      cursor: text;
      transition:
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .control:hover,
    :host([data-force-hover]) .control {
      border-color: var(--au-line-3, #4a4a4a);
    }
    .control:focus-within,
    :host([data-force-focus]) .control {
      ${controlFocusStyle}
      border-color: var(--au-ink-4, #959083);
    }
    :host([open]) .control,
    :host([data-force-open]) .control {
      border-color: var(--au-ink-4, #959083);
    }
    :host([disabled]) .control,
    :host([data-force-disabled]) .control {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
      background: var(--au-color-bg, #14161c);
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
      align-items: center;
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
    /* multi-select chips — committed values, MONOCHROME. */
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      max-width: 100%;
      padding: var(--au-space-0-5, 2px) var(--au-space-1, 4px) var(--au-space-0-5, 2px) var(--au-space-2, 8px);
      border-radius: var(--au-radius-sm,5px);
      background: var(--au-color-surface-2, #2a2a2a);
      color: var(--au-ink-2, #d9d6cd);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    .chip-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chip-remove {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--au-ink-4, #959083);
      cursor: pointer;
      border-radius: var(--au-radius-sm,5px);
    }
    .chip-remove:hover {
      color: var(--au-ink-1, #e2dfda);
    }
    .control-input {
      all: unset;
      flex: 1 1 auto;
      min-width: calc(var(--au-space-1, 4px) * 12);
      height: calc(var(--au-space-1, 4px) * 7);
      box-sizing: border-box;
      padding-inline: var(--au-space-1, 4px);
      color: var(--au-ink-1, #e2dfda);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
    }
    .control-input::placeholder {
      color: var(--au-ink-4, #959083);
    }
    .field-trailing {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--au-space-1, 4px);
      margin-left: auto;
    }
    .clear {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--au-ink-4, #959083);
      cursor: pointer;
    }
    .clear:hover {
      color: var(--au-ink-2, #d9d6cd);
    }
  `

  #triggerTemplate(): TemplateResult {
    const opt = this.multiple ? undefined : this.options.find((o) => o.value === this.value)
    const isPlaceholder = this.multiple ? this.values.length === 0 : opt == null
    const text = this.multiple
      ? this.values.length > 0
        ? `${this.values.length} selected`
        : (this.placeholder ?? '')
      : (opt?.label ?? this.placeholder ?? '')
    return html`
      <button
        class="trigger"
        part="trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-label=${this.label ?? nothing}
        ?disabled=${this.disabled}
        @click=${this.#onTrigger}
        @keydown=${this.#onTriggerKey}
      >
        ${opt?.icon ? html`<span class="icon" part="icon" aria-hidden="true">${this.#renderIcon(opt.icon)}</span>` : nothing}
        <span class="value" part="value" ?data-placeholder=${isPlaceholder}>${text}</span>
        <span class="chevron" part="chevron" aria-hidden="true"><au-icon name="chevron-down" size="xs"></au-icon></span>
      </button>
    `
  }

  #controlTemplate(): TemplateResult {
    return html`
      <div class="control" part="control" @click=${this.#onControl}>
        ${this.multiple
          ? this.values.map((v) => {
              const o = this.options.find((x) => x.value === v)
              const label = o?.label ?? v
              return html`
                <span class="chip">
                  <span class="chip-label">${label}</span>
                  <button
                    class="chip-remove"
                    type="button"
                    aria-label=${`Remove ${label}`}
                    ?disabled=${this.disabled}
                    @click=${(e: Event) => {
                      e.stopPropagation()
                      this.#removeValue(v)
                    }}
                  >
                    <au-icon name="close" size="xs"></au-icon>
                  </button>
                </span>
              `
            })
          : nothing}
        <input
          class="control-input"
          part="input"
          aria-label=${this.label ?? nothing}
          .value=${this.query}
          placeholder=${(this.multiple && this.values.length > 0 ? undefined : this.placeholder) ?? nothing}
          ?disabled=${this.disabled}
          role="combobox"
          aria-expanded=${this.open ? 'true' : 'false'}
          aria-autocomplete="list"
          autocomplete="off"
          spellcheck="false"
          @input=${this.#onQueryInput}
          @keydown=${this.#onInputKey}
        />
        <span class="field-trailing" aria-hidden=${this.query ? nothing : 'true'}>
          ${this.query
            ? html`<button
                class="clear"
                type="button"
                aria-label="Clear"
                @click=${(e: Event) => {
                  e.stopPropagation()
                  this.#setQuery('')
                  this.#focusInput()
                }}
              >
                <au-icon name="close" size="sm"></au-icon>
              </button>`
            : nothing}
          <span class="chevron" part="chevron" aria-hidden="true">
            ${this.loading ? html`<au-spinner size="sm"></au-spinner>` : html`<au-icon name="chevron-down" size="xs"></au-icon>`}
          </span>
        </span>
      </div>
    `
  }

  render() {
    return this.mode === 'inline' ? this.#controlTemplate() : this.#triggerTemplate()
  }
}
