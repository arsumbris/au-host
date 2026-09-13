// <au-skeleton> — the default set's Lit SHADOW implementation of the `au-skeleton` contract.
//
// The calm loading placeholder: the silhouette of content that is coming. A skeleton is NEVER status,
// so NEVER hued and NEVER a leading accent bar. The fill is the neutral ink CHANNEL (--au-line-2), the
// moving sheen --au-line-2 — the same channel as the hairlines, so it stays grayscale in every preset.
// ONE shared transform-only highlight sweeps left→right (a translateX of a masked band, tokened
// duration/ease); reduced motion (and the `data-force-static` gallery twin) drop the sweep to a static
// dim. TOKEN-ONLY.
//
// variant `text` = a stack of pill line-bars (last line ragged); `block`/`rect` = a media box;
// `circle` = an avatar/dot. `label` promotes the root to an accessible loading region (role=status +
// aria-busy); without it the skeleton is decorative (aria-hidden).

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'

const RADIUS_TOKEN: Record<string, string> = {
  pill: 'var(--au-radius-pill,99px)',
  panel: 'var(--au-radius-panel,12px)',
  row: 'var(--au-radius-row, 8px)',
  chip: 'var(--au-radius-chip, 6px)',
  sm: 'var(--au-radius-sm,5px)',
  md: 'var(--au-radius-md, 8px)',
  none: '0',
}

// Subtle width raggedness for multi-line text — the last line is always the shortest.
const LINE_WIDTHS = ['100%', '92%', '97%', '89%', '95%']
const LAST_LINE_WIDTH = '58%'

function toLength(value: number | string | undefined): string | undefined {
  if (value == null) return undefined
  return typeof value === 'number' ? `${value}px` : value
}

export class AuSkeletonElement extends AuElement {
  static properties = {
    variant: { type: String, reflect: true },
    width: {},
    height: {},
    lines: { type: Number },
    radius: { type: String },
    label: { type: String },
  }

  declare variant: 'text' | 'block' | 'rect' | 'circle'
  declare width?: number | string
  declare height?: number | string
  declare lines: number
  declare radius?: 'pill' | 'panel' | 'row' | 'chip' | 'sm' | 'md' | 'none'
  declare label?: string

  constructor() {
    super()
    this.variant = 'text'
    this.lines = 1
  }

  updated(): void {
    // Labelled → an accessible loading region; unlabelled → decorative (kept out of the a11y tree).
    if (this.label != null && this.label !== '') {
      this.setAttribute('role', 'status')
      this.setAttribute('aria-busy', 'true')
      this.setAttribute('aria-label', this.label)
      this.removeAttribute('aria-hidden')
    } else {
      this.setAttribute('aria-hidden', 'true')
      this.removeAttribute('role')
      this.removeAttribute('aria-busy')
      this.removeAttribute('aria-label')
    }
  }

  static styles = css`
    :host {
      /* neutral ink-channel fill + sheen, calm sweep, avatar default. */
      --_fill: var(--au-line-2, rgba(255, 255, 255, 0.09));
      --_sheen: var(--au-line-2, rgba(255, 255, 255, 0.09));
      --_dur: calc(var(--au-m-cinema, 780ms) * 2);
      --_circle: calc(var(--au-space-1, 4px) * 7);
      display: block;
      min-width: 0;
      max-width: 100%;
    }
    .fill {
      position: relative;
      max-width: 100%;
      overflow: hidden;
      background: var(--_fill);
    }
    .fill::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent 0%, var(--_sheen) 50%, transparent 100%);
      transform: translateX(-100%);
      animation: au-skeleton-sweep var(--_dur) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1)) infinite;
    }
    @keyframes au-skeleton-sweep {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(100%);
      }
    }
    /* text — a stack of pill line-bars. */
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--au-space-2, 8px);
      width: 100%;
      min-width: 0;
    }
    .bar {
      height: var(--au-space-2, 8px);
      width: 100%;
      border-radius: var(--au-radius-pill,99px);
    }
    /* block / rect — image / thumbnail / media. */
    .shape[data-shape='block'] {
      width: 100%;
      height: calc(var(--au-space-1, 4px) * 16);
      border-radius: var(--au-radius-chip, 6px);
    }
    /* circle — avatar / badge / dot. */
    .shape[data-shape='circle'] {
      flex: none;
      width: var(--_circle);
      height: auto;
      aspect-ratio: 1;
      border-radius: var(--au-radius-pill,99px);
    }
    /* static twin — reduced motion, and the gallery's frozen preview. */
    @media (prefers-reduced-motion: reduce) {
      .fill::after {
        animation: none;
        opacity: 0;
      }
    }
    :host([data-force-static]) .fill::after {
      animation: none;
      opacity: 0;
    }
  `

  render() {
    const shape = this.variant === 'rect' ? 'block' : this.variant

    if (shape === 'text') {
      const count = Math.max(1, Number.isFinite(this.lines) ? Math.floor(this.lines) : 1)
      const widthProp = toLength(this.width)
      return html`
        <div class="stack" part="stack">
          ${Array.from({ length: count }, (_unused, i) => {
            const isLast = i === count - 1
            const barWidth =
              count === 1
                ? (widthProp ?? '100%')
                : isLast
                  ? LAST_LINE_WIDTH
                  : (widthProp ?? LINE_WIDTHS[i % LINE_WIDTHS.length])
            return html`<span class="fill bar" part="bar" style="width:${barWidth}"></span>`
          })}
        </div>
      `
    }

    let style = ''
    if (shape === 'circle') {
      const size = toLength(this.width ?? this.height)
      if (size) style = `width:${size};`
    } else {
      const w = toLength(this.width)
      const h = toLength(this.height)
      if (w) style += `width:${w};`
      if (h) style += `height:${h};`
      if (this.radius) style += `border-radius:${RADIUS_TOKEN[this.radius] ?? RADIUS_TOKEN.chip};`
    }
    return html`<div class="fill shape" part="shape" data-shape=${shape} style=${style || nothing}></div>`
  }
}
