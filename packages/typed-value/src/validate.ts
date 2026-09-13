// `validate` — best-effort, engine-authoritative behind it.
//
// It mirrors only the cheap `WireShape`-local checks a live editor needs
// (required-present, primitive conformance, enum membership, list cardinality,
// refinement predicates). It never reimplements the validator (closure walks,
// reference existence, cross-repo) — the engine backstops on write / fire.

import type { WirePrimitiveName, WireRefinement } from '@arsumbris/au-engine-sdk/reads'
import type { ResolvedShape, ValueDiagnostic } from './contracts'

/** Collect best-effort diagnostics for `value` against its resolved shape. */
export function validate(value: unknown, shape: ResolvedShape): ValueDiagnostic[] {
  const out: ValueDiagnostic[] = []
  walk(value, shape, [], out)
  return out
}

/** A value counts as absent (an unfilled slot) when nullish or an empty string. */
function isAbsent(v: unknown): boolean {
  return v === undefined || v === null || v === ''
}

function walk(value: unknown, shape: ResolvedShape, path: string[], out: ValueDiagnostic[]): void {
  switch (shape.kind) {
    case 'primitive':
      if (!isAbsent(value)) checkPrimitive(value, shape.name, path, out)
      break
    case 'refined':
      if (!isAbsent(value)) {
        checkPrimitive(value, shape.base, path, out)
        checkRefinement(value, shape.base, shape.refinement, path, out)
      }
      break
    case 'enum':
      if (!isAbsent(value) && !shape.members.includes(String(value)))
        err(out, path, `must be one of: ${shape.members.join(', ')}`)
      break
    case 'record': {
      if (isAbsent(value)) break
      if (typeof value !== 'object' || Array.isArray(value)) {
        err(out, path, 'expected a record')
        break
      }
      const rec = value as Record<string, unknown>
      for (const f of shape.fields) {
        const fv = rec[f.name]
        if (f.required && isAbsent(fv)) err(out, [...path, f.name], 'required')
        else if (!isAbsent(fv)) walk(fv, f.shape, [...path, f.name], out)
      }
      break
    }
    case 'record-choice': {
      if (isAbsent(value)) break // absence is the parent's required check; here we check the type pick
      if (typeof value !== 'object' || Array.isArray(value)) {
        err(out, path, 'expected a record')
        break
      }
      const rec = value as Record<string, unknown>
      const chosen = typeof rec.type === 'string' ? shape.options.find((o) => o.typeName === rec.type) : undefined
      // A non-claimable ceiling REQUIRES a concrete pick; a claimable one defaults to the base (options[0]).
      const active = chosen ?? (shape.claimable ? shape.options[0] : undefined)
      if (!active) {
        err(out, path, 'select a type')
        break
      }
      for (const f of active.fields) {
        const fv = rec[f.name]
        if (f.required && isAbsent(fv)) err(out, [...path, f.name], 'required')
        else if (!isAbsent(fv)) walk(fv, f.shape, [...path, f.name], out)
      }
      break
    }
    case 'inline-or-reference':
      // inline record OR a reference string; only deep-check the inline branch.
      if (!isAbsent(value) && typeof value === 'object' && !Array.isArray(value))
        walk(value, shape.record, path, out)
      break
    case 'list': {
      if (isAbsent(value)) break
      if (!Array.isArray(value)) {
        err(out, path, 'expected a list')
        break
      }
      if (value.length < shape.min) err(out, path, `at least ${shape.min} item(s)`)
      if (shape.max !== undefined && value.length > shape.max)
        err(out, path, `at most ${shape.max} item(s)`)
      value.forEach((item, i) => walk(item, shape.inner, [...path, String(i)], out))
      break
    }
    case 'pinned':
      if (!isAbsent(value)) walk(value, shape.inner, path, out)
      break
    // reference / def-reference / any / union / intersection / compound-reference /
    // recursion / unresolvable: no cheap local check — the engine backstops.
    default:
      break
  }
}

function checkPrimitive(value: unknown, name: WirePrimitiveName, path: string[], out: ValueDiagnostic[]): void {
  switch (name) {
    case 'Number':
      if (typeof value !== 'number' && !Number.isFinite(Number(value)))
        err(out, path, 'must be a number')
      break
    case 'Boolean':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false')
        err(out, path, 'must be true or false')
      break
    case 'Url':
      if (!/^https?:\/\//.test(String(value))) err(out, path, 'must be an http(s) URL')
      break
    case 'Date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) err(out, path, 'must be a date (YYYY-MM-DD)')
      break
    // String / DateTime: accept as-is (engine backstops the strict DateTime form).
    default:
      break
  }
}

function checkRefinement(
  value: unknown,
  base: WirePrimitiveName,
  ref: WireRefinement,
  path: string[],
  out: ValueDiagnostic[],
): void {
  if (base === 'Number') {
    const n = Number(value)
    if (Number.isFinite(n)) {
      if (ref.integer && !Number.isInteger(n)) err(out, path, 'must be a whole number')
      if (ref.lower) {
        const b = Number(ref.lower.value)
        if (ref.lower.inclusive ? n < b : n <= b) err(out, path, `must be ${ref.lower.inclusive ? '≥' : '>'} ${b}`)
      }
      if (ref.upper) {
        const b = Number(ref.upper.value)
        if (ref.upper.inclusive ? n > b : n >= b) err(out, path, `must be ${ref.upper.inclusive ? '≤' : '<'} ${b}`)
      }
    }
  }
  if (base === 'String' && ref.pattern) {
    try {
      if (!new RegExp(ref.pattern).test(String(value))) err(out, path, `must match /${ref.pattern}/`)
    } catch {
      // an unsupported pattern is the engine's to flag, not ours.
    }
  }
}

function err(out: ValueDiagnostic[], path: string[], message: string): void {
  out.push({ path, severity: 'error', message })
}
