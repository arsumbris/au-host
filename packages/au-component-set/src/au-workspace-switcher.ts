import { reducedControlMotion } from './control-motion'
import { installBackdropMaterial } from './surface-material'
import { pickerKeyframes, pickerExitMotion } from './picker-motion'
// <au-workspace-switcher> shows workspace identity and open/create actions.
// The menu uses the dropdown layer claimed from `host.overlay` through ClaimOverlay.
// The host owns insertion, clip escape and stacking; this component owns content and placement.
// Without an overlay host the trigger remains renderable but does not open a menu.
// `name` / `current-id` attributes and the `items` property describe the current choices.
// Emits composed, bubbling `au-select` ({ id }), `au-open-folder` and `au-new-workspace` events.

import { css, html, nothing, render, type PropertyValues } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import { pickerSurface, pickerRow, pickerRowHover, pickerRowSeparation, pickerRowFocus, pickerRowSelected } from './picker-style'
import type { OverlayLayer } from '@arsumbris/component-contract'
import { ClaimOverlay } from './claim-overlay'
import { closePicker } from './picker-motion'

/** One switchable workspace: a stable id (the entry root) and the name shown in the menu. */
export interface AuWorkspaceItem {
  id: string
  name: string
}

// The menu lives in a SEPARATE shadow root inside the claimed overlay layer, so it stays token-only
// and isolated like every other component — not a body-global stylesheet. Tokens pierce the boundary
// from the document root, so `var(--au-*)` resolves here unchanged.
const MENU_STYLES = css`
  ${pickerKeyframes}
  .menu[data-state='closed'] { ${pickerExitMotion} }
  :host {
    display: block;
  }
  .menu {
    ${pickerSurface}
  }
  .item {
    ${pickerRow}
  }
  .item + .item { ${pickerRowSeparation} }
  .item:hover { ${pickerRowHover} }
  .item:focus-visible { ${pickerRowFocus} }
  .item[data-current] { ${pickerRowSelected} }
  .item .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The current-workspace marker: a quiet monochrome dot, never a coloured tick. */
  .current-dot {
    flex: none;
    inline-size: var(--au-space-1, 4px);
    block-size: var(--au-space-1, 4px);
    border-radius: 50%;
    background: var(--au-ink-3, #a09c92);
  }
  .action-glyph {
    flex: none;
    color: var(--au-ink-4, #959083);
  }
  .separator {
    height: 1px;
    margin: var(--au-space-1, 4px) var(--au-space-2, 8px);
    background: var(--au-line-1, rgba(255, 255, 255, 0.08));
  }
`

const GAP = 4 // ~ --au-space-1: the menu sits just under (or over) the trigger
const MARGIN = 8 // keep this far off the window edge

export class AuWorkspaceSwitcherElement extends ClaimOverlay(AuElement) {
  static properties = {
    name: { type: String, reflect: true },
    currentId: { type: String, attribute: 'current-id' },
    items: { attribute: false },
    open: { type: Boolean, reflect: true },
  }

  declare name: string
  declare currentId: string
  declare items: AuWorkspaceItem[]
  declare open: boolean

  #layer: OverlayLayer | null = null
  #menuHost: HTMLDivElement | null = null

