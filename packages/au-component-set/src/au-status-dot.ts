// Passive state marker; a label exposes a named image, otherwise decorative.

import { css, html } from 'lit'
import { AuElement } from './au-element'
export class AuStatusDotElement extends AuElement {
  static properties = {
    tone: { type: String, reflect: true },
    variant: { type: String, reflect: true },
    size: { type: String, reflect: true },
    glow: { type: Boolean, reflect: true },
    pulse: { type: Boolean, reflect: true },
    label: { type: String },
  }

  declare tone?: 'ink' | 'ok' | 'warn' | 'danger'
  declare variant?: 'filled' | 'ring'
  declare size?: 'sm' | 'md' | 'lg'
  declare glow: boolean
  declare pulse: boolean
  declare label?: string

  constructor() {
    super()
    this.glow = false
    this.pulse = false
  }

  static styles = css`
    :host {
      display: inline-block;
      flex-shrink: 0;
      vertical-align: middle;
    }
    :host([hidden]) { display: none; }
    .dot {
      --_d: calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px));
      /* the tone colour — the neutral ink is the base; a status tone overrides it below. */
      --_tone: var(--au-ink-1, #ededed);
      position: relative;
      display: block;
      width: var(--_d);
      height: var(--_d);
      border-radius: var(--au-radius-pill,99px);
      background: var(--_tone);
      box-sizing: border-box;
    }
    :host([size='sm']) .dot {
      --_d: var(--au-space-1, 4px);
    }
    :host([size='lg']) .dot {
      --_d: var(--au-space-2, 8px);
    }
    /* status tones — ok/warn/danger set --_tone; every state below reads it. */
    :host([tone='ok']) .dot {
      --_tone: var(--au-color-ok, #76cd98);
    }
    :host([tone='warn']) .dot {
      --_tone: var(--au-color-warn, #e6b55d);
    }
    :host([tone='danger']) .dot {
      --_tone: var(--au-color-danger, #fb817c);
    }
    /* ring — hollow. The neutral ink ring uses secondary ink; a status-toned ring uses its tone. */
    :host([variant='ring']) .dot {
      background: transparent;
      box-shadow: inset 0 0 0 1px var(--au-ink-3, #999);
    }
    :host([tone='ok'][variant='ring']) .dot,
    :host([tone='warn'][variant='ring']) .dot,
    :host([tone='danger'][variant='ring']) .dot {
      box-shadow: inset 0 0 0 1px var(--_tone);
    }
    /* A separate halo preserves the ring's inset outline. */
    :host([glow]) .dot::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      box-shadow: 0 0 0 var(--au-space-0-5, 2px) color-mix(in oklab, var(--_tone) 18%, transparent);
    }
    /* pulse — an expanding, fading ring over the crisp dot (transform + opacity only). */
    :host([pulse]) .dot::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: 0 0 0 1px color-mix(in oklab, var(--_tone) 45%, transparent);
      transform-origin: center;
      pointer-events: none;
      animation: au-status-pulse calc(var(--au-m-cinema,780ms) * 3) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) infinite;
    }
    :host([tone='ok'][pulse]) .dot::after,
    :host([tone='warn'][pulse]) .dot::after,
    :host([tone='danger'][pulse]) .dot::after {
      box-shadow: 0 0 0 1px color-mix(in oklab, var(--_tone) 50%, transparent);
    }
    @keyframes au-status-pulse {
      0% {
        opacity: 0.55;
        transform: scale(1);
      }
      80%,
      100% {
        opacity: 0;
        transform: scale(2);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host([pulse]) .dot::after {
        animation: none;
        opacity: 0.5;
        transform: scale(1.35);
      }
    }
  `

  updated(): void {
    // The dot is decorative unless the caller names it — then it IS the signal.
    if (this.label?.trim()) {
      this.setAttribute('role', 'img')
      this.setAttribute('aria-label', this.label)
      this.removeAttribute('aria-hidden')
    } else {
      this.setAttribute('aria-hidden', 'true')
      this.removeAttribute('role')
      this.removeAttribute('aria-label')
    }
  }

  render() {
    return html`<span class="dot" part="dot"></span>`
  }
}
