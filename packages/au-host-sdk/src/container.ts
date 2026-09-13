// Container substrate CONTRACT.

// A container-projection IMPLEMENTS `ContainerPlacement` so the shared substrate
// (the `@arsumbris/container-kit` package: the intent handlers, the fan-out drop
// router, the tabs container) can drive it WITHOUT knowing its layout dialect.
// The substrate owns the WHAT (which pane, preview vs permanent, the decision
// tree, the cross-container route); the container owns the HOW (its own layout
// mutation: bento splits, sandwich regions, canvas nodes, tabs a tab set).

// Framework-agnostic: pure types, no React. host-sdk stays agnostic; the React paved-path IMPLEMENTATION lives in
// container-kit, which depends on this contract.



// This file owns the container placement contract.

import type { ContainerSlot } from './generated'

/** A stable per-pane id. Preserved across re-parenting (it keys the host-owned
 *  terminal session + the view-state auto-store, so a moved pane reattaches). */
export type PaneId = string

/** A projection instance config: the carrier for a moved pane subtree.
 *  "A pane subtree IS a projection instance config" —

 *  Opaque here, exactly like `OpaqueConfig` in the mount contract. */
export type PaneInstance = unknown

/** A pane the substrate reasons about: its stable id + the type it mounts. */
export interface Pane {
  id: PaneId
  /** The projection subtype name the pane mounts (its identity). */
  type: string
}

/** A container kind tag, e.g. `bento` / `sandwich` / `canvas` / `tabs`.
 *  OPEN by design: any container declares its own kind, no central enum. */
export type ContainerKind = string

/** The geometric drop zone over a slot rect. `center` = wrap-into-tabs / add-tab;
 *  the edges = the target container's own dialect (bento: split). */
export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center'

/**
 * The exact sub-region of a slot rect the overlay highlights for a zone, as FRACTIONS of the rect
 * (0..1). The container's dialect computes it with the SAME basis it used to pick the zone, and the
 * overlay draws precisely that — so the highlighted band cannot drift from where the drop actually
 * lands (the failure a hardcoded paint fraction reintroduces on a capped-band container). A container
 * OWNS its band, part of its drop-zone emission.
 */
