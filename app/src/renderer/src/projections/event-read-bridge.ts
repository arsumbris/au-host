// A gated, READ-ONLY `window.__auEvents` bridge exposing the host event-substrate VIEWS, for E2E /
// external debugging. It is present ONLY when the substrate is enabled — the same `?au-events=` /
// `localStorage.__au_events` toggle that turns the trace categories on — so a plain production renderer
// exposes nothing.
//
// WHY it exists: the substrate's own `__AU_HOST_EVENTS__` window global is DEV-only and holds the raw
// EventState, not the read API. A Playwright `page.evaluate` against the BUILT renderer needs the real
// filtered views (`read()` / `readConditions()` / `stats()`), so this is the clean, gated surface. Reads
// the ONE served event singleton (the shared-dep instance every projection emits into), so it sees the
// live timeline. `readConditions()` returns an ARRAY (a Map does not survive `page.evaluate` serialization).

import { read, readConditions, stats, clear, type EventFilter, type HostEvent } from '@arsumbris/au-host-sdk'

interface EventReadBridge {
  read(filter?: EventFilter): HostEvent[]
  conditions(): HostEvent[]
  stats(): ReturnType<typeof stats>
  clear(): void
}

function eventsEnabled(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('au-events')) return true
  } catch {
    /* no location (non-browser) */
  }
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('__au_events')) return true
  } catch {
    /* storage blocked */
  }
  return false
}

/** Install the gated `window.__auEvents` read bridge (a no-op unless the event substrate is enabled). */
export function installEventReadBridge(): void {
  if (!eventsEnabled()) return
  const bridge: EventReadBridge = {
    read: (filter) => read(filter),
    conditions: () => Array.from(readConditions().values()),
    stats: () => stats(),
    clear: () => clear(),
  }
  ;(globalThis as unknown as { __auEvents?: EventReadBridge }).__auEvents = bridge
}

/** Install the gated `window.__auComposition` read bridge: returns the composition EXACTLY as it would
 *  persist right now (the `persistPool` payload), so an e2e can assert what reaches disk without a save +
 *  file read (and without mutating a fixture). Same test/debug gate as the event bridge; a no-op otherwise. */
export function installCompositionReadBridge(getComposition: () => unknown): void {
  if (!eventsEnabled()) return
  ;(globalThis as unknown as { __auComposition?: () => unknown }).__auComposition = getComposition
}
