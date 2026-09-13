// <au-tabs> / <au-tab> / <au-tab-panel> — the in-content tablist + tabpanels compound. DISTINCT from au-tab-bar (the pane/editor chrome
// strip) and au-segmented-control (the bounded toggle).
//
// Two variants: `line` — a full-width hairline BASELINE seam with ONE 2px ink underline that SLIDES to
// the active tab (never a leading rail); `pill` — a naked left-aligned row whose active tab lifts to
// surface-3 + a hairline ring (no tray border). `orientation` vertical = a rail whose active tab is a
// surface fill + weight (NavItem posture, never a bar). Monochrome — a trailing StatusDot is the only
// hue a tab may carry.
//
// A slotted COMPOUND coordinated by a Lit CONTROLLER (no framework context), the au-accordion pattern:
// au-tabs owns selection + roving focus + the sliding indicator + panel visibility + aria; au-tab and
// au-tab-panel self-assign their slot and take active/variant/orientation from the parent. TOKEN-ONLY,
// base `--au-*` with literal floors.

import { reducedControlMotion } from './control-motion'
import { css, html } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'

type Variant = 'line' | 'pill'
type Orientation = 'horizontal' | 'vertical'

// ── a single tab ──────────────────────────────────────────────────────────────────────────────────
export class AuTabElement extends AuElement {
  static properties = {
    value: { type: String },
    disabled: { type: Boolean, reflect: true },
    active: { type: Boolean, reflect: true },
    variant: { type: String, reflect: true },
    orientation: { type: String, reflect: true },
  }

  declare value?: string
  declare disabled: boolean
  declare active: boolean
  declare variant: Variant
  declare orientation: Orientation

  constructor() {
    super()
    this.disabled = false
    this.active = false
    this.variant = 'line'
    this.orientation = 'horizontal'
  }

