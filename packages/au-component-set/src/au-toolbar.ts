// Action-bar layout over independently focusable controls. Native Tab order and each child's
// keyboard behavior remain owned by those controls; this is not a composite ARIA toolbar.
import { css, html } from 'lit'
import { AuElement } from './au-element'
import { floatingSurfaceMaterial, installBackdropMaterial } from './surface-material'

export class AuToolbarElement extends AuElement {
  static properties = {
    size: { type: String, reflect: true },
    variant: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    overflow: { type: String, reflect: true },
  }

  declare size: 'compact' | 'dense' | 'chrome'
  declare variant: 'docked' | 'floating'
  declare disabled: boolean
  declare overflow: 'scroll' | 'wrap'

  constructor() {
    super()
    this.size = 'dense'
    this.variant = 'docked'
    this.disabled = false
    this.overflow = 'scroll'
  }

  static styles = css`
    :host {
      /* dimension seeds — dense defaults; compact/chrome re-point them below. */
      --_h: calc(var(--au-space-1, 4px) * 8); /* 32 */
      --_pad-x: var(--au-space-2, 8px);
      --_sep-h: var(--au-space-4, 16px);


      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      width: 100%;
      min-width: 0;
      max-width: 100%;
      min-height: var(--_h);
      flex-shrink: 0;
      padding-inline: var(--_pad-x);
      background: transparent;
      border-bottom: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.14));
      color: var(--au-ink-2, #c8c8c8);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
    }

    /* ── size ── */
    :host([size='compact']) {
      --_h: var(--au-status-h, 28px);
    }
    :host([size='chrome']) {
      --_h: var(--au-topbar-h, 40px);
      --_pad-x: var(--au-space-3, 12px);
      --_sep-h: var(--au-space-5, 20px);
    }

    /* ── variant: floating (the contextual pill — the one elevated bar) ── */
    :host([variant='floating']) {

      display: inline-flex;
      width: auto;
      height: auto;
      min-height: var(--_h);
      padding: var(--au-space-1, 4px);
      ${floatingSurfaceMaterial}
      border-bottom: 0;
      border-radius: var(--au-radius-panel,12px);
      box-shadow: var(--au-elev-5-line), var(--au-sh-pop);
    }

    /* ── disabled context (no selection / read-only pane): dim + inert, bar stays visible ── */
    :host([disabled]),
    :host([data-force-disabled]) {
      opacity: var(--au-opacity-disabled, 0.5);
      pointer-events: none;
    }

    /* ── separator: a slotted vertical au-divider, inset to a token height (not full-bleed). ── */
    ::slotted(au-divider[orientation='vertical']) {
      align-self: center;
      height: var(--_sep-h);
    }

    :host([overflow='wrap']) {
      flex-wrap: wrap;
      overflow: visible;
      height: auto;
      padding-block: var(--au-space-1);
    }
    ::slotted(*) { flex-shrink: 0; }
    au-scroll-area { flex: 1 1 auto; min-width: 0; max-width: 100%; }
    .items { display: flex; align-items: center; gap: var(--au-space-2); width: max-content; min-width: 100%; box-sizing: border-box; padding-block: var(--au-space-1); }
    :host([overflow='wrap']) ::slotted(au-toolbar-group) { max-width: 100%; flex-wrap: wrap; }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'group')
  }

  firstUpdated(): void {
    installBackdropMaterial(this.renderRoot as ShadowRoot)
  }

  updated(): void {
    if (this.disabled) this.setAttribute('aria-disabled', 'true')
    else this.removeAttribute('aria-disabled')
  }

  render() {
    return this.overflow === 'wrap'
      ? html`<div style="display:contents" ?inert=${this.disabled}><slot></slot></div>`
      : html`<au-scroll-area axis="x" ?inert=${this.disabled}><div class="items"><slot></slot></div></au-scroll-area>`
  }
}

export class AuToolbarGroupElement extends AuElement {
  static properties = {
    gap: { type: String, reflect: true },
  }

  declare gap: 'default' | 'tight'

  constructor() {
    super()
    this.gap = 'default'
  }

  static styles = css`
    :host {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      min-width: 0;
    }
    :host([gap='tight']) {
      gap: var(--au-space-1, 4px);
    }
  `

  render() {
    return html`<slot></slot>`
  }
}

export class AuToolbarSpacerElement extends AuElement {
  static styles = css`
    :host {
      display: block;
      flex: 1 1 auto;
      min-width: var(--au-space-4, 16px);
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('aria-hidden', 'true')
  }

  render() {
    return html``
  }
}
