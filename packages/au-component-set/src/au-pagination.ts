// <au-pagination> — the default set's Lit SHADOW implementation of the `au-pagination` contract.
//
// The table / list FOOTER: a summary (left) · a pager (center-right) · a rows-per-page au-select
// (right), one dense row split from the data by a single hairline. A stateless, CONTROLLED footer —
// the consumer owns the model (`page` + `pageCount`, optional `total` / `pageSize`); the control owns
// the layout + the page-window math and composes au-icon-button / au-select / au-icon plus the one
// owned page-number cell.
//
// MONOCHROME. The CURRENT page reads as a surface-LIFT chip + brighter ink + a symmetric hairline
// ring — NEVER a coloured fill and NEVER a leading / left bar. Numerals ride tabular figures so the
// row is pixel-stable as the range updates. TOKEN-ONLY.
//
// Emits `au-page-change` (detail `{ page }`, clamped, never the current page) and
// `au-page-size-change` (detail `{ size }`), both composed + bubbling.

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import { pageWindow } from './page-window'

const DEFAULT_SIZES = [10, 20, 50, 100]

const fmt = (n: number): string => n.toLocaleString('en-US')

export class AuPaginationElement extends AuElement {
  static properties = {
    page: { type: Number },
    pageCount: { type: Number, attribute: 'page-count' },
    variant: { type: String, reflect: true },
    size: { type: String, reflect: true },
    total: { type: Number },
    summary: { type: String },
    pageSize: { type: Number, attribute: 'page-size' },
    pageSizeOptions: { type: Array, attribute: 'page-size-options' },
    siblingCount: { type: Number, attribute: 'sibling-count' },
    boundaryCount: { type: Number, attribute: 'boundary-count' },
    showFirstLast: { type: Boolean, attribute: 'show-first-last' },
    loading: { type: Boolean, reflect: true },
    label: { type: String },
  }

  declare page: number
  declare pageCount: number
  declare variant: 'numbered' | 'cursor' | 'compact'
  declare size: 'comfortable' | 'dense'
  declare total?: number
  declare summary?: 'range' | 'count'
  declare pageSize?: number
  declare pageSizeOptions?: number[]
  declare siblingCount: number
  declare boundaryCount: number
  declare showFirstLast: boolean
  declare loading: boolean
  declare label?: string

