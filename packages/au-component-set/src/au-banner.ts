// <au-banner> — the default set's Lit SHADOW implementation of the `au-banner` contract.
//
// The message family's PERSISTENT surface (sibling of the toast): ANCHORED in flow, an elev-3 fill + an
// INSET HAIRLINE (no drop-shadow, no timer), stating a condition that is true right now. Severity rides the
// leading tone dot (or an `icon` glyph) ONLY — never a left rail; `emphasis=tint` is the one sanctioned
// whisper of hue into the surface (danger/warn). Anatomy: dot/glyph · content (heading + message + default
// slot) · action slot · close. Composes au-icon (the optional leading glyph) + au-close-button (dismiss).
//
// Contract: tone / variant / placement / emphasis / heading / message / icon / dismissible. Emits `au-dismiss`
// (composed + bubbling) on close. Sets role=alert + aria-live=assertive for danger, else status/polite.
// TOKEN-ONLY.

import { css, html, nothing, type PropertyValues } from 'lit'
import { AuElement } from './au-element'
export class AuBannerElement extends AuElement {
  static properties = {
    tone: { type: String, reflect: true },
    variant: { type: String, reflect: true },
    placement: { type: String, reflect: true },
    emphasis: { type: String, reflect: true },
    heading: { type: String },
    message: { type: String },
    icon: { type: String },
    dismissible: { type: Boolean, reflect: true },
    _hasAction: { state: true },
    _hasIcon: { state: true },
  }

  declare tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger'
  declare variant: 'inline' | 'block'
  declare placement: 'contained' | 'docked'
  declare emphasis: 'flat' | 'tint'
  declare heading?: string
  declare message?: string
  declare icon?: string
  declare dismissible: boolean

  private _hasAction = false
  private _hasIcon = false

  constructor() {
    super()
    this.tone = 'neutral'
    this.variant = 'inline'
    this.placement = 'contained'
    this.emphasis = 'flat'
    this.dismissible = false
  }

  updated(changed: PropertyValues): void {
    if (changed.has('tone')) {
      // Severity → live-region semantics: a danger banner asserts, everything else politely announces.
      const danger = this.tone === 'danger'
      this.setAttribute('role', danger ? 'alert' : 'status')
      this.setAttribute('aria-live', danger ? 'assertive' : 'polite')
    }
    // `data-titled` marks heading presence (an untitled banner steps its message to ink-2).
    this.toggleAttribute('data-titled', this.heading != null && this.heading !== '')
  }

  private onDismiss(): void {
    this.dispatchEvent(new CustomEvent('au-dismiss', { bubbles: true, composed: true }))
  }

  // An action slot with no assigned content still lays out as a flex item, so its gap/margin would open
  // beside nothing — gate the wrapper on whether anything is slotted.
  private onActionSlot(e: Event): void {
    this._hasAction = (e.target as HTMLSlotElement).assignedNodes({ flatten: true }).length > 0
  }
  // A composed leading glyph (au-spinner / au-status-dot for a live / pending banner) wins over the `icon`
  // glyph name, which wins over the plain tone dot.
  private onIconSlot(e: Event): void {
    this._hasIcon = (e.target as HTMLSlotElement).assignedNodes({ flatten: true }).length > 0
  }

