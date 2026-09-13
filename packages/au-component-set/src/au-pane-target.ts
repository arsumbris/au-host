// <au-pane-target> — a pane offered as a SELECTION target. The sibling of <au-drop-zone>: where the
// drop-zone marks where a dragged pane would LAND (directional, non-interactive, host-resolved above it),
// this marks a pane the user can PICK — the spatial presentation of the host chooser's CHOOSE strategy
// (dock "into which container?", and, later, any ambiguous ambient intent).
//
// An absolute overlay docked over the candidate pane's rect (the host positions :host from a live
// getBoundingClientRect). A receiver frame in the drop-zone's own vocabulary (a full inset hairline + a
// soft ink fill), a resting and a highlighted (`active`) state, an optional keyboard letter HINT (an
// <au-kbd> keycap, top-left) and an optional caption LABEL (a quiet mono chip, centered). Unlike the
// drop-zone it is INTERACTIVE: pointer-events on, hover lifts the frame, a click emits `au-activate`.
// TOKEN-ONLY, base `--au-*` with literal floors, derived token-for-token from <au-drop-zone> +
// <au-menu-item> so the affordance reads coherently with the drag + menu families.

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'

export class AuPaneTargetElement extends AuElement {
  static properties = {
    active: { type: Boolean, reflect: true },
    hint: { type: String },
    label: { type: String },
    disabled: { type: Boolean, reflect: true },
  }

  declare active: boolean
  declare hint?: string
  declare label?: string
  declare disabled: boolean

  constructor() {
    super()
    this.active = false
    this.disabled = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      position: absolute;
      box-sizing: border-box;
      pointer-events: auto;
      cursor: pointer;
      border-radius: var(--au-radius-md, 8px);
      animation: au-pane-target-in var(--au-m-fast,160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) both;
    }
    :host([disabled]) {
      pointer-events: none;
      cursor: default;
      opacity: var(--au-opacity-disabled, 0.5);
    }
    @keyframes au-pane-target-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    /* receiver frame: a full inset hairline around the WHOLE pane + a soft ink fill — the drop-zone's
       resting-frame vocabulary. */
    .frame {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--au-ink-1, #e8e8e8) 24%, transparent);
      background: color-mix(in oklab, var(--au-ink-1, #e8e8e8) 3%, transparent);
      transition:
        box-shadow var(--au-m-fast,160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)),
        background var(--au-m-fast,160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1));
    }
    /* Hover follows the shared interactive chrome role. */
    :host(:hover) .frame {
      box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--au-ink-1, #e8e8e8) 42%, transparent);
      background: var(--au-chrome-hover);
    }
    /* Keyboard/arrow highlight retains its ring with the shared active wash. */
    :host([active]) .frame {
      box-shadow: inset 0 0 0 2px var(--au-color-accent, #6dbbec);
      background: var(--au-chrome-active);
    }
    /* Letter hint: an <au-kbd> keycap pinned top-left maps each key to a pane. */
    .hint {
      position: absolute;
      top: var(--au-space-2, 8px);
      left: var(--au-space-2, 8px);
      pointer-events: none;
    }
    /* caption: a quiet mono chip centered over the pane, naming what picking does (the drop-zone label). */
    .label {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      pointer-events: none;
    }
    .label-text {
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: 1;
      letter-spacing: var(--au-ls-label,0.08em);
      color: var(--au-ink-2, #c8c8c8);
      padding: var(--au-space-1, 4px) var(--au-space-2, 8px);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-elev-4-fill, #22262f);
      box-shadow:
        var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09)),
        var(--au-sh-header,0 1px 0 rgba(245, 243, 238, 0.06), 0 8px 24px -16px rgba(0, 0, 0, 0.4));
      white-space: nowrap;
    }
  `

  private onClick(): void {
    if (this.disabled) return
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  render() {
    return html`
      <div class="frame" part="frame" @click=${this.onClick}></div>
      ${this.hint != null && this.hint !== ''
        ? html`<au-kbd class="hint" part="hint">${this.hint}</au-kbd>`
        : nothing}
      ${this.label != null && this.label !== ''
        ? html`<div class="label" part="label"><span class="label-text">${this.label}</span></div>`
        : nothing}
    `
  }
}
