/**
 * Global drag overlay. Mounted once per window by the HOST; renders a translucent
 * band over the resolved drop-target for the duration of any in-flight
 * cross-container drag.
 *
 * The overlay OWNS resolution: on pointermove it asks each container's dialect for
 * its targets (`resolveTargetsAll`) and previews the DEEPEST under the cursor;
 * pointer-up commits that hover to the router via `end()`. Deepest-wins-live, no
 * post-drop menu. Nested targets un-stack
 * SPATIALLY per container (bento's frame-inset), so there is NO Alt-walk-out and no
 * modifier. Sources only call `start()` on
 * pointerdown.
 *
 * It renders the generic drop-target SHAPES: `slot-rect` (a TBLRC band on a
 * content slot) and `gap` (an insertion bar in an ordered strip). `empty` /
 * `free-point` have no producer yet (added with the container that needs them).
 */

import { useEffect, useRef } from 'react';
import '@arsumbris/au-component-catalog/react';
import {
  DATA_ATTR,
  isContentDropHit,
  resolveTargetsAll,
  routeDropWithGrouping,
  type DragSource,
  type DropTarget,
  type DropTargetShape,
} from '@arsumbris/container-core';
import { useLayoutDrag } from './use-layout-drag';
import { mountContentDragPreview } from './content-drag-preview';

/** Mount once. While there's no in-flight drag, renders nothing.
 *
 *  Drop resolution is DEEPEST-WINS-LIVE: the hovered target
 *  is the deepest emitted under the cursor, previewed live and committed on
 *  release — no post-drop menu, no modifier. Each container's presentation (bento's
 *  frame-inset) makes the levels visible + pointable, so deepest-wins resolves
 *  nesting without any extra axis. */
export function DragOverlay() {
  const drag = useLayoutDrag((s) => s.drag);
  const setHover = useLayoutDrag((s) => s.setHover);
  const end = useLayoutDrag((s) => s.end);
  const cancel = useLayoutDrag((s) => s.cancel);
  const setOnDrop = useLayoutDrag((s) => s.setOnDrop);
  // The content drag preview draws into THIS per-window layer, never a `document.body` self-portal:
  // the overlay owns its own above-composition surface. Always rendered (inert while idle) so the
  // preview's fly-to-source exit animation outlives the drag without the layer unmounting under it.
  const previewLayer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (drag?.content !== undefined && previewLayer.current) return mountContentDragPreview(drag, previewLayer.current);
  }, [drag?.source]);

  // Install the fan-out drop router as the store's drop handler (once). The
  // router reaches each container's self-declared ContainerPlacement. The
  // grouping-aware wrapper is used so an AMBIGUOUS center-wrap asks the host
  // chooser (installed via `setGroupingChooser`) before the synchronous route,
  // rather than silently picking the name-sorted default.
  useEffect(() => {
    setOnDrop(routeDropWithGrouping);
    return () => setOnDrop(null);
  }, [setOnDrop]);

  // Run while a drag is active: track pointer moves, resolve the DEEPEST target
  // across containers, push it as the hover. Pointer-up commits it (`end`).
  useEffect(() => {
    if (!drag) return;
    // `source` is fixed for the lifetime of ONE drag; capture it once and key the
    // effect on it (depending on the whole `drag` re-bound the listeners per hover).
    const { source } = drag;

    let pointer: { x: number; y: number } | null = null;
    const scrollRoots = new Set<EventTarget>();
    let hoveredStrip: TabStripGeometry | null = null;
    const refresh = () => {
      if (!pointer) return;
      const target = resolveTargetsAll(pointer.x, pointer.y, source)[0] ?? null;
      const strip = target && !isContentDropHit(target) && target.shape === 'gap'
        ? findDroptarget('gap', target.slotId) : null;
      hoveredStrip = strip ? findTabGeometry(strip) : null;
      setHover(target);
    };
    const onMove = (ev: PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      // Scroll is neither bubbling nor composed. A tab track lives inside a
      // shadow root, so window capture alone misses wheel/keyboard scrolling.
      for (const node of ev.composedPath()) {
        if (node instanceof ShadowRoot && !scrollRoots.has(node)) {
          scrollRoots.add(node);
          node.addEventListener('scroll', refresh, true);
        }
      }
      refresh();
    };
    const onUp = (ev: PointerEvent) => {
      // Release may precede a queued scroll/resize event. Resolve against the
      // actual release geometry before committing through the existing router.
      pointer = { x: ev.clientX, y: ev.clientY };
      refresh();
      end();
    };
    const onCancel = () => cancel();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') cancel();
    };
    let frame = 0;
    let previousTime = performance.now();
    const scrollFrame = (time: number) => {
      if (pointer && hoveredStrip?.scrollDragEdge?.(pointer.x, pointer.y, time - previousTime)) refresh();
      previousTime = time;
      frame = requestAnimationFrame(scrollFrame);
    };
    frame = requestAnimationFrame(scrollFrame);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    window.addEventListener('blur', onCancel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', refresh, true);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('blur', onCancel);
      for (const root of scrollRoots) root.removeEventListener('scroll', refresh, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind once per drag (source is stable), not per hover
  }, [drag?.source, setHover, end, cancel]);

  // A content-destination (a folder) draws its OWN highlight by observing the drag store; the generic
  // overlay renders only container-zone shapes. So skip a content-dest hit here.
  const zone = !drag || !drag.hover || isContentDropHit(drag.hover)
    ? null
    : <DropPreview target={drag.hover} source={drag.source} />;
  return (
    <>
      <div ref={previewLayer} aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 'var(--au-z-tooltip)' }} />
      {zone}
    </>
  );
}

