// <au-tab-bar> — the default set's Lit SHADOW implementation of the `au-tab-bar` contract.
//
// The full pane/editor tab strip: a scrolling row of <au-tab-strip-cell>s on its enclosing surface.
// The active cell owns selection fill; the enclosing pane owns the frame. Four zones L→R: an optional `leading` slot, the scrolling TRACK, alpha fades that reveal the surface as the
// track scrolls off either side, and a trailing `actions` cluster (behind a hairline divider) with an
// optional add (+) button in the track.
//
// The parent owns the tab MODEL (`tabs` + `activeId`); the bar owns only CHROME behaviour — pinned sort,
// roving-focus keyboard nav, scroll-active-into-view, the scroll-position edge state, middle-click
// close. Emits `au-select {id}` / `au-close {id}` / `au-add`. NO drag-to-reorder (the container drives
// it). TOKEN-ONLY.

import { css, html, type PropertyValues } from 'lit'
import { horizontalScrollFade, measureHorizontalFade } from './scroll-fade'
import { AuElement } from './au-element'
import './au-tab-strip-cell'
import './au-icon'
import './au-icon-button'

export interface AuTabBarItem {
  id: string
  label: string
  icon?: string
  group?: boolean
  dirty?: boolean
  pinned?: boolean
  locked?: boolean
  isPreview?: boolean
  moveLocked?: boolean
  removeLocked?: boolean
}

export class AuTabBarElement extends AuElement {
  static properties = {
    tabs: { type: Array },
    activeId: { type: String, attribute: 'active-id' },
    draggingId: { type: String, attribute: 'dragging-id' },
    add: { type: Boolean },
    closable: { type: Boolean },
    _scrollStart: { state: true },
    _scrollEnd: { state: true },
    _hasActions: { state: true },
  }

  declare tabs: AuTabBarItem[]
  declare activeId: string | null
  /** The id of the cell currently being dragged (the container sets this from its drag store) — that
   *  cell renders its lifted `dragging` posture. */
  declare draggingId: string | null
  declare add: boolean
  declare closable: boolean
  declare _scrollStart: boolean
  declare _scrollEnd: boolean
  declare _hasActions: boolean

  private focusAfterClose: string | null = null
  private revealFrame = 0
  private track: HTMLElement | null = null
  private ro: ResizeObserver | null = null

