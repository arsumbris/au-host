// <au-pane-frame> — the default set's Lit SHADOW implementation of the `au-pane-frame` contract.
//
// The pane "card": the bordered, rounded, elevated slab a projection mounts inside. An optional sticky
// label bar (leading · title · meta, or a full `label` slot that replaces them) and the scroll body
// live INSIDE the card so its rounded corners clip both. `focused` lifts the ring, `error`
// paints a danger ring, `preview` italicises the title only (ephemerality is a property of the CONTENT,
// never a different KIND of card), `flush` drops the body padding.
//
// The label bar renders only when some label slot is filled (mirrors the React `hasLabel`), detected
// via slotchange so an empty pane shows no empty bar.
//
// TOKEN-ONLY.

import { css, html, type PropertyValues } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { showTooltip, type TooltipHandle } from './au-tooltip'
export class AuPaneFrameElement extends AuElement {
  static properties = {
    focused: { type: Boolean, reflect: true },
    error: { type: Boolean, reflect: true },
    preview: { type: Boolean, reflect: true },
    flush: { type: Boolean, reflect: true },
    nested: { type: Boolean, reflect: true },
    engaged: { type: Boolean, reflect: true },
    _reveal: { type: Boolean, attribute: 'data-nesting-pinned', reflect: true },
    _gutterHover: { type: Boolean, attribute: 'data-gutter-target', reflect: true },
    _engagedReveal: { state: true },
    _allExpanded: { type: Boolean, attribute: 'data-nesting-all', reflect: true },
    _hasLabel: { state: true },
    _hasLeading: { state: true },
  }

  declare focused: boolean
  declare error: boolean
  declare preview: boolean
  declare flush: boolean
  declare nested: boolean
  declare engaged: boolean
  declare _reveal: boolean
  declare _gutterHover: boolean
  declare _engagedReveal: boolean
  declare _allExpanded: boolean
  private nestingObserver?: MutationObserver
  private gutterTip: TooltipHandle | null = null
  private gutterTipTimer?: ReturnType<typeof setTimeout>
  declare _hasLabel: boolean
  declare _hasLeading: boolean

