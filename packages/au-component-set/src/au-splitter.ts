// <au-splitter> — the default set's Lit SHADOW implementation of the `au-splitter` contract.
//
// The resize-sash LOOK between two panes — the container owns the resize PHYSICS (pointer capture, width
// math), this renders the affordance. A transparent grab strip carrying a centered hairline that lifts to
// the accent on hover / drag, plus an optional knob (`hairline` mark, or a touch-sized `grab` slab that
// overflows the seam). `orientation` picks the col/row cursor; `dragging` freezes the lifted look;
// `disabled` faints the hairline and drops the knob. It is a `separator` for a11y.
//
// TOKEN-ONLY. The state hairline/knob/grip colours
// ride a `--au-splitter-*` var per posture, lifting to the accent on one shared state selector set.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
export class AuSplitterElement extends AuElement {
  static properties = {
    orientation: { type: String, reflect: true },
    dragging: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    knob: { type: Boolean },
    line: { type: Boolean },
    knobSize: { type: String, attribute: 'knob-size' },
  }

  declare orientation: 'vertical' | 'horizontal'
  declare dragging: boolean
  declare disabled: boolean
  declare knob: boolean
  declare line: boolean
  declare knobSize: 'hairline' | 'grab'

  constructor() {
    super()
    this.orientation = 'vertical'
    this.dragging = false
    this.disabled = false
    this.knob = true
    this.line = true
    this.knobSize = 'hairline'
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      position: relative;
      flex-shrink: 0;
      display: grid;
      place-items: center;
      border: 0;
      padding: 0;
      outline: 1px solid transparent;
      background: transparent;
      touch-action: none;
      --au-splitter-line: var(--au-line-2, rgba(255, 255, 255, 0.14));
      --au-splitter-knob: var(--au-ink-3, #888);
      --au-splitter-grip: color-mix(in oklab, var(--au-ink-1, #ededed) 45%, transparent);
    }
    :host([orientation='vertical']) {
      width: var(--au-pane-gap, 6px);
      align-self: stretch;
      cursor: col-resize;
    }
    :host([orientation='horizontal']) {
      height: var(--au-pane-gap, 6px);
      width: 100%;
      cursor: row-resize;
    }
    :host::before { content: ''; position: absolute; }
    :host([orientation='vertical'])::before { width: max(100%, var(--au-space-3, 12px)); height: 100%; }
    :host([orientation='horizontal'])::before { height: max(100%, var(--au-space-3, 12px)); width: 100%; }
    @media (pointer: coarse) {
      :host([orientation='vertical'])::before { min-width:24px; }
      :host([orientation='horizontal'])::before { min-height:24px; }
    }
    .line {
      opacity: 0;
      background: var(--au-splitter-line);
      border-radius: var(--au-radius-pill,99px);
      transition: background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)), opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([orientation='vertical']) .line {
      width: 1px;
      height: calc(100% - var(--au-space-4, 16px));
    }
    :host([orientation='horizontal']) .line {
      height: 1px;
      width: calc(100% - var(--au-space-4, 16px));
    }
    .knob {
      opacity: 0;
      position: absolute;
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-splitter-knob);
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([orientation='vertical']) .knob[data-knob-size='hairline'] {
      width: var(--au-space-0-5, 2px);
      height: var(--au-space-3, 12px);
    }
    :host([orientation='horizontal']) .knob[data-knob-size='hairline'] {
      height: var(--au-space-0-5, 2px);
      width: var(--au-space-3, 12px);
    }
    .knob[data-knob-size='grab'] {
      pointer-events: auto;
      cursor: inherit;
      display: grid;
      place-items: center;
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-elev-3-fill, var(--au-color-bg));
      box-shadow: inset 0 0 0 1px var(--au-splitter-grip);
    }
    .knob[data-knob-size='grab']::after {
      content: '';
      display: block;
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-splitter-knob);
    }
    :host([orientation='vertical']) .knob[data-knob-size='grab'] {
      width: var(--au-space-6, 24px);
      height: calc(var(--au-space-6, 24px) * 1.5);
    }
    :host([orientation='horizontal']) .knob[data-knob-size='grab'] {
      height: var(--au-space-6, 24px);
      width: calc(var(--au-space-6, 24px) * 1.5);
    }
    :host([orientation='vertical']) .knob[data-knob-size='grab']::after {
      width: var(--au-space-0-5, 2px);
      height: var(--au-space-3, 12px);
    }
    :host([orientation='horizontal']) .knob[data-knob-size='grab']::after {
      height: var(--au-space-0-5, 2px);
      width: var(--au-space-3, 12px);
    }
    :host(:hover),
    :host([data-force-hover]),
    :host(:active),
    :host([data-force-active]),
    :host([dragging]),
    :host([data-force-locked]) {
      --au-splitter-line: var(--au-accent-signal, #3b82f6);
      --au-splitter-knob: var(--au-accent-signal, #3b82f6);
      --au-splitter-grip: var(--au-accent-signal, #3b82f6);
    }
    :host(:hover) .line, :host(:focus-within) .line, :host([data-force-hover]) .line, :host([data-force-focus]) .line, :host([dragging]) .line { opacity: 1; }
    :host(:hover) .knob, :host(:focus-visible) .knob, :host([data-force-hover]) .knob, :host([data-force-focus]) .knob, :host([dragging]) .knob { opacity: 1; }
    :host(:active) .knob,
    :host([data-force-active]) .knob,
    :host([dragging]) .knob,
    :host([data-force-locked]) .knob {
      transform: scale(1.15);
    }
    :host(:focus-visible),
    :host([data-force-focus]) {
      outline: none;
      --au-splitter-knob: var(--au-focus-outer, #a09c92);
    }
    :host(:focus-visible)::after,
    :host([data-force-focus])::after {
      content: '';
      position: absolute;
      pointer-events: none;
      width: var(--au-space-1, 4px);
      height: var(--au-space-6, 24px);
      border-radius: var(--au-radius-pill, 99px);
      outline: 1px solid var(--au-focus-outer, #a09c92);
      outline-offset: -1px;
    }
    :host([orientation='horizontal']:focus-visible)::after,
    :host([orientation='horizontal'][data-force-focus])::after {
      width: var(--au-space-6, 24px);
      height: var(--au-space-1, 4px);
    }
    @media (forced-colors: active) { :host(:focus-visible)::after { outline-color: Highlight; } }
    :host([disabled]),
    :host([data-force-disabled]) {
      --au-splitter-line: var(--au-line-1, rgba(255, 255, 255, 0.09));
      cursor: default;
    }
    :host([disabled]) .knob,
    :host([data-force-disabled]) .knob {
      opacity: 0;
    }
  `

  updated(): void {
    // a11y is carried on the host (the separator).
    this.setAttribute('role', 'separator')
    this.setAttribute('aria-orientation', this.orientation)
    if (this.disabled) {
      this.setAttribute('aria-disabled', 'true')
      this.removeAttribute('tabindex')
    } else {
      this.removeAttribute('aria-disabled')
      this.setAttribute('tabindex', '0')
    }
  }

  render() {
    return html`
      ${this.line ? html`<span class="line" aria-hidden="true"></span>` : null}
      ${this.knob
        ? html`<span class="knob" data-knob-size=${this.knobSize} aria-hidden="true"></span>`
        : null}
    `
  }
}
