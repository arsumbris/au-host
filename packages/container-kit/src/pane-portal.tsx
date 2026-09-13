/**
 * THE PORTAL LAYER — React wrappers over the framework-agnostic registry in container-core.
 *
 * The mechanism (see `container-core/src/pane-portal.ts`): every pooled pane is mounted ONCE into a
 * stable host element no render tree owns, and that element is `appendChild`-ed into whatever slot
 * ANCHOR currently claims it. A move re-points the pool → a different anchor claims the pane → the
 * coordinator relocates the SAME live element. The pane's mount never tears down, so a running terminal
 * / cursor survives and React can never `removeChild` the pane's live DOM (the crash this layer kills).
 *
 * Here: `PaneHost` (the flat mounter, one per pool record, rendered by the kernel's `PanePortalLayer`),
 * `usePaneAnchor` (a container's slot-target ref), and `PanePortalLayer` (the flat set). The registry,
 * the coordinator, and the vanilla anchor register/unregister (for dock) live in container-core.
 *
 *

 */

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import type { MountHost, PaneId } from '@arsumbris/au-host-sdk'
import { recordMountType, event, on } from '@arsumbris/au-host-sdk'

/** The `file` a leaf record opens, for the `portal` trace (why a pane's contentKey moved). Best-effort. */
function recordFile(record: unknown): string | undefined {
  const f = record != null && typeof record === 'object' ? (record as { file?: unknown }).file : undefined
  return typeof f === 'string' ? f : undefined
}

import {
  mountChild,
  registerPaneHost,
  unregisterPaneHost,
  type ChildMount,
  type PortalRegistry,
} from '@arsumbris/container-core'

/**
 * A ref a container attaches to the empty target div for one child position. THE ANCHOR IS THE DOM
 * ELEMENT carrying `data-pane-id`: the single host-owned observer (container-core
 * `installPaneAnchorObserver`) derives placement from that attribute, so anchoring is just "set the
 * attribute, clear it on teardown". No imperative registration — a React anchor and a vanilla one
 * (dock's `mountChild`) do the identical act at the identical cost.
 *
 * A layout-effect (not a ref callback) so the element is captured and cleared as one pair: a ref
 * callback receives `null` on unmount, with no handle to the element that was tagged. Some callers
 * (`PaneProjection`) also set the attribute in JSX, the same value — harmless; the ROOT anchor
 * (`PortalRootAnchor`) does not, so this is what makes every React anchor visible to the observer.
 *
 */
export function usePaneAnchor(paneId: PaneId): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.setAttribute('data-pane-id', paneId)
    return () => el.removeAttribute('data-pane-id')
  }, [paneId])
  return ref
}

/**
 * Mounts one pool record's projection ONCE into a stable host element (via `mountChild`, so a duplicate
 * placeholder record renders the diagnostic pane and a mount failure renders its error, exactly as the
 * in-tree path does) and portals it into whatever anchor claims `paneId`. Renders NOTHING into React.
 *
 * `contentKey` triggers a remount when the record's OWN content changes; a container whose child
 * references re-pointed re-renders its anchors, while a leaf whose config is unchanged keeps running
 * across a move (its `contentKey` is stable, so its mount is never torn down). The record is resolved
 * FRESH from the host pool by `mountChild`, so it is always the authoritative current value.
 */
