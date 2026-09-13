// The swappable UI-component CONTRACT.

// A SEPARATE contract from the projection/mount contract: au-host-sdk is defined over
// `projection` and no au-host-sdk mechanism interprets these types, so by the
// substrate-vocabulary criterion they live in their own package. Named
// `component-contract`, not `ui-contract`, because projections are UI too.

// Pure types and pure functions only — no node imports, ever. This module carries DOM
// types (`CustomElementConstructor`) by design; it is renderer-side.



// Component-contract vocabulary, generated from this package's own type-defs
// (`type/*.type.yaml`) by @arsumbris/type-codegen. Re-exported as the package surface.
// `UiComponent` is the open BASE for a single component's interface (contract-only —
// no persisted instances, like `intent`); `ComponentSet` is the base for an
// implementation set, carrying a `ComponentSetRuntimeMeta` locator.
import type { ComponentSet, ComponentSetRuntimeMeta, UiComponent, UiComponentMeta } from './generated'
export type { ComponentSet, ComponentSetRuntimeMeta, UiComponent, UiComponentMeta }

// The component-overlay channel: how a `<au-*>` component reaches the host's OverlaySite with no
// `host` handle. See `./overlay-channel.ts`.
export type { HostOverlayClaim, OverlayLayer, OverlayLevel } from './overlay-channel'
export { claimHostOverlay, publishHostOverlay } from './overlay-channel'

/**
 * The component-contract version the host speaks. Checked at the handshake by STRICT
 * EQUALITY (`checkComponentSetMeta`), exactly like `MOUNT_CONTRACT_VERSION`.
 *
 * BUMP ONLY ON BREAKING CHANGES. A bump invalidates EVERY component set until each
 * re-declares the new version. An ADDITIVE + OPTIONAL capability (a new `foo?:` on
 * `ComponentSetApi`) is backward-compatible and does NOT bump.
 *
 * v1: the initial contract. `register(api)` hands the host raw element classes; the host
 * decides which registry they land in.
 */
export const COMPONENT_CONTRACT_VERSION = 1

/**
 * The default export name a set exposes when its locator omits `export`.
 * Mirrors the projection locator's `mount` default.
 */
export const DEFAULT_SET_EXPORT = 'register'

/**
 * The surface the host hands a component set's `register` export.
 *
 * A set NEVER calls `customElements.define` itself and NEVER self-registers on import. It
 * hands the host raw classes through `define`, and the HOST chooses the target registry.
 * That indirection is the whole mechanism: it lets the active set be defined into the
 * GLOBAL registry at boot while the gallery simultaneously previews other sets in per-set
 * SCOPED registries — the same `register` call, a different `define`.
 *
 *
 */
export interface ComponentSetApi {
  /** The contract version the host speaks. Equals `COMPONENT_CONTRACT_VERSION`. */
  readonly contractVersion: number
  /**
   * Register one element implementation under a contract's tag. The host routes it into
   * whichever registry this activation targets. Registering a tag the set did not declare
   * in `provides` is a set bug — the host may warn and ignore it.
   */
  define(tag: string, impl: CustomElementConstructor): void
}

/** The shape a component set's entry module must export: named registration functions. */
export type RegisterFn = (api: ComponentSetApi) => void

/**
 * The module shape a set's `entry` resolves to. The specific export the host calls is
 * per-SET and named by its locator (`component-set-runtime-meta.export`, default
 * `register`), so several sets may share one entry module.
 */
export type ComponentSetModule = Record<string, RegisterFn>

export type ComponentSetMetaCheck =
  | { ok: true; meta: ComponentSetRuntimeMeta }
  | { ok: false; errors: string[] }

/**
 * Validate an untrusted `component-set-runtime-meta` value and perform the contract
 * handshake.
 *
 * The value is the meta block read off a `component-set` subtype's type-def (the
 * `subtypes` read -> `meta_blocks`, body assembled into a record) — never off an instance,
 * because it is type-level metadata. Rejection messages are written for the host UI, not
 * just logs.
 *
 * Mirrors `checkProjectionMeta` (au-host-sdk), which stays untouched.
 */
