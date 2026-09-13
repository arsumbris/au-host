// <au-table> + its parts — the monochrome data grid, as a shadow-DOM compound. Each element carries its
// `display: table-*` role on its own `:host` and projects the next level through a `display:contents`
// `<slot>`, so the flattened tree reads `table > header-group > row > cell` across the shadow boundaries
// and the table layout algorithm aligns columns for free. Wrapped in a thin horizontal-scroll sliver.
//
// CROSS-SHADOW STATE rides INHERITED CSS CUSTOM PROPERTIES (a value set on an ancestor host pierces the
// slot boundary and resolves on the slotted descendants): `au-table[dense]` sets `--au-tcell-py`, which
// the cells read for their padding; a selected/hover `au-table-row` sets `--au-tcell-ink`, which the
// non-muted cells read for their text colour. A container can't reach its slotted descendants with a
// selector, so the shared variable is the join.
//
// The parts are separate tags because react-markdown maps table / thead / tbody / tr / th / td onto
// them one-for-one: <au-table> / <au-table-head> / <au-table-body> / <au-table-row> /
// <au-table-header-cell> / <au-table-cell>.

import { reducedControlMotion } from './control-motion'
import { css, html } from 'lit'
import { AuElement } from './au-element'
import { scrollbarStyle, horizontalScrollContentInset } from './scrollbar-style'
import { controlFocusStyle } from './focus-style'
/** The grid root: a horizontal-scroll sliver wrapping a `display:table` box. `dense` halves the cell padding. */
export class AuTableElement extends AuElement {
  static properties = {
    dense: { type: Boolean, reflect: true },
  }
  declare dense: boolean

  constructor() {
    super()
    this.dense = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      ${horizontalScrollContentInset}
      display: block;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
    }
    /* dense propagates to the slotted cells through this inherited var (a selector can't cross the slot). */
    :host([dense]) {
      --au-tcell-py: var(--au-space-1, 4px);
    }
    ${scrollbarStyle(css`:host`)}
    .grid {
      display: table;
      width: 100%;
      border-collapse: collapse;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      color: var(--au-ink-2, #c8c8c8);
      text-align: left;
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'table')
  }

  render() {
    return html`<div class="grid" part="grid"><slot></slot></div>`
  }
}

/** A thin `display:table-*` box whose only job is to carry its role across the slot boundary. */
class TablePart extends AuElement {
  static styles = css`
    ${reducedControlMotion}
    :host {
      display: contents;
    }
  `
  render() {
    return html`<slot></slot>`
  }
}

export class AuTableHeadElement extends TablePart {
  static styles = css`
    ${reducedControlMotion}
    :host {
      display: table-header-group;
    }
  `
  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'rowgroup')
  }
}

export class AuTableBodyElement extends TablePart {
  static styles = css`
    ${reducedControlMotion}
    :host {
      display: table-row-group;
    }
  `
  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'rowgroup')
  }
}

/** A row. `selectable` makes it a hover-lift + keyboard target that emits `au-select`; `selected` rests
 *  on a surface tint. Both LIFT the non-muted cells' ink via the inherited `--au-tcell-ink`. Emphasis is
 *  surface + ink, NEVER a leading rail. */
export class AuTableRowElement extends AuElement {
  static properties = {
    selectable: { type: Boolean, reflect: true },
    selected: { type: Boolean, reflect: true },
  }
  declare selectable: boolean
  declare selected: boolean

