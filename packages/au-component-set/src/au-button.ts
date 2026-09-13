// au-button is the default set's Lit shadow implementation. Shared design tokens style solid,
// ghost, outline, cta and danger variants. The component emits au-activate for consumer actions.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import { reducedControlMotion } from './control-motion'
export class AuButtonElement extends AuElement {
  // Delegate focus to the inner <button> so a consumer's `el.focus()` (e.g. a dialog focusing its
  // default action) reaches the real control. `:focus-visible` still gates the ring to keyboard focus.
  static shadowRootOptions = { ...AuElement.shadowRootOptions, delegatesFocus: true }
  static properties = {
    ariaLabel: { type: String, attribute: 'aria-label', reflect: true },
    ariaExpanded: { type: String, attribute: 'aria-expanded', reflect: true },
    ariaHasPopup: { type: String, attribute: 'aria-haspopup', reflect: true },
    ariaPressed: { type: String, attribute: 'aria-pressed', reflect: true },
    variant: { type: String, reflect: true },
    size: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    loading: { type: Boolean, reflect: true },
    icon: { type: String },
  }

  declare variant: 'solid' | 'ghost' | 'outline' | 'cta'
  declare size?: 'sm' | 'md' | 'lg'
  declare disabled: boolean
  declare loading: boolean
  declare icon?: string

