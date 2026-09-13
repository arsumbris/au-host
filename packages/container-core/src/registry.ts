/**
 * The fan-out drop router + the container-placement registry operations
 * (framework-agnostic). Containers SELF-DECLARE their `ContainerPlacement` keyed
 * by their root DOM element (the shared `WeakMap` in `singletons.ts`); the
 * router walks the DOM to reach the source + target containers and dispatches.
 *
 * The React ergonomics (`useContainerPlacement`, a callback ref that survives a
 * late-mounting root) live in container-kit and call `registerContainer` /
 * `deregisterContainer` here.
 *
 * This shares the intent-dispatch PRINCIPLE (containers declare, NO kernel-owned
 * registry) but is its own container-core-local mechanism: intents route by the
 * mount tree (`publisherId`), drops by DOM geometry (element identity) —
 * distinct address spaces. Same-window only (DOM hit-test can't cross windows;
 * cross-window re-parent stays the `CompositionRuntime` relay gesture).
 *
 *
 */

import type { ChooseRequest, ContainerDialect, ContainerPlacement, DropTarget, PaneId, PaneInstance } from '@arsumbris/au-host-sdk';
import { reportHostDiagnostic, POOL_EDIT_NOOP, event, on } from '@arsumbris/au-host-sdk';
import { mintBlockId } from './block-id.ts';
import { groupingForKind, groupingForNewGroup, isGroupingKind, groupingChooser, groupingOutcomeForNewGroup, wrapTargetForKind, wrapTargets, wrapTargetOutcome } from './grouping.ts';
import type { GroupingCapability } from './grouping.ts';
import { displacementRefused, occupantRefused, restructureRefused, typeOfInstance } from './slots.ts';
import { reparentSafeCenter } from './reparent.ts';
import { containerRoots, contentDropTargets, dialectRegistry, findContainerRoot, registry, sameContainerRoot } from './singletons.ts';
import type { DropContext } from './store.ts';
import { DATA_ATTR, isContentDropHit, type ContentDropSpec, type DragContent, type DragSource, type DropHit } from './types.ts';

/**
 * Resolve a dropped CONTENT payload to a viewer INSTANCE to place, or null (unviewable / cancelled).
 *
 * ASYNC because the host resolution reads the engine (a reader `[[wikilink]]` → path) and may ask a
 * must-pick chooser. Installed by the HOST (ProjectionHost) — only the host holds the projection set,
 * the viewer-defaults, the chooser, and the reader; container-core only checks the PRESENCE of
 * `ctx.content` and awaits this. The `content` is OPAQUE here (see `DragContent`); the resolver narrows it.
 *
 * INSTALL, don't import: `viewer-resolve` policy lives host-side (container-kit / the app), and
 * container-core must not import upward. `container-core` is a shared singleton, so the host installs the
 * one closure it alone can build. Mirrors `setGroupingChooser`.
 */
export type ContentResolver = (content: DragContent) => Promise<PaneInstance | null>;
let contentResolver: ContentResolver | null = null;
/** Install the content→instance resolution (`null` clears it, on host teardown). */
export function setContentResolver(resolve: ContentResolver | null): void {
  contentResolver = resolve;
}

/** Declare a container's `ContainerPlacement`, keyed by its root element. */
export function registerContainer(el: Element, placement: ContainerPlacement): void {
  registry.set(el, placement);
  containerRoots.add(el); // keep the enumerable set in sync (pane resolution).
}

/** Drop a container's declaration (on unmount / re-key). */
export function deregisterContainer(el: Element): void {
  registry.delete(el);
  containerRoots.delete(el);
}

/**
 * Find the `ContainerPlacement` of the container currently holding pane `paneId`, or null.
 * Iterates the registered roots (the enumerable `containerRoots`) and asks each whether it
 * holds the pane. For an out-of-band caller (the agent-host transport `containerOp`) that has
 * a stable pane id but no source DOM element to walk up from — the pane-address analogue of the
 * router's DOM-geometry walk. Same-window only (the registry is per-window).
 */
export function findPlacementByPane(paneId: PaneId): ContainerPlacement | null {
  for (const el of containerRoots) {
    const placement = registry.get(el);
    if (placement?.findPane(paneId)) return placement;
  }
  return null;
}

/**
 * Locate the container holding pane `paneId`, framework-owned.
 *
 * Under the PORTAL an anchor IS a DOM element carrying the STABLE child id (`^:`) as `data-pane-id`,
 * sitting inside its container's DOM. So this resolves the pane's slot by a DOM QUERY and walks up to
 * the container, WITHOUT asking any container to map ids. This keeps out-of-band callers (`closePane` / `activatePane` / the agent transport)
 * independent of container-internal position ids; a wrong-id lookup is indistinguishable from the
 * right one at author time. The location does not depend on the container.
 *
 * Resolving by DOM (not by reading the anchor map) is what lets the map stay a PER-RUNTIME registry the
 * kernel owns: this runs from a projection bundle too (a placeholder's "Remove this placement"
 * button), where no registry handle is reachable, but the DOM is. The `:not([data-pane-host])` excludes
 * the flat host element (which carries `data-pane-id` for hover framing) so only the real slot matches.
 *
 * Falls back to `findPlacementByPane` (the per-container `findPane` scan) when no anchor is in the DOM
 * — a pool-less detached window, the legacy non-portal mount, or a headless caller with no `document`.
 */
export function placementForPane(paneId: PaneId): ContainerPlacement | null {
  if (typeof document !== 'undefined') {
    const anchorEl = document.querySelector<HTMLElement>(
      `[data-pane-id="${CSS.escape(paneId)}"]:not([data-pane-host])`,
    );
    if (anchorEl) {
      const found = findContainerRoot(anchorEl);
      if (found) return found.placement;
    }
  }
  return findPlacementByPane(paneId);
}

/**
 * Resolve an occupant or position address to the container's canonical position id at the boundary.
 * When resolve is absent, pass the address through to the container. When it returns null, emit a
 * placement trace and decline the operation. Position ids may be synthetic; do not use them as
 * pool record ids or cache them across an await.
 */
export function resolveAddress(placement: ContainerPlacement, address: PaneId, gesture: string): PaneId | null {
  if (!placement.resolve) return address; // Container without resolve: raw-address fallback.
  const pos = placement.resolve(address);
  if (pos == null && on('placement')) event('placement', 'resolve-miss', { gesture, address });
  return pos;
}

/**
 * Show / focus the pane with this stable id, wherever it lives (activate its tab, reveal its
 * slot). Returns whether a container held it. The `containerOp: activate` implementation.
 */
export function activatePane(paneId: PaneId): boolean {
  const placement = placementForPane(paneId);
  if (!placement) return false;
  const pos = resolveAddress(placement, paneId, 'activate');
  if (pos == null) return false;
  placement.activate(pos);
  return true;
}

