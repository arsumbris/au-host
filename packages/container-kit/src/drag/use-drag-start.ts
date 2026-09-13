/**
 * `useDragStart` — the React skin over container-core's `startDragGesture`. A pointer-down defers the
 * actual store `start` until the pointer crosses a small threshold, so a click on a header/tab isn't a
 * no-op drag. The gesture ITSELF (threshold, the fixed-slot seam check, DragSource assembly, the window
 * listener lifecycle) is framework-agnostic and lives in `container-core`; this hook only adapts React's
 * synthetic event to it and disposes the in-flight press if the component unmounts mid-press (a composition
 * switch, a pane removed under the press).
 *
 * A VANILLA container uses `startDragGesture` directly, so both skins are one mechanism (the source-side
 * peer of `attachContainer`'s receive side).
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { startDragGesture, type DragStartSpec } from '@arsumbris/container-core';

export type { DragStartSpec };

export function useDragStart(): (e: ReactPointerEvent, spec: DragStartSpec) => void {
  // Hold the active press's teardown, so an unmount BEFORE pointerup still removes the window listeners.
  const teardownRef = useRef<(() => void) | null>(null);
  useEffect(() => () => teardownRef.current?.(), []);
  return useCallback((e: ReactPointerEvent, spec: DragStartSpec) => {
    e.preventDefault();
    e.stopPropagation();
    teardownRef.current?.(); // dispose any prior press before starting a new one (idempotent)
    teardownRef.current = startDragGesture(spec, { x: e.clientX, y: e.clientY }, e.currentTarget as HTMLElement);
  }, []);
}
