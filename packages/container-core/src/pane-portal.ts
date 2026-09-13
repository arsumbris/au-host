/**
 * THE PORTAL REGISTRY — framework-agnostic core of the pane-portal layer.
 *
 * The problem it removes: each container renders its children inside its own tree, so a re-parent moves
 * a pane to a new tree position, its framework unmounts it, and its live DOM is destroyed — a running
 * terminal dies, and React can `removeChild` a node it no longer owns (the crash).
 *
 * The mechanism: every pooled pane is mounted ONCE into a stable host element NOBODY's render tree owns,
 * and that element is `appendChild`-ed into whatever slot ANCHOR currently claims the pane. A move
 * re-points the pool → the tree re-derives → a different anchor claims the pane → the coordinator
 * relocates the SAME live element. The pane's mount never tears down.
 *
 * This module owns the pane-host registry + the coordinator + the DOM-authoritative anchor observer,
 * framework-free. An anchor is not registered imperatively: a container (React `usePaneAnchor` or
 * vanilla `mountChild`) just SETS `data-pane-id` on its slot, and the single host-owned observer
 * (`installPaneAnchorObserver`) derives `paneAnchors` from the DOM. So both skins anchor at the same
 * cost, and no imperative call can race a container's remount.
 *
 *

 */

import type { PaneId } from '@arsumbris/au-host-sdk';

/**
 * THE PER-RUNTIME PORTAL REGISTRY. One composition mount owns one of these; the kernel creates it and
 * threads it into the observer, the parking host, and every `PaneHost`. Keeping it per-runtime (not a
 * cross-bundle global) ensures runtime isolation: two runtimes — a composition SWITCH's transient overlap,
 * or a future detached hub — can share a pane `^:` without colliding, and disposing a generation drops
 * its whole registry so nothing leaks by construction.
 *
 * It does NOT need the cross-bundle stash the drag store / placement registry use: only the HOST bundle touches these maps (the flat `PaneHost` registers
 * hosts; the host-owned observer derives `paneAnchors` from the DOM). A projection bundle only ever
 * SETS `data-pane-id` (an anchor) or calls `placementForPane` (which resolves by DOM query, not by
 * reading this map), so nothing here crosses a bundle boundary.
 */
export interface PortalRegistry {
  /** A pane's LIVE host element by its `^:` (created by the flat `PaneHost`). */
  paneHosts: Map<string, HTMLElement>;
  /** The anchor slot currently claiming each pane, derived by the observer from `data-pane-id`. */
  paneAnchors: Map<string, HTMLElement>;
  /** A pane host's DEFERRED-MOUNT callback, fired once its element first lands in a real anchor. */
  mountCbs: Map<string, () => void>;
  /** The hidden mid-move holder element + its host (a node INSIDE the composition root). */
  parking: { el: HTMLElement | null; host: HTMLElement | null };
}

/** A fresh, empty per-runtime portal registry. */
export function createPortalRegistry(): PortalRegistry {
  return { paneHosts: new Map(), paneAnchors: new Map(), mountCbs: new Map(), parking: { el: null, host: null } };
}

// A hidden holding element for a pane whose anchor is momentarily absent (mid-move, before the new
// container has registered its anchor). The pane keeps running here, off-screen, then re-attaches.
// It lives INSIDE the composition root (set by the portal kernel), never `document.body` — the host's
// dom-bounds detector sanctions only the composition root + the overlay site. Until the kernel supplies
// a home it stays DETACHED (off-DOM, so still hidden), never appended to `document.body`.
function parking(reg: PortalRegistry): HTMLElement {
  if (!reg.parking.el) {
    const el = document.createElement('div');
    el.setAttribute('data-pane-parking', '');
    // Off-flow + hidden, but SIZED (fixed, inset 0 → viewport size), NOT `display:none`. A parked pane
    // keeps a sane size, so a projection's ResizeObserver does not thrash a `fit()` at 0×0 while a pane
    // transits parking mid-move (a container remount tears down + rebuilds its anchor). `visibility`
    // hides it; `pointer-events:none` + a below-everything z-index keep it inert.
    el.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;z-index:-1';
    reg.parking.el = el;
  }
  const { el, host } = reg.parking;
  if (host && el.parentElement !== host) host.appendChild(el);
  return el;
}

/** The portal kernel supplies a hidden element INSIDE the composition root to hold parked panes, so a
 *  mid-move pane is never appended to `document.body` (which the host's dom-bounds detector flags). */
export function setPanePortalParkingHost(reg: PortalRegistry, el: HTMLElement | null): void {
  reg.parking.host = el;
  if (reg.parking.el && el) el.appendChild(reg.parking.el);
}

