// <au-divider> — a 1px hairline rule, horizontal or vertical. The 1px is the sanctioned hairline
// exception; the colour is always a --au-line-* token. `weight` picks subtle/default/strong; `inset`
// insets the rule from its container edges. The host element IS the rule (no shadow content).

import { css, html } from 'lit'
import { AuElement } from './au-element'
export class AuDividerElement extends AuElement {
  static properties = {
    orientation: { type: String, reflect: true },
    weight: { type: String, reflect: true },
    inset: { type: Boolean, reflect: true },
  }
  declare orientation: 'horizontal' | 'vertical'
  declare weight: 'subtle' | 'default' | 'strong'
  declare inset: boolean

  constructor() {
    super()
    this.orientation = 'horizontal'
    this.weight = 'default'
    this.inset = false
  }

  static styles = css`
    :host {
      display: block;
      flex-shrink: 0;
      background: var(--au-line-2, rgba(255, 255, 255, 0.14));
    }
    :host([orientation='horizontal']) {
      width: 100%;
      height: 1px;
    }
    :host([orientation='vertical']) {
      width: 1px;
      height: 100%;
      align-self: stretch;
    }
    :host([weight='subtle']) {
      background: var(--au-line-1, rgba(255, 255, 255, 0.09));
    }
    :host([weight='strong']) {
      background: var(--au-line-3, rgba(255, 255, 255, 0.22));
    }
    :host([inset][orientation='horizontal']) {
      margin-inline: var(--au-space-3, 12px);
      width: auto;
    }
    :host([inset][orientation='vertical']) {
      margin-block: var(--au-space-2, 8px);
      height: auto;
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'separator')
    this.setAttribute('aria-orientation', this.orientation)
  }

  updated(): void {
    this.setAttribute('aria-orientation', this.orientation)
  }

  render() {
    return html``
  }
}
