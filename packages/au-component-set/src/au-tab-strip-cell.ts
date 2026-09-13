// <au-tab-strip-cell> — the default set's Lit SHADOW implementation of the `au-tab-strip-cell` contract.
//
// A single tab: grip · label · fixed trailing status/action slot. Selection uses fill and ink;
// text metrics stay constant. Unsaved status shares the close slot and yields on hover/focus.
// Pinned tabs retain their pin and a separate small unsaved marker. STATELESS — the container owns
// selection, drag and close wiring. It COMPOSES <au-grip-glyph> + <au-close-button> (tightened across
// the shadow via their `--au-grip-*` / `--au-close-size` vars) so those atoms stay the single owners.
//
// Emits `au-activate` (composed) on body press and `au-close` (composed) on the close affordance.
// Shared chrome roles own selection; group markers and drag handles share a stable leading slot.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import './au-grip-glyph'
import './au-close-button'
import { AU_ICON_NAMES } from './au-icon'

export class AuTabStripCellElement extends AuElement {
  static properties = {
    label: { type: String },
    icon: { type: String },
    group: { type: Boolean, reflect: true },
    active: { type: Boolean, reflect: true },
    dirty: { type: Boolean, reflect: true },
    pinned: { type: Boolean, reflect: true },
    dragging: { type: Boolean, reflect: true },
    locked: { type: Boolean, reflect: true },
    preview: { type: Boolean, reflect: true },
    moveLocked: { type: Boolean, attribute: 'move-locked' },
    removeLocked: { type: Boolean, attribute: 'remove-locked' },
    grip: { type: Boolean },
  }

  declare group: boolean
  declare label?: string
  declare icon?: string
  declare active: boolean
  declare dirty: boolean
  declare pinned: boolean
  declare dragging: boolean
  declare locked: boolean
  declare preview: boolean
  declare moveLocked: boolean
  declare removeLocked: boolean
  declare grip: boolean