  constructor() {
    super()
    // Render-resilience: a BARE `<au-button>` renders the quiet solid button. `variant` reflects, so
    // the host always carries a value the per-variant rules scope on (mirrors Button.tsx's `variant='solid'`).
    this.variant = 'solid'
    this.disabled = false
    this.loading = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: inline-flex;
      max-width: 100%;
      min-width: 0;
    }
    /* Base = the solid button (the quiet default). border-box keeps the 1px hairline off the height. */
    button {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--au-space-2, 8px);
      position: relative;
      min-height: calc(var(--au-space-1, 4px) * 8);
      max-width: 100%;
      min-width: 0;
      padding-block: var(--au-space-1, 4px);
      padding-inline: var(--au-space-3, 12px);
      border: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.14));
      border-radius: var(--au-radius-md, 8px);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base,20px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      white-space: normal;
      overflow-wrap: anywhere;
      user-select: none;
      -webkit-user-select: none;
      cursor: pointer;
      background: var(--au-color-surface-2, #2a2a2a);
      color: var(--au-ink-1, #e2dfda);
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }

    [part='label'] {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: inherit;
    }
    [part='icon'], slot[name='leading'], slot[name='trailing'] {
      flex-shrink: 0;
    }

    /* press — a restrained tactile give (transform only, all variants). */
    button:active,
    :host([data-force-active]) button {
      transform: scale(0.98);
    }
    @media (prefers-reduced-motion: reduce) {
      button:active,
      :host([data-force-active]) button {
        transform: none;
      }
    }

    /* ── solid (quiet default: base + [variant='solid']) ── */
    :host([variant='solid']) button:hover,
    :host([variant='solid'][data-force-hover]) button {
      background: var(--au-color-surface-3, #34343a);
      border-color: var(--au-line-3, rgba(255, 255, 255, 0.22));
    }
    :host([variant='solid']) button:active,
    :host([variant='solid'][data-force-active]) button {
      background: var(--au-color-surface-1, #202024);
    }

    /* ── ghost (chromeless) ── */
    :host([variant='ghost']) button {
      background: none;
      border-color: transparent;
      color: var(--au-ink-2, #d9d6cd);
    }
    :host([variant='ghost']) button:hover,
    :host([variant='ghost'][data-force-hover]) button {
      background: var(--au-chrome-hover, rgba(245, 243, 238, 0.045));
      color: var(--au-ink-1, #e2dfda);
    }
    :host([variant='ghost']) button:active,
    :host([variant='ghost'][data-force-active]) button {
      background: var(--au-chrome-active, rgba(245, 243, 238, 0.075));
      color: var(--au-ink-1, #e2dfda);
    }

    /* ── outline (hairline only) ── */
    :host([variant='outline']) button {
      background: none;
      border-color: var(--au-line-2, rgba(255, 255, 255, 0.14));
      color: var(--au-ink-1, #e2dfda);
    }
    :host([variant='outline']) button:hover,
    :host([variant='outline'][data-force-hover]) button {
      background: var(--au-chrome-hover, rgba(245, 243, 238, 0.045));
      border-color: var(--au-line-3, rgba(255, 255, 255, 0.22));
    }
    :host([variant='outline']) button:active,
    :host([variant='outline'][data-force-active]) button {
      background: var(--au-chrome-active, rgba(245, 243, 238, 0.075));
    }

    /* ── cta (the one off-white loud button) ── */
    :host([variant='cta']) button {
      background: var(--au-cta-bg, #ededed);
      border-color: transparent;
      color: var(--au-cta-ink, #14141a);
    }
    :host([variant='cta']) button:hover,
    :host([variant='cta'][data-force-hover]) button {
      background: var(--au-cta-hover, #f5f5f5);
    }
    :host([variant='cta']) button:active,
    :host([variant='cta'][data-force-active]) button {
      background: var(--au-cta-pressed, #d8d8d8);
    }

    /* ── danger (destructive: danger ink on a hairline; fills danger on intent) ── */
    :host([variant='danger']) button {
      background: none;
      border-color: var(--au-color-danger, #fb817c);
      color: var(--au-color-danger, #fb817c);
    }
    :host([variant='danger']) button:hover,
    :host([variant='danger'][data-force-hover]) button {
      background: var(--au-color-danger, #fb817c);
      border-color: var(--au-color-danger, #fb817c);
      color: var(--au-cta-ink, #14141a);
    }
    :host([variant='danger']) button:active,
    :host([variant='danger'][data-force-active]) button {
      background: var(--au-color-danger, #fb817c);
      color: var(--au-cta-ink, #14141a);
    }

    /* ── size (base = md) ── */
    :host([size='sm']) button {
      min-height: calc(var(--au-space-1, 4px) * 7);
      padding-inline: var(--au-space-2, 8px);
      gap: var(--au-space-1, 4px);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    :host([size='lg']) button {
      min-height: calc(var(--au-space-1, 4px) * 10);
      padding-inline: var(--au-space-4, 16px);
      font-size: var(--au-t-body,16px);
      line-height: var(--au-lh-body,24px);
    }

    /* ── focus ── */
    button:focus-visible,
    :host([data-force-focus]) button {
      ${controlFocusStyle}
    }

    /* Inverse buttons need an indicator contrasting with their own bright fill. */
    :host([variant='cta']) button { --au-control-focus: var(--au-cta-ink); }

    /* ── disabled ── */
    :host([disabled]) button,
    :host([data-force-disabled]) button {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
      pointer-events: none;
    }

    /* ── loading (label hidden under a token-timed spinner) ── */
    :host([loading]) button,
    :host([data-force-loading]) button {
      cursor: progress;
      pointer-events: none;
    }
    :host([loading]) [part='label'],
    :host([loading]) [part='icon'],
    :host([loading]) ::slotted(*),
    :host([data-force-loading]) [part='label'],
    :host([data-force-loading]) [part='icon'],
    :host([data-force-loading]) ::slotted(*) {
      opacity: 0;
    }
    :host([loading]) button::after,
    :host([data-force-loading]) button::after {
      content: '';
      position: absolute;
      width: var(--au-t-base, 14px);
      height: var(--au-t-base, 14px);
      border-radius: 50%;
      border: 2px solid var(--au-line-3, rgba(255, 255, 255, 0.22));
      border-top-color: var(--au-ink-1, #e2dfda);
      animation: au-btn-spin var(--au-m-cinema,780ms) linear infinite;
    }
    :host([variant='cta'][loading]) button::after,
    :host([variant='cta'][data-force-loading]) button::after {
      border-color: var(--au-cta-pressed, #d8d8d8);
      border-top-color: var(--au-cta-ink, #14141a);
    }
    @keyframes au-btn-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `

  private onClick(e: MouseEvent): void {
    if (this.disabled || this.loading) {
      e.stopImmediatePropagation()
      return
    }
    // Composed + bubbling per the contract, so a consumer listens on the tag, not the shadow.
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  render() {
    return html`
      <button aria-label=${this.ariaLabel ?? nothing} aria-expanded=${this.ariaExpanded ?? nothing} aria-haspopup=${this.ariaHasPopup ?? nothing} aria-pressed=${this.ariaPressed ?? nothing} aria-busy=${this.loading ? 'true' : nothing} aria-disabled=${this.loading ? 'true' : nothing} part="button" type="button" ?disabled=${this.disabled} @click=${this.onClick}>
        ${this.icon ? html`<span part="icon" aria-hidden="true">${this.icon}</span>` : ''}
        <slot name="leading"></slot>
        <span part="label"><slot></slot></span>
        <slot name="trailing"></slot>
      </button>
    `
  }
}
