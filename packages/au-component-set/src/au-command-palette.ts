// au-command-palette is a command launcher drawn in a host overlay.
// It uses elevation tokens, an inset hairline, a glass shadow and the shared frame radius.
// The component owns filtering and keyboard navigation; callers supply command data.

import { css, html, nothing, type PropertyValues } from 'lit'
import { AuElement } from './au-element'
import { floatingSurfaceMaterial } from './surface-material'
import { pickerMotion, pickerExitMotion, pickerKeyframes } from './picker-motion'

interface Item {
  id: string
  label: string
  detail?: string
  icon?: string
  shortcut?: string
  danger?: boolean
  group?: string
}

interface Section {
  label?: string
  rows: { item: Item; index: number }[]
}

export class AuCommandPaletteElement extends AuElement {
  static properties = {
    items: { attribute: false }, // complex data — set via property, never an attribute
    placeholder: { type: String },
    variant: { type: String, reflect: true },
    loading: { type: Boolean, reflect: true },
    _query: { state: true },
    _active: { state: true },
  }

  declare items?: Item[]
  declare placeholder?: string
  declare variant?: 'grouped' | 'compact'
  declare loading: boolean
  declare private _query: string
  declare private _active: number

  constructor() {
    super()
    this.loading = false
    this._query = ''
    this._active = 0
  }

  static styles = css`
    ${pickerKeyframes}
    :host {
      ${pickerMotion}
      display: block;
    }
    :host([data-state='closed']) {
      ${pickerExitMotion}
      animation-duration: var(--au-m-base, 220ms);
    }
    .cmdk {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      min-width: 0;
      width: min(calc(var(--au-space-1, 4px) * 160), 92vw);
      max-width: 100%;
      max-height: min(60vh, calc(var(--au-space-1, 4px) * 140));
      overflow: hidden;
      color: var(--au-ink-1, #e2dfda);
      ${floatingSurfaceMaterial}
      border-radius: var(--au-radius-frame, 14px);
      box-shadow:
        var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14)),
        var(--au-sh-glass,0 0 0 1px rgba(245, 243, 238, 0.06), inset 0 1px 0 rgba(245, 243, 238, 0.04), 0 24px 64px -16px rgba(0, 0, 0, 0.6));
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-variant-numeric: tabular-nums;
    }
    /* search row — a borderless field; the panel is the boundary, a hairline seams it off. */
    .search {
      display: flex;
      flex: none;
      align-items: center;
      gap: var(--au-space-3, 12px);
      padding-inline: var(--au-space-5, 20px);
      border-bottom: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.09));
    }
    .search-icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      color: var(--au-ink-3, #a09c92);
    }
    input {
      all: unset;
      box-sizing: border-box;
      flex: 1 1 auto;
      min-width: 0;
      height: calc(var(--au-space-1, 4px) * 13);
      color: var(--au-ink-1, #e2dfda);
      font-size: var(--au-t-body,16px);
      line-height: var(--au-lh-body,24px);
    }
    input::placeholder {
      color: var(--au-ink-4, #959083);
    }
    /* compact — a denser search row. */
    :host([variant='compact']) input {
      height: calc(var(--au-space-1, 4px) * 10);
    }
    /* body — the single scroll region. */
    .body {
      flex: 1 1 auto;
      min-height: 0;
    }
    .list-content:focus-visible { outline: none; }
    .list-content {
      padding: var(--au-space-2, 8px);
      padding-inline-end: var(--au-space-3, 12px);
    }
    .group {
      padding-bottom: var(--au-space-1, 4px);
    }
    .section {
      padding: var(--au-space-1, 4px) var(--au-space-2, 8px) var(--au-space-0-5, 2px);
      color: var(--au-ink-4, #959083);
      font-size: var(--au-t-2xs,11px);
      line-height: var(--au-lh-2xs,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: normal;
      text-transform: none;
    }
    /* a row — ListRow-shaped, with the wash selection language. */
    .row + .row { margin-top: var(--au-space-0-5, 2px); }
    .row {
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      box-sizing: border-box;
      min-height: var(--au-row-h, 32px);
      padding: var(--au-space-1, 4px) var(--au-space-2, 8px);
      border-radius: var(--au-radius-row, 8px);
      cursor: pointer;
      color: var(--au-ink-2, #d9d6cd);
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([variant='compact']) .row {
      padding-block: var(--au-space-0-5, 2px);
    }
    /* hover — the soft wash lift. */
    .row:hover {
      color: var(--au-ink-1, #e2dfda);
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
    }
    /* the keyboard cursor — a firmer wash than hover (raised specificity so it never downgrades). */
    .row[data-active],
    .row[data-active]:hover {
      color: var(--au-ink-1, #e2dfda);
      background: var(--au-chrome-active, rgba(255, 255, 255, 0.075));
    }
    .row .icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      color: var(--au-ink-3, #a09c92);
    }
    .row:hover .icon,
    .row[data-active] .icon {
      color: var(--au-ink-1, #e2dfda);
    }
    .labels {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1 1 auto;
    }
    .primary {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
    }
    .secondary {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--au-ink-4, #959083);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
    }
    /* the typed run — raised by ink WEIGHT, never hue. */
    .match {
      color: var(--au-ink-1, #e2dfda);
      background: transparent;
      font-weight: var(--au-w-strong,590);
    }
    /* destructive command — the one sanctioned hue, and only under the cursor. */
    .row[data-danger][data-active] .primary {
      color: var(--au-color-danger, #fb817c);
    }
    .shortcut {
      flex: none;
      margin-left: auto;
    }
    /* empty state. */
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--au-space-2, 8px);
      padding-block: var(--au-space-7,32px);
      color: var(--au-ink-4, #959083);
      text-align: center;
    }
    .empty .title {
      color: var(--au-ink-2, #d9d6cd);
      font-size: var(--au-t-sm, 13px);
    }
    /* footer legend — a keycap shelf one tint below the body. */
    .footer {
      display: flex;
      flex: none;
      align-items: center;
      gap: var(--au-space-4, 16px);
      flex-wrap: wrap;
      padding: var(--au-space-2, 8px) var(--au-space-4, 16px);
      background: transparent;
      border-top: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.09));
    }
    .hint {
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      color: var(--au-ink-4, #959083);
      font-size: var(--au-t-2xs,11px);
      line-height: var(--au-lh-2xs,16px);
    }
    @media (prefers-reduced-motion: reduce) { .row { transition: none; } }
    .hint--end {
      margin-left: auto;
    }
  `