  constructor() {
    super()
    this.page = 1
    this.pageCount = 1
    this.variant = 'numbered'
    this.size = 'comfortable'
    this.siblingCount = 1
    this.boundaryCount = 1
    this.showFirstLast = false
    this.loading = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      /* component-local control side: page-cell + icon-button square (32 comfortable) */
      --au-pagination-ctrl: calc(var(--au-space-1, 4px) * 8);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--au-space-4, 16px);
      min-height: var(--au-topbar-h, 40px);
      min-width: 0;
      flex-wrap: wrap;
      padding-block: var(--au-space-1, 4px);
      padding-inline: var(--au-space-3, 12px);
      border-top: 1px solid var(--au-line-2, rgba(238, 240, 247, 0.09));
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-variant-numeric: tabular-nums;
    }
    :host([size='dense']) {
      --au-pagination-ctrl: calc(var(--au-space-1, 4px) * 7); /* 28 */
      min-height: calc(var(--au-row-h,32px) + var(--au-space-1, 4px)); /* 32 */
      padding-inline: var(--au-space-2, 8px);
    }
    :host([variant='compact']) {
      justify-content: flex-end;
      gap: var(--au-space-3, 12px);
    }

    .summary {
      flex: 0 0 auto;
      min-width: 0;
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs, 16px);
      letter-spacing: var(--au-ls-mono, -0.005em);
      color: var(--au-ink-4, #8b93a6);
      white-space: nowrap;
    }

    .pager {
      max-width: 100%;
      flex-wrap: wrap;
      flex: 0 1 auto;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
    }
    .edge {
      display: flex;
      align-items: center;
      gap: var(--au-space-0-5, 2px);
    }
    .pages {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--au-space-1, 4px);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* ── the one owned sub-part: a page-number cell ── */
    .page {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: var(--au-pagination-ctrl);
      height: var(--au-pagination-ctrl);
      padding-inline: var(--au-space-2, 8px);
      border: 0;
      border-radius: var(--au-radius-chip, 6px);
      background: transparent;
      color: var(--au-ink-3, #a0a8bc);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm, 16px);
      font-weight: var(--au-w-body, 400);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition:
        background-color var(--au-m-fast, 160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast, 160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast, 160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .page:hover,
    .page[data-force-hover] {
      background: var(--au-chrome-hover);
      color: var(--au-ink-1, #eef0f7);
    }
    /* CURRENT — surface-lift chip + brighter medium ink + a symmetric hairline ring. NOT a fill, NOT a rail. */
    .page[aria-current='page'],
    .page[data-force-current] {
      background: var(--au-color-surface-2, #1f232c);
      color: var(--au-ink-1, #eef0f7);
      font-weight: var(--au-w-medium, 500);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      cursor: default;
    }
    .page:focus-visible,
    .page[data-force-focus] {
      ${controlFocusStyle}
    }
    .page:disabled,
    .page[data-force-disabled] {
      color: var(--au-ink-5, #4a505e);
      cursor: not-allowed;
      pointer-events: none;
    }

    .ellipsis {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: var(--au-pagination-ctrl);
      height: var(--au-pagination-ctrl);
      color: var(--au-ink-4, #8b93a6);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm, 16px);
      user-select: none;
    }

    .indicator {
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      height: var(--au-pagination-ctrl);
      padding-inline: var(--au-space-2, 8px);
      border-radius: var(--au-radius-chip, 6px);
      background: var(--au-color-surface-1, #1a1d24);
      color: var(--au-ink-4, #8b93a6);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm, 16px);
      letter-spacing: var(--au-ls-snug, -0.02em);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .num {
      color: var(--au-ink-2, #d9d6cd);
      font-weight: var(--au-w-body, 400);
    }

    .sizewrap {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      color: var(--au-ink-4, #8b93a6);
    }
    .size-label {
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm, 16px);
      letter-spacing: var(--au-ls-snug, -0.02em);
      white-space: nowrap;
    }
    .size-select {
      width: calc(var(--au-space-8, 40px) * 2); /* 80 */
    }

    .sk {
      display: inline-block;
      border-radius: var(--au-radius-chip, 6px);
      background: var(--au-color-surface-2, #1f232c);
      opacity: 0.6;
    }
    .sk-cells {
      display: flex;
      gap: var(--au-space-1, 4px);
    }
    au-icon-button {
      flex: 0 0 auto;
    }
  `

  private go(target: number): void {
    const count = Math.max(this.pageCount, 1)
    const next = Math.min(Math.max(target, 1), count)
    if (next !== this.page) {
      this.dispatchEvent(new CustomEvent('au-page-change', { detail: { page: next }, bubbles: true, composed: true }))
    }
  }

  private onPageSize(size: number): void {
    this.dispatchEvent(new CustomEvent('au-page-size-change', { detail: { size }, bubbles: true, composed: true }))
  }

  private renderSummary() {
    if (this.total == null) return nothing
    const inner = (() => {
      if (this.total === 0) return 'No results'
      const asCount = this.summary === 'count' || this.pageSize == null
      if (asCount) return html`${fmt(this.total)} ${this.total === 1 ? 'record' : 'records'}`
      const from = (this.page - 1) * (this.pageSize as number) + 1
      const to = Math.min(this.page * (this.pageSize as number), this.total)
      return html`Showing <span class="num">${fmt(from)}</span>–<span class="num">${fmt(to)}</span> of
        <span class="num">${fmt(this.total)}</span>`
    })()
    return html`<div class="summary" part="summary">
      ${this.loading
        ? html`<span class="sk" style="width: calc(var(--au-space-8) * 3); height: var(--au-t-sm);"></span>`
        : inner}
    </div>`
  }

  private renderPagerBody(count: number) {
    if (this.loading) {
      return html`<div class="sk-cells" aria-hidden="true">
        ${[0, 1, 2].map(
          () =>
            html`<span
              class="sk"
              style="width: var(--au-pagination-ctrl); height: var(--au-pagination-ctrl);"
            ></span>`,
        )}
      </div>`
    }
    if (this.variant === 'numbered') {
      return html`<ul class="pages" part="pager">
        ${pageWindow(this.page, count, this.siblingCount, this.boundaryCount).map((item) =>
          item === 'ellipsis'
            ? html`<li class="ellipsis" part="ellipsis" aria-hidden="true">…</li>`
            : html`<li>
                <button
                  type="button"
                  class="page"
                  part="page"
                  aria-current=${item === this.page ? 'page' : nothing}
                  aria-label=${`Go to page ${fmt(item)}`}
                  @click=${() => this.go(item)}
                >
                  ${fmt(item)}
                </button>
              </li>`,
        )}
      </ul>`
    }
    // cursor / compact indicator chip
    return html`<span class="indicator" part="indicator">
      ${this.variant === 'compact'
        ? html`<span class="num">${fmt(this.page)}</span> / <span class="num">${fmt(count)}</span>`
        : html`Page <span class="num">${fmt(this.page)}</span> of <span class="num">${fmt(count)}</span>`}
    </span>`
  }

  render() {
    const count = Math.max(this.pageCount, 1)
    const atFirst = this.page <= 1
    const atLast = this.page >= count
    const iconSize = this.size === 'dense' ? 'sm' : 'md'
    const withFirstLast = this.showFirstLast && this.variant !== 'compact'
    const hasSize = this.pageSize != null
    const state = this.total === 0 ? 'empty' : this.loading ? 'loading' : this.pageCount <= 1 ? 'single' : nothing
    const sizes = this.pageSizeOptions ?? DEFAULT_SIZES
    const sizeOptions = sizes.map((n) => ({ value: String(n), label: String(n) }))

    return html`
      <nav
        style="display: contents;"
        aria-label=${this.label ?? 'Pagination'}
        data-state=${state}
      >
        ${this.renderSummary()}

        <div class="pager">
          <div class="edge">
            ${withFirstLast
              ? html`<au-icon-button
                  size=${iconSize}
                  label="First page"
                  ?disabled=${atFirst || this.loading}
                  @au-activate=${() => this.go(1)}
                  ><au-icon name="chevrons-left" size="sm"></au-icon
                ></au-icon-button>`
              : nothing}
            <au-icon-button
              size=${iconSize}
              label="Previous page"
              ?disabled=${atFirst || this.loading}
              @au-activate=${() => this.go(this.page - 1)}
              ><au-icon name="chevron-left" size="sm"></au-icon
            ></au-icon-button>
          </div>

          ${this.renderPagerBody(count)}

          <div class="edge">
            <au-icon-button
              size=${iconSize}
              label="Next page"
              ?disabled=${atLast || this.loading}
              @au-activate=${() => this.go(this.page + 1)}
              ><au-icon name="chevron-right" size="sm"></au-icon
            ></au-icon-button>
            ${withFirstLast
              ? html`<au-icon-button
                  size=${iconSize}
                  label="Last page"
                  ?disabled=${atLast || this.loading}
                  @au-activate=${() => this.go(count)}
                  ><au-icon name="chevrons-right" size="sm"></au-icon
                ></au-icon-button>`
              : nothing}
          </div>
        </div>

        ${hasSize
          ? html`<div class="sizewrap">
              <span class="size-label">Rows per page</span>
              <div class="size-select">
                <au-select
                  size="sm"
                  label="Rows per page"
                  .options=${sizeOptions}
                  value=${this.pageSize != null ? String(this.pageSize) : ''}
                  @au-change=${(e: CustomEvent) => this.onPageSize(Number(e.detail.value))}
                ></au-select>
              </div>
            </div>`
          : nothing}
      </nav>
    `
  }
}
