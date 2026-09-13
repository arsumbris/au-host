// <au-swatch> — the default set's Lit SHADOW implementation of the `au-swatch` contract.
//
// A token-value colour chip. The FILL is the ONLY colour — it carries the value being shown (DATA);
// everything else is token chrome. A hairline ring (the elevation `-line` recipe, the sanctioned 1px
// exception) keeps a pale swatch edged on a pale surface. `alpha0` reveals a checker under
// the dimmed fill so a transparent / alpha-0 value reads as "no paint" rather than as the surface
// behind it. An optional mono `label` renders a value read-out beneath the chip. TOKEN-ONLY.
//
// NOTE: the transparent-checker prop is `alpha0`, NOT `hidden` — a `hidden` property would reflect to
// the global `hidden` attribute and the browser would collapse the whole element.

import { css, html } from 'lit'
import { AuElement } from './au-element'

export class AuSwatchElement extends AuElement {
  static properties = {
    value: { type: String },
    size: { type: String, reflect: true },
    alpha0: { type: Boolean, reflect: true },
    label: { type: String },
  }

  declare value?: string
  declare size?: 'md' | 'sm' | 'lg'
  declare alpha0: boolean
  declare label?: string

  constructor() {
    super()
    this.alpha0 = false
  }

  static styles = css`
    :host {
      display: inline-block;
      max-width: 100%;
    }
    .chip {
      --_d: var(--au-space-4, 16px);
      display: inline-block;
      width: var(--_d);
      height: var(--_d);
      flex: 0 0 auto;
      border-radius: var(--au-radius-chip,6px);
      position: relative;
      overflow: hidden;
      background: conic-gradient(
        var(--au-color-surface-3, #2a2d33) 25%,
        var(--au-color-surface-1, #191b1f) 0 50%,
        var(--au-color-surface-3, #2a2d33) 0 75%,
        var(--au-color-surface-1, #191b1f) 0
      ) 0 0 / var(--au-space-2, 8px) var(--au-space-2, 8px);
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14));
      box-sizing: border-box;
    }
    :host([size='sm']) .chip {
      --_d: var(--au-space-3, 12px);
    }
    :host([size='lg']) .chip {
      --_d: var(--au-space-6, 24px);
    }
    .chip::before {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--_fill, transparent);
      border-radius: inherit;
      box-shadow: inherit;
    }
    :host([alpha0]) .chip::before { opacity: 0.25; }
    .labeled {
      display: inline-flex;
      flex-direction: column;
      gap: var(--au-space-0-5, 2px);
      min-width: 0;
      max-width: 100%;
    }
    .value {
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-2xs,11px);
      color: var(--au-ink-4, #777);
      letter-spacing: var(--au-ls-mono,-0.005em);
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
  `

  render() {
    const chip = html`<span
      class="chip"
      part="chip"
      aria-hidden="true"
      style="--_fill: ${this.value ?? 'transparent'}"
    ></span>`
    if (this.label == null) return chip
    return html`<span class="labeled">
      ${chip}<span class="value" part="value">${this.label}</span>
    </span>`
  }
}
