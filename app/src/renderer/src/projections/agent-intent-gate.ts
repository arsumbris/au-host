// Authorizes external intent requests before they reach the intent tree.
// The local socket is not an authentication boundary: every received payload is untrusted.
// An intent must explicitly declare that agents may fire it, and its payload must not admit
// arbitrary mountable content. Such content can launch processes or change privileged settings.
// Enforce this once at socket dispatch so every container, including third-party containers,
// receives the same protection. Routing is derived from the discovered type declaration.
// Missing declarations, unknown types and privileged payloads fail closed.

import { readSubtypes, type WireField, type WireReader, type WireShape, type WireSubtype } from '@arsumbris/au-host-sdk/engine-reads'
import { refName } from '@arsumbris/type-query'

import type { DiscoveredProjection } from './discovery'

/** The base whose subtypes are intents. */
const BASE_TYPE = 'intent'
/** The trust declaration. See `packages/intent/type/intent-agent-meta.type.yaml`. */
const AGENT_META_TYPE = 'intent-agent-meta'
/** The routing declaration, the SINGLE source of an intent's kind/dispatch. */
const ROUTING_META_TYPE = 'intent-routing-meta'
/** The projection base. Named explicitly because `subtypes('projection')` returns the subtypes of
 *  the base and correctly NOT the base itself, so it never appears in a discovered `kinds` closure. */
const PROJECTION_BASE = 'projection'

/** Routing as the intent's own type-def declares it — what the host uses instead of the caller's copy. */
export interface DeclaredRouting {
  kind?: 'routed' | 'broadcast'
  dispatch?: 'ambient' | 'firer-relative'
}

/** One discovered intent type, reduced to what the gate decides on. */
export interface GateEntry {
  /** Carries an `intent-agent-meta` block at all — what tells silence from a decided no. */
  hasDeclaration: boolean
  /** `firable: true` on its own `intent-agent-meta` block. */
  declaredFirable: boolean
  /** A field admits an inline projection config or an opaque `any`, so the payload is privileged. */
  privilegedPayload: boolean
  /** The field names that made it privileged, so a refusal can say WHICH. */
  privilegedFields: string[]
  routing: DeclaredRouting
}

/** Why a fire was refused. A CODE, not prose — the caller reports it and tests match on it. */
export type RefusalReason =
  /** No `intent` subtype of this name is discoverable. Covers the authored-but-untyped intents. */
  | 'unknown-intent-type'
  /** Discovered, but carries no `intent-agent-meta` block. The default-deny path. */
  | 'not-declared-agent-firable'
  /** Discovered and declared, explicitly `firable: false`. */
  | 'declared-not-agent-firable'
  /** Its payload admits arbitrary mountable content, which no declaration can excuse. */
  | 'privileged-payload'

export interface GateVerdict {
  allowed: boolean
  reason?: RefusalReason
  /** Human-facing detail for the socket error. Never matched on. */
  message?: string
  /** Present when allowed: the routing to stamp, from the type-def rather than the caller. */
  routing?: DeclaredRouting
}

/** Bare intent name -> its gate entry. Empty until the first discovery pass, which is FAIL-CLOSED:
 *  with no entries every fire is refused as an unknown type, which is the safe direction. */
let entries: ReadonlyMap<string, GateEntry> = new Map()

function fieldOf(block: { body: { name: string; value: unknown }[] }, name: string): unknown {
  return block.body.find((f) => f.name === name)?.value
}

/**
 * Does this shape admit an inline value that could be MOUNTED — an arbitrary projection config, or
 * an uninterpreted `any` blob that could hold one?
 *
 * DERIVED, never declared, and that is the point: the field's own shape already states it, so
 * re-declaring it would introduce an independently maintained copy of the type metadata.
 * This check cannot be escaped by marking the intent firable.
 *
 * A REFERENCE (`T*`) is deliberately NOT privileged. It points at a node the workspace already
 * holds; it supplies no content. That is what keeps `open-intent.target: selection&` allowed while
 * a hypothetical `pane: projection&` is not — one names something that exists, the other ships a
 * payload to mount.
 *
 * `isProjectionType` is passed in rather than imported so this stays pure data -> data and the
 * unit test can drive it without a discovery pass.
 */
function admitsMountableInline(shape: WireShape | null, isProjectionType: (name: string) => boolean): boolean {
  if (!shape) return false
  switch (shape.kind) {
    // The no-type slot: stored verbatim, never interpreted, so it can hold any config at all.
    case 'any':
      return true
    // The two INLINE-admitting named shapes. `inline-or-reference` counts because its inline branch
    // is a full record.
    case 'record':
    case 'inline-or-reference':
      return isProjectionType(refName(shape.name))
    // A compound of names admits inline content only in its `inline-or-ref` mode; a pure `ref`
    // compound is references all the way down.
    case 'compound-reference':
      return shape.mode === 'inline-or-ref' && shape.branches.some((b) => isProjectionType(refName(b)))
    // Wrappers: ask the inner shape.
    case 'list':
    case 'pinned':
      return admitsMountableInline(shape.inner, isProjectionType)
    case 'union':
    case 'intersection':
      return shape.branches.some((b) => admitsMountableInline(b, isProjectionType))
    // primitive / enum / reference / def-reference carry no inline record.
    default:
      return false
  }
}

/** The fields of an intent whose shape admits mountable inline content. */
function privilegedFieldsOf(fields: readonly WireField[], isProjectionType: (name: string) => boolean): string[] {
  return fields.filter((f) => admitsMountableInline(f.shape_ast, isProjectionType)).map((f) => f.name)
}

