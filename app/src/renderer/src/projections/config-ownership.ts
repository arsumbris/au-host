// Preserve config fields outside a projection's effective shape when it calls `saveConfig`.
// The projection owns its declared and inherited fields; the host retains fields from other mixed-in
// types and extras. Otherwise a container that serializes only its layout could silently discard
// optional routing fields while leaving an engine-valid document.
// Derive ownership from the discovered type graph for every writer. Install the provider whenever
// discovery changes because synchronous saves cannot await a type read.

import { refName } from '@arsumbris/type-query'

import type { DiscoveredProjection } from './discovery'

/** Bare type name -> the field names that type owns. Empty until the first discovery pass. */
let shapes: ReadonlyMap<string, ReadonlySet<string>> = new Map()

/**
 * Install the owned-field sets from the current discovery result.
 *
 * Names are workspace-unique, so both sides compare BARE — a `::repo` qualifier is a scope, not part
 * of the name, and a node's `type:` may be written either way.
 */
export function installConfigOwnership(projections: readonly DiscoveredProjection[]): void {
  const next = new Map<string, ReadonlySet<string>>()
  for (const p of projections) next.set(refName(p.typeName), new Set(p.ownedFields))
  shapes = next
}

/**
 * The fields `type` owns, or `undefined` when its shape is UNKNOWN — no discovery pass yet, or a
 * type-def that is not discoverable.
 *
 * `undefined` is not the same as "owns nothing", and the caller must not conflate them: an unknown
 * shape means the host cannot compute the boundary, and the safe response is to carry EVERYTHING
 * the projection emitted (patch-like, never destructive). Owning nothing would mean the opposite.
 */
export function ownedFieldsOf(type: string | undefined): ReadonlySet<string> | undefined {
  const bare = refName(type ?? '')
  return bare ? shapes.get(bare) : undefined
}

/**
 * Merge a projection's emitted config over the one it was handed, so unowned fields survive.
 *
 * - fields in the projection's OWN shape come from `emitted`. Absence there is a real removal —
 *   a sandwich dropping `leftCollapsed` must be able to mean it. The host TRUSTS a projection with
 *   its own data.
 * - everything else comes from `input`, verbatim. The host GUARANTEES it. That is the cross-cutting
 *   silent harm, and no consumer can route around it.
 * - `type` is the composition's, stamped by the caller.
 *
 * COMPOSITION-FIELD-SAFE BY CONSTRUCTION. The owned set is one type's shape; a composition's
 * `intent-routing` field (and any record-level mixin like `grouping-choice`) is OUTSIDE a pane
 * projection's shape, so it lands in the guaranteed half without anything special-casing it.
 */
export function mergeOwned(
  input: unknown,
  emitted: Record<string, unknown>,
  owned: ReadonlySet<string>,
): Record<string, unknown> {
  const base = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  // Everything the projection does NOT own, carried verbatim from what it was handed.
  for (const [k, v] of Object.entries(base)) if (!owned.has(k)) out[k] = v
  // Its own shape, exactly as emitted — including by omission.
  for (const [k, v] of Object.entries(emitted)) if (owned.has(k)) out[k] = v
  return out
}

/**
 * Field names that were on the input, are in the projection's OWN shape, and are absent from its
 * output — i.e. the projection dropped its own data.
 *
 * NOT an error and NOT corrected: omission legitimately means removal, which is the whole reason
 * the host trusts a projection with its own shape. But the honest mistake (a container rebuilding
 * from a model that forgot a field) looks identical to a deliberate removal at this seam, so it is
 * surfaced as a dev-time warning rather than silently accepted or silently fixed.
 */
export function droppedOwnFields(
  input: unknown,
  emitted: Record<string, unknown>,
  owned: ReadonlySet<string>,
): string[] {
  const base = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return Object.keys(base).filter((k) => owned.has(k) && !(k in emitted))
}
