// Shared notification card: a theme-owned floating surface, leading severity accent, heading,
// optional supporting content and action, and a dismiss control emitting au-close.
//
// The LOOK only: the host notification surface owns the claim, the queue, the timers, and dismissal.

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { floatingSurfaceMaterial } from './surface-material'

export class AuToastElement extends AuElement {
  static properties = {
    heading: { type: String },
    tone: { type: String, reflect: true },
    dismissible: { type: Boolean },
  }

  declare heading?: string
  declare tone?: 'ink' | 'ok' | 'warn' | 'danger'
  declare dismissible: boolean

  constructor() {
    super()
    this.dismissible = true
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      inline-size: 100%;
      min-inline-size: 0;
      max-inline-size: 100%;
      container: au-toast / inline-size;
    }
    .au-toast {
      --_dot-d: calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px));
      box-sizing: border-box;
      display: flex;
      align-items: flex-start;
      gap: var(--au-space-2, 8px);
      min-width: 0;
      padding: var(--au-space-3, 12px) var(--au-space-4, 16px);
      color: var(--au-ink-1, #e2dfda);
      ${floatingSurfaceMaterial}
      border-radius: var(--au-radius-panel,12px);
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14)),
        var(--au-sh-pop,0 12px 40px -8px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.35));
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-body,24px);
      font-variant-numeric: tabular-nums;
      animation: au-toast-in var(--au-m-base,220ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) both;
    }
    @media (forced-colors: active) {
      .au-toast { outline: 1px solid CanvasText; outline-offset: -1px; }
    }
    /* The leading accent aligns with the first text line; message text also conveys severity. */
    .au-toast__dot {
      flex: none;
      width: var(--_dot-d);
      height: var(--_dot-d);
      margin-top: calc((var(--au-lh-base,20px) - var(--_dot-d)) / 2);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-ink-3, #a09c92);
      box-sizing: border-box;
    }
    :host([tone='ok']) .au-toast__dot {
      background: var(--au-color-ok, #76cd98);
    }
    :host([tone='warn']) .au-toast__dot {
      background: var(--au-color-warn, #e6b55d);
    }
    :host([tone='danger']) .au-toast__dot {
      background: var(--au-color-danger, #fb817c);
    }
    .au-toast__content {
      overflow-wrap: anywhere;
      display: flex;
      flex-direction: column;
      gap: var(--au-space-1, 4px);
      flex: 1 1 auto;
      min-width: 0;
    }
    .au-toast__title {
      color: var(--au-ink-1, #e2dfda);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
    }
    .au-toast__desc {
      color: var(--au-ink-3, #a09c92);
    }
    .au-toast__action {
      display: inline-flex;
      align-items: center;
      flex: none;
    }
    .au-toast__action[hidden] { display: none; }
    .au-toast__close { flex: none; }
    @container au-toast (max-width: 20rem) {
      .au-toast { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; }
      .au-toast__dot { grid-column: 1; grid-row: 1; }
      .au-toast__content { grid-column: 2; grid-row: 1; }
      .au-toast__close { grid-column: 3; grid-row: 1; }
      .au-toast__action { grid-column: 2; grid-row: 2; }
    }
    @keyframes au-toast-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  `

  private onClose(): void {
    this.dispatchEvent(new CustomEvent('au-close', { bubbles: true, composed: true }))
  }

  /** Hide the description row when nothing is slotted, so an empty desc adds no gap below the heading. */
  private syncDesc(e: Event): void {
    const slot = e.target as HTMLSlotElement
    const has = slot
      .assignedNodes({ flatten: true })
      .some((n) => n.nodeType !== Node.TEXT_NODE || (n.textContent ?? '').trim() !== '')
    ;(this.renderRoot.querySelector('.au-toast__desc') as HTMLElement | null)?.toggleAttribute('hidden', !has)
  }

  private syncAction(event: Event): void {
    const slot = event.target as HTMLSlotElement
    const has = slot.assignedNodes({flatten:true}).some(node => node.nodeType !== Node.TEXT_NODE || !!node.textContent?.trim())
    this.renderRoot.querySelector('.au-toast__action')?.toggleAttribute('hidden', !has)
  }

  render() {
    return html`
      <div class="au-toast" part="toast" role="status" aria-live="polite">
        <span class="au-toast__dot" part="dot" aria-hidden="true"></span>
        <div class="au-toast__content" part="content">
          ${this.heading != null && this.heading !== ''
            ? html`<div class="au-toast__title" part="heading">${this.heading}</div>`
            : nothing}
          <div class="au-toast__desc" part="desc" hidden><slot @slotchange=${this.syncDesc}></slot></div>
        </div>
        <div class="au-toast__action" part="action" hidden><slot name="action" @slotchange=${this.syncAction}></slot></div>
        ${this.dismissible
          ? html`<au-close-button class="au-toast__close" part="close" label="Dismiss"
              @au-activate=${(event: Event) => { event.stopPropagation(); this.onClose() }}
            ></au-close-button>`
          : nothing}
      </div>
    `
  }
}
