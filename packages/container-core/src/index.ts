// @arsumbris/container-core — the FRAMEWORK-AGNOSTIC runtime of the container
// substrate: the drag store, the placement registry + fan-out router, the DOM
// hit-tester, and the zone geometry. NO React.

// Window-global singletons share the drag store and placement registry across projection bundles
// and the host overlay. See singletons.ts.

// The React bindings (the `useLayoutDrag` hook, `useContainerPlacement`,
// `useContainerDialect`, `DragOverlay`, `PaneProjection`, `PanePicker`) live in
// `@arsumbris/container-kit` and depend on this package.



// The generic drop vocabulary + protocol types (re-exported from host-sdk).
export * from './types.ts';

// Pure zone geometry + the dialect-driven drop resolver.
export { computeRectZone, edgeBandPx, bandFracFor, CENTER_BAND, computeHorizontalInsertIndex, visualToLogicalIndex } from './zones.ts';
// resolveTargetsAll collects and orders targets emitted by container dialects.
export { resolveTargetsAll } from './hit-test.ts';

// The shared drag store (the vanilla instance) + its shape.
export { dragStore } from './singletons.ts';

// The drag-INITIATION gesture (the SOURCE half, vanilla) — a container calls it from its own pointerdown.
// Peer of `attachContainer`'s receive half, so a non-React container sources a drag with no React. The
// React `useDragStart` hook is a thin skin over this.
export { startDragGesture, DRAG_THRESHOLD_PX } from './drag-gesture.ts';
export type { DragStartSpec } from './drag-gesture.ts';

// The live intent census: the host INSTALLS it over its private IntentTree, the layout-inspector READS
// it. On the window-global because the inspector is its own bundle. See intent-census.ts.
export { setIntentCensusProvider, readIntentCensus } from './intent-census.ts';
export type { IntentCensus } from './intent-census.ts';

// THE READER'S HANDLES. `containerRoots` is the registered-container SET — it exists precisely
// because a `WeakMap` cannot be iterated, and a tool that wants to describe the whole composition
// has to enumerate. `registry` maps a root to its `ContainerPlacement`, which is what lets a reader
// ASK a container about its slots rather than requiring the container to self-declare them into the
// DOM for a reader's benefit. Both are read-only from a consumer's side by convention.
export { containerRoots, registry, findContainerRoot, dragSourceIsFrom } from './singletons.ts';
export type { LayoutDragStore, DropContext } from './store.ts';

// The placement registry ops + the dialect registry ops + the fan-out drop router.
export {
  registerContainer,
  deregisterContainer,
  registerDialect,
  deregisterDialect,
  // Declare ANY surface (a folder row) as a content-destination — it accepts a content drag and owns the
  // drop's outcome. Included in the deepest-wins hit-test when its `accepts` passes. See ./registry.ts.
  registerDropTarget,
  routeDrop,
  // The grouping-aware async drop handler the overlay installs in place of bare `routeDrop`: it asks
  // the host chooser for an ambiguous center-wrap before routing. `centerWrapGroupingOutcome` is the
  // sync predicate it (and tests) use to detect that ambiguity.
  routeDropWithGrouping,
  centerWrapGroupingOutcome,
  // Pane→container resolution for an out-of-band caller (the agent-host transport
  // `containerOp`): a stable pane id with no source DOM element to walk up from.
  findPlacementByPane,
  // The portal-anchor form (DOM query, else `findPlacementByPane`): resolve the container holding a
  // pane from a projection bundle. Lets a placeholder read its OWN slot (`placementForPane(id).slotFor`)
  // to filter the viewers it offers by `admits`. See ./registry.ts.
  placementForPane,
  // Normalize occupant or position addresses through ContainerPlacement.resolve at the boundary.
  // The host authority and container operations share this implementation; see registry.ts.
  resolveAddress,
  activatePane,
  // The FLOOR under every container's own close affordance. The ✕ is chrome and therefore the
  // container's, in whatever framework it is written — so the substrate cannot draw it, but it can
  // guarantee a child is always removable by SOME means. `extract` is required on the seam, so
  // this asks nothing of the container author. See ./registry.ts.
  closePane,
  // The address-based sibling of `closePane` for the open chooser's FLOOR: wrap a bare pane into a
  // new group by its stable id, so a dead-ended file gets an in-place home. See ./registry.ts.
  wrapPane,
  // The pane-header "wrap in a container" affordance: wrap a bare pane into a NEW SINGLE-CHILD group,
  // and its interactive picker wrapper (kind via `group-into` / sole target, else the chooser). See ./registry.ts.
  wrapPaneSolo,
  wrapPaneInteractive,
  // The inverse: UNWRAP the container enclosing a pane when it holds only that one child (the lone child
  // lifts into the grandparent slot, id preserved). Address-based sibling of `dissolveIfCollapsed`. See ./registry.ts.
  dissolvePane,
  // SET a position's occupant over the placement seam (`setSlotContent`) — fill an empty slot or replace
  // an occupied one, addressed by id, honouring admits/fixed. The ONE op the empty-slot placeholder fill
  // and the pane swap share; reachable from a placeholder's bundle. See ./registry.ts.
  setPaneContent,
  // The CONTENT resolver the HOST installs: a dropped content payload → a viewer instance to place.
  // `routeDropWithGrouping`'s content branch AWAITS it (resolution reads the engine + may ask a chooser).
  // See ./registry.ts.
  setContentResolver,
  // Mint-and-place a resolved content instance at a target (+ the center-wrap grouping chooser). The shared
  // tail both content INPUTS converge on: the pointer branch, and the host's native selection-drop bridge.
  placeContentDrop,
} from './registry.ts';
export type { WrapOutcome, ContentResolver, WrapInteractiveOpts, DissolveOutcome } from './registry.ts';

