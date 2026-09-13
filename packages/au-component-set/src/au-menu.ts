// au-menu is the floating-menu container: a token-styled panel with an inset hairline, shadow
// and padding. Its default slot holds au-menu-item rows and au-divider separators.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { floatingSurfaceMaterial } from './surface-material'

export class AuMenuElement extends AuElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 0;
      min-width: 0;
      padding: var(--au-space-1, 4px);
      color: var(--au-ink-1, #ededed);
      ${floatingSurfaceMaterial}
      border-radius: var(--au-radius-panel,12px);
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14)),
        var(--au-sh-pop);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      box-sizing: border-box;
    }
    /* A slotted section label (a [data-section] element) — the sentence-case sans LABEL role, kept quiet
       so it recedes below the rows it heads. Items + separators + section labels slot in document order. */
    ::slotted([data-section]) {
      display: block;
      padding: var(--au-space-2, 8px) var(--au-space-3, 12px) var(--au-space-1, 4px);
      color: var(--au-ink-4, #777);
      font-size: var(--au-t-xs, 12px);
      font-weight: var(--au-w-medium, 500);
    }
  `

  render() {
    return html`<slot></slot>`
  }
}