/**
 * Remove a pane by stable id through the holding container's required extract seam.
 * This provides a shared close operation independent of the container's own affordances.
 * Respect slot fixity and return whether removal occurred. The result is not injected elsewhere.
 */
export function closePane(paneId: PaneId): boolean {
  const placement = placementForPane(paneId);
  if (!placement) return false;
  // Resolve to the canonical position ONCE at the boundary; every seam below is position-native.
  const pos = resolveAddress(placement, paneId, 'close');
  if (pos == null) return false;
  if (displacementRefused(placement, pos, 'close')) return false;
  // POOL PATH: a close is a reference-REMOVAL. The container computes its
  // new record PURELY at the resolved position (`extractEdit` drops the child ref, collapses its own
  // dialect), and the host reaps the now-unreachable pane record on commit. No in-place tree mutation,
  // and no seam maps ids — the boundary already resolved.
  const pe = placement.poolEdit;
  if (pe && pe.recordId()) {
    const ex = pe.extractEdit(pos);
    if (!ex) return false;
    pe.propose([{ id: pe.recordId(), record: ex.record }]); // applyStructural reaps the dropped pane
    return true;
  }
  // LEGACY fallback (a container without `poolEdit`, or a pool-less detached window): the mutating
  // extract, whose subtree is discarded — that IS the close; the pane is gone on the next save.
  return placement.extract(pos) !== null;
}

/**
 * SET the content of a position — fill an EMPTY slot or REPLACE an occupied one IN PLACE — addressed by
 * the id of its slot (an empty position, carried on the mounted placeholder's anchor) OR its current
 * occupant (a swap). The address-based sibling of {@link closePane} / {@link wrapPane}, over the placement
 * seam's `setSlotContent`: the ONE primitive for "replace a position's occupant, keep its rules and (by
 * default) its `^:` id". So the empty-slot placeholder fill and the pane SWAP resolve to the same op
 * instead of each hardcoding a per-container callback (`fillLeaf` / `newTab` / `setRegion` / ...).
 *
 * Honours the slot rules the substrate owns, and BEFORE the destructive write (the containers'
 * `setSlotContent` deliberately carries no local guard): the incoming type must be ADMITTED
 * (`occupantRefused`), and a currently-occupied FIXED position refuses the replacement
 * (`displacementRefused`). An EMPTY position has nothing to displace, so only admits governs a fill.
 *
 * `occupantId` follows `setSlotContent`: absent keeps the current occupant's id (a swap in place); present
 * names the id a synthesized/pre-minted occupant must carry. A bare fill with no id mints lazily on save,
 * like the swap.
 *
 * Reachable from a projection bundle — a placeholder filling its OWN slot — via the same portal-anchor
 * resolution `closePane` / `activatePane` use (`placementForPane`). Returns whether it applied. `false`
 * when no container holds the id (e.g. the composition ROOT, which the host re-points directly) or a rule
 * refused.
 */
export function setPaneContent(id: PaneId, instance: PaneInstance, occupantId?: PaneId): boolean {
  const placement = placementForPane(id);
  if (!placement) return false;
  const pos = resolveAddress(placement, id, 'place');
  if (pos == null) return false;
  if (occupantRefused(placement, pos, typeOfInstance(instance), 'place')) return false;
  // Replacing an EXISTING occupant of a `fixed` position is a displacement; a fill of an empty position
  // has nothing to displace, so admits (above) is the only rule then.
  if (placement.getSlotContent(pos) && displacementRefused(placement, pos, 'place')) return false;
  // Reflect-in-place via the container's OWN-RECORD save (`saveConfig`) — already host-mediated, so the
  // substrate never writes the pool here. NOT a structural `propose`: a swap / fill keeps the id and
  // reflects without a remount, which `applyStructural` would not preserve.
  placement.setSlotContent(pos, instance, occupantId);
  return true;
}

/** The outcome of a {@link wrapPane}, so the caller can report each case. */
export type WrapOutcome =
  /** The slot now holds a new group `[existing occupant, newChild]`. */
  | 'wrapped'
  /** A `fixed` / `admits` slot lock refused it (not an error), or the
   *  container's own `wrap` declined. The refusal hint is already reported by `restructureRefused`. */
  | 'refused'
  /** Nothing holds that pane (it is in no placement-declaring container, or the id is unknown). */
  | 'no-container'
  /** The workspace declares no grouping container to build the group with. */
  | 'no-grouping'
  /** The holding container has no addressable pool record (legacy inline mount); `readyPoolEdit`
   *  has reported it. */
  | 'not-pooled';

/**
 * WRAP a bare pane into a NEW group, addressed by its stable `^:` id — the address-based sibling of
 * {@link closePane} / {@link activatePane}. The open chooser's FLOOR calls it so a file that dead-ended
 * (a bare editor in a region with no open-capable container) gets a real in-place home instead of only
 * a detached window: the region's slot is re-pointed at a fresh group holding `[existing occupant,
 * newChild]`.
 *
 * `newChild` is the record the HOST already resolved (the file's viewer, `{ type, file }`) but has NOT
 * yet pooled — this pools it. `requestedKind` picks which grouping container; absent → the workspace's
 * default new-group kind (`groupingForNewGroup`).
 *
 * WHY ADDRESS-BASED, not the drag path. `wrapEdit` is otherwise reachable only from a DOM drop target
 * (which supplies a `slotId`); the host-owned chooser has a stable pane id and no drag. So this resolves
 * the holding container by pane id (`placementForPane`, the same portal-anchor lookup close/activate use)
 * and calls the container's OWN pool `wrapEdit` — reusing its invariants and honouring its slot locks —
 * instead of reaching into the drag router's DOM-keyed registry (a distinct address space) or re-pointing
 * the slot generically (bypassing the container's own wrap). The seam resolves the occupant id wherever it
 * wants a `slotId` (`slotFor` accepts either; a container like sandwich matches a child id in `regionOf`).
 *

 */
