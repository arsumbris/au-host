/**
 * `useContainerDialect` — the React ergonomics for declaring a container's drop
 * `ContainerDialect` (target emission + drag behaviours) to the shared dialect
 * registry. The registry + the dialect-driven resolver (`resolveTargetsAll`) live
 * in `@arsumbris/container-core` (framework-agnostic, shared across bundles); this
 * hook just wires a container's root element in.
 *
 * A container declares BOTH its `ContainerPlacement` (via `useContainerPlacement`)
 * and its `ContainerDialect` on the SAME root element. Attach both with
 * `useMergedRef` so one `ref=` fires both stable callback refs.
 *
 *
 */

import { useCallback, useRef } from 'react';
import type { ContainerDialect } from '@arsumbris/au-host-sdk';
import { registerDialect, deregisterDialect, stableFacade } from '@arsumbris/container-core';

/**
 * A container declares its `ContainerDialect` to the drop resolver. Returns a
 * CALLBACK REF the container attaches to its root element.
 *
 * A callback ref (not a `useEffect` over a plain ref) is deliberate — the same
 * late-mounting-root lesson as `useContainerPlacement`: a container often renders
 * a loading/empty view before its real layout, so the root mounts after the first
 * commit. The callback ref fires exactly when the element mounts (even late) and
 * with `null` on unmount.
 *
 * It registers a STABLE façade delegating to the latest `dialect` via a ref, so a
 * dialect closing over live state can change identity every render without
 * re-registering. Same `stableFacade` as `useContainerPlacement` and
 * `attachContainer`, for the same reason.
 *
 * Forwarding by `get` keeps OPTIONALITY intact: an always-present `onDragOver`
 * wrapper around `?.()` would make every dialect appear to implement the member,
 * preventing the resolver's probe from distinguishing absence.
 */
export function useContainerDialect(dialect: ContainerDialect): (el: Element | null) => void {
  const latest = useRef(dialect);
  latest.current = dialect;
  const proxyRef = useRef<ContainerDialect | null>(null);
  if (proxyRef.current === null) {
    proxyRef.current = stableFacade(() => latest.current);
  }
  const registeredRef = useRef<Element | null>(null);
  return useCallback((el: Element | null): void => {
    const prev = registeredRef.current;
    if (prev && prev !== el) deregisterDialect(prev);
    registeredRef.current = el;
    if (el) registerDialect(el, proxyRef.current!);
  }, []);
}

/**
 * Compose several callback refs into ONE stable callback ref. A React element
 * takes a single `ref=`; a container that declares both a placement and a dialect
 * (each its own callback ref) merges them here. The merged callback is stable as
 * long as the input refs are stable (both hooks return `useCallback`-stable refs),
 * so it does not thrash register/deregister across renders.
 */
export function useMergedRef(
  ...refs: Array<((el: Element | null) => void) | null | undefined>
): (el: Element | null) => void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps ARE the (stable) refs
  return useCallback((el: Element | null): void => {
    for (const r of refs) r?.(el);
  }, refs);
}