  constructor() {
    super()
    this.focused = false
    this.error = false
    this.preview = false
    this.flush = false
    this.nested = false
    this.engaged = false
    this._reveal = false
    this._gutterHover = false
    this._engagedReveal = false
    this._allExpanded = false
    this._hasLabel = false
    this._hasLeading = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      position: relative;
      isolation: isolate;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 0;
      border-radius: var(--au-radius-panel, 12px);
      /* Content panes keep a stable reading ground; floating material owns alpha and blur. */
      --au-surface-fill: var(--au-elev-3-fill, #15130f);
      background: var(--au-surface-fill);
      background-image: var(--au-pane-background-image, none);
      --_pane-outline: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      overflow: hidden;

    }
    /* Opaque child surfaces must never erase the frame's focus/error outline. */
    :host::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: var(--_pane-outline);
      pointer-events: none;
      z-index: var(--au-z-raised, 10);
      transition: box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    /* A masked inset rim follows the same rounded geometry without painting over content. */
    :host::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      padding: 1px;
      background-image: var(--au-pane-edge-image, none);
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask-composite: exclude;
      pointer-events: none;
      z-index: 1;
    }
    @media (prefers-reduced-transparency: reduce), (forced-colors: active) {
      :host { background-image: none; }
      :host::before { display: none; }
    }
    :host([data-gutter-target]) {
      --_pane-outline: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055)),
        inset 0 0 0 1px var(--au-line-2, rgba(255, 255, 255, 0.14));
    }
    :host([focused]),
    :host([data-force-focus]) {
      --_pane-outline: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055)),
        inset 0 0 0 1px var(--au-pane-focus-color, rgba(245, 243, 238, 0.14));
    }
    :host([error]),
    :host([data-force-error]) {
      --_pane-outline: inset 0 0 0 1px var(--au-color-danger, #c0392b);
    }
    .au-pane-label {
      /* border-box: the shadow root does NOT inherit the kit's global box-sizing reset, so without this
         the min-height applies to the CONTENT box and the padding + 1px border ADD on top (~9px taller). */
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--au-space-3, 12px);
      flex-shrink: 0;
      padding: var(--au-space-1, 4px) var(--au-space-3, 12px) var(--au-space-1, 4px) var(--au-space-2, 8px);
      min-height: var(--au-row-h, 32px);
      background: transparent;
      border-bottom: 1px solid var(--au-line-1, rgba(255, 255, 255, 0.09));
    }
    .au-pane-leading {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      color: var(--au-ink-4, #777);
    }
    ::slotted([slot='title']) {
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      color: var(--au-ink-2, #c8c8c8);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    :host([preview]) ::slotted([slot='title']),
    :host([data-force-preview]) ::slotted([slot='title']) {
      font-style: italic;
      /* Italic leans past the last glyph's advance; overflow:hidden would clip it (a "d" reads as "a").
         A hair of trailing room keeps the final glyph whole. */
      padding-inline-end: 0.2em;
    }
    ::slotted([slot='meta']) {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-3, 12px);
      flex-shrink: 0;
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      color: var(--au-ink-4, #777);
      white-space: nowrap;
    }
    .au-pane-body {
      position: relative;
      --au-nesting-hover-height: 0px;
      --au-nesting-hover-opacity: 0;
      --au-nesting-hover-events: none;
      box-sizing: border-box;
      flex: 1;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      padding: var(--au-space-4, 16px);
      overflow-y: auto;
    }
    :host([flush]) .au-pane-body {
      padding: 0;
    }
    /* The direct wrapper header expands in the top gutter. Equal insets expose this
       frame at every edge; deeper frames keep their own independent gutters. */
    :host([nested]) .au-pane-body {
      padding: var(--au-space-1-5, 6px);
    }
    .gutter-toggle {
      appearance: none;
      position: absolute;
      z-index: 1;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: calc(var(--au-row-h, 32px) + var(--au-space-4, 16px));
      height: var(--au-space-1-5, 6px);
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--au-ink-2, #c8c8c8);
      cursor: pointer;
    }
    .gutter-toggle::after {
      content: '';
      position: absolute;
      top: var(--au-space-0-5, 2px);
      left: var(--au-space-2, 8px);
      right: var(--au-space-2, 8px);
      height: var(--au-space-0-5, 2px);
      border-radius: var(--au-radius-pill, 99px);
      background: var(--au-line-2, rgba(255, 255, 255, 0.14));
    }
    :host([data-gutter-target]) .gutter-toggle::after,
    .gutter-toggle:focus-visible::after { background: var(--au-ink-3, #999); }
    :host([data-gutter-target]:not([data-nesting-all])) .au-pane-body { cursor: pointer; }
    :host([data-nesting-all]) .gutter-toggle { cursor: default; }
    .gutter-toggle:focus-visible { outline: 2px solid var(--au-line-3); outline-offset: -2px; }
    .au-pane-body[data-reveal] {
      --au-nesting-hover-height: var(--au-row-h, 32px);
      --au-nesting-hover-opacity: 1;
      --au-nesting-hover-events: auto;
    }
  `

  private onLabelSlotChange = (): void => {
    this._hasLabel = !!this.querySelector(
      ':scope > [slot="label"], :scope > [slot="title"], :scope > [slot="meta"], :scope > [slot="leading"]',
    )
    this._hasLeading = !!this.querySelector(':scope > [slot="leading"]')
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('engaged')) {
      // Hold the current presentation. An ordinary tab menu must not introduce a header
      // that was hidden when the action started (or move the popup away from its anchor).
      const compact = this.querySelector<HTMLElement>(':scope > au-pane-header[compact]')
      const ownActions = this.querySelector(':scope > au-pane-header > [slot="actions"]')
      this._engagedReveal = this.engaged && (this._reveal || (compact?.getBoundingClientRect().height ?? 0) > 0
        || !!ownActions?.contains(this.ownerDocument.activeElement))
    }
  }

  private onGutterPointer = (event: PointerEvent): void => {
    const body = event.currentTarget as HTMLElement
    const target = event.composedPath()[0]
    if (this.nested && target === this.shadowRoot?.querySelector('.gutter-toggle')) {
      this.setGutterHover(true)
      return
    }
    if (!this.nested || target !== body) {
      this.setGutterHover(false)
      return
    }
    // Empty body space is not a gutter. Only the actual four padding bands reveal this layer.
    const rect = body.getBoundingClientRect()
    const padding = getComputedStyle(body)
    this.setGutterHover(event.clientX < rect.left + parseFloat(padding.paddingLeft)
      || event.clientX >= rect.right - parseFloat(padding.paddingRight)
      || event.clientY < rect.top + parseFloat(padding.paddingTop)
      || event.clientY >= rect.bottom - parseFloat(padding.paddingBottom))
  }

  private setGutterHover(hovered: boolean): void {
    if (this._gutterHover === hovered) return
    this._gutterHover = hovered
    if (hovered) this.scheduleGutterTip()
    else this.hideGutterTip()
  }

  private hideGutterTip = (): void => {
    clearTimeout(this.gutterTipTimer)
    this.gutterTipTimer = undefined
    this.gutterTip?.hide()
    this.gutterTip = null
  }

  private scheduleGutterTip = (): void => {
    this.hideGutterTip()
    this.gutterTipTimer = setTimeout(() => {
      this.gutterTipTimer = undefined
      const anchor = this.shadowRoot?.querySelector<HTMLElement>('.gutter-toggle')
      if (!anchor || !this.isConnected) return
      const text = this._allExpanded ? 'All container headers shown' : this._reveal ? 'Fold container header' : 'Reveal container header'
      this.gutterTip = showTooltip(anchor, text)
    }, 500)
  }

  disconnectedCallback(): void {
    this._gutterHover = false
    this.hideGutterTip()
    this.nestingObserver?.disconnect()
    super.disconnectedCallback()
  }

  private toggleReveal = (): void => {
    this.hideGutterTip()
    if (!this._allExpanded) this._reveal = !this._reveal
  }

  private syncNestingPreference = (): void => {
    const expanded = this.ownerDocument.documentElement.dataset.auNesting === 'expanded'
    if (expanded !== this._allExpanded) {
      // A global view command replaces manual disclosure choices in both directions.
      this._reveal = false
      this._engagedReveal = false
      this._allExpanded = expanded
    }
  }

  private headerName(): string {
    const header = this.querySelector<HTMLElement & { context?: string }>(':scope > au-pane-header')
    return header?.context || header?.querySelector('[slot="title"]')?.textContent?.trim() || 'Container'
  }

  render() {
    return html`
      <div
        class="au-pane-label"
        style=${this._hasLabel ? '' : 'display:none'}
        @dblclick=${() => this.dispatchEvent(new CustomEvent('au-label-dblclick', { bubbles: true, composed: true }))}
      >
        <slot name="label" @slotchange=${this.onLabelSlotChange}>
          <!-- Empty leading is HIDDEN, else the flex gap pushes the title right of the true padding. -->
          <span class="au-pane-leading" style=${this._hasLeading ? '' : 'display:none'}>
            <slot name="leading" @slotchange=${this.onLabelSlotChange}></slot>
          </span>
          <slot name="title" @slotchange=${this.onLabelSlotChange}></slot>
          <slot name="meta" @slotchange=${this.onLabelSlotChange}></slot>
        </slot>
      </div>
      <div class="au-pane-body" ?data-reveal=${this.nested && (this._allExpanded || this._reveal || this._engagedReveal)}
        @pointerover=${this.onGutterPointer}
        @pointermove=${this.onGutterPointer}
        @pointerleave=${() => { this.setGutterHover(false) }}
        @click=${(event: MouseEvent) => {
          if (this._gutterHover && event.composedPath()[0] === event.currentTarget) this.toggleReveal()
        }}>
        ${this.nested ? html`<button class="gutter-toggle" type="button"
          aria-label=${`${this.headerName()} container header`} aria-expanded=${String(this._allExpanded || this._reveal)}
          aria-disabled=${String(this._allExpanded)}
          @focus=${this.scheduleGutterTip}
          @blur=${this.hideGutterTip}
          @click=${this.toggleReveal}
          @keydown=${(event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); this.hideGutterTip(); this._reveal = false } }}></button>` : null}
        <slot @slotchange=${this.onLabelSlotChange}></slot>
      </div>
    `
  }

  connectedCallback(): void {
    super.connectedCallback()
    // Resolve the initial label state (children present at connect).
    queueMicrotask(() => { this.onLabelSlotChange(); this.requestUpdate() })
    this.syncNestingPreference()
    this.nestingObserver = new MutationObserver(this.syncNestingPreference)
    this.nestingObserver.observe(this.ownerDocument.documentElement, { attributes: true, attributeFilter: ['data-au-nesting'] })
  }
}