export function wrapPane(
  paneId: PaneId,
  newChild: PaneInstance,
  requestedKind?: string,
): WrapOutcome {
  const placement = placementForPane(paneId);
  if (!placement) return 'no-container';
  const pos = resolveAddress(placement, paneId, 'wrap');
  if (pos == null) return 'no-container';
  const existing = placement.getSlotContent(pos);
  if (!existing) return 'no-container';
  // The WRAP-TARGET registry (grouping ∪ spatial), NOT the drop's grouping-only lookup — so a spatial
  // container (bento) resolves here. The caller (the floor / the wrap pane action) resolves the kind via
  // `wrapTargetOutcome` + the sectioned picker; `groupingForNewGroup()` is only a no-kind last resort.
  const cap =
    (requestedKind ? wrapTargetForKind(requestedKind) : null) ?? groupingForNewGroup();
  if (!cap) return 'no-grouping';
  // The wrap writes a CONTAINER (`cap.typeName`) into the slot, so it answers to the slot's own
  // `fixed` / `admits` — the same gate the center-drop wrap checks (SEAM 4). A fixed / restricted slot
  // refuses: the deliberate-lock respect case, not a bug.
  if (restructureRefused(placement, pos, cap.typeName, 'group')) return 'refused';
  const pe = readyPoolEdit(placement);
  if (!pe) return 'not-pooled';
  // STAGE the new viewer + the group REFERENCING [existing occupant, new viewer], re-point the slot at
  // the group, and propose ALL of it in ONE batch — the same reference-re-point a center drop takes,
  // now with the mints riding the proposal so a refuse leaves no orphan.
  const newChildMint = pe.createRecord(newChild);
  const group = cap.build([
    { id: existing.id, instance: existing.instance },
    { id: newChildMint.rootId, instance: newChild },
  ]) as PaneInstance;
  const groupMint = pe.createGroup(group);
  const record = pe.wrapEdit(pos, group, groupMint.rootId);
  if (record == null) return 'refused';
  pe.propose([...newChildMint.edits, ...groupMint.edits, { id: pe.recordId(), record }]);
  return 'wrapped';
}

/**
 * WRAP a bare pane into a NEW SINGLE-CHILD group of `requestedKind` — the pane-header "wrap in a
 * container" affordance. Unlike {@link wrapPane} (which wraps `[existing occupant, newChild]` around a
 * second arriving pane), this wraps the pane in a container holding ONLY itself, so the user gets an
 * empty container they can then split / add tabs into. The pane keeps its `^:` id (cursor / terminal /
 * view-state survive); the group record is minted anew — the same wrap-identity invariant. Address-based
 * (resolves the holding container by pane id), so it honours the slot's own `fixed` / `admits` locks via
 * `restructureRefused`, exactly like {@link wrapPane}.
 */
export function wrapPaneSolo(paneId: PaneId, requestedKind?: string, placementOverride?: ContainerPlacement): WrapOutcome {
  // `placementOverride` addresses a pane through a SPECIFIC holder rather than the nearest one
  // `placementForPane` walks to. The root-container case needs it: wrapping the ROOT container must go
  // through the WINDOW-content slot (the root placement), not the container's OWN placement (which sits on
  // the same element and would look for `paneId` as one of its children and find nothing).
  const placement = placementOverride ?? placementForPane(paneId);
  if (!placement) return 'no-container';
  const pos = resolveAddress(placement, paneId, 'wrap-solo');
  if (pos == null) return 'no-container';
  const existing = placement.getSlotContent(pos);
  if (!existing) return 'no-container';
  const cap = (requestedKind ? wrapTargetForKind(requestedKind) : null) ?? groupingForNewGroup();
  if (!cap) return 'no-grouping';
  if (restructureRefused(placement, pos, cap.typeName, 'group')) return 'refused';
  const pe = readyPoolEdit(placement);
  if (!pe) return 'not-pooled';
  const group = cap.build([{ id: existing.id, instance: existing.instance }]) as PaneInstance;
  const groupMint = pe.createGroup(group);
  const record = pe.wrapEdit(pos, group, groupMint.rootId);
  if (record == null) return 'refused';
  pe.propose([...groupMint.edits, { id: pe.recordId(), record }]);
  return 'wrapped';
}

/** How {@link wrapPaneInteractive} asks for a container kind and labels the options. */
export interface WrapInteractiveOpts {
  /** Ask the user to pick a container kind (the host chooser). Called only for a GENUINE choice — a
   *  configured `group-into` or a sole wrap target is used silently, never a nag. */
  choose: (request: ChooseRequest) => Promise<string | null>;
  /** Optional display label for a container type-name in the picker (else the bare type name). */
  labelFor?: (typeName: string) => string;
}

/**
 * The interactive {@link wrapPaneSolo}: resolve the container kind (the composition's `group-into` /
 * a sole target used silently, else the family-SECTIONED chooser — Stack : grouping, Arrange : spatial),
 * then wrap. Mirrors the file-open floor's `pickWrapKind`, factored here so the substrate owns the flow
 * and the caller injects only the chooser + labels. Returns `'cancel'` when the user dismisses the picker.
 */
export async function wrapPaneInteractive(
  paneId: PaneId,
  opts: WrapInteractiveOpts,
  placementOverride?: ContainerPlacement,
): Promise<WrapOutcome | 'cancel'> {
  const outcome = wrapTargetOutcome();
  // None declared → let wrapPaneSolo report `no-grouping` (the honest terminal outcome).
  if (!outcome || outcome.available.length === 0) return wrapPaneSolo(paneId, undefined, placementOverride);
  // The composition said, or there is only one target → use it silently, no ask.
  if ((outcome.reason === 'requested' || outcome.reason === 'only') && outcome.chosen) {
    return wrapPaneSolo(paneId, outcome.chosen.typeName, placementOverride);
  }
  const bare = (t: string): string => t.split('::')[0] ?? t;
  const SECTION = { grouping: 'Stack', spatial: 'Arrange' } as const;
  const options = [...wrapTargets()]
    .sort((a, b) => (a.family === b.family ? 0 : a.family === 'grouping' ? -1 : 1)) // Stack first, then Arrange.
    .map((t) => ({
      id: t.typeName,
      label: opts.labelFor?.(t.typeName) ?? bare(t.typeName),
      section: SECTION[t.family],
    }));
  const picked = await opts.choose({ title: 'Wrap in which container?', options });
  if (!picked) return 'cancel';
  return wrapPaneSolo(paneId, picked, placementOverride);
}

/** The outcome of a {@link dissolvePane}, so the caller can report each case. */
export type DissolveOutcome =
  /** The enclosing container is gone; its lone child now sits in the grandparent slot. */
  | 'dissolved'
  /** The grandparent slot refused the lone child's type (a `fixed`/`admits` lock), or its own `dissolve`
   *  gesture is refused — reported by `restructureRefused`. */
  | 'refused'
  /** The enclosing container holds 2+ children, so it is not a single-child wrapper to remove. */
  | 'not-single-child'
  /** Nothing holds that pane (unknown id, or no placement-declaring container / DOM anchor). */
  | 'no-container'
  /** The enclosing container has no grandparent CONTAINER to lift the child into (it is a
   *  window-content root), so there is nowhere to dissolve it to. */
  | 'no-parent-container';

/**
 * UNWRAP the container ENCLOSING a pane, when that container holds only this one child — the inverse of
 * {@link wrapPaneSolo}, and the address-based sibling of the drag-only `dissolveIfCollapsed`. Replaces the
 * enclosing container in its GRANDPARENT slot with the lone child, which KEEPS its `^:` id (its cursor /
 * scroll / terminal survive), so a wrap → unwrap round-trip is lossless.
 *
 * ADDRESS-BASED, not the drag path: `dissolveIfCollapsed` fires only as a side effect of a cross-container
 * extract that leaves a declared-`minChildren` container at one child. This is the deliberate pane-header
 * affordance — it resolves the holding container by pane id (the same DOM-anchor lookup `placementForPane`
 * uses) and walks up to the grandparent slot, honouring that slot's own `dissolve` lock via
 * `restructureRefused`. Gated on the enclosing container holding EXACTLY one child.
 */
