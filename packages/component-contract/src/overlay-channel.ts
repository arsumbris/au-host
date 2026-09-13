import { OverlayPresentation, type OverlayTokens, type OverlayTokenScope } from './overlay-presentation'

// THE COMPONENT-OVERLAY CHANNEL — how a framework-agnostic `<au-*>` component reaches the host's one
// OverlaySite (`host.overlay`) when it has no `host` handle to reach it with.

// WHY A SHARED CHANNEL. A component set is a self-contained ESM bundle (like a projection): it gets
// `register(api)`, and its elements receive only attributes / slots / events — never `MountHost`, which
// is handed to a PROJECTION at `mount(container, host)`. So a component has no wire to `host.overlay`.
// The host PUBLISHES its per-window overlay `claim` into this module; a component READS it here.


// STORAGE. Every renderer bundle resolves ONE served copy of this module (the shared-dep platform), so the
// `claim` is a plain module singleton (`channel()` below). The ONE exception is `pnpm dev`: vite serves the
// shell live on its own copy, so the shell and the component sets are split instances — then, and only
// then, they bridge through the `__AU_HOST_OVERLAY__` window-global (see `bridging()`).

// This module carries the MINIMAL contract a component needs — a band name and a `{ el, release }`
// layer — NOT the host's full `OverlaySite` / `MountHost` (au-host-sdk owns those, and this package
// must stay off au-host-sdk to keep the layering one-way). The host maps its own `OverlayLevel` onto
// these names at the publish seam; the two unions are structurally identical by construction.

/**
 * The stacking band a claimed layer sits in, the low-to-high `--au-z-*` ladder BY NAME. Mirrors
 * au-host-sdk's `OverlayLevel`; the host publishes an adapter that passes the name straight through.
 */
export type OverlayLevel = 'raised' | 'sticky' | 'dropdown' | 'overlay' | 'popover' | 'toast' | 'tooltip'

/**
 * A claimed layer: an element to draw into, and the release that removes it. The component-side
 * subset of au-host-sdk's `OverlayLayer` — the host owns insertion + clip-escape + stacking, the
 * claimant owns the content it draws into `el`.
 */
export interface OverlayLayer {
  readonly el: HTMLElement
  release(): void
}

/**
 * The host's published claim: give me a layer at `level`. Installed once per window at boot.
 *
 * `from` is the element the overlay is summoned FROM (the trigger). When it sits inside another overlay
 * layer — a select opened inside a modal palette — the host NESTS the new layer under that one, so the
 * popup stacks above its host surface instead of under it (the fixed band ladder cannot express
 * "above my container"). Absent → a top-level layer placed by the band ladder, as before.
 */
export type HostOverlayClaim = (level: OverlayLevel, from?: Element | null) => OverlayLayer

const KEY = '__AU_HOST_OVERLAY__'

interface Channel {
  claim: HostOverlayClaim | null
  presentation?: OverlayPresentation
}

// Whether the shell + this bundle are SPLIT copies (the vite-served dev shell — see the header). Set once
// at renderer boot (`__AU_DEV__`), before any accessor runs.
const bridging = (): boolean => (globalThis as Record<string, unknown>).__AU_DEV__ === true

let local: Channel | null = null

function channel(): Channel {
  // PROD: one served instance everyone shares → a plain module singleton, no window-global. DEV: the shell
  // holds a different (vite) copy, so the split instances bridge through the window-global.
  if (bridging()) {
    const g = globalThis as unknown as Record<string, Channel | undefined>
    return (g[KEY] ??= { claim: null })
  }
  return (local ??= { claim: null })
}

/**
 * HOST SIDE. Publish this window's overlay `claim` so component bundles can reach it. Idempotent, and
 * the last writer wins (re-publishing a window keeps it working). Called once at each renderer boot.
 */
export function publishHostOverlay(claim: HostOverlayClaim): void {
  channel().claim = claim
}

/**
 * COMPONENT SIDE. Claim an overlay layer at `level`, or `null` when no host has published one — a
 * standalone gallery render, or a call before boot. Returning null keeps a bare component
 * RENDER-RESILIENT: the caller degrades (renders inline) instead of throwing.
 *
 * `from` is the trigger element (usually the calling component). Passing it lets a popup opened from
 * INSIDE a modal stack above that modal — see `HostOverlayClaim`.
 */
export function claimHostOverlay(level: OverlayLevel, from?: Element | null): OverlayLayer | null {
  const state = channel()
  const layer = state.claim?.(level, from)
  return layer ? state.presentation?.apply(layer, from) ?? layer : null
}

/** Scope presentation tokens to overlays opened by descendants; does not install or replace a host. */
export function provideOverlayTokens(root: Element, tokens: OverlayTokens): OverlayTokenScope {
  const state = channel()
  return (state.presentation ??= new OverlayPresentation()).provide(root, tokens)
}
