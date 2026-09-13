/**
 * Public barrel for the drag protocol as container-kit exposes it: the
 * framework-agnostic core (types, zones, hit-test, the shared store, the router)
 * re-exported from `@arsumbris/container-core`, plus the React bindings that
 * live here (the `useLayoutDrag` hook, the `DragOverlay`).
 *
 *
 */

// The framework-agnostic protocol (shared across bundles via a window singleton).
export * from '@arsumbris/container-core';

// React bindings owned here.
export { useLayoutDrag } from './use-layout-drag';
export { useDragStart, type DragStartSpec } from './use-drag-start';
export { DragOverlay } from './DragOverlay';