export function dissolvePane(paneId: PaneId): DissolveOutcome {
  // Trace unwrap outcomes through AU_HOST_EVENTS=placement so a refused or unavailable operation
  // remains observable.
  const done = (outcome: DissolveOutcome, detail?: Record<string, unknown>): DissolveOutcome => {
    if (on('placement')) event('placement', 'dissolve', { paneId, outcome, ...detail });
    return outcome;
  };
  if (typeof document === 'undefined') return done('no-container');
  const anchorEl = document.querySelector<HTMLElement>(
    `[data-pane-id="${CSS.escape(paneId)}"]:not([data-pane-host])`,
  );
  if (!anchorEl) return done('no-container', { at: 'anchor' });
  const found = findContainerRoot(anchorEl);
  if (!found) return done('no-container', { at: 'enclosing' });
  const { el: containerEl, placement } = found;
  // GATE: exactly one child, so this container is a single-child wrapper. The op is "replace the
  // container with its LONE child" — there is no slot operation for putting N children back, so a 2+
  // container is not unwrappable here (the same reason `dissolveIfCollapsed` handles only the 2→1 case).
  if (placement.panes().length !== 1) return done('not-single-child');
  // Resolve the clicked address to the canonical position; fall back to the sole pane's position (the
  // gate above guarantees exactly one). Both go through the boundary so the read below is position-native.
  const solePane = placement.panes()[0];
  const pos =
    resolveAddress(placement, paneId, 'dissolve') ??
    (solePane != null ? resolveAddress(placement, solePane, 'dissolve') : null);
  if (pos == null) return done('no-container', { at: 'resolve' });
  const lone = placement.getSlotContent(pos);
  if (lone == null) return done('no-container', { at: 'lone' });
  // The GRANDPARENT container + the slot the enclosing container itself occupies. A window-content root
  // has no grandparent container to lift into — the honest "nothing to dissolve to" terminal.
  const parent = findContainerRoot(containerEl.parentElement);
  if (!parent) return done('no-parent-container', { at: 'parent' });
  const parentSlotEl = containerEl.parentElement?.closest(
    '[data-droptarget-shape="slot-rect"][data-droptarget-id]',
  );
  const parentSlotId = (parentSlotEl as HTMLElement | null)?.dataset['droptargetId'];
  if (parentSlotId === undefined) return done('no-parent-container', { at: 'parentSlot' });
  // SEAM 5 — dissolve. Replacing the group with the lone child in the grandparent slot is an
  // occupant-type change there, so it answers to that slot's own rules like any other placement.
  if (restructureRefused(parent.placement, parentSlotId, typeOfInstance(lone.instance), 'dissolve')) {
    return done('refused');
  }
  // The survivor KEEPS ITS OWN ID (`occupantId`), so its pty / cursor / scroll survive the unwrap.
  // Reflect via the parent's OWN-RECORD save (host-mediated); a window-root re-points its content the same way.
  parent.placement.setSlotContent(parentSlotId, lone.instance, lone.id);
  return done('dissolved');
}

/** Declare a container's drop `ContainerDialect` (target emission + drag
 *  behaviours), keyed by its root element — the SAME key as its placement. */
export function registerDialect(el: Element, dialect: ContainerDialect): void {
  dialectRegistry.set(el, dialect);
}

/** Drop a container's dialect declaration (on unmount / re-key). */
export function deregisterDialect(el: Element): void {
  dialectRegistry.delete(el);
}

/**
 * Declare a surface as a CONTENT-DESTINATION (a file-tree folder row): it ACCEPTS a content drag and owns
 * the drop's outcome. The hit-test includes it in the deepest-wins up-walk — but only when its `accepts`
 * passes, so a refusing surface (a folder over a PANE drag) emits no target and the container zone beneath
 * it wins. General by construction: a projection registers it exactly as a chrome surface would (no
 * file-tree assumption in the seam). Returns a detach fn.
 */
export function registerDropTarget(el: Element, spec: ContentDropSpec): () => void {
  contentDropTargets.set(el, spec);
  return () => contentDropTargets.delete(el);
}

/** Resolve the DOM element a drop target refers to (for finding its container).
 *  slot-rect / gap carry a `slotId` addressable by the emitted data-attrs;
 *  empty / free-point have no producer yet. */
function queryTargetElement(target: DropTarget): Element | null {
  if (target.shape === 'slot-rect' || target.shape === 'gap') {
    return document.querySelector(
      `[${DATA_ATTR.droptargetShape}="${target.shape}"][${DATA_ATTR.droptargetId}="${cssEscape(target.slotId)}"]`,
    );
  }
  return null;
}

// Resolve declared grouping capabilities and delegate instance construction to their builders. See grouping.ts.


/**
 * A container's `poolEdit` seam, but ONLY when it can actually address its own pool record — i.e.
 * `recordId()` is non-empty. A container that is mounted INLINE (a legacy group embedded by an old
 * mutating-path wrap, `pooled: false`) has no `^:` in its config, so `recordId()` returns `''`; the
 * pure re-point cannot name a record for it, and committing under an empty id corrupts the pool (the
 * reaper then deletes the now-unreachable real records — a full collapse). Returning null here makes
 * such a drop fall back to the mutating seam instead. Fresh wraps pool their group via `createGroup`,
 * so this guards only pre-existing inline state.
 */
function readyPoolEdit(placement: ContainerPlacement): NonNullable<ContainerPlacement['poolEdit']> | null {
  const pe = placement.poolEdit;
  if (!pe) return null;
  if (!pe.recordId()) {
    reportHostDiagnostic({
      code: 'container-not-pooled-for-structural-edit',
      severity: 'warning',
      subject: 'composition',
      message:
        'a container taking part in a structural drop has no pool record id (it is mounted inline, not as a `^:` pool record), so the drop fell back to the in-place seam; this is legacy state from a pre-pool wrap that embedded a group rather than pooling it',
    });
    return null;
  }
  return pe;
}

/**
 * The router. Resolves the source + target containers (via the registry) and
 * dispatches:
 * - a CENTER-zone slot-rect on a non-tabs container → generic WRAP-INTO-TABS.
 * - SAME container → `moveWithin` (the container's proven in-place move).
 * - CROSS container → `extract` from the source, `inject` into the target.
 * After a cross-container extract FROM a `tabs`, DISSOLVE it if it dropped to one.
 */
