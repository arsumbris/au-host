// `resolve` — turn a raw `WireShape` into a `ResolvedShape` the editor renders.
//
// It does the graph reads a record/def-reference need (via an injected
// `TypeGraphPort`, so it is pure logic and unit-testable without a daemon), and
// bakes in the two  invariants:
// - EFFECTIVE SHAPE: a record's fields are own + inherited (`type_closure`), never
//   own-only (`readType`) — else inherited required fields silently drop.
// - CYCLE GUARD: a record type already on the resolve PATH becomes a `recursion`
//   back-edge, not an infinite expansion — a cyclic type graph stays finite.

import type {
  WireField,
  WireReader,
} from '@arsumbris/au-engine-sdk/reads'
import { readSubtypes, readType, readTypeClosure } from '@arsumbris/au-engine-sdk/reads'
import type { ResolvedDefRef, ResolvedField, ResolvedRecordChoice, ResolvedShape } from './contracts'
import type { WireShape } from '@arsumbris/au-engine-sdk/reads'

/**
 * The graph lookups `resolve` needs, injected so the core stays pure. The package
 * ships `makeReaderPort(reader)` backed by the engine reads; tests pass a canned one.
 */
export interface TypeGraphPort {
  /** A record type's EFFECTIVE fields (own + inherited), or null if no such type. */
  effectiveFields(typeName: string): Promise<WireField[] | null>
  /** The candidate subtypes of a def-reference bound, and the concrete types in a record ceiling's subtree. */
  subtypes(baseName: string): Promise<ResolvedDefRef[]>
  /** Whether a type is directly claimable — concrete, i.e. NOT abstract and NOT sealed. `null` if no such type. */
  claimable(typeName: string): Promise<boolean | null>
}

/** Build a `TypeGraphPort` from a live engine reader. */
export function makeReaderPort(reader: WireReader): TypeGraphPort {
  return {
    async effectiveFields(typeName) {
      const r = await readTypeClosure(reader, typeName)
      if (!('ready' in r) || !r.ready) return null
      const entries = r.result
      if (!entries || entries.length === 0) return null // unknown type → empty array
      return entries[0]!.fields
    },
    async subtypes(baseName) {
      const r = await readSubtypes(reader, baseName)
      if (!('ready' in r) || !r.ready || !r.result) return []
      return r.result.subtypes
        .filter((d) => !d.abstract)
        .map((d) => ({ name: d.name, label: d.name }))
    },
    async claimable(typeName) {
      const r = await readType(reader, typeName)
      if (!('ready' in r) || !r.ready) return null
      const td = r.result
      if (!td) return null // no member owns the name
      // Non-claimable is `abstract || sealed` (schema 18). A concrete leaf is claimable.
      return !(td.abstract || (td.sealed !== null && td.sealed !== undefined))
    },
  }
}

/** Resolve a raw slot shape into a render-ready `ResolvedShape`. */
export async function resolve(shape: WireShape, port: TypeGraphPort): Promise<ResolvedShape> {
  return resolveInner(shape, port, new Set())
}

