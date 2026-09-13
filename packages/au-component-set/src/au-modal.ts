// <au-modal> — the shared dialog surface; the host owns modal behavior.
//
// Elev-5 fill + inset hairline + glass shadow, panel radius. A heading, a body (default slot), and an
// optional actions shelf (the `actions` slot — a hairline-topped same-surface footer) shown only when filled.
// An optional top-right × close (au-close). NEVER a leading/left accent bar. TOKEN-ONLY with floors.
//
// The LOOK only: a host surface (confirm / chooser) owns the scrim, focus-trap, keyboard, and lifecycle.

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { floatingSurfaceMaterial } from './surface-material'

export class AuModalElement extends AuElement {
  static properties = {
    heading: { type: String },
    variant: { type: String, reflect: true },
    dismissible: { type: Boolean, reflect: true },
  }

  declare heading?: string
  declare variant?: 'default' | 'preview'
  declare dismissible: boolean

  constructor() {
    super()
    this.dismissible = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      box-sizing: border-box;
      color: var(--au-ink-1, #ededed);
      ${floatingSurfaceMaterial}
      border-radius: var(--au-radius-panel, 12px);
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14)),
        var(--au-sh-glass,0 0 0 1px rgba(245, 243, 238, 0.06), inset 0 1px 0 rgba(245, 243, 238, 0.04), 0 24px 64px -16px rgba(0, 0, 0, 0.6));
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      font-variant-numeric: tabular-nums;
      animation: au-modal-in var(--au-m-base,220ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) both;
    }
    :host([variant='preview']) {
      border-radius: var(--au-radius-panel,12px);
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14)),
        var(--au-sh-header,0 1px 0 rgba(245, 243, 238, 0.06), 0 8px 24px -16px rgba(0, 0, 0, 0.4));
    }
    .header {
      display: flex;
      align-items: baseline;
      gap: var(--au-space-3, 12px);
      padding: var(--au-space-5, 20px) var(--au-space-5, 20px) var(--au-space-2, 8px);
    }
    /* Reserve inline-end room for the floated close so a long title never slides under it. */
    :host([dismissible]) .header {
      padding-inline-end: calc(var(--au-space-5, 20px) + var(--au-space-5, 20px));
    }
    .title {
      min-width: 0;
      overflow-wrap: anywhere;
      margin: 0;
      flex: 1 1 auto;
      color: var(--au-ink-1, #ededed);
      font-size: var(--au-t-title,20px);
      line-height: var(--au-lh-title,28px);
      font-weight: var(--au-w-strong,590);
      letter-spacing: var(--au-ls-snug,-0.02em);
    }
    .body {
      min-width: 0;
      overflow-wrap: anywhere;
      padding: var(--au-space-5, 20px);
      color: var(--au-ink-2, #d9d6cd);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-body,24px);
    }
    /* A header already owns the top rhythm (its space-2 bottom gaps to the body). */
    .header + .body {
      padding-top: 0;
    }
    /* The optional actions shelf shares the surface fill; a hairline separates it from the body. */
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--au-space-2, 8px);
      padding: var(--au-space-4, 16px) var(--au-space-5, 20px);
      border-top: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.1));
    }
    .actions[hidden] { display: none; }
    .close {
      position: absolute;
      top: var(--au-space-4, 16px);
      inset-inline-end: var(--au-space-4, 16px);
    }
    @keyframes au-modal-in {
      from {
        opacity: 0;
        transform: translateY(var(--au-space-2, 8px)) scale(0.985);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
  `

  private onClose(): void {
    this.dispatchEvent(new CustomEvent('au-close', { bubbles: true, composed: true }))
  }

  /** Hide the actions shelf until something is slotted into it. */
  private syncActions(e: Event): void {
    const slot = e.target as HTMLSlotElement
    const has = slot.assignedElements().length > 0
    ;(this.renderRoot.querySelector('.actions') as HTMLElement | null)?.toggleAttribute('hidden', !has)
  }

  render() {
    return html`
      ${this.heading != null && this.heading !== ''
        ? html`<div class="header" part="header"><h2 class="title" part="title">${this.heading}</h2></div>`
        : nothing}
      <div class="body" part="body"><slot></slot></div>
      <div class="actions" part="actions" hidden>
        <slot name="actions" @slotchange=${this.syncActions}></slot>
      </div>
      ${this.dismissible
        ? html`<au-close-button class="close" part="close" @au-activate=${this.onClose}></au-close-button>`
        : nothing}
    `
  }
}