  // Self-assign the named slot HERE, not in the constructor: a custom element constructor must not gain
  // attributes (the spec throws NotSupportedError on document.createElement, React's path), so setting
  // `this.slot` at construction leaves the element inert.
  connectedCallback(): void {
    super.connectedCallback()
    if (!this.slot) this.slot = 'tab'
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      cursor: pointer;
      white-space: nowrap;
      color: var(--au-ink-3, #a0a8bc);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      letter-spacing: var(--au-ls-snug,-0.02em);
      font-weight: var(--au-w-body, 400);
      outline: none;
      transition:
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .label {
      display: inline-flex;
    }
    ::slotted([slot='icon']),
    ::slotted([slot='status']),
    ::slotted([slot='badge']) {
      flex: 0 0 auto;
    }
    /* line: rest → hover → active (weight; the sliding underline in the parent is the live marker). */
    :host([variant='line'][orientation='horizontal']) {
      padding-block: var(--au-space-2, 8px);
    }
    :host([variant='line'][orientation='horizontal']:hover),
    :host([variant='line'][data-force-hover]) {
      color: var(--au-ink-1, #ededed);
    }
    :host([variant='line'][orientation='horizontal'][active]),
    :host([variant='line'][data-force-active]) {
      color: var(--au-ink-1, #ededed);
      font-weight: var(--au-w-medium, 500);
    }
    /* forced-active carries a STATIC 2px baseline underline (the gallery freeze); the live active tab
       is marked by the parent's sliding indicator. */
    :host([variant='line'][data-force-active]) {
      box-shadow: inset 0 calc(var(--au-space-0-5, 2px) * -1) 0 0 var(--au-ink-1, #ededed);
    }
    /* pill: surface-3 fill + hairline ring when active. */
    :host([variant='pill']) {
      height: calc(var(--au-space-1, 4px) * 7);
      padding-inline: var(--au-space-3, 12px);
      border-radius: var(--au-radius-chip, 6px);
      color: var(--au-ink-4, #8b93a6);
      font-weight: var(--au-w-medium, 500);
    }
    :host([variant='pill']:hover),
    :host([variant='pill'][data-force-hover]) {
      color: var(--au-ink-2, #c8c8c8);
    }
    :host([variant='pill'][active]),
    :host([variant='pill'][data-force-active]) {
      background: var(--au-color-surface-3, #262b36);
      color: var(--au-ink-1, #ededed);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
    }
    /* vertical: left-aligned row; active = surface fill + weight (never a leading bar). */
    :host([orientation='vertical']) {
      justify-content: flex-start;
      height: var(--au-row-h,32px);
      padding-inline: var(--au-space-2, 8px);
      border-radius: var(--au-radius-chip, 6px);
    }
    :host([orientation='vertical'][active]),
    :host([orientation='vertical'][data-force-active]) {
      background: var(--au-color-surface-3, #262b36);
      color: var(--au-ink-1, #ededed);
      font-weight: var(--au-w-medium, 500);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
    }
    :host(:focus-visible),
    :host([data-force-focus]) {
      ${controlFocusStyle}
      border-radius: var(--au-radius-chip, 6px);
    }
    :host([disabled]),
    :host([data-force-disabled]) {
      color: var(--au-ink-5, #4a505e);
      pointer-events: none;
    }
  `

  render() {
    return html`
      <slot name="icon"></slot>
      <span class="label" part="label"><slot></slot></span>
      <slot name="badge"></slot>
      <slot name="status"></slot>
    `
  }
}

// ── a panel ───────────────────────────────────────────────────────────────────────────────────────
export class AuTabPanelElement extends AuElement {
  static properties = {
    value: { type: String },
    active: { type: Boolean, reflect: true },
  }

  declare value?: string
  declare active: boolean

  constructor() {
    super()
    this.active = false
  }

  // Self-assign the slot in connectedCallback, never the constructor (a constructor must not gain an
  // attribute — createElement throws NotSupportedError otherwise, leaving the panel inert).
  connectedCallback(): void {
    super.connectedCallback()
    if (!this.slot) this.slot = 'panel'
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      outline: none;
      min-width: 0;
    }
    :host(:not([active])) {
      display: none;
    }
    /* the incoming panel crossfades in with a barely-there lift. */
    @keyframes au-tabs-panel-in {
      from {
        opacity: 0;
        transform: translateY(calc(var(--au-space-0-5, 2px) * -1));
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    :host([active]) {
      animation: au-tabs-panel-in var(--au-m-fast,160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) both;
    }
  `

  render() {
    return html`<slot></slot>`
  }
}

// ── the root controller ─────────────────────────────────────────────────────────────────────────────
export class AuTabsElement extends AuElement {
  static properties = {
    variant: { type: String, reflect: true },
    orientation: { type: String, reflect: true },
    activationMode: { type: String, attribute: 'activation-mode' },
    mount: { type: String },
    overflow: { type: String },
    value: { type: String },
    label: { type: String },
  }

  declare variant: Variant
  declare orientation: Orientation
  declare activationMode: 'automatic' | 'manual'
  declare mount: 'active' | 'keep'
  declare overflow: 'none' | 'scroll' | 'menu' | 'both'
  declare value?: string
  declare label?: string

  private primed = false

  constructor() {
    super()
    this.variant = 'line'
    this.orientation = 'horizontal'
    this.activationMode = 'automatic'
    this.mount = 'active'
    this.overflow = 'none'
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--au-space-4, 16px);
      min-width: 0;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    :host([orientation='vertical']) {
      flex-direction: row;
      align-items: stretch;
      gap: var(--au-space-5, 20px);
    }
    .listwrap {
      display: flex;
      align-items: stretch;
      min-width: 0;
    }
    :host([orientation='vertical']) .listwrap {
      flex: 0 0 auto;
    }
    :host([orientation='vertical']) .panels {
      flex: 1 1 auto;
    }
    .scroll {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      align-items: stretch;
    }
    .tablist {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      align-items: stretch;
    }
    :host([variant='line'][orientation='horizontal']) .tablist {
      gap: var(--au-space-5, 20px);
      padding-bottom: var(--au-space-0-5, 2px);
      box-shadow: inset 0 -1px 0 0 var(--au-line-1, rgba(255, 255, 255, 0.06));
    }
    :host([variant='pill']) .tablist {
      gap: var(--au-space-1, 4px);
    }
    :host([orientation='vertical']) .tablist {
      flex-direction: column;
      align-items: stretch;
      min-width: calc(var(--au-space-8, 40px) * 3);
      gap: var(--au-space-0-5, 2px);
      padding-bottom: 0;
      box-shadow: none;
    }
    /* scrollable track — scrolls bare (sliver hidden). */
    .tablist[data-scrollable] {
      overflow-x: auto;
      scroll-behavior: smooth;
      scrollbar-width: none;
    }
    .tablist[data-scrollable]::-webkit-scrollbar {
      width: 0;
      height: 0;
      display: none;
    }
    ::slotted(au-tab) {
      flex: 0 0 auto;
    }
    /* the sliding indicator — one element, line + horizontal only. */
    .indicator {
      position: absolute;
      left: 0;
      bottom: 0;
      height: var(--au-space-0-5, 2px);
      background: var(--au-ink-1, #ededed);
      border-radius: var(--au-radius-pill,99px);
      pointer-events: none;
      opacity: 0;
    }
    .indicator[data-on] {
      opacity: 1;
    }
    .indicator[data-primed] {
      transition:
        transform var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        width var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    /* edge scrims — neutral canvas fade, never a colored bar. */
    .scrim {
      position: absolute;
      top: 0;
      bottom: 0;
      width: var(--au-space-5, 20px);
      pointer-events: none;
      opacity: 0;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .scrim.start {
      left: 0;
      background: linear-gradient(to right, var(--au-color-bg, #16181d), transparent);
    }
    .scrim.end {
      right: 0;
      background: linear-gradient(to left, var(--au-color-bg, #16181d), transparent);
    }
    .scrim[data-on] {
      opacity: 1;
    }
    .panels {
      min-width: 0;
    }
  `

  private get tabs(): AuTabElement[] {
    const slot = this.renderRoot?.querySelector<HTMLSlotElement>('slot[name="tab"]')
    return (slot?.assignedElements({ flatten: true }) ?? []).filter(
      (el): el is AuTabElement => el.tagName.toLowerCase() === 'au-tab',
    )
  }

  private get panels(): AuTabPanelElement[] {
    const slot = this.renderRoot?.querySelector<HTMLSlotElement>('slot[name="panel"]')
    return (slot?.assignedElements({ flatten: true }) ?? []).filter(
      (el): el is AuTabPanelElement => el.tagName.toLowerCase() === 'au-tab-panel',
    )
  }

  private get tablistEl(): HTMLElement | null {
    return this.renderRoot?.querySelector<HTMLElement>('.tablist') ?? null
  }

  private select(next: string, focus = false): void {
    if (this.value === next) return
    this.value = next
    this.dispatchEvent(
      new CustomEvent('au-tab-change', { detail: { value: next }, bubbles: true, composed: true }),
    )
    this.sync()
    if (focus) this.tabs.find((t) => t.value === next)?.focus()
  }

  private onTabClick = (e: Event): void => {
    const tab = (e.target as HTMLElement).closest('au-tab') as AuTabElement | null
    if (tab && !tab.disabled && tab.value != null) this.select(tab.value, true)
  }

  private onKeydown = (e: KeyboardEvent): void => {
    const horizontal = this.orientation === 'horizontal'
    const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown'
    const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp'
    const tabs = this.tabs.filter((t) => !t.disabled)
    if (tabs.length === 0) return
    const values = tabs.map((t) => t.value ?? '')
    const current = this.value
    let index = current != null ? values.indexOf(current) : -1
    if (index < 0) index = 0
    let target = -1
    if (e.key === nextKey) target = (index + 1) % values.length
    else if (e.key === prevKey) target = (index - 1 + values.length) % values.length
    else if (e.key === 'Home') target = 0
    else if (e.key === 'End') target = values.length - 1
    else if ((e.key === 'Enter' || e.key === ' ') && this.activationMode === 'manual') {
      e.preventDefault()
      const focused = this.tabs.find((t) => t.matches(':focus'))
      if (focused?.value != null) this.select(focused.value, true)
      return
    } else return
    e.preventDefault()
    const targetValue = values[target]
    if (this.activationMode === 'automatic') this.select(targetValue, true)
    else tabs[target]?.focus()
  }

  private updateScrims(): void {
    const el = this.tablistEl
    const scrimS = this.renderRoot?.querySelector<HTMLElement>('.scrim.start')
    const scrimE = this.renderRoot?.querySelector<HTMLElement>('.scrim.end')
    if (!el || !scrimS || !scrimE) return
    const scrollable = this.overflow === 'scroll' || this.overflow === 'both'
    if (!scrollable) {
      scrimS.removeAttribute('data-on')
      scrimE.removeAttribute('data-on')
      return
    }
    const max = el.scrollWidth - el.clientWidth
    scrimS.toggleAttribute('data-on', el.scrollLeft > 1)
    scrimE.toggleAttribute('data-on', el.scrollLeft < max - 1)
  }

  private moveIndicator(): void {
    const indicator = this.renderRoot?.querySelector<HTMLElement>('.indicator')
    const list = this.tablistEl
    if (!indicator || !list) return
    const showLine = this.variant === 'line' && this.orientation === 'horizontal'
    const active = this.tabs.find((t) => t.value === this.value && !t.disabled)
    if (!showLine || !active) {
      indicator.removeAttribute('data-on')
      return
    }
    // Measure the active tab relative to the .tablist, NOT via offsetLeft: the tabs are SLOTTED
    // (light-DOM), so their offsetParent is the host, not the shadow .tablist the indicator lives in —
    // offsetLeft would be in the wrong coordinate space (the underline lands off to the side). The rect
    // delta plus scrollLeft maps the tab into the tablist's own (scrollable) content coordinates.
    const listRect = list.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    const x = activeRect.left - listRect.left + list.scrollLeft
    indicator.style.transform = `translateX(${x}px)`
    indicator.style.width = `${activeRect.width}px`
    indicator.toggleAttribute('data-on', true)
    if (!this.primed) {
      requestAnimationFrame(() => {
        indicator.toggleAttribute('data-primed', true)
        this.primed = true
      })
    }
  }

  // The controller pass: propagate variant/orientation, mark active tab + panel, roving tabindex, aria.
  private sync = (): void => {
    const tabs = this.tabs
    if (tabs.length === 0) return
    // default the selection to the first enabled tab.
    if (this.value == null) {
      const first = tabs.find((t) => !t.disabled) ?? tabs[0]
      this.value = first?.value
    }
    const scrollable = this.overflow === 'scroll' || this.overflow === 'both'
    this.tablistEl?.toggleAttribute('data-scrollable', scrollable)
    for (const t of tabs) {
      t.variant = this.variant
      t.orientation = this.orientation
      const on = t.value === this.value && !t.disabled
      t.active = on
      t.setAttribute('role', 'tab')
      t.setAttribute('aria-selected', on ? 'true' : 'false')
      t.tabIndex = t.disabled ? -1 : on ? 0 : -1
    }
    for (const p of this.panels) {
      p.active = p.value === this.value
      p.setAttribute('role', 'tabpanel')
      p.tabIndex = 0
    }
    requestAnimationFrame(() => {
      this.moveIndicator()
      this.updateScrims()
    })
  }

  private onScroll = (): void => this.updateScrims()

  render() {
    return html`
      <div class="listwrap" part="listwrap">
        <div class="scroll">
          <div
            class="tablist"
            part="tablist"
            role="tablist"
            aria-label=${this.label ?? ''}
            aria-orientation=${this.orientation}
            @keydown=${this.onKeydown}
            @click=${this.onTabClick}
            @scroll=${this.onScroll}
          >
            <slot name="tab" @slotchange=${this.sync}></slot>
            <span class="indicator" part="indicator" aria-hidden="true"></span>
          </div>
          <span class="scrim start" aria-hidden="true"></span>
          <span class="scrim end" aria-hidden="true"></span>
        </div>
      </div>
      <div class="panels" part="panels"><slot name="panel" @slotchange=${this.sync}></slot></div>
    `
  }

  updated(): void {
    this.sync()
  }
}
