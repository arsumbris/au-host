// The contracts of the typed-value editor primitive.
//
// `ResolvedShape` is the input the presentational editor renders: the engine's
// `WireShape` with the graph reads ALREADY DONE (a record's EFFECTIVE fields via
// `type_closure`, a def-reference's candidate subtypes) and recursion made
// explicit (a cycle back-edge is a `recursion` node, never an infinite expansion).
// The editor holds a `ResolvedShape` and emits a value; it never reads the graph.
//
// `TypedValue` is what a filled editor produces: an engine inline-record-shaped
// value (nested records carry their own `type:` claim; the top level is a bare
// field map). `normalize` renders it to the shape a specific CONSUMER needs.

import type {
  WireDefBound,
  WirePrimitiveName,
  WireRefinement,
  WireShape,
} from '@arsumbris/au-engine-sdk/reads'

/**
 * A slot shape with its graph reads resolved, ready to render. Mirrors the
 * `WireShape` union (`au-engine-sdk` reads), except:
 * - `record` carries its resolved EFFECTIVE `fields` (own + inherited), not a bare name.
 *   ONLY when the ceiling is concrete with no proper subtypes — a single fixed shape.
 * - `record-choice` is a record slot whose ceiling admits a CHOICE of concrete
 *   types: the ceiling itself (when claimable) plus every concrete type in its
 *   subtree, each with its own EFFECTIVE fields. A slot `field: T` accepts T or
 *   any `T' < T` (width-only subtyping adds fields); a NON-claimable ceiling
 *   (abstract / sealed) requires a concrete `type:` pick, a claimable one defaults
 *   to itself. The general subtype selector.
 * - `def-reference` carries its resolved `candidates` (the bound's subtypes).
 * - `recursion` is the cycle-guard back-edge: a record type already on the resolve
 *   path, surfaced instead of re-expanded (keeps a cyclic type finite).
 * - `unresolvable` captures a shape the resolver could not complete (unknown type),
 *   carrying the raw `WireShape` so the editor can degrade to a raw control.
 * A `reference` (`T*` / `file*` / `any*`) carries NO candidate list — those pull
 * lazily through the editor's `ResolveOptions` callback (the set can be large).
 */
export type ResolvedShape =
  | { kind: 'primitive'; name: WirePrimitiveName }
  | { kind: 'refined'; base: WirePrimitiveName; refinement: WireRefinement }
  | { kind: 'enum'; members: string[] }
  | { kind: 'any' }
  | { kind: 'reference'; typeName: string }
  | { kind: 'def-reference'; bound?: WireDefBound; candidates: ResolvedDefRef[] }
  | { kind: 'record'; typeName: string; fields: ResolvedField[] }
  | { kind: 'record-choice'; typeName: string; claimable: boolean; options: ResolvedRecordChoice[] }
  | { kind: 'inline-or-reference'; typeName: string; record: ResolvedShape }
  | { kind: 'list'; min: number; max?: number; inner: ResolvedShape }
  | { kind: 'union'; branches: ResolvedShape[] }
  | { kind: 'intersection'; branches: ResolvedShape[] }
  | {
      kind: 'compound-reference'
      mode: 'ref' | 'inline-or-ref'
      op: 'union' | 'intersection'
      typeNames: string[]
    }
  | { kind: 'pinned'; inner: ResolvedShape }
  | { kind: 'recursion'; typeName: string }
  | { kind: 'unresolvable'; reason: string; raw: WireShape }

/**
 * One selectable concrete type for a `record-choice` slot: the ceiling itself
 * (when claimable) or a concrete type in its subtree, carrying that type's
 * EFFECTIVE fields (own + inherited). Picking one stamps its `type:` on the value.
 */
export interface ResolvedRecordChoice {
  /** The concrete type-def name; the value written as the record's `type:` claim. */
  typeName: string
  /** A human label (the bare type name, or a friendlier form). */
  label: string
  /** The type's `#:` docstring, advisory. */
  doc?: string
  /** That type's effective fields (own + inherited). */
  fields: ResolvedField[]
}

/** One field of a resolved `record`, its own shape resolved in turn. */
export interface ResolvedField {
  name: string
  /** The field's `#:` docstring, advisory. */
  doc?: string
  required: boolean
  shape: ResolvedShape
}

/** A candidate type-def for a `def-reference` slot (the bound's subtypes). */
export interface ResolvedDefRef {
  /** The type-def name, the value written into the slot. */
  name: string
  /** A human label (bare name, or a friendlier form). */
  label: string
}

/**
 * A value a filled editor produces, engine inline-record-shaped: a nested record
 * carries its own `type:` claim, a list is an array, a scalar/enum is a literal,
 * a reference is a `[[wikilink]]` string. The TOP level is a bare field map (no
 * `type:` — that is the consumer's business, see `NormalizeTarget`).
 */
export type TypedValue = unknown

/**
 * Which consumer the value is being handed to. `normalize` renders the same value
 * tree to the shape each expects:
 * - `fire` — a flat payload map for `host.intent.fire`; the routing keys
 *   (`type` / `kind` / `dispatch`) live on the envelope, so a payload FIELD of
 *   that name is namespaced, never spread raw.
 * - `authoring` — a top-level instance value carrying a top-level `type:` claim.
 */
export type NormalizeTarget = 'fire' | 'authoring'

/** A picker candidate for a `reference` / `file*` slot. */
export interface EditorOption {
  /** The value written into the slot (a wikilink target or a literal). */
  id: string
  label: string
  detail?: string
}

/**
 * The editor's data-source seam. The editor calls it for a picker slot; the host
 * wrapper wires it to an engine read (`readInstancesOf` for `T*`, `readFiles` for
 * `file*`). Keyed by the slot's PATH in the value tree, so one callback serves
 * every picker slot in a recursive form.
 */
export type ResolveOptions = (slotPath: string[], query: string) => Promise<EditorOption[]>

/**
 * A best-effort validation finding, engine-authoritative behind it. The core
 * mirrors only the cheap `WireShape`-local checks (required-present, primitive
 * conformance, enum membership, list cardinality, refinement predicates); the
 * engine backstops the rest on write / fire.
 */
export interface ValueDiagnostic {
  /** The slot path the finding is about. */
  path: string[]
  severity: 'error' | 'warning'
  message: string
}
