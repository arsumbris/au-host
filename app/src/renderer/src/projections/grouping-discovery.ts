// Discover the WRAP TARGETS: the concrete subtypes of the three wrap-target kinds (grouping, spatial,
// frame), each with its build and its type-declared arity. The host resolves them from the type graph and
// installs synchronous lookups for the container substrate, which has no engine connection or loader. The
// composition's group-into choice selects the default.

import { readSubtypes, type WireReader, type WireSubtype } from '@arsumbris/au-host-sdk/engine-reads'
import { ARITY_META, bareTypeName, codeMetaBlock, descriptorTitle, frameBuildGroup, keyOf, metaTypeKeys, PROJECTION_RUNTIME_META, reportHostDiagnostic, isDefinedProjection } from '@arsumbris/au-host-sdk'
import type { ProjectionSource } from '@arsumbris/au-host-sdk'
import { chooseGrouping, setGroupingProvider, setWrapTargets, type GroupingCapability, type WrapTarget } from '@arsumbris/container-core'
import { refName } from '@arsumbris/type-query'

import { metaMap, packageRootOf } from './discovery'
import { loadProjection, sourceKey, sourceLocation } from './loader'

/** The three WRAP-TARGET kinds, each with its family. Only `grouping-container` is also the drop's
 *  stack-group set (`installGroupingProvider`). */
const WRAP_KINDS = [
  { base: 'grouping-container', family: 'grouping' },
  { base: 'spatial-container', family: 'spatial' },
  { base: 'frame-container', family: 'frame' },
] as const
/** The kind module contract's build export — a conventional name, like `mount` is the default mount
 *  export. `(children) => instance` mints a group holding the children. Optional for a frame. */
const BUILD_EXPORT = 'buildGroup'

/** Every discovered wrap target, by family. `grouping` doubles as the drop's stack-group set. */
export interface ContainerCapabilities {
  grouping: GroupingCapability[]
  spatial: GroupingCapability[]
  frame: GroupingCapability[]
}

function fieldOf(block: { body: { name: string; value: unknown }[] }, name: string): unknown {
  return block.body.find((f) => f.name === name)?.value
}

/** A container's declared arity, from the engine's EFFECTIVE meta (its own `arity-meta`, else the one it
 *  inherits — a frame inherits `max: 1` from `frame-container`). More than one surviving block is a
 *  conflict the host cannot settle, so it is reported and read as undeclared. */
function arityOf(def: WireSubtype): { minChildren?: number; maxChildren?: number } {
  const name = def.name
  const blocks = def.effective_meta.find((m) => metaTypeKeys(m.meta_type).includes(ARITY_META))?.blocks ?? []
  if (blocks.length > 1) {
    reportHostDiagnostic({
      code: 'arity-meta-conflict',
      severity: 'warning',
      subject: name,
      message: `inherits different \`arity-meta\` from ${blocks.map((b) => keyOf(b.from)).join(' and ')}, so its arity is undeclared; declare its own \`arity-meta\` to settle it`,
    })
    return {}
  }
  const block = blocks[0]
  if (!block) return {}
  const min = fieldOf(block, 'min')
  const max = fieldOf(block, 'max')
  const out = {
    ...(typeof min === 'number' ? { minChildren: min } : {}),
    ...(typeof max === 'number' ? { maxChildren: max } : {}),
  }
  if (out.minChildren !== undefined && out.maxChildren !== undefined && out.minChildren > out.maxChildren) {
    reportHostDiagnostic({
      code: 'arity-meta-inverted',
      severity: 'warning',
      subject: name,
      message: `declares \`arity-meta\` with min ${out.minChildren} > max ${out.maxChildren}, so it admits no child count and is never offered as a wrap target`,
    })
  }
  return out
}

/**
 * Discover + eager-load every concrete subtype of one wrap-target kind.
 *
 * A grouping or spatial container whose module lacks `buildGroup` is REPORTED, not skipped silently: that
 * is a declared-vs-implemented mismatch (the kind's module contract unmet), and a silent skip would present
 * as "grouping just doesn't work here" with nothing to grep. A FRAME needs no export: its build is the
 * synthesized `frameBuildGroup`, and a module `buildGroup` overrides it.
 */