export function PaneHost({
  host,
  registry,
  paneId,
  contentKey,
}: {
  host: MountHost
  /** The per-runtime portal registry this composition mount owns. Threaded from `PanePortalLayer`,
   *  and in the effect deps so a composition SWITCH that reuses a pane `^:` re-registers into the new
   *  generation's registry rather than the disposed one. */
  registry: PortalRegistry
  paneId: PaneId
  /** A stable digest of this record's own content; a change remounts, an equal value does not. */
  contentKey: string
}): ReactNode {
  useLayoutEffect(() => {
    const el = document.createElement('div')
    // FILL THE ANCHOR. The host element is what a portaled child mounts into and what the coordinator
    // places into a container's slot — so it must fill that slot, or slot-targeted sizing (a dock edge's
    // `width:100%`) never reaches the child and the child renders content-sized. Both axes, always: a
    // portaled child fills its anchor exactly as a directly-mounted one fills its slot.
    el.style.width = '100%'
    el.style.height = '100%'
    // Provide scrolling for projections that do not manage their own scroll surface. Containers clip
    // their children, so the pane host must scroll overflowing content. A child that fills the host and
    // manages its own scrolling, such as the editor or terminal, does not overflow this wrapper.
    el.style.overflow = 'auto'
    el.setAttribute('data-pane-host', paneId)
    // DOM focus supplies both focus recency and the active-pane ring.
    // Make the pane content host focusable so EVERY pane interaction produces DOM focus, not only a click
    // that happens to hit a focusable child. `tabindex=-1`: programmatically focusable, out of the Tab
    // order. On `mousedown`, after the native focus settles (a microtask, so it runs after the default
    // action moved focus), if focus did NOT land inside this pane — a click on non-focusable content — focus
    // the host, firing the `focusin` the tracker observes. A click that focuses a child (an editor textarea)
    // already landed inside, so this no-ops and never steals the child's focus.
    el.tabIndex = -1
    el.style.outline = 'none' // structural focus, never a visible ring
    const onMouseDown = (): void => {
      queueMicrotask(() => {
        if (!el.contains(document.activeElement)) el.focus({ preventScroll: true })
      })
    }
    el.addEventListener('mousedown', onMouseDown)

    let child: ChildMount | undefined
    let mounted = false
    // DEFERRED MOUNT: mount only once `el` is in a real anchor (attached + sized). A projection must
    // mount into a visible element — xterm measures its container at `open()`, and mounted parked at
    // 0×0 it renders empty or mis-fit. `registerPaneHost` fires this when the container's anchor claims
    // the host; idempotent, so a re-anchor (a move) is a no-op and the pane keeps its live state.
    const mount = (): void => {
      if (mounted) return
      // Resolve FRESH from the pool; `mountChild` mounts a real record, renders the duplicate
      // placeholder for a synthetic one, and the mount error for a bad one — one path for all.
      const record = host.children.pool?.resolveRecord(paneId)
      // `recordMountType`, not `record.type` directly: a MIXIN-typed record (a root `[dock, intent-routing]`)
      // has `type` as an ARRAY, so a `typeof === 'string'` guard would reject it and the container would
      // never mount (the blank-composition bug). This returns the projection base to mount.
      const mountType = recordMountType(record)
      // Set mounted only after resolving the record successfully. A pool can be temporarily unavailable
      // during StrictMode cleanup or while references settle; leave the latch clear so reconciliation retries.
      if (!mountType) return
      mounted = true
      // A pane MOUNTS (or REMOUNTS on a contentKey change). The trace shows an unmount(key=A) immediately
      // followed by a mount(key=B) for the same pane as a remount, and the `file` says what it re-seeded to
      // — the diagnostic for "a sibling edit remounted my editor to a stale/empty record".
      if (on('portal')) event('portal', 'pane-mount', { paneId, contentKey, type: mountType, file: recordFile(record) })
      // `flatMount`: this IS the portal host, so mount for real (a container mounting a child anchors
      // instead). A container it mounts then renders ANCHORS for ITS children in turn.
      child = mountChild(host, el, { id: mountType, config: record, paneId, flatMount: true })
    }
    registerPaneHost(registry, paneId, el, mount)

    return () => {
      if (mounted && on('portal')) event('portal', 'pane-unmount', { paneId, contentKey })
      el.removeEventListener('mousedown', onMouseDown)
      child?.unmount()
      unregisterPaneHost(registry, paneId, el)
      el.remove()
    }
  }, [host, registry, paneId, contentKey])

  return null
}

/**
 * The flat set of pane hosts at the composition root: one `PaneHost` per pool record. Rendered by the
 * kernel over the runtime's authoritative pool; re-rendered when the pool changes (a record added,
 * removed, or re-pointed). Because each host is keyed by its `^:`, a move never re-creates one — only
 * its anchor changes, and the coordinator relocates the live element.
 */
export function PanePortalLayer({
  host,
  registry,
  records,
}: {
  host: MountHost
  /** The per-runtime portal registry, created by the kernel and drilled into each `PaneHost`. */
  registry: PortalRegistry
  /** Every pool record, each with its id and a content digest for selective remount. */
  records: ReadonlyArray<{ id: PaneId; contentKey: string }>
}): ReactNode {
  return records.map((r) => (
    <PaneHost key={r.id} host={host} registry={registry} paneId={r.id} contentKey={r.contentKey} />
  ))
}
