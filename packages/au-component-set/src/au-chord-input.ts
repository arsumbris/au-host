// <au-chord-input> — a keybind CHORD-CAPTURE field. Focus it and press a shortcut; it canonicalizes the
// keydown (the SHARED au-host-sdk canonicalizer, so a captured chord matches what the dispatcher produces),
// shows it as an <au-kbd> chip, and emits `au-chord-change` with the structured keystroke record the keymap
// editor writes. While focused it marks itself `data-au-keycapture`, the GENERIC signal the keybind gate
// yields EVERY keystroke to (⌘S included) — it is rebinding, so the dispatcher must never fire the command
// being captured.
//
// Shortcut logic is the SDK's domain, not this swappable set's — so this ONE element reaches into
// `@arsumbris/au-host-sdk` (externalized at build, resolved to the one served instance at runtime, like the
// set already does for component-contract). The rest of the set stays generic and shortcut-agnostic.
//
// Captures a single keystroke: one chord step.
//
// TOKEN-ONLY: base `--au-*` with literal floors, mirroring au-input's field frame + focus ring.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import { reducedControlMotion } from './control-motion'
import { canonicalizeKeystroke, formatChord, type CanonicalKeystroke } from '@arsumbris/au-host-sdk'

export class AuChordInputElement extends AuElement {
  static properties = {
    // The current chord value — a list of keystroke records. A PROPERTY (complex data), never an attribute.
    chord: { attribute: false },
    placeholder: { type: String },
    disabled: { type: Boolean, reflect: true },
    // Internal: true while focused + accepting keys. Reflected so `:host([capturing])` can style, and
    // `data-au-keycapture` is derived from it in `updated()` (the gate's generic yield signal).
    capturing: { type: Boolean, reflect: true },
  }

  declare chord?: CanonicalKeystroke[]
  declare placeholder?: string
  declare disabled: boolean
  declare capturing: boolean

  constructor() {
    super()
    this.disabled = false
    this.capturing = false
  }

  connectedCallback(): void {
    super.connectedCallback()
    if (!this.hasAttribute('tabindex')) this.tabIndex = this.disabled ? -1 : 0
    this.setAttribute('role', 'textbox')
    this.addEventListener('focus', this.onFocus)
    this.addEventListener('blur', this.onBlur)
    this.addEventListener('keydown', this.onKeydown)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.removeEventListener('focus', this.onFocus)
    this.removeEventListener('blur', this.onBlur)
    this.removeEventListener('keydown', this.onKeydown)
  }

  private onFocus = (): void => {
    if (this.disabled) return
    this.capturing = true
  }

  private onBlur = (): void => {
    this.capturing = false
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (this.disabled || !this.capturing) return
    // Escape leaves capture without changing the value; Backspace/Delete clears it.
    if (e.key === 'Escape') {
      e.preventDefault()
      this.blur()
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      this.setChord([])
      return
    }
    const ks = canonicalizeKeystroke(e)
    if (!ks) return // a bare modifier / non-bindable key — hold for the real key
    e.preventDefault()
    this.setChord([ks]) // v1: a single keystroke is a complete chord
  }

  private setChord(chord: CanonicalKeystroke[]): void {
    this.chord = chord
    this.dispatchEvent(new CustomEvent('au-chord-change', { detail: { chord }, bubbles: true, composed: true }))
  }

  updated(): void {
    // Derive the gate's generic capture signal from `capturing` — a single source. The gate yields every
    // keystroke to a focused `[data-au-keycapture]` element (see the keybind gate).
    this.toggleAttribute('data-au-keycapture', this.capturing && !this.disabled)
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: inline-flex;
      outline: none;
      border-radius: var(--au-radius-md, 8px);
    }
    :host([disabled]) {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
    }
    .field {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      min-width: calc(var(--au-space-1, 4px) * 28);
      min-height: calc(var(--au-space-1, 4px) * 8);
      padding: 0 var(--au-space-3, 12px);
      border: 1px solid var(--au-line-control);
      border-radius: var(--au-radius-md, 8px);
      background: var(--au-color-surface-1, #1e2128);
      color: var(--au-ink-1, #ededed);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-base, 14px);
      line-height: var(--au-lh-base, 20px);
      transition: border-color var(--au-m-fast, 160ms) var(--au-e-std, cubic-bezier(0.2, 0, 0, 1));
    }
    :host(:hover) .field {
      border-color: var(--au-line-3, #4a4a4a);
    }
    :host([capturing]) .field {
      ${controlFocusStyle}
      border-color: var(--au-ink-4, #777);
    }
    .placeholder {
      color: var(--au-ink-4, #777);
    }
    :host([capturing]) .placeholder {
      color: var(--au-ink-2, #c8c8c8);
    }
  `

  render() {
    const has = !!this.chord && this.chord.length > 0
    return html`
      <div class="field" part="field">
        ${has
          ? html`<au-kbd class="chord" part="chord">${formatChord(this.chord!)}</au-kbd>`
          : html`<span class="placeholder" part="placeholder"
              >${this.capturing ? 'Press a shortcut…' : (this.placeholder ?? 'Set a shortcut')}</span
            >`}
      </div>
    `
  }
}
