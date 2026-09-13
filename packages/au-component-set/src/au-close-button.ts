// <au-close-button> — the default set's Lit SHADOW implementation of the `au-close-button` contract.
//
// The small ✕ affordance on tabs, chips, panels, modals. Emits `au-activate` (composed + bubbling) on
// press, so a consumer listens on the tag. `tone="danger"` tints the hover glyph with the danger token
// (a close that destroys). Focus is a token ring over a 1px transparent hairline, never `outline: none`.
//
// TOKEN-ONLY on the shadow `<button>`.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import { reducedControlMotion } from './control-motion'
export class AuCloseButtonElement extends AuElement {
  static properties = {
    tone: { type: String, reflect: true },
    label: { type: String },
    disabled: { type: Boolean, reflect: true },
  }

  declare tone?: 'neutral' | 'danger'
  declare label?: string
  declare disabled: boolean

  constructor() {
    super()
    this.disabled = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: inline-flex;
    }
    button {
      box-sizing: border-box;
      display: inline-grid;
      place-items: center;
      /* A composing parent (au-tab-strip-cell) tightens the box across the shadow via this var. */
      width: var(--au-close-size, var(--au-space-6, 24px));
      height: var(--au-close-size, var(--au-space-6, 24px));
      flex-shrink: 0;
      padding: 0;
      border: 0;
      border-radius: var(--au-radius-chip,6px);
      outline: 1px solid transparent;
      color: var(--au-ink-4, #777);
      background: transparent;
      cursor: pointer;
      transition:
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    svg {
      width: var(--au-space-3, 12px);
      height: var(--au-space-3, 12px);
      display: block;
    }
    button:hover:not(:disabled),
    :host([data-force-hover]:not([disabled])) button {
      color: var(--au-ink-1, #ededed);
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
    }
    :host([tone='danger']) button:hover:not(:disabled),
    :host([tone='danger'][data-force-hover]:not([disabled])) button {
      color: var(--au-color-danger, #c0392b);
    }
    button:active:not(:disabled),
    :host([data-force-active]:not([disabled])) button {
      background: var(--au-chrome-active, rgba(255, 255, 255, 0.075));
      transform: scale(0.98);
    }
    button:focus-visible,
    :host([data-force-focus]) button {
      ${controlFocusStyle}
    }
    button:disabled,
    :host([data-force-disabled]) button {
      color: var(--au-ink-5, #555);
      background: transparent;
      cursor: default;
    }
    @media (prefers-reduced-motion: reduce) {
      button:active:not(:disabled),
      :host([data-force-active]:not([disabled])) button {
        transform: none;
      }
    }
  `

  private onClick(e: MouseEvent): void {
    if (this.disabled) {
      e.stopImmediatePropagation()
      return
    }
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  render() {
    return html`
      <button
        part="button"
        type="button"
        aria-label=${this.label?.trim() || 'Close'}
        ?disabled=${this.disabled}
        @click=${this.onClick}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          focusable="false"
          aria-hidden="true"
        >
          <path d="M4 4l8 8M12 4l-8 8"></path>
        </svg>
      </button>
    `
  }
}
