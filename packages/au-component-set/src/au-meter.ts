// <au-meter> — the default set's Lit SHADOW implementation of the `au-meter` contract.
//
// A determinate progress / ratio bar: a token-height rounded TRACK (surface-3 + an inset hairline)
// holding an ink FILL sized by `value` (0..1). Monochrome by default — the fill is an ink tone, NOT
// an accent; a `tone` status re-tints the fill via color-mix OVER the status token (the au-status-dot
// technique) so it stays inside the palette family. It is a horizontal progress bar, NEVER a
// left-edge accent rail — no vertical accent border anywhere.
//
// `indeterminate` rides a token-eased sliding segment (transform ONLY); reduced-motion collapses it
// to a static resting segment (the pulse pattern). TOKEN-ONLY; the track hairline is the elevation
// LINE recipe, no raw values. An optional `label` (sans, muted) + `value-label` (mono, tabular)
// render above the track.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'

export class AuMeterElement extends AuElement {
  static properties = {
    value: { type: Number },
    label: { type: String },
    valueLabel: { type: String, attribute: 'value-label' },
    tone: { type: String, reflect: true },
    indeterminate: { type: Boolean, reflect: true },
  }

  declare value: number
  declare label?: string
  declare valueLabel?: string
  declare tone?: 'ok' | 'warn' | 'danger'
  declare indeterminate: boolean

  constructor() {
    super()
    this.value = 0
    this.indeterminate = false
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }
    .meter {
      --_h: calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px));
      display: flex;
      flex-direction: column;
      gap: var(--au-space-1, 4px);
      width: 100%;
      box-sizing: border-box;
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--au-space-2, 8px);
    }
    .label {
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--au-ink-3, #9a9a9a);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
    }
    .value {
      flex: 0 0 auto;
      max-width: 40%;
      min-width: 0;
      overflow-wrap: anywhere;
      text-align: end;
      color: var(--au-ink-4, #777);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-2xs,11px);
      line-height: var(--au-lh-2xs,16px);
      font-variant-numeric: tabular-nums;
      letter-spacing: var(--au-ls-mono,-0.005em);
      white-space: normal;
    }
    .track {
      position: relative;
      width: 100%;
      height: var(--_h);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-color-surface-3, #2a2d33);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      overflow: hidden;
    }
    .fill {
      position: relative;
      overflow: hidden;
      height: 100%;
      border-radius: inherit;
      --_paint: var(--au-ink-2, #c8c8c8);
      background: var(--_paint);
      transition:
        width var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([tone='ok']) .fill {
      --_paint: color-mix(in oklab, var(--au-color-ok, #76cd98) 90%, var(--au-ink-1, #eee));
    }
    :host([tone='warn']) .fill {
      --_paint: color-mix(in oklab, var(--au-color-warn, #e6b55d) 90%, var(--au-ink-1, #eee));
    }
    :host([tone='danger']) .fill {
      --_paint: color-mix(in oklab, var(--au-color-danger, #fb817c) 90%, var(--au-ink-1, #eee));
    }
    /* indeterminate — a fixed segment sliding across the track (transform ONLY). */
    :host([indeterminate]) .fill {
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      width: 40%;
      background: linear-gradient(100deg,
        color-mix(in oklab, var(--_paint) 65%, transparent),
        var(--_paint) 48%,
        color-mix(in oklab, var(--_paint) 85%, var(--au-ink-1, #eee)) 72%,
        var(--_paint));
      transform: translateX(-100%);
      transition: none;
      animation: au-meter-slide calc(var(--au-m-cinema,780ms) * 2) linear infinite;
    }
    /* Static grain travels with the segment; no animated filter or background repaint. */
    :host([indeterminate]) .fill::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.08;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Cpath fill='%23fff' filter='url(%23n)' d='M0 0h64v64H0z'/%3E%3C/svg%3E");
    }
    @keyframes au-meter-slide {
      0% {
        transform: translateX(-100%);
      }
      100% {
        transform: translateX(250%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .fill { transition: none; }
      :host([indeterminate]) .fill {
        animation: none;
        transform: translateX(75%);
        opacity: 0.7;
      }
    }
  `

  render() {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(this.value) ? this.value : 0))
    const hasHead = this.label !== undefined || this.valueLabel !== undefined
    return html`<div
      class="meter"
      part="meter"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="1"
      aria-valuenow=${this.indeterminate ? nothing : clamped}
      aria-valuetext=${this.valueLabel ?? nothing}
      aria-label=${this.label ?? nothing}
    >
      ${hasHead
        ? html`<div class="head" part="head">
            ${this.label !== undefined ? html`<span class="label" part="label">${this.label}</span>` : html`<span></span>`}
            ${this.valueLabel !== undefined
              ? html`<span class="value" part="value">${this.valueLabel}</span>`
              : nothing}
          </div>`
        : nothing}
      <div class="track" part="track">
        <div class="fill" part="fill" style=${this.indeterminate ? '' : `width: ${clamped * 100}%`}></div>
      </div>
    </div>`
  }
}
