// <au-hovercard> — the ephemeral peek shell (cmd-hover note previews, the graph's ⌘-hover peek).
//
// LOOK ONLY: a raised surface with a soft projected-out pop-in; the HOST preview overlay owns the
// positioning + the claim (the au-modal split). `origin` sets where the pop-in emanates FROM, so it
// grows out of the anchor. Content is the default slot. TOKEN-ONLY, base `--au-*` with literal floors.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { floatingSurfaceMaterial } from './surface-material'

export class AuHovercardElement extends AuElement {
  static properties = {
    origin: { type: String, reflect: true },
  }

  declare origin: 'top-center' | 'bottom-center' | 'top-left' | 'bottom-left' | 'center'

  constructor() {
    super()
    this.origin = 'top-center'
  }

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      color: var(--au-ink-1, #e2dfda);
      ${floatingSurfaceMaterial}
      border: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.09));
      border-radius: var(--au-radius-panel,12px);
      box-shadow: var(--au-sh-pop,0 12px 40px -8px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.35));
      /* the pop-in emanates from the side facing the anchor. */
      transform-origin: top center;
      animation: au-hovercard-in var(--au-m-fast, 160ms) var(--au-e-soft, cubic-bezier(0.22, 1, 0.36, 1));
    }
    :host([origin='bottom-center']) {
      transform-origin: bottom center;
    }
    :host([origin='top-left']) {
      transform-origin: top left;
    }
    :host([origin='bottom-left']) {
      transform-origin: bottom left;
    }
    :host([origin='center']) {
      transform-origin: center;
    }
    @keyframes au-hovercard-in {
      from {
        opacity: 0;
        transform: scale(0.985);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `

  render() {
    return html`<slot></slot>`
  }
}