/**
 * Place every pane host into its current anchor (or park it if none claims it). Idempotent and cheap —
 * it only moves an element whose parent is wrong, so a redundant call is a no-op. Called after every
 * pane host mount/unmount and on every observer mutation batch, so the DOM converges on the pool's
 * current shape without anyone tracking deltas.
 *
 * The anchor is read straight from `paneAnchors`, which the host-owned observer keeps derived from DOM
 * truth (`installPaneAnchorObserver`). The two placement guards live HERE, where `hostEl` is known:
 *   - `isConnected` — a detached anchor cannot hold a pane (park instead).
 *   - `!hostEl.contains(anchor)` — refuse an anchor INSIDE the pane's own host (a self-cycle: appending
 *     the host into its own descendant throws). This is the correct direction; the interim `anchorFor`
 *     checked `anchor.contains(hostEl)`, which did not guard the real cycle.
 */
export function reconcilePanePortals(reg: PortalRegistry): void {
  for (const [id, hostEl] of reg.paneHosts) {
    const registered = reg.paneAnchors.get(id);
    const anchor =
      registered && registered.isConnected && !hostEl.contains(registered) ? registered : undefined;
    const target = anchor ?? parking(reg);
    if (hostEl.parentElement !== target) target.appendChild(hostEl);
    // TRANSPARENCY: relay the anchor's container layout-context onto the host element, BEFORE the
    // deferred mount fires, so a portaled child reads its edge/axis exactly as if mounted directly in
    // the slot. Without this the host element interposes and the child reads nothing (a dock-edge bar
    // lost its orientation + full width). Runs on every placement (and clears when parked).
    syncContextAttrs(hostEl, anchor ?? null);
    // DEFERRED MOUNT: fire the host's mount callback once it is in a REAL anchor (attached + sized), so
    // a projection never mounts parked (xterm opens at 0×0 → empty / mis-fit). Idempotent, so a later
    // re-anchor (a move) is a no-op and the pane keeps its live state.
    if (anchor) reg.mountCbs.get(id)?.();
  }
}

/** The container LAYOUT-CONTEXT a container publishes on a child's slot: its axis (`data-au-axis`) and
 *  its dock edge (`data-au-edge`). This is the substrate's layout-context convention (see the host-sdk
 *  changelog), NOT any one container's vocabulary — dock publishes an edge, a bar publishes an axis to
 *  its items. The portal relays exactly this set so it stays TRANSPARENT: a portaled child sees the same
 *  context a directly-mounted child would. Drop-target attributes (`data-droptarget-*`) are NOT here —
 *  they identify the slot to the drag system, not context the child reads. */
const CONTAINER_CONTEXT_ATTRS = ['data-au-edge', 'data-au-axis'] as const;

/** Mirror the anchor's layout-context attributes onto the host element (removing any the anchor lacks,
 *  so a parked host or an edge change never leaves a stale value). Cheap: a fixed, tiny attribute set. */
function syncContextAttrs(hostEl: HTMLElement, anchor: HTMLElement | null): void {
  for (const attr of CONTAINER_CONTEXT_ATTRS) {
    const val = anchor?.getAttribute(attr) ?? null;
    if (val === null) hostEl.removeAttribute(attr);
    else if (hostEl.getAttribute(attr) !== val) hostEl.setAttribute(attr, val);
  }
}

/** Register a pane's live host element (called by `PaneHost`). `onAnchored` is fired (idempotently) the
 *  first time the element lands in a real anchor — see DEFERRED MOUNT above. Idempotent per id. */
export function registerPaneHost(reg: PortalRegistry, paneId: PaneId, el: HTMLElement, onAnchored?: () => void): void {
  reg.paneHosts.set(paneId, el);
  if (onAnchored) reg.mountCbs.set(paneId, onAnchored);
  reconcilePanePortals(reg);
}

/** Drop a pane's host element, but ONLY if it is still the registered one — a selective remount can
 *  register the new element before the old tears down. */
export function unregisterPaneHost(reg: PortalRegistry, paneId: PaneId, el: HTMLElement): void {
  if (reg.paneHosts.get(paneId) === el) {
    reg.paneHosts.delete(paneId);
    reg.mountCbs.delete(paneId);
  }
  reconcilePanePortals(reg);
}

// ─── DOM-AUTHORITATIVE ANCHORS ─────────────────────────────────────────────────────────────────────

// An anchor is a connected element with data-pane-id and without data-pane-host.
// The host-owned observer derives paneAnchors from those attributes. usePaneAnchor and mountChild
// only set or clear the attribute; the observer is the sole registry writer.


/** An anchor element: tagged `data-pane-id`, NOT a host (`data-pane-host`), an `HTMLElement`. The host
 *  exclusion is load-bearing — the flat `PaneHost` element carries BOTH attributes (its mount slot is
 *  tagged for hover framing), and it must never be mistaken for an anchor. */