export function checkComponentSetMeta(value: unknown): ComponentSetMetaCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['component set runtime meta is not an object'] }
  }
  const record = value as Record<string, unknown>
  const errors: string[] = []

  if (typeof record['entry'] !== 'string' || record['entry'].length === 0) {
    errors.push("'entry' must be a non-empty string")
  }
  if (typeof record['contractVersion'] !== 'number') {
    errors.push("'contractVersion' must be a number")
  }

  // `provides: type<ui-component>*[]` — def-ref wikilinks to the contracts this set
  // implements. The engine validates referential integrity; here we only check the SHAPE
  // and normalize to bare names. A single value is legal in bare (scalar) form per the
  // type list-form, so accept a string OR an array.
  const rawProvides = record['provides']
  let provides: string[] | undefined
  if (rawProvides === undefined) {
    errors.push("'provides' must be a non-empty list of ui-component def-refs")
  } else {
    const arr = Array.isArray(rawProvides) ? rawProvides : [rawProvides]
    if (arr.length === 0 || !arr.every((p) => typeof p === 'string' && p.length > 0)) {
      errors.push("'provides' must be a non-empty list of ui-component def-refs")
    } else {
      provides = arr as string[]
    }
  }

  // `customTokenEntry?: String[+]` — declarations-only token stylesheet path(s), relative to the
  // package root. Optional; when present, a non-empty list of non-empty strings. Mirrors the
  // projection-runtime-meta field so the host's `loadTokenSheets` path is reused verbatim.
  const rawTokens = record['customTokenEntry']
  let customTokenEntry: string[] | undefined
  if (rawTokens !== undefined) {
    if (!Array.isArray(rawTokens) || rawTokens.length === 0 || !rawTokens.every((p) => typeof p === 'string' && p.length > 0)) {
      errors.push("'customTokenEntry' must be a non-empty list of non-empty strings when present")
    } else {
      customTokenEntry = rawTokens as string[]
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const contractVersion = record['contractVersion'] as number
  if (contractVersion !== COMPONENT_CONTRACT_VERSION) {
    return {
      ok: false,
      errors: [
        `contract version mismatch: component set built against v${contractVersion}, host speaks v${COMPONENT_CONTRACT_VERSION}`,
      ],
    }
  }

  return {
    ok: true,
    meta: {
      // A runtime-meta block claims the `component-set-runtime-meta` type; the engine's
      // meta_blocks body omits the claim, so stamp it for the typed shape.
      type: 'component-set-runtime-meta',
      entry: record['entry'] as string,
      contractVersion,
      provides: provides as ComponentSetRuntimeMeta['provides'],
      ...(typeof record['export'] === 'string' && record['export'].length > 0
        ? { export: record['export'] as string }
        : {}),
      ...(customTokenEntry ? { customTokenEntry: customTokenEntry as ComponentSetRuntimeMeta['customTokenEntry'] } : {}),
    },
  }
}

/**
 * The bare NAME of a def-ref wikilink value (`[[au-button::au-component-catalog|x]]` ->
 * `au-button`). Strips the `[[ ]]`, any `|display` / `#anchor`, and the `::repo`
 * qualifier — matching the bare tag names a resolved catalog is keyed by.
 *
 * The host's discovery pass uses this to turn `provides` into the set's coverage set.
 * Duplicated rather than imported from `@arsumbris/type-query` so this contract package
 * stays dependency-free.
 */
export function componentRefName(ref: string): string | undefined {
  const inner = ref.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0]?.trim() ?? ''
  const name = inner.split('::')[0]?.trim() ?? ''
  return name || undefined
}

// Optional field/control semantic association; implemented by participating component sets.
export type { FieldContext, FieldParticipant, FieldAssociation } from './field-context'
export { updateFieldAssociation } from './field-context'

export { provideOverlayTokens } from './overlay-channel'
export type { OverlayTokens, OverlayTokenScope } from './overlay-presentation'
