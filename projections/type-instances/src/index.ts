import { displayFilePath } from '@arsumbris/au-host-sdk'
import { mountDocumentation } from '@arsumbris/projection-docs'
// Type-instances table: pick a type, list its instances in a filterable table.
//
// A standalone code-intelligence projection over the engine's
// `instances_of` read. A type PICKER (over the workspace-wide `types`) drives one
// `readInstancesOf(type)` read; the result renders as a TABLE — one row per instance,
// one column per CLOSURE field of the picked type. An interactive 6-kind CLAUSE BUILDER
// filters the
// rows: add a clause → pick a field → its shape picks the op set + value inputs → AND-combined.
// Active clauses show as chips with ✕. Click a row → open-intent (transient editor); cmd-hover
// a row → the host preview overlay.

import { defineProjection, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk'
import {
  readTypes,
  readInstancesOf,
  readInstanceCounts,
  readTypeClosure,
  type WireTypeDef,
  type WireField,
  type WireInstanceMatch,
  type WireInstanceOrigin,
} from '@arsumbris/au-host-sdk/engine-reads'
import { fileSelection } from '@arsumbris/selection'
import { openIntent } from '@arsumbris/intent'
import { valueView } from './value-view'
import { makeHoverContent } from '@arsumbris/preview-content'

import {
  type Clause,
  type Lens,
  type StringOp,
  formatClause,
  matchesLens,
  parseFieldShape,
} from '@arsumbris/type-query'

// `intent` (command channel), `preview` (overlay surface), and `engineReady` (readiness edge) are
// all MountHost contract capabilities now, read off `host` directly (engineReady is optional; guard).

const STYLE = `
.au-ti { color: var(--au-ink-2); font: var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans); display: flex; flex-direction: column; gap: var(--au-space-3); height: 100%; min-width: 0; min-height: 0; box-sizing: border-box; padding: var(--au-space-4); container: instances / inline-size; }
.au-ti-bar { display: flex; gap: var(--au-space-2); align-items: center; flex-wrap: wrap; }
.au-ti [hidden] { display:none !important; }
.au-ti-form au-field { min-width:0; }
.au-ti-form { align-items:flex-end; }
.au-ti-heading { margin:0; flex:1; color:var(--au-ink-1); font:var(--au-w-strong) var(--au-t-body)/var(--au-lh-base) var(--au-font-sans); }
.au-ti-guide { margin:0; color:var(--au-ink-3); overflow-wrap:anywhere; }
.au-ti-search { width:100%; }
.au-ti-status { flex-basis:100%; color: var(--au-ink-3); flex: 1; min-width: 0; overflow-wrap:anywhere; }
.au-ti-status.error { color: var(--au-color-danger); }
.au-ti-typelabel { font-family:var(--au-font-mono); min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--au-w-strong); color: var(--au-ink-1); }
.au-ti-origins { display: flex; gap: var(--au-space-1); align-items: center; flex-wrap:wrap; }
.au-ti-typelist { flex:1; min-height:0; display: flex; flex-direction: column; gap: var(--au-space-0-5); }
.au-ti-count { color: var(--au-ink-4); font-size: var(--au-t-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
.au-ti-filters { display: flex; gap: var(--au-space-1-5); align-items: center; flex-wrap: wrap; }
/* Chips are <au-chip> (removable), the add/cancel are <au-button>, the value fields <au-input> — this
   sheet keeps only the form LAYOUT + the enum-values row. */
.au-ti-form { display: flex; gap: var(--au-space-1-5); align-items: center; flex-wrap: wrap; border: 1px solid var(--au-color-border); border-radius: var(--au-radius-chip); padding: var(--au-space-3); background: var(--au-color-surface); }
.au-ti-form .enum-vals { display: flex; gap: var(--au-space-2); align-items: center; flex-wrap: wrap; }
.au-ti-tablewrap { flex: 1; min-width: 0; min-height: 0; }
.au-ti-records { display:grid; grid-template-columns:minmax(180px, .65fr) minmax(0, 1.35fr); gap:var(--au-space-4); flex:1; min-height:0; min-width:0; }
.au-ti-record-list, .au-ti-record-detail { min-width:0; min-height:0; }
.au-ti-record-detail { border-left:1px solid var(--au-line-1); padding-left:var(--au-space-4); }
.au-ti-record-list au-list-row { margin-bottom:var(--au-space-1); }
.au-ti-record-content { min-width:0; overflow-wrap:anywhere; padding-bottom:var(--au-space-4); }
.au-ti-record-content h3 { margin:0; color:var(--au-ink-1); font:var(--au-w-strong) var(--au-t-body)/var(--au-lh-base) var(--au-font-mono); }
.au-ti-record-context { white-space:pre-line; margin:var(--au-space-1) 0 var(--au-space-3); color:var(--au-ink-3); font-size:var(--au-t-xs); overflow-wrap:anywhere; }
.au-ti-record-content dl { margin:var(--au-space-4) 0 0; }
.au-ti-field { padding:var(--au-space-3) 0; border-top:1px solid var(--au-line-1); }
.au-ti-field dt { color:var(--au-ink-1); font-family:var(--au-font-mono); }
.au-ti-field dt small { margin-left:var(--au-space-2); color:var(--au-ink-3); font:var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); }
.au-ti-field dd { margin:var(--au-space-2) 0 0; min-width:0; }
.au-ti-value { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono); tab-size:2; }
.au-ti-value.absent { color:var(--au-ink-3); }
.au-ti-value .au-syntax-comment { color:var(--au-code-comment); }
.au-ti-value .au-syntax-string { color:var(--au-code-string); }
.au-ti-value .au-syntax-value { color:var(--au-code-number); }
.au-ti-value .au-syntax-type { color:var(--au-code-type); }
.au-ti-value .au-syntax-name { color:var(--au-code-property); }
.au-ti-value .au-syntax-keyword { color:var(--au-code-keyword); }
.au-ti-value .au-syntax-variable { color:var(--au-code-variable); }
.au-ti-value .au-syntax-punctuation { color:var(--au-code-punctuation); }
@container instances (max-width:600px) {
 .au-ti-records { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(80px, .45fr) minmax(120px, 1fr); gap:var(--au-space-3); }
 .au-ti-record-detail { border-left:0; border-top:1px solid var(--au-line-1); padding:var(--au-space-3) 0 0; }
}
.au-ti-empty { color: var(--au-ink-3); padding: var(--au-space-2) 0; }
`

const STRING_OPS = ['contains', 'not-contains', 'equals', 'not-equals', 'regex', 'not-matches'] as const
const NUMBER_OPS = ['equals', 'not-equals', 'range'] as const
const DATE_OPS = ['after', 'before', 'equals', 'range'] as const

function mount(container: HTMLElement, host: MountHost): () => void {
  const root = document.createElement('div')
  root.className = 'au-ti'
  const disposeStyles = host.styles?.inject(STYLE, container)

  const bar = document.createElement('div')
  bar.className = 'au-ti-bar'
  // Overview ⇄ detail: no type selected → a browsable type LIST with per-type instance counts; pick one
  // → its instances table + clause filters, with a back affordance. The count comes from the engine's
  // `instance_counts` read (one round-trip), joined to each type identity by (name, hash).
  const backBtn = auBtn('All types', 'ghost')
  const heading = document.createElement('h2')
  heading.className = 'au-ti-heading'
  heading.textContent = 'Instances'
  const spinner = document.createElement('au-spinner')
  spinner.setAttribute('size', 'sm')
  spinner.setAttribute('label', 'Loading instances')
  const refresh = auBtn('Refresh', 'outline')
  refresh.addEventListener('au-activate', () => { if(selectedType) void loadInstances(); else void refreshTypes() })
  const guide = document.createElement('p')
  guide.className = 'au-ti-guide'
  const search = textInput('Find a type or repository…')
  search.className = 'au-ti-search'
  search.setAttribute('aria-label', 'Search types')
  search.addEventListener('au-input', () => renderOverview())
  const typeLabel = document.createElement('span')
  typeLabel.className = 'au-ti-typelabel'
  // Which instance-site KINDS the detail table shows. Default file + nested (the overview count's set);
  // meta off. User-toggled per detail view (a site kind the user hides drops from the "N / M" too).
  const originFilter = new Set<WireInstanceOrigin>(['file', 'nested'])
  const originToggles = document.createElement('div')
  originToggles.className = 'au-ti-origins'
  const ORIGIN_LABELS: readonly [WireInstanceOrigin, string][] = [
    ['file', 'Files'],
    ['nested', 'Nested records'],
    ['meta', 'Type metadata'],
  ]
  for (const [o, label] of ORIGIN_LABELS) {
    // A real multi-toggle facet: pressed = this origin kind is shown in the detail table + the "N / M".
    const chip = document.createElement('au-toggle-chip') as AuToggleChipEl
    chip.label = label
    chip.pressed = originFilter.has(o)
    chip.title = `show ${label}-origin instances`
    chip.addEventListener('au-toggle', () => {
      // The chip flipped its own `pressed`; sync the filter to it.
      if (chip.pressed) originFilter.add(o)
      else originFilter.delete(o)
      renderTable()
    })
    originToggles.appendChild(chip)
  }
  const status = document.createElement('div')
  status.className = 'au-ti-status'
  status.setAttribute('role', 'status')
  status.textContent = 'Loading types…'
  bar.append(backBtn, heading, spinner, refresh, typeLabel, status)
  backBtn.addEventListener('au-activate', () => showOverview())

  const filters = document.createElement('div')
  filters.className = 'au-ti-filters'

  const tableWrap = document.createElement('div')
  tableWrap.className = 'au-ti-tablewrap'
  tableWrap.style.display = 'flex'
  tableWrap.style.flexDirection = 'column'

  root.append(bar, guide, search, originToggles, filters, tableWrap)
  container.appendChild(root)

  let alive = true
  const intent = host.intent

  let defs: WireTypeDef[] = []
  let selectedType: string | null = null
  let selectedRepo: string | null = null // the owner of the picked identity — scopes the drill-in to it
  // Per-type-identity instance counts for the overview, keyed by (name, hash) — two same-named cross-repo
  // identities are distinct rows. Closure-inclusive (a site counts toward every type in its closure).
  const countByKey = new Map<string, number>()
  const keyOf = (name: string, hash: string): string => `${name}|${hash}`
  let instances: WireInstanceMatch[] = []
  let documentation: (() => void)[] = []
  const clearDocumentation = (): void => { documentation.forEach(dispose => dispose()); documentation = [] }
  let selectedRecord: string | null = null
  const recordKey = (record: WireInstanceMatch): string => JSON.stringify([record.path, record.origin, record.span.start, record.span.end])
  // The effective fields of the selected type, fetched from the engine's `type_closure` read
  // (schema 17) rather than a client-side ancestor walk. The engine owns effective-field truth
  // (auto-unify + mixin-collision exclusion a client walk can get subtly wrong). `WireClosureField`
  // extends `WireField` (adds `origin`), so this is field-compatible with the table/filters.
  let closureFieldList: WireField[] = []
  let clauses: Clause[] = []
  let loadToken = 0
  let overviewToken = 0
  let loading = true
  let failure = ''
  let countsAvailable = false
  let countsPending = false
  let countsNotice = ''
  function message(text: string): void {
    const el = document.createElement('p')
    el.className = 'au-ti-empty'
    el.textContent = text
    tableWrap.replaceChildren(el)
  }

  function selectedFields(): WireField[] {
    return closureFieldList
  }

  // ─── Table ────────────────────────────────────────────────────────

  function renderTable(): void {
    clearDocumentation()
    tableWrap.replaceChildren()
    if (!selectedType) {
      const e = document.createElement('div')
      e.className = 'au-ti-empty'
      e.textContent = 'pick a type to list its instances'
      tableWrap.appendChild(e)
      return
    }
    if (loading || failure) {
      status.textContent = failure || `Loading ${selectedType}…`
      status.className = failure ? 'au-ti-status error' : 'au-ti-status'
      message(failure ? 'Use Refresh to try again.' : 'Reading instances and their fields…')
      return
    }
    const fields = selectedFields()
    const lens: Lens = { typeName: selectedType, clauses }
    // Origin-kind filter first (user-toggled site kinds), then the clause filter.
    const inScope = instances.filter((i) => originFilter.has(i.origin))
    const shown = inScope.filter((i) => matchesLens({ fields: i.fields }, lens))

    status.textContent = `${shown.length} of ${inScope.length} instances · ${fields.length} fields`

    if (shown.length === 0) {
      const e = document.createElement('div')
      e.className = 'au-ti-empty'
      e.textContent = inScope.length === 0 ? `no instances of ${selectedType} in the shown kinds` : 'no instances match the filter'
      tableWrap.appendChild(e)
      return
    }

    const workspace = document.createElement('div')
    workspace.className = 'au-ti-records'
    const list = document.createElement('au-scroll-area')
    list.className = 'au-ti-record-list'
    list.setAttribute('axis', 'y')
    list.setAttribute('aria-label', 'Instance records')
    let detail = document.createElement('au-scroll-area')
    detail.className = 'au-ti-record-detail'
    detail.setAttribute('axis', 'y')
    detail.setAttribute('aria-label', 'Record fields')
    const picked = shown.find(record => recordKey(record) === selectedRecord) ?? shown[0]!
    selectedRecord = recordKey(picked)
    const select = (record: WireInstanceMatch): void => {
      clearDocumentation()
      clearHoverTimer()
      preview?.hide()
      const nextDetail = document.createElement('au-scroll-area')
      nextDetail.className = detail.className
      nextDetail.setAttribute('axis', 'y')
      nextDetail.setAttribute('aria-label', 'Record fields')
      detail.replaceWith(nextDetail)
      detail = nextDetail
      selectedRecord = recordKey(record)
      for (const row of list.querySelectorAll('au-list-row')) row.toggleAttribute('selected', row.getAttribute('data-record') === selectedRecord)
      const content = document.createElement('div')
      content.className = 'au-ti-record-content'
      const title = document.createElement('h3')
      title.textContent = basename(record.path)
      const context = document.createElement('p')
      context.className = 'au-ti-record-context'
      context.textContent = `${record.member} · ${locationLabel(record)}
${displayFilePath(record.path, host.workspace.members)}`
      const source = auBtn('Open source', 'outline')
      source.className = 'au-ti-file'
      source.dataset.path = record.path
      source.addEventListener('au-activate', () => {
        clearHoverTimer()
        preview?.hide()
        const range = { type: 'text-range', from: record.span.start, to: record.span.end }
        intent?.fire(openIntent(fileSelection(record.path, range)))
      })
      content.append(title, context, source)
      if (record.doc) {
        const doc = document.createElement('div')
        content.append(doc)
        documentation.push(mountDocumentation(doc, record.doc, host, record.path))
      }
      const values = document.createElement('dl')
      for (const field of fields) {
        const group = document.createElement('div')
        group.className = 'au-ti-field'
        const label = document.createElement('dt')
        label.textContent = field.name
        const shape = document.createElement('small')
        shape.textContent = `${field.shape}${field.required ? ' · required' : ' · optional'}`
        label.append(shape)
        const value = document.createElement('dd')
        value.append(valueView(record.fields[field.name]))
        group.append(label, value)
        values.append(group)
      }
      if (!fields.length) {
        const empty = document.createElement('p')
        empty.textContent = 'This type declares no fields. Open the source to inspect the full record.'
        values.append(empty)
      }
      content.append(values)
      detail.replaceChildren(content)
    }
    for (const record of shown) {
      const row = document.createElement('au-list-row')
      row.setAttribute('interactive', '')
      row.setAttribute('primary', basename(record.path))
      row.setAttribute('secondary', `${record.member} · ${locationLabel(record)}`)
      row.setAttribute('data-record', recordKey(record))
      row.title = `${displayFilePath(record.path, host.workspace.members)} · ${locationLabel(record)}`
      row.addEventListener('click', () => select(record))
      list.append(row)
    }
    workspace.append(list, detail)
    tableWrap.append(workspace)
    select(picked)
  }

  // ─── Filter chips + clause builder ──────────────────────────────────

  // An active-filter chip: a removable au-chip whose × emits au-remove.
  function makeChip(c: Clause, i: number): HTMLElement {
    const chip = document.createElement('au-chip')
    chip.setAttribute('label', formatClause(c))
    chip.setAttribute('variant', 'accent')
    chip.setAttribute('removable', '')
    chip.addEventListener('au-remove', () => {
      clauses = clauses.filter((_, j) => j !== i)
      renderFilters()
      renderTable()
    })
    return chip
  }

  function renderFilters(): void {
    filters.replaceChildren()
    if (!selectedType || loading || failure) return
    if (!selectedFields().length) {
      filters.textContent = 'This type has no fields to filter.'
      return
    }
    const label = document.createElement('span')
    label.textContent = clauses.length ? 'Match all conditions' : 'Filter by field'
    filters.append(label)
    clauses.forEach((c, i) => filters.appendChild(makeChip(c, i)))
    const add = auBtn('Add condition', 'outline')
    add.addEventListener('au-activate', () => openClauseForm())
    filters.appendChild(add)
  }

  // The interactive clause form: field → op → value(s), per the field's shape kind.
  function openClauseForm(): void {
    const fields = selectedFields()
    if (fields.length === 0) return
    const form = document.createElement('div')
    form.className = 'au-ti-form'

    const fieldSel = auSelect('12em')
    fieldSel.options = fields.map((f) => ({ value: f.name, label: f.name }))
    fieldSel.value = fields[0]?.name ?? ''
    fieldSel.setAttribute('label', 'Field')

    // The op + value section, rebuilt whenever the field or op changes.
    const opValWrap = document.createElement('span')
    opValWrap.style.display = 'inline-flex'
    opValWrap.style.gap = 'var(--au-space-1-5)'
    opValWrap.style.alignItems = 'center'
    opValWrap.style.flexWrap = 'wrap'

    // buildClause reads the current form state into a Clause (or null if incomplete).
    let buildClause: () => Clause | null = () => null

    function rebuildOpVal(): void {
      opValWrap.replaceChildren()
      const field = fields.find((f) => f.name === fieldSel.value)
      if (!field) {
        buildClause = () => null
        return
      }
      const kind = parseFieldShape(field.shape)
      const fname = field.name

      const opSel = auSelect('10em')
      opSel.setAttribute('label', 'Operator')
      const setOps = (ops: readonly string[]): void => {
        opSel.options = ops.map((o) => ({ value: o, label: o.replaceAll('-', ' ') }))
        opSel.value = ops[0] ?? '' // native selects default to the first option
      }

      switch (kind.kind) {
        case 'enum': {
          setOps(['in', 'not-in'])
          const valsWrap = document.createElement('span')
          valsWrap.className = 'enum-vals'
          const boxes: { el: AuCheckboxEl; value: string }[] = []
          for (const v of kind.values) {
            const cb = auEnumBox(v) // au-checkbox renders its own label
            boxes.push({ el: cb, value: v })
            valsWrap.appendChild(cb)
          }
          opValWrap.append(opSel, valsWrap)
          buildClause = () => {
            const values = boxes.filter((b) => b.el.checked).map((b) => b.value)
            if (values.length === 0) return null
            return { kind: 'enum', field: fname, op: opSel.value as 'in' | 'not-in', values }
          }
          break
        }
        case 'boolean': {
          setOps(['equals'])
          const valSel = auSelect('7em')
          valSel.options = [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]
          valSel.value = 'true'
          opValWrap.append(opSel, valSel)
          buildClause = () => ({ kind: 'boolean', field: fname, op: 'equals', value: valSel.value === 'true' })
          break
        }
        case 'number': {
          setOps(NUMBER_OPS)
          const single = numInput('value')
          const minIn = numInput('min')
          const maxIn = numInput('max')
          const layout = (): void => {
            setHidden(single, opSel.value === 'range')
            setHidden(minIn, opSel.value !== 'range')
            setHidden(maxIn, opSel.value !== 'range')
          }
          opSel.addEventListener('au-change', layout)
          opValWrap.append(opSel, single, minIn, maxIn)
          layout()
          buildClause = () => {
            const op = opSel.value as 'equals' | 'not-equals' | 'range'
            if (op === 'range') {
              const min = minIn.value ?? undefined
              const max = maxIn.value ?? undefined
              if (min === undefined && max === undefined) return null
              if (min !== undefined && max !== undefined && min > max) return null // inverted → matches nothing
              return { kind: 'number', field: fname, op, min, max }
            }
            const value = single.value ?? undefined
            if (value === undefined) return null
            return { kind: 'number', field: fname, op, value }
          }
          break
        }
        case 'date':
        case 'datetime': {
          setOps(DATE_OPS)
          const single = dateInput()
          const fromIn = dateInput('From')
          const toIn = dateInput('To')
          const layout = (): void => {
            setHidden(single, opSel.value === 'range')
            setHidden(fromIn, opSel.value !== 'range')
            setHidden(toIn, opSel.value !== 'range')
          }
          opSel.addEventListener('au-change', layout)
          opSel.value = 'after'
          opValWrap.append(opSel, single, fromIn, toIn)
          layout()
          buildClause = () => {
            const op = opSel.value as 'equals' | 'before' | 'after' | 'range'
            if (op === 'range') {
              if (!fromIn.value && !toIn.value) return null
              // YYYY-MM-DD sorts lexically, so a string compare detects an inverted range.
              if (fromIn.value && toIn.value && fromIn.value > toIn.value) return null
              return { kind: 'date', field: fname, op, from: fromIn.value || undefined, to: toIn.value || undefined }
            }
            if (!single.value) return null
            return { kind: 'date', field: fname, op, value: single.value }
          }
          break
        }
        case 'other': {
          // type-refs / unions / bounds — presence is the only generic filter.
          setOps(['exists', 'absent'])
          opValWrap.append(opSel)
          buildClause = () => ({ kind: 'presence', field: fname, op: opSel.value as 'exists' | 'absent' })
          break
        }
        case 'string':
        default: {
          setOps(STRING_OPS)
          const valIn = textInput('value')
          opValWrap.append(opSel, valIn)
          buildClause = () => ({ kind: 'string', field: fname, op: opSel.value as StringOp, value: valIn.value })
          break
        }
      }
      for (const control of Array.from(opValWrap.children) as HTMLElement[]) {
        if (!control.tagName.startsWith('AU-')) continue
        const next = control.nextSibling
        const wrap = formField(control, control.getAttribute('label') || control.getAttribute('aria-label') || 'Value')
        opValWrap.insertBefore(wrap, next)
      }
    }

    fieldSel.addEventListener('au-change', rebuildOpVal)
    rebuildOpVal()

    const validation = document.createElement('span')
    validation.setAttribute('role', 'alert')
    validation.style.color = 'var(--au-color-danger)'
    const clearValidation = (): void => { validation.textContent = '' }
    form.addEventListener('au-input', clearValidation)
    form.addEventListener('au-change', clearValidation)
    const addBtn = auBtn('Add condition', 'cta')
    addBtn.addEventListener('au-activate', () => {
      const c = buildClause()
      if (!c) {
        // Empty or invalid input does not add a clause that would match zero rows.
        validation.textContent = 'Enter a value or a valid range before adding the condition.'
        return
      }
      validation.textContent = ''
      clauses = [...clauses, c]
      renderFilters()
      renderTable()
    })
    const cancel = auBtn('Cancel', 'ghost')
    cancel.addEventListener('au-activate', () => renderFilters())

    form.append(formField(fieldSel, 'Field'), opValWrap, addBtn, cancel, validation)
    filters.replaceChildren(form) // replace the chips row with the form while editing
    // keep the existing chips visible above the form:
    clauses.forEach((c, i) => filters.insertBefore(makeChip(c, i), form))
  }

  // ─── Data ───────────────────────────────────────────────────────────

  async function loadInstances(): Promise<void> {
    if (!selectedType) return
    const token = ++loadToken
    const name = selectedType
    const repo = selectedRepo ?? undefined
    loading = true
    failure = ''
    refresh.disabled = true
    render()
    try {
      const qualified = repo ? `${name}::${repo}` : name
      const [outcome, closure] = await Promise.all([
        readInstancesOf(host.engine, qualified, { origins: ['file', 'nested', 'meta'] }),
        readTypeClosure(host.engine, name, repo),
      ])
      if (!alive || token !== loadToken) return
      if ('ok' in outcome) throw new Error(outcome.error)
      if (!outcome.ready) throw new Error('Engine not ready')
      if ('ok' in closure) throw new Error(`Fields unavailable: ${closure.error}`)
      if (!closure.ready || !closure.result[0]) throw new Error('Type fields are not available yet')
      instances = outcome.result
      closureFieldList = closure.result[0].fields
    } catch (error) {
      if (!alive || token !== loadToken) return
      failure = error instanceof Error ? error.message : 'Could not read instances'
    }
    if (!alive || token !== loadToken) return
    loading = false
    refresh.disabled = false
    render()
  }

  // ─── Overview ⇄ detail ───────────────────────────────────────────

  function showOverview(): void {
    ++loadToken
    loading = false
    failure = ''
    refresh.disabled = false
    selectedType = null
    selectedRepo = null
    clauses = []
    render()
  }
  function selectType(name: string, repo: string): void {
    instances = []
    closureFieldList = []
    selectedType = name
    selectedRepo = repo // the exact identity the overview row counted — the drill-in scopes to it
    clauses = [] // a fresh type → fresh filters (its fields differ)
    void loadInstances()
  }

  /** Switch chrome between the overview list and the detail table. */
  function render(): void {
    spinner.hidden = !loading && !(countsPending && !selectedType)
    spinner.setAttribute('label', selectedType ? 'Loading instances' : loading ? 'Loading types' : 'Counting instances')
    root.setAttribute('aria-busy', String(loading))
    const detail = selectedType != null
    backBtn.style.display = detail ? '' : 'none'
    typeLabel.style.display = detail ? '' : 'none'
    typeLabel.textContent = selectedType ? `${selectedType} · ${selectedRepo}` : ''
    guide.textContent = detail ? 'Choose a record to inspect its fields. Filters apply to the selected source kinds.' : 'Find records by their type, then compare and filter their fields.'
    search.hidden = detail
    originToggles.style.display = detail ? 'flex' : 'none'
    filters.style.display = detail ? 'flex' : 'none'
    if (detail) {
      renderFilters()
      renderTable()
    } else {
      filters.replaceChildren()
      renderOverview()
    }
  }

  /** The browsable type list: one row per identity, its instance count on the trailing edge, count-first. */
  function renderOverview(): void {
    tableWrap.replaceChildren()
    if (loading || failure) {
      status.textContent = failure || 'Loading types…'
      status.className = failure ? 'au-ti-status error' : 'au-ti-status'
      message(failure ? 'Use Refresh to try again.' : 'Reading workspace types…')
      return
    }
    status.className = 'au-ti-status'
    if (defs.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'au-ti-empty'
      empty.textContent = 'No types in this workspace.'
      status.textContent = '0 types'
      tableWrap.appendChild(empty)
      return
    }
    const list = document.createElement('au-scroll-area')
    list.setAttribute('axis', 'y')
    list.className = 'au-ti-typelist'
    const countFor = (d: WireTypeDef): number => countByKey.get(keyOf(d.name, d.hash)) ?? 0
    const query = search.value.trim().toLowerCase()
    const rows = defs.filter(d => `${d.name} ${d.repo}`.toLowerCase().includes(query)).sort((a, b) => countFor(b) - countFor(a) || a.name.localeCompare(b.name))
    for (const d of rows) {
      const row = document.createElement('au-list-row')
      row.setAttribute('interactive', '')
      row.setAttribute('primary', d.name)
      if (d.repo) row.setAttribute('secondary', d.repo)
      const c = document.createElement('span')
      c.className = 'au-ti-count'
      c.slot = 'trailing'
      const n = countFor(d)
      c.textContent = countsAvailable ? `${n} instance${n === 1 ? '' : 's'}` : countsPending ? 'Counting…' : 'Count unavailable'
      row.appendChild(c)
      row.addEventListener('click', () => selectType(d.name, d.repo))
      list.appendChild(row)
    }
    tableWrap.appendChild(list)
    status.textContent = `${rows.length} of ${defs.length} types${countsNotice ? ` · ${countsNotice}` : ''}`
    if (!rows.length) message('No matching types. Change or clear the search.')
  }

  async function refreshTypes(): Promise<void> {
    const token = ++overviewToken
    loading = true
    failure = ''
    refresh.disabled = true
    render()
    try {
      // Counts enrich discovery; they must not hold back the usable type list.
      const countsRead = readInstanceCounts(host.engine).then(
        value => ({ status: 'fulfilled' as const, value }),
        reason => ({ status: 'rejected' as const, reason }),
      )
      const outcome = await readTypes(host.engine)
      if (!alive || token !== overviewToken) return
      if ('ok' in outcome) throw new Error(outcome.error)
      if (!outcome.ready) throw new Error('Engine not ready')
      defs = outcome.result
      countByKey.clear()
      countsAvailable = false
      countsPending = true
      countsNotice = 'Counting instances…'
      loading = false
      refresh.disabled = false
      render()
      const counts = await countsRead
      if (!alive || token !== overviewToken) return
      countsPending = false
      if (counts.status === 'fulfilled' && 'ready' in counts.value && counts.value.ready && counts.value.result) {
        for (const entry of counts.value.result.by_type) countByKey.set(keyOf(entry.name, entry.hash), entry.count)
        countsAvailable = true
      }
      countsNotice = countsAvailable ? '' : 'Instance counts unavailable; refresh to retry'
      if (!selectedType) render()
      return
    } catch (error) {
      if (!alive || token !== overviewToken) return
      countsPending = false
      failure = error instanceof Error ? error.message : 'Could not read types'
    }
    if (!alive || token !== overviewToken) return
    loading = false
    refresh.disabled = false
    render()
  }

  void refreshTypes()

  // Recover when the daemon becomes reachable (the mount-time read may have failed).
  const offReady = host.engineReady?.subscribe((ready) => {
    if (ready && alive) { if (selectedType) void loadInstances(); else void refreshTypes() }
  })

  // ─── cmd+hover PREVIEW ───────────────
  const preview = host.preview
  const content = preview ? makeHoverContent(host.engine) : null
  let modHeld = false
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let lastPointer: { x: number; y: number } | null = null
  const clearHoverTimer = (): void => {
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = undefined
  }
  function manageHover(x: number, y: number): void {
    if (!preview || !content) return
    if (preview.isOver(x, y)) return clearHoverTimer() // sticky: pointer is in the card
    const fileEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.au-ti-file') as HTMLElement | null
    const path = modHeld ? fileEl?.dataset.path : undefined
    if (!path) {
      clearHoverTimer() // cones own dismissal; just stop a pending dwell
      return
    }
    const key = `ti:file:${path}`
    if (preview.isShowing(key)) return
    clearHoverTimer()
    hoverTimer = setTimeout(() => {
      if (alive && modHeld && fileEl?.isConnected && tableWrap.contains(fileEl))
        preview.show(
          key,
          fileEl!.getBoundingClientRect(),
          content.previewPath(path),
          (p) => content.previewPath(p),
          (p) => intent?.fire(openIntent(fileSelection(p))),
        )
    }, 240)
  }
  const onMove = (e: MouseEvent): void => {
    lastPointer = { x: e.clientX, y: e.clientY }
    manageHover(e.clientX, e.clientY)
  }
  const onModKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Meta' && e.key !== 'Control') return
    modHeld = e.metaKey || e.ctrlKey
    if (lastPointer) manageHover(lastPointer.x, lastPointer.y)
  }
  const onLeave = (): void => clearHoverTimer()
  if (preview) {
    tableWrap.addEventListener('mousemove', onMove)
    tableWrap.addEventListener('mouseleave', onLeave)
    window.addEventListener('keydown', onModKey)
    window.addEventListener('keyup', onModKey)
  }

  return () => {
    disposeStyles?.()
    clearDocumentation()
    alive = false
    offReady?.()
    clearHoverTimer()
    if (preview) {
      tableWrap.removeEventListener('mousemove', onMove)
      tableWrap.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keydown', onModKey)
      window.removeEventListener('keyup', onModKey)
      preview.hide()
    }
    container.replaceChildren()
  }
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/** A compact label for a nested-record match, so sibling records in one file read as distinct rows:
 *  its `^block-id` when it has one, else its field-path (`phases[0].actions[1]`). */
function nestedLabel(loc: { field_path: (string | number)[]; block_id: string | null }): string {
  if (loc.block_id) return `^${loc.block_id}`
  let s = ''
  for (const seg of loc.field_path) s += typeof seg === 'number' ? `[${seg}]` : (s ? '.' : '') + seg
  return s || '(nested)'
}

// The filter number fields are `<au-number-input>` (a bounded-less spinbutton). Set-INDEPENDENT structural
// cast: only the property shape the contract guarantees — `.value` is a number, or null when empty.
type AuNumberInputEl = HTMLElement & { value: number | null }
function numInput(placeholder: string): AuNumberInputEl {
  const el = document.createElement('au-number-input') as AuNumberInputEl
  el.setAttribute('placeholder', placeholder)
  el.setAttribute('aria-label', placeholder)
  el.setAttribute('size', 'sm')
  el.style.width = '6em'
  return el
}

// The filter pickers are `<au-select>` (data-driven `options` model), each an explicit-width flex item.
// The enum multi-select uses `<au-checkbox>`. Set-INDEPENDENT structural casts — only the contract shape.
type AuSelectEl = HTMLElement & { value: string; options: { value: string; label: string }[] }
function auSelect(width: string): AuSelectEl {
  const el = document.createElement('au-select') as AuSelectEl
  el.setAttribute('size', 'sm')
  el.style.width = width
  return el
}
type AuCheckboxEl = HTMLElement & { checked: boolean }
function auEnumBox(label: string): AuCheckboxEl {
  const el = document.createElement('au-checkbox') as AuCheckboxEl
  el.setAttribute('size', 'sm')
  el.setAttribute('label', label)
  return el
}

// Text / date filter fields are `<au-input>`; the clause add/cancel are `<au-button>`. Set-INDEPENDENT
// structural casts — only the contract shape (`.value` string; au-button emits `au-activate`).
type AuInputEl = HTMLElement & { value: string; hidden: boolean }
function textInput(placeholder: string): AuInputEl {
  const el = document.createElement('au-input') as AuInputEl
  el.setAttribute('size', 'sm')
  el.setAttribute('placeholder', placeholder)
  el.setAttribute('aria-label', placeholder)
  return el
}
function dateInput(label = 'Date'): AuInputEl {
  const el = document.createElement('au-input') as AuInputEl
  el.setAttribute('size', 'sm')
  el.setAttribute('aria-label', label)
  el.setAttribute('inputtype', 'date') // Lit maps the `inputType` prop to the lowercased attribute
  return el
}
type AuBtnEl = HTMLElement & { disabled: boolean }
// The interactive filter chip (au-toggle {pressed}), for the origin facet — a real toggle, not a
// button faking one with a variant swap.
type AuToggleChipEl = HTMLElement & { label: string; pressed: boolean }
function auBtn(label: string, variant: 'solid' | 'ghost' | 'outline' | 'cta'): AuBtnEl {
  const el = document.createElement('au-button') as AuBtnEl
  el.setAttribute('size', 'sm')
  el.setAttribute('variant', variant)
  el.textContent = label
  return el
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })

function formField(control: HTMLElement, label: string): HTMLElement {
  const wrap = document.createElement('au-field')
  wrap.setAttribute('label', label)
  wrap.hidden = control.hidden
  wrap.append(control)
  return wrap
}
function setHidden(control: HTMLElement, hidden: boolean): void {
  control.hidden = hidden
  if (control.parentElement?.tagName === 'AU-FIELD') control.parentElement.hidden = hidden
}

function locationLabel(record: WireInstanceMatch): string {
  const loc = record.locator
  if (loc?.kind === 'nested') return nestedLabel(loc)
  if (loc?.kind === 'meta') return `meta: ${loc.meta_type}`
  return 'File record'
}