async function resolveInner(
  shape: WireShape,
  port: TypeGraphPort,
  path: ReadonlySet<string>,
): Promise<ResolvedShape> {
  switch (shape.kind) {
    case 'primitive':
      return { kind: 'primitive', name: shape.name }
    case 'refined':
      return { kind: 'refined', base: shape.base, refinement: shape.refinement }
    case 'enum':
      return { kind: 'enum', members: shape.members }
    case 'any':
      return { kind: 'any' }
    case 'reference':
      return { kind: 'reference', typeName: shape.name }
    case 'def-reference': {
      const candidates =
        shape.bound?.kind === 'single' ? await port.subtypes(shape.bound.name) : []
      return { kind: 'def-reference', bound: shape.bound, candidates }
    }
    case 'record':
      return resolveRecord(shape.name, shape, port, path)
    case 'inline-or-reference': {
      const record = await resolveRecord(shape.name, shape, port, path)
      return { kind: 'inline-or-reference', typeName: shape.name, record }
    }
    case 'list':
      return { kind: 'list', min: shape.min, max: shape.max, inner: await resolveInner(shape.inner, port, path) }
    case 'union':
      return { kind: 'union', branches: await Promise.all(shape.branches.map((b) => resolveInner(b, port, path))) }
    case 'intersection':
      return {
        kind: 'intersection',
        branches: await Promise.all(shape.branches.map((b) => resolveInner(b, port, path))),
      }
    case 'compound-reference':
      return { kind: 'compound-reference', mode: shape.mode, op: shape.op, typeNames: shape.branches }
    case 'pinned':
      return { kind: 'pinned', inner: await resolveInner(shape.inner, port, path) }
    default: {
      // Exhaustiveness: a new WireShape kind lands here as an explicit unresolvable.
      const raw = shape as WireShape
      return { kind: 'unresolvable', reason: `unhandled shape kind`, raw }
    }
  }
}

/**
 * Resolve a record ceiling. A concrete leaf with no proper subtypes is a plain
 * `record` (one fixed shape). Any ceiling that admits a CHOICE — a concrete base
 * with subtypes (any `T' < T` adds fields, width-only), or a non-claimable
 * (abstract / sealed) ceiling — is a `record-choice` carrying every concrete type
 * in the subtree with its effective fields. A `recursion` back-edge breaks a
 * cycle; `unresolvable` covers an unknown type.
 */
async function resolveRecord(
  typeName: string,
  raw: WireShape,
  port: TypeGraphPort,
  path: ReadonlySet<string>,
): Promise<ResolvedShape> {
  if (path.has(typeName)) return { kind: 'recursion', typeName }
  const claimable = await port.claimable(typeName)
  if (claimable === null) return { kind: 'unresolvable', reason: `unknown type "${typeName}"`, raw }
  const nextPath = new Set(path).add(typeName)

  // The option set: the ceiling itself when claimable, plus every concrete type in its subtree (deduped).
  const seen = new Set<string>()
  const optionNames: { name: string; label: string }[] = []
  if (claimable) {
    optionNames.push({ name: typeName, label: typeName })
    seen.add(typeName)
  }
  for (const s of await port.subtypes(typeName)) {
    if (!seen.has(s.name)) {
      optionNames.push(s)
      seen.add(s.name)
    }
  }

  // A concrete leaf with no proper subtypes → a single fixed record (the common case).
  if (claimable && optionNames.length === 1) {
    return { kind: 'record', typeName, fields: await resolveFields(typeName, port, nextPath) }
  }

  // Otherwise a CHOICE over the subtree — the general subtype selector.
  const options: ResolvedRecordChoice[] = await Promise.all(
    optionNames.map(async (o) => ({
      typeName: o.name,
      label: o.label,
      fields: await resolveFields(o.name, port, nextPath),
    })),
  )
  return { kind: 'record-choice', typeName, claimable, options }
}

/** Resolve a concrete type's EFFECTIVE fields, each field's shape resolved in turn (its type added to the
 *  cycle-guard path so a self-reference becomes a `recursion` back-edge). */
async function resolveFields(
  typeName: string,
  port: TypeGraphPort,
  path: ReadonlySet<string>,
): Promise<ResolvedField[]> {
  const fields = await port.effectiveFields(typeName)
  if (fields === null) return [] // known ceiling but no fields (a tag) — nothing to fill
  const nextPath = new Set(path).add(typeName)
  const resolved: ResolvedField[] = []
  for (const f of fields) {
    const shape: ResolvedShape = f.shape_ast
      ? await resolveInner(f.shape_ast, port, nextPath)
      : { kind: 'unresolvable', reason: `unparsed shape "${f.shape}"`, raw: { kind: 'any' } }
    resolved.push({ name: f.name, doc: f.doc, required: f.required, shape })
  }
  return resolved
}
