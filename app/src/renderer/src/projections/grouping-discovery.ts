// Discover containers that can group multiple children into one node.
// The host resolves grouping metadata and installs a synchronous lookup for the container substrate,
// which has no engine connection or loader. The composition's group-into choice selects its default.




import { readSubtypes, type WireReader, type WireSubtype } from '@arsumbris/au-host-sdk/engine-reads'
import { reportHostDiagnostic, isDefinedProjection } from '@arsumbris/au-host-sdk'
import type { ProjectionSource } from '@arsumbris/au-host-sdk'
import { chooseGrouping, setGroupingProvider, setWrapTargets, type GroupingCapability, type WrapTarget } from '@arsumbris/container-core'
import { refName } from '@arsumbris/type-query'

import { packageRootOf } from './discovery'
import { loadProjection, sourceKey, sourceLocation } from './loader'

/** The KIND whose subtypes ARE the grouping containers. Every subtype declares the capability by being one. */
const BASE_TYPE = 'grouping-container'
/** The SIBLING kind whose subtypes are the SPATIAL containers (bento, canvas). Same `buildGroup` module
 *  contract; a WRAP target but NOT a grouping-container, so the drop's `isGroupingKind` is untouched. */
const SPATIAL_BASE_TYPE = 'spatial-container'
/** The `grouping-container` module contract's build export — a conventional name, like `mount` is the
 *  default mount export. `(children) => instance` mints a group holding the children. */
const BUILD_EXPORT = 'buildGroup'
/** A conventional optional module export: the dissolve floor ("always >=N children"). The container owns
 *  its own invariant, so it rides the module, not the type system. Absent = never dissolves. */
const MIN_CHILDREN_EXPORT = 'minChildren'
/** The CODE locator that names the module entry the build export lives in. */
const RUNTIME_META_TYPE = 'projection-runtime-meta'

function fieldOf(block: { body: { name: string; value: unknown }[] }, name: string): unknown {
  return block.body.find((f) => f.name === name)?.value
}

/**
 * Discover + eager-load every `grouping-container` (every subtype of the kind).
 *
 * A grouping-container whose module lacks the `buildGroup` export is REPORTED, not skipped silently:
 * that is a declared-vs-implemented mismatch (the kind's module contract unmet), and a silent skip would
 * present as "grouping just doesn't work here" with nothing to grep.
 */
async function discoverBuildContainers(reader: WireReader, baseType: string): Promise<GroupingCapability[]> {
  const out: GroupingCapability[] = []
  const result = await readSubtypes(reader, baseType)
  if (!('ready' in result) || !result.ready || !result.result) return out

  for (const def of result.result.subtypes as WireSubtype[]) {
    // Every subtype of the KIND declares the capability by being one — the same `buildGroup` module
    // contract for grouping-container and spatial-container. Only the module entry (to locate `buildGroup`)
    // must be present.
    const runtime = def.meta_blocks?.find((b) => refName(b.type_name) === RUNTIME_META_TYPE)
    const entry = runtime ? fieldOf(runtime, 'entry') : undefined
    if (typeof entry !== 'string') {
      reportHostDiagnostic({
        code: 'grouping-container-without-runtime-meta',
        severity: 'warning',
        subject: def.name,
        message: `is a \`${baseType}\` but declares no \`projection-runtime-meta.entry\`, so its \`buildGroup\` export cannot be located`,
      })
      continue
    }

    const source: ProjectionSource = { mode: 'esm', path: packageRootOf(def.source.file) }
    const registration = { key: sourceKey(sourceLocation(source)), source, entry, export: BUILD_EXPORT }
    try {
      const loaded = await loadProjection(registration)
      const raw = loaded.module as unknown as Record<string, unknown>
      // A grouping container MUST register through `defineProjection`; `buildGroup` rides the branded
      // default. An unregistered module is REPORTED (not silently skipped) — the same declared-vs-built
      // mismatch class as a missing `buildGroup`.
      if (!isDefinedProjection(raw.default)) {
        reportHostDiagnostic({
          code: 'grouping-container-not-registered',
          severity: 'warning',
          subject: def.name,
          message: `is a \`${baseType}\` but its module is not registered through \`defineProjection\` (its default export must be \`defineProjection({ mount, buildGroup })\`)`,
          detail: { entry },
        })
        continue
      }
      const mod = raw.default as Record<string, unknown>
      const fn = mod[BUILD_EXPORT]
      if (typeof fn !== 'function') {
        reportHostDiagnostic({
          code: 'grouping-build-export-missing',
          severity: 'warning',
          subject: def.name,
          message: `is a \`${baseType}\` but its module has no "${BUILD_EXPORT}" export`,
          detail: { entry },
        })
        continue
      }
      const rawMin = mod[MIN_CHILDREN_EXPORT]
      const minChildren = typeof rawMin === 'number' ? rawMin : undefined
      out.push({
        typeName: def.name,
        build: fn as GroupingCapability['build'],
        ...(minChildren === undefined ? {} : { minChildren }),
      })
    } catch (err) {
      reportHostDiagnostic({
        code: 'grouping-container-load-failed',
        severity: 'warning',
        subject: def.name,
        message: err instanceof Error ? err.message : String(err),
        detail: { entry },
      })
    }
  }
  return out
}