async function discoverKind(
  reader: WireReader,
  baseType: string,
  family: WrapTarget['family'],
): Promise<GroupingCapability[]> {
  const out: GroupingCapability[] = []
  const result = await readSubtypes(reader, baseType)
  if (!('ready' in result) || !result.ready || !result.result) return out

  for (const def of result.result.subtypes as WireSubtype[]) {
    // An abstract subtype (an intermediate kind) is never instantiated, so it is never a wrap target.
    if (def.abstract) continue
    // The CODE locator, the type's OWN block: the module entry the build export lives in.
    const code = codeMetaBlock(def, PROJECTION_RUNTIME_META)
    if (code.kind === 'not-own') {
      reportHostDiagnostic({ code: 'grouping-container-code-not-own', severity: 'warning', subject: def.name, message: `is a \`${baseType}\` that cannot load: ${code.reason}` })
      continue
    }
    const entry = code.kind === 'own' ? fieldOf(code.block, 'entry') : undefined
    if (typeof entry !== 'string') {
      reportHostDiagnostic({
        code: 'grouping-container-without-runtime-meta',
        severity: 'warning',
        subject: def.name,
        message: `is a \`${baseType}\` but declares no \`projection-runtime-meta.entry\`, so its module cannot be located`,
      })
      continue
    }

    const source: ProjectionSource = { mode: 'esm', path: packageRootOf(def.source.file) }
    const registration = { key: sourceKey(sourceLocation(source)), source, entry, export: BUILD_EXPORT }
    try {
      const loaded = await loadProjection(registration)
      const raw = loaded.module as unknown as Record<string, unknown>
      // A container MUST register through `defineProjection`; `buildGroup` rides the branded default. An
      // unregistered module is REPORTED (not silently skipped) — the same declared-vs-built mismatch class.
      if (!isDefinedProjection(raw.default)) {
        reportHostDiagnostic({
          code: 'grouping-container-not-registered',
          severity: 'warning',
          subject: def.name,
          message: `is a \`${baseType}\` but its module is not registered through \`defineProjection\``,
          detail: { entry },
        })
        continue
      }
      const exported = (raw.default as Record<string, unknown>)[BUILD_EXPORT]
      let build: GroupingCapability['build']
      if (typeof exported === 'function') build = exported as GroupingCapability['build']
      else if (family === 'frame') build = frameBuildGroup(bareTypeName(def.name))
      else {
        reportHostDiagnostic({
          code: 'grouping-build-export-missing',
          severity: 'warning',
          subject: def.name,
          message: `is a \`${baseType}\` but its module has no "${BUILD_EXPORT}" export`,
          detail: { entry },
        })
        continue
      }
      const label = descriptorTitle({ meta: metaMap(def) })
      out.push({ typeName: def.name, build, ...arityOf(def), ...(label ? { label } : {}) })
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

/** Discover every wrap target, by family, with its build and its declared arity. */
export async function discoverContainerCapabilities(reader: WireReader): Promise<ContainerCapabilities> {
  const [grouping, spatial, frame] = await Promise.all(WRAP_KINDS.map((k) => discoverKind(reader, k.base, k.family)))
  return { grouping: grouping!, spatial: spatial!, frame: frame! }
}

/**
 * Install the WRAP-TARGET registry — the family-tagged UNION every wrap flow resolves through
 * `wrapChoice`, DECOUPLED from the grouping provider (the drop's stack-group set). `groupInto` is the
 * composition's `grouping.group-into`; `wrapChoice` honours it for a wrap whose child count it admits.
 * Re-call whenever the type graph OR the composition changes, exactly like `installGroupingProvider`.
 */
export function installWrapTargets(caps: ContainerCapabilities, groupInto?: string): void {
  const targets: WrapTarget[] = [
    ...caps.grouping.map((c) => ({ ...c, family: 'grouping' as const })),
    ...caps.spatial.map((c) => ({ ...c, family: 'spatial' as const })),
    ...caps.frame.map((c) => ({ ...c, family: 'frame' as const })),
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