export function routeDrop(source: DragSource, target: DropTarget | null, ctx: DropContext): void {
  if (!target) return;
  // A CONTENT drop is handled by the async `routeDropWithGrouping` wrapper (resolution reads the engine
  // and may ask a chooser, which this synchronous path cannot do). Guard so a content payload can never
  // be mis-routed as a pane move here (it never reaches this path in normal flow — the wrapper returns
  // first — but a direct caller must not extract a file-path `localId`).
  if (ctx.content !== undefined) return;
  const src = findContainerRoot(ctx.sourceEl);
  const tgt = findContainerRoot(queryTargetElement(target));
  if (!src || !tgt) return;

  // CENTER-zone slot-rect on a container that is NOT ITSELF A GROUP → group the existing slot
  // content with the dropped subtree. A center drop on a container that DECLARES grouping is
  // add-a-child (deepest-wins already routed there; its `inject` handles it), so it is NOT
  // wrapped. Same- and cross-container both flow through here.
  //
  // The test asks whether this kind declared grouping,
  // so a third party's grouping container behaves identically with no change here.
  if (target.shape === 'slot-rect' && target.zone === 'center' && !isGroupingKind(target.containerKind)) {
    // SELF-REFERENTIAL WRAP GUARD. A center-wrap groups the target's OCCUPANT with the dropped subtree.
    // If the drag source sits INSIDE that occupant, the wrap would group a subtree with a pane extracted
    // from that same subtree — the occupant already contains it, so the pane is duplicated; and for a
    // distant ancestor it re-mounts the whole subtree, which can crash a child mid-move. Refuse, visibly.
    // Pull-out-into-split via an EDGE zone (SEAM 3) is unaffected — that stays the way to split it out.
    //
    // Structural + NAME-FREE: DOM containment, the substrate's own truthmaker (the parentage rule). It
    // holds for every container including a third party's, needs no declaration, and is the general form
    // of the guard `tabs` already hand-rolls for its own body (drop-dialect.ts).
    const occEl = queryTargetElement(target);
    if (occEl && src.el !== occEl && occEl.contains(src.el)) {
      reportHostDiagnostic({
        code: 'wrap-source-nested-in-target',
        severity: 'warning',
        subject: target.containerKind,
        message: `a center-drop would wrap ${target.containerKind}'s occupant with a pane dragged from INSIDE it, which is self-referential; refused (drop on an EDGE to split it out instead)`,
        detail: { sourceLocalId: source.localId, targetSlot: target.slotId, targetKind: target.containerKind },
      });
      return;
    }
    groupIntoDeclaredContainer(src, tgt, source, target, ctx.groupingOverride);
    return;
  }

  // Resolve the drag SOURCE address to the source container's canonical POSITION once — the reorder /
  // extract seams below are position-native. A migrated source that cannot resolve it aborts visibly
  // (`resolveAddress` traces the miss); an un-migrated one gets the raw localId (today's path).
  const srcPos = resolveAddress(src.placement, source.localId, 'drag-move');
  if (srcPos == null) return;

  if (sameContainerRoot(src.el, tgt.el)) {
    // A pane dropped on its OWN container's body CENTER (a `slot-rect` center zone) is a NO-OP — it is
    // already there, so it must neither reorder nor re-inject (re-injecting a same-container occupant is
    // what duplicated it). This is the tabs body drop; tabs reorders on the strip (a `gap`), never here.
    // An EDGE zone on a `slot-rect` is NOT a no-op — it is a legitimate same-container RE-SPLIT (bento's
    // only re-split gesture), which must fall through to SEAM 2 (`moveWithin` / `moveWithinEdit` →
    // `movePane`, keyed on `target.zone`). Guarding by shape alone silently swallowed every bento edge
    // move. (Bento's center is already consumed by the wrap branch above, so only edges reach here for it.)
    if (target.shape === 'slot-rect' && target.zone === 'center') return;
    // SEAM 2 — reorder in place. This path calls `moveWithin` and NEVER extracts, so a check
    // placed only before the extract below would miss reordering entirely. A fixed slot's
    // occupant does not move, including within its own container.
    if (displacementRefused(src.placement, srcPos, 'reorder')) return;
    // POOL-EDIT PATH: compute the reordered record purely + one atomic commit (one remount), so a
    // same-container reorder rides the same re-derive discipline as a cross-container move.
    const reorderPool = readyPoolEdit(src.placement);
    if (reorderPool) {
      const record = reorderPool.moveWithinEdit(srcPos, target);
      // NO-OP: the source dropped on its own position. Nothing to commit, and NOT a refusal — so no
      // diagnostic (a nudged-and-dropped-back tab must not raise `container-reorder-refused`).
      if (record === POOL_EDIT_NOOP) return;
      if (record == null) {
        reportHostDiagnostic({
          code: 'container-reorder-refused',
          severity: 'warning',
          subject: target.containerKind,
          message: `${target.containerKind}: reorder of "${source.localId}" was refused by the container`,
          detail: { localId: source.localId, containerKind: target.containerKind, shape: target.shape },
        });
        return;
      }
      reorderPool.propose([{ id: reorderPool.recordId(), record }]);
      return;
    }
    // The container APPLIES or REFUSES the reorder. A `false` is its OWN structural rule (an
    // unknown id, an unmovable region, a target it does not take) — distinct from the slot FIXITY
    // the line above already gated. Reporting it here makes a refused reorder observable for EVERY
    // container, including a third-party one that does not hand-roll its own diagnostic. It arrives
    // at ZERO: on our containers every reachable drop-path reorder is applied, so this fires only
    // for a genuine refusal (a future `containerOp` move, or a third-party container's own rule).
    if (!src.placement.moveWithin(srcPos, target)) {
      reportHostDiagnostic({
        code: 'container-reorder-refused',
        severity: 'warning',
        subject: target.containerKind,
        message: `${target.containerKind}: reorder of "${source.localId}" was refused by the container`,
        detail: { localId: source.localId, containerKind: target.containerKind, shape: target.shape },
      });
    }
    return;
  }

  // SEAM 3 — cross-container move. BOTH checks run BEFORE the destructive extract: the source
  // slot must release its occupant, and the target slot must accept it. Asking first is what
  // makes the refusal safe; a check after the extract is a lost subtree.
  if (displacementRefused(src.placement, srcPos, 'move')) return;
  if (target.shape !== 'empty' && target.shape !== 'free-point'
      && occupantRefused(tgt.placement, target.slotId, source.type, 'move')) return;

  // POOL-EDIT PATH — both containers compute their new records PURELY and the host litigates the
  // pool in ONE atomic commit. A re-parent is a reference RE-POINT: the source record drops the
  // child ref, the target record adds it, the child record is untouched, and the tree re-derives via
  // a single remount. Nothing mutates a live runtime tree in place (no `removeChild` crash) and no
  // container re-serializes a stale subtree snapshot (no duplication) — the two faults die by
  // construction here, not by discipline. Used only when BOTH containers declare `poolEdit`; a
  // container not yet converted falls through to the mutating seam below, so conversion is
  // incremental and the live drag never breaks.
  const srcPool = readyPoolEdit(src.placement);
  const tgtPool = readyPoolEdit(tgt.placement);
  if (srcPool && tgtPool) {
    const ex = srcPool.extractEdit(srcPos);
    if (!ex) return;
    const tgtRecord = tgtPool.injectEdit(ex.occupant.instance, ex.occupant.id, target);
    if (tgtRecord == null) return;
    // One commit, one re-render. The order is source-then-target so a same-id sanity check would see
    // the drop before the add; the host applies them together, then reaps orphans and remounts once.
    tgtPool.propose([
      { id: srcPool.recordId(), record: ex.record },
      { id: tgtPool.recordId(), record: tgtRecord },
    ]);
    return;
  }

  // FALLBACK — the mutating seam, for a container that has not declared `poolEdit` yet. This is the
  // path that carries the re-parent duplication + crash for an unconverted container; the substrate
  // detector below (`reportIfPaneSurvivedExtract`) keeps it from shipping SILENTLY.
  // CAPTURED BEFORE THE EXTRACT, because `panes()` is LIVE. See `dissolveIfCollapsed`.
  const before = src.placement.panes();
  const extracted = src.placement.extract(srcPos);
  if (!extracted) return;
  tgt.placement.inject(extracted.instance, extracted.id, target);
  dissolveIfCollapsed(src, source, before);
  reportIfPaneSurvivedExtract(src.placement, extracted.id);
}

