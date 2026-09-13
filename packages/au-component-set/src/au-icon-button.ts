// au-icon-button is the default set's Lit shadow implementation.
// It uses inherited @arsumbris/style tokens with literal fallback values for standalone rendering.

import { css, html, type PropertyValues } from 'lit'
import { ifDefined } from 'lit/directives/if-defined.js'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import { reducedControlMotion } from './control-motion'
export class AuIconButtonElement extends AuElement {
  static shadowRootOptions = { ...AuElement.shadowRootOptions, delegatesFocus: true }
  static properties = {
    ariaLabel: { type: String, attribute: 'aria-label', reflect: true },
    ariaHasPopup: { type: String, attribute: 'aria-haspopup', reflect: true },
    ariaExpanded: { type: String, attribute: 'aria-expanded', reflect: true },
    ariaPressed: { type: String, attribute: 'aria-pressed', reflect: true },
    label: { type: String },
    size: { type: String, reflect: true },
    surface: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
  }

  declare label?: string
  declare size?: 'xs' | 'sm' | 'md' | 'lg'
  declare surface?: 'chrome' | 'panel'
  declare disabled: boolean

  constructor() {
    super()
    // Render-resilience: a BARE <au-icon-button> (e.g. in the gallery) renders sensibly.
    this.disabled = false
  }

  updated(changed: PropertyValues): void {
    // Surface the accessible name as a hover TOOLTIP. The visible affordance is a glyph, so `label` is
    // the only name the button carries; AuElement's title-driver shows an <au-tooltip> from the host
    // `title`, so mirroring `label` → `title` gives every icon-button a tooltip for free, from the name
    // it already declares — no per-call-site `title`. (`label` also stays the internal `aria-label`.)
    if (changed.has('label') || changed.has('ariaLabel')) {
      const name = this.ariaLabel ?? this.label
      if (name) this.setAttribute('title', name)
      else this.removeAttribute('title')
    }
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: inline-flex;
    }
    button {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: calc(var(--au-space-1, 4px) * 8);
      height: calc(var(--au-space-1, 4px) * 8);
      padding: 0;
      border: 0;
      border-radius: var(--au-radius-md,8px);
      background: none;
      color: var(--au-ink-3, #a09c92);
      cursor: pointer;
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }

    /* ── size ── */
    :host([size='xs']) button {
      width: calc(var(--au-space-1, 4px) * 6);
      height: calc(var(--au-space-1, 4px) * 6);
      border-radius: var(--au-radius-chip,6px);
    }
    :host([size='sm']) button {
      width: calc(var(--au-space-1, 4px) * 7);
      height: calc(var(--au-space-1, 4px) * 7);
    }
    :host([size='lg']) button {
      width: calc(var(--au-space-1, 4px) * 10);
      height: calc(var(--au-space-1, 4px) * 10);
    }

    button[aria-pressed='true'] {
      background: var(--au-chrome-active, rgba(245, 243, 238, 0.075));
      color: var(--au-ink-1, #e2dfda);
      box-shadow: var(--au-elev-3-line, inset 0 0 0 1px rgba(245, 243, 238, 0.055));
    }

    /* ── hover / active (real pseudos + gallery data-force-* twins on the host) ── */
    button:hover,
    :host([data-force-hover]) button {
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
      color: var(--au-ink-1, #e2dfda);
    }
    button:active,
    :host([data-force-active]) button {
      background: var(--au-chrome-active, rgba(245, 243, 238, 0.075));
      color: var(--au-ink-1, #e2dfda);
      transform: scale(0.98);
    }
    :host([surface='panel']) button:hover,
    :host([surface='panel'][data-force-hover]) button {
      background: var(--au-color-surface-3, #333);
    }
    :host([surface='panel']) button:active,
    :host([surface='panel'][data-force-active]) button {
      background: var(--au-color-surface-2, #2a2a2a);
    }

    /* ── focus ── */
    button:focus-visible,
    :host([data-force-focus]) button {
      ${controlFocusStyle}
    }

    /* ── disabled ── */
    :host([disabled]) button,
    :host([data-force-disabled]) button {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
      pointer-events: none;
    }

    /* ── reduced motion: drop the press give ── */
    @media (prefers-reduced-motion: reduce) {
      button:active,
      :host([data-force-active]) button {
        transform: none;
      }
    }
  `

  private onClick(e: MouseEvent): void {
    if (this.disabled) {
      e.stopImmediatePropagation()
      return
    }
    // Composed + bubbling per the contract, so a consumer listens on the tag, not the shadow.
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  render() {
    return html`
      <button
        part="button"
        type="button"
        aria-label=${this.ariaLabel ?? this.label ?? ''}
        aria-haspopup=${ifDefined(this.ariaHasPopup ?? undefined)}
        aria-expanded=${ifDefined(this.ariaExpanded ?? undefined)}
        aria-pressed=${ifDefined(this.ariaPressed ?? undefined)}
        ?disabled=${this.disabled}
        @click=${this.onClick}
      >
        <slot></slot>
      </button>
    `
  }
}
