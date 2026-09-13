// <au-toggle-chip> — the default set's Lit SHADOW implementation of the `au-toggle-chip` contract.
//
// An interactive FILTER chip: a toggleable pill (aria-pressed) carrying a tone + an optional count.
// The interactive sibling of the display-only au-chip. Each chip toggles independently, so a set of
// them is a MULTI-select facet filter (a severity facet, an origin-kind facet), distinct from the
// single-select au-segmented-control.
//
// A facet look: PRESSED (active) = a soft tone-tinted fill + tone text + tone border; UNPRESSED =
// muted hollow. The tone rides the au-status-dot `--_tone` variable, so ink/ok/warn/danger read the
// same as the status dot. TOKEN-ONLY, base `--au-*` tokens with literal floors.
//
// The whole element is a real inner <button>, so keyboard (Enter/Space), focus, and aria-pressed come
// for free. Emits `au-toggle` (detail `{ pressed }`, composed + bubbling) on activation.

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'

export class AuToggleChipElement extends AuElement {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLButtonElement>('button')?.focus(options)
  }
  static properties = {
    label: { type: String },
    tone: { type: String, reflect: true },
    count: { type: Number },
    pressed: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
  }

  declare label?: string
  declare tone?: 'ink' | 'ok' | 'warn' | 'danger'
  declare count?: number
  declare pressed: boolean
  declare disabled: boolean

  constructor() {
    super()
    this.pressed = false
    this.disabled = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: inline-block;
      max-width: 100%;
      min-width: 0;
    }
    button {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1-5, 6px);
      min-height: calc(var(--au-space-1, 4px) * 7);
      max-width: 100%;
      padding: var(--au-space-0-5, 2px) var(--au-space-2-5, 10px);
      border-radius: var(--au-radius-pill,99px);
      border: 1px solid var(--au-line-2);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      white-space: nowrap;
      /* the tone colour — neutral ink by default; a status tone overrides it below. */
      --_tone: var(--au-ink-2, #c8c8c8);
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    /* status/advisory tones — set --_tone; every state below reads it. */
    :host([tone='ok']) button {
      --_tone: var(--au-color-ok, #76cd98);
    }
    :host([tone='warn']) button {
      --_tone: var(--au-color-warn, #e6b55d);
    }
    :host([tone='danger']) button {
      --_tone: var(--au-color-danger, #fb817c);
    }
    /* UNPRESSED — a muted hollow chip: dim ink, faint border, no fill. */
    button {
      color: var(--au-ink-3);
      background: transparent;
    }
    button:enabled:hover {
      color: var(--au-ink-2, #c8c8c8);
      background: var(--au-chrome-hover);
      border-color: var(--au-line-3);
    }
    /* PRESSED (active facet) — a soft tone tint + tone text + tone border. */
    :host([pressed]) button {
      color: var(--_tone);
      background: color-mix(in oklab, var(--_tone) 12%, transparent);
      border-color: color-mix(in oklab, var(--_tone) 40%, transparent);
    }
    :host([pressed]) button:enabled:hover {
      background: color-mix(in oklab, var(--_tone) 18%, transparent);
      color: var(--_tone);
    }
    button:focus-visible {
      ${controlFocusStyle}
    }
    :host([disabled]) button {
      opacity: var(--au-opacity-disabled, 0.5);
      pointer-events: none;
      cursor: default;
    }
    .count {
      font-variant-numeric: tabular-nums;
      flex: 0 0 auto;
      opacity: 0.8;
      padding-inline-start: var(--au-space-1, 4px);
      border-inline-start: 1px solid var(--au-line-2);
    }
    [part='label'] { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  `

  private toggle(): void {
    if (this.disabled) return
    this.pressed = !this.pressed
    this.dispatchEvent(
      new CustomEvent('au-toggle', { detail: { pressed: this.pressed }, bubbles: true, composed: true }),
    )
  }

  render() {
    return html`
      <button
        type="button"
        part="chip"
        aria-pressed=${this.pressed ? 'true' : 'false'}
        title=${this.label ?? nothing}
        ?disabled=${this.disabled}
        @click=${this.toggle}
      >
        <span part="label">${this.label ?? ''}</span>
        ${this.count != null ? html`<span class="count" part="count">${this.count}</span>` : nothing}
      </button>
    `
  }
}
