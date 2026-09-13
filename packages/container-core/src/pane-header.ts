/**
 * The PANE-HEADER CONTRIBUTION seam (framework-agnostic).
 *
 * A container's pane header is a REGIONED surface: `leading` (drag handle) ∣
 * `center` (`title | child-content`) ∣ `spacer` ∣ `actions`. The container OWNS
 * the bar and fills `leading` + `actions` with its own controls. An OCCUPANT (the
 * projection mounted as the pane's content) MAY contribute header content into an
 * offered region — a `tabs` occupant contributes its tab strip into `center`, so
 * the strip shares ONE bar with the grip + actions instead of nesting a second
 * surface.
 *
 *

 *
 * SHAPE. Two sides over one per-pane record:
 * - the CONTAINER OFFERS a region: it registers the DOM node of that region in its
 *   own header (`offerHeaderRegion`), and reads whether an occupant has taken it
 *   (`isHeaderRegionClaimed`) to toggle its own title.
 * - the OCCUPANT CLAIMS the region: it reads the offered node (`offeredHeaderRegion`)
 *   and draws into it (a React portal, or a vanilla append), marking it claimed
 *   (`setHeaderRegionClaimed`) so the container drops its title. Absent offer →
 *   `null`, so the occupant falls back to rendering in its own body (render-resilient).
 *
 * DOM-AUTHORITATIVE keying. The occupant resolves the pane it sits in from the DOM
 * (`paneIdForElement` walks to the nearest `data-pane-id`), the same anchor the
 * portal layer uses, so no `paneId` needs threading through the mount contract. This
 * is the container-substrate parity of the drop router (which routes by DOM
 * geometry, NOT a kernel capability) — the seam lives here, beside the placement
 * registry, never on the `MountHost` kernel.
 *
 * CROSS-BUNDLE. The container (e.g. bento) and the occupant (e.g. tabs) are DIFFERENT
 * projection bundles, so the record map is one of the shared singletons (`paneHeaders`
 * in `singletons.ts`), the same one-instance-per-bundle rule as the placement registry.
 */

import type { PaneId } from '@arsumbris/au-host-sdk';
import { paneHeaders } from './singletons.ts';

/** One pane's offered header regions plus who has claimed them. */
export interface HeaderOffer {
  /** region name (`center`, …) → the container's DOM node for that region. */
  regions: Map<string, HTMLElement>;
  /** the regions an occupant currently draws into, so the container drops its title. */
  claimed: Set<string>;
  /** subscribers on BOTH sides — any offer/withdraw/claim change notifies them all. */
  subs: Set<() => void>;
}

function record(paneId: PaneId): HeaderOffer {
  let o = paneHeaders.get(paneId);
  if (!o) {
    o = { regions: new Map(), claimed: new Set(), subs: new Set() };
    paneHeaders.set(paneId, o);
  }
  return o;
}

function notify(paneId: PaneId): void {
  const o = paneHeaders.get(paneId);
  if (!o) return;
  for (const cb of [...o.subs]) cb();
}

/** Drop a pane's record once it holds nothing (no regions, no claims, no subs). */
function gc(paneId: PaneId): void {
  const o = paneHeaders.get(paneId);
  if (o && o.regions.size === 0 && o.claimed.size === 0 && o.subs.size === 0) {
    paneHeaders.delete(paneId);
  }
}

// ─── CONTAINER side ────────────────────────────────────────────────────────────

/** OFFER a header region: register the container's DOM node for `region` on this pane. */
export function offerHeaderRegion(paneId: PaneId, region: string, el: HTMLElement): void {
  record(paneId).regions.set(region, el);
  notify(paneId);
}

/** WITHDRAW a header region (on the container's header unmount / re-key). */
export function withdrawHeaderRegion(paneId: PaneId, region: string): void {
  const o = paneHeaders.get(paneId);
  if (!o) return;
  o.regions.delete(region);
  o.claimed.delete(region);
  notify(paneId);
  gc(paneId);
}

/** Has an occupant claimed `region` on this pane? The container reads this to drop its own title. */
export function isHeaderRegionClaimed(paneId: PaneId, region: string): boolean {
  return paneHeaders.get(paneId)?.claimed.has(region) ?? false;
}

// ─── OCCUPANT side ───────────────────────────────────────────────────────────

/** The container's DOM node for `region` on this pane, or `null` when none is offered
 *  (the occupant then renders in its own body — render-resilient). A pure read. */
export function offeredHeaderRegion(paneId: PaneId, region: string): HTMLElement | null {
  return paneHeaders.get(paneId)?.regions.get(region) ?? null;
}

/** MARK a region claimed / released by the occupant, driving the container's title toggle.
 *  Marking a region with no offer is a no-op (nothing to draw into). */
export function setHeaderRegionClaimed(paneId: PaneId, region: string, claimed: boolean): void {
  const o = paneHeaders.get(paneId);
  if (!o) return;
  const had = o.claimed.has(region);
  if (claimed) o.claimed.add(region);
  else o.claimed.delete(region);
  if (o.claimed.has(region) !== had) {
    notify(paneId);
    if (!claimed) gc(paneId);
  }
}

// ─── SHARED ──────────────────────────────────────────────────────────────────

/** Subscribe to any offer/withdraw/claim change on this pane. Both sides use it to
 *  re-read (the container its `claimed` flag, the occupant its offered node). */
export function subscribeHeaderRegions(paneId: PaneId, cb: () => void): () => void {
  const o = record(paneId);
  o.subs.add(cb);
  return () => {
    o.subs.delete(cb);
    gc(paneId);
  };
}

/** The pane an element sits in: the nearest ancestor carrying `data-pane-id` (the same
 *  DOM anchor the portal layer owns). An occupant calls this on its own mount root to
 *  learn which pane's header it may contribute into, so no `paneId` crosses the mount
 *  contract. Returns `null` at the composition root (no enclosing pane). */
export function paneIdForElement(el: Element | null): PaneId | null {
  return el?.closest('[data-pane-id]')?.getAttribute('data-pane-id') ?? null;
}