  constructor() {
    super()
    this.tabs = []
    this.activeId = null
    this.draggingId = null
    this.add = false
    this.closable = true
    this._scrollStart = false
    this._scrollEnd = false
    this._hasActions = false
  }

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      height: var(--au-tabs-h, 36px);
      box-sizing: border-box;
      padding-inline: var(--au-space-1, 4px);
      background: transparent;
      box-shadow: none;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    .leading {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--au-space-0-5, 2px);
    }
    .scroll {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      align-items: center;
    }
    .track {
      ${horizontalScrollFade}
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      align-items: center;
      gap: var(--au-space-0-5, 2px);
      height: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-behavior: auto;
      scrollbar-width: none;
    }
    .track::-webkit-scrollbar {
      width: 0;
      height: 0;
      display: none;
    }
    au-tab-strip-cell {
      /* Content-width + the track scrolls, so drop the cell's readable-floor
         min-width — that floor is for a bare strip in a constrained flex, not for the scrolling track. */
      flex: 0 0 auto;
      --au-tab-min-width: 0px;
    }
    .empty {
      display: inline-flex;
      align-items: center;
      padding-inline: var(--au-space-2, 8px);
      color: var(--au-ink-5, #555);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      letter-spacing: var(--au-ls-snug,-0.02em);
      user-select: none;
    }
    .divider {
      flex: 0 0 auto;
      align-self: center;
      width: 1px;
      height: var(--au-space-5, 20px);
      margin-inline: var(--au-space-0-5, 2px);
      background: var(--au-line-1, rgba(255, 255, 255, 0.09));
    }
    .actions {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--au-space-0-5, 2px);
    }
    @media (hover: none) { .actions { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .actions { transition: none; } }
    .add {
      flex: 0 0 auto;
      margin-inline-start: var(--au-space-1, 4px);
    }
  `

  private ordered(): AuTabBarItem[] {
    const pinned = this.tabs.filter((t) => t.pinned)
    const rest = this.tabs.filter((t) => !t.pinned)
    return [...pinned, ...rest]
  }

  /** The rendered cells' screen rects in VISUAL order, keyed by id. A container drives the drag protocol
   *  from this (its drop dialect computes the reorder insertion index; the insertion-bar overlay draws
   *  from it) instead of light-DOM `[data-tab-id]` cells — the cells live in this shadow root. The public
   *  half of the container-drivable tab-strip contract (the peer of the cell's `au-tab-drag-start`). */
  tabCellRects(): { id: string; left: number; width: number }[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>('au-tab-strip-cell[data-tab-id]')).map((c) => {
      const r = c.getBoundingClientRect()
      return { id: c.dataset['tabId'] as string, left: r.left, width: r.width }
    })
  }

  /** Visible track bounds exclude the leading/trailing actions and clip insertion previews. */
  tabTrackRect(): DOMRect | null {
    return this.track?.getBoundingClientRect() ?? null
  }

  /** Container-driven edge scrolling during an active drag. This only scrolls chrome;
   * the caller continues to resolve placement from tabCellRects after each moved frame. */
  scrollDragEdge(clientX: number, clientY: number, elapsedMs: number): boolean {
    const track = this.track
    if (!track || !this.isConnected) return false
    const r = track.getBoundingClientRect()
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false
    const edge = Math.min(32, r.width / 4)
    if (edge <= 0) return false
    const pressure = clientX < r.left + edge ? -(r.left + edge - clientX) / edge
      : clientX > r.right - edge ? (clientX - (r.right - edge)) / edge : 0
    const before = track.scrollLeft
    // Linear ramp, time-based speed, capped after a suspended frame. Scrolling is
    // direct manipulation even with reduced motion; there is no inertial tail.
    track.scrollLeft += pressure * 480 * Math.min(32, Math.max(0, elapsedMs)) / 1000
    return track.scrollLeft !== before
  }

  private measure = (): void => {
    const el = this.track
    if (!el) return
    this.style.setProperty('--au-tab-max-width', `min(16rem, ${Math.max(96, el.clientWidth)}px)`)
    measureHorizontalFade(el)
    const max = el.scrollWidth - el.clientWidth
    const start = el.scrollLeft > 1
    const end = el.scrollLeft < max - 1
    if (start !== this._scrollStart) this._scrollStart = start
    if (end !== this._scrollEnd) this._scrollEnd = end
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const origin = event.composedPath().find((node) => node instanceof HTMLElement && node.getAttribute('role') === 'tab')
    if (!origin || event.composedPath()[0] !== origin) return
    const ordered = this.ordered()
    if (ordered.length === 0) return
    const current = ordered.findIndex((t) => t.id === this.activeId)
    let next = -1
    switch (event.key) {
      case 'Delete': {
        const tab = ordered[current]
        if (tab && this.closable && !tab.removeLocked && !tab.pinned && !tab.locked) {
          event.preventDefault()
          this.close(tab.id)
        }
        return
      }
      case 'ArrowRight':
        next = current < 0 ? 0 : (current + 1) % ordered.length
        break
      case 'ArrowLeft':
        next = current < 0 ? ordered.length - 1 : (current - 1 + ordered.length) % ordered.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = ordered.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const target = ordered[next]
    if (!target) return
    this.select(target.id)
    this.renderRoot.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }

  private select(id: string): void {
    this.dispatchEvent(new CustomEvent('au-select', { detail: { id }, bubbles: true, composed: true }))
  }

  private close(id: string): void {
    this.focusAfterClose = this.ownerDocument.activeElement === this ? id : null
    this.dispatchEvent(new CustomEvent('au-close', { detail: { id }, bubbles: true, composed: true }))
  }

  // (Re)wire the scroll listener + ResizeObserver on the rendered `.track`. Idempotent: drops any prior
  // wiring first, so it is safe to call on every (re)connect. Custom elements disconnect+reconnect when
  // MOVED in the DOM (container re-parenting / tab-strip relocation); `firstUpdated` runs only once, so
  // without re-attaching here the edge fades would silently stop updating after the first move.
  private attachObservers(): void {
    this.track = this.renderRoot.querySelector('.track')
    const el = this.track
    if (!el) return
    el.removeEventListener('scroll', this.measure)
    this.ro?.disconnect()
    el.addEventListener('scroll', this.measure, { passive: true })
    this.ro = new ResizeObserver(() => {
      this.measure()
      this.revealActive()
    })
    this.ro.observe(el)
    this.measure()
  }

  connectedCallback(): void {
    super.connectedCallback()
    // On a RECONNECT the shadow root persists, so `.track` is already there — re-attach. On the FIRST
    // connect the root is not rendered yet (`.track` is null); `firstUpdated` covers that pass.
    this.attachObservers()
  }

  firstUpdated(): void {
    this.attachObservers()
  }

  private arrival: Animation | null = null

  private highlightArrival(changed: PropertyValues): void {
    const previous = changed.get('tabs') as AuTabBarItem[] | undefined
    if (!previous || !this.activeId || previous.some(tab => tab.id === this.activeId)) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const active = this.renderRoot.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!active) return
    const style = getComputedStyle(this)
    const time = style.getPropertyValue('--au-m-slow').trim()
    const duration = Number.parseFloat(time) * (time.endsWith('ms') ? 1 : 1000)
    if (!Number.isFinite(duration) || duration <= 0) return
    this.arrival?.cancel()
    this.arrival = active.animate([
      { boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--au-color-accent) 35%, transparent)', backgroundColor: 'color-mix(in srgb, var(--au-color-accent) 12%, var(--au-chrome-active))' },
      { boxShadow: 'inset 0 0 0 1px transparent', backgroundColor: getComputedStyle(active).backgroundColor },
    ], { duration, easing: style.getPropertyValue('--au-e-soft').trim() || 'ease-out' })
  }

  updated(changed: PropertyValues): void {
    if (changed.has('tabs') && this.focusAfterClose !== null) {
      const removed = !this.tabs.some(tab => tab.id === this.focusAfterClose)
      this.focusAfterClose = null
      const focus = this.ownerDocument.activeElement
      if (removed && (focus === this || focus === this.ownerDocument.body)) {
        const cells = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-tab-id]')]
        const target = cells.find(cell => cell.dataset.tabId === this.activeId) ?? cells[0]
        if (target) target.focus()
        else this.renderRoot.querySelector('au-icon-button')?.shadowRoot?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    this.highlightArrival(changed)
    // Expose overflow state for inspection.
    this.toggleAttribute('data-scroll-start', this._scrollStart)
    this.toggleAttribute('data-scroll-end', this._scrollEnd)
    this._hasActions = !!this.querySelector(':scope > [slot="actions"]')
    if (changed.has('tabs') || changed.has('activeId')) {
      this.measure()
      this.revealActive()
    }
  }

  private revealActive(): void {
    cancelAnimationFrame(this.revealFrame)
    this.revealFrame = requestAnimationFrame(() => {
      const active = this.renderRoot.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!active || !this.track) return
      const cell = active.getBoundingClientRect()
      const track = this.track.getBoundingClientRect()
      if (cell.left < track.left) this.track.scrollLeft -= track.left - cell.left
      else if (cell.right > track.right) this.track.scrollLeft += cell.right - track.right
      this.measure()
    })
  }

  disconnectedCallback(): void {
    this.arrival?.cancel()
    this.arrival = null
    super.disconnectedCallback()
    this.focusAfterClose = null
    cancelAnimationFrame(this.revealFrame)
    this.track?.removeEventListener('scroll', this.measure)
    this.ro?.disconnect()
  }

  render() {
    const ordered = this.ordered()
    return html`
      <div class="leading"><slot name="leading"></slot></div>
      <div class="scroll">
        <div class="track" role="tablist" aria-label="Open panes" @keydown=${this.onKeyDown}>
          ${ordered.length === 0
            ? html`<span class="empty" aria-hidden="true">No open tabs</span>`
            : ordered.map(
                (tab) => html`
                  <au-tab-strip-cell
                    .icon=${tab.icon}
                    label=${tab.label}
                    .grip=${false}
                    ?group=${tab.group}
                    ?active=${tab.id === this.activeId}
                    ?dragging=${tab.id === this.draggingId}
                    ?dirty=${tab.dirty}
                    ?pinned=${tab.pinned}
                    ?locked=${tab.locked}
                    ?preview=${tab.isPreview}
                    ?move-locked=${tab.moveLocked}
                    ?remove-locked=${tab.removeLocked || !this.closable}
                    data-tab-id=${tab.id}
                    @au-activate=${() => this.select(tab.id)}
                    @au-close=${(event: Event) => { event.stopPropagation(); this.close(tab.id) }}
                    @auxclick=${(e: MouseEvent) => {
                      if (e.button === 1 && this.closable && !tab.removeLocked && !tab.pinned && !tab.locked) {
                        e.preventDefault()
                        this.close(tab.id)
                      }
                    }}
                  ></au-tab-strip-cell>
                `,
              )}

        </div>
      </div>
          ${this.add
            ? html`<au-icon-button
                class="add"
                size="sm"
                surface="chrome"
                label="New tab"
                @au-activate=${() => this.dispatchEvent(new CustomEvent('au-add', { bubbles: true, composed: true }))}
                ><au-icon name="plus" size="sm"></au-icon
              ></au-icon-button>`
            : null}
      ${this._hasActions ? html`<div class="divider" aria-hidden="true"></div>` : null}
      <div class="actions" style=${this._hasActions ? '' : 'display:none'}>
        <slot name="actions" @slotchange=${() => (this._hasActions = !!this.querySelector(':scope > [slot="actions"]'))}></slot>
      </div>
    `
  }
}
