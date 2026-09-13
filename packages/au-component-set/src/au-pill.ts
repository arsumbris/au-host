// Non-interactive status or metadata label. Tone and activity are explicit presentation inputs;
// the label remains the state signal, while the optional dot is decorative.

import { css, html, unsafeCSS } from 'lit'
import statusPillCss from '@arsumbris/style/status-pill.css?inline'
import { AuElement } from './au-element'
export class AuPillElement extends AuElement {
  static properties = {
    dot: { type: Boolean, reflect: true },
    draft: { type: Boolean, reflect: true },
    muted: { type: Boolean, reflect: true },
    tone: { type: String, reflect: true },
    pulse: { type: Boolean, reflect: true },
  }
  declare dot: boolean
  declare draft: boolean
  declare muted: boolean
  declare tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
  declare pulse: boolean

  constructor() {
    super()
    this.dot = false
    this.draft = false
    this.muted = false
    this.pulse = false
  }

  static styles = css`
    ${unsafeCSS(statusPillCss)}
  `

  render() {
    return html`${this.dot ? html`<span class="dot" part="dot" aria-hidden="true"></span>` : ''}<span part="label"><slot></slot></span>`
  }
}
