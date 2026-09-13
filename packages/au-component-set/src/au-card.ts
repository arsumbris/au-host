// <au-card> — a content container.
//
// `variant` surface|outline — `surface` is a raised elevation-3 panel; `outline` is a transparent
// fill with a hairline edge for metadata strips. `interactive` opts into hover/focus affordances and
// keyboard focusability (tabindex). `roomy` steps the padding up. Content is the default slot; the
// consumer's DOM is projected in, never reparented. TOKEN-ONLY, base `--au-*` with literal floors.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { controlFocusStyle } from './focus-style'

export class AuCardElement extends AuElement {
  static properties = {
    variant: { type: String, reflect: true },
    interactive: { type: Boolean, reflect: true },
    roomy: { type: Boolean, reflect: true },
  }

  declare variant?: 'surface' | 'outline'
  declare interactive: boolean
  declare roomy: boolean
  private ownsTabStop = false

  constructor() {
    super()
    this.interactive = false
    this.roomy = false
  }

  updated(): void {
    // interactive opts into keyboard focus; otherwise the card is not a tab stop.
    if (this.interactive) {
      if (!this.hasAttribute('tabindex')) {
        this.tabIndex = 0
        this.ownsTabStop = true
      }
    } else if (this.ownsTabStop) {
      if (this.getAttribute('tabindex') === '0') this.removeAttribute('tabindex')
      this.ownsTabStop = false
    }
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      box-sizing: border-box;
      min-width: 0;
      overflow-wrap: anywhere;
      padding: var(--au-space-4, 16px);
      color: var(--au-ink-2, #c8c8c8);
      background: var(--au-elev-3-fill, var(--au-color-surface-1, #1a1d23));
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      border-radius: var(--au-radius-panel,12px);
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([roomy]) {
      padding: var(--au-space-5, 20px);
    }
    :host([variant='outline']) {
      background: transparent;
      box-shadow: inset 0 0 0 1px var(--au-line-2, rgba(255, 255, 255, 0.09));
      border-radius: var(--au-radius-row, 8px);
    }
    :host([interactive]) {
      cursor: pointer;
    }
    :host([interactive]:hover),
    :host([data-force-hover]) {
      background: var(--au-elev-4-fill, var(--au-color-surface-2, #21242b));
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
    }
    :host([interactive]:focus-visible),
    :host([data-force-focus]) {
      ${controlFocusStyle}
    }
  `

  render() {
    return html`<slot></slot>`
  }
}
