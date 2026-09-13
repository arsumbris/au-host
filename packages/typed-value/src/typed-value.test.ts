import { describe, it, expect } from 'vitest'
import type { WireField, WireShape } from '@arsumbris/au-engine-sdk/reads'
import { resolve, type TypeGraphPort } from './resolve'
import { validate } from './validate'
import { normalize } from './normalize'
import type { ResolvedShape } from './contracts'

// A canned type graph: typeName -> its effective WireField[]. No daemon. `subs` maps a base to its concrete
// subtypes; `nonClaimable` lists abstract/sealed ceilings. A name is "known" if it appears anywhere.
function portFrom(
  graph: Record<string, WireField[]>,
  subs: Record<string, string[]> = {},
  nonClaimable: string[] = [],
): TypeGraphPort {
  const nc = new Set(nonClaimable)
  const known = new Set<string>([...Object.keys(graph), ...Object.keys(subs), ...Object.values(subs).flat()])
  return {
    effectiveFields: async (name) => graph[name] ?? null,
    subtypes: async (base) => (subs[base] ?? []).map((n) => ({ name: n, label: n })),
    claimable: async (name) => (known.has(name) ? !nc.has(name) : null),
  }
}

function field(name: string, shape_ast: WireShape, required = true): WireField {
  return { name, shape: 'x', shape_ast, required }
}

const emptyPort = portFrom({})

describe('resolve — leaves', () => {
  it('passes primitives, enums, refined and any through', async () => {
    expect(await resolve({ kind: 'primitive', name: 'String' }, emptyPort)).toEqual({ kind: 'primitive', name: 'String' })
    expect(await resolve({ kind: 'enum', members: ['a', 'b'] }, emptyPort)).toEqual({ kind: 'enum', members: ['a', 'b'] })
    expect(await resolve({ kind: 'any' }, emptyPort)).toEqual({ kind: 'any' })
  })

  it('resolves a def-reference bound to its subtypes', async () => {
    const port = portFrom({}, { projection: ['bento', 'editor'] })
    const r = await resolve({ kind: 'def-reference', bound: { kind: 'single', name: 'projection' } }, port)
    expect(r).toEqual({
      kind: 'def-reference',
      bound: { kind: 'single', name: 'projection' },
      candidates: [{ name: 'bento', label: 'bento' }, { name: 'editor', label: 'editor' }],
    })
  })

  it('carries a reference by name (file / any ride reference)', async () => {
    expect(await resolve({ kind: 'reference', name: 'file' }, emptyPort)).toEqual({ kind: 'reference', typeName: 'file' })
  })
})

describe('resolve — records use EFFECTIVE fields', () => {
  it('resolves a record to its (effective) fields', async () => {
    const port = portFrom({
      selection: [field('anchor', { kind: 'primitive', name: 'String' }), field('kind', { kind: 'enum', members: ['x', 'y'] }, false)],
    })
    const r = await resolve({ kind: 'record', name: 'selection' }, port)
    expect(r.kind).toBe('record')
    if (r.kind !== 'record') return
    expect(r.typeName).toBe('selection')
    expect(r.fields.map((f) => f.name)).toEqual(['anchor', 'kind'])
    expect(r.fields[0]!.shape).toEqual({ kind: 'primitive', name: 'String' })
    expect(r.fields[1]!.required).toBe(false)
  })

  it('an unknown record type is unresolvable, not a throw', async () => {
    const r = await resolve({ kind: 'record', name: 'nope' }, emptyPort)
    expect(r.kind).toBe('unresolvable')
  })

  it('inline-or-reference resolves its record branch', async () => {
    const port = portFrom({ selection: [field('anchor', { kind: 'primitive', name: 'String' })] })
    const r = await resolve({ kind: 'inline-or-reference', name: 'selection' }, port)
    expect(r.kind).toBe('inline-or-reference')
    if (r.kind !== 'inline-or-reference') return
    expect(r.record.kind).toBe('record')
  })
})

