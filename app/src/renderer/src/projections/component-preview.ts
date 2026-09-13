// Preview a component set with unique global tag names without replacing live registered elements.
// An overriding class registers under a mangled name and retains its shadow-DOM `:host` styling.
// Tags the preview set does not override reuse their existing global definition. This keeps the preview
// isolated from the app's active set; applying a different active set requires a reload.

import { collectContributions, resolveStack, winnerFor } from './component-registry'
import type { DiscoveredComponentSet } from './component-discovery'

/** A live preview factory over one set's resolution (mangled where it overrides the live app). */
export interface ComponentPreview {
  /** Create a preview element of `tag` under this set's resolution: the live GLOBAL element where the
   *  set matches the app, else the set's overriding impl under a mangled global name. Always returns
   *  an element (bare for an unknown tag). */
  create(tag: string): HTMLElement
}

/** Cache one factory per requested set id, so each overriding class is defined under exactly one
 *  mangled name ever and repeat previews are instant. Keyed by the set id ('default' == the floor). */
const cache = new Map<string, ComponentPreview>()

/**
 * Build a live preview factory for the set `setId` (null == the Default floor only), over the
 * discovered `sets`. Cached per set id. Returns null only if the requested set has no resolvable
 * stack (degenerate); the gallery then keeps the live global render.
 */
export async function buildComponentPreview(
  sets: DiscoveredComponentSet[],
  setId: string | null,
): Promise<ComponentPreview | null> {
  const key = setId ?? 'default'
  const cached = cache.get(key)
  if (cached) return cached

  // Resolve this set's stack exactly as the app would, and load the winning ctors.
  const stack = resolveStack(sets, setId)
  if (!stack.length) return null
  const { contributions } = await collectContributions(stack)
  const winners = new Map<string, CustomElementConstructor>()
  for (const tag of new Set(stack.flatMap((s) => s.provides))) {
    const { ctor } = winnerFor(stack, contributions, tag)
    if (ctor) winners.set(tag, ctor)
  }

  const suffix = key.replace(/[^a-z0-9-]/g, '') || 'default' // a valid custom-element name segment
  const preview: ComponentPreview = {
    create(tag: string): HTMLElement {
      const ctor = winners.get(tag)
      // No preview ctor, or the preview ctor IS the live global element → use the global one directly.
      if (!ctor || customElements.get(tag) === ctor) return document.createElement(tag)
      // This set overrides the tag with a non-global class → register it under a mangled name once and
      // create that. A define failure (e.g. the class already used elsewhere) degrades to the global.
      const name = `${tag}--auprev-${suffix}`
      if (!customElements.get(name)) {
        try {
          customElements.define(name, ctor)
        } catch {
          return document.createElement(tag)
        }
      }
      return document.createElement(name)
    },
  }
  cache.set(key, preview)
  return preview
}
