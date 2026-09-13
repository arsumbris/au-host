// Persist the active component look per machine, alongside the theme selection.
// The store holds one optional look-set ID; `component-registry.ts` resolves it with the default set
// and additive component sets.

import type { ComponentSetControl } from '@arsumbris/au-host-sdk'
import type { DiscoveredComponentSet } from './component-discovery'
import { buildComponentPreview } from './component-preview'

const ACTIVE_LOOK_KEY = 'au-host.components.active-look'

/**
 * The current discovered component sets, refreshed by `ProjectionHost.rediscover`. The picker needs
 * them to build a live preview (a projection can't discover+load sets itself), so the host stashes
 * them here for `componentSetControl.buildPreview` to read. Empty until the first discovery.
 */
let discoveredSets: DiscoveredComponentSet[] = []

/** Called by the host after each component discovery so `buildPreview` sees the current sets. */
export function setDiscoveredSets(sets: DiscoveredComponentSet[]): void {
  discoveredSets = sets
}

/**
 * The chosen "look" set's type name, or null for the default floor only. A look is a
 * base-overriding set the user explicitly selected; null means no override (the default).
 */
export function getActiveLook(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_LOOK_KEY)
    return raw && raw.trim() ? raw : null
  } catch {
    return null
  }
}

/**
 * Persist the chosen look (or clear it with null). Per-machine, like the active theme. The
 * app-wide swap is BOOT-SWAP, so a caller PERSISTS here then prompts a reload to apply — this
 * store never re-registers elements itself.
 */
export function setActiveLook(setId: string | null): void {
  try {
    if (setId) localStorage.setItem(ACTIVE_LOOK_KEY, setId)
    else localStorage.removeItem(ACTIVE_LOOK_KEY)
  } catch {
    // storage full / unavailable — best-effort, drop silently.
  }
}

/**
 * The projection-facing `ComponentSetControl` (the sibling of `theme-store.ts`'s `themeControl`).
 * A thin, app-wide singleton every node shares — the components picker reads + persists through it.
 * The swap is BOOT-SWAP, so this only persists; a caller prompts a reload to apply.
 */
export const componentSetControl: ComponentSetControl = {
  getActiveSet: () => getActiveLook(),
  setActiveSet: (id) => setActiveLook(id),
  buildPreview: (setId) => buildComponentPreview(discoveredSets, setId),
}
