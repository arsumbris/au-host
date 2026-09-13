// Component-layer discovery: a type-system query, the fourth application of the motif
// (after projections, themes, notification renderers). Mirrors `discovery.ts` verbatim in
// shape — a `readSubtypes` pass over a base type, keeping the owner copy that carries the
// runtime meta — but over the COMPONENT contract, not the projection contract.

// Two queries:
//   - discoverComponentSets(reader): the `component-set` subtypes carrying a loadable
//     `component-set-runtime-meta` locator. These are the swappable implementation sets.
//   - discoverComponents(reader): the `ui-component` subtypes — the interface catalog. Used
//     for COVERAGE (which tags exist, which a set provides) and by the gallery to render each
//     component from its field schema. Contract-only, so these carry no runtime meta.



import { readSubtypes, type WireField, type WireMetaBlock, type WireReader, type WireSubtype } from '@arsumbris/au-host-sdk/engine-reads'
import { refName } from '@arsumbris/type-query'
import { checkComponentSetMeta, componentRefName } from '@arsumbris/component-contract'
import { reportHostDiagnostic } from '@arsumbris/au-host-sdk'

import { packageRootOf } from '../../../shared/package-root'

/** The open base every implementation SET subtype extends. */
const SET_BASE_TYPE = 'component-set'
/** The meta record a set subtype carries to declare its loadable code. */
const SET_RUNTIME_META_TYPE = 'component-set-runtime-meta'
/** The open base every single-component INTERFACE subtype extends. */
const COMPONENT_BASE_TYPE = 'ui-component'

/** A component SET discovered by the type-system query. Identity is the type name. */
export interface DiscoveredComponentSet {
  /** The `component-set` subtype name — the set's identity + the picker key. */
  typeName: string
  /** The OWNER repo of this subtype (deduped to owner copies, like projection discovery). */
  repo: string
  /** ESM entry, relative to the owning package root. From the runtime meta. */
  entry: string
  /** The export the host calls to register the set's elements (default `register`). */
  export?: string
  /** Component-contract version the set was built against. From the runtime meta. */
  contractVersion: number
  /** The owning package root on disk: the type-def's source minus `/type/<file>`. */
  packageRoot: string
  /** The bare tag names this set implements (`provides` def-refs, `::repo` stripped). Drives
   *  per-tag coverage + the resolution cascade + the additive-vs-overriding activation policy. */
  provides: string[]
  /** Declarations-only token stylesheet path(s), relative to `packageRoot`. From the runtime meta.
   *  The host eager-loads these (shared `loadTokenSheets` path) so the set's `--au-<component>-*`
   *  tokens surface in the theming pane's CSSOM walk, active or not. Absent for most sets. */
  customTokenEntry?: string[]
}

/** A single COMPONENT interface discovered by the type-system query (contract-only). */
export interface DiscoveredComponent {
  /** The `ui-component` subtype name — the custom-element TAG. */
  typeName: string
  /** The OWNER repo of this subtype. */
  repo: string
  /** The component's own declared props (the subtype's fields), for the gallery's schema render.
   *  Own-fields only (not the effective closure) — sufficient for the minimal gallery; the base
   *  `ui-component` is a tag (no fields), so nothing material is inherited. */
  fields: WireField[]
}

/** Assemble a meta block's body (`[{name, value}]`) into a plain record. */
function metaRecord(block: WireMetaBlock): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of block.body) out[field.name] = field.value
  return out
}

/** The bare tag names in a set's `provides` def-ref list. Empty when the field is absent/ill-shaped. */
function providesOf(def: WireSubtype): string[] {
  const block = def.meta_blocks?.find((b) => refName(b.type_name) === SET_RUNTIME_META_TYPE)
  if (!block) return []
  const value = metaRecord(block).provides
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? componentRefName(v) : undefined))
    .filter((n): n is string => n !== undefined)
}

/**
 * Discover the workspace's `component-set` subtypes that carry a valid, version-matched
 * `component-set-runtime-meta` locator. The `subtypes` read returns the owner copy (which
 * carries the meta), so a set with malformed / mismatched meta is dropped with a warning —
 * the exact parallel of `discoverProjections` / `discoverNotificationRenderers`.
 */
export async function discoverComponentSets(reader: WireReader): Promise<DiscoveredComponentSet[]> {
  const result = await readSubtypes(reader, SET_BASE_TYPE)
  if (!('ready' in result) || !result.ready || !result.result) return []
  const all = result.result.subtypes as WireSubtype[]

  const found: DiscoveredComponentSet[] = []
  for (const def of all) {
    const block = def.meta_blocks?.find((b) => refName(b.type_name) === SET_RUNTIME_META_TYPE)
    if (!block) continue // a set subtype without runtime meta is not loadable
    const check = checkComponentSetMeta(metaRecord(block))
    if (!check.ok) {
      reportHostDiagnostic({
        code: 'component-set-meta-invalid',
        severity: 'warning',
        subject: def.name,
        message: `component set is not loadable: ${check.errors.join('; ')}`,
        detail: { errors: check.errors, source: def.source.file },
      })
      continue
    }
    found.push({
      typeName: def.name,
      repo: def.repo,
      entry: check.meta.entry,
      export: check.meta.export,
      contractVersion: check.meta.contractVersion,
      packageRoot: packageRootOf(def.source.file),
      provides: providesOf(def),
      ...(check.meta.customTokenEntry ? { customTokenEntry: check.meta.customTokenEntry } : {}),
    })
  }
  found.sort((a, b) => a.typeName.localeCompare(b.typeName))
  return found
}

/**
 * Discover the workspace's `ui-component` subtypes — the interface catalog. Contract-only, so
 * no runtime-meta filter: every subtype of `ui-component` is a tag in the catalog, carried with
 * its own field schema for the gallery to render from.
 */
export async function discoverComponents(reader: WireReader): Promise<DiscoveredComponent[]> {
  const result = await readSubtypes(reader, COMPONENT_BASE_TYPE)
  if (!('ready' in result) || !result.ready || !result.result) return []
  const all = result.result.subtypes as WireSubtype[]
  const found = all.map((def) => ({
    typeName: def.name,
    repo: def.repo,
    fields: def.fields ?? [],
  }))
  found.sort((a, b) => a.typeName.localeCompare(b.typeName))
  return found
}