/**
 * The names an intent field could use to admit MOUNTABLE content: the `projection` base, every
 * discovered projection subtype, and every kind in their closures.
 *
 * The base must be added by hand. `subtypes('projection')` returns the subtypes and correctly not
 * the base itself — so a field shaped
 * `projection::au-host-sdk&`, which is the likeliest way `open-pane-intent.pane` gets authored,
 * would otherwise read as an unknown type and slip through.
 */
function projectionNamesOf(projections: readonly DiscoveredProjection[]): Set<string> {
  const names = new Set<string>([PROJECTION_BASE])
  for (const p of projections) {
    names.add(refName(p.typeName))
    for (const k of p.kinds) names.add(refName(k))
  }
  return names
}

/**
 * Build the gate's table from intent type-defs already in hand. PURE data -> data: no daemon, no
 * DOM, no IO — the same shell/core split `slot-schema.ts` uses, and for the same reason. The whole
 * decision this module makes is testable without a live engine, which matters because the failure
 * mode is a security hole that no UI would show.
 */
export function buildGateTable(
  defs: readonly WireSubtype[],
  projections: readonly DiscoveredProjection[],
): Map<string, GateEntry> {
  const out = new Map<string, GateEntry>()
  const projectionNames = projectionNamesOf(projections)
  const isProjectionType = (name: string): boolean => projectionNames.has(name)

  for (const def of defs) {
    // Match meta blocks by BARE name: the served `type_name` is `::repo`-qualified for a peer's
    // meta type (`intent-agent-meta::intent` on a projection-repo intent) and bare for an own one.
    const agent = def.meta_blocks?.find((b) => refName(b.type_name) === AGENT_META_TYPE)
    const routingBlock = def.meta_blocks?.find((b) => refName(b.type_name) === ROUTING_META_TYPE)
    const routing: DeclaredRouting = {}
    if (routingBlock) {
      const kind = fieldOf(routingBlock, 'kind')
      const dispatch = fieldOf(routingBlock, 'dispatch')
      if (kind === 'routed' || kind === 'broadcast') routing.kind = kind
      if (dispatch === 'ambient' || dispatch === 'firer-relative') routing.dispatch = dispatch
    }
    const privilegedFields = privilegedFieldsOf(def.fields ?? [], isProjectionType)
    out.set(refName(def.name), {
      hasDeclaration: agent !== undefined,
      // LITERAL, never inherited. `meta:` is not inherited by the type system, and the engine's own
      // `required:` rule is literal for the same reason: a subtype ADDS fields, so inheriting the
      // parent's permission would grant it for a payload the parent never declared. It also means a
      // third party subtyping a firable intent is NOT firable until they say so.
      declaredFirable: agent ? fieldOf(agent, 'firable') === true : false,
      privilegedPayload: privilegedFields.length > 0,
      privilegedFields,
      routing,
    })
  }
  return out
}

/**
 * The IO shell: read `subtypes('intent')` and fold it. An unready or failed read yields an EMPTY
 * table, which is fail-closed — every fire is then refused as an unknown type rather than waved
 * through because the engine was not answering.
 */
export async function discoverAgentIntents(
  reader: WireReader,
  projections: readonly DiscoveredProjection[],
): Promise<Map<string, GateEntry>> {
  const result = await readSubtypes(reader, BASE_TYPE)
  if (!('ready' in result) || !result.ready || !result.result) return new Map()
  return buildGateTable(result.result.subtypes as WireSubtype[], projections)
}

/** Install the table. Re-run on every type-graph change, the cadence of the other providers. */
export function installAgentIntents(table: ReadonlyMap<string, GateEntry>): void {
  entries = table
}

/**
 * May an agent fire this intent type? The whole decision, in the order that gives the most useful
 * refusal: unknown before undeclared, and the payload check LAST so its message names the real
 * reason rather than a missing marker the author would then add in vain.
 *
 * The payload check overrides the declaration deliberately.
 * The payload is what makes a verb dangerous, not its name.
 */
export function checkAgentIntent(type: unknown): GateVerdict {
  const name = typeof type === 'string' ? refName(type) : ''
  const entry = name ? entries.get(name) : undefined
  if (!entry) {
    return {
      allowed: false,
      reason: 'unknown-intent-type',
      message: `no discoverable \`intent\` subtype named "${String(type)}"; an agent may only fire intents that exist in the type graph`,
    }
  }
  if (entry.privilegedPayload) {
    return {
      allowed: false,
      reason: 'privileged-payload',
      message: `"${name}" carries mountable content in ${entry.privilegedFields.map((f) => `\`${f}\``).join(', ')}, so it is privileged regardless of any declaration`,
    }
  }
  if (!entry.declaredFirable) {
    // Two codes, because these are different authoring situations and a surfacer should be able to
    // tell "nobody has decided yet" from "someone decided no". The message differs with them: one
    // asks for a decision, the other reports one already taken.
    return entry.hasDeclaration
      ? {
          allowed: false,
          reason: 'declared-not-agent-firable',
          message: `"${name}" declares \`firable: false\`; its type-def says an agent may not fire it`,
        }
      : {
          allowed: false,
          reason: 'not-declared-agent-firable',
          message: `"${name}" is not declared agent-firable; add an \`intent-agent-meta\` block with \`firable: true\` to its type-def to allow it`,
        }
  }
  return { allowed: true, routing: entry.routing }
}
