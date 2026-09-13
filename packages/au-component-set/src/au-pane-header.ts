// <au-pane-header> — the default set's Lit SHADOW implementation of the `au-pane-header` contract.
//
// A shared header with leading, title, center and action regions. The center can host a scrolling
// tab strip. Panel and rail headers share compact geometry; the enclosing frame owns the boundary.
// Empty slots reserve no space. Controls retain their own interaction and focus treatment.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import './au-grip-glyph'

export class AuPaneHeaderElement extends AuElement {
  static properties = {
    compact: { type: Boolean, reflect: true },
    context: { type: String },
    surface: { type: String, reflect: true },
    focused: { type: Boolean, reflect: true },
    divider: { type: Boolean, reflect: true },
    draggable: { type: Boolean, reflect: true },
    _has: { state: true },
    _controlFocus: { type: Boolean, attribute: 'data-control-focus', reflect: true },
  }

  declare compact: boolean
  declare context?: string
  declare surface?: 'panel' | 'rail'
  declare focused: boolean
  declare divider: boolean
  declare draggable: boolean
  declare _has: { leading: boolean; title: boolean; center: boolean; actions: boolean }
  declare _controlFocus: boolean

  constructor() {
    super()
    this.compact = false
    this.surface = 'panel'
    this.focused = false
    this.divider = false
    this.draggable = false
    this._controlFocus = false
    this._has = { leading: false, title: false, center: false, actions: false }
  }

  static styles = css`
    :host {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      flex-direction: column;
      justify-content: center;
      position: relative;
      width: 100%;
      min-width: 0;
      min-height: var(--au-tabs-h, 36px);
      flex-shrink: 0;
      padding-block: var(--au-space-0-5, 2px);
      padding-inline: var(--au-space-2, 8px);
      --au-close-size: var(--au-space-6, 24px);
      color: var(--au-ink-2, #c8c8c8);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
    }
    .row {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--au-space-1-5, 6px);
      width: 100%;
      min-width: 0;
    }
    /* The frame gutter reveals a real row: its height participates in layout, so the
       next frame moves with it. Each enclosing frame supplies only its own disclosure state. */
    :host([compact]) {
      min-height: 0;
      height: var(--au-nesting-header-height, var(--au-nesting-hover-height, 0px));
      padding: 0;
      overflow: hidden;
      transition: height var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([compact]:focus-within) { height: var(--au-row-h, 32px); }
    :host([compact]) .row {
      position: absolute;
      inset-inline: 0;
      top: 0;
      width: auto;
      min-height: var(--au-row-h, 32px);
      padding: var(--au-space-1, 4px) var(--au-space-2, 8px);
      background: transparent;
      opacity: var(--au-nesting-row-opacity, var(--au-nesting-hover-opacity, 0));
      pointer-events: var(--au-nesting-row-events, var(--au-nesting-hover-events, none));
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([compact]:focus-within) .row { opacity: 1; pointer-events: auto; }
    :host([compact]) .title {
      font-size: var(--au-t-xs, 12px);
      font-weight: var(--au-w-body, 400);
      color: var(--au-ink-2, #c8c8c8);
    }
    :host([compact][surface="rail"]) { height: var(--au-row-h, 32px); }
    :host([compact][surface="rail"]) .row {
      top: 0;
      inset-inline: 0;
      opacity: 1;
      pointer-events: auto;
      background: transparent;
      border: 0;
    }
    .context {
      gap: var(--au-space-1-5, 6px);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      align-self: stretch;
      flex-shrink: 0;
      height: var(--au-nesting-header-height, var(--au-nesting-hover-height, 0px));
      overflow: hidden;
      color: var(--au-ink-2, #c8c8c8);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs, 16px);
      opacity: var(--au-nesting-row-opacity, var(--au-nesting-hover-opacity, 0));
      user-select: none;
      transition: height var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([data-control-focus]) .context { height: var(--au-row-h, 32px); opacity: 1; }
    .lead {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      opacity: 0.45;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host(:hover) .lead,
    :host(:focus-within) .lead {
      opacity: 1;
    }
    .title {
      min-width: 0;
      flex-shrink: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      color: var(--au-ink-2, #c8c8c8);
    }
    .divider {
      flex: 0 0 auto;
      align-self: center;
      width: 1px;
      height: var(--au-space-4, 16px);
      background: var(--au-line-1, rgba(255, 255, 255, 0.09));
    }
    .center {
      display: flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      flex: 1 1 0%;
      min-width: 0;
      height: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .center ::slotted(*) {
      flex: 1 1 auto;
      min-width: 0;
    }
    .center::-webkit-scrollbar {
      display: none;
    }
    :host(:hover) .context,
    :host(:focus-within) .context { color: var(--au-ink-2, #c8c8c8); }
    .actions {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      flex-shrink: 0;
    }
    ::slotted([slot='actions']) {
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
    }
    @media (hover: none) {
      .lead, .actions { opacity: 1; }
      :host([compact]) { height: var(--au-row-h, 32px); }
      :host([compact]) .row { opacity: 1; pointer-events: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .lead, .actions, .context, :host([compact]), :host([compact]) .row { transition: none; } }
  `

  private recomputeSlots = (): void => {
    const named = (name: string): boolean => !!this.querySelector(`:scope > [slot="${name}"]`)
    const center = Array.from(this.childNodes).some(
      (n) =>
        (n.nodeType === Node.ELEMENT_NODE && !(n as Element).getAttribute('slot')) ||
        (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== ''),
    )
    this._has = { leading: named('leading'), title: named('title'), center, actions: named('actions') }
  }

  connectedCallback(): void {
    super.connectedCallback()
    queueMicrotask(this.recomputeSlots)
  }

  private onControlFocus = (event: FocusEvent): void => {
    const path = event.composedPath()
    this._controlFocus = ['leading', 'actions'].some(slot =>
      [...this.querySelectorAll(`:scope > [slot="${slot}"]`)].some(node => path.includes(node)),
    )
      && path[0] instanceof Element && path[0].matches(':focus-visible')
  }

  render() {
    const hide = 'display:none'
    const leading = html`<div class="lead" style=${this.draggable || this._has.leading ? '' : hide}>
      <slot name="leading" @slotchange=${this.recomputeSlots}>
        ${this.draggable ? html`<au-grip-glyph></au-grip-glyph>` : null}
      </slot>
    </div>`
    const actions = html`<div class="actions" style=${this._has.actions ? '' : hide}>
      <slot name="actions" @slotchange=${this.recomputeSlots}></slot>
    </div>`
    return html`
      ${this.context ? html`<div class="context" @focusin=${this.onControlFocus} @focusout=${() => { this._controlFocus = false }}>
        <span class="title">${this.context}</span>
      </div>` : null}
      <div class="row" @focusin=${this.onControlFocus} @focusout=${() => { this._controlFocus = false }}>
        ${leading}
        ${this.context ? null : html`<span class="title" style=${this._has.title ? '' : hide}>
          <slot name="title" @slotchange=${this.recomputeSlots}></slot>
        </span>`}
        ${this.divider ? html`<span class="divider" aria-hidden="true"></span>` : null}
        <div class="center" style=${this._has.center ? '' : hide}>
          <slot @slotchange=${this.recomputeSlots}></slot>
        </div>
        ${actions}
      </div>
    `
  }
}
