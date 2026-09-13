/**
 * `startDragGesture` — the framework-agnostic drag-INITIATION gesture. A container calls it from its own
 * pointerdown (a grip / tab / header) to begin a threshold-deferred drag: the store `start` is deferred
 * until the pointer crosses a small threshold, so a click is not a no-op drag; the fixed-slot seam is
 * checked AT the threshold (a refused drag stays an ordinary click); the `DragSource` is assembled; and the
 * window listener lifecycle is managed. Returns a disposer that removes the listeners — call it if the source
 * unmounts BEFORE pointerup (a composition switch, a pane removed mid-press).
 *
 * This is the SOURCE half of the drag protocol, the peer of `attachContainer`'s RECEIVE half — both vanilla,
 * both in container-core, so a non-React container sources a drag with the same vocabulary and at the same
 * cost as a React one. The React `useDragStart` hook (container-kit) is a thin skin over this: it extracts
 * the coordinates + element from its synthetic event and holds the disposer against unmount.
 */

import { dragStartRefused } from './slots.ts';
import { dragStore } from './singletons.ts';
import type { DragContent, DragSource, DragSourceRole } from './types.ts';

/** Pixels the pointer must travel before a press becomes a drag (below this, it stays a click). */
export const DRAG_THRESHOLD_PX = 5;

/** What a container knows about the dragged pane/tab/group before the threshold. */
export interface DragStartSpec {
  /** The owning container's kind (`bento` / `tabs` / …). */
  containerKind: string;
  /** The addressable local id (a leaf id, a tab id, a group id). */
  localId: string;
  role: DragSourceRole;
  label: string;
  /** The dragged projection's TYPE NAME, so a TARGET container can decide whether it will hold it.
   *  Optional for source containers not yet updated; see `DragSource.type`. */
  type?: string;
  /** The CONTENT this drag carries, when the source is NOT a mounted pane (a file-tree row's file
   *  selection). Its PRESENCE makes the drop MINT a pane (or hand off to a content-destination) rather
   *  than MOVE the pane `localId` names. Opaque; the host-installed resolver narrows it. See
   *  {@link DragContent}. A pane/tab source omits it. */
  content?: DragContent;
  /** Called ONCE, when the press crosses the drag threshold and becomes a real drag (not a click). A
   *  source uses it to suppress the click that would otherwise ALSO fire on pointerup — e.g. a file-tree
   *  row's open. A press that stays under the threshold is a click and never calls this. */
  onDragStart?: () => void;
}

/**
 * Begin a drag gesture from a pointerdown at `from`, sourced from `sourceEl`. The CALLER owns its event
 * (it does `preventDefault` / `stopPropagation` and passes the start coordinates + element) — so this stays
 * event-type-agnostic and directly testable. Returns the teardown disposer.
 */
export function startDragGesture(spec: DragStartSpec, from: { x: number; y: number }, sourceEl: HTMLElement): () => void {
  let started = false;
  const onMove = (ev: PointerEvent): void => {
    if (started) return;
    const dx = ev.clientX - from.x;
    const dy = ev.clientY - from.y;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    // SEAM 1 of the slot rules — a fixed slot's occupant is not a drag source. Checked at the THRESHOLD,
    // not at pointer-down, so a refused drag still behaves as an ordinary click. `started` is set either
    // way: a refusal must end this press, not re-ask on every pixel.
    started = true;
    if (dragStartRefused(sourceEl, spec.localId)) return;
    const source: DragSource = {
      containerKind: spec.containerKind,
      localId: spec.localId,
      role: spec.role,
      label: spec.label,
      ...(spec.type === undefined ? {} : { type: spec.type }),
    };
    // `content` rides the drag STATE (not the DragSource, which is the mount contract). Its presence flips
    // the router into the content branch; absent, this is an ordinary pane drag.
    dragStore.getState().start(source, { x: from.x, y: from.y }, sourceEl, spec.content);
    // Threshold crossed → a real drag. Tell the source so it can suppress the click that also fires on up.
    spec.onDragStart?.();
  };
  const teardown = (): void => {
    // Idempotent: removeEventListener on an already-removed handler is a no-op, so a caller may dispose after
    // the press already ended (the pointerup path below) with no harm. Threshold never crossed → a click,
    // nothing to undo; crossed → the global overlay's pointerup already fired `end()`.
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  const onUp = (): void => teardown();
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  return teardown;
}
