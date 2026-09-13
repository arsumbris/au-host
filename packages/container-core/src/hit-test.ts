/**
 * Resolve drop targets by walking registered container dialects under the cursor, deepest first.
 * Each container emits its own geometry; this layer collects and orders targets without knowing
 * container schemas. The caller can select the first target for deepest-wins behavior.
 */

import { contentDropTargets, dialectRegistry, dragStore } from './singletons.ts';
import { DATA_ATTR, type DragSource, type DropHit } from './types.ts';

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

/** Walk the ancestor chain at the cursor and resolve EVERY drop target,
 *  deepest-first: ask each registered container's dialect for its targets at the
 *  point. The overlay takes `[0]` for the live preview (deepest-wins). */
export function resolveTargetsAll(
  clientX: number,
  clientY: number,
  source: DragSource,
  doc: Document = document,
): DropHit[] {
  const el = doc.elementFromPoint(clientX, clientY);
  if (!el) return [];
  const point = { x: clientX, y: clientY };
  // The CONTENT this drag carries (opaque), so a content-destination's `accepts` can gate itself at
  // hit-test time. Read off the live store — a pane drag has none, so no content-destination ever offers.
  const content = dragStore.getState().drag?.content;
  const targets: DropHit[] = [];
  const seen = new Set<Element>();
  // DON'T OFFER a target INSIDE the dragged pane: a container cannot accept its own ancestor
  // (dropping it into a descendant would create a cycle and disconnect the subtree from root). The
  // dragged pane's own slot element wraps its whole subtree, so any container it contains is skipped.
  // The backstop in `applyStructural` still refuses such a drop if it somehow reaches commit; this
  // just removes the affordance so it is never offered. Best-effort: absent (a dragged tab has no
  // slot-rect, and a leaf can hold nothing anyway), nothing is suppressed.
  const draggedSlot = doc.querySelector(
    `[${DATA_ATTR.droptargetShape}="slot-rect"][${DATA_ATTR.droptargetId}="${cssEscape(source.localId)}"]`,
  );
  let cur: Element | null = el;
  while (cur) {
    if (draggedSlot && draggedSlot.contains(cur)) { cur = cur.parentElement; continue; }
    // CONTENT-DESTINATION at this depth (deepest-first): included ONLY if it accepts this drag. A refusing
    // surface (a folder over a pane drag — no `content`) offers nothing, so the container zone beneath it
    // wins deepest-wins. A folder row is deeper than its enclosing container slot, so for a CONTENT drag it
    // correctly wins; for a PANE drag it refuses and the container zone wins.
    const cds = contentDropTargets.get(cur);
    if (cds && cds.accepts(source, content)) {
      targets.push({ kind: 'content-dest', el: cur, spec: cds });
    }
    const dialect = dialectRegistry.get(cur);
    if (dialect && !seen.has(cur)) {
      seen.add(cur);
      targets.push(...dialect.resolveTargets(cur, point, source));
    }
    cur = cur.parentElement;
  }
  return targets;
}