  private get filtered(): Item[] {
    const q = this._query.trim().toLowerCase()
    const all = this.items ?? []
    return q
      ? all.filter(
          (i) => i.label.toLowerCase().includes(q) || (i.detail ?? '').toLowerCase().includes(q),
        )
      : all
  }

  // Cluster the filtered items into sections by their `group` (first-appearance order). An ungrouped
  // run forms a leading headerless section. Compact collapses everything into one flat section.
  private sectionsFor(items: Item[]): Section[] {
    if (this.variant === 'compact') return [{ rows: items.map((item, index) => ({ item, index })) }]
    const sections: Section[] = []
    const byLabel = new Map<string | undefined, Section>()
    items.forEach((item, index) => {
      const key = item.group
      let section = byLabel.get(key)
      if (!section) {
        section = { label: key, rows: [] }
        byLabel.set(key, section)
        sections.push(section)
      }
      section.rows.push({ item, index })
    })
    return sections
  }

  firstUpdated(): void {
    this.renderRoot.querySelector('input')?.focus()
  }

  updated(changed: PropertyValues): void {
    const items = this.filtered
    const active = Math.max(0, Math.min(this._active, items.length - 1))
    if (active !== this._active) { this._active = active; return }
    if (changed.has('_active') || changed.has('_query') || changed.has('items')) {
      this.renderRoot.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
    }
  }

  private onInput(e: Event): void {
    this._query = (e.target as HTMLInputElement).value
    this._active = 0

  }


