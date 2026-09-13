/**
 * Framework-agnostic cross-container drag protocol. The shared window singleton holds the drag
 * store, placement registry and target geometry; container-kit supplies React bindings.
 *
 * au-host-sdk owns the generic DropTarget and ContainerKind vocabulary. Targets describe slot-rect,
 * gap, empty or free-point geometry with an owning container. Sources identify pane or tab drags.
 * Container elements expose data-layout-container-slot; targets expose data-droptarget-shape,
 * data-container-kind and data-droptarget-id for DOM-based resolution.
 */

import type {
  ContainerDialect,
  ContainerKind,
  DragPoint,
  DragSource,
  DragSourceRole,
  DropTarget,
  DropZone,
  BandFrac,
  PaneId,
} from '@arsumbris/au-host-sdk';
export type {
  ContainerDialect,
  ContainerKind,
  DragPoint,
  DragSource,
  DragSourceRole,
  DropTarget,
  DropZone,
  BandFrac,
  PaneId,
};

/** The drop-target SHAPE tag (also the `data-droptarget-shape` values). */
export type DropTargetShape = DropTarget['shape'];

/** The `data-layout-container-slot` value a container puts on its root when no parent assigned it a
 *  slot id (bento as the composition root). It marks the element so a dialect can scope its
 *  hit-test to targets belonging to THIS container instance (`.closest(...) === mySlotEl`), by
 *  element identity. It is NOT a path address — the same-container source test is DOM identity
 *  (`dragSourceIsFrom`), so the value is only a presence marker and may repeat across nested roots. */
export const ROOT_SLOT = '__root__';

// ── Sources ──────────────────────────────────────────────────────────
// `DragSource` + `DragSourceRole` are the CANONICAL contract vocabulary, owned by
// @arsumbris/au-host-sdk (a dialect's `resolveTargets` speaks them) and re-exported
// above. A GENERIC source: any container emits the same shape, so the tabs
// container participates without a new source kind. `localId` is the addressable
// id the ROUTER uses (a leaf id, a tab id, a group id); `role` carries the
// hit-test reject/reorder semantics.

// ── Content-destinations ─────────────────────────────────────────────
// A CONTENT-DESTINATION is ANY surface (a file-tree folder row) that ACCEPTS a content drag and handles
// it its OWN way — the generalization of "a container self-declares drop zones" to "any surface
// self-declares a drop target". The RECEIVING SURFACE owns the outcome (a folder moves the file; a future
// editor imports+inlines); the router never centralizes it.


/** A surface's content-drop contract, declared via `registerDropTarget`. */
export interface ContentDropSpec {
  /** Optional destination-owned wording for the drag preview; never used for routing. */
  previewLabel?: string;
  /** Whether this surface accepts THIS drag, evaluated at HIT-TEST time. A surface that refuses (a folder
   *  over a PANE drag, which carries no `content`) emits NO target, so deepest-wins gives the container
   *  zone beneath it. Typically `isFileSelection(content)` or `content != null`. */
  accepts(source: DragSource, content: DragContent): boolean;
  /** Handle the drop. The surface owns the outcome (a folder move through the blast-radius preview; an
   *  editor import+inline). The spec closes over its own identity (the folder's dir), so no point/target
   *  is threaded. */
  onDrop(source: DragSource, content: DragContent): void;
}

/** A resolved content-destination under the cursor — the content-drop peer of a container `DropTarget` in
 *  the deepest-wins hit-test. Discriminated from `DropTarget` by its `kind` (a `DropTarget` has none). */
export interface ContentDropHit {
  kind: 'content-dest';
  /** The registered surface element (for a surface to match itself in `drag.hover` and draw its own
   *  highlight — presentation stays per-surface). */
  el: Element;
  spec: ContentDropSpec;
}

/** A resolved drop, either a container zone (a `DropTarget`) or a content-destination (`ContentDropHit`). */
export type DropHit = DropTarget | ContentDropHit;

/** Narrow a resolved hit to a content-destination. A `DropTarget` carries no `kind`, so its presence
 *  discriminates. */
export function isContentDropHit(hit: DropHit | null | undefined): hit is ContentDropHit {
  return !!hit && 'kind' in hit && (hit as ContentDropHit).kind === 'content-dest';
}

// ── DOM attributes ───────────────────────────────────────────────────

/** Names of the data attributes containers emit. Single source of truth. */
export const DATA_ATTR = {
  containerSlot: 'data-layout-container-slot',
  /** The generic drop-target shape (slot-rect / gap / empty / free-point). */
  droptargetShape: 'data-droptarget-shape',
  /** The owning container kind (bento / sandwich / canvas / …). */
  containerKind: 'data-container-kind',
  droptargetId: 'data-droptarget-id',
} as const;

// ── Drag state (consumed by the drag store) ──────────────────────────

/**
 * The CONTENT a drag carries when it did NOT start inside a container — a file selection (the file-tree
 * row), a reader `[[wikilink]]`, and later an external OS file. OPAQUE to the runtime ON PURPOSE:
 * - the router only checks its PRESENCE to take the content branch (mint-and-place) instead of the pane
 *   branch (extract-and-move); it never interprets the payload.
 * - the HOST-installed content resolver is what narrows it (only the host knows the engine `Selection`
 *   vocabulary), mirroring how `installSelectionDrop` already hands the host an opaque payload to narrow.
 * Kept opaque so container-core (the framework-agnostic runtime) names no engine type, AND so the payload
 * widens (an external file joins later) with NO change here — the drag protocol's non-foreclosure seam.
 */
export type DragContent = unknown;

/**
 * The `containerKind` a POINTER content drag reports (a file-tree row). NOT a real container kind: a
 * content drag MINTS a pane, it never moves one, so no wrap / dissolve / reorder rule keys on it (the
 * content BRANCH short-circuits before the pane path). Mirrors `selection-drop.ts`'s `__external__`
 * synthetic source. Same-container drag suppression is turned off for content drags in `dragSourceIsFrom`,
 * so this value is only a presence marker.
 */
export const CONTENT_SOURCE_KIND = 'content';

export interface DragState {
  source: DragSource;
  /** The source's DOM element (drag origin). The router walks up from it to
   *  the source's registered container root. */
  sourceEl: Element | null;
  /** Current hovered target. `null` when the cursor isn't over a valid drop surface. A container zone
   *  (`DropTarget`, the overlay renders its preview band) OR a content-destination (`ContentDropHit`, which
   *  draws its OWN highlight — the overlay renders nothing for it). */
  hover: DropHit | null;
  /** Pixel offset from the source element's top-left at drag start; the
   *  overlay can use this to draw a label following the cursor. */
  startOffset: { x: number; y: number };
  /** The CONTENT this drag carries, when it did not start inside a container. Its PRESENCE is what makes
   *  the router take the content branch (mint an instance and place it) instead of the pane branch
   *  (extract from the source, inject into the target). Optional rather than a discriminated union, so
   *  every existing pane source is untouched. See {@link DragContent}. */
  content?: DragContent;
}
