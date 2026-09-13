// <au-typed-value-editor> — a recursive typed-value editor over a resolved shape.

// PRESENTATIONAL: it takes an already-RESOLVED shape tree (`schema`, a
// `ResolvedShape` from @arsumbris/typed-value) plus the current `value` and
// `diagnostics`, renders one control per field, and emits the collected value. It
// NEVER reads the graph, NEVER validates (the core does — diagnostics are passed
// in), and NEVER fires (it emits a value). So the command palette, an author-an-
// instance flow, and the agent tool bridge all share ONE editor.

// The `ResolvedShape` / `ValueDiagnostic` imports are TYPE-ONLY (erased) — the set
// gains no runtime dependency on the core.
//
// Layout: a dense tree with aligned controls and continuous nesting guides.
// - fixed-height rows; a leaf is a grid [toggle][left-aligned label][control][actions].
// - compound fields are collapsible BRANCHES; guide RAILS are derived from the
//   toggle width so the vertical sits on the parent chevron centre and the elbow on
//   the row centre; the through-rail caps at the last child.
// - an inline-or-reference field shows a distinct TYPE SWITCH (a structural choice,
//   visually unlike a form field).
// - lists reorder by drag; required/invalid fields show a danger marker + inline
//   message, and a collapsed branch rolls up a hidden-error count.