  private onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
    const f = this.filtered
    if (e.key === 'ArrowDown') {
      if (e.target instanceof HTMLInputElement) {
        this.renderRoot.querySelector<HTMLElement>('[role=listbox]')?.focus()

      }
      this._active = Math.max(0, Math.min(this._active + 1, f.length - 1))
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      if (this._active===0 && !(e.target instanceof HTMLInputElement)) {this.renderRoot.querySelector<HTMLInputElement>('input')?.focus();e.preventDefault();return}
      this._active = Math.max(this._active - 1, 0)
      e.preventDefault()
    } else if (e.key === 'Enter') {
      this.run(f[this._active])
      e.preventDefault()
    } else if (e.key === 'Escape') {
      if (this._query) {
        this._query = ''
        this._active = 0

        this.renderRoot.querySelector<HTMLInputElement>('input')?.focus()
        e.preventDefault()
      }
    } else if (e.key.length===1 && !(e.target instanceof HTMLInputElement)) {
      this._query+=e.key;this._active=0;
      this.renderRoot.querySelector<HTMLInputElement>('input')?.focus();e.preventDefault()
    }
  }

  private run(item: Item | undefined): void {
    if (!item) return
    this.dispatchEvent(
      new CustomEvent('au-run', { bubbles: true, composed: true, detail: { id: item.id } }),
    )
  }

  private clear(): void {
    this._query = ''
    this._active = 0
    this.renderRoot.querySelector('input')?.focus()

  }

  // Raise the typed run inside a label by ink weight (never hue).
  private highlight(label: string) {
    const needle = this._query.trim()
    if (needle === '') return label
    const at = label.toLowerCase().indexOf(needle.toLowerCase())
    if (at === -1) return label
    return html`${label.slice(0, at)}<span class="match" part="match"
        >${label.slice(at, at + needle.length)}</span
      >${label.slice(at + needle.length)}`
  }

  private renderRow({ item, index }: { item: Item; index: number }) {
    return html`<div
      class="row"
      id=${`command-${index}`}
      part="item"
      role="option"
      aria-selected=${index === this._active}
      ?data-active=${index === this._active}
      ?data-danger=${!!item.danger}
      @click=${() => this.run(item)}
      @mousemove=${() => {
        if (this._active !== index) this._active = index
      }}
    >
      ${item.icon
        ? html`<span class="icon"><au-icon name=${item.icon} size="sm"></au-icon></span>`
        : nothing}
      <span class="labels">
        <span class="primary" part="label">${this.highlight(item.label)}</span>
        ${item.detail ? html`<span class="secondary" part="detail">${item.detail}</span>` : nothing}
      </span>
      ${item.shortcut
        ? html`<au-kbd class="shortcut" keys=${item.shortcut}></au-kbd>`
        : nothing}
    </div>`
  }

  render() {
    const f = this.filtered
    const sections = this.sectionsFor(f)
    const grouped = this.variant !== 'compact'
    return html`
      <div class="cmdk" part="palette" role="dialog" aria-label="Command palette">
        <div class="search">
          <span class="search-icon" aria-hidden="true">
            ${this.loading
              ? html`<au-spinner size="sm"></au-spinner>`
              : html`<au-icon name="search" size="sm"></au-icon>`}
          </span>
          <input
            part="input"
            role="combobox"
            aria-label="Search commands"
            aria-controls="command-results"
            aria-activedescendant=${f.length ? `command-${Math.min(this._active, f.length - 1)}` : nothing}
            aria-expanded="true"
            aria-autocomplete="list"
            autocomplete="off"
            spellcheck="false"
            .value=${this._query}
            placeholder=${this.placeholder ?? 'Type a command or search…'}

            @input=${this.onInput}
            @keydown=${this.onKey}
          />
          ${this._query
            ? html`<au-close-button
                part="dismiss"
                size="sm"
                label="Clear search"
                @au-activate=${this.clear}
              ></au-close-button>`
            : nothing}
        </div>
        <au-scroll-area class="body" axis="y"><div class="list-content" part="list" id="command-results" role="listbox" tabindex="0" @keydown=${this.onKey} aria-label="Results" aria-busy=${this.loading}>
          ${f.length
            ? sections.map(
                (s) => html`<div class="group" role="group" aria-label=${s.label ?? nothing}>
                  ${s.label ? html`<div class="section">${s.label}</div>` : nothing}
                  ${s.rows.map((r) => this.renderRow(r))}
                </div>`,
              )
            : html`<div class="empty" part="empty">
                <au-icon name="search" size="lg"></au-icon>
                <span class="title"
                  >${this._query ? `No results for “${this._query}”` : 'Type to search'}</span
                >
                <span>${this._query ? 'Try fewer or different words.' : 'Available commands appear here.'}</span>
              </div>`}
        </div></au-scroll-area>
        ${grouped
          ? html`<div class="footer" part="footer">
              <span class="hint"><au-kbd>↓</au-kbd> Select results · Type to filter</span>
              <span class="hint"><au-kbd keys="Enter"></au-kbd> Run</span>
              <span class="hint hint--end"><au-kbd keys="Escape"></au-kbd> Close</span>
            </div>`
          : nothing}
      </div>
    `
  }
}
