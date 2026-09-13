// @arsumbris/type-query — shared clauses and predicates for querying typed instances.
// Pure matching operates on engine WireTypeDef and WireField shapes. The field-shape parser
// determines applicable clauses; consuming projections own their UI.

import { parseTypeName, type WireField } from '@arsumbris/au-host-sdk/engine-reads'

// ─── Type identity ─────────────────────────────────────────────────
// A type's identity is (name, owner-repo). Its STRING form is viewpoint-relative: bare when the
// reference is repo-local, `name::repo` when it crosses a repo boundary (the `::repo` value is the
// OWNER; a bare ref's owner is the referring file's own repo). The engine serves `repo` (owner) on
// every workspace-read type-def, so identity matching uses it — no base-name stripping. `parseTypeName`
// is the canonical SDK parser (@arsumbris/au-host-sdk/engine-reads); re-exported here as the one identity home.

export { parseTypeName }

/**
 * Does a discovered type-def (identified by its bare `name` + owner `repo`) satisfy a `query` string?
 * A qualified query pins the owner; a bare query matches by name alone (unambiguous while names are
 * workspace-unique). This is the mount / discovery lookup — it USES the candidate's owner to
 * disambiguate, so it stays correct if two repos ever own the same name.
 */
export function matchesTypeIdentity(candidate: { name: string; repo: string }, query: string): boolean {
  const q = parseTypeName(query)
  return candidate.name === q.name && (q.repo === undefined || candidate.repo === q.repo)
}

/**
 * Are two type-name STRINGS the same identity, tolerant of bare-vs-qualified? Names must match; if
 * BOTH carry a repo, the repos must match (one bare side matches any owner of that name). For
 * comparing two references (e.g. an instance's claim against a queried type) where neither side is a
 * discovered def carrying an authoritative owner.
 */
export function sameType(a: string, b: string): boolean {
  const pa = parseTypeName(a)
  const pb = parseTypeName(b)
  if (pa.name !== pb.name) return false
  return pa.repo === undefined || pb.repo === undefined || pa.repo === pb.repo
}

/**
 * The bare NAME of a type reference (drops any `::repo` addressing).
 * Type names are workspace-unique (the engine rejects duplicate names), so the NAME is the identity
 * for closure resolution — in BOTH the copy-vendored world (a bare parent resolves to its owner-
 * deduped def, whose repo differs from the referrer) and the cross-repo world (a qualified parent's
 * name resolves to the same unique def). NEVER synthesize a repo for a bare reference — that is a
 * client-side guess that is wrong under vendoring. Owner-based identity is only safe where the engine
 * PROVIDES the owner on both sides (mount matching); parent refs do not carry it.
 */
export function refName(ref: string): string {
  return parseTypeName(ref).name
}

// ─── Field shape parsing ───────────────────────────────────────────
// The engine's field-shape strings: `String` / `Number` / `Boolean` / `Date`, `[a, b]` for an
// enum, and type-refs / unions / bounds (`decision`, `<a | b>`, `bento-node&[]`) which fall to
// `other` → presence-only filtering (exists / absent), the sensible v1 for non-scalar fields.

export type FieldKind =
  | { readonly kind: 'string' }
  | { readonly kind: 'number' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'date' }
  | { readonly kind: 'datetime' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'other'; readonly raw: string }

export function parseFieldShape(shape: string): FieldKind {
  const trimmed = shape.trim()
  if (trimmed === 'String') return { kind: 'string' }
  if (trimmed === 'Number') return { kind: 'number' }
  if (trimmed === 'Boolean') return { kind: 'boolean' }
  if (trimmed === 'Date') return { kind: 'date' }
  if (trimmed === 'DateTime') return { kind: 'datetime' }
  const enumMatch = trimmed.match(/^\[(.+)\]$/s)
  if (enumMatch) {
    const values = enumMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (values.length > 0) return { kind: 'enum', values }
  }
  return { kind: 'other', raw: trimmed }
}

// The engine type_closure read supplies effective fields, including auto-unification and
// mixin-collision handling. type-instances reads it directly.

// ─── Clause model ──────────────────────────────────────────────────

export type EnumOp = 'in' | 'not-in'
export type StringOp = 'equals' | 'not-equals' | 'contains' | 'not-contains' | 'regex' | 'not-matches'
export type NumberOp = 'equals' | 'not-equals' | 'range'
export type DateOp = 'equals' | 'before' | 'after' | 'range'
export type PresenceOp = 'exists' | 'absent'

export type Clause =
  | { readonly kind: 'enum'; readonly field: string; readonly op: EnumOp; readonly values: readonly string[] }
  | { readonly kind: 'string'; readonly field: string; readonly op: StringOp; readonly value: string }
  | { readonly kind: 'number'; readonly field: string; readonly op: NumberOp; readonly value?: number; readonly min?: number; readonly max?: number }
  | { readonly kind: 'date'; readonly field: string; readonly op: DateOp; readonly value?: string; readonly from?: string; readonly to?: string }
  | { readonly kind: 'boolean'; readonly field: string; readonly op: 'equals'; readonly value: boolean }
  | { readonly kind: 'presence'; readonly field: string; readonly op: PresenceOp }

export interface Lens {
  readonly typeName: string
  readonly clauses: readonly Clause[]
}

// ─── Match function ────────────────────────────────────────────────

export interface InstanceFacts {
  readonly fields: Readonly<Record<string, unknown>>
}

