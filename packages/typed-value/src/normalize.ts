// `normalize` — render one canonical value to the shape a specific CONSUMER needs.
//
// The editor emits an engine inline-record-shaped value: a nested record carries
// its own `type:` claim, the TOP level is a bare field map. Consumers differ only
// at the top level:
// - `fire` — the flat field map spread onto `host.intent.fire`'s payload envelope;
//   the routing keys (`type` / `kind` / `dispatch`) live on the envelope, so a
//   payload FIELD of that name would collide — reported, never silently spread.
// - `authoring` — a top-level instance value carrying a top-level `type:` claim.

import type { NormalizeTarget, TypedValue, ValueDiagnostic } from './contracts'

/** The routing keys `host.intent.fire` owns on the payload envelope. */
const RESERVED_FIRE_KEYS = ['type', 'kind', 'dispatch'] as const

export interface NormalizeResult {
  value: TypedValue
  /** Non-fatal issues (e.g. a `fire` payload field colliding with a routing key). */
  diagnostics: ValueDiagnostic[]
}

/**
 * Normalize a filled value for its consumer. `typeName` is required for
 * `authoring` (the top-level `type:` claim); ignored for `fire`.
 */
export function normalize(
  value: TypedValue,
  target: NormalizeTarget,
  opts?: { typeName?: string },
): NormalizeResult {
  const diagnostics: ValueDiagnostic[] = []
  if (target === 'authoring') {
    if (!opts?.typeName) diagnostics.push({ path: [], severity: 'error', message: 'authoring needs a top-level type' })
    return { value: { type: opts?.typeName, ...asRecord(value) }, diagnostics }
  }
  // fire: the flat map is spread onto the envelope — flag a routing-key collision.
  const rec = asRecord(value)
  for (const key of RESERVED_FIRE_KEYS) {
    if (key in rec) diagnostics.push({ path: [key], severity: 'error', message: `payload field "${key}" collides with a routing key` })
  }
  return { value: rec, diagnostics }
}

function asRecord(value: TypedValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