/** The GROUPING containers (the drop's stack-group set): subtypes of `grouping-container`. */
export function discoverGroupingContainers(reader: WireReader): Promise<GroupingCapability[]> {
  return discoverBuildContainers(reader, BASE_TYPE)
}

/** The SPATIAL containers (bento, canvas): subtypes of `spatial-container`. Same `buildGroup` contract;
 *  a wrap target but NOT a grouping-container, so the drop path never sees them. */
export function discoverSpatialContainers(reader: WireReader): Promise<GroupingCapability[]> {
  return discoverBuildContainers(reader, SPATIAL_BASE_TYPE)
}

/**
 * Install the WRAP-TARGET registry — the family-tagged UNION the wrap action offers, DECOUPLED from the
 * grouping provider (the drop's stack-group set). `grouping` and `spatial` are the two discovered capability
 * lists; `groupInto` is the composition's `grouping.group-into` (grouping-only), so the outcome respects the
 * composition's stack default while the picker still offers the spatial "Arrange" family. Re-call whenever
 * the type graph OR the composition changes, exactly like `installGroupingProvider`.
 */
export function installWrapTargets(
  grouping: GroupingCapability[],
  spatial: GroupingCapability[],
  groupInto?: string,
): void {
  const targets: WrapTarget[] = [
    ...grouping.map((c) => ({ ...c, family: 'grouping' as const })),
    ...spatial.map((c) => ({ ...c, family: 'spatial' as const })),
  ]
  setWrapTargets(targets, groupInto)
}

/** Strip a def-ref wikilink to its bare type name: `"[[tabs::tabs]]"` -> `tabs`. */
function defRefName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const inner = value.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0]?.trim() ?? ''
  const name = inner.split('::')[0]?.trim() ?? ''
  return name || undefined
}

/** The composition's `grouping` aspect (the field), or undefined. */
function groupingAspectOf(composition: { [k: string]: unknown } | null | undefined): Record<string, unknown> | undefined {
  const g = composition?.['grouping']
  return g && typeof g === 'object' ? (g as Record<string, unknown>) : undefined
}

/**
 * Install the lookup the substrate reads. Idempotent; call again when the type graph OR the mounted
 * composition changes.
 *
 * The CHOICE of which container a new group uses belongs to the COMPOSITION, not the framework — naming
 * one here would re-privilege a container. `groupInto` is the composition's `grouping.group-into` def-ref,
 * already stripped to a bare type name (see `groupingChoiceOf`).
 *
 * Resolution order, and every fallback is REPORTED:
 *  1. the composition's declared choice (`group-into`).
 *  2. the single grouping container, when there is exactly one (nothing to choose between).
 *  3. otherwise the choice is DEFERRED to use — a center-wrap asks the host chooser.
 */
export function installGroupingProvider(capabilities: GroupingCapability[], groupInto?: string, groupNewPanes?: boolean): void {
  const outcome = chooseGrouping(capabilities, groupInto)

  // A `request-unresolved` is still announced: `group-into: type<grouping-container>*` is engine-validated,
  // so it always names a REAL grouping container — but that container may not be PRESENT in this workspace
  // (a declared dep not mounted). That is the one case that reaches runtime, and it must not present as
  // "drops silently do nothing".
  if (outcome.reason === 'request-unresolved') {
    reportHostDiagnostic({
      code: 'grouping-choice-unresolved',
      severity: 'warning',
      subject: outcome.requested,
      message: `this composition's \`group-into\` names "${outcome.requested}", which is not a grouping container present in this workspace; the ambiguous choice will be ASKED at group-creation instead`,
      detail: { requested: outcome.requested, available: outcome.available },
    })
  }
  // NO `defaulted` diagnostic. The choice between two-plus grouping containers is no longer resolved at
  // install; it is DEFERRED to use — a center-wrap
  // asks the host chooser (`routeDropWithGrouping` reads `outcomeForNewGroup`).


  const sorted = [...capabilities].sort((a, b) => a.typeName.localeCompare(b.typeName))
  setGroupingProvider({
    // `forNewGroup` keeps returning the name-sorted pick for the NON-interactive path (a caller that does
    // not ask). The interactive drop path reads `outcomeForNewGroup` to detect a `defaulted` ambiguity and
    // asks instead.
    forNewGroup: () => outcome.chosen,
    forKind: (kind) => {
      if (!kind) return null
      const bare = refName(kind)
      return sorted.find((c) => refName(c.typeName) === bare) ?? null
    },
    outcomeForNewGroup: () => outcome,
    groupNewPanes: groupNewPanes === true,
  })
}

/** The composition's declared grouping container, as a bare type name. `grouping.group-into`. */
export function groupingChoiceOf(composition: { [k: string]: unknown } | null | undefined): string | undefined {
  return defRefName(groupingAspectOf(composition)?.['group-into'])
}

/** Whether the composition wants new document panes to arrive grouped. `grouping.group-new-panes`. */
export function groupNewPanesOf(composition: { [k: string]: unknown } | null | undefined): boolean {
  return groupingAspectOf(composition)?.['group-new-panes'] === true
}