/**
 * THE STALE-MODEL DETECTOR. After a completed cross-container move, the source must no longer
 * report the pane it just handed over. If it does, the move behaved as a COPY.
 *
 * WHY THE SUBSTRATE CHECKS THIS RATHER THAN EACH CONTAINER TRUSTING ITSELF. One drop drives the
 * seam SEVERAL TIMES IN ONE SYNCHRONOUS TICK — `extract` here, `inject` on the target, and when
 * that target is a container NESTED IN THE SOURCE, its save propagates straight back up and commits
 * again. A container whose seam methods read a render-closure model rebuilds that last commit from
 * a snapshot still holding what the first one removed, so the pane reappears where it came from,
 * and PERSISTS, because the resurrecting commit saves.
 *
 * The discipline that avoids it is irreducible — something must hold the post-commit value
 * synchronously, and no hook signature removes that. So this does not try to PREVENT the bug. It
 * makes the failure visible.
 * Crucially it asks nothing of the container author, so it covers a third-party container, one
 * written before the rule existed, and one whose state shape fits no helper we ship.
 *
 * DELIBERATELY NARROW. Only a completed CROSS-container move, where source and target differ and
 * the pane genuinely left. A container that re-adds a pane on purpose (an undo, a same-tick
 * re-parent back) would look identical from here, so anything wider would cry wolf — and a false
 * positive is a defect in this check, not in the container.
 *
 *
 */
function reportIfPaneSurvivedExtract(source: ContainerPlacement, paneId: PaneId): void {
  // `panes()` is the container's own answer, so this is only as good as that answer — kept narrow
  // and honest rather than clever for exactly that reason.
  if (!source.panes().includes(paneId)) return;
  reportHostDiagnostic({
    code: 'container-pane-survived-extract',
    severity: 'error',
    message:
      'a pane was moved to another container but its source still reports holding it, so the move behaved as a copy; the source container is very likely rebuilding its config from a render-closure model instead of the live one',
    detail: { paneId },
  });
}

/**
 * Wrap the target occupant and dropped pane in a declared grouping container.
 * Each child retains its own id; the new group receives a fresh id and the position keeps its id.
 * These identities are distinct because terminal sessions and view-state follow occupant ids.
 */
function groupIntoDeclaredContainer(
  src: { el: Element; placement: ContainerPlacement },
  tgt: { el: Element; placement: ContainerPlacement },
  source: DragSource,
  target: Extract<DropTarget, { shape: 'slot-rect' }>,
  capabilityOverride?: GroupingCapability | null,
): void {
  const existing = tgt.placement.getSlotContent(target.slotId);

  // Resolve the drag SOURCE address to the source container's canonical POSITION once — every source-side
  // seam below (the `dragged` read, extract, move, reparent) is position-native. The
  // TARGET's `slotId` is already a position (a DOM drop target), so it needs no resolve here. A migrated
  // source that cannot resolve aborts visibly.
  const srcPos = resolveAddress(src.placement, source.localId, 'drag-wrap');
  if (srcPos == null) return;

  // Resolve the grouping capability before extracting so a refusal cannot remove a subtree.
  // capabilityOverride carries a choice obtained by an asynchronous wrapper. Without it, use the
  // provider's configured or name-sorted choice.
  const capability = existing == null ? null : (capabilityOverride ?? groupingForNewGroup());
  if (existing != null && !capability) {
    // No container in the workspace DECLARES grouping, so there is nothing to build the group
    // with. Degrade VISIBLY and leave the layout untouched.
    reportHostDiagnostic({
      code: 'no-grouping-container-declared',
      severity: 'warning',
      message:
        'a center-zone drop needs a `grouping-container` to group the two panes into; none is present in this workspace, so the drop was refused',
      detail: { targetSlot: target.slotId, targetKind: target.containerKind },
    });
    return;
  }

  // SEAM 4 — centre-wrap, and the SECOND destructive extract. Everything below is asked BEFORE it.
  //
  // The source must be free to leave, and the target must accept what is about to be written into
  // it. What that IS differs by case, which is why the target check is not one line: an empty slot
  // receives the DROPPED subtree, while an occupied one receives a CONTAINER wrapping both. So a
  // slot admitting only editors refuses the wrap even though it admits the pane being dropped —
  // `admits` governs every occupant-TYPE change, and a wrap is one.
  if (displacementRefused(src.placement, srcPos, existing == null ? 'move' : 'group')) return;
  if (existing == null) {
    if (occupantRefused(tgt.placement, target.slotId, source.type, 'move')) return;
  } else if (restructureRefused(tgt.placement, target.slotId, capability!.typeName, 'group')) {
    return;
  }

  // POOL-EDIT PATH — the center-wrap as a reference re-point over the flat pool, one atomic commit.
  // The GROUP is minted as its OWN pool record REFERENCING [existing, dragged] (createGroup flattens
  // it), and the target slot is repointed at the group's id. Neither child is embedded, so nothing is
  // re-serialized as a stale snapshot (the duplication) and nothing mutates a live tree in place (the
  // crash). Used when BOTH containers declare `poolEdit`; else the mutating fallback below runs.
  const srcPool = readyPoolEdit(src.placement);
  const tgtPool = readyPoolEdit(tgt.placement);
  if (srcPool && tgtPool) {
    const crossContainer = src.el !== tgt.el;
    const dragged = src.placement.getSlotContent(srcPos);
    if (!dragged) return;
    if (existing == null) {
      // Empty target slot: place the dragged pane here, no group.
      if (crossContainer) {
        const ex = srcPool.extractEdit(srcPos);
        if (!ex) return;
        const tgtRecord = tgtPool.injectEdit(ex.occupant.instance, ex.occupant.id, target);
        if (tgtRecord == null) return;
        tgtPool.propose([
          { id: srcPool.recordId(), record: ex.record },
          { id: tgtPool.recordId(), record: tgtRecord },
        ]);
      } else {
        const record = tgtPool.moveWithinEdit(srcPos, target);
        if (record == null || record === POOL_EDIT_NOOP) return; // refused or no-op → commit nothing
        tgtPool.propose([{ id: tgtPool.recordId(), record }]);
      }
      return;
    }
    // Occupied slot: the SHARED producer mints the group referencing both occupants and repoints the slot
    // at it (the wrap), dropping the source's reference in the same edits — same container folds both into
    // one record, cross-container emits two. dock reduces to this same producer.
    const placed = reparentSafeCenter({
      incoming: dragged,
      existing,
      target: { poolEdit: tgtPool, containerKind: target.containerKind, slotId: target.slotId, descriptor: target },
      source: { poolEdit: srcPool, localId: srcPos },
      grouping: capability,
    });
    if (placed.ok && placed.edits.length > 0) tgtPool.propose(placed.edits);
    return;
  }

  // CAPTURED BEFORE THE EXTRACT, because `panes()` is LIVE. See `dissolveIfCollapsed`.
  const before = src.placement.panes();
  const extracted = src.placement.extract(srcPos);
  if (!extracted) return;

  // Only meaningful ACROSS containers: a same-container centre drop legitimately leaves the pane in
  // this container, just inside a group.
  const crossContainer = src.el !== tgt.el;

  if (existing == null) {
    // Empty target slot: nothing to group with — just place the dropped subtree.
    tgt.placement.inject(extracted.instance, extracted.id, target);
    dissolveIfCollapsed(src, source, before);
    if (crossContainer) reportIfPaneSurvivedExtract(src.placement, extracted.id);
    return;
  }

  // The container builds its own config. Pass each child's occupant id, never the position id,
  // so the wrapper and its children remain distinct pool records and preserve their view-state.
  const group = capability!.build([
    { id: existing.id, instance: existing.instance },
    { id: extracted.id, instance: extracted.instance },
  ]);
  // The wrapper is a record that DID NOT EXIST a moment ago, so it is named anew rather than
  // inheriting either id in play. Nothing references a synthesized wrapper, so a fresh id costs
  // nothing; adopting one costs a collision.
  tgt.placement.setSlotContent(target.slotId, group, mintBlockId());
  dissolveIfCollapsed(src, source, before);
  if (crossContainer) reportIfPaneSurvivedExtract(src.placement, extracted.id);
}

