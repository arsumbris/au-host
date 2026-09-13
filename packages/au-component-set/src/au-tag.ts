// <au-tag> — the mono code-tag of the label family: a small monospaced label on the raised surface tone
// (frontmatter tags, code-ish chips). Non-interactive; `muted` recedes the text one ink step. Content is
// the default slot; long values remain readable within the available inline size.

import { css, html } from 'lit'
import { AuElement } from './au-element'
export class AuTagElement extends AuElement {
  static properties = {
    muted: { type: Boolean, reflect: true },
  }
  declare muted: boolean

  constructor() {
    super()
    this.muted = false
  }

  static styles = css`
    :host {
      display: inline-flex;
      box-sizing: border-box;
      min-width: 0;
      max-width: 100%;
      align-items: center;
      padding: var(--au-space-0-5, 2px) var(--au-space-2, 8px);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      font-variant-numeric: tabular-nums;
      color: var(--au-ink-3, #9a9a9a);
      background: var(--au-color-surface-2, #2a2a2a);
      border-radius: var(--au-radius-sm,5px);
      white-space: normal;
      overflow-wrap: anywhere;
    }
    :host([muted]) {
      color: var(--au-ink-4, #777);
    }
  `

  render() {
    return html`<slot></slot>`
  }
}