function isAnchorEl(el: Node): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.hasAttribute('data-pane-id') &&
    !el.hasAttribute('data-pane-host')
  );
}

/**
 * Record el as id's anchor unless it is inside that id's own live host, which would create a cycle.
 * Process mutations in order so the most recently tagged element wins when two slots share an id.
 */
function recordAnchor(reg: PortalRegistry, el: HTMLElement): void {
  const id = el.getAttribute('data-pane-id');
  if (!id) return;
  if (reg.paneHosts.get(id)?.contains(el)) return; // self-cycle: anchor inside its own pane host
  reg.paneAnchors.set(id, el);
}

/** `id`'s current anchor is gone; re-derive from any remaining live tag in `root` (document order is
 *  fine here — the winner already left, any survivor is acceptable), else drop the entry. */
function rederiveAnchor(reg: PortalRegistry, root: ParentNode, id: string): void {
  const found = root.querySelector(`[data-pane-id="${CSS.escape(id)}"]:not([data-pane-host])`);
  if (found instanceof HTMLElement && found.isConnected && !reg.paneHosts.get(id)?.contains(found)) {
    reg.paneAnchors.set(id, found);
  } else {
    reg.paneAnchors.delete(id);
  }
}

/** Run `fn` on `node` and every tagged anchor descendant. Bounded by the mutated subtree, not the whole
 *  tree — the efficiency point: a `childList` mutation scans only what was added/removed. */
function forEachAnchor(node: HTMLElement, fn: (el: HTMLElement) => void): void {
  if (isAnchorEl(node)) fn(node);
  for (const el of node.querySelectorAll<HTMLElement>('[data-pane-id]:not([data-pane-host])')) fn(el);
}

/** Seed `paneAnchors` from every anchor currently under `root`. Needed on install because a
 *  `MutationObserver` reports only changes AFTER observation starts. Exported for direct unit testing
 *  of the derivation (host-exclusion, self-cycle) without driving the async observer. */
export function scanAnchors(reg: PortalRegistry, root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-pane-id]:not([data-pane-host])')) {
    recordAnchor(reg, el);
  }
}

/** Apply one batch of mutations to `paneAnchors`, IN ORDER (so most-recently-tagged wins). Attribute
 *  changes repoint or drop an id; added/removed nodes fold their tagged descendants in or out. Exported
 *  for unit tests to drive the derivation synchronously (the observer callback is otherwise async). */
export function applyAnchorMutations(reg: PortalRegistry, root: HTMLElement, records: readonly MutationRecord[]): void {
  for (const rec of records) {
    if (rec.type === 'attributes' && rec.attributeName === 'data-pane-id') {
      const el = rec.target;
      if (!(el instanceof HTMLElement)) continue;
      const now = el.getAttribute('data-pane-id');
      const old = rec.oldValue;
      // el now carries a valid tag → it claims that id (most recent wins).
      if (now && isAnchorEl(el) && el.isConnected) recordAnchor(reg, el);
      // el gave up (or changed away from) an id it was winning → re-derive that id.
      if (old && old !== now && reg.paneAnchors.get(old) === el) rederiveAnchor(reg, root, old);
      // el is still tagged but became a host / detached → it must not keep winning.
      if (now && reg.paneAnchors.get(now) === el && (!isAnchorEl(el) || !el.isConnected)) {
        rederiveAnchor(reg, root, now);
      }
    } else if (rec.type === 'childList') {
      for (const node of rec.addedNodes) {
        if (node instanceof HTMLElement) forEachAnchor(node, (el) => { if (el.isConnected) recordAnchor(reg, el); });
      }
      for (const node of rec.removedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        forEachAnchor(node, (el) => {
          const id = el.getAttribute('data-pane-id');
          if (id && reg.paneAnchors.get(id) === el) rederiveAnchor(reg, root, id);
        });
      }
    }
  }
}

/**
 * Install the single host-owned anchor observer over the composition root. Seeds `paneAnchors` from the
 * DOM, then keeps it derived from every `data-pane-id` mutation and subtree add/remove, reconciling on
 * each batch. Returns a disposer that disconnects and clears the map.
 *
 * Installed ONCE, in the host bundle, over the DOM — the DOM is bundle-agnostic, so a container in any
 * projection bundle just sets the attribute and this one observer sees it. Idempotent under StrictMode
 * (install → dispose → install re-scans from scratch).
 */
export function installPaneAnchorObserver(reg: PortalRegistry, root: HTMLElement): () => void {
  scanAnchors(reg, root);
  reconcilePanePortals(reg);
  const observer = new MutationObserver((records) => {
    applyAnchorMutations(reg, root, records);
    reconcilePanePortals(reg);
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['data-pane-id'],
  });
  return () => {
    observer.disconnect();
    reg.paneAnchors.clear();
  };
}
