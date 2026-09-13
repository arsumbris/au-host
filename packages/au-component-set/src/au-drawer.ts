// au-drawer is an edge-docked overlay sheet with token-styled content and actions.
// It shares the overlay family's layering and interaction contract.

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { floatingSurfaceMaterial } from './surface-material'
import { scrollbarStyle } from './scrollbar-style'

export class AuDrawerElement extends AuElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    side: { type: String, reflect: true },
    size: { type: String, reflect: true },
    posture: { type: String, reflect: true },
    heading: { type: String },
    subtitle: { type: String },
    dismissible: { type: Boolean },
    resizable: { type: Boolean },
  }

  declare open: boolean
  declare side: 'right' | 'left' | 'bottom'
  declare size: 'sm' | 'md' | 'lg'
  declare posture: 'modal' | 'flush'
  declare heading?: string
  declare subtitle?: string
  declare dismissible: boolean
  declare resizable: boolean

  #hasActions = false

  constructor() {
    super()
    this.open = false
    this.side = 'right'
    this.size = 'md'
    this.posture = 'modal'
    this.dismissible = false
    this.resizable = false
    this.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.open) {
        e.stopPropagation()
        this.#emitClose()
      }
    })
  }

  #emitClose(): void {
    this.dispatchEvent(new CustomEvent('au-close', { bubbles: true, composed: true }))
  }

  #onActionsSlot(e: Event): void {
    const has = (e.target as HTMLSlotElement).assignedElements().length > 0
    if (has !== this.#hasActions) {
      this.#hasActions = has
      this.requestUpdate()
    }
  }
  #onFooterSlot(e: Event): void {
    const has = (e.target as HTMLSlotElement).assignedElements().length > 0
    ;(this.renderRoot.querySelector('.footer') as HTMLElement | null)?.toggleAttribute('hidden', !has)
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      /* component-LOCAL width seeds, quantised to the 4px ladder (density-aware). */
      --au-drawer-sm: calc(var(--au-space-1, 4px) * 80); /* 320 */
      --au-drawer-md: calc(var(--au-space-1, 4px) * 100); /* 400 */
      --au-drawer-lg: calc(var(--au-space-1, 4px) * 120); /* 480 */
      --au-drawer-sheet-h: min(60%, calc(var(--au-space-1, 4px) * 160)); /* bottom sheet: 60%, 640 cap */
      position: absolute;
      inset: 0;
      z-index: var(--au-z-overlay,1100);
      isolation: isolate;
      /* the layer never captures pointer by itself — only the scrim (modal) or the panel opt in. */
      pointer-events: none;
    }
    /* ── scrim — modal posture only; click-out closes ── */
    .scrim {
      position: absolute;
      inset: 0;
      background: var(--au-scrim, rgba(0, 0, 0, 0.5));
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([open]) .scrim {
      opacity: 1;
      pointer-events: auto;
    }
    :host(:not([open])) .scrim {
      transition: opacity var(--au-m-fast,160ms) var(--au-e-deep,cubic-bezier(0.16, 1, 0.3, 1));
    }
    /* ── panel — base rule IS the CLOSED pose (translated off its edge, hidden) + the ENTER transition. ── */
    .panel {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-width: 100%;
      overflow: hidden;
      pointer-events: auto;
      visibility: hidden;
      color: var(--au-ink-1, #ededed);
      background: var(--au-elev-3-fill, #23262e);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      border-radius: 0;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      font-variant-numeric: tabular-nums;
      transition:
        transform var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        visibility 0s;
      will-change: transform;
    }
    /* modal posture — elev-5 surface + the family's single glass drop shadow. */
    :host([posture='modal']) .panel {
      ${floatingSurfaceMaterial}
      position: absolute;
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14)),
        var(--au-sh-glass,0 0 0 1px rgba(245, 243, 238, 0.06), inset 0 1px 0 rgba(245, 243, 238, 0.04), 0 24px 64px -16px rgba(0, 0, 0, 0.6));
    }
    /* width by size */
    :host([size='sm']) .panel {
      --au-drawer-w: var(--au-drawer-sm);
    }
    :host([size='md']) .panel {
      --au-drawer-w: var(--au-drawer-md);
    }
    :host([size='lg']) .panel {
      --au-drawer-w: var(--au-drawer-lg);
    }
    /* anchor per edge + the slide axis (transform only) */
    :host([side='right']) .panel {
      inset-block: 0;
      inset-inline-end: 0;
      width: min(var(--au-drawer-w, var(--au-drawer-md)), 100%);
      transform: translateX(100%);
    }
    :host([side='left']) .panel {
      inset-block: 0;
      inset-inline-start: 0;
      width: min(var(--au-drawer-w, var(--au-drawer-md)), 100%);
      transform: translateX(-100%);
    }
    :host([side='bottom']) .panel {
      inset-inline: 0;
      inset-block-end: 0;
      width: 100%;
      height: var(--au-drawer-sheet-h);
      transform: translateY(100%);
    }
    /* open — the panel settles to rest. */
    :host([open]) .panel {
      transform: none;
      visibility: visible;
    }
    /* closing — leave FASTER, hold visibility through the slide-out. */
    :host(:not([open])) .panel {
      transition:
        transform var(--au-m-fast,160ms) var(--au-e-deep,cubic-bezier(0.16, 1, 0.3, 1)),
        visibility 0s var(--au-m-fast,160ms);
    }
    /* ── header ── */
    .header {
      display: flex;
      align-items: flex-start;
      gap: var(--au-space-3, 12px);
      flex: none;
      min-height: calc(var(--au-space-1, 4px) * 13);
      padding: var(--au-space-4, 16px) var(--au-space-5, 20px);
      border-bottom: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.1));
    }
    .heading {
      display: flex;
      flex-direction: column;
      gap: var(--au-space-1, 4px);
      min-width: 0;
      flex: 1 1 auto;
    }
    .title {
      margin: 0;
      color: var(--au-ink-1, #ededed);
      font-size: var(--au-t-lead, 18px);
      line-height: var(--au-lh-lead,24px);
      font-weight: var(--au-w-strong,590);
      letter-spacing: var(--au-ls-snug,-0.02em);
      overflow-wrap: anywhere;
    }
    .subtitle {
      margin: 0;
      overflow-wrap: anywhere;
      color: var(--au-ink-4, #777);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      flex: none;
      margin-inline-start: auto;
    }
    /* ── body — the ONLY scroller ── */
    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      overflow-wrap: anywhere;
      padding: var(--au-space-4, 16px) var(--au-space-5, 20px);
    }
    /* Sticky footer actions separated from the content by one hairline. */
    .footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--au-space-3, 12px);
      flex: none;
      min-height: calc(var(--au-space-1, 4px) * 15);
      padding: var(--au-space-4, 16px) var(--au-space-5, 20px);
      border-top: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.1));
    }
    .footer[hidden] { display: none; }
    ${scrollbarStyle(css`.body`)}
    /* ── resize affordance on the docking seam (presentational; the container owns the drag) ── */
    .seam {
      position: absolute;
      inset-block: 0;
      width: 1px;
      background: var(--au-line-2, rgba(255, 255, 255, 0.1));
      z-index: var(--au-z-raised,10);
    }
    :host([side='right']) .seam {
      inset-inline-start: 0;
    }
    :host([side='left']) .seam {
      inset-inline-end: 0;
    }
    .grabber {
      position: absolute;
      inset-block-start: var(--au-space-1, 4px);
      inset-inline: 0;
      display: flex;
      justify-content: center;
      z-index: var(--au-z-raised,10);
    }
  `

  render() {
    const hasHeader =
      (this.heading != null && this.heading !== '') ||
      (this.subtitle != null && this.subtitle !== '') ||
      this.dismissible ||
      this.#hasActions
    return html`
      ${this.posture === 'modal'
        ? html`<div class="scrim" part="scrim" aria-hidden="true" @click=${this.#emitClose}></div>`
        : nothing}
      <aside
        class="panel"
        part="panel"
        role="dialog"
        aria-modal=${this.posture === 'modal' ? 'true' : nothing}
        aria-label=${this.heading ?? nothing}
        data-side=${this.side}
      >
        ${this.resizable && this.side !== 'bottom' ? html`<div class="seam" aria-hidden="true"></div>` : nothing}
        ${this.resizable && this.side === 'bottom'
          ? html`<div class="grabber" aria-hidden="true"><au-grip-glyph></au-grip-glyph></div>`
          : nothing}
        <header class="header" part="header" ?hidden=${!hasHeader}>
          <div class="heading">
            ${this.heading ? html`<h2 class="title" part="title">${this.heading}</h2>` : nothing}
            ${this.subtitle ? html`<p class="subtitle" part="subtitle">${this.subtitle}</p>` : nothing}
          </div>
          <div class="header-actions">
            <slot name="header-actions" @slotchange=${this.#onActionsSlot}></slot>
            ${this.dismissible
              ? html`<au-close-button part="close" @au-activate=${this.#emitClose}></au-close-button>`
              : nothing}
          </div>
        </header>
        <div class="body" part="body"><slot></slot></div>
        <div class="footer" part="footer" hidden>
          <slot name="footer" @slotchange=${this.#onFooterSlot}></slot>
        </div>
      </aside>
    `
  }
}