export interface BandFrac {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The drag source role controls hit-test rejection and reorder rules:
 * - pane: a leaf or pane-header drag.
 * - tab: a tab handle that permits same-strip reordering.
 */
export type DragSourceRole = 'pane' | 'tab'

/** A drag SOURCE: the pane/tab/group subtree being moved, addressed by its
 *  container. The CANONICAL shape (container-core re-exports it): the drag store,
 *  the router, the hit-test, and every dialect's `resolveTargets` speak it. */
export interface DragSource {
  containerKind: ContainerKind
  /** The source's local id within its container (a bento leaf id, a tab id, …). */
  localId: string
  /** The source's role, for reject + reorder semantics. */
  role: DragSourceRole
  /** A human label (for the drag ghost / a11y). */
  label: string
  /**
 * The dragged projection type, read from its child config. Targets use it to decide which slots
 * can accept the drag and to validate injection. An absent value means the type is unknown.
 */
  type?: string
}

/** A cursor point in client (viewport) coordinates. */
export interface DragPoint {
  x: number
  y: number
}

/**
 * A drop target uses a generic shape tagged with its owning container. Any container can
 * participate without adding a protocol kind. container-kit produces targets; the contract
 * defines their vocabulary because inject consumes them.
 */
export type DropTarget =
  | {
      /** A content slot rendered as a rect, with center/edge zones. */
      shape: 'slot-rect'
      containerKind: ContainerKind
      slotId: string
      zone: DropZone
      /** The exact region the overlay highlights for this zone, fractions of the slot rect. Emitted by
       *  the dialect so the paint matches the LOGIC by construction. Absent → the overlay draws nothing. */
      band?: BandFrac
    }
  | {
      /** A reorder insertion point (e.g. between tabs). */
      shape: 'gap'
      containerKind: ContainerKind
      slotId: string
      /** The LOGICAL insertion index the reorder op consumes (post-removal). */
      index: number
      /** Optional rendering hint: the VISUAL insertion slot (pre-removal), for
       *  drawing the insertion bar. The op uses `index`; the overlay uses this. */
      visualIndex?: number
    }
  | {
      /** An empty container to populate. */
      shape: 'empty'
      containerKind: ContainerKind
    }
  | {
      /** A free coordinate (canvas-world) for a new placement. */
      shape: 'free-point'
      containerKind: ContainerKind
      x: number
      y: number
    }

/**
 * An OCCUPANT: whatever currently sits in a position, plus the stable id it carries.
 *
 * A POSITION AND ITS OCCUPANT ARE DIFFERENT THINGS WITH DIFFERENT IDS, and this type exists so the
 * seam can never conflate them. A `slotId` addresses a POSITION — it is what a drop target names and
 * what survives its occupant being closed. The id in here belongs to the OCCUPANT — it is written as
 * that record's engine `^:` block-id, and it keys the host-owned pty session and the restorable
 * view-state. The two frequently coincide, which is exactly what makes substituting one for the
 * other survive review.
 *
 * Returned by both `getSlotContent` (what is in this position) and `extract` (what came out of it),
 * because it is the same thing read two ways.
 *
 *
 * A gesture replaces an OCCUPANT, never a POSITION.
 */
export interface Occupant<C = PaneInstance> {
  /**
   * The occupant's `^:` id — the THING, and the key for restorable view-state and the host-owned
   * terminal session, so it travels when the occupant moves.
   *
   * MINTED WHEN ABSENT, and written back on save. A composition therefore gains an id for a
   * previously-bare child the first time it is saved. That is an id being minted BECAUSE something
   * needs it: without one, a pane's cursor, scroll and running shell do not survive a reload.
   */
  id: PaneId
  instance: C
}

/**
 * The seam implemented by a container projection. The generic substrate drives it,
 * and the container maps each call onto its own layout model.
 */
export interface ContainerPlacement {
  /** Every content pane this container currently holds (for the open-target pick). */
  panes(): PaneId[]

  /** Locate a pane by stable id, or null if this container does not hold it. */
  findPane(id: PaneId): Pane | null

  /**
 * Normalize an occupant or position address to this container's canonical position id.
 * The operation is idempotent for a position id. Both address forms use PaneId and may share
 * the same string, so they are roles rather than disjoint types.
 *
 * A returned position id may be synthetic and unstable across remounts. Never pass it to a pool
 * lookup, and re-resolve after an asynchronous gap. Return null when the container has no matching
 * position; the substrate reports that outcome and declines the operation.
 *
 * This method is optional. Without it, the substrate passes the raw address to the individual seam.
 */
  resolve?(address: PaneId): PaneId | null

  /** Show / focus the pane with this id (activate its tab, reveal its slot). */
  activate(id: PaneId): void

  /**
   * Read the OCCUPANT of a position — its instance AND its own stable id (drives generic
   * wrap-into-tabs).
   *
   * IT RETURNS BOTH HALVES ON PURPOSE. Returning the instance alone left the substrate needing an id
   * it could not ask for, so it substituted the `slotId` — a POSITION id — and that single
   * substitution produced three separate defects: a wrap wrote two records under one `^:`, a dissolve
   * overwrote the survivor's id, and a container read "replace the occupant" as "replace the
   * position". A seam that hands back half a thing invites its caller to invent the other half.
   */
  getSlotContent(slotId: string): Occupant | null