describe('resolve — the general subtype selector (record-choice)', () => {
  it('a CONCRETE base with subtypes → an OPTIONAL choice: the base itself first, then its subtypes', async () => {
    const port = portFrom(
      {
        shape2d: [field('name', { kind: 'primitive', name: 'String' })],
        circle: [field('name', { kind: 'primitive', name: 'String' }), field('radius', { kind: 'primitive', name: 'Number' })],
        rect: [field('name', { kind: 'primitive', name: 'String' }), field('w', { kind: 'primitive', name: 'Number' })],
      },
      { shape2d: ['circle', 'rect'] },
    )
    const r = await resolve({ kind: 'record', name: 'shape2d' }, port)
    expect(r.kind).toBe('record-choice')
    if (r.kind !== 'record-choice') return
    expect(r.claimable).toBe(true)
    expect(r.options.map((o) => o.typeName)).toEqual(['shape2d', 'circle', 'rect']) // base first (default)
    expect(r.options[1]!.fields.map((f) => f.name)).toEqual(['name', 'radius']) // subtype's richer shape
  })

  it('an ABSTRACT/sealed base → a MANDATORY choice: subtypes only, no base default', async () => {
    const port = portFrom(
      {
        'file-selection': [field('path', { kind: 'primitive', name: 'String' })],
        'link-selection': [field('target', { kind: 'primitive', name: 'String' })],
      },
      { selection: ['file-selection', 'link-selection'] },
      ['selection'], // abstract
    )
    const r = await resolve({ kind: 'record', name: 'selection' }, port)
    expect(r.kind).toBe('record-choice')
    if (r.kind !== 'record-choice') return
    expect(r.claimable).toBe(false)
    expect(r.options.map((o) => o.typeName)).toEqual(['file-selection', 'link-selection']) // no base
    expect(r.options[0]!.fields.map((f) => f.name)).toEqual(['path'])
    expect(r.options[1]!.fields.map((f) => f.name)).toEqual(['target'])
  })

  it('a concrete leaf with NO subtypes stays a plain record (unchanged)', async () => {
    const port = portFrom({ leaf: [field('a', { kind: 'primitive', name: 'String' })] })
    const r = await resolve({ kind: 'record', name: 'leaf' }, port)
    expect(r.kind).toBe('record')
  })
})

describe('resolve — cycle guard terminates', () => {
  it('a mutually-recursive record graph resolves finitely with a recursion back-edge', async () => {
    // A.b : B , B.a : A  — legal, and would loop forever without the guard.
    const port = portFrom({
      A: [field('b', { kind: 'record', name: 'B' })],
      B: [field('a', { kind: 'record', name: 'A' })],
    })
    const r = await resolve({ kind: 'record', name: 'A' }, port)
    // A -> b:B -> a:A(recursion)
    expect(r.kind).toBe('record')
    if (r.kind !== 'record') return
    const b = r.fields[0]!.shape as ResolvedShape
    expect(b.kind).toBe('record')
    if (b.kind !== 'record') return
    const a = b.fields[0]!.shape as ResolvedShape
    expect(a).toEqual({ kind: 'recursion', typeName: 'A' })
  })

  it('a self-referential record via a list still terminates', async () => {
    const port = portFrom({
      node: [field('children', { kind: 'list', min: 0, inner: { kind: 'record', name: 'node' } }, false)],
    })
    const r = await resolve({ kind: 'record', name: 'node' }, port)
    expect(r.kind).toBe('record')
    if (r.kind !== 'record') return
    const list = r.fields[0]!.shape
    expect(list.kind).toBe('list')
    if (list.kind !== 'list') return
    expect(list.inner).toEqual({ kind: 'recursion', typeName: 'node' })
  })
})

describe('validate — best-effort leaf checks', () => {
  const rec = (fields: { name: string; shape: ResolvedShape; required: boolean }[]): ResolvedShape => ({
    kind: 'record',
    typeName: 't',
    fields,
  })

  it('flags a missing required field', () => {
    const d = validate({}, rec([{ name: 'a', required: true, shape: { kind: 'primitive', name: 'String' } }]))
    expect(d).toHaveLength(1)
    expect(d[0]!.path).toEqual(['a'])
  })

  it('accepts a present required field', () => {
    const d = validate({ a: 'hi' }, rec([{ name: 'a', required: true, shape: { kind: 'primitive', name: 'String' } }]))
    expect(d).toHaveLength(0)
  })

  it('flags an enum non-member and a non-integer', () => {
    expect(validate('c', { kind: 'enum', members: ['a', 'b'] })).toHaveLength(1)
    expect(validate(1.5, { kind: 'refined', base: 'Number', refinement: { integer: true } })).toHaveLength(1)
  })

  it('enforces list cardinality', () => {
    const shape: ResolvedShape = { kind: 'list', min: 2, inner: { kind: 'primitive', name: 'String' } }
    expect(validate(['x'], shape)).toHaveLength(1)
    expect(validate(['x', 'y'], shape)).toHaveLength(0)
  })
})

describe('normalize — per consumer', () => {
  it('fire returns the flat map and flags a routing-key collision', () => {
    expect(normalize({ name: 'x' }, 'fire').value).toEqual({ name: 'x' })
    const bad = normalize({ type: 'oops', name: 'x' }, 'fire')
    expect(bad.diagnostics).toHaveLength(1)
  })

  it('authoring wraps with a top-level type', () => {
    const r = normalize({ name: 'x' }, 'authoring', { typeName: 'my-type' })
    expect(r.value).toEqual({ type: 'my-type', name: 'x' })
    expect(r.diagnostics).toHaveLength(0)
  })
})
