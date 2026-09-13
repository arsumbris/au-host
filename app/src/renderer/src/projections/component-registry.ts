// Register discovered component sets in the global custom-element registry at boot.
// Discovered tags without an active implementation receive a visible placeholder.
// A tag is defined once per session; reloading applies a component-set change.
// The host supplies the registration target through the component contract.

import { COMPONENT_CONTRACT_VERSION } from '@arsumbris/component-contract'
import type { ComponentSetApi, ComponentSetModule } from '@arsumbris/component-contract'
import { loadProjection, sourceKey, sourceLocation } from './loader'
import type { ProjectionSource } from '@arsumbris/au-host-sdk'
import type { DiscoveredComponent, DiscoveredComponentSet } from './component-discovery'

/**
 * The first-party default component set forms the base of the resolution stack.
 * Purely additive sets activate automatically; a set that overrides base tags requires explicit selection.
 */
export const DEFAULT_SET_TYPE = 'default-set'

/** Where a resolved tag's implementation came from, for the gallery's coverage view. */
export interface TagCoverage {
  tag: string
  /** The set that won this tag, or null when no active set provides it (a placeholder is registered). */
  winner: string | null
  /** Every active set that provides this tag (precedence order), for "who could provide it". */
  providers: string[]
}

/** The outcome of a boot registration pass, surfaced for the gallery + diagnostics. */
export interface RegistrationResult {
  /** Per-tag coverage over the DISCOVERED component catalog. */
  coverage: TagCoverage[]
  /** Tags a placeholder was registered for (no active provider). */
  unresolved: string[]
  /** Non-fatal messages (a set that failed to load, a define that threw). */
  diagnostics: string[]
}

/** Tags this module has already defined in the global registry this session (boot-swap: define once). */
const definedTags = new Set<string>()

/**
 * The active STACK, floor-first, lowest precedence first (the registration loop lets the LAST
 * contributor of a tag win). The activation policy:
 *   - the FLOOR (`DEFAULT_SET_TYPE`) is always the base of the stack.
 *   - a purely-ADDITIVE set (no tag overlap with the floor) AUTO-ACTIVATES — a sole provider can't
 *     conflict, so it just works on install, combined with the floor, no user selection.
 *   - a base-OVERRIDING set (≥1 tag the floor also provides) activates ONLY when explicitly selected
 *     (`activeLook`), and sits on TOP so it wins its overridden tags; every tag it does NOT provide
 *     falls through to the floor (per-tag fallback).
 */
export function resolveStack(sets: DiscoveredComponentSet[], activeLook: string | null): DiscoveredComponentSet[] {
  const floor = sets.find((s) => s.typeName === DEFAULT_SET_TYPE)
  if (!floor) return [] // no floor present → nothing to stand on (degenerate; every tag placeholders)
  const floorTags = new Set(floor.provides)
  const others = sets.filter((s) => s.typeName !== DEFAULT_SET_TYPE)

  const additive = others.filter((s) => s.provides.every((t) => !floorTags.has(t)))
  const chosenOverride = others.find(
    (s) => s.typeName === activeLook && s.provides.some((t) => floorTags.has(t)),
  )

  const stack = [floor, ...additive]
  if (chosenOverride) stack.push(chosenOverride) // on top: wins its tags; others fall through to floor
  return stack
}

/**
 * Load every set in `stack` and collect its (tag -> ctor) contributions via `register(api)`. The set
 * never touches `customElements` itself — the CALLER decides the target registry (the global one for
 * the boot swap; a per-set SCOPED registry for the gallery preview). Shared by `registerComponentSets`
 * (global) and `buildComponentPreview` (scoped) so both resolve identically.
 */
