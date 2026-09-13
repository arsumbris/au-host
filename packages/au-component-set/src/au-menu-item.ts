// au-menu-item is a row in a floating menu. Shared tokens define its surface, state wash and typography.

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'

export class AuMenuItemElement extends AuElement {
  static properties = {
    label: { type: String },
    description: { type: String },
    icon: { type: String },
    shortcut: { type: String },
    active: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    destructive: { type: Boolean, reflect: true },
    submenu: { type: Boolean, reflect: true },
  }

  declare label?: string
  declare description?: string
  declare icon?: string
  declare shortcut?: string
  declare active: boolean
  declare disabled: boolean
  declare destructive: boolean
  declare submenu: boolean

  constructor() {
    super()
    this.active = false
    this.disabled = false
    this.destructive = false
    this.submenu = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      /* The rounded inner item owns visible focus. Suppress the browser's second, square host outline. */
      outline: none;
    }
    .item {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      padding: var(--au-space-1, 4px) var(--au-space-3, 12px);
      border-radius: var(--au-radius-row, 8px);
      outline: 1px solid transparent;
      outline-offset: -1px;
      color: var(--au-ink-2, #d9d6cd);
      cursor: pointer;
      user-select: none;
      transition:
        background var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        outline-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    /* Hover — the soft wash lift. */
    :host(:hover) .item,
    :host([data-force-hover]) .item {
      color: var(--au-ink-1, #ededed);
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
    }
    /* Active (keyboard highlight / current row) — a firmer wash than hover. Roving native focus gets
       the same wash (the context-menu drives the highlight by focusing the row), plus the ring. */
    :host([active]) .item,
    :host([data-force-active]) .item,
    :host(:focus-visible) .item,
    :host([data-force-focus]) .item {
      color: var(--au-ink-1, #ededed);
      background: var(--au-chrome-active, rgba(255, 255, 255, 0.075));
    }
    :host(:focus-visible) .item,
    :host([data-force-focus]) .item {
      ${controlFocusStyle}
      /* Retain an opaque, legible ring while reducing the theme focus hue's intensity. */
      outline-color: color-mix(in oklab, var(--au-control-focus, var(--au-focus-outer)) 60%, var(--au-ink-3));
      @media (forced-colors: active) { outline-color: Highlight; }
    }
    :host([destructive]) .item {
      color: var(--au-color-danger, #fb817c);
    }
    :host([disabled]) .item {
      color: var(--au-ink-5, #3f3c36);
      background: transparent;
      cursor: not-allowed;
      pointer-events: none;
    }
    .icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      color: var(--au-ink-3, #8a8a8a);
    }
    :host(:hover) .icon,
    :host([active]) .icon,
    :host(:focus-visible) .icon,
    :host([data-force-hover]) .icon,
    :host([data-force-active]) .icon {
      color: var(--au-ink-1, #ededed);
    }
    .content {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .desc {
      color: var(--au-ink-4, #777);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .shortcut {
      flex: none;
      padding-left: var(--au-space-4, 16px);
      color: var(--au-ink-4, #777);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
    }
    :host(:hover) :is(.desc, .shortcut),
    :host([active]) :is(.desc, .shortcut),
    :host(:focus-visible) :is(.desc, .shortcut),
    :host([data-force-hover]) :is(.desc, .shortcut),
    :host([data-force-active]) :is(.desc, .shortcut),
    :host([data-force-focus]) :is(.desc, .shortcut) {
      color: var(--au-ink-2);
    }
    .chevron {
      flex: none;
      color: var(--au-ink-4, #777);
    }
  `

  private onClick(): void {
    if (this.disabled) return
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  render() {
    return html`
      <div
        class="item"
        part="item"
        role="menuitem"
        aria-disabled=${this.disabled ? 'true' : 'false'}
        @click=${this.onClick}
      >
        ${this.icon
          ? html`<au-icon class="icon" part="icon" name=${this.icon} size="sm" aria-hidden="true"></au-icon>`
          : nothing}
        <span class="content">
          ${this.label != null && this.label !== ''
            ? html`<span class="label" part="label">${this.label}</span>`
            : nothing}
          ${this.description ? html`<span class="desc" part="description">${this.description}</span>` : nothing}
        </span>
        ${this.shortcut ? html`<span class="shortcut" part="shortcut">${this.shortcut}</span>` : nothing}
        ${this.submenu
          ? html`<au-icon class="chevron" part="chevron" name="chevron-right" size="sm" aria-hidden="true"></au-icon>`
          : nothing}
      </div>
    `
  }
}