  constructor() {
    super()
    this.selectable = false
    this.selected = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: table-row;
      background: transparent;
      transition: background var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([selectable]) {
      cursor: pointer;
    }
    :host([selectable]:hover) {
      background: var(--au-chrome-hover);
      --au-tcell-ink: var(--au-ink-1, #e8e8e8);
    }
    :host([selected]) {
      background: var(--au-color-surface-2, #2a2a2a);
      --au-tcell-ink: var(--au-ink-1, #e8e8e8);
    }
    :host([selectable]:focus-visible) {
      ${controlFocusStyle}
    }
  `

  private onActivate = (e: Event): void => {
    if (!this.selectable) return
    if (e instanceof KeyboardEvent) {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
    }
    this.dispatchEvent(new CustomEvent('au-select', { bubbles: true, composed: true }))
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'row')
    this.addEventListener('click', this.onActivate)
    this.addEventListener('keydown', this.onActivate)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.removeEventListener('click', this.onActivate)
    this.removeEventListener('keydown', this.onActivate)
  }

  updated(): void {
    if (this.selectable) {
      this.setAttribute('tabindex', '0')
      this.setAttribute('aria-selected', String(this.selected))
    } else {
      this.removeAttribute('tabindex')
      this.removeAttribute('aria-selected')
    }
  }

  render() {
    return html`<slot></slot>`
  }
}

/** A header cell: the quiet sans label role. `align="end"` right-aligns; `sortable` makes the whole
 *  header a sort control (label + a rotating caret) that emits `au-sort`; `sort-dir` (asc | desc) marks the
 *  active column and points the caret. */
export class AuTableHeaderCellElement extends AuElement {
  static properties = {
    align: { type: String, reflect: true },
    sortable: { type: Boolean, reflect: true },
    sortDir: { type: String, reflect: true, attribute: 'sort-dir' },
  }
  declare align: 'start' | 'end'
  declare sortable: boolean
  declare sortDir?: 'asc' | 'desc'

  constructor() {
    super()
    this.align = 'start'
    this.sortable = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: table-cell;
      vertical-align: middle;
      box-sizing: border-box;
      padding: var(--au-tcell-py, var(--au-space-2, 8px)) var(--au-space-3, 12px);
      white-space: nowrap;
      font-family: var(--au-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      font-weight: var(--au-w-medium, 500);
      color: var(--au-ink-3, #9a9a9a);
      border-bottom: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.14));
    }
    :host([align='end']) {
      text-align: right;
    }
    .sort {
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      width: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      text-align: inherit;
      cursor: pointer;
    }
    :host([align='end']) .sort {
      justify-content: flex-end;
    }
    .sort:focus-visible {
      ${controlFocusStyle}
      border-radius: var(--au-radius-sm, 5px);
    }
    .sort:focus-visible .caret { opacity: 1; }
    .sort:hover {
      color: var(--au-ink-2, #c8c8c8);
    }
    .caret {
      flex: none;
      color: var(--au-ink-4, #959083);
      opacity: 0;
      transition:
        transform var(--au-m-base,220ms) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1)),
        opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .sort:hover .caret {
      opacity: 1;
      color: var(--au-ink-4, #777);
    }
    :host([sort-dir]) .label,
    :host([sort-dir]) .caret {
      color: var(--au-ink-2, #c8c8c8);
    }
    :host([sort-dir]) .caret {
      opacity: 1;
    }
    /* chevron-down rests pointing DOWN = descending; ascending flips it up. */
    :host([sort-dir='asc']) .caret {
      transform: rotate(180deg);
    }
  `

  private onSort = (): void => {
    this.dispatchEvent(new CustomEvent('au-sort', { bubbles: true, composed: true }))
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'columnheader')
  }

  updated(): void {
    if (this.sortable) {
      this.setAttribute('aria-sort', this.sortDir === 'asc' ? 'ascending' : this.sortDir === 'desc' ? 'descending' : 'none')
    } else {
      this.removeAttribute('aria-sort')
    }
  }

  render() {
    if (this.sortable) {
      return html`
        <button class="sort" type="button" @click=${this.onSort}>
          <span class="label"><slot></slot></span>
          <au-icon class="caret" name="chevron-down" size="sm"></au-icon>
        </button>
      `
    }
    return html`<span class="label"><slot></slot></span>`
  }
}

/** A body cell: `align="end"` right-aligns + tabular figures (numeric columns); `muted` dims one ink step.
 *  A non-muted cell lifts its ink to `--au-tcell-ink` when its row is hovered / selected. */
export class AuTableCellElement extends AuElement {
  static properties = {
    align: { type: String, reflect: true },
    muted: { type: Boolean, reflect: true },
  }
  declare align: 'start' | 'end'
  declare muted: boolean

  constructor() {
    super()
    this.align = 'start'
    this.muted = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: table-cell;
      vertical-align: middle;
      box-sizing: border-box;
      padding: var(--au-tcell-py, var(--au-space-2, 8px)) var(--au-space-3, 12px);
      white-space: nowrap;
      color: var(--au-tcell-ink, var(--au-ink-2, #c8c8c8));
      border-bottom: 1px solid var(--au-line-1, rgba(255, 255, 255, 0.09));
      transition: color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([align='end']) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    :host([muted]) {
      color: var(--au-ink-4, #777);
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'cell')
  }

  render() {
    return html`<slot></slot>`
  }
}
