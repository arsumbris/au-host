// The pure key + reflect-decision logic for the portal's selective remount and leaves' reflect-in-place.
//
// Split out of `composition.ts` so it carries NO renderer dependencies and can be driven directly by a
// deterministic probe (the repo's "drive the real predicate" discipline — see probe-leaf-reflect.ts). The
// runtime (`CompositionRuntime`) owns the STATE (the epoch / handler / digest maps and the pool); this
// module owns the PURE decisions those maps feed.

import { bareTypeName } from '@arsumbris/au-host-sdk'
import type { ContainerSchemas, SlotSchema } from '@arsumbris/au-host-sdk'

/** A key-order-stable serialization of a value, so structurally equal records digest identically
 *  regardless of the order their keys were assembled in (a pool record is rebuilt by spread on every
 *  merge). The digest feeds the portal's `contentKey` selective-remount test, and the host's dirty
 *  baseline (a load echo that round-trips to the same structure must not read as an unsaved edit). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** The container schema governing a record, or undefined if the record is a LEAF (no container schema, or
 *  one with zero child fields). THE ONE predicate that decides leaf-vs-container — shared by `contentKeyOf`
 *  and the reflect pass, so the two can never diverge. A divergence would epoch-bump a container (see the
 *  reflect pass) → remount the whole subtree, the exact class `contentKeyOf` strips child fields to avoid. */
export function containerSchemaOf(record: unknown, schemas: ContainerSchemas): SlotSchema | undefined {
  if (record === null || typeof record !== 'object') return undefined
  const typeVal = (record as { type?: unknown }).type
  const names = Array.isArray(typeVal) ? typeVal.map((t) => bareTypeName(String(t))) : [bareTypeName(String(typeVal))]
  const schema = names.map((n) => schemas.containers.get(n)).find((s) => s != null)
  return schema && schema.fields.length > 0 ? schema : undefined
}

/** A leaf's TYPE identity — the mixin names bare-normalized and order-stable. A change here is an IDENTITY
 *  change (the record became a different projection type), the one thing that remounts a registered leaf. */
export function leafTypeKey(record: unknown): string {
  const typeVal = (record as { type?: unknown } | null)?.type
  const names = Array.isArray(typeVal) ? typeVal.map((t) => bareTypeName(String(t))) : [bareTypeName(String(typeVal))]
  return stableStringify([...names].sort())
}

/** A leaf's full CONTENT digest — its whole record. Differs from `leafTypeKey` on any content change (a new
 *  `file`), which a registered leaf reflects in place and an unregistered one remounts for. */
export function leafDigest(record: unknown): string {
  return stableStringify(record)
}

/**
 * Compute a selective-remount key for a pooled record.
 * Containers key only on type identity: config and child changes reflect in place, preserving anchors,
 * publishers, and descendant state. A type or mixin change remounts the container.
 * Leaves key on type identity plus a per-pane epoch. A registered leaf reflects content changes through
 * `onOwnConfigChange`; the reflect pass bumps an unregistered leaf's epoch to remount it. The key does
 * not depend on the live registration flag, so registering after mount does not trigger a remount.
 * Without schemas, use the full record because leaf/container classification is unavailable.
 */
export function contentKeyOf(record: unknown, schemas?: ContainerSchemas, epoch = 0): string {
  if (!schemas) return stableStringify(record)
  const schema = containerSchemaOf(record, schemas)
  if (schema) {
    // Type identity ALONE — a container reflects every config change in place (its own `commit`, or
    // `useContainerModel`'s resync for an external write), so nothing in its config (child refs, a
    // view-state pointer like `activeTab`, dialect flags) belongs in its remount key. See the doc comment.
    return leafTypeKey(record)
  }
  return `${leafTypeKey(record)}#${epoch}`
}

/** The last-seen leaf state the reflect pass diffs against. */
export interface ReflectState {
  digest: string
  typeKey: string
}

/** What the reflect pass does with one leaf record this flush, as a PURE decision over the change it sees.
 *  The runtime supplies the state and enacts the verb; this function holds the branching so it is testable
 *  in isolation and can never drift from the key. */
export type ReflectAction =
  | 'seed' // first sight — record the state, do nothing (nothing is mounted to reflect to yet)
  | 'none' // no content change
  | 'type-change' // identity changed — `contentKeyOf` remounts it; re-seed the state, never deliver a foreign-typed config
  | 'deliver' // same-type content change on a REGISTERED leaf — hand it the fresh record, no remount
  | 'bump' // same-type content change on an UNREGISTERED leaf — bump its epoch → remount (the safe fallback)

/** The reflect pass's per-record decision. `prev` is the last-seen state (undefined = first sight);
 *  `hasHandler` is whether the pane registered `onOwnConfigChange`. The decision NEVER depends on the epoch,
 *  so registration can flip without moving the key. */
export function reflectDecision(
  prev: ReflectState | undefined,
  digest: string,
  typeKey: string,
  hasHandler: boolean,
): ReflectAction {
  if (!prev) return 'seed'
  if (digest === prev.digest) return 'none'
  if (typeKey !== prev.typeKey) return 'type-change'
  return hasHandler ? 'deliver' : 'bump'
}
