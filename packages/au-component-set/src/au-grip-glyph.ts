// <au-grip-glyph> — the default set's Lit SHADOW implementation of the `au-grip-glyph` contract.
//
// The ⠿ drag-handle affordance on a pane / tab / region label bar. STATELESS: the container wires the
// pointer drag on it (or a parent); this renders the six-dot glyph and its idle / hover / active /
// dragging visuals. DECORATIVE by default (`aria-hidden`) — a caller that binds the drag directly
// gives it a `label`, which makes it the named control (column / sandwich, where the grip is the ONLY
// drag source and hiding it would strand assistive tech). The ARIA is the signal.
//
// Shared spacing and ink roles provide its hit area and feedback; local --au-grip-w/h hooks let a
// composing tab tighten the box. The small six-dot mark keeps chrome visually light.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { controlFocusStyle } from './focus-style'
export class AuGripGlyphElement extends AuElement {
  static properties = {
    dragging: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    label: { type: String },
  }

  declare dragging: boolean
  declare disabled: boolean
  declare label?: string

  constructor() {
    super()
    // Render-resilience: a bare <au-grip-glyph> renders sensibly.
    this.dragging = false
    this.disabled = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: inline-grid;
      place-items: center;
      /* A composing parent (au-tab-strip-cell) tightens the box across the shadow via these vars —
         an inheriting custom property pierces the boundary where an external type selector cannot. */
      width: var(--au-grip-w, var(--au-space-5, 20px));
      height: var(--au-grip-h, var(--au-space-6, 24px));
      flex-shrink: 0;
      border-radius: var(--au-radius-chip,6px);
      color: var(--au-ink-3, #888);
      background: transparent;
      cursor: grab;
      touch-action: none;
      user-select: none;
      transition:
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host(:focus-visible) { ${controlFocusStyle} color: var(--au-ink-1); }
    :host([role='button']) {
      width: max(24px, var(--au-grip-w, var(--au-space-5, 20px)));
      height: max(24px, var(--au-grip-h, var(--au-space-6, 24px)));
      min-width:24px;
      min-height:24px;
    }
    @media (pointer: coarse) { :host, :host([role='button']) { min-width:44px; min-height:44px; } }
    svg {
      width: var(--au-space-4, 16px);
      height: var(--au-space-4, 16px);
      display: block;
    }
    :host(:hover),
    :host([data-force-hover]) {
      color: var(--au-ink-2, #c8c8c8);
      background: transparent;
    }
    :host(:active),
    :host([data-force-active]) {
      color: var(--au-ink-1, #ededed);
      background: transparent;
      cursor: grabbing;
    }
    :host([dragging]),
    :host([data-force-locked]) {
      color: var(--au-ink-1, #ededed);
      background: transparent;
      box-shadow: none;
      cursor: grabbing;
    }
    :host([disabled]),
    :host([data-force-disabled]) {
      color: var(--au-ink-5, #555);
      background: transparent;
      cursor: default;
    }
  `

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.label?.trim() || this.disabled || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    event.stopPropagation()
    this.click()
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (!this.disabled) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('keydown', this.onKey)
    this.addEventListener('click', this.onClick, true)
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKey)
    this.removeEventListener('click', this.onClick, true)
    super.disconnectedCallback()
  }

  updated(): void {
    // Decorative unless the caller NAMES it (a container binding the drag directly). Keyed on the ARIA — a `label` promotes it to the named control.
    const label = this.label?.trim()
    if (label) {
      this.setAttribute('role', 'button')
      this.setAttribute('aria-label', label)
      this.removeAttribute('aria-hidden')
      this.tabIndex = this.disabled ? -1 : 0
      this.setAttribute('aria-disabled', String(this.disabled))
    } else {
      // label cleared → decorative again: drop the role/aria-label WE set (a set-then-cleared label must
      // not leave a stale named control). An EXTERNAL aria-labelledby still names it, so only hide when
      // that is absent too. Mirrors au-status-dot's else branch.
      this.removeAttribute('tabindex')
      this.removeAttribute('aria-disabled')
      this.removeAttribute('role')
      this.removeAttribute('aria-label')
      if (this.hasAttribute('aria-labelledby')) this.removeAttribute('aria-hidden')
      else this.setAttribute('aria-hidden', 'true')
    }
  }

  render() {
    return html`
      <svg viewBox="0 0 16 16" fill="currentColor" focusable="false" aria-hidden="true">
        <circle cx="6" cy="5" r="0.9"></circle>
        <circle cx="6" cy="8" r="0.9"></circle>
        <circle cx="6" cy="11" r="0.9"></circle>
        <circle cx="10" cy="5" r="0.9"></circle>
        <circle cx="10" cy="8" r="0.9"></circle>
        <circle cx="10" cy="11" r="0.9"></circle>
      </svg>
    `
  }
}