/**
 * Dissolve a container below its declared child-count floor by placing its remaining occupant
 * in the parent slot. Preserve that occupant's id, terminal session and view-state.
 */
function dissolveIfCollapsed(
  src: { el: Element; placement: ContainerPlacement },
  source: DragSource,
  /**
 * The source pane set captured before extraction. panes() reads the live model and can already
 * reflect extraction within the same synchronous tick, so the caller supplies this snapshot.
 */
  before: PaneId[],
): void {
  // Use the source container's declared minChildren floor. A container without a floor never dissolves.
  const minChildren = groupingForKind(source.containerKind)?.minChildren;
  if (minChildren === undefined || minChildren <= 1) return;
  const panes = before;
  // Only the 2 → 1 case dissolves, because the operation is "replace the group with its LONE
  // child" — there is no slot operation for putting N children back. So a container declaring
  // `minChildren: 3` left with 2 is under its own floor and is NOT repaired here; that needs a
  // different op and is deliberately out of scope rather than silently half-done.
  if (panes.length !== 2) return;
  const loneId = panes.find((id) => id !== source.localId);
  if (loneId === undefined) return;
  // Read the survivor at its canonical position (the boundary resolve; raw for an un-migrated container).
  const lonePos = resolveAddress(src.placement, loneId, 'dissolve-collapse');
  if (lonePos == null) return;
  const lone = src.placement.getSlotContent(lonePos);
  if (lone == null) return;

  const parent = findContainerRoot(src.el.parentElement);
  if (!parent) return;
  const parentSlotEl = src.el.parentElement?.closest('[data-droptarget-shape="slot-rect"][data-droptarget-id]');
  const parentSlotId = (parentSlotEl as HTMLElement | null)?.dataset['droptargetId'];
  if (parentSlotId === undefined) return;

  // SEAM 5 — dissolve. A dissolve REPLACES the group in the GRANDPARENT slot with the lone child,
  // so it is an occupant-type change at that slot and answers to its rules like any other. A slot
  // pinned to hold a tabs group therefore keeps its group at one child rather than being quietly
  // collapsed to a bare pane — which is the "editor group waiting for content" case, falling out
  // rather than needing its own mechanism.
  if (restructureRefused(parent.placement, parentSlotId, typeOfInstance(lone.instance), 'dissolve')) return;

  // Keep the surviving occupant's id when moving it into the parent slot, preserving its view-state and terminal.
  parent.placement.setSlotContent(parentSlotId, lone.instance, lone.id);
}

/**
 * Finish a content drop by minting and placing a viewer at the resolved target. Ask the grouping
 * chooser before an ambiguous center-wrap. Pointer drops and the native selection bridge share
 * this pooled commit path; the caller supplies the resolved content instance.
 * Respect slot admits rules and require an addressable pool record. The async boundary belongs
 * to choosing a grouping container, before the atomic placement commit.
 */
export async function placeContentDrop(instance: PaneInstance, target: DropTarget | null): Promise<void> {
  if (!target) return;
  // CENTER-WRAP AMBIGUITY, pane-drop parity: >=2 grouping containers declared and none requested → ASK
  // before placing (never a silent default). Runs after the instance resolved, so a cancelled viewer
  // never triggers a spurious grouping ask.
  let groupingOverride: GroupingCapability | undefined;
  const ambiguous = centerWrapContentGroupingOutcome(target);
  const chooser = groupingChooser();
  if (ambiguous && chooser) {
    const picked = await chooser(ambiguous.available);
    if (picked == null) return; // cancelled → the drop is abandoned
    groupingOverride = groupingForKind(picked) ?? undefined;
  }
  placeContent(instance, target, groupingOverride);
}

