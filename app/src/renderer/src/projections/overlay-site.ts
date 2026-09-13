import { floatingSurfaceMaterialCSS } from '@arsumbris/style/surface-material'
// Provide the host's shared place to draw above the composition. Each claimant receives a layer
// with its own stacking context, containing its internal z-index values. Host surfaces and
// projections use the same capability for content that extends beyond a pane.
// Named bands determine ordering between layers through the theme's `--au-z-*` tokens. This keeps
// internal card or cone ordering independent of another claimant's notification or modal layer.

import type { OverlayLayer, OverlayLevel, OverlayOptions, OverlaySite } from '@arsumbris/au-host-sdk'
import { publishHostOverlay } from '@arsumbris/component-contract'
import { adoptHostSheet } from './adopt-sheet'

/**
 * The ladder, low to high. The ORDER is what this array encodes; the numbers live in
 * `packages/style/ext.css` as registered `@property` tokens, and a theme may re-space them.
 *
 * A DOM-order sort rather than a numeric one: layers are siblings, so appending them in ladder
 * order means the browser paints them in that order even if a token fails to register. The
 * `z-index` below is the primary mechanism; DOM order is the floor that holds when it does not.
 */
export const LADDER: readonly OverlayLevel[] = ['raised', 'sticky', 'dropdown', 'overlay', 'popover', 'toast', 'tooltip']

/** The general-purpose band, for a claimant that does not care. */
export const DEFAULT_LEVEL: OverlayLevel = 'overlay'

/**
 * Where a new layer at `level` goes among `existing` (already in ladder order): the index of the
 * first layer ABOVE it, or `existing.length` for the top.
 *
 * EXTRACTED AND PURE because it is the only real logic here and it is the only part that can be
 * WRONG in a way nothing shows — a mis-sort is two things drawing in the wrong order, which looks
 * like a CSS bug rather than a bug here. The rest of `claim` is `createElement` + `appendChild`.
 *
 * Ties go LAST within a level, which is claim order. Two claimants at one band have said nothing
 * about each other, so claim order is the only stable answer available; inventing a tie-break would
 * be the kernel holding placement knowledge nobody gave it.
 */
export function insertionIndexFor(existing: readonly OverlayLevel[], level: OverlayLevel): number {
  const rank = LADDER.indexOf(level)
  const above = existing.findIndex((l) => LADDER.indexOf(l) > rank)
  return above === -1 ? existing.length : above
}

// Exported as the single source of the overlay root's class name: the out-of-bounds DOM detector
// (`dom-bounds-detector.ts`) recognizes this element so the site's own lazy append is never flagged.
export const ROOT_CLASS = 'au-overlay-root'
const LAYER_CLASS = 'au-overlay-layer'

/**
 * The nearest ancestor overlay layer of `node`, PIERCING SHADOW BOUNDARIES — a control is usually nested
 * in one or more shadow roots (an `au-select` inside an `au-typed-value-editor` inside the palette's layer),
 * so a plain `closest()` stops at the first shadow boundary. Walk parents, hopping to the shadow HOST at
 * each root. `null` when the node is in no layer (the common top-level case).
 */
function closestLayer(node: Node | null): HTMLElement | null {
  let cur: Node | null = node
  while (cur) {
    if (cur instanceof HTMLElement && cur.classList.contains(LAYER_CLASS)) return cur
    const root = cur.getRootNode()
    cur = cur.parentNode ?? (root instanceof ShadowRoot ? root.host : null)
  }
  return null
}

// The root and every layer capture NOTHING, and there is no way to opt a whole layer in. A layer
// spans the viewport and is held for the window's lifetime, so a capturing one would be a permanent
// sheet over the app — every click in the composition dying on an empty overlay. `pointer-events`
// INHERITS, so a claimant re-enables it on the elements it draws; `.au-pcard`, `.au-notif-toast` and
// `.au-confirm-backdrop` all do exactly that. See `OverlayOptions` in the SDK for the full argument,
// including why a modal is not the exception it appears to be.
//
// `isolation: isolate` on each layer is the other load-bearing line: it makes the layer a stacking
// context, so a claimant's internal z-indexes resolve inside it and never against a sibling's.
// APP-REGION follows the SAME transparent-container model as pointer-events, and for the same reason. The
// root + every layer span the viewport for the window's lifetime, so declaring `app-region: no-drag` on them
// would blanket the WHOLE window as a no-drag rectangle — defeating the window-root header's
// `-webkit-app-region: drag` beneath it (a full-window no-drag sheet on top wins geometrically, independent
// of `pointer-events`). So the transparent containers declare NO app-region (the header's drag shows through
// the empty regions), and only a claimant's INTERACTIVE content opts out with `no-drag` (buttons, menus,
// dialogs, popovers, a modal backdrop). Decorative content (empty layers, a chooser's cones) stays draggable,
// so an overlay over the draggable header is no-drag only where it is actually interactive.
export const OVERLAY_STYLE = `
.cmd-palette-overlay, .key-sequence-hints { ${floatingSurfaceMaterialCSS} }
.${ROOT_CLASS} { position: fixed; inset: 0; pointer-events: none; }
.${LAYER_CLASS} { position: fixed; inset: 0; pointer-events: none; isolation: isolate; }
.${LAYER_CLASS} :is(button, input, textarea, select, a, [role='dialog'], au-popover, au-hovercard, au-menu, au-command-palette, .au-confirm-backdrop) {
  -webkit-app-region: no-drag; app-region: no-drag;
}
.${LAYER_CLASS}[data-level='raised']   { z-index: var(--au-z-raised); }
.${LAYER_CLASS}[data-level='sticky']   { z-index: var(--au-z-sticky); }
.${LAYER_CLASS}[data-level='dropdown'] { z-index: var(--au-z-dropdown); }
.${LAYER_CLASS}[data-level='overlay']  { z-index: var(--au-z-overlay); }
.${LAYER_CLASS}[data-level='popover']  { z-index: var(--au-z-popover); }
.${LAYER_CLASS}[data-level='toast']    { z-index: var(--au-z-toast); }
.${LAYER_CLASS}[data-level='tooltip']  { z-index: var(--au-z-tooltip); }
`

