// @arsumbris/container-kit — the shared container substrate (React paved-path IMPLEMENTATION).

// The generic container machinery every container-projection composes, so a
// container owns ONLY its own layout dialect. The framework-agnostic CONTRACT
// (the `ContainerPlacement` seam + the re-parenting/drop vocabulary) lives in
// `@arsumbris/au-host-sdk`; this package is its React implementation.



// A THIN kit: ONLY what every React container-projection genuinely reuses —
//   - runtime bindings over the shared container-core store/registry:
//     `useLayoutDrag`, `useDragStart`, `useContainerPlacement`, `useContainerDialect`
//     (+ `useMergedRef`);
//   - shared helpers: `PaneProjection` (pane-into-slot mount), `DragOverlay` (the
//     host-mounted resolved-target preview), `PanePicker`.
// Per-container specifics live in the CONTAINER, not here: a container's drop DIALECT
// (emit/present/behave) + its strip UI.

// Shared intent handlers for open, reveal, open-pane and promote.

// Re-export the framework-agnostic drag protocol from container-core alongside its React bindings.
// The core store and registry are shared across projection bundles through a window singleton.
export * from './drag'

// Mount a child projection into a container slot.
export { PaneProjection } from './PaneProjection'

// The PORTAL LAYER: a pane mounts ONCE into an imperative host and portals
// into whatever slot anchor claims it, so a re-parent relocates its live DOM instead of tearing it
// down. Containers render `usePaneAnchor` targets; the kernel renders `PanePortalLayer` over the pool.
export { PanePortalLayer, PaneHost, usePaneAnchor } from './pane-portal'

// Empty-slot projection picker and the helper that reads the host's projection descriptors,
// with a bare-name fallback.
export { PanePicker, describeForPicker, admitsNoteFor } from './PanePicker'

// THE EMPTY-SLOT DRIVER — the substrate's ONE empty-slot realization: resolves which
// `placeholder-projection` shows (the host decision ladder) and mounts it as a runtime-only node that
// fills its own slot via the placement seam. Replaces each container's hand-wired `<PanePicker>` branch.
export { EmptySlot } from './EmptySlot'

// Universal pane SWAP — replace a slot's projection in place, carrying its document. The affordance
// + document-carry over the picker, so every container wires swap identically.
export { usePaneSwap, type PaneSwap } from './use-swap'

// Shared pane-action buttons: grip, swap and close. Containers compose their own layouts and handlers.
export { PaneActions, type PaneAction, type PaneActionKind } from './PaneActions'
// The shared ⋯ overflow menu — every container collapses its occupant-level actions behind one affordance.
export { paneActionsMenu, floatPaneRow, moveToWindowRow, reloadPaneRows } from './PaneActionsMenu'

// The shared pointer-capture boilerplate for a resize sash — capture / follow / release / clean up,
// with the per-dialect physics supplied by the consumer's `begin`. Used by every container's sash
// (`<au-splitter>` rides its `dragging` state). See use-resize-drag.ts.
export { useResizeDrag, type ResizeDragHandlers } from './use-resize-drag'

// Native-DnD → host bridge for a dropped SELECTION (a wikilink from the reader). The host installs the
// opener (resolution + open need engine + discovery). See selection-drop.ts.
export { installSelectionDrop, SELECTION_DRAG_MIME, type SelectionDropPoint } from './selection-drop'

// The tabs projection owns TabGroup; container-kit supplies layout-independent container helpers.

// React ergonomics for declaring a container's ContainerPlacement to the shared
// router (the registry + routeDrop live in container-core).
export { useContainerPlacement } from './container-router'

// React ergonomics for declaring a container's drop ContainerDialect (target
// emission + drag behaviours) + merging it with the placement ref.
export { useContainerDialect, useMergedRef } from './container-dialect'

// The container's runtime model. `model` for render, `live()` for every mutation and every seam
// method, `commit` to advance and persist. The rule it exists for: one drop drives the seam several
// times in ONE tick, so a seam method reading the render-closure model rebuilds from a stale
// snapshot and resurrects what an earlier commit removed. See ./use-container-model.ts.
export { useContainerModel } from './use-container-model'
export type { ContainerModel } from './use-container-model'

// THE PANE-HEADER CONTRIBUTION hooks: a container OFFERS a header region, an occupant CONTRIBUTES into
// it (a tabs strip sharing ONE bar with the grip + actions). `paneIdForElement` resolves the enclosing
// pane from an occupant's mount container (DOM-authoritative). See ./pane-header.tsx.
export { useOfferedHeaderRegion, useHeaderContribution, useEnclosingPaneId } from './pane-header'
export { paneIdForElement } from '@arsumbris/container-core'
// The poolEdit paved path: a container's pure model transforms → the atomic pool re-point seam.
// Framework-agnostic, so it LIVES in container-core; re-exported here for the React containers.
export { makePoolEdit, withCarry } from '@arsumbris/container-core'
export type { PoolEditModel } from '@arsumbris/container-core'

// Pool-identity seam: `createChild` has the HOST assign a new child's `^:` id (the container
// holds a reference unit, never mints). `mintBlockId` is the substrate minter for the pool-less
// fallback + synthesized records. Framework-agnostic, so both live in container-core.
export { createChild, mintBlockId } from '@arsumbris/container-core'

// Projection label helpers live in container-core so both vanilla and React containers can use them.
export { bareTypeName, projectionLabel, descriptorLabel, positionName, projectionTitleLookup, projectionBreakpointsLookup, resolveViewer, extensionOf, viewerPickOptions } from '@arsumbris/container-core'
export type { Breakpoint } from '@arsumbris/container-core'
export type { ViewerResolution, ViewerDefaultEntry, ViewerPickOption } from '@arsumbris/container-core'

export { projectionIconLookup, tabContentIcon } from '@arsumbris/container-core'
