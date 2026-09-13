/**
 * React ergonomics over the container-core PANE-HEADER CONTRIBUTION seam.
 *
 * The mechanism (see `container-core/src/pane-header.ts`): a container OFFERS a
 * header region (a DOM node in its own bar); an OCCUPANT claims it and draws into
 * it, so a `tabs` occupant's strip shares ONE bar with the grip + actions. Both
 * sides subscribe to the same per-pane record via `useSyncExternalStore`.
 *
 * - CONTAINER: `useOfferedHeaderRegion(paneId)` → a `ref` for the region node
 *   (offered on mount, withdrawn on unmount) + `claimed`, true once an occupant
 *   draws into it, so the container drops its own title.
 * - OCCUPANT: `useHeaderContribution(paneId)` → the container's region node to
 *   `createPortal` into, or `null` (render in the occupant's own body — fallback).
 *   The occupant resolves `paneId` from its mount `container` via `paneIdForElement`.
 *
 *
 */

import { useCallback, useLayoutEffect, useState, useRef, useSyncExternalStore, type RefObject } from 'react'
import type { PaneId } from '@arsumbris/au-host-sdk'
import {
  offerHeaderRegion,
  withdrawHeaderRegion,
  isHeaderRegionClaimed,
  offeredHeaderRegion,
  setHeaderRegionClaimed,
  subscribeHeaderRegions,
  paneIdForElement,
} from '@arsumbris/container-core'

/** A subscribe that never fires, for the no-pane case (an occupant at the composition root). */
const emptySubscribe = (): (() => void) => () => {}

/**
 * The pane an occupant sits in (its enclosing `data-pane-id`), resolved from the occupant's own root
 * element. STABLE once resolved: an occupant is always inside its own content anchor, and a re-parent
 * moves that anchor WITH it, so the enclosing id never changes. Under the PORTAL layer the pane is
 * mounted flat and re-parented into its anchor a beat later, so the first read can be `null` — a
 * MutationObserver waits for that placement, resolves once, and disconnects (no polling). An occupant
 * passes this into `useHeaderContribution`.
 */
export function useEnclosingPaneId(el: Element | null): PaneId | null {
  const [paneId, setPaneId] = useState<PaneId | null>(() => paneIdForElement(el))
  useLayoutEffect(() => {
    if (!el) return
    const resolve = (): boolean => {
      const id = paneIdForElement(el)
      if (id) {
        setPaneId(id)
        return true
      }
      return false
    }
    if (resolve()) return
    // Not yet placed (portal layer). Watch for the re-parent, resolve once, stop.
    const obs = new MutationObserver(() => {
      if (resolve()) {
        obs.disconnect()
        clearTimeout(deadline)
      }
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })
    // The portal re-parent lands within a frame or two. If no enclosing pane appears in a generous
    // window, this occupant is mounted OUTSIDE any pane (detached window / composition root) and never
    // will — stop watching, so we don't run a `closest()` walk on every document mutation for the
    // component's whole life. The occupant then renders its header in its own body (render-resilient).
    const deadline = setTimeout(() => obs.disconnect(), 4000)
    return () => {
      obs.disconnect()
      clearTimeout(deadline)
    }
  }, [el])
  return paneId
}

/**
 * CONTAINER side. Attach `ref` to the header's region node; it is OFFERED while mounted.
 * `claimed` re-renders the container true/false as an occupant takes / releases the region,
 * so the container renders its title only while `!claimed`.
 */
export function useOfferedHeaderRegion(
  paneId: PaneId | null,
  region = 'center',
): { ref: RefObject<HTMLDivElement | null>; claimed: boolean } {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !paneId) return
    offerHeaderRegion(paneId, region, el)
    return () => withdrawHeaderRegion(paneId, region)
  }, [paneId, region])

  const subscribe = useCallback(
    (cb: () => void) => (paneId ? subscribeHeaderRegions(paneId, cb) : emptySubscribe()),
    [paneId],
  )
  const claimed = useSyncExternalStore(
    subscribe,
    () => (paneId ? isHeaderRegionClaimed(paneId, region) : false),
  )
  return { ref, claimed }
}

/**
 * OCCUPANT side. Returns the container's offered region node to `createPortal` into, or `null`
 * when no region is offered (the occupant then renders in its own body). While a node is returned
 * the region is marked CLAIMED, so the container drops its title.
 */
export function useHeaderContribution(paneId: PaneId | null, region = 'center'): HTMLElement | null {
  const subscribe = useCallback(
    (cb: () => void) => (paneId ? subscribeHeaderRegions(paneId, cb) : emptySubscribe()),
    [paneId],
  )
  const target = useSyncExternalStore(
    subscribe,
    () => (paneId ? offeredHeaderRegion(paneId, region) : null),
  )
  useLayoutEffect(() => {
    if (!paneId || !target) return
    setHeaderRegionClaimed(paneId, region, true)
    return () => setHeaderRegionClaimed(paneId, region, false)
  }, [paneId, region, target])
  return target
}
