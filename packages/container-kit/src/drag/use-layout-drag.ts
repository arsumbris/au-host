/**
 * React binding for the shared drag store. `useLayoutDrag(selector)` subscribes
 * a component to the ONE window-shared store (`dragStore` from container-core),
 * so projection sources and the host-mounted overlay
 * read/write the same in-flight drag.
 *
 * `useStore` binds a vanilla store through `useSyncExternalStore`, and only
 * relies on the store's `subscribe`/`getState` interface — so this projection's
 * React copy binding a store created by the host's container-core copy is fine
 * (the store is a plain interface object, not React-version-coupled).
 */

import { useStore } from 'zustand';
import { dragStore, type LayoutDragStore } from '@arsumbris/container-core';

export function useLayoutDrag<T>(selector: (s: LayoutDragStore) => T): T {
  return useStore(dragStore, selector);
}