function DropPreview({ target, source }: { target: DropTarget; source: DragSource }) {
  return (
    <>
      {/* slot-rect: the landing indicator (receiver frame + the sliding band), one docked overlay.
       *  KEYED by slotId so the band GLIDES between zones within a slot but does not fly across slots. */}
      {target.shape === 'slot-rect' && <SlotDropZone key={target.slotId} target={target} source={source} />}
      {/* gap: a container frame + the tab-strip insertion bar. */}
      {target.shape === 'gap' && (
        <>
          <ReceiverOutline target={target} />
          <GapInsertionBar target={target} source={source} />
        </>
      )}
      {/* empty / free-point: no producer yet — a preview lands with that container. */}
    </>
  );
}

/** A tinted-ink helper for the whole drag layer: `color-mix` of the neutral ink token at `pct` opacity,
 *  so the affordances are monochrome + theme-aware, never a hardcoded blue. */
const INK = (pct: number): string => `color-mix(in oklab, var(--au-ink-1) ${pct}%, transparent)`;

/** Frame the container that receives a tab-strip `gap` drop — a hairline ink ring beneath the insertion
 *  bar. Slot-rect targets use SlotDropZone instead. */
function ReceiverOutline({ target }: { target: Extract<DropTarget, { shape: 'gap' }> }) {
  const strip = findDroptarget('gap', target.slotId);
  // The strip is a thin bar; frame the whole container it belongs to instead.
  const el = (strip?.closest('[data-layout-container-slot]') as HTMLElement | null) ?? strip;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return (
    <div
      style={{
        position: 'fixed',
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        borderRadius: 'var(--au-radius-md)',
        boxShadow: `inset 0 0 0 1px ${INK(24)}`,
        background: INK(3),
        pointerEvents: 'none',
        boxSizing: 'border-box',
        zIndex: 998,
      }}
    />
  );
}

/** The shared component paints the outcome, independently of the dialect's hit
 * band. Bento creates equal splits; Column's insertion size remains an estimate
 * using its emitted band. No placement decision is made by this presentation. */