// The SAFE-CENTER re-parent producer: places an existing pool record into a target slot (wrap-into-a-
// grouping-container on an occupied non-grouping slot, else inject), RETURNING the record edits rather
// than committing. The drop router and dock both reduce to calling it, then committing once through the
// single authority.
export { reparentSafeCenter } from './reparent.ts';
export type { StructuralEdit, ReparentArgs, ReparentSource, ReparentOutcome, Reparented } from './reparent.ts';

// The host installs grouping capabilities; routeDrop selects one and calls its builder.
// The substrate does not name containers or encode their configs. See grouping.ts.
export { setGroupingProvider, groupingForKind, groupingForNewGroup, isGroupingKind, chooseGrouping, setGroupingChooser, groupingChooser, groupingOutcomeForNewGroup, groupNewPanesEnabled } from './grouping.ts';
export type { GroupingCapability, GroupingProvider, GroupingChoiceOutcome, GroupingChoiceReason, GroupingChooser } from './grouping.ts';
// The DECOUPLED wrap-target registry (grouping ∪ spatial), read by the WRAP action, never the drop path.
export { setWrapTargets, wrapTargets, wrapTargetForKind, wrapTargetOutcome } from './grouping.ts';
export type { WrapTarget } from './grouping.ts';

// SLOT-RULE ENFORCEMENT, once, for every container. A container answers `slotFor(id)`; the
// substrate decides what `fixed` and `admits` MEAN and checks at five seams — never destroying
// state it may not be allowed to write. The host installs the type-closure predicate `admits` is
// checked with, the same producer/consumer split as the grouping lookup. See ./slots.ts.
export {
  setSlotTypeProvider,
  slotFor,
  slotAdmits,
  displacementRefused,
  occupantRefused,
  restructureRefused,
  dragStartRefused,
  typeOfInstance,
  refToTypeName,
} from './slots.ts';
export type { SlotTypeProvider, SlotGesture } from './slots.ts';

// Shared slot-union codec. Resolve slot records by type closure so subtypes retain their rules.
// Containers supply their slot type and extra fields; see slot-codec.ts.
export { makeSlotCodec, persistedId } from './slot-codec.ts';

// The substrate's own `^:` minter, for a record IT synthesizes. See ./block-id.ts.
export { mintBlockId, _resetBlockIdsForTests } from './block-id.ts';

// The host-assigns-pool-identity seam: a container hands the host new content and gets back the `^:`
// id, holding the child as a reference unit — it never mints a pool id. See ./content-leaf.ts.
export { createChild } from './content-leaf.ts';
export type { Position, SlotCodec, SlotCodecOptions, SlotState } from './slot-codec.ts';

