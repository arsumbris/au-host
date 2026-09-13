// <au-chevron> — the default set's Lit SHADOW implementation of the `au-chevron` contract.
//
// The disclosure arrow (section / nav-group / tree row / select + combobox triggers). Closed points
// right; `open` rotates it to point down. The rotation is on-screen TRANSPORT, so it rides
// `--au-m-base` on `--au-e-move`; reduced motion disables the transition. Emits `au-activate`
// (composed + bubbling) on press. Deliberately a fixed 16-box at 1.5 stroke, NOT `<au-icon>` (whose
// alphabet is a 24-box on the type ramp) — control chrome is sized by its control's own CSS.
//
// TOKEN-ONLY on the shadow `<button>`.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { controlFocusStyle } from './focus-style'
export class AuChevronElement extends AuElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    label: { type: String },
    disabled: { type: Boolean, reflect: true },
  }

  declare open: boolean
  declare label?: string
  declare disabled: boolean

  constructor() {
    super()
    this.open = false
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
      width: var(--au-space-5, 20px);
      height: var(--au-space-5, 20px);
      flex-shrink: 0;
      border: 0;
      padding: 0;
      border-radius: var(--au-radius-chip,6px);
      outline: 1px solid transparent;
      color: var(--au-ink-4, #777);
      background: transparent;
      cursor: pointer;
      transition:
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    svg {
      width: var(--au-space-4, 16px);
      height: var(--au-space-4, 16px);
      display: block;
      /* Closed = pointing right (the base glyph). */
      transform: rotate(0deg);
      transition: transform var(--au-m-base,220ms) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1));
    }
    :host([open]) svg {
      /* Open = pointing down. */
      transform: rotate(90deg);
    }
    button:hover:not(:disabled),
    :host([data-force-hover]:not([disabled])) button {
      color: var(--au-ink-2, #c8c8c8);
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
    }
    button:active:not(:disabled),
    :host([data-force-active]:not([disabled])) button {
      background: var(--au-chrome-active, rgba(255, 255, 255, 0.075));
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
  `

  private onClick(e: MouseEvent): void {
    if (this.disabled) {
      e.stopImmediatePropagation()
      return
    }
    // The chevron signals via `au-activate` (composed), so its raw native click must NOT also bubble to
    // an enclosing header's own click handler — otherwise a header that toggles on BOTH the chevron's
    // au-activate AND its own click fires twice (a double toggle that reads as "nothing happens").
    e.stopPropagation()
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  render() {
    return html`
      <button
        part="button"
        type="button"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-label=${this.label?.trim() || (this.open ? 'Collapse' : 'Expand')}
        ?disabled=${this.disabled}
        @keydown=${(event: KeyboardEvent) => {
          // Keep native button activation separate from an enclosing tree's keyboard navigation.
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
        }}
        @click=${this.onClick}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          focusable="false"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4"></path>
        </svg>
      </button>
    `
  }
}