  constructor() {
    super()
    this.group = false
    this.active = false
    this.dirty = false
    this.pinned = false
    this.dragging = false
    this.locked = false
    this.preview = false
    this.moveLocked = false
    this.removeLocked = false
    this.grip = true
    // Activate on a click ANYWHERE on the tab, not only on the label. The listener MUST live on the HOST:
    // the render wrapper is `display:contents` (it generates no box, so its flex children lay out on
    // :host), so a `@click` there only sees clicks that bubble up from a child element — missing the
    // padding and the flex gaps. :host is the full clickable box. The close button stops its own click
    // from bubbling here, so closing never also activates.
    this.addEventListener('click', () => this.onActivate())
    this.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.locked || this.moveLocked) return
      if (event.composedPath().some(el => el instanceof Element && el.classList.contains('trailing'))) return
      this.onGripPointerDown(event)
    })
    this.addEventListener('keydown', (event) => {
      if (event.composedPath()[0] !== this) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        this.onActivate()
      }
    })
  }

  static styles = css`
    :host {
      position: relative;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1-5, 6px);
      height: var(--au-tab-height, calc(var(--au-tabs-h,36px) - var(--au-space-2,8px)));
      max-width: var(--au-tab-max-width, 16rem);
      /* A readable FLOOR so a tab never collapses to grip+dot with the close spilling outside the pill
         when its strip is width-constrained (a narrow pane-header center). The strip scrolls past the
         floor rather than shrinking below it. <au-tab-bar> zeroes this — there cells stay content-width
         and the track scrolls. */
      min-width: var(--au-tab-min-width, 7rem);
      padding: 0 var(--au-space-1-5, 6px);
      padding-inline-start: var(--au-space-3, 12px);
      border: 0;
      border-radius: var(--au-radius-chip,6px);
      outline: 1px solid transparent;
      background: transparent;
      color: var(--au-ink-3, #a09c92);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      cursor: pointer;
      user-select: none;
      flex-shrink: 1;
      transition:
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .trailing {
      position: relative;
      display: inline-grid;
      place-items: center;
      flex: 0 0 var(--au-space-6, 24px);
      width: var(--au-space-6, 24px);
      height: var(--au-space-6, 24px);
    }
    .dot {
      position: absolute;
      pointer-events: none;
      width: var(--au-space-2, 8px);
      height: var(--au-space-2, 8px);
      flex-shrink: 0;
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-ink-5, #555);
      transition: background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .label {
      display: inline-block;
      min-width: 0;
      max-width: 24ch;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* the composed atoms — tightened + fade-on-hover (opacity is settable from outside; the size rides
       the atom's own override var, since an external width would lose to the atom's :host). */
    .handle {
      position: relative;
      display: inline-grid;
      place-items: center;
      flex: 0 0 var(--au-space-4, 16px);
      width: var(--au-space-4, 16px);
      height: var(--au-space-6, 24px);
    }
    .content-mark, .group-mark {
      position: absolute;
      width: var(--au-space-3, 12px);
      height: var(--au-space-3, 12px);
      pointer-events: none;
      color: inherit;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .content-mark { width: 1em; height: 1em; font-size: var(--au-t-sm, 13px); color: var(--au-ink-3, #a09c92); }
    :host(:hover) .handle:has(au-grip-glyph) .content-mark,
    :host(:focus-within) .handle:has(au-grip-glyph) .content-mark { opacity: 0; }
    :host([group]) au-grip-glyph { opacity: 0; }
    :host([group]:hover) .handle:has(au-grip-glyph) .group-mark,
    :host([group]:focus-within) .handle:has(au-grip-glyph) .group-mark { opacity: 0; }
    au-grip-glyph {
      --au-grip-w: var(--au-space-4, 16px);
      --au-grip-h: var(--au-space-5, 20px);
      opacity: 0;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    au-close-button {
      --au-close-size: var(--au-space-6, 24px);
      flex-shrink: 0;
      opacity: 0;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host(:hover) au-grip-glyph,
    :host([data-force-hover]) au-grip-glyph,
    :host(:focus-within) au-grip-glyph,
    :host([data-force-focus]) au-grip-glyph,
    :host(:hover) au-close-button,
    :host([data-force-hover]) au-close-button,
    :host([active]) au-close-button,
    :host(:focus-within) au-close-button,
    :host([data-force-focus]) au-close-button {
      opacity: 1;
    }
    @media (hover: none) {
      au-grip-glyph, au-close-button, :host([group]) au-grip-glyph { opacity: 1; }
      .handle:has(au-grip-glyph) .group-mark, .handle:has(au-grip-glyph) .content-mark { opacity: 0; }
    }
    .pin {
      display: inline-grid;
      place-items: center;
      width: var(--au-space-4, 16px);
      height: var(--au-space-4, 16px);
      flex-shrink: 0;
      color: var(--au-ink-4, #777);
    }
    .pin svg {
      width: var(--au-space-3, 12px);
      height: var(--au-space-3, 12px);
      display: block;
    }
    @media (prefers-reduced-motion: reduce) {
      :host, .dot, .content-mark, .group-mark, au-grip-glyph, au-close-button { transition: none; }
    }
    /* states */
    :host(:hover),
    :host([data-force-hover]) {
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
      color: var(--au-ink-2, #c8c8c8);
    }
    :host(:hover) .dot,
    :host([data-force-hover]) .dot {
      background: var(--au-ink-4, #777);
    }
    :host([active]),
    :host([data-force-active]) {
      background: var(--au-chrome-active, rgba(255, 255, 255, 0.075));
      box-shadow: none;
      color: var(--au-ink-1, #ededed);
      font-weight: var(--au-w-medium, 500);
      flex-shrink: 0;
    }
    :host([active]) .dot,
    :host([data-force-active]) .dot {
      background: var(--au-ink-2, #c8c8c8);
    }
    .dot { display: none; }
    :host([dirty]) .dot {
      display: block;
      background: var(--au-ink-1, #e2dfda);
    }
    :host([dirty]) au-close-button { opacity: 0; }
    :host([dirty]:hover) au-close-button,
    :host([dirty]:focus-within) au-close-button,
    :host([dirty][data-force-hover]) au-close-button,
    :host([dirty][data-force-focus]) au-close-button { opacity: 1; }
    :host([dirty]:hover) .trailing:has(au-close-button) .dot,
    :host([dirty]:focus-within) .trailing:has(au-close-button) .dot,
    :host([dirty][data-force-hover]) .trailing:has(au-close-button) .dot,
    :host([dirty][data-force-focus]) .trailing:has(au-close-button) .dot { display: none; }
    @media (hover: none) {
      :host([dirty]) au-close-button { opacity: 1; }
      :host([dirty]) .trailing:has(au-close-button) .dot { display: none; }
    }
    :host([dirty][pinned]) .dot {
      width: var(--au-space-1, 4px);
      height: var(--au-space-1, 4px);
      inset-inline-end: 0;
      top: var(--au-space-1, 4px);
    }
    :host(:focus-visible),
    :host([data-force-focus]) {
      ${controlFocusStyle}
    }
    :host([dragging]),
    :host([data-force-loading]) {
      background: var(--au-elev-5-fill, #1f1f1f);
      box-shadow: var(--au-sh-glass,0 0 0 1px rgba(245, 243, 238, 0.06), inset 0 1px 0 rgba(245, 243, 238, 0.04), 0 24px 64px -16px rgba(0, 0, 0, 0.6));
      color: var(--au-ink-1, #ededed);
    }
    :host([locked]),
    :host([data-force-locked]) {
      box-shadow: inset 0 0 0 1px var(--au-line-2, rgba(255, 255, 255, 0.14));
    }
    :host([preview]) .label {
      font-style: italic;
    }
  `

  private onActivate(): void {
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  private onGripPointerDown(e: PointerEvent): void {
    // The tab body is the drag affordance; the container owns the threshold and drag protocol. Emit
    // the drag INTENT with the pointer origin — composed + bubbling so it crosses this cell's and the bar's
    // shadow boundaries to the container, which reads this cell's id from the event's composedPath. Part of
    // the container-drivable tab-strip contract (the peer of tabCellRects on <au-tab-bar>).
    this.dispatchEvent(
      new CustomEvent('au-tab-drag-start', {
        detail: { clientX: e.clientX, clientY: e.clientY },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private onClose(e: Event): void {
    e.stopPropagation()
    this.dispatchEvent(new CustomEvent('au-close', { bubbles: true, composed: true }))
  }

  updated(): void {
    if (this.label?.trim()) this.setAttribute('aria-label', this.label.trim())
    else this.removeAttribute('aria-label')
    const description = [this.group ? 'Contains a nested group' : '', this.dirty ? 'Unsaved changes' : '', this.pinned ? 'Pinned' : '', this.locked ? 'Locked' : ''].filter(Boolean).join(', ')
    if (description) this.setAttribute('aria-description', description)
    else this.removeAttribute('aria-description')
    this.setAttribute('role', 'tab')
    this.setAttribute('aria-selected', this.active ? 'true' : 'false')
    this.setAttribute('tabindex', this.active ? '0' : '-1')
    // the full label rides the native tooltip; clear it when the label goes away so no stale title lingers
    if (this.label) this.title = this.label
    else this.removeAttribute('title')
  }

  render() {
    const showGrip = this.grip && !this.moveLocked && !this.locked
    const canClose = !this.removeLocked && !this.locked && !this.pinned
    return html`
      <div style="display:contents">
        ${showGrip || this.group || this.icon ? html`<span class="handle">
          ${this.icon && !this.group ? html`<au-icon class="content-mark" name=${AU_ICON_NAMES.includes(this.icon) ? this.icon : 'panel-top'} size="sm" aria-hidden="true"></au-icon>` : null}
          ${this.group ? html`<svg class="group-mark" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2"></rect><path d="M10.5 2H4a2 2 0 0 0-2 2v6.5"></path></svg>` : null}
          ${showGrip ? html`<au-grip-glyph ?dragging=${this.dragging}></au-grip-glyph>` : null}
        </span>` : null}
        <span class="label">${this.label ?? ''}</span>
        <span class="trailing">
        ${this.pinned
          ? html`<span class="pin" aria-hidden="true"
              ><svg viewBox="0 0 16 16" fill="currentColor" focusable="false" aria-hidden="true">
                <path
                  d="M9.5 1.5a1 1 0 0 1 1 1v.5l1.8 1.8a1 1 0 0 1-.7 1.7H9.2L8.5 12 7 13.5V6.5H4.4a1 1 0 0 1-.7-1.7L5.5 3v-.5a1 1 0 0 1 1-1h3Z"
                ></path></svg
            ></span>`
          : canClose
            ? html`<au-close-button
                label=${`Close ${this.label ?? ''}`}
                @au-activate=${this.onClose}
                @click=${(e: Event) => e.stopPropagation()}
              ></au-close-button>`
            : null}
        <span class="dot" aria-hidden="true"></span>
        </span>
      </div>
    `
  }
}