  constructor() {
    super()
    this.name = ''
    this.currentId = ''
    this.items = []
    this.open = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      position: relative;
      display: flex;
      min-width: 0;
    }
    .trigger {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      padding: var(--au-space-1, 4px) var(--au-space-2, 8px);
      border: 0;
      border-radius: var(--au-radius-row, 8px);
      background: transparent;
      color: var(--au-ink-1, #e2dfda);
      font: inherit;
      cursor: pointer;
      text-align: start;
      transition: background var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .trigger:hover,
    :host([open]) .trigger {
      background: color-mix(in oklab, var(--au-ink-1, #e2dfda) 6%, transparent);
    }
    .trigger:focus-visible {
      ${controlFocusStyle}
    }
    .name {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
    }
    .chev {
      flex: none;
      color: var(--au-ink-4, #959083);
    }
  `

  #isCurrent(it: AuWorkspaceItem): boolean {
    return this.currentId ? it.id === this.currentId : it.name === this.name
  }

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
  }

  #onTrigger(): void {
    if (this.open) this.#close()
    else this.#openMenu()
  }

  #choose(id: string): void {
    this.#close()
    this.#emit('au-select', { id })
  }

  #runAction(type: 'au-open-folder' | 'au-new-workspace'): void {
    this.#close()
    this.#emit(type)
  }

  #menuTemplate() {
    return html`
      <div class="menu" role="menu">
        ${this.items.map(
          (it) => html`
            <button
              class="item"
              role="menuitem"
              ?data-current=${this.#isCurrent(it)}
              @click=${() => this.#choose(it.id)}
            >
              <au-workspace-mark name=${it.name}></au-workspace-mark>
              <span class="label">${it.name}</span>
              ${this.#isCurrent(it) ? html`<span class="current-dot" aria-hidden="true"></span>` : nothing}
            </button>
          `,
        )}
        <div class="separator" role="separator"></div>
        <button class="item" role="menuitem" @click=${() => this.#runAction('au-open-folder')}>
          <au-icon class="action-glyph" name="folder-open" label="Open folder"></au-icon>
          <span class="label">Open folder…</span>
        </button>
        <button class="item" role="menuitem" @click=${() => this.#runAction('au-new-workspace')}>
          <au-icon class="action-glyph" name="plus" label="New workspace"></au-icon>
          <span class="label">New workspace…</span>
        </button>
      </div>
    `
  }

  #openMenu(): void {
    const layer = this.claimOverlay('dropdown')
    if (!layer) return // no host present (standalone render) — degrade to a no-op, never throw
    this.#layer = layer

    const menuHost = document.createElement('div')
    menuHost.style.position = 'fixed'
    menuHost.style.visibility = 'hidden' // hidden for the pre-measure paint; revealed once placed
    menuHost.style.pointerEvents = 'auto' // the layer is transparent; the menu re-enables events
    const menuRoot = menuHost.attachShadow({ mode: 'open' })
    installBackdropMaterial(menuRoot)
    menuRoot.adoptedStyleSheets = [MENU_STYLES.styleSheet as CSSStyleSheet]
    render(this.#menuTemplate(), menuRoot)
    layer.el.appendChild(menuHost)
    this.#menuHost = menuHost

    this.open = true
    this.#place()
    requestAnimationFrame(() => this.#place()) // second pass once content settled its real size
    window.addEventListener('resize', this.#place, true)
    window.addEventListener('scroll', this.#place, true)
    document.addEventListener('pointerdown', this.#onDocPointer, true)
    document.addEventListener('keydown', this.#onKey, true)
  }

  #close(): void {
    if (!this.open) return
    this.open = false
    window.removeEventListener('resize', this.#place, true)
    window.removeEventListener('scroll', this.#place, true)
    document.removeEventListener('pointerdown', this.#onDocPointer, true)
    document.removeEventListener('keydown', this.#onKey, true)
    const surface = this.#menuHost?.shadowRoot?.querySelector<HTMLElement>('.menu') ?? null
    const layer = this.#layer
    if (this.#menuHost) this.#menuHost.inert = true
    this.#menuHost = null
    this.#layer = null
    closePicker(surface, () => layer?.release())
  }

  // Measure the trigger and place the host-layer menu below it, flipping above when that provides
  // more room. Clamp the resulting rectangle to the viewport.
  #place = (): void => {
    const menuHost = this.#menuHost
    const trigger = this.renderRoot.querySelector('.trigger')
    if (!menuHost || !trigger) return
    const r = trigger.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    const menuW = Math.max(r.width, menuHost.offsetWidth)
    let left = r.left
    if (left + menuW > vw - MARGIN) left = vw - MARGIN - menuW
    if (left < MARGIN) left = MARGIN

    const below = vh - r.bottom - GAP - MARGIN
    const above = r.top - GAP - MARGIN
    const menuH = menuHost.offsetHeight
    let top: number
    let maxHeight: number
    if (menuH <= below || below >= above) {
      top = r.bottom + GAP
      maxHeight = Math.max(0, below)
    } else {
      maxHeight = Math.max(0, above)
      top = Math.max(MARGIN, r.top - GAP - Math.min(menuH, maxHeight))
    }

    menuHost.style.top = `${top}px`
    menuHost.style.left = `${left}px`
    menuHost.style.minWidth = `${r.width}px`
    menuHost.style.maxHeight = `${maxHeight}px`
    menuHost.style.overflowY = 'auto'
    menuHost.style.visibility = 'visible'
  }

  #onDocPointer = (e: PointerEvent): void => {
    const t = e.target as Node
    // The menu lives OUTSIDE this element (in the overlay layer), so an outside test must treat it as
    // inside too — else a click on a menu item reads as outside and tears the menu down before the
    // item's click lands. `composedPath` sees through both shadow roots.
    const path = e.composedPath()
    if (path.includes(this) || (this.#menuHost && path.includes(this.#menuHost))) return
    void t
    this.#close()
  }

  #onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.#close()
  }

  override disconnectedCallback(): void {
    this.#close()
    super.disconnectedCallback()
  }

  // Keep the open menu in sync if `items` / `name` / `currentId` change while it is open.
  override updated(changed: PropertyValues): void {
    if (this.open && this.#menuHost && (changed.has('items') || changed.has('name') || changed.has('currentId'))) {
      render(this.#menuTemplate(), this.#menuHost.shadowRoot as ShadowRoot)
      this.#place()
    }
  }

  render() {
    return html`
      <button
        class="trigger"
        part="trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded=${this.open ? 'true' : 'false'}
        @click=${this.#onTrigger}
      >
        <au-workspace-mark part="mark" name=${this.name}></au-workspace-mark>
        <span class="name" part="name">${this.name}</span>
        <au-icon class="chev" part="chev" name="chevron-down" label="Switch workspace"></au-icon>
      </button>
    `
  }
}