  /**
   * Replace a position's OCCUPANT (wrap a bare pane into a group, put a dissolved group's lone child
   * back, swap a preview tab's content in place).
   *
   * IMPLEMENTOR OBLIGATIONS:
   * - **Change the occupant and NOTHING ELSE.** The position keeps its rules (`admits` / `fixed` /
   *   `label` / carried fields) and keeps its own `^:` id. An updater that rebuilds the position's
   *   state instead of spreading it silently un-declares what an author wrote, and leaves a VALID
   *   file that no longer says it.
   * - **Honour `occupantId`.** Absent means keep the occupant's current id. Present means the caller
   *   is naming the id the new occupant must carry, and it is never optional-in-practice: the two
   *   gestures that pass it are the two that would otherwise corrupt identity.
   *
   * `occupantId` exists because a SYNTHESIZED record needs a fresh id (a wrapper did not exist
   * before, so it must not adopt the id of the position it fills or the child it wraps) while an
   * EXISTING record must keep the one it has (a dissolved group's survivor keeps its pty and cursor
   * only if it keeps its id).
   */
  setSlotContent(slotId: string, instance: PaneInstance, occupantId?: PaneId): void

  /** Move a subtree WITHIN this container to a drop target in the same
   *  container. The router calls this when source and target are the same
   *  container (the common case). A container may implement it as its own
   *  efficient in-place move (bento: movePane; tabs: reorder) rather than
   *  extract-then-inject, which also avoids a serialize round-trip.
   *  `sourceLocalId` is the source's local id (e.g. a bento leaf id, a tab id).
   *
   *  Returns `true` when the move was APPLIED, `false` when the container REFUSED or no-op'd
   *  it — an unknown id, an unmovable region, a target shape it does not take. The reorder seam
   *  reports a `false` through the diagnostic seam, so a refused reorder is observable for EVERY
   *  container, and a third-party one need not hand-roll its own report. Slot FIXITY is a separate
   *  rule the substrate already refuses BEFORE calling this (`displacementRefused`); a `false`
   *  here is the container's OWN structural refusal, not fixity. */
  moveWithin(sourceLocalId: string, target: DropTarget): boolean

  /** Remove a pane subtree, returning its instance config + stable id.
   *  The router calls this on the SOURCE container for a CROSS-container move.
   *  Null if the id is unknown. */
  extract(localId: string): Occupant | null

  /** Place a pane subtree at a drop target, preserving its stable id.
   *  The router calls this on the TARGET container for a CROSS-container move.
   *  A `center` slot-rect zone means wrap-into-tabs / add-tab; an edge zone
   *  means the container's own dialect (bento: split beside). */
  inject(instance: PaneInstance, id: PaneId, target: DropTarget): void

  /**
   * The SLOT governing this id, or null when nothing governs it.
   *
   * A LOOKUP only the container can answer, so the substrate can own the RULE. Every method above
   * is declared inside a closure that already holds the container's config; the ROUTER and the
   * DIALECTS never are — they hold DOM geometry (element identity / `slotId`) and nothing else. So
   * the substrate does not reach into a config to find a slot record. It asks.
   *
   * `id` is EITHER a slot id OR the id of its occupant, because a drag SOURCE names a child while a
   * drop TARGET names a position that may be empty. The container resolves both, since it alone
   * knows its slots and who sits in them.
   *
   * OPTIONAL, deliberately. A container with no placement seam has no slots to govern, and gets no
   * enforcement — which is the correct outcome, not a gap. Being optional also makes this ADDITIVE:
   * `MOUNT_CONTRACT_VERSION` does NOT bump, so no projection, including a cross-repo one, is
   * invalidated by it.
   *
   * The substrate checks at five seams and never destroys state it may not be allowed to write.
   * Containers read the SAME lookup to render the affordance (a lock glyph instead of a drag
   * handle, a suppressed close), which stays per-container and stays presentational.
   *
   *
   */
  slotFor?(id: string): ContainerSlot | null

