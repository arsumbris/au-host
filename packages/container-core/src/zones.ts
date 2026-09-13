/**
 * Pure zone-computation helpers used by the hit-tester. Each function
 * takes the relevant DOM rect (or element) plus the cursor position and
 * returns the zone / insertion index. No React, no state.
 */

import type { BandFrac, DropZone } from '@arsumbris/au-host-sdk';

/**
 * EDGE BAND GEOMETRY — a PIXEL budget, capped, NOT a raw fraction of the rect.
 *
 * Fitts's law is about ABSOLUTE target width: the gesture is "flick roughly this many pixels toward the
 * edge". A pure fraction re-scales that target with the pane, so a wide pane and a narrow rail become
 * different gestures and the muscle memory built in one misleads in the other. Capping the dimension the
 * fraction is taken OF keeps the band proportional while small and pixel-constant once large.
 */
const EDGE_BAND = 0.25;
/** Cap the dimension the fraction is taken OF. Past this, the band stops growing and is pixel-constant. */
const REF_DIM = 500;
/** Floor, so a very small pane still offers a graspable edge (WCAG 2.5.8 wants >=24px pointer targets). */
const MIN_BAND_PX = 24;
/** The centre ("add as a tab") is the COMMON case and must never be squeezed out by two edge bands.
 *  On a small or deeply-nested rect the bands shrink to protect it. */
const MIN_CENTER_PX = 48;

/**
 * The edge-band thickness in pixels for a rect dimension. EXPORTED as the one definition of "how close
 * to an edge counts", so a nested container and its parent agree instead of drifting.
 */
export function edgeBandPx(dim: number): number {
  const band = Math.max(MIN_BAND_PX, EDGE_BAND * Math.min(dim, REF_DIM));
  // Two bands plus a usable centre must fit; if not, the centre wins (joining a tab group is far more
  // common than splitting, so it is the target we protect).
  const maxBand = Math.max(0, (dim - MIN_CENTER_PX) / 2);
  return Math.min(band, maxBand);
}

/**
 * Compute the TBLRC zone of a rect at the cursor.
 *
 * Corners resolve to the NEAREST edge (each axis normalised by its OWN band), not by a fixed axis
 * precedence — so left/right stay reachable at a corner, and a non-square rect (a small vertical band on
 * a wide pane) does not let top/bottom win almost everywhere near a corner.
 */
export function computeRectZone(rect: DOMRect, clientX: number, clientY: number): DropZone {
  const bandX = edgeBandPx(rect.width);
  const bandY = edgeBandPx(rect.height);
  const dLeft = clientX - rect.left;
  const dRight = rect.right - clientX;
  const dTop = clientY - rect.top;
  const dBottom = rect.bottom - clientY;
  // Inside the centre box on both axes -> centre. Checked first so the common target is one cheap test.
  if (dLeft >= bandX && dRight >= bandX && dTop >= bandY && dBottom >= bandY) return 'center';
  const candidates: [DropZone, number][] = [
    ['left', bandX > 0 ? dLeft / bandX : Infinity],
    ['right', bandX > 0 ? dRight / bandX : Infinity],
    ['top', bandY > 0 ? dTop / bandY : Infinity],
    ['bottom', bandY > 0 ? dBottom / bandY : Infinity],
  ];
  let best: DropZone = 'center';
  let bestScore = Infinity;
  for (const [zone, score] of candidates) {
    if (score < bestScore) {
      bestScore = score;
      best = zone;
    }
  }
  return best;
}

/**
 * The highlight region for a TBLRC zone under the `edgeBandPx` basis, as fractions of the rect — the
 * band the overlay draws. Computed from the SAME `edgeBandPx` `computeRectZone` uses, so the paint
 * cannot disagree with the hit-test. `center` is the protected inner box (the rect minus both edge bands).
 */
export function bandFracFor(rect: DOMRect, zone: DropZone): BandFrac {
  const fx = rect.width > 0 ? edgeBandPx(rect.width) / rect.width : EDGE_BAND;
  const fy = rect.height > 0 ? edgeBandPx(rect.height) / rect.height : EDGE_BAND;
  switch (zone) {
    case 'top':
      return { x: 0, y: 0, w: 1, h: fy };
    case 'bottom':
      return { x: 0, y: 1 - fy, w: 1, h: fy };
    case 'left':
      return { x: 0, y: 0, w: fx, h: 1 };
    case 'right':
      return { x: 1 - fx, y: 0, w: fx, h: 1 };
    case 'center':
      return { x: fx, y: fy, w: 1 - 2 * fx, h: 1 - 2 * fy };
  }
}

/** The "add here" centre-box band for a container with NO split of its own (tabs / sandwich): a fixed
 *  central region, no rect needed. `center` there means "join this slot", not "split at the middle". */
export const CENTER_BAND: BandFrac = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

/** Compute the insertion index into a horizontal strip of children at the
 *  cursor X. Index 0 = before all children; `children.length` = after all.
 *  Pure: only reads the child rects. */
export function computeHorizontalInsertIndex(
  childRects: { left: number; width: number }[],
  clientX: number,
): number {
  for (let i = 0; i < childRects.length; i++) {
    const r = childRects[i]!;
    if (clientX < r.left + r.width / 2) return i;
  }
  return childRects.length;
}

/** Translate a visual insertion index (in the pre-removal strip) into a
 *  logical insertion index (in the post-removal strip). When the source
 *  is being dragged from within the same strip and its current position
 *  is before the visual drop, the logical index shifts down by one.
 *  Matches the bento + strip reorder logic. */
export function visualToLogicalIndex(
  visualIndex: number,
  sourceIndex: number,
): number {
  if (sourceIndex < 0 || sourceIndex >= visualIndex) return visualIndex;
  return visualIndex - 1;
}