import { reducedControlMotion } from './control-motion'
import { css, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit'
import { AuElement } from './au-element'
import type { ResolvedShape, ResolvedField, ValueDiagnostic, EditorOption, ResolveOptions } from '@arsumbris/typed-value'

type Seg = string | number
type ValueMap = Record<string, unknown>

/** Depth at which a leaf drops to label-above so its control keeps room. */
const STACK_DEPTH = 4

export class AuTypedValueEditorElement extends AuElement {
  static properties = {
    schema: { attribute: false },
    value: { attribute: false },
    diagnostics: { attribute: false },
    resolveOptions: { attribute: false },
    submitLabel: { type: String, attribute: 'submit-label' },
    _open: { state: true },
    _drag: { state: true },
    _options: { state: true },
    _lookups: { state: true },
    _branch: { state: true },
    _docs: { state: true },
  }

  declare schema?: ResolvedShape
  declare value?: unknown
  declare diagnostics?: ValueDiagnostic[]
  /** The picker data source: `(slotPath, query) => Promise<EditorOption[]>`. Absent → references are free text. */
  declare resolveOptions?: ResolveOptions
  declare submitLabel: string
  declare private _open: Set<string>
  declare private _drag: { list: string; from: number } | null
  declare private _options: Map<string, EditorOption[]>
  declare private _branch: Map<string, number>
  declare private _docs: Set<string>

  private _lookups = new Map<string, { request: number; query: string; loading: boolean; failed: boolean }>()
  private _request = 0

  private _seededSchema?: ResolvedShape

  constructor() {
    super()
    this.submitLabel = 'Run'
    this._open = new Set()
    this._drag = null
    this._options = new Map()
    this._branch = new Map()
    this._docs = new Set()
  }

  // On a new schema, OPEN the required compound chain by default — a required record / list / union / & /
  // subtype-choice field starts expanded, so the required set is visible without clicking down to it.
  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('schema') && this.schema && this.schema !== this._seededSchema) {
      this._seededSchema = this.schema
      const seed = new Set<string>()
      seedOpen(this.schema, [], seed)
      this._open = seed
    }
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      container: typed-value-editor / inline-size;
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      font: var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans);
      color: var(--au-ink-1, #1a1a1a);
      /* the toggle column doubles as the indent step; all rail geometry derives from it */
      --tvv-toggle: var(--au-space-5, 20px);
      --tvv-label: clamp(88px, 34%, 200px);
      --tvv-rail: var(--au-line-2, #d9d9de);
      --tvv-row: calc(max(var(--au-row-h), var(--au-space-1, 4px) * 8) + var(--au-space-1, 4px));
      --tvv-mid: calc(var(--tvv-row) / 2);
      --tvv-railx: calc(-1 * var(--tvv-toggle) / 2); /* half a toggle left of the child = parent chevron centre */
    }
    .reference { display: grid; min-width: 0; gap: var(--au-space-1, 4px); }
    .lookup-error { display: flex; align-items: center; flex-wrap: wrap; gap: var(--au-space-1, 4px); color: var(--au-ink-2); font-size: var(--au-t-xs); }
    .root {
      padding: var(--au-space-2, 8px);
    }

    /* --- rows --- */
    .leaf,
    .header,
    .item {
      display: grid;
      align-items: center;
      column-gap: var(--au-space-2, 8px);
      grid-template-rows: minmax(var(--tvv-row), auto);
    }
    .leaf {
      grid-template-columns: var(--tvv-toggle) var(--tvv-label) minmax(0, 1fr) auto;
      grid-auto-rows: auto; /* an error line grows below row 1 */
    }
    .leaf.is-stacked {
      grid-template-columns: var(--tvv-toggle) minmax(0, 1fr);
      grid-template-rows: auto auto;
    }
    .leaf.is-stacked .toggle {
      grid-row: 1;
    }
    .leaf.is-stacked .control {
      grid-column: 2;
      grid-row: 2;
    }
    @container typed-value-editor (max-width: 22rem) {
      .leaf {
        grid-template-columns: var(--tvv-toggle) minmax(0, 1fr);
        grid-template-rows: auto auto;
        row-gap: var(--au-space-1, 4px);
        padding-block: var(--au-space-1, 4px);
      }
      .leaf > .label { grid-column: 2; grid-row: 1; }
      .leaf > .control { grid-column: 2; grid-row: 2; }
      .leaf > .constraint, .leaf > .err { grid-column: 2; }
      .leaf > .actions:empty { display: none; }
      .leaf > .toggle { grid-row: 1; height: var(--au-lh-sm); }
    }
    /* controls fill their cell (a textarea/input must not escape the slot) */
    .control > * {
      width: 100%;
      box-sizing: border-box;
    }
    .header,
    .item {
      grid-template-columns: var(--tvv-toggle) 1fr auto;
    }
    .item.node { grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto; }
    .item.node > .header { grid-column: 1; grid-row: 1; }
    .item.node > .actions { grid-column: 2; grid-row: 1; }
    .item.node > .body { grid-column: 1 / -1; grid-row: 2; }
    @container typed-value-editor (max-width: 22rem) {
      .item:not(.node) { grid-template-columns: var(--tvv-toggle) minmax(0, 1fr); }
      .item:not(.node) > .actions { grid-column: 2; justify-self: end; padding-block-end: var(--au-space-1); }
      .item.node > .header { grid-column: 1 / -1; }
      .item.node > .actions { grid-column: 1 / -1; grid-row: 2; justify-self: end; }
      .item.node > .body { grid-row: 3; }
    }
    .header {
      width: 100%;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: start;
      cursor: pointer;
      border-radius: var(--au-radius-sm, 5px);
    }
    .header:hover {
      background: var(--au-chrome-hover);
    }

    .toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--tvv-toggle);
      align-self: start;
      height: var(--tvv-row);
      color: var(--au-ink-3, #8a8a8a);
    }
    .chev {
      width: var(--au-t-xs);
      height: var(--au-t-xs);
      transition: transform var(--au-m-fast) var(--au-e-move);
    }
    .chev.is-open {
      transform: rotate(90deg);
    }
    .index {
      font-size: var(--au-t-xs);
      line-height: var(--au-lh-xs);
      color: var(--au-ink-3, #8a8a8a);
      font-variant-numeric: tabular-nums;
    }

    .label {
      align-self: center;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1);
      min-width: 0;
      color: var(--au-ink-1, #1a1a1a);
    }
    .label .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .leaf.is-stacked .label {
      align-self: end;
      font-size: var(--au-t-xs);
      line-height: var(--au-lh-xs);
      color: var(--au-ink-2, #555);
    }
    .header .label .name {
      font-weight: var(--au-w-medium);
    }
    .req {
      color: var(--au-color-danger, #fb817c);
    }
    /* the (i) docstring toggle + the expanded doc line */
    .info {
      display: inline-flex;
      flex: none;
      border: 0;
      background: none;
      padding: 0;
      cursor: pointer;
      color: var(--au-ink-3, #8a8a8a);
    }
    .info:hover {
      color: var(--au-ink-1, #1a1a1a);
    }
    .doc {
      grid-column: 2 / -1;
      align-self: start;
      font-size: var(--au-t-xs);
      line-height: var(--au-lh-xs);
      color: var(--au-ink-2, #555);
      padding-block-end: var(--au-space-1, 4px);
    }
    /* a branch's doc line, indented under its header */
    .branchdoc {
      padding-inline-start: var(--tvv-toggle);
      padding-block: var(--au-space-0-5);
      font-size: var(--au-t-xs);
      line-height: var(--au-lh-xs);
      color: var(--au-ink-2, #555);
    }
    /* the field's TYPE, shown in the expanded (i) view (monospace, ahead of the docstring) */
    .tvv-type {
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      color: var(--au-ink-1, #1a1a1a);
    }
    .control {
      align-self: center;
      min-width: 0;
    }
    .constraint {
      grid-column: 3 / -1;
      font-size: var(--au-t-xs);
      line-height: var(--au-lh-xs);
      color: var(--au-ink-3);
      overflow-wrap: anywhere;
      padding-block-end: var(--au-space-1, 4px);
    }
    .leaf.is-stacked .constraint { grid-column: 2 / -1; }
    .meta {
      justify-self: end;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      font-size: var(--au-t-xs);
      line-height: var(--au-lh-xs);
      color: var(--au-ink-3, #8a8a8a);
    }
    /* inline error, spanning under the control */
    .err {
      grid-column: 3 / -1;
      align-self: start;
      font-size: var(--au-t-xs);
      line-height: var(--au-lh-xs);
      color: var(--au-color-danger, #fb817c);
      padding-block-end: var(--au-space-1, 4px);
    }
    .leaf.is-stacked .err {
      grid-column: 2 / -1;
    }
    /* a rolled-up error count on a collapsed branch — an outlined danger count (no fill = no contrast token needed) */
    .rollup {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: var(--au-space-4);
      height: var(--au-space-4);
      padding: 0 var(--au-space-1);
      border-radius: var(--au-radius-pill);
      border: 1px solid var(--au-color-danger, #fb817c);
      color: var(--au-color-danger, #fb817c);
      font-size: var(--au-t-2xs);
      line-height: var(--au-lh-2xs);
      font-variant-numeric: tabular-nums;
    }

    /* hover-revealed row actions */
    .actions {
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-0-5, 2px);
      opacity: 0;
      transition: opacity var(--au-m-fast) var(--au-e-std);
    }
    .leaf:hover .actions,
    .leaf:focus-within .actions,
    .item:hover > .actions,
    .item:focus-within > .actions,
    .node:hover > .header .actions,
    .node:focus-within > .header .actions {
      opacity: 1;
    }
    .grip {
      cursor: grab;
      color: var(--au-ink-3, #8a8a8a);
      display: inline-flex;
    }

    /* --- the type switch (inline-or-reference): a structural choice, not a form field --- */
    .typeswitch {
      display: inline-flex;
      border: 1px solid var(--au-line-2, #d9d9de);
      border-radius: var(--au-radius-chip, 6px);
      overflow: hidden;
      font-size: var(--au-t-2xs);
      line-height: var(--au-lh-2xs);
      background: transparent;
    }
    .typeswitch button {
      border: 0;
      background: none;
      padding: 1px var(--au-space-1, 4px);
      cursor: pointer;
      color: var(--au-ink-3, #8a8a8a);
      font: inherit;
      line-height: var(--au-lh-2xs);
    }
    .typeswitch button.is-active {
      background: var(--au-chrome-active);
      color: var(--au-ink-1, #1a1a1a);
      font-weight: var(--au-w-strong);
    }

    /* --- nesting: indented body + rails derived from the toggle width --- */
    .body {
      padding-inline-start: var(--tvv-toggle);
    }
    .body > .node,
    .body > .leaf,
    .body > .item {
      position: relative;
    }
    .body > .node::before,
    .body > .leaf::before,
    .body > .item::before {
      content: '';
      position: absolute;
      inset-inline-start: var(--tvv-railx);
      top: 0;
      width: calc(var(--tvv-toggle) / 2 + 3px);
      height: var(--tvv-mid);
      border-inline-start: 1px solid var(--tvv-rail);
      border-block-end: 1px solid var(--tvv-rail);
      border-end-start-radius: var(--au-radius-sm, 5px);
      pointer-events: none;
    }
    .body > .node:not(:last-child)::after,
    .body > .leaf:not(:last-child)::after,
    .body > .item:not(:last-child)::after {
      content: '';
      position: absolute;
      inset-inline-start: var(--tvv-railx);
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--tvv-rail);
      pointer-events: none;
    }
    .item[data-drop='true']::before {
      border-color: var(--au-color-accent, #6dbbec);
    }

    .add {
      display: inline-flex;
      margin-block: var(--au-space-0-5, 2px);
      margin-inline-start: var(--tvv-toggle);
    }
    .note {
      font-size: var(--au-t-xs);
      line-height: var(--au-lh-xs);
      color: var(--au-ink-3, #8a8a8a);
      padding-block: var(--au-space-1, 4px);
    }
    .footer {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--au-space-2, 8px);
    }
  `

  // ---- value navigation (immutable) ----

  private valueAt(path: Seg[]): unknown {
    let v: unknown = this.value
    for (const seg of path) {
      if (v == null) return undefined
      v = (v as Record<Seg, unknown>)[seg]
    }
    return v
  }

  private setAt(path: Seg[], v: unknown): void {
    const next = setIn(this.value, path, v)
    this.value = next
    this.dispatchEvent(new CustomEvent('au-value-change', { bubbles: true, composed: true, detail: { value: next } }))
  }

  private isOpen(path: Seg[]): boolean {
    return this._open.has(keyOf(path))
  }

  private toggle(path: Seg[]): void {
    const next = new Set(this._open)
    const k = keyOf(path)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    this._open = next
  }

  private complete(): void {
    this.dispatchEvent(
      new CustomEvent('au-value-complete', { bubbles: true, composed: true, detail: { value: this.value ?? {} } }),
    )
  }

  // ---- diagnostics (passed in; the element never validates) ----

  private errorsAt(path: Seg[]): string[] {
    return (this.diagnostics ?? []).filter((d) => samePath(d.path, path)).map((d) => d.message)
  }

  private rollupAt(path: Seg[]): number {
    return (this.diagnostics ?? []).filter((d) => underPath(d.path, path)).length
  }

  // ---- render ----

  render(): TemplateResult {
    if (!this.schema) return html`<div class="root note">No shape to edit.</div>`
    return html`
      <div class="root">
        ${this.renderChildren(this.schema, [], 0)}
        <div class="footer">
          <au-button variant="primary" @click=${() => this.complete()}>${this.submitLabel}</au-button>
        </div>
      </div>
    `
  }

  private renderChildren(shape: ResolvedShape, path: Seg[], depth: number): TemplateResult {
    const rec = asRecord(shape)
    if (rec) return html`${rec.fields.map((f) => this.renderField(f.name, f.shape, f.required, f.doc, [...path, f.name], depth))}`
    if (shape.kind === 'list') return this.renderList(shape, path, depth)
    return this.renderField('value', shape, true, undefined, path, depth)
  }

  private renderField(name: string, shape: ResolvedShape, required: boolean, doc: string | undefined, path: Seg[], depth: number): TemplateResult {
    if (shape.kind === 'inline-or-reference') return this.renderInlineOrRef(name, required, doc, shape, path, depth)
    if (shape.kind === 'record-choice') return this.renderRecordChoice(name, required, doc, shape, path, depth)
    if (shape.kind === 'union') return this.renderUnion(name, required, doc, shape, path, depth)
    if (shape.kind === 'intersection') return this.renderIntersection(name, required, doc, shape, path, depth)
    if (isCompound(shape)) return this.renderBranch(name, required, doc, shape, path, depth)
    return this.renderLeaf(name, required, doc, shape, path, depth)
  }

  /** A union: a branch SELECTOR picks the active member; a record member reads as a nested branch, a scalar
   *  member as an inline control. A record member writes its `type:`; a scalar member self-discriminates by value. */
  private renderUnion(name: string, required: boolean, doc: string | undefined, shape: ResolvedShape & { kind: 'union' }, path: Seg[], depth: number): TemplateResult {
    const branches = shape.branches
    const active = this.activeBranch(path, branches)
    const activeShape = branches[active]!
    const selector = html`<au-select
      aria-label=${`Type for ${path.map(String).join(' → ') || 'Value'}`}
      @click=${(e: Event) => e.stopPropagation()}
      .options=${branches.map((b, i) => ({ value: String(i), label: kindLabel(b) }))}
      .value=${String(active)}
      @au-change=${(e: Event) => this.setBranch(path, Number((e.target as unknown as { value: string }).value), branches)}
    ></au-select>`
    const rec = asRecord(activeShape)
    if (rec) {
      const open = this.isOpen(path)
      return html`<div class="node">
        <div class="header" role="button" tabindex="0" aria-expanded=${open} @click=${() => this.toggle(path)} @keydown=${(e: KeyboardEvent) => this.headerKey(e, path)}>
          <span class="toggle"><span class="chev${open ? ' is-open' : ''}">${chevron()}</span></span>
          ${this.labelCell(name, required, doc, path)}
          <span class="meta">${selector}</span>
        </div>
        ${this.branchInfo(shape, doc, path)}
        ${open ? html`<div class="body">${this.renderChildren(rec, path, depth + 1)}</div>` : nothing}
      </div>`
    }
    const errs = this.errorsAt(path)
    return html`<div class="leaf">
      <span class="toggle"></span>
      ${this.labelCell(name, required, doc, path)}
      <span class="control">${this.renderControl(activeShape, path, errs.length > 0, required)}</span>
      <span class="meta">${selector}</span>
      ${this.docOpen(path) ? html`<span class="doc"><span class="tvv-type">${typeLabel(shape)}</span>${doc ? html` — ${doc}` : nothing}</span>` : nothing}
      ${errs.length ? html`<span class="err">${errs.join('. ')}</span>` : nothing}
    </div>`
  }

  /** The active union branch: an explicit pick, else inferred from the current value, else the first. */
  private activeBranch(path: Seg[], branches: ResolvedShape[]): number {
    const override = this._branch.get(keyOf(path))
    if (override !== undefined) return override
    const v = this.valueAt(path)
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const t = (v as ValueMap).type
      const i = branches.findIndex((b) => asRecord(b)?.typeName === t)
      if (i >= 0) return i
      return branches.findIndex((b) => asRecord(b) !== undefined)
    }
    if (typeof v === 'string' && v !== '') {
      const i = branches.findIndex((b) => b.kind === 'reference' || b.kind === 'def-reference')
      if (i >= 0) return i
    }
    return 0
  }

  private setBranch(path: Seg[], i: number, branches: ResolvedShape[]): void {
    this._branch = new Map(this._branch).set(keyOf(path), i)
    const rec = asRecord(branches[i]!)
    this.setAt(path, rec ? { type: rec.typeName } : '')
  }

  /** A record-choice: THE GENERAL SUBTYPE SELECTOR. A slot `field: T` accepts T or any `T' < T` (width-only
   *  subtyping adds fields). A CLAIMABLE (concrete) ceiling defaults to itself, the selector OPTIONAL; a
   *  non-claimable (abstract / sealed) ceiling REQUIRES a concrete pick. The chosen option's fields fill the
   *  branch body, and the value stamps that option's `type:`. */
  private renderRecordChoice(name: string, required: boolean, doc: string | undefined, shape: ResolvedShape & { kind: 'record-choice' }, path: Seg[], depth: number): TemplateResult {
    const open = this.isOpen(path)
    const rollup = open ? 0 : this.rollupAt(path)
    const errs = this.errorsAt(path)
    const active = this.activeChoice(path, shape)
    const option = active >= 0 ? shape.options[active] : undefined
    return html`<div class="node">
      <div class="header" role="button" tabindex="0" aria-expanded=${open} @click=${() => this.toggle(path)} @keydown=${(e: KeyboardEvent) => this.headerKey(e, path)}>
        <span class="toggle"><span class="chev${open ? ' is-open' : ''}">${chevron()}</span></span>
        ${this.labelCell(name, required, doc, path)}
        <span class="meta">${this.choiceSelector(path, shape, active)}${rollup ? html`<span class="rollup" title="${rollup} problem(s) inside">${rollup}</span>` : nothing}</span>
      </div>
      ${this.branchInfo(shape, doc, path)}
      ${errs.length ? html`<div class="branchdoc err">${errs.join('. ')}</div>` : nothing}
      ${open
        ? html`<div class="body">
            ${option
              ? this.renderChildren({ kind: 'record', typeName: option.typeName, fields: option.fields }, path, depth + 1)
              : html`<div class="note">Select a type to fill.</div>`}
          </div>`
        : nothing}
    </div>`
  }

  /** The subtype `au-select`. A non-claimable ceiling prepends a "select type…" placeholder (no default). */
  private choiceSelector(path: Seg[], shape: ResolvedShape & { kind: 'record-choice' }, active: number): TemplateResult {
    const opts = shape.options.map((o, i) => ({ value: String(i), label: o.label }))
    const options = shape.claimable ? opts : [{ value: '', label: 'select type…' }, ...opts]
    return html`<au-select
      aria-label=${path.map(String).join(' → ') || 'Value'}
      aria-description=${this.errorsAt(path).join('\n') || nothing}
      aria-invalid=${this.errorsAt(path).length > 0 ? 'true' : 'false'}
      .options=${options}
      .value=${active >= 0 ? String(active) : ''}
      @au-change=${(e: Event) => this.setChoice(path, (e.target as unknown as { value: string }).value, shape)}
      @click=${(e: Event) => e.stopPropagation()}
    ></au-select>`
  }

  /** The active option index: an explicit pick, else inferred from the value's `type:`, else the base
   *  (claimable) or none (non-claimable → a pick is required). */
  private activeChoice(path: Seg[], shape: ResolvedShape & { kind: 'record-choice' }): number {
    const override = this._branch.get(keyOf(path))
    if (override !== undefined) return override
    const v = this.valueAt(path)
    const t = v && typeof v === 'object' && !Array.isArray(v) ? (v as ValueMap).type : undefined
    if (typeof t === 'string') {
      const i = shape.options.findIndex((o) => o.typeName === t)
      if (i >= 0) return i
    }
    return shape.claimable ? 0 : -1
  }

  private setChoice(path: Seg[], value: string, shape: ResolvedShape & { kind: 'record-choice' }): void {
    if (value === '') {
      this._branch = new Map(this._branch).set(keyOf(path), -1)
      this.setAt(path, {}) // cleared back to no type (non-claimable placeholder)
      return
    }
    const i = Number(value)
    this._branch = new Map(this._branch).set(keyOf(path), i)
    const cur = this.valueAt(path)
    const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as ValueMap) : {}
    // Keep shared field values; stamp the chosen concrete type. `type:` is optional at a concrete pinned slot
    // but always valid, and REQUIRED at a non-claimable ceiling — so stamping is uniformly correct.
    this.setAt(path, { ...base, type: shape.options[i]!.typeName })
  }

  /** An intersection (`<a & b>`): the MERGED field set of the record branches, the value a mixin `type: [a, b]`.
   *  Same-named fields across branches are qualified `name@Type` (the engine's field-qualifier rule). */
  private renderIntersection(name: string, required: boolean, doc: string | undefined, shape: ResolvedShape & { kind: 'intersection' }, path: Seg[], depth: number): TemplateResult {
    const recs = shape.branches.map(asRecord).filter((r): r is ResolvedShape & { kind: 'record' } => r !== undefined)
    const names = recs.map((r) => r.typeName)
    const counts = new Map<string, number>()
    for (const r of recs) for (const f of r.fields) counts.set(f.name, (counts.get(f.name) ?? 0) + 1)
    const open = this.isOpen(path)
    return html`<div class="node">
      <div class="header" role="button" tabindex="0" aria-expanded=${open}
        @click=${() => { this.stampMixin(path, names); this.toggle(path) }}
        @keydown=${(e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.stampMixin(path, names); this.toggle(path) } }}>
        <span class="toggle"><span class="chev${open ? ' is-open' : ''}">${chevron()}</span></span>
        ${this.labelCell(name, required, doc, path)}
        <span class="meta">${names.join(' & ')}</span>
      </div>
      ${this.branchInfo(shape, doc, path)}
      ${open ? html`<div class="body">${recs.flatMap((r) => r.fields.map((f) => {
        const key = (counts.get(f.name) ?? 0) > 1 ? `${f.name}@${r.typeName}` : f.name
        const label = (counts.get(f.name) ?? 0) > 1 ? `${f.name} (${r.typeName})` : f.name
        return this.renderField(label, f.shape, f.required, f.doc, [...path, key], depth + 1)
      }))}</div>` : nothing}
    </div>`
  }

  /** Ensure an intersection value carries its `type: [a, b]` mixin claim. */
  private stampMixin(path: Seg[], names: string[]): void {
    const v = this.valueAt(path)
    if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as ValueMap).type)) return
    const base = v && typeof v === 'object' && !Array.isArray(v) ? (v as ValueMap) : {}
    this.setAt(path, { ...base, type: names })
  }

  private renderLeaf(name: string, required: boolean, doc: string | undefined, shape: ResolvedShape, path: Seg[], depth: number): TemplateResult {
    const errs = this.errorsAt(path)
    // multi-line controls (opaque any, pinned-with-note) stack so the row grows instead of overflowing.
    const stacked = depth >= STACK_DEPTH || shape.kind === 'any' || shape.kind === 'pinned'
    return html`<div class="leaf${stacked ? ' is-stacked' : ''}">
      <span class="toggle"></span>
      ${this.labelCell(name, required, doc, path)}
      <span class="control">${this.renderControl(shape, path, errs.length > 0, required)}</span>
      ${stacked ? nothing : html`<span class="actions"></span>`}
      ${shape.kind === 'refined' ? html`<span class="constraint">${refinementHint(shape)}</span>` : nothing}
      ${this.docOpen(path) ? html`<span class="doc"><span class="tvv-type">${typeLabel(shape)}</span>${doc ? html` — ${doc}` : nothing}</span>` : nothing}
      ${errs.length ? html`<span class="err">${errs.join('. ')}</span>` : nothing}
    </div>`
  }

  private renderBranch(name: string, required: boolean, doc: string | undefined, shape: ResolvedShape, path: Seg[], depth: number): TemplateResult {
    const open = this.isOpen(path)
    const rollup = open ? 0 : this.rollupAt(path)
    return html`<div class="node">
      <div class="header" role="button" tabindex="0" aria-expanded=${open} @click=${() => this.toggle(path)} @keydown=${(e: KeyboardEvent) => this.headerKey(e, path)}>
        <span class="toggle"><span class="chev${open ? ' is-open' : ''}">${chevron()}</span></span>
        ${this.labelCell(name, required, doc, path)}
        <span class="meta">
          <span>${this.branchMeta(shape, path, open)}</span>
          ${rollup ? html`<span class="rollup" title="${rollup} problem(s) inside">${rollup}</span>` : nothing}
        </span>
      </div>
      ${this.branchInfo(shape, doc, path)}
      ${open ? html`<div class="body">${this.renderBranchBody(shape, path, depth + 1)}</div>` : nothing}
    </div>`
  }

  /** An inline-or-reference field is ALWAYS a branch: the header carries the type SWITCH, and the body holds
   *  either the inline record's fields or the reference picker — both nested under the field, so toggling the
   *  mode never changes the tree structure. */
  private renderInlineOrRef(name: string, required: boolean, doc: string | undefined, shape: ResolvedShape & { kind: 'inline-or-reference' }, path: Seg[], depth: number): TemplateResult {
    const isRef = typeof this.valueAt(path) === 'string'
    const open = this.isOpen(path)
    const rollup = open ? 0 : this.rollupAt(path)
    // A concrete inner pins its `type:`; a subtype-choice inner (abstract/sealed ceiling) starts bare and its
    // own selector picks the concrete `type:` — stamping the abstract ceiling here would be invalid.
    const inlineSeed: ValueMap = shape.record.kind === 'record' ? { type: shape.record.typeName } : {}
    const sw = html`<span class="typeswitch" role="group" aria-label="inline or reference">
      <button class=${!isRef ? 'is-active' : ''} aria-pressed=${!isRef} @click=${(e: Event) => { e.stopPropagation(); if (isRef) this.setAt(path, inlineSeed) }}>inline</button>
      <button class=${isRef ? 'is-active' : ''} aria-pressed=${isRef} @click=${(e: Event) => { e.stopPropagation(); if (!isRef) this.setAt(path, '') }}>ref</button>
    </span>`
    return html`<div class="node">
      <div class="header" role="button" tabindex="0" aria-expanded=${open} @click=${() => this.toggle(path)} @keydown=${(e: KeyboardEvent) => this.headerKey(e, path)}>
        <span class="toggle"><span class="chev${open ? ' is-open' : ''}">${chevron()}</span></span>
        ${this.labelCell(name, required, doc, path)}
        <span class="meta"><span>${shape.typeName}</span>${rollup ? html`<span class="rollup">${rollup}</span>` : nothing}${sw}</span>
      </div>
      ${this.branchInfo(shape, doc, path)}
      ${open
        ? html`<div class="body">
            ${isRef ? this.renderRefRow(shape.typeName, path, required) : this.renderChildren(shape.record, path, depth + 1)}
          </div>`
        : nothing}
    </div>`
  }

  /** The nested reference-picker row of an inline-or-reference field in `ref` mode. */
  private renderRefRow(typeName: string, path: Seg[], required: boolean): TemplateResult {
    const errs = this.errorsAt(path)
    return html`<div class="leaf">
      <span class="toggle"></span>
      <span class="label">reference</span>
      <span class="control">${this.renderControl({ kind: 'reference', typeName }, path, errs.length > 0, required)}</span>
      <span class="actions"></span>
      ${errs.length ? html`<span class="err">${errs.join('. ')}</span>` : nothing}
    </div>`
  }

  private headerKey(e: KeyboardEvent, path: Seg[]): void {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.toggle(path)
    }
  }

  /** The label cell: the FIELD NAME (never the docstring) + a required marker + an (i) toggle. The (i) is
   *  ALWAYS present — expanded it reveals the field's TYPE (and its docstring when it has one). */
  private labelCell(name: string, required: boolean, _doc: string | undefined, path: Seg[]): TemplateResult {
    return html`<span class="label">
      <span class="name" title=${name}>${name}</span>
      ${required ? html`<span class="req" title="required">*</span>` : nothing}
      <button class="info" title="Show type and description" aria-label=${`Type and description for ${name}`} aria-expanded=${this.docOpen(path)} @click=${(e: Event) => { e.stopPropagation(); this.toggleDoc(path) }}>${infoGlyph()}</button>
    </span>`
  }

  private toggleDoc(path: Seg[]): void {
    const next = new Set(this._docs)
    const k = keyOf(path)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    this._docs = next
  }

  private docOpen(path: Seg[]): boolean {
    return this._docs.has(keyOf(path))
  }

  /** The info line shown under a branch header when its (i) is toggled: the branch's TYPE, then its doc. */
  private branchInfo(shape: ResolvedShape, doc: string | undefined, path: Seg[]): TemplateResult | typeof nothing {
    if (!this.docOpen(path)) return nothing
    return html`<div class="branchdoc"><span class="tvv-type">${typeLabel(shape)}</span>${doc ? html` — ${doc}` : nothing}</div>`
  }

  private branchMeta(shape: ResolvedShape, path: Seg[], open: boolean): string {
    if (shape.kind === 'list') {
      const arr = this.valueAt(path)
      const n = Array.isArray(arr) ? arr.length : 0
      return `list · ${n} item${n === 1 ? '' : 's'}`
    }
    const rec = asRecord(shape)
    const type = rec?.typeName ?? shape.kind
    if (!open && rec) {
      const v = this.valueAt(path)
      const filled = v && typeof v === 'object' ? Object.keys(v as ValueMap).filter((k) => k !== 'type').length : 0
      return `${type} · ${filled}/${rec.fields.length}`
    }
    return type
  }

  private renderBranchBody(shape: ResolvedShape, path: Seg[], depth: number): TemplateResult {
    const rec = asRecord(shape)
    if (rec) return this.renderChildren(rec, path, depth)
    if (shape.kind === 'list') return this.renderList(shape, path, depth)
    if (shape.kind === 'record-choice') {
      // embedded (e.g. a list item whose inner is a subtype choice): a selector row, then the active fields.
      const active = this.activeChoice(path, shape)
      const option = active >= 0 ? shape.options[active] : undefined
      return html`
        <div class="leaf"><span class="toggle"></span><span class="label">type</span><span class="control">${this.choiceSelector(path, shape, active)}</span></div>
        ${option ? this.renderChildren({ kind: 'record', typeName: option.typeName, fields: option.fields }, path, depth) : html`<div class="note">Select a type to fill.</div>`}
      `
    }
    return html`<div class="note">nothing to edit</div>`
  }

  private renderList(shape: ResolvedShape & { kind: 'list' }, path: Seg[], depth: number): TemplateResult {
    const arr = Array.isArray(this.valueAt(path)) ? (this.valueAt(path) as unknown[]) : []
    const inner = shape.inner
    const listKey = keyOf(path)
    return html`
      ${arr.map((_it, i) => {
        const itemPath = [...path, i]
        const dragAttrs = {
          draggable: 'true',
          '@dragstart': () => (this._drag = { list: listKey, from: i }),
          '@dragover': (e: DragEvent) => { if (this._drag?.list === listKey) e.preventDefault() },
          '@drop': (e: DragEvent) => { e.preventDefault(); this.moveItem(path, i) },
          '@dragend': () => (this._drag = null),
        }
        const grip = html`<span class="grip" title="Drag to reorder"><au-grip-glyph></au-grip-glyph></span>`
        const move = html`${([-1, 1] as const).map(direction => html`<au-icon-button
          data-list-move=${listKey} data-item-index=${i} data-direction=${direction}
          size="xs" surface="panel" label=${`Move item ${i + 1} ${direction < 0 ? 'up' : 'down'} in ${path.map(String).join(' → ') || 'list'}`}
          ?disabled=${i + direction < 0 || i + direction >= arr.length}
          @au-activate=${() => this.reorderItem(path, i, i + direction, direction)}
        ><au-icon name=${direction < 0 ? 'chevron-up' : 'chevron-down'} size="sm"></au-icon></au-icon-button>`)}`
        const remove = html`<au-icon-button data-list-remove=${listKey} size="xs" surface="panel" label=${`Remove item ${i + 1} from ${path.map(String).join(' → ') || 'list'}`} @au-activate=${() => this.removeItem(path, i)}><au-icon name="trash" size="sm"></au-icon></au-icon-button>`
        if (isCompound(inner)) {
          const open = this.isOpen(itemPath)
          const rollup = open ? 0 : this.rollupAt(itemPath)
          return html`<div class="node item" draggable=${dragAttrs.draggable}
            @dragstart=${dragAttrs['@dragstart']} @dragover=${dragAttrs['@dragover']} @drop=${dragAttrs['@drop']} @dragend=${dragAttrs['@dragend']}>
            <button class="header" aria-expanded=${open} @click=${() => this.toggle(itemPath)}>
              <span class="toggle"><span class="chev${open ? ' is-open' : ''}">${chevron()}</span></span>
              <span class="label">${i + 1}</span>
              <span class="meta"><span>${asRecord(inner)?.typeName ?? inner.kind}</span>${rollup ? html`<span class="rollup">${rollup}</span>` : nothing}</span>
            </button>
            ${open ? html`<div class="body">${this.renderBranchBody(inner, itemPath, depth + 1)}</div>` : nothing}
            <span class="actions">${grip}${move}${remove}</span>
          </div>`
        }
        return html`<div class="item" draggable=${dragAttrs.draggable}
          @dragstart=${dragAttrs['@dragstart']} @dragover=${dragAttrs['@dragover']} @drop=${dragAttrs['@drop']} @dragend=${dragAttrs['@dragend']}>
          <span class="toggle"><span class="index">${i + 1}</span></span>
          <span class="control">${this.renderControl(inner, itemPath, this.errorsAt(itemPath).length > 0)}</span>
          <span class="actions">${grip}${move}${remove}</span>
        </div>`
      })}
      <div class="add"><au-button data-list-add=${listKey} variant="ghost" @click=${() => this.addItem(path, shape)}>+ Add item</au-button></div>
      ${arr.length < shape.min ? html`<div class="note">at least ${shape.min} required</div>` : nothing}
    `
  }

  private addItem(path: Seg[], shape: ResolvedShape & { kind: 'list' }): void {
    const arr = Array.isArray(this.valueAt(path)) ? [...(this.valueAt(path) as unknown[])] : []
    arr.push(seedFor(shape.inner))
    this.setAt(path, arr)
  }

  private removeItem(path: Seg[], i: number): void {
    const arr = Array.isArray(this.valueAt(path)) ? [...(this.valueAt(path) as unknown[])] : []
    arr.splice(i, 1)
    this.remapListState(path, index => index === i ? null : index > i ? index - 1 : index)
    this.setAt(path, arr)
    void this.updateComplete.then(() => {
      if (!this.isConnected) return
      const key = keyOf(path)
      const removals = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-list-remove]')]
        .filter(element => element.dataset.listRemove === key)
      const add = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-list-add]')]
        .find(element => element.dataset.listAdd === key)
      ;(removals[Math.min(i, removals.length - 1)] ?? add)?.focus()
    })
  }

  private moveItem(path: Seg[], to: number): void {
    const drag = this._drag
    if (!drag || drag.list !== keyOf(path)) return
    this._drag = null
    this.reorderItem(path, drag.from, to)
  }

  private reorderItem(path: Seg[], from: number, to: number, direction?: number): void {
    const arr = Array.isArray(this.valueAt(path)) ? [...(this.valueAt(path) as unknown[])] : []
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    this.remapListState(path, index => {
      if (index === from) return to
      if (from < to && index > from && index <= to) return index - 1
      if (from > to && index >= to && index < from) return index + 1
      return index
    })
    this.setAt(path, arr)
    if (direction === undefined) return
    void this.updateComplete.then(() => {
      if (!this.isConnected) return
      const controls = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-list-move]')]
        .filter(element => element.dataset.listMove === keyOf(path) && element.dataset.itemIndex === String(to) && !element.hasAttribute('disabled'))
      const target = controls.find(element => element.dataset.direction === String(direction)) ?? controls[0]
      target?.focus()
    })
  }

  /** Keep item-local disclosure and type choices attached to their values after list edits. */
  private remapListState(path: Seg[], destination: (index: number) => number | null): void {
    const remap = (key: string): string | null => {
      const segments: Seg[] = JSON.parse(key)
      if (!path.every((segment, index) => segments[index] === segment)) return key
      const index = segments[path.length]
      if (typeof index !== 'number') return key
      const next = destination(index)
      if (next === null) return null
      segments[path.length] = next
      return keyOf(segments)
    }
    const remapSet = (source: Set<string>): Set<string> => new Set(
      [...source].map(remap).filter((key): key is string => key !== null),
    )
    this._open = remapSet(this._open)
    this._docs = remapSet(this._docs)
    this._branch = new Map([...this._branch].flatMap(([key, value]) => {
      const next = remap(key)
      return next === null ? [] : [[next, value] as const]
    }))
  }

  // ---- leaf controls ----

  private renderControl(shape: ResolvedShape, path: Seg[], invalid: boolean, required = false): TemplateResult {
    const cur = this.valueAt(path)
    switch (shape.kind) {
      case 'primitive':
        if (shape.name === 'Number') return this.numberControl(path, cur, invalid, required)
        if (shape.name === 'Boolean') return this.checkboxControl(path, cur, required)
        return this.textControl(path, cur, invalid, required)
      case 'refined': {
        const hint = refinementHint(shape)
        return shape.base === 'Number' ? this.numberControl(path, cur, invalid, required, hint) : this.textControl(path, cur, invalid, required, undefined, hint)
      }
      case 'enum':
        return this.selectControl(path, cur, shape.members.map((m) => ({ value: m, label: m })), required)
      case 'def-reference':
        return this.selectControl(path, cur, shape.candidates.map((c) => ({ value: c.name, label: c.label })), required)
      case 'reference':
        return this.referenceControl(path, cur, shape.typeName, invalid, required)
      case 'compound-reference':
        // a reference constrained to a union/intersection of ceilings; the host's resolveOptions filters.
        return this.referenceControl(path, cur, shape.typeNames.join(` ${shape.op === 'union' ? '|' : '&'} `), invalid, required)
      case 'any':
        return this.anyControl(path, cur, required)
      case 'pinned':
        // STANDIN: a commit-pin needs a commit source the host does not expose yet, so the inner reference is
        // editable but the required `@commit` cannot be entered — surfaced, not faked.
        return html`${this.renderControl(shape.inner, path, invalid, required)}<span class="note">@commit required (no commit source yet)</span>`
      case 'recursion':
        return html`<span class="note">↻ ${shape.typeName} (recursive)</span>`
      default:
        return html`<span class="note">${shape.kind} — editing this value is not supported</span>`
    }
  }

  private anyControl(path: Seg[], cur: unknown, required: boolean): TemplateResult {
    const text = cur == null ? '' : typeof cur === 'string' ? cur : JSON.stringify(cur, null, 2)
    return html`<au-textarea
      aria-label=${path.map(String).join(' → ') || 'Value'}
      aria-required=${required ? 'true' : nothing}
      aria-description=${this.errorsAt(path).join('\n') || nothing}
      aria-invalid=${this.errorsAt(path).length > 0 ? 'true' : 'false'}
      rows="2"
      placeholder="opaque value (stored verbatim)"
      .value=${text}
      @au-change=${(e: Event) => this.setAt(path, (e.target as unknown as { value: string }).value)}
    ></au-textarea>`
  }

  private textControl(path: Seg[], cur: unknown, invalid: boolean, required: boolean, placeholder?: string, description?: string): TemplateResult {
    return html`<au-input
      aria-label=${path.map(String).join(' → ') || 'Value'}
      aria-required=${required ? 'true' : nothing}
      ?error=${invalid}
      .value=${cur == null ? '' : String(cur)}
      placeholder=${placeholder ?? nothing}
      aria-description=${[description, ...this.errorsAt(path)].filter(Boolean).join('\n') || nothing}
      @au-change=${(e: Event) => this.setAt(path, (e.target as unknown as { value: string }).value)}
    ></au-input>`
  }

  private numberControl(path: Seg[], cur: unknown, invalid: boolean, required: boolean, description?: string): TemplateResult {
    return html`<au-number-input
      aria-label=${path.map(String).join(' → ') || 'Value'}
      aria-required=${required ? 'true' : nothing}
      ?error=${invalid}
      aria-description=${[description, ...this.errorsAt(path)].filter(Boolean).join('\n') || nothing}
      .value=${typeof cur === 'number' ? cur : (null as unknown as number)}
      @au-change=${(e: Event) => this.setAt(path, (e.target as unknown as { value: number | null }).value)}
    ></au-number-input>`
  }

  private checkboxControl(path: Seg[], cur: unknown, required: boolean): TemplateResult {
    return html`<au-checkbox
      aria-label=${path.map(String).join(' → ') || 'Value'}
      aria-required=${required ? 'true' : nothing}
      aria-description=${this.errorsAt(path).join('\n') || nothing}
      aria-invalid=${this.errorsAt(path).length > 0 ? 'true' : 'false'}
      .checked=${cur === true}
      @au-change=${(e: Event) => this.setAt(path, (e.target as unknown as { checked: boolean }).checked)}
    ></au-checkbox>`
  }

  private selectControl(path: Seg[], cur: unknown, options: { value: string; label: string }[], required: boolean): TemplateResult {
    return html`<au-select
      aria-label=${path.map(String).join(' → ') || 'Value'}
      aria-required=${required ? 'true' : nothing}
      aria-description=${this.errorsAt(path).join('\n') || nothing}
      aria-invalid=${this.errorsAt(path).length > 0 ? 'true' : 'false'}
      .options=${options}
      .value=${cur == null ? '' : String(cur)}
      @au-change=${(e: Event) => this.setAt(path, (e.target as unknown as { value: string }).value)}
    ></au-select>`
  }

  /** A reference (`T*` / `file*` / `any*`) picker: a searchable combobox over the host-supplied option source.
   *  Without a `resolveOptions` source it degrades to free text. The source is query-driven (`remote`), so the
   *  host wires it to `readInstancesOf` / `readFiles`; the gallery stubs it with static candidates. */
  private referenceControl(path: Seg[], cur: unknown, typeName: string, invalid: boolean, required: boolean): TemplateResult {
    if (!this.resolveOptions) return this.textControl(path, cur, invalid, required, `a ${typeName} reference`)
    const key = keyOf(path)
    const opts = this._options.get(key) ?? []
    const lookup = this._lookups.get(key)
    return html`<span class="reference"><au-combobox
      ?loading=${lookup?.loading ?? false}
      remote
      label=${path.length ? path.map(String).join(' → ') : `${typeName} reference`}
      aria-required=${required ? 'true' : nothing}
      aria-description=${this.errorsAt(path).join('\n') || nothing}
      aria-invalid=${invalid ? 'true' : 'false'}
      .options=${opts.map((o) => ({ value: o.id, label: o.label, secondary: o.detail }))}
      .value=${cur == null ? '' : String(cur)}
      placeholder=${`a ${typeName} reference`}
      @focusin=${() => this.fetchOptions(path, '')}
      @au-input=${(e: Event) => this.fetchOptions(path, (e as CustomEvent).detail?.query ?? '')}
      @au-change=${(e: Event) => this.setAt(path, (e as CustomEvent).detail?.value)}
    ></au-combobox>${lookup?.failed ? html`<span class="lookup-error" role="status">Could not load references. <au-button size="sm" variant="ghost" @click=${() => this.fetchOptions(path, lookup.query)}>Retry</au-button></span>` : nothing}</span>`
  }

  private async fetchOptions(path: Seg[], query: string): Promise<void> {
    if (!this.resolveOptions) return
    const key = keyOf(path)
    const request = ++this._request
    const provider = this.resolveOptions
    const schema = this.schema
    this._lookups = new Map(this._lookups).set(key, { request, query, loading: true, failed: false })
    this._options = new Map(this._options).set(key, [])
    const current = () => this.isConnected && this.schema === schema && this.resolveOptions === provider && this._lookups.get(key)?.request === request
    try {
      const opts = await provider([...path].map(String), query)
      if (!current()) return
      this._options = new Map(this._options).set(key, opts)
      this._lookups = new Map(this._lookups).set(key, { request, query, loading: false, failed: false })
    } catch {
      if (!current()) return
      this._lookups = new Map(this._lookups).set(key, { request, query, loading: false, failed: true })
    }
  }
}

// ---- pure helpers ----

function keyOf(path: Seg[]): string {
  return JSON.stringify(path)
}

/** A diagnostic path equals an editor path (segment-wise, index-as-string). */
function samePath(diag: string[], path: Seg[]): boolean {
  return diag.length === path.length && diag.every((s, i) => s === String(path[i]))
}

/** A diagnostic path is at or under an editor path. */
function underPath(diag: string[], path: Seg[]): boolean {
  return diag.length >= path.length && path.every((s, i) => String(s) === diag[i])
}

function isCompound(shape: ResolvedShape): boolean {
  return (
    asRecord(shape) !== undefined ||
    shape.kind === 'list' ||
    shape.kind === 'inline-or-reference' ||
    shape.kind === 'record-choice'
  )
}

/** A short human label for a union branch's kind. */
function kindLabel(shape: ResolvedShape): string {
  switch (shape.kind) {
    case 'record':
      return shape.typeName
    case 'inline-or-reference':
      return `${shape.typeName} &`
    case 'primitive':
      return shape.name
    case 'refined':
      return shape.base
    case 'enum':
      return 'one of'
    case 'reference':
      return `${shape.typeName} ref`
    case 'def-reference':
      return 'type'
    case 'list':
      return 'list'
    default:
      return shape.kind
  }
}

function asRecord(node: ResolvedShape): (ResolvedShape & { kind: 'record' }) | undefined {
  if (node.kind === 'record') return node
  if (node.kind === 'inline-or-reference' && node.record.kind === 'record') return node.record
  return undefined
}

/** The fields a shape contributes to a form: a record's, an inline-or-reference's inner record's, or a
 *  claimable record-choice's DEFAULT (base) option's. A non-claimable choice has none until a pick. */
function fieldsOf(shape: ResolvedShape): ResolvedField[] | undefined {
  if (shape.kind === 'record') return shape.fields
  if (shape.kind === 'inline-or-reference') return fieldsOf(shape.record)
  if (shape.kind === 'record-choice') return shape.claimable ? shape.options[0]?.fields : undefined
  return undefined
}

/** Collect the paths of REQUIRED compound branches, recursing the required chain, so they open by default. */
function seedOpen(shape: ResolvedShape, path: Seg[], acc: Set<string>): void {
  const fields = fieldsOf(shape)
  if (!fields) return
  for (const f of fields) {
    if (!f.required || !isCompound(f.shape)) continue
    const p = [...path, f.name]
    acc.add(keyOf(p))
    seedOpen(f.shape, p, acc)
  }
}

/** A source-form-ish label for a shape's TYPE, shown in the expanded (i) view. */
function typeLabel(shape: ResolvedShape): string {
  switch (shape.kind) {
    case 'primitive':
      return shape.name
    case 'refined':
      return refinementHint(shape)
    case 'enum':
      return `[${shape.members.join(', ')}]`
    case 'record':
      return shape.typeName
    case 'record-choice':
      return shape.claimable ? `${shape.typeName} (or a subtype)` : `${shape.typeName} (abstract — pick a subtype)`
    case 'inline-or-reference':
      return `${shape.typeName}&`
    case 'reference':
      return `${shape.typeName}*`
    case 'def-reference':
      return shape.bound ? `type<${shape.bound.kind === 'single' ? shape.bound.name : shape.bound.branches.join(shape.bound.op === 'union' ? ' | ' : ' & ')}>*` : 'type*'
    case 'list': {
      const card = shape.max === undefined ? (shape.min === 0 ? '' : `${shape.min}..`) : shape.min === shape.max ? `${shape.min}` : `${shape.min}..${shape.max}`
      return `${typeLabel(shape.inner)}[${card}]`
    }
    case 'union':
      return `<${shape.branches.map(typeLabel).join(' | ')}>`
    case 'intersection':
      return `<${shape.branches.map(typeLabel).join(' & ')}>`
    case 'compound-reference':
      return `<${shape.typeNames.join(shape.op === 'union' ? ' | ' : ' & ')}>*`
    case 'pinned':
      return `${typeLabel(shape.inner)}@`
    case 'recursion':
      return `${shape.typeName} (recursive)`
    case 'any':
      return 'any'
    case 'unresolvable':
      return 'unknown'
  }
}

function setIn(value: unknown, path: Seg[], v: unknown): unknown {
  if (path.length === 0) return v
  const [head, ...rest] = path
  if (typeof head === 'number') {
    const arr = Array.isArray(value) ? [...value] : []
    arr[head] = setIn(arr[head], rest, v)
    return arr
  }
  const obj: ValueMap = value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as ValueMap) } : {}
  obj[head] = setIn(obj[head], rest, v)
  return obj
}

function seedFor(inner: ResolvedShape): unknown {
  const rec = asRecord(inner)
  if (rec) return { type: rec.typeName }
  if (inner.kind === 'list') return []
  return ''
}

/** A small disclosure chevron (rotates via `.is-open`). */
function chevron(): TemplateResult {
  return svg`<svg viewBox="0 0 16 16" fill="none" width="12" height="12" aria-hidden="true">
    <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`
}

/** A small info (i) glyph for the docstring toggle. */
function infoGlyph(): TemplateResult {
  return svg`<svg viewBox="0 0 16 16" fill="none" width="13" height="13" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.2" />
    <path d="M8 7v3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <circle cx="8" cy="5" r="0.85" fill="currentColor" />
  </svg>`
}

/** A short constraint hint for a refined primitive (shown as the control's placeholder). */
function refinementHint(shape: ResolvedShape & { kind: 'refined' }): string {
  const r = shape.refinement
  const parts: string[] = []
  if (r.integer) parts.push('integer')
  if (r.lower) parts.push(`${r.lower.inclusive ? '≥' : '>'} ${r.lower.value}`)
  if (r.upper) parts.push(`${r.upper.inclusive ? '≤' : '<'} ${r.upper.value}`)
  if (r.pattern) parts.push(`/${r.pattern}/`)
  return parts.length ? `${shape.base} · ${parts.join(', ')}` : shape.base
}