  static styles = css`
    :host {
      --_dot-d: calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px)); /* 6px */
      display: flex;
      align-items: flex-start;
      gap: var(--au-space-2, 8px);
      min-width: 0;
      min-height: var(--au-row-h, 32px);
      box-sizing: border-box;
      padding: var(--au-space-2, 8px) var(--au-space-3, 12px);
      color: var(--au-ink-1, #e2dfda);
      background: var(--au-elev-3-fill, #23262e);
      border-radius: var(--au-radius-row, 8px);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-base,20px);
      font-variant-numeric: tabular-nums;
    }
    :host([variant='block']) {
      gap: var(--au-space-3, 12px);
      padding: var(--au-space-3, 12px) var(--au-space-4, 16px);
      border-radius: var(--au-radius-panel,12px);
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
    }
    :host([placement='docked']) {
      align-items: center;
      width: 100%;
      min-height: var(--au-topbar-h,40px);
      padding: var(--au-space-2, 8px) var(--au-space-4, 16px);
      border-radius: 0;
      background: var(--au-elev-2-fill, #1c1f26);
      box-shadow: inset 0 -1px 0 var(--au-line-2, #3a3a3a);
    }
    :host([placement='docked']) .dot,
    :host([placement='docked']) .icon {
      margin-top: 0;
    }
    /* leading tone dot */
    .dot {
      flex: none;
      width: var(--_dot-d);
      height: var(--_dot-d);
      margin-top: calc((var(--au-lh-base,20px) - var(--_dot-d)) / 2);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-ink-3, #a09c92);
      box-sizing: border-box;
    }
    .icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      margin-top: calc((var(--au-lh-base,20px) - var(--au-t-body, 16px)) / 2);
      color: var(--au-ink-3, #a09c92);
      line-height: 0;
    }
    :host([tone='ok']) .dot { background: var(--au-color-ok, #3fb950); }
    :host([tone='ok']) .icon { color: var(--au-color-ok, #3fb950); }
    :host([tone='warn']) .dot { background: var(--au-color-warn, #d29922); }
    :host([tone='warn']) .icon { color: var(--au-color-warn, #d29922); }
    :host([tone='danger']) .dot { background: var(--au-color-danger, #c0392b); }
    :host([tone='danger']) .icon { color: var(--au-color-danger, #c0392b); }
    /* emphasis=tint — the one sanctioned hue whisper, danger/warn only */
    :host([emphasis='tint'][tone='danger']) {
      background: color-mix(in oklab, var(--au-color-danger, #c0392b) 6%, var(--au-elev-3-fill, #23262e));
      box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--au-color-danger, #c0392b) 22%, var(--au-line-2, #3a3a3a));
    }
    :host([emphasis='tint'][tone='warn']) {
      background: color-mix(in oklab, var(--au-color-warn, #d29922) 6%, var(--au-elev-3-fill, #23262e));
      box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--au-color-warn, #d29922) 22%, var(--au-line-2, #3a3a3a));
    }
    .content {
      overflow-wrap: anywhere;
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      flex-direction: column;
      gap: var(--au-space-1, 4px);
    }
    .heading {
      color: var(--au-ink-1, #e2dfda);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
    }
    :host([variant='block']) .heading {
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
    }
    .message {
      min-width: 0;
      color: var(--au-ink-3, #a09c92);
    }
    :host(:not([data-titled])) .message {
      color: var(--au-ink-2, #d9d6cd);
    }
    :host([variant='block']) .message {
      line-height: var(--au-lh-body,24px);
    }
    .actions {
      display: inline-flex;
      flex-wrap: wrap;
      flex: none;
      align-items: center;
      gap: var(--au-space-2, 8px);
    }
    :host(:not([variant='block'])) .actions {
      margin-left: var(--au-space-1, 4px);
    }
    :host([variant='block']) .actions {
      margin-top: var(--au-space-2, 8px);
    }
    .close {
      flex: none;
    }
    [hidden] {
      display: none !important;
    }
  `

  render() {
    const hasHeading = this.heading != null && this.heading !== ''
    const hasMessage = this.message != null && this.message !== ''
    const block = this.variant === 'block'
    // ONE action slot, positioned by variant (block: under the body; inline: trailing the row). It is
    // always in the DOM (so slotchange can detect content) but hidden until something is slotted.
    const actions = html`<div class="actions" part="actions" ?hidden=${!this._hasAction}><slot name="action" @slotchange=${this.onActionSlot}></slot></div>`
    return html`
      <span class="icon" part="icon" aria-hidden="true" ?hidden=${!this._hasIcon}><slot name="icon" @slotchange=${this.onIconSlot}></slot></span>
      ${!this._hasIcon
        ? this.icon
          ? html`<span class="icon" part="icon" aria-hidden="true"><au-icon name=${this.icon} size="sm"></au-icon></span>`
          : html`<span class="dot" part="dot" aria-hidden="true"></span>`
        : nothing}
      <div class="content" part="content">
        ${hasHeading ? html`<div class="heading" part="heading">${this.heading}</div>` : nothing}
        ${hasMessage ? html`<div class="message" part="message">${this.message}</div>` : nothing}
        ${block ? actions : nothing}
      </div>
      ${!block ? actions : nothing}
      ${this.dismissible
        ? html`<au-close-button
            class="close"
            part="close"
            tone=${this.tone === 'danger' ? 'danger' : 'neutral'}
            label="Dismiss"
            @au-activate=${this.onDismiss}
          ></au-close-button>`
        : nothing}
    `
  }
}