export async function collectContributions(
  stack: DiscoveredComponentSet[],
): Promise<{ contributions: Map<string, Map<string, CustomElementConstructor>>; diagnostics: string[] }> {
  const contributions = new Map<string, Map<string, CustomElementConstructor>>()
  const diagnostics: string[] = []
  for (const set of stack) {
    const collected = new Map<string, CustomElementConstructor>()
    const api: ComponentSetApi = {
      contractVersion: COMPONENT_CONTRACT_VERSION,
      define(tag, impl) {
        collected.set(tag, impl)
      },
    }
    const source: ProjectionSource = { mode: 'esm', path: set.packageRoot }
    const registration = {
      key: sourceKey(sourceLocation(source)),
      source,
      entry: set.entry,
      export: set.export ?? 'register',
    }
    try {
      const loaded = await loadProjection(registration)
      const fn = (loaded.module as unknown as ComponentSetModule)[registration.export]
      if (typeof fn !== 'function') {
        diagnostics.push(`[component-set] ${set.typeName}: no "${registration.export}" export at ${set.entry}`)
        continue
      }
      fn(api)
      contributions.set(set.typeName, collected)
    } catch (err) {
      diagnostics.push(`[component-set] ${set.typeName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { contributions, diagnostics }
}

/** The topmost set in `stack` that contributed `tag` (later in stack = higher precedence), + its ctor. */
export function winnerFor(
  stack: DiscoveredComponentSet[],
  contributions: Map<string, Map<string, CustomElementConstructor>>,
  tag: string,
): { winner: string | null; ctor?: CustomElementConstructor; providers: string[] } {
  const providers: string[] = []
  let winner: string | null = null
  let ctor: CustomElementConstructor | undefined
  for (const set of stack) {
    const c = contributions.get(set.typeName)?.get(tag)
    if (c) {
      providers.push(set.typeName)
      winner = set.typeName
      ctor = c
    }
  }
  return { winner, ctor, providers }
}

/** Build a fresh placeholder element class for one unresolved tag (a class binds to ONE tag name). */
function placeholderClass(tag: string, providers: string[]): CustomElementConstructor {
  return class extends HTMLElement {
    connectedCallback(): void {
      const hint = providers.length
        ? `provided by: ${providers.join(', ')} (not active)`
        : 'no set provides this component'
      this.style.cssText =
        'display:inline-flex;align-items:center;gap:.4em;padding:.2em .5em;border:1px dashed var(--au-color-danger);border-radius:4px;color:var(--au-color-danger);font:12px/1.4 var(--au-font-mono)'
      this.title = hint
      this.textContent = `⚠ ${tag}`
    }
  }
}

/**
 * Load the active sets, resolve the per-tag winners over the DISCOVERED catalog, and register the
 * winners (+ placeholders for unresolved tags) into the GLOBAL custom-element registry. Idempotent
 * across rediscover re-runs: a tag already defined this session is left as-is (boot-swap — a set
 * change applies on reload, never mid-session).
 */
export async function registerComponentSets(
  sets: DiscoveredComponentSet[],
  components: DiscoveredComponent[],
  activeLook: string | null,
): Promise<RegistrationResult> {
  const stack = resolveStack(sets, activeLook)

  // 1. Load each active set + collect its (tag -> ctor) contributions (the set hands the host classes;
  //    here the target is the GLOBAL registry). Shared with the scoped-preview path.
  const { contributions, diagnostics } = await collectContributions(stack)

  // 2. Per discovered tag, the TOPMOST active set that contributed it wins (later in stack = higher).
  const coverage: TagCoverage[] = []
  const unresolved: string[] = []
  for (const comp of components) {
    const tag = comp.typeName
    const { winner, ctor: winnerCtor, providers } = winnerFor(stack, contributions, tag)
    coverage.push({ tag, winner, providers })

    // 3. Define the winner, or a placeholder, into the GLOBAL registry — once per session.
    if (definedTags.has(tag) || customElements.get(tag)) {
      if (!winnerCtor) unresolved.push(tag)
      continue
    }
    if (winnerCtor) {
      try {
        customElements.define(tag, winnerCtor)
        definedTags.add(tag)
      } catch (err) {
        diagnostics.push(`[component] define ${tag}: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      unresolved.push(tag)
      try {
        customElements.define(tag, placeholderClass(tag, providersFromSets(sets, tag)))
        definedTags.add(tag)
        diagnostics.push(`[component] ${tag}: no active set provides it — registered a placeholder`)
      } catch (err) {
        diagnostics.push(`[component] placeholder ${tag}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return { coverage, unresolved, diagnostics }
}

/** Every DISCOVERED set (active or not) that DECLARES the tag in `provides` — the placeholder hint. */
function providersFromSets(sets: DiscoveredComponentSet[], tag: string): string[] {
  return sets.filter((s) => s.provides.includes(tag)).map((s) => s.typeName)
}
