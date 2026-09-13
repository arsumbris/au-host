import { installBackdropMaterial } from './surface-material'
// <au-color-picker> — the default set's Lit SHADOW implementation of the `au-color-picker` contract,
// and an OVERLAY component (it claims a `host.overlay` layer for its popover panel).
//
// A Swatch trigger opens a popover holding a hex quick-entry over OKLCH Lightness / Chroma / Hue
// sliders and an optional Alpha slider. OKLCH is the edit space on purpose: L/C/H move independently
// and read evenly, where HSL's lightness lies. The colour math is `oklch.ts` (pure, zero-dep).
//
// THE OVERLAY SEAM: the panel must escape any pane clip, so it is drawn into a layer
// CLAIMED from `host.overlay` (the `popover` band) via the `ClaimOverlay` mixin — NEVER a
// `document.body` portal. The panel lives in its OWN shadow root inside the layer, token-only and
// isolated; tokens pierce the boundary from the document root. Standalone (no host) → the trigger is
// a no-op, render-resilient.
//
// Contract: `value` (an `oklch()` or hex string), `alpha` / `size` attributes. Emits `au-change`
// (detail `{ value }`, an `oklch()` string, composed + bubbling) on every edit. TOKEN-ONLY.

import { css, html, nothing, render } from 'lit'
import { AuElement } from './au-element'
import { floatingSurfaceMaterial } from './surface-material'
import { ClaimOverlay } from './claim-overlay'
import { controlFocusStyle } from './focus-style'
import { pickerMotion, pickerExitMotion, pickerKeyframes, closePicker } from './picker-motion'
import { hexToOklch, oklchToHex, oklchToString, parseOklch, rgbToOklch, type Oklch } from './oklch'

const round = (n: number, p = 0): number => {
  const f = 10 ** p
  return Math.round(n * f) / f
}
const GAP = 4
const MARGIN = 8

const PANEL_STYLES = css`
  ${pickerKeyframes}
  .panel[data-state="closed"] { ${pickerExitMotion} }
  :host {
    display: block;
  }
  .panel {
    ${pickerMotion}
    transform-origin: top left;
    display: flex;
    flex-direction: column;
    gap: var(--au-space-2, 8px);
    box-sizing: border-box;
    width: calc(var(--au-space-1, 4px) * 70);
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: var(--au-space-3, 12px);
    ${floatingSurfaceMaterial}
    border-radius: var(--au-radius-panel,12px);
    box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14)),
      var(--au-sh-glass,0 0 0 1px rgba(245, 243, 238, 0.06), inset 0 1px 0 rgba(245, 243, 238, 0.04), 0 24px 64px -16px rgba(0, 0, 0, 0.6));
    color: var(--au-ink-1, #e2dfda);
    font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  }
  .hexrow {
    display: flex;
    align-items: center;
    gap: var(--au-space-2, 8px);
  }
  .hex {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: calc(var(--au-space-1, 4px) * 7);
    padding-inline: var(--au-space-2, 8px);
    border: 1px solid var(--au-line-2, #3a3a3a);
    border-radius: var(--au-radius-md,8px);
    background: var(--au-color-surface-1, #1e2128);
    color: var(--au-ink-1, #e2dfda);
    font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
    font-size: var(--au-t-xs, 12px);
    letter-spacing: var(--au-ls-mono,-0.005em);
  }
  .hex:focus-visible {
    ${controlFocusStyle}
  }
  .axis {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--au-space-2, 8px);
  }
  .axname {
    font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
    font-size: var(--au-t-2xs,11px);
    color: var(--au-ink-4, #959083);
    letter-spacing: var(--au-ls-mono,-0.005em);
  }
  .axis-value { width: calc(var(--au-space-1, 4px) * 22); min-width: 0; }
  au-slider { width: 100%; min-width: 0; grid-column: 1 / -1; grid-row: 2; }
  .hex-help { font-size: var(--au-t-xs); color: var(--au-ink-3); margin: 0; }
  .hex[aria-invalid="true"] { border-color: var(--au-color-danger); }
`

/** Size the shared swatch without duplicating its paint, transparency or edge treatment. */
const SWATCH_CSS = css`
  .swatch {
    display: inline-flex;
    flex: 0 0 auto;
  }
  .swatch::part(chip) {
    inline-size: var(--sw, 20px);
    block-size: var(--sw, 20px);
  }
`

