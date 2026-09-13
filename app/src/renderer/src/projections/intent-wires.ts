// The switchboard's PURE wire logic: the parsed wire shape + broken/unavailable classification.
// Dependency-free (types only), so it is unit-testable outside the renderer and reused by BOTH the
// dispatch wire-override (composition.ts `resolveWire`) and the overlay's "drawn broken".



import type { PublisherId } from '@arsumbris/au-host-sdk'

/** One parsed `intent-wire`: an EXPLICIT per-connection routing, addressed by POOL block-ids (not
 *  role kinds). `source` fires `intent`; `targets` ARE the recipients, overriding the intent's default
 *  reach. `mode` disposes a `once`-intent non-claim (strict = fail closed, fallback = then the default
 *  MRU minus tried). */
export interface Wire {
  source: string
  intent: string
  targets: string[]
  mode: 'strict' | 'fallback'
}

/** One endpoint of a wire, resolved against the live runtime: its pool block-id, its record TYPE (from
 *  the mounted node if live, else the pool record — undefined when unknowable), and its live PUBLISHER
 *  (undefined when the record is not currently mounted). */
export interface WireEndpoint {
  poolId: string
  type: string | undefined
  publisher: PublisherId | undefined
}

/** The delivery classification of a wire against the live runtime + the type graph.
 *  - `broken` (SOURCE drift): the firer's type no longer declares `fires` this intent → the whole wire
 *    is void, route as if UNWIRED (default routing). Never fail-closed — a broken cable is ignored.
 *  - `brokenTargets` (RECIPIENT drift): a recipient's type no longer declares `handles` this intent →
 *    excluded from delivery (the overlay draws it broken).
 *  - `unavailableTargets` (LIVENESS): a valid recipient with no live handler right now (unmounted, a
 *    background tab) → excluded; under strict the wire still fails CLOSED, under fallback it continues.
 *  - `recipients` are the surviving LIVE, capability-valid publishers, in target order. */
export interface WireDeliveryClassification {
  broken: boolean
  recipients: PublisherId[]
  brokenTargets: string[]
  unavailableTargets: string[]
}

/**
 * Classify a wire's delivery for one fired intent, distinguishing capability DRIFT (broken, a
 * type-graph fact) from runtime LIVENESS (unavailable, a mount fact).
 *
 * `firesOf` / `handlesOf` return a record type's declared fired / handled intents, or `undefined` when
 * the type is not a discovered projection (unknowable → NOT treated as broken, mirroring the dispatch
 * gate's exemption). An endpoint with an unknown type is likewise never broken.
 */
export function classifyWireDelivery(
  intentType: string,
  source: WireEndpoint,
  targets: WireEndpoint[],
  firesOf: (type: string) => string[] | undefined,
  handlesOf: (type: string) => string[] | undefined,
): WireDeliveryClassification {
  // BROKEN SOURCE: the firer's type no longer declares `fires` this intent → route as UNWIRED.
  const declaredFires = source.type !== undefined ? firesOf(source.type) : undefined
  if (declaredFires !== undefined && !declaredFires.includes(intentType)) {
    return { broken: true, recipients: [], brokenTargets: [], unavailableTargets: [] }
  }
  const recipients: PublisherId[] = []
  const brokenTargets: string[] = []
  const unavailableTargets: string[] = []
  for (const t of targets) {
    // BROKEN TARGET: the recipient's type no longer declares `handles` this intent → excluded.
    const declaredHandles = t.type !== undefined ? handlesOf(t.type) : undefined
    if (declaredHandles !== undefined && !declaredHandles.includes(intentType)) {
      brokenTargets.push(t.poolId)
      continue
    }
    // UNAVAILABLE: a valid recipient with no live handler right now (unmounted) → excluded.
    if (t.publisher === undefined) {
      unavailableTargets.push(t.poolId)
      continue
    }
    recipients.push(t.publisher)
  }
  return { broken: false, recipients, brokenTargets, unavailableTargets }
}

/** Upsert one wire into a wire table, enforcing the one-per-(source, intent) invariant: drop any
 *  existing wire for that connection, then append `wire`. Pure — the overlay's `setWire` and its probe
 *  share it, so the "one connection is one record" rule lives in one place. */
export function upsertWire(wires: Wire[], wire: Wire): Wire[] {
  return [...wires.filter((w) => !(w.source === wire.source && w.intent === wire.intent)), wire]
}

/** Remove the wire for (source, intent) from a wire table. A no-op when absent. Pure. */
export function removeWire(wires: Wire[], source: string, intent: string): Wire[] {
  return wires.filter((w) => !(w.source === source && w.intent === intent))
}

/**
 * Serialize a wire table to the AUTHORED `intent-wire` record form the composition document carries:
 *  `source` / `targets` as pool block-refs (`[[^^id]]`), `intent` as a BARE def-ref (`[[name]]`). The
 *  intent stays BARE on purpose — the one qualify chokepoint on write rewrites a known type name to
 *  `[[name::repo]]` ( finding), so emitting it qualified here would double-qualify. `mode` is
 *  always emitted, so a cable's disposition is self-documenting in the yaml (absent would read strict).
 */
export function toAuthoredWires(wires: Wire[]): Array<Record<string, unknown>> {
  return wires.map((w) => ({
    source: `[[^^${w.source}]]`,
    intent: `[[${w.intent}]]`,
    targets: w.targets.map((t) => `[[^^${t}]]`),
    mode: w.mode,
  }))
}

/** A load-time validation finding over the wire table + the pool. Advisory (warn): a duplicate is
 *  ambiguous, a dangling wire is inert by construction — neither blocks the composition. */
export interface WireValidationFinding {
  code: 'intent-wire-duplicate' | 'intent-wire-dangling'
  source: string
  intent: string
  /** The dangling target pool-id, when the finding is a dangling TARGET (absent for a dangling source). */
  target?: string
  message: string
}

/**
 * Validate the wire table against the pool at load: ONE wire per (source, intent) (a duplicate is
 * ambiguous — the overlay edits one record per connection), and every `source`/`target` names a pool
 * record that EXISTS (a reference to a record that left the pool is DANGLING → inert by construction,
 * since dispatch keys by a live pool-id, so this only surfaces it). Pure over `poolIds`, so it is
 * unit-testable and reused wherever the pool + wires are both known.
 */
export function validateWires(wires: Wire[], poolIds: ReadonlySet<string>): WireValidationFinding[] {
  const findings: WireValidationFinding[] = []
  const seen = new Set<string>()
  for (const w of wires) {
    const key = `${w.source}\0${w.intent}`
    if (seen.has(key)) {
      findings.push({
        code: 'intent-wire-duplicate',
        source: w.source,
        intent: w.intent,
        message: `more than one intent-wire for (source ${w.source}, intent ${w.intent}); one connection is one record, so a duplicate is ambiguous`,
      })
    }
    seen.add(key)
    if (!poolIds.has(w.source)) {
      findings.push({
        code: 'intent-wire-dangling',
        source: w.source,
        intent: w.intent,
        message: `intent-wire source "${w.source}" is not a pool record (it left the pool); the wire is inert`,
      })
    }
    for (const t of w.targets) {
      if (!poolIds.has(t)) {
        findings.push({
          code: 'intent-wire-dangling',
          source: w.source,
          intent: w.intent,
          target: t,
          message: `intent-wire target "${t}" is not a pool record (it left the pool); it is inert`,
        })
      }
    }
  }
  return findings
}