/**
 * Create a site rooted at `host`.
 *
 * `host` is injected rather than assumed so a test drives this without a document body, and so the
 * ONE place that names `document.body` is the singleton below. Everything else in the host asks the
 * site.
 */
export function createOverlaySite(host: HTMLElement): OverlaySite {
  const root = document.createElement('div')
  root.className = ROOT_CLASS
  // Host chrome as a document-level constructable sheet (CSP-exempt). The disposer is intentionally not
  // held: `createOverlaySite` runs once per window via the `getOverlaySite` singleton, so the sheet is
  // boot-lifetime — there is no remount that would leak a second copy.
  adoptHostSheet(OVERLAY_STYLE)
  host.appendChild(root)

  function claim(options?: OverlayOptions): OverlayLayer {
    const level = options?.level ?? DEFAULT_LEVEL
    const el = document.createElement('div')
    el.className = LAYER_CLASS
    el.dataset.level = level
    // A keyboard-driven LAUNCHER (the palette) opts OUT of the keybind guard, so its own toggle chord still
    // reaches it while open. Default (absent) keeps a blocking band suppressing chords.
    if (options?.keyguard === false) el.dataset.keyguard = 'false'

    // NESTING: a layer summoned from INSIDE another layer (a select opened in a modal palette) is placed
    // UNDER that layer, not among the root's. Because each layer is its own `isolation: isolate` stacking
    // context, a nested layer's band z resolves ABOVE its host's content, while the host layer keeps its
    // own place in the root ladder — so the popup floats over the modal AND unrelated layers (a toast)
    // still order globally. `from` absent (a top-level modal, a host surface) → the root, as before.
    const parent = (options?.from && closestLayer(options.from)) || root

    // Insert in LADDER order among the PARENT's own layer children (direct only, so nesting composes).
    // The index comes from the pure helper above, which is where the logic is tested.
    const siblings = [...parent.children].filter((c): c is HTMLElement => c.classList.contains(LAYER_CLASS))
    const at = insertionIndexFor(
      siblings.map((s) => (s.dataset.level ?? DEFAULT_LEVEL) as OverlayLevel),
      level,
    )
    parent.insertBefore(el, siblings[at] ?? null)

    let released = false
    return {
      el,
      release(): void {
        if (released) return
        released = true
        el.remove()
      },
    }
  }

  return { claim }
}

/**
 * The per-window singleton. Each renderer window (main and every secondary surface) has its own module
 * state, so each gets its own site over its own document.
 *
 * THIS IS THE ONE PLACE IN THE HOST THAT NAMES `document.body` FOR AN OVERLAY. That is the whole
 * point of the site: not that the body is untouchable, but that exactly one owner touches it.
 */
let singleton: OverlaySite | null = null
export function getOverlaySite(): OverlaySite {
  return (singleton ??= createOverlaySite(document.body))
}

/**
 * Publish this window's overlay `claim` to the component-overlay channel, so a framework-agnostic
 * `<au-*>` component — which has no `host` handle — can reach `host.overlay`. The HOST is the one
 * place that knows both au-host-sdk's `OverlaySite` and the component channel, so the bridge lives
 * here rather than in either contract package. Called once per renderer window at boot.
 *
 * See the component-overlay channel in `@arsumbris/component-contract`

 */
export function installComponentOverlayChannel(): void {
  // `from` (the trigger element) rides through so a component popup opened inside a modal nests above it.
  publishHostOverlay((level, from) => getOverlaySite().claim({ level, from: (from as HTMLElement) ?? undefined }))
}

// The interactive/dismissable bands whose open layer BLOCKS keybind dispatch (a menu, modal, palette, or
// popover). A `toast` / `tooltip` / `raised` / `sticky` layer is non-blocking decoration and never
// suppresses a chord.
const BLOCKING_BANDS: ReadonlySet<string> = new Set(['dropdown', 'overlay', 'popover'])

/**
 * Whether a blocking overlay is currently open in this window. The keybind gate reads it as a guard, so a
 * chord does not fire underneath an open palette, chooser, confirm dialog, or menu. A blocking layer is a
 * non-empty layer in an interactive band; a toast or tooltip does not count. Reads the DOM the site owns,
 * so it needs no coupling to the projection-facing `OverlaySite` contract.
 */
export function overlaySiteHasBlockingLayer(): boolean {
  const layers = document.querySelectorAll(`.${ROOT_CLASS} .${LAYER_CLASS}`)
  for (const layer of layers) {
    const el = layer as HTMLElement
    const level = el.dataset.level
    // A layer that opted out of the keyguard (a keyboard launcher, e.g. the palette) never suppresses a chord.
    if (el.dataset.keyguard === 'false') continue
    if (level && BLOCKING_BANDS.has(level) && layer.childElementCount > 0) return true
  }
  return false
}