function SlotDropZone({ target, source }: {
  target: Extract<DropTarget, { shape: 'slot-rect' }>;
  source: DragSource;
}) {
  const el = findDroptarget('slot-rect', target.slotId);
  if (!el || !target.band) return null;
  const r = el.getBoundingClientRect();
  const receiver = el.getAttribute('aria-label');
  const action = target.zone === 'center'
    ? target.containerKind === 'tabs'
      ? `Add tab${receiver ? ` beside ${receiver}` : ''}`
      : 'Group here'
    : target.containerKind === 'column'
      ? target.zone === 'top' ? 'Insert above' : 'Insert below'
      : `Split ${target.zone === 'top' ? 'above' : target.zone === 'bottom' ? 'below' : target.zone}`;
  const ratio = target.containerKind === 'bento' ? 0.5
    : target.zone === 'left' || target.zone === 'right' ? target.band.w : target.band.h;
  return <au-drop-zone
    zone={target.zone}
    edgeRatio={ratio}
    data-drag-landing=""
    style={{ position: 'fixed', inset: 'auto', left: r.left, top: r.top,
      width: r.width, height: r.height, zIndex: 999 }}
  >{source.label} — {action}</au-drop-zone>;
}

/** The cell-geometry contract a composed tab strip exposes (its cells live in the strip's shadow root, so
 *  the overlay reads their screen rects through this instead of light-DOM `[data-tab-id]`). Duck-typed, so
 *  container-kit stays decoupled from any specific element (the au-tab-bar contract). */
interface TabStripGeometry {
  tabCellRects(): { id: string; left: number; width: number }[];
  tabTrackRect?(): DOMRect | null;
  scrollDragEdge?(clientX: number, clientY: number, elapsedMs: number): boolean;
}
function findTabGeometry(strip: HTMLElement): TabStripGeometry | null {
  for (const child of Array.from(strip.children)) {
    if (typeof (child as unknown as TabStripGeometry).tabCellRects === 'function') {
      return child as unknown as TabStripGeometry;
    }
  }
  return null;
}

function GapInsertionBar({ target, source }: { target: Extract<DropTarget, { shape: 'gap' }>; source: DragSource }) {
  const stripEl = findDroptarget('gap', target.slotId);
  if (!stripEl) return null;
  // Cell rects, in visual order. A COMPOSED strip (<au-tab-bar>) keeps its cells in a shadow root, so read
  // the geometry contract when present; else the light-DOM `[data-tab-id]` cells (a hand-rolled strip).
  const geom = findTabGeometry(stripEl);
  const bounds: { left: number; right: number }[] = geom
    ? geom.tabCellRects().map((c) => ({ left: c.left, right: c.left + c.width }))
    : Array.from(stripEl.querySelectorAll<HTMLElement>('[data-tab-id]')).map((el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right };
      });
  const r = geom?.tabTrackRect?.() ?? stripEl.getBoundingClientRect();
  const vi = target.visualIndex ?? target.index;
  let x: number;
  if (vi >= bounds.length) {
    x = bounds.length === 0 ? r.left : bounds[bounds.length - 1]!.right;
  } else {
    x = bounds[vi]!.left;
  }
  return (
    <>
    <div
      style={{
        position: 'fixed',
        left: Math.max(r.left, Math.min(r.right - 2, x - 1)),
        top: r.top + 2,
        width: 2,
        height: r.height - 4,
        background: 'var(--au-ink-1)',
        boxShadow: `0 0 4px ${INK(45)}`,
        pointerEvents: 'none',
        zIndex: 999,
      }}
    />
    <au-pill draft style={{ position: 'fixed',
      left: Math.max(8, Math.min(innerWidth - 240, x)), top: r.bottom + 8,
      maxWidth: 'min(232px, calc(100vw - 16px))', overflow: 'hidden',
      pointerEvents: 'none', zIndex: 999,
      borderRadius: 'var(--au-radius-sm)', padding: 'var(--au-space-1) var(--au-space-2)',
      fontSize: 'var(--au-t-xs)', lineHeight: 'var(--au-lh-xs)',
      background: 'var(--au-elev-4-fill)', boxShadow: 'var(--au-elev-4-line)',
      color: 'var(--au-ink-2)' }}>
      {source.label} — Insert tab here
    </au-pill>
    </>
  );
}

function findDroptarget(shape: DropTargetShape, id: string): HTMLElement | null {
  return document.querySelector(
    `[${DATA_ATTR.droptargetShape}="${shape}"][${DATA_ATTR.droptargetId}="${cssEscape(id)}"]`,
  ) as HTMLElement | null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
