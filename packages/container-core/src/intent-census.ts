// The live INTENT CENSUS — INJECTED by the host, read by the Layout Inspector.

// The intent channel (projections FIRE typed intents, containers DECLARE which types they handle, the
// host ROUTES) is APP-owned: it lives in the host's private `IntentTree`, NOT in this framework-agnostic
// substrate. The read-only layout-inspector must SURFACE it — which types have a live handler, and who
// fires each — without reaching into the app. So the host INJECTS a getter and the inspector reads it.

// The census lives on the window-global shared state because its producers and inspector
// can run in separate bundles. The drag store uses the same mechanism in `singletons.ts`.

// BY PROJECTION-TYPE NAME. The IntentTree knows publisher IDS; the host maps each id → its projection
// type when building the census, so a reader sees "file-tree fires open-intent" / "bento, tabs handle
// it" rather than opaque node ids.

// ORTHOGONAL to the routing ORDER (a responder chain): the census is the live
// candidate SET, never the winner. The inspector surfaces it; it never re-derives the routing.

import { intentCensus as holder } from './singletons.ts'

/**
 * Intent-map snapshot keyed by projection type.
 * The live layer contains mounted handlers, session firers and the last firer. The capability layer
 * contains declared firers and handlers from type metadata, available before any runtime activity.
 * The inspector selects the capability or live layer when rendering this snapshot.
 */
export interface IntentCensus {
  /** LIVE — intent type → the projection type names with a live handler right now (SINKS, mounted). */
  readonly sinks: ReadonlyMap<string, readonly string[]>
  /** LIVE — intent type → the projection type names that have FIRED it this session (SOURCES). */
  readonly sources: ReadonlyMap<string, readonly string[]>
  /** LIVE — intent type → the projection type name of the LAST firer this session (the "actual (last)" view). */
  readonly lastFire: ReadonlyMap<string, string>
  /** CAPABILITY — intent type → projection types that DECLARE firing it (`fires-intent-meta`, type graph). */
  readonly declaredFirers: ReadonlyMap<string, readonly string[]>
  /** CAPABILITY — intent type → projection types that DECLARE handling it (`handles-intent-meta`, type graph). */
  readonly declaredHandlers: ReadonlyMap<string, readonly string[]>
}

const EMPTY: IntentCensus = {
  sinks: new Map(),
  sources: new Map(),
  lastFire: new Map(),
  declaredFirers: new Map(),
  declaredHandlers: new Map(),
}

/**
 * Install the live intent-census getter — the host's handle over its private `IntentTree`, with node
 * ids already mapped to projection-type names. `null` clears it (host teardown).
 */
export function setIntentCensusProvider(provide: (() => IntentCensus) | null): void {
  holder.provider = provide
}

/**
 * The live intent census, or an EMPTY snapshot when no host has installed a provider (a bare projection
 * bundle, a test, or before the host wires it — a graceful, honest empty, not a throw).
 */
export function readIntentCensus(): IntentCensus {
  return holder.provider?.() ?? EMPTY
}
