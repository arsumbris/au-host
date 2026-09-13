// <au-drop-zone> — the pane-drag landing indicator. An absolute overlay docked over the receiving
// slot: a hairline receiver frame + a directional ink-wash band that slides between the five zones on
// the transport ease. Monochrome; direction lives in the band's POSITION + a sheen leaning toward the
// docking edge, NEVER a colored bar.
//
// DISPLAY-ONLY + non-interactive (aria-hidden, pointer-events:none — the host resolves the target on
// the window above it). It emits no events. Mirrors the container substrate's DropZone vocabulary
// (`@arsumbris/au-host-sdk`, `src/container.ts`): top · right · bottom · left · center. Dock it over a
// positioned slot; drive `zone` as the drag moves. When `zone` clears (cursor between zones) the band
// HOLDS its last geometry and just fades, instead of snapping to a default.

import { reducedControlMotion } from './control-motion'
import { css, html } from 'lit'
import { AuElement } from './au-element'

type Zone = 'center' | 'top' | 'right' | 'bottom' | 'left'

const DEFAULT_LABELS: Record<Zone, string> = {
  top: 'Split up',
  right: 'Split right',
  bottom: 'Split down',
  left: 'Split left',
  center: 'Add tab',
}

const SHEEN: Record<Zone, string> = {
  top: 'to top',
  right: 'to right',
  bottom: 'to bottom',
  left: 'to left',
  center: 'to bottom',
}

// Percentages, mirroring the host's RectBandPreview geometry.
function bandRect(zone: Zone, e: number): { left: number; top: number; width: number; height: number } {
  const pct = e * 100
  switch (zone) {
    case 'top':
      return { left: 0, top: 0, width: 100, height: pct }
    case 'bottom':
      return { left: 0, top: 100 - pct, width: 100, height: pct }
    case 'left':
      return { left: 0, top: 0, width: pct, height: 100 }
    case 'right':
      return { left: 100 - pct, top: 0, width: pct, height: 100 }
    case 'center':
      return { left: 25, top: 25, width: 50, height: 50 }
  }
}

export class AuDropZoneElement extends AuElement {
  static properties = {
    zone: { type: String, reflect: true },
    active: { type: Boolean, reflect: true },
    label: { type: Boolean },
    edgeRatio: { type: Number, attribute: 'edge-ratio' },
    radius: { type: String },
  }

  declare zone?: Zone
  declare active: boolean
  declare label: boolean
  declare edgeRatio: number
  declare radius: string

  // Remember the last real zone so the band HOLDS its geometry and just fades when `zone` clears
  // (cursor between zones), instead of snapping back to a default position.
  #lastZone: Zone = 'center'

  constructor() {
    super()
    this.active = true
    this.label = true
    this.edgeRatio = 0.25
    this.radius = 'var(--au-radius-md, 8px)'
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      position: absolute;
      inset: 0;
      z-index: var(--au-z-raised, 10);
      /* The preview never eats pointer events — the host resolves the target on the window above it. */
      pointer-events: none;
      border-radius: var(--_radius, var(--au-radius-md, 8px));
      animation: au-dropzone-in var(--au-m-fast,160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) both;
    }
    :host([data-hidden]) {
      display: none;
    }
    @keyframes au-dropzone-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    /* receiver frame: a full inset hairline around the WHOLE slot (never a leading edge bar). */
    .frame {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--au-ink-1, #e8e8e8) 24%, transparent);
      background: color-mix(in oklab, var(--au-ink-1, #e8e8e8) 3%, transparent);
    }
    /* directional band: the highlighted quarter / half. Position + size arrive inline (percent) and
     * TRANSITION on the transport ease, so the band glides + resizes between zones. */
    .band {
      container-type: size;
      position: absolute;
      border-radius: var(--au-radius-sm,5px);
      box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--au-ink-1, #e8e8e8) 42%, transparent);
      background: linear-gradient(
        var(--_sheen, to bottom),
        color-mix(in oklab, var(--au-ink-1, #e8e8e8) 16%, transparent),
        color-mix(in oklab, var(--au-ink-1, #e8e8e8) 6%, transparent)
      );
      opacity: 0;
      transition:
        left var(--au-m-base,220ms) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1)),
        top var(--au-m-base,220ms) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1)),
        width var(--au-m-base,220ms) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1)),
        height var(--au-m-base,220ms) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1)),
        opacity var(--au-m-fast,160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1));
    }
    .band[data-visible='true'] {
      opacity: 1;
    }
    /* center = wrap-into-tabs: a soft radial glow instead of an edge-leaning sheen. */
    .band[data-zone='center'] {
      background: radial-gradient(
        120% 120% at 50% 50%,
        color-mix(in oklab, var(--au-ink-1, #e8e8e8) 15%, transparent),
        color-mix(in oklab, var(--au-ink-1, #e8e8e8) 5%, transparent)
      );
    }
    /* Action caption: compact UI text on a quiet surface inside the landing. */
    .label {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      opacity: 0;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1));
    }
    .label[data-visible='true'] {
      opacity: 1;
    }
    /* Keep tiny directional bands quiet rather than stacking letters. */
    @container (max-width: 96px) {
      .label { display: none; }
    }
    .label-text {
      font-family: var(--au-font-sans);
      font-size: var(--au-t-xs, 12px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: normal;
      color: var(--au-ink-2, #c8c8c8);
      padding: var(--au-space-1, 4px) var(--au-space-2, 8px);
      border-radius: var(--au-radius-sm,5px);
      background: var(--au-elev-4-fill, #22262f);
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
      max-width: calc(100% - var(--au-space-4, 16px));
      box-sizing: border-box;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: var(--au-lh-xs, 16px);
      white-space: nowrap;
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('aria-hidden', 'true')
  }

  updated(): void {
    // Host-level reflections that don't belong in the pure render(): the hidden toggle + the radius var.
    this.toggleAttribute('data-hidden', !this.active)
    this.style.setProperty('--_radius', this.radius)
  }

  render() {
    // `active` false → render nothing (the overlay is absent while no drag is in flight).
    if (!this.active) return html``

    if (this.zone) this.#lastZone = this.zone
    const shown = this.zone ?? this.#lastZone
    const rect = bandRect(shown, this.edgeRatio)
    const text = DEFAULT_LABELS[shown]
    const visible = this.zone ? 'true' : 'false'

    return html`
      <div class="frame" part="frame"></div>
      <div
        class="band"
        part="band"
        data-visible=${visible}
        data-zone=${shown}
        style="left:${rect.left}%;top:${rect.top}%;width:${rect.width}%;height:${rect.height}%;--_sheen:${SHEEN[
          shown
        ]}"
      >
      ${this.label
        ? html`<div class="label" part="label" data-visible=${visible}>
            <span class="label-text"><slot>${text}</slot></span>
          </div>`
        : html``}
      </div>
    `
  }
}
