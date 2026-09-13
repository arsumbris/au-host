// <au-spinner> — an indeterminate activity ring (motion tokens only): a hairline track with a bright ink
// arc that rotates. `size` sm/md/lg from the space ramp. Reduced-motion collapses it to a static neutral
// ring. The host element IS the ring.

import { css, html } from 'lit'
import { AuElement } from './au-element'
export class AuSpinnerElement extends AuElement {
  static properties = {
    size: { type: String, reflect: true },
    label: { type: String },
  }
  declare size: 'sm' | 'md' | 'lg'
  declare label?: string
  private appliedLabel?: string

  constructor() {
    super()
    this.size = 'md'
  }

  static styles = css`
    :host {
      --_d: var(--au-space-4, 16px);
      display: inline-block;
      box-sizing: border-box;
      width: var(--_d);
      height: var(--_d);
      border: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.14));
      border-top-color: var(--au-ink-1, #e8e8e8);
      border-radius: var(--au-radius-pill,99px);
      animation: au-spin var(--au-m-slow,420ms) linear infinite;
    }
    :host([size='sm']) {
      --_d: var(--au-space-3, 12px);
    }
    :host([size='lg']) {
      --_d: var(--au-space-5,20px);
    }
    @keyframes au-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'status')
  }

  updated(): void {
    const current = this.getAttribute('aria-label')
    // Respect an explicit consumer name while keeping the component-owned name reactive.
    if (current?.trim() && current !== this.appliedLabel) return
    this.appliedLabel = this.label?.trim() || 'Loading'
    this.setAttribute('aria-label', this.appliedLabel)
  }

  render() {
    return html``
  }
}