  /**
   * THE POOL-EDIT SEAM.
   *
   * When a container declares this, a structural drop becomes a REFERENCE RE-POINT over the flat
   * pool instead of an in-place mutation of the container's own live runtime tree. Each method
   * COMPUTES a new record PURELY — it reads the container's live layout and returns the updated
   * record WITHOUT calling setState or persisting — and the router batches the affected records into
   * ONE atomic `commit`. That is what kills the re-parent duplication + `removeChild` crash by
   * construction at runtime: no container ever reconciles a moved subtree in place, and no container
   * re-serializes a stale snapshot (the host litigates once over the pool and the tree re-derives).
   *
   * OPTIONAL: `routeDrop` uses this path only when BOTH the source and
   * target container declare it, and falls back to the mutating `extract`/`inject`/`moveWithin`
   * otherwise.
   *
   *

   */
  poolEdit?: PoolEditSeam
}

/**
 * The reorder NO-OP sentinel. A `moveWithinEdit` / `PoolEditModel.reorder` returns this when the
 * source lands back on its OWN position: there is genuinely nothing to commit, and it is NOT a
 * refusal. The router commits nothing and — unlike a `null` (the container REFUSED: an unknown id, a
 * target it does not take) — raises NO `container-reorder-refused` diagnostic. One runtime constant in
 * this otherwise types-only contract; au-host-sdk is a single served-dep instance, so the symbol's
 * identity holds across every container bundle that imports it.
 */
export const POOL_EDIT_NOOP: unique symbol = Symbol('pool-edit-noop')

/**
 * A STAGED mint on the structural (propose) channel: the `^:` id to reference, plus the record
 * edit(s) to fold into the SAME `propose` batch. A plain record stages ONE edit; a synthesized group
 * stages its flattened records (only the genuinely NEW ones — an existing child keeps its
 * authoritative record and is referenced by id). NOTHING is written at mint: the records land only
 * when the host applies the batch, so a refused proposal leaves no orphan. This is the structural
 * channel's mint. The BOUNDED new-content mint (a container creating fresh content it then saves via
 * `saveConfig`) is a different channel — `children.pool.createRecord` / `createGroup`, host-pooled at
 * mint.
 */
export interface StagedMint {
  /** The `^:` to reference (a plain record's id, or the group root's). */
  rootId: PaneId
  /** The record edits to include in the `propose` batch (one for a plain record; the flattened NEW
   *  records for a group). */
  edits: ReadonlyArray<{ id: PaneId; record: PaneInstance }>
}

/**
 * The PURE half of the placement seam (see `ContainerPlacement.poolEdit`).
 *
 * The container-specific methods (`recordId` / `extractEdit` / `injectEdit` / `moveWithinEdit` /
 * `wrapEdit` / `createRecord` / `createGroup`) read the container's own live layout and return a
 * DESCRIPTION of a change; they never mutate React state, never write the pool, and never persist.
 * The gesture collects the edits (a source extract, a target inject/wrap, any staged mints) and hands
 * them to the host in one `propose` batch, applied as one transaction. The substrate holds no write.
 */
export interface PoolEditSeam {
  /** This container's OWN `^:` record id in the pool (read from the config it was mounted with —
   *  `resolvePoolToTree` stamps every resolved record with its id). The address a structural edit
   *  writes this container's new record to. */
  recordId(): PaneId

  /**
   * PURE. Compute this container's new record with `localId` removed, plus the OCCUPANT that left
   * (its instance + stable `^:` id, so the router can re-place it in the target). The child RECORD is
   * untouched — a move re-points references, it does not rewrite the moved pane. `null` if the id is
   * unknown or the slot refuses release.
   */
  extractEdit(localId: string): { record: PaneInstance; occupant: Occupant } | null

  /**
   * PURE. Compute this container's new record with `instance` (carrying stable id `id`) placed at
   * `target`. `null` if the target refuses the occupant.
   */
  injectEdit(instance: PaneInstance, id: PaneId, target: DropTarget): PaneInstance | null