function placeContent(instance: PaneInstance, target: DropTarget, groupingOverride?: GroupingCapability): void {
  const tgt = findContainerRoot(queryTargetElement(target));
  if (!tgt) return;
  const pe = readyPoolEdit(tgt.placement);
  if (!pe) return; // legacy-inline container: no pool address → refuse (readyPoolEdit reported it)

  // CENTER on a non-grouping container holding an OCCUPANT → wrap the occupant with the minted viewer.
  if (target.shape === 'slot-rect' && target.zone === 'center' && !isGroupingKind(target.containerKind)) {
    const existing = tgt.placement.getSlotContent(target.slotId);
    if (existing != null) {
      // `groupingOverride` is the container the async wrapper already asked the user to pick for a >=2-way
      // ambiguity; absent, the provider's name-sorted default stands (a single declaring container needs no ask).
      const cap = groupingOverride ?? groupingForNewGroup();
      if (!cap) {
        reportHostDiagnostic({
          code: 'no-grouping-container-declared',
          severity: 'warning',
          message:
            'a center-zone content drop needs a `grouping-container` to group the occupant with the opened file into; none is present in this workspace, so the drop was refused',
          detail: { targetSlot: target.slotId, targetKind: target.containerKind },
        });
        return;
      }
      // A wrap writes a CONTAINER into the slot, so it answers to the slot's own `fixed` / `admits`.
      if (restructureRefused(tgt.placement, target.slotId, cap.typeName, 'group')) return;
      const contentMint = pe.createRecord(instance);
      const group = cap.build([
        { id: existing.id, instance: existing.instance },
        { id: contentMint.rootId, instance },
      ]) as PaneInstance;
      const groupMint = pe.createGroup(group);
      const record = pe.wrapEdit(target.slotId, group, groupMint.rootId);
      if (record == null) return;
      pe.propose([...contentMint.edits, ...groupMint.edits, { id: pe.recordId(), record }]);
      return;
    }
    // empty center → fall through to a plain inject.
  }

  // EDGE / GAP / EMPTY / free-point / empty-center → INJECT the minted viewer, after the slot's `admits`.
  // `empty` / `free-point` name no slot, so the admits check applies only where a `slotId` exists.
  if (
    target.shape !== 'empty' &&
    target.shape !== 'free-point' &&
    occupantRefused(tgt.placement, target.slotId, typeOfInstance(instance), 'place')
  ) {
    return;
  }
  const contentMint = pe.createRecord(instance);
  const record = pe.injectEdit(instance, contentMint.rootId, target);
  if (record == null) return;
  pe.propose([...contentMint.edits, { id: pe.recordId(), record }]);
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * The CONTENT peer of {@link centerWrapGroupingOutcome}: the ambiguous grouping outcome for a center
 * content drop onto an OCCUPIED slot, else `null`. Simpler than the pane one — a content drag has NO
 * source subtree, so there is no self-referential-nest case to exclude. Reads the provider outcome; the
 * async wrapper uses it to decide whether to ASK before `placeContent`.
 */
function centerWrapContentGroupingOutcome(target: DropTarget | null): { available: readonly string[] } | null {
  if (!target || target.shape !== 'slot-rect' || target.zone !== 'center') return null;
  if (isGroupingKind(target.containerKind)) return null; // a center drop on a GROUP adds a child, no wrap
  const tgt = findContainerRoot(queryTargetElement(target));
  if (!tgt) return null;
  if (tgt.placement.getSlotContent(target.slotId) == null) return null; // empty slot → place, no group
  const outcome = groupingOutcomeForNewGroup();
  if (!outcome || outcome.reason !== 'defaulted') return null; // single / requested / none → no ask
  return { available: outcome.available };
}

/**
 * For a center-WRAP drop that would form a NEW group, the AMBIGUOUS grouping outcome — the available
 * container type names when >=2 declare grouping and none was requested — else `null`. Synchronous and
 * side-effect-free: it mirrors `routeDrop`'s wrap predicate (a `slot-rect` center zone on a non-group
 * container, an OCCUPIED slot, not a self-referential nest) and reads the provider outcome. The async
 * wrapper below uses it to decide whether to ASK before routing.
 */
export function centerWrapGroupingOutcome(
  source: DragSource,
  target: DropTarget | null,
  ctx: DropContext,
): { available: readonly string[] } | null {
  void source;
  if (!target || target.shape !== 'slot-rect' || target.zone !== 'center') return null;
  if (isGroupingKind(target.containerKind)) return null; // a center drop on a GROUP adds a child, no wrap
  const tgt = findContainerRoot(queryTargetElement(target));
  if (!tgt) return null;
  if (tgt.placement.getSlotContent(target.slotId) == null) return null; // empty slot → place, no group
  // A self-referential wrap is REFUSED by routeDrop (no group forms), so there is nothing to ask.
  const src = findContainerRoot(ctx.sourceEl);
  const occEl = queryTargetElement(target);
  if (src && occEl && src.el !== occEl && occEl.contains(src.el)) return null;
  const outcome = groupingOutcomeForNewGroup();
  if (!outcome || outcome.reason !== 'defaulted') return null; // single / requested / none → no ask
  return { available: outcome.available };
}

/**
 * The DROP handler the drag store calls (installed by the overlay in place of bare `routeDrop`). For an
 * AMBIGUOUS center-wrap it ASKS the host chooser BEFORE routing, then calls the SYNCHRONOUS `routeDrop`
 * with the pick as `ctx.groupingOverride`; every other drop routes straight through. A cancel aborts the
 * drop. With no chooser installed it degrades to today's provider default. This is the only async seam;
 * `routeDrop` itself stays synchronous.
 */
export async function routeDropWithGrouping(
  source: DragSource,
  target: DropHit | null,
  ctx: DropContext,
): Promise<void> {
  // CONTENT-DESTINATION — a self-declared surface (a folder row) owns the outcome. Dispatch-by-target-kind:
  // hand it the drag and let it decide (a folder moves the file through the blast-radius preview). The
  // router never centralizes a surface outcome. `accepts` already gated this at hit-test time, so reaching
  // here means the surface took it.
  if (isContentDropHit(target)) {
    target.spec.onDrop(source, ctx.content);
    return;
  }
  // From here `target` is a container `DropTarget | null` (the guard narrowed it).
  // CONTENT branch — resolve (async) then MINT-AND-PLACE. Reached BEFORE any source-container walk,
  // because a content drag's `ctx.sourceEl` is a file ROW: the pane path would reach the container the
  // tree lives in and `extract` a `localId` that is a file path. Its PRESENCE (not its shape) selects
  // this branch; the host-installed resolver interprets the opaque payload. A null resolution (no
  // resolver, an unviewable selection, or a cancelled must-pick chooser) abandons the drop.
  if (ctx.content !== undefined) {
    if (!target) return;
    const instance = contentResolver ? await contentResolver(ctx.content) : null;
    if (instance == null) return;
    await placeContentDrop(instance, target);
    return;
  }
  const ambiguous = centerWrapGroupingOutcome(source, target, ctx);
  const chooser = groupingChooser();
  if (ambiguous && chooser) {
    const picked = await chooser(ambiguous.available);
    if (picked == null) return; // cancelled → the drop is abandoned
    const capability = groupingForKind(picked) ?? undefined;
    routeDrop(source, target, { ...ctx, groupingOverride: capability });
    return;
  }
  routeDrop(source, target, ctx);
}