// Framework-agnostic projection label helpers for both vanilla and React containers.
// See projection-label.ts for declared-title lookup and type-name fallback.
export { bareTypeName, projectionLabel, descriptorLabel, projectionTitleLookup, projectionBreakpointsLookup } from './projection-label.ts';
export type { Breakpoint } from './projection-label.ts';
// THE HOST DECISION RESOLVER — the one `configured > sole > ask > nothing` ladder every "which one?"
// decision resolves through. The value instantiations (`resolveViewer`, `chooseGrouping`) express their
// ladder over it; the target instantiation (intent routing) maps onto it without a rewrite. See ./resolve.ts.
export { resolveDecision } from './resolve.ts';
export type { ResolveOutcome, Decision } from './resolve.ts';

// Viewer resolution — which projection opens a file, from `opens-meta`, never hardcoded.
export { resolveViewer, extensionOf, viewerPickOptions } from './viewer-resolve.ts';
export type { ViewerResolution, ViewerDefaultEntry, ViewerPickOption } from './viewer-resolve.ts';
export { viewerSwitchSets, runViewerSwitch } from './switch-viewer.ts';
export type { SwitchHost, SwitchOutcome, SwitchGroup, ViewerSwitchSets } from './switch-viewer.ts';
// How a container names a POSITION: an authored slot `label`, else the occupant's human name. ONE
// function, never suppressed, so no container author has to choose — a suppressing variant only fits
// a region title and blanks a tab strip, and picking wrong failed silently. See ./projection-label.ts.
export { positionName } from './projection-label.ts';
export type { LabelledSlot } from './projection-label.ts';

// The container's runtime model, held so a SEAM METHOD always reads the LIVE one rather than the
// model captured by the last render. One drop drives the seam several times in one synchronous
// tick, so a mutation built on a captured model resurrects what an earlier commit removed. The
// React binding is container-kit's `useContainerModel`. See ./model-cell.ts.
export { createModelCell, assertDeterministicRead } from './model-cell.ts';
export type { ModelCell } from './model-cell.ts';

// The FRAMEWORK-FREE container declaration. One registration path for React and vanilla alike, so
// the router cannot tell them apart — which is what makes "React is blessed, not required" true at
// this layer rather than aspirational. The React hooks in container-kit wrap this.
export { attachContainer, stableFacade } from './attach.ts';
export type { ContainerAttachment, ContainerDeclaration } from './attach.ts';

// Mount a child projection in a slot without a UI-framework dependency. See mount-child.ts.
export { mountChild } from './mount-child.ts';
export type { ChildMount, MountChildOptions } from './mount-child.ts';

// Build the atomic poolEdit seam from a container's pure model transforms, without a UI framework dependency.
export { makePoolEdit, withCarry } from './pool-edit.ts';
export type { PoolEditModel } from './pool-edit.ts';

// THE PORTAL REGISTRY (framework-agnostic core of the pane-portal layer): a pane mounts ONCE into a
// stable host element and is `appendChild`-ed into whatever anchor claims it, so a re-parent never
// unmounts it. An anchor IS a DOM element carrying `data-pane-id`: containers (React `usePaneAnchor` /
// vanilla `mountChild`) just set the attribute, and the host-owned `installPaneAnchorObserver` derives
// `paneAnchors` from the DOM — the sole writer. (`scanAnchors` / `applyAnchorMutations` are the internal
// derivation steps, test-imported from `pane-portal.ts` directly, so only the install entry is public.)
export {
  createPortalRegistry,
  reconcilePanePortals,
  registerPaneHost,
  unregisterPaneHost,
  setPanePortalParkingHost,
  installPaneAnchorObserver,
} from './pane-portal.ts';
export type { PortalRegistry } from './pane-portal.ts';

// THE PANE-HEADER CONTRIBUTION seam: a container's pane header is a regioned surface; an occupant
// contributes header content (a tabs strip) into an offered region, sharing ONE bar with the grip +
// actions. DOM-authoritative by `data-pane-id` (`paneIdForElement`), shared cross-bundle. The React
// ergonomics (`useOfferedHeaderRegion` / `useHeaderContribution`) live in container-kit.

export {
  offerHeaderRegion,
  withdrawHeaderRegion,
  isHeaderRegionClaimed,
  offeredHeaderRegion,
  setHeaderRegionClaimed,
  subscribeHeaderRegions,
  paneIdForElement,
} from './pane-header.ts';
export type { HeaderOffer } from './pane-header.ts';

export { projectionIconLookup, tabContentIcon } from './projection-icon'