  /**
   * PURE. Compute this container's new record with `sourceLocalId` moved to `target` WITHIN this same
   * container (the reorder case). `null` if refused or unknown. `POOL_EDIT_NOOP` if the move lands the
   * source back on its own position — nothing to commit, and NOT a refusal (see the sentinel).
   */
  moveWithinEdit(sourceLocalId: string, target: DropTarget): PaneInstance | typeof POOL_EDIT_NOOP | null

  /**
   * PURE. The center-WRAP edit: compute this container's new record with the position `slotId`'s
   * occupant replaced by a REFERENCE to `groupId` (the synthesized group, minted via `createGroup`),
   * and — when `removeLocalId` is given (a SAME-container wrap, where the dragged pane also lives
   * here) — with that pane removed too, in the SAME record. A cross-container wrap passes no
   * `removeLocalId` (the source container drops the pane via `extractEdit`). `null` if refused.
   */
  wrapEdit(slotId: string, groupInstance: PaneInstance, groupId: PaneId, removeLocalId?: string): PaneInstance | null

  /** STAGE a NEW pool record (a pane a container just created for a structural gesture): DRAW a final
   *  `^:` id and return it plus the record edit, to fold into the gesture's `propose` batch. Writes
   *  NOTHING — the record lands when the host applies the batch. */
  createRecord(record: PaneInstance): StagedMint

  /**
   * STAGE a synthesized GROUP record (a center-wrap's tabs/column): DRAW a final `^:` id and return it
   * plus the record edits. The group instance embeds its two children carrying their existing `^:`
   * ids; the host FLATTENS it — the group record REFERENCES the children (`[[^^id]]`), and an
   * already-present child is NOT re-staged (it keeps its authoritative record), so no nesting is
   * reintroduced. Writes NOTHING; the records land when the host applies the batch. */
  createGroup(groupInstance: PaneInstance): StagedMint

  /** PROPOSE this gesture's edit batch to the host — the ASK, and the substrate's ONLY write channel. The
   *  substrate does not write the pool; it builds edits and asks, and the HOST applies them (or refuses).
   *  The host owns the actual write (`applyStructural`): one gesture-scoped apply commits the edits. */
  propose(edits: ReadonlyArray<{ id: PaneId; record: PaneInstance }>): void
}

/**
 * A container's DROP DIALECT: how it participates in drag-and-drop.
 *
 * The generic layer resolves WHICH target wins across containers (deepest-wins);
 * each container owns WHAT it offers at a cursor point (target emission) and HOW
 * it behaves while dragged over (auto-scroll, spring-load). A container declares
 * its dialect the same way it declares its `ContainerPlacement` — by DOM-element
 * identity, into the container-core registry (the React ergonomics live in
 * container-kit's `useContainerDialect`).
 *
 * Framework-agnostic by design (this is host-sdk):
 * - EMISSION (`resolveTargets`) is pure DOM + geometry → data.
 * - BEHAVIOURS (`onDragOver`) are imperative DOM side effects.
 * - PRESENTATION (bento's frame-inset, tabs' insertion line) is NOT a method
 *   here: it is the container's OWN framework-coupled render, driven by observing
 *   the shared drag store (e.g. inset panes while a drag is active). Putting a
 *   `renderView` on the agnostic seam would couple host-sdk to a UI framework.
 *
 */
export interface ContainerDialect {
  /** Emit this container's drop target(s) at a cursor point, given the drag
   *  source. The generic hit-test asks each registered container's dialect and
   *  keeps the deepest. `root` is the container's registered root element; return
   *  `[]` when the point offers no target (e.g. over a nested child's exclusive
   *  region). Order within the array is the container's own priority, most
   *  specific first. */
  resolveTargets(root: Element, point: DragPoint, source: DragSource): DropTarget[]

  /** Optional drag BEHAVIOURS while the cursor is over this container mid-drag:
   *  auto-scroll near an edge, spring-load a tab to switch to it. Runs on
   *  drag-over; independent of what commits on release. */
  onDragOver?(root: Element, point: DragPoint, source: DragSource): void
}