export class AuColorPickerElement extends ClaimOverlay(AuElement) {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('.trigger')?.focus(options)
  }

  static properties = {
    value: { type: String },
    alpha: { type: Boolean, reflect: true },
    size: { type: String, reflect: true },
    label: { type: String },
    open: { type: Boolean, reflect: true },
  }

  declare value: string
  declare alpha: boolean
  declare size: 'sm' | 'md' | 'lg'
  declare label?: string
  declare open: boolean

  #panelHost: HTMLDivElement | null = null
  #panelRoot: ShadowRoot | null = null
  #releasePanel: (() => void) | null = null
  #hexDraft = ''
  #hexInvalid = false
  #hexEdited = false
  #emitted: string | null = null

  constructor() {
    super()
    this.value = ''
    this.alpha = true
    this.size = 'md'
    this.open = false
  }

  get #oklch(): Oklch | null {
    return parseOklch(this.value) ?? hexToOklch(this.value) ?? rgbToOklch(this.value)
  }

  #onChange(v: string): void {
    this.#emitted = v
    this.value = v // optimistic self-update so it works standalone AND controlled
    this.dispatchEvent(new CustomEvent('au-change', { detail: { value: v }, bubbles: true, composed: true }))
  }

  // Slider edits recompose the colour through OKLCH, preserving the other two axes + alpha, and emit
  // an `oklch()` string so the token keeps its wide-gamut notation.
  #emitAxis(next: Partial<Oklch>): void {
    const ok = this.#oklch
    const a = ok?.a ?? 1
    const base: Oklch = ok ?? { l: 0.5, c: 0, h: 0, a }
    this.#axisColor({ ...base, a, ...next })
  }
  #setAlpha(pct: number): void {
    const base: Oklch = this.#oklch ?? { l: 0.5, c: 0, h: 0 }
    this.#axisColor({ ...base, a: pct / 100 })
  }

  #onHexInput(text: string): void {
    this.#hexDraft = text
    this.#hexEdited = true
    this.#hexInvalid = false
    // COMPLETE hexes only — a per-keystroke expand would commit partial colours under the caret.
    if (!/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(text.trim())) {
      this.#renderPanel()
      return
    }
    const fromHex = hexToOklch(text)
    if (!fromHex) {
      this.#renderPanel()
      return
    }
    this.#onChange(oklchToString(fromHex))
  }

  #commitHex(): void {
    if (!this.#hexEdited) return
    const color = hexToOklch(this.#hexDraft)
    this.#hexInvalid = color === null
    if (color) {
      const value = oklchToString(color)
      if (value !== this.value) this.#onChange(value)
    }
    this.#renderPanel()
  }

  #swatch(cls: string): unknown {
    return html`<au-swatch
      class=${cls}
      .value=${this.value}
      aria-hidden="true"
    ></au-swatch>`
  }

  #panelTemplate(): unknown {
    const ok = this.#oklch
    const a = ok?.a ?? 1
    const l = ok ? round(ok.l * 100) : 50
    const c = ok ? round(ok.c, 3) : 0
    const h = ok ? round(ok.h) : 0
    return html`
      <div class="panel" role="dialog" aria-label=${this.label ? `${this.label} picker` : 'Colour picker'}>
        <div class="hexrow">
          <au-swatch
            class="swatch"
            .value=${this.value}
            style="--sw: calc(var(--au-space-1, 4px) * 8)"
            aria-hidden="true"
          ></au-swatch>
          <input
            class="hex"
            .value=${this.#hexDraft}
            spellcheck="false"
            autocomplete="off"
            aria-invalid=${this.#hexInvalid}
            aria-describedby="hex-help"
            @blur=${() => this.#commitHex()}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.#commitHex() } }}
            aria-label=${this.label ? `${this.label} hex` : 'Hex value'}
            @input=${(e: Event) => this.#onHexInput((e.target as HTMLInputElement).value)}
          />
        </div>
        <p id="hex-help" class="hex-help">${this.#hexInvalid ? 'Enter a valid hex color, such as #5b8def.' : 'Hex color · optional alpha channel'}</p>
        ${ok ? html`${this.#axis('Lightness', l, 100, 1, value => this.#emitAxis({ l: value / 100 }), '%')}
        ${this.#axis('Chroma', c, 0.37, 0.005, value => this.#emitAxis({ c: value }))}
        ${this.#axis('Hue', h, 360, 1, value => this.#emitAxis({ h: value }), '°')}
        ${this.alpha ? this.#axis('Opacity', round(a * 100), 100, 1, value => this.#setAlpha(value), '%') : nothing}` : html`
          <p class="hex-help" role="status">${this.value.trim()
            ? 'This value cannot be edited as a color yet. Enter a hex color to replace it.'
            : 'Enter a hex color to start adjusting its lightness, chroma and hue.'}</p>`}
      </div>
    `
  }

  #axis(label: string, value: number, max: number, step: number, change: (value: number) => void, unit = ''): unknown {
    return html`<div class="axis">
      <span class="axname">${label}${unit ? ` (${unit})` : ''}</span>
      <au-number-input class="axis-value" size="sm" aria-label=${`${label} value`}
        min="0" .max=${max} .step=${step} .value=${value}
        @au-input=${(e: Event) => e.stopPropagation()}
        @au-change=${(e: CustomEvent<{value: number | null}>) => {
          e.stopPropagation()
          if (e.detail.value !== null && Number.isFinite(e.detail.value) && e.detail.value !== value) change(e.detail.value)
        }}></au-number-input>
      <au-slider label=${label} min="0" .max=${max} .step=${step} .value=${value}
        style=${`--au-slider-track-paint: ${this.#trackPaint(label)}; --au-slider-progress-paint: transparent`}
        @au-input=${(e: CustomEvent<{value: number}>) => { e.stopPropagation(); change(e.detail.value) }}
        @au-change=${(e: Event) => e.stopPropagation()}></au-slider>
    </div>`
  }

  #trackPaint(axis: string): string {
    const color = this.#oklch
    if (!color) return 'none'
    const stops = Array.from({ length: 25 }, (_, index) => {
      const fraction = index / 24
      const sample = { ...color, a: 1 }
      if (axis === 'Lightness') sample.l = fraction
      else if (axis === 'Chroma') sample.c = fraction * 0.37
      else if (axis === 'Hue') sample.h = fraction * 360
      else sample.a = fraction
      return `${oklchToHex(sample)} ${fraction * 100}%`
    })
    const gradient = `linear-gradient(90deg, ${stops.join(', ')})`
    if (axis !== 'Opacity') return gradient
    return `${gradient}, repeating-conic-gradient(var(--au-color-surface-3) 0% 25%, var(--au-color-surface-1) 0% 50%) 0 0 / var(--au-space-2) var(--au-space-2)`
  }

  #axisColor(color: Oklch): void {
    this.#hexDraft = oklchToHex(color)
    this.#hexEdited = false
    this.#hexInvalid = false
    this.#onChange(oklchToString(color))
  }

  #renderPanel(): void {
    if (this.#panelRoot) render(this.#panelTemplate(), this.#panelRoot)
  }

  #openPanel(): void {
    const layer = this.claimOverlay('popover')
    if (!layer) return // no host present — degrade to a no-op, never throw
    this.#hexDraft = this.#oklch ? oklchToHex(this.#oklch) : ''
    this.#hexEdited = false
    this.#hexInvalid = false

    const panelHost = document.createElement('div')
    panelHost.style.position = 'fixed'
    panelHost.style.visibility = 'hidden'
    panelHost.style.pointerEvents = 'auto'
    this.#panelRoot = panelHost.attachShadow({ mode: 'open' })
    installBackdropMaterial(this.#panelRoot)
    this.#panelRoot.adoptedStyleSheets = [PANEL_STYLES.styleSheet as CSSStyleSheet, SWATCH_CSS.styleSheet as CSSStyleSheet]
    this.#renderPanel()
    layer.el.appendChild(panelHost)
    this.#panelHost = panelHost
    this.#releasePanel = () => layer.release()

    this.open = true
    this.#place()
    requestAnimationFrame(() => {
      if (!this.open || this.#panelHost !== panelHost) return
      this.#place()
      this.#panelRoot?.querySelector<HTMLInputElement>('.hex')?.focus({ preventScroll: true })
    })
    window.addEventListener('resize', this.#place, true)
    window.addEventListener('scroll', this.#place, true)
    document.addEventListener('pointerdown', this.#onOutside, true)
    document.addEventListener('focusin', this.#onOutside, true)
    document.addEventListener('keydown', this.#onKey, true)
  }

  #close(restoreFocus = false): void {
    if (!this.open) return
    this.open = false
    window.removeEventListener('resize', this.#place, true)
    window.removeEventListener('scroll', this.#place, true)
    document.removeEventListener('pointerdown', this.#onOutside, true)
    document.removeEventListener('focusin', this.#onOutside, true)
    document.removeEventListener('keydown', this.#onKey, true)
    const surface = this.#panelRoot?.querySelector<HTMLElement>('.panel') ?? null
    const release = this.#releasePanel
    if (this.#panelHost) {
      this.#panelHost.inert = true
      this.#panelHost.setAttribute('aria-hidden', 'true')
    }
    this.#panelHost = null
    this.#panelRoot = null
    this.#releasePanel = null
    closePicker(surface, () => release?.())
    if (restoreFocus && this.isConnected) this.focus({ preventScroll: true })
  }

  #place = (): void => {
    const panelHost = this.#panelHost
    const trigger = this.renderRoot.querySelector('.trigger')
    if (!panelHost || !trigger) return
    const r = trigger.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const panelW = panelHost.offsetWidth
    let left = r.left
    if (left + panelW > vw - MARGIN) left = vw - MARGIN - panelW
    if (left < MARGIN) left = MARGIN
    const below = vh - r.bottom - GAP - MARGIN
    const above = r.top - GAP - MARGIN
    const panelH = panelHost.offsetHeight
    let top: number
    if (panelH <= below || below >= above) top = r.bottom + GAP
    else top = Math.max(MARGIN, r.top - GAP - Math.min(panelH, above))
    top = Math.max(MARGIN, Math.min(top, vh - panelH - MARGIN))
    panelHost.style.top = `${top}px`
    panelHost.style.left = `${left}px`
    panelHost.style.visibility = 'visible'
  }

  #onOutside = (e: Event): void => {
    const path = e.composedPath()
    if (path.includes(this) || (this.#panelHost && path.includes(this.#panelHost))) return
    this.#close()
  }
  #onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    const path = e.composedPath()
    if (!path.includes(this) && !(this.#panelHost && path.includes(this.#panelHost))) return
    e.preventDefault()
    e.stopPropagation()
    this.#close(true)
  }

  override disconnectedCallback(): void {
    this.#close()
    super.disconnectedCallback()
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('value') && this.open) {
      // An OUTSIDE change re-seeds the hex draft; our own echo leaves the field under the caret alone.
      if (this.value !== this.#emitted) {
        this.#hexDraft = this.#oklch ? oklchToHex(this.#oklch) : ''
        this.#hexEdited = false
        this.#hexInvalid = false
      }
      this.#renderPanel()
    }
    if (changed.has('alpha') && this.open) {
      this.#renderPanel()
      this.#place()
    }
  }

  static styles = [
    SWATCH_CSS,
    css`
      :host {
        position: relative;
        display: inline-flex;
      }
      :host([size='sm']) .swatch {
        --sw: calc(var(--au-space-1, 4px) * 4);
      }
      :host([size='md']) .swatch {
        --sw: calc(var(--au-space-1, 4px) * 5);
      }
      :host([size='lg']) .swatch {
        --sw: calc(var(--au-space-1, 4px) * 7);
      }
      .trigger {
        display: inline-flex;
        align-items: center;
        padding: 0;
        margin: 0;
        border: none;
        background: none;
        cursor: pointer;
        border-radius: var(--au-radius-chip, 6px);
      }
      .trigger:focus-visible {
        ${controlFocusStyle}
      }
    `,
  ]

  render() {
    return html`
      <button
        class="trigger"
        part="trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-label=${this.label ?? nothing}
        @click=${() => (this.open ? this.#close(true) : this.#openPanel())}
      >
        ${this.#swatch('swatch')}
      </button>
    `
  }
}
