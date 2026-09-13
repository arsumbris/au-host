/**
 * `useContainerPlacement` — the React ergonomics for declaring a container's
 * `ContainerPlacement` to the shared router. The registry + the fan-out
 * `routeDrop` live in `@arsumbris/container-core` (framework-agnostic, shared
 * across bundles); this hook just wires a container's root element in.
 *
 *
 */

import { useCallback, useRef } from 'react';
import type { ContainerPlacement } from '@arsumbris/au-host-sdk';
import { registerContainer, deregisterContainer, stableFacade } from '@arsumbris/container-core';

/**
 * Declare a ContainerPlacement through a callback ref attached to the container root.
 * The callback registers when the element mounts, including a root rendered after a loading state,
 * and unregisters on unmount. A stableFacade delegates every member to the current placement,
 * so React and vanilla containers expose the same seam without re-registering on each render.
 */
export function useContainerPlacement(placement: ContainerPlacement): (el: Element | null) => void {
  const latest = useRef(placement);
  latest.current = placement;
  const proxyRef = useRef<ContainerPlacement | null>(null);
  if (proxyRef.current === null) {
    proxyRef.current = stableFacade(() => latest.current);
  }
  const registeredRef = useRef<Element | null>(null);
  return useCallback((el: Element | null): void => {
    const prev = registeredRef.current;
    if (prev && prev !== el) deregisterContainer(prev);
    registeredRef.current = el;
    if (el) registerContainer(el, proxyRef.current!);
  }, []);
}