// instances_of returns matching records, including inherited instances, so this lens filters rows
// only by its clauses. lens.typeName supplies the display label and selects the type to query.
export function matchesLens(inst: InstanceFacts, lens: Lens): boolean {
  return lens.clauses.every((c) => clauseMatches(inst.fields, c))
}

function clauseMatches(fields: Readonly<Record<string, unknown>>, clause: Clause): boolean {
  const value = fields[clause.field]
  switch (clause.kind) {
    case 'enum': {
      const v = String(value ?? '')
      const set = new Set(clause.values)
      return clause.op === 'in' ? set.has(v) : !set.has(v)
    }
    case 'string': {
      const s = typeof value === 'string' ? value : ''
      switch (clause.op) {
        case 'equals':
          return s === clause.value
        case 'not-equals':
          return s !== clause.value
        case 'contains':
          return s.toLowerCase().includes(clause.value.toLowerCase())
        case 'not-contains':
          return !s.toLowerCase().includes(clause.value.toLowerCase())
        case 'regex':
        case 'not-matches': {
          let re: RegExp
          try {
            re = new RegExp(clause.value)
          } catch {
            return false
          }
          const m = re.test(s)
          return clause.op === 'regex' ? m : !m
        }
      }
      break
    }
    case 'number': {
      const n = typeof value === 'number' ? value : NaN
      switch (clause.op) {
        case 'equals':
          return clause.value !== undefined && n === clause.value
        case 'not-equals':
          return clause.value !== undefined && n !== clause.value
        case 'range':
          if (Number.isNaN(n)) return false
          if (clause.min !== undefined && n < clause.min) return false
          if (clause.max !== undefined && n > clause.max) return false
          return true
      }
      break
    }
    case 'date': {
      const d = toDate(value)
      if (!d) return false
      switch (clause.op) {
        case 'equals': {
          const t = clause.value ? toDate(clause.value) : null
          return t ? sameDay(d, t) : false
        }
        case 'before': {
          const t = clause.value ? toDate(clause.value) : null
          return t ? d < t : false
        }
        case 'after': {
          const t = clause.value ? toDate(clause.value) : null
          return t ? d > t : false
        }
        case 'range': {
          if (clause.from) {
            const f = toDate(clause.from)
            if (!f || d < f) return false
          }
          if (clause.to) {
            const t = toDate(clause.to)
            if (!t || d > t) return false
          }
          return true
        }
      }
      break
    }
    case 'boolean':
      return typeof value === 'boolean' && value === clause.value
    case 'presence': {
      const present = value !== undefined && value !== null
      return clause.op === 'exists' ? present : !present
    }
  }
  return false
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'string') {
    // A bare `YYYY-MM-DD` is parsed by `new Date` as UTC midnight, but we compare with LOCAL getters
    // (sameDay / before / after), so parse it as a LOCAL date — else a date filter is off by one day
    // in any non-UTC zone. A full datetime / other format keeps the native parse.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// ─── Presentation ──────────────────────────────────────────────────

export function formatClause(c: Clause): string {
  switch (c.kind) {
    case 'enum':
      return `${c.field} ${c.op === 'in' ? '∈' : '∉'} {${c.values.join(', ')}}`
    case 'string':
      return `${c.field} ${stringOpSymbol(c.op)} "${c.value}"`
    case 'number':
      if (c.op === 'range') return `${c.field} ∈ [${c.min ?? '−∞'}, ${c.max ?? '+∞'}]`
      return `${c.field} ${c.op === 'equals' ? '=' : '≠'} ${c.value ?? ''}`
    case 'date':
      if (c.op === 'range') return `${c.field} ∈ [${c.from ?? '−∞'}, ${c.to ?? '+∞'}]`
      return `${c.field} ${dateOpSymbol(c.op)} ${c.value ?? ''}`
    case 'boolean':
      return `${c.field} = ${c.value}`
    case 'presence':
      return `${c.field} ${c.op === 'exists' ? '∃' : '∄'}`
  }
}

function stringOpSymbol(op: StringOp): string {
  switch (op) {
    case 'equals':
      return '='
    case 'not-equals':
      return '≠'
    case 'contains':
      return '⊃'
    case 'not-contains':
      return '⊅'
    case 'regex':
      return '~'
    case 'not-matches':
      return '≁'
  }
}

function dateOpSymbol(op: Exclude<DateOp, 'range'>): string {
  switch (op) {
    case 'equals':
      return '='
    case 'before':
      return '<'
    case 'after':
      return '>'
  }
}

// ─── Builder helpers (the DOM builder in index.ts drives these) ─────

/** The clause kind a field's shape admits — drives the builder's op set + inputs. */
export function clauseKindForField(field: WireField): FieldKind {
  return parseFieldShape(field.shape)
}

/** A sensible default clause when a field is first added to the lens. */
export function defaultClauseFor(field: WireField): Clause {
  const k = parseFieldShape(field.shape)
  switch (k.kind) {
    case 'enum':
      return { kind: 'enum', field: field.name, op: 'in', values: k.values.length ? [k.values[0]] : [] }
    case 'number':
      return { kind: 'number', field: field.name, op: 'equals', value: undefined }
    case 'boolean':
      return { kind: 'boolean', field: field.name, op: 'equals', value: true }
    case 'date':
    case 'datetime':
      return { kind: 'date', field: field.name, op: 'after', value: '' }
    case 'string':
      return { kind: 'string', field: field.name, op: 'contains', value: '' }
    case 'other':
      // type-refs / unions / bounds — presence is the only generic filter.
      return { kind: 'presence', field: field.name, op: 'exists' }
  }
}
