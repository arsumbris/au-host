import { pickerKeyframes, pickerExitMotion } from './picker-motion'
// au-popover is a token-styled floating panel. Its caller supplies content and the host overlay placement.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { pickerSurface } from './picker-style'

export class AuPopoverElement extends AuElement {
  static properties = {
    side: { type: String, reflect: true },
    arrow: { type: Boolean, reflect: true },
    heading: { type: String },
    scrollable: { type: Boolean, reflect: true },
  }

  declare side: 'top' | 'right' | 'bottom' | 'left'
  declare arrow: boolean
  declare heading?: string
  declare scrollable: boolean

  constructor() {
    super()
    this.side = 'bottom'
    this.arrow = true
    this.scrollable = false
  }

  static styles = css`
  ${pickerKeyframes}
  :host([data-state='closed']) { ${pickerExitMotion} }
    :host {
      ${pickerSurface}
      display: flex;
      flex-direction: column;
      gap: var(--au-space-3, 12px);
      box-sizing: border-box;
      position: relative;
      min-width: 0;
      max-width: 100%;
      padding: var(--au-space-3, 12px);
      color: var(--au-ink-2, #c8c8c8);
    }
    .title {
      flex: none;
      overflow-wrap: anywhere;
      color: var(--au-ink-1, #ededed);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
    }
    .body {
      color: var(--au-ink-2, #c8c8c8);
      display: flex;
      flex-direction: column;
      gap: var(--au-space-3, 12px);
      min-height: 0;
    }
    :host([scrollable]) { max-height: calc(100dvh - var(--au-space-6)); }
    .scroll { flex: 1; min-height: 0; }
    .footer { flex: none; display: flex; flex-wrap: wrap; gap: var(--au-space-2); }
    .footer[hidden] { display: none; }
    .arrow {
      position: absolute;
      width: var(--au-space-2, 8px);
      height: var(--au-space-2, 8px);
      background: var(--au-floating-fill, var(--au-elev-5-fill, #2b2f38));
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14));
      transform: rotate(45deg);
    }
    :host([side='top']) .arrow {
      bottom: calc(var(--au-space-1, 4px) * -1);
      left: 50%;
      margin-left: calc(var(--au-space-1, 4px) * -1);
    }
    :host([side='bottom']) .arrow {
      top: calc(var(--au-space-1, 4px) * -1);
      left: 50%;
      margin-left: calc(var(--au-space-1, 4px) * -1);
    }
    :host([side='left']) .arrow {
      right: calc(var(--au-space-1, 4px) * -1);
      top: 50%;
      margin-top: calc(var(--au-space-1, 4px) * -1);
    }
    :host([side='right']) .arrow {
      left: calc(var(--au-space-1, 4px) * -1);
      top: 50%;
      margin-top: calc(var(--au-space-1, 4px) * -1);
    }

  `

  render() {
    return html`
      ${this.arrow ? html`<span class="arrow" part="arrow" aria-hidden="true"></span>` : nothing}
      ${this.heading ? html`<div class="title" part="title">${this.heading}</div>` : nothing}
      ${this.scrollable ? html`<au-scroll-area class="scroll" part="scroll" axis="y"><div class="body" part="body"><slot></slot></div></au-scroll-area>` : html`<div class="body" part="body"><slot></slot></div>`}
      <div class="footer" part="footer" hidden><slot name="footer" @slotchange=${(event: Event) => {
        const slot = event.target as HTMLSlotElement
        slot.parentElement!.hidden = slot.assignedElements().length === 0
      }}></slot></div>
    `
  }
}
