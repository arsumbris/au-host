// <au-breadcrumb> — the default set's Lit SHADOW implementation of the `au-breadcrumb` contract.
//
// A path / segment nav (the shell's "app / renderer / projections / ProjectionHost.tsx" look). Segments
// sit on a row joined by a muted separator (a `/` glyph or a small chevron, ink-4). Earlier segments
// are interactive and ride the NavItem emphasis ladder — quiet ink-3 at rest, firming to ink-1 on hover
// over a whisper surface lift (NO left accent bar). The LAST segment is the current page: ink-1,
// non-interactive. Past `maxItems` the middle collapses to a single `…`. TOKEN-ONLY.
//
// DATA-DRIVEN (the data-driven rule): `items` is a JS property of `au-breadcrumb-item` records
// (`{ label, icon?, value?, interactive? }` — `icon` is an au-icon glyph NAME). The LAST item is the
// current page; earlier items are interactive buttons unless `interactive: false`. A crumb click emits
// `au-navigate` (detail `{ index, value, label }`, composed + bubbling).

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'

/** One breadcrumb segment: its label, an optional leading au-icon glyph name, and an optional value. */
export interface AuBreadcrumbItem {
  label: string
  icon?: string
  value?: string
  /** An earlier crumb is an interactive button by default; set false for a quiet static crumb. */
  interactive?: boolean
}

type Slot =
  | { kind: 'crumb'; item: AuBreadcrumbItem; index: number; current: boolean }
  | { kind: 'ellipsis'; hidden: AuBreadcrumbItem[] }

export class AuBreadcrumbElement extends AuElement {
  static properties = {
    items: { attribute: false },
    separator: { type: String, reflect: true },
    maxItems: { type: Number },
    label: { type: String },
  }

  declare items: AuBreadcrumbItem[]
  declare separator: 'slash' | 'chevron'
  declare maxItems?: number
  declare label?: string

  constructor() {
    super()
    this.items = []
    this.separator = 'slash'
    this.label = 'Breadcrumb'
  }

  private get slots(): Slot[] {
    const items = this.items ?? []
    const lastIndex = items.length - 1
    const asCrumb = (item: AuBreadcrumbItem, i: number): Slot => ({
      kind: 'crumb',
      item,
      index: i,
      current: i === lastIndex,
    })
    if (this.maxItems === undefined) return items.map(asCrumb)
    const max = Math.max(2, this.maxItems)
    if (items.length <= max) return items.map(asCrumb)
    const tailStart = items.length - (max - 1)
    return [
      { kind: 'crumb', item: items[0], index: 0, current: false },
      { kind: 'ellipsis', hidden: items.slice(1, tailStart) },
      ...items.slice(tailStart).map(
        (item, j): Slot => ({ kind: 'crumb', item, index: tailStart + j, current: tailStart + j === lastIndex }),
      ),
    ]
  }

  private navigate(item: AuBreadcrumbItem, index: number): void {
    this.dispatchEvent(
      new CustomEvent('au-navigate', {
        detail: { index, value: item.value, label: item.label },
        bubbles: true,
        composed: true,
      }),
    )
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      min-width: 0;
    }
    ol {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--au-space-1, 4px);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      min-width: 0;
    }
    /* shared crumb metrics — links, the current leaf, static crumbs and the ellipsis share a box. */
    .link,
    .current,
    .crumb,
    .ellipsis {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      min-width: 0;
      max-width: 100%;
      padding: var(--au-space-0-5, 2px) var(--au-space-1, 4px);
      border-radius: var(--au-radius-chip, 6px);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
    }
    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      color: var(--au-ink-4, #777);
      transition: color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    /* interactive segment — the ink-3 → ink-1 ladder over the shared chrome interaction wash. */
    .link {
      border: 0;
      background: transparent;
      color: var(--au-ink-3, #8a8a8a);
      text-align: start;
      cursor: pointer;
      transition:
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .link:hover,
    .link[data-force-hover] {
      color: var(--au-ink-1, #ededed);
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
    }
    .link:hover .icon,
    .link[data-force-hover] .icon {
      color: var(--au-ink-2, #c8c8c8);
    }
    .link:active,
    .link[data-force-active] {
      color: var(--au-ink-1, #ededed);
      background: var(--au-chrome-active, rgba(255, 255, 255, 0.075));
    }
    .link:focus-visible,
    .link[data-force-focus] {
      ${controlFocusStyle}
    }
    /* current (last) segment — the page you are on. */
    .current {
      color: var(--au-ink-1, #ededed);
      cursor: default;
    }
    .current .icon {
      color: var(--au-ink-2, #c8c8c8);
    }
    /* static earlier crumb — quiet, non-interactive. */
    .crumb {
      color: var(--au-ink-3, #8a8a8a);
      cursor: default;
    }
    /* collapsed-middle marker. */
    .ellipsis {
      color: var(--au-ink-4, #777);
      cursor: default;
      user-select: none;
    }
    /* separator glyph (a slash or a chevron). */
    .sep {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      color: var(--au-ink-4, #777);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      user-select: none;
    }
  `

  private renderIcon(name: string | undefined) {
    if (!name) return nothing
    return html`<span class="icon" aria-hidden="true"><au-icon name=${name} size="sm"></au-icon></span>`
  }

  private renderCrumb(slot: Extract<Slot, { kind: 'crumb' }>) {
    const { item, index, current } = slot
    const body = html`${this.renderIcon(item.icon)}<span class="label">${item.label}</span>`
    if (current) return html`<span class="current" part="current" aria-current="page">${body}</span>`
    if (item.interactive === false) return html`<span class="crumb" part="crumb">${body}</span>`
    return html`<button
      type="button"
      class="link"
      part="link"
      @click=${() => this.navigate(item, index)}
    >
      ${body}
    </button>`
  }

  render() {
    const slots = this.slots
    return html`
      <nav aria-label=${this.label ?? 'Breadcrumb'}>
        <ol part="list">
          ${slots.map((slot, i) => {
            const sep =
              i > 0
                ? html`<span class="sep" aria-hidden="true"
                    >${this.separator === 'chevron'
                      ? html`<au-icon name="chevron-right" size="xs"></au-icon>`
                      : '/'}</span
                  >`
                : nothing
            const content =
              slot.kind === 'ellipsis'
                ? html`<span
                    class="ellipsis"
                    part="ellipsis"
                    title=${slot.hidden.map((h) => h.label).join(' / ')}
                    aria-label=${`${slot.hidden.length} hidden segments`}
                    >…</span
                  >`
                : this.renderCrumb(slot)
            return html`<li class="item">${sep}${content}</li>`
          })}
        </ol>
      </nav>
    `
  }
}
