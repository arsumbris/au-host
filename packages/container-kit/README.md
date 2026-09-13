# `@arsumbris/container-kit`

The **React paved-path implementation** of the au-host container substrate.

A container arranges child views; the substrate is the shared machinery every container composes, so
a container owns ONLY its own layout dialect. This package is the React half of that substrate — the
bindings and components a React `container-projection` uses to declare itself to the shared runtime and
to render panes, drops, and pickers the way every container does.

A THIN kit by design: only what every React container genuinely reuses. Per-container specifics (a
container's own drop dialect, its strip UI) live in the container, not here.

## Where it sits

The container substrate splits into three layers:

- **`@arsumbris/au-host-sdk`** — the CONTRACT (`ContainerPlacement` + the drop/re-parent vocabulary).
- **`@arsumbris/container-core`** — the framework-agnostic RUNTIME (drag store, placement registry,
  drop router, hit-testing, resolution helpers). No React.
- **`@arsumbris/container-kit`** (this package) — the React IMPLEMENTATION over that runtime.

`container-kit` depends on `container-core` and `au-host-sdk` (plus `au-component-catalog` for the
`<au-*>` React wrappers, and `react` / `react-dom`). It re-exports the whole `container-core` surface,
so a React container imports from here and gets the runtime through it.

## What's in it

- **Registering a container.** `useContainerPlacement` (declare this container's `ContainerPlacement`
  to the shared router) and `useContainerDialect` / `useMergedRef` (declare its drop dialect).
- **The container's runtime model.** `useContainerModel` — `model` for render, `live()` for mutations,
  `commit` to advance and persist.
- **Rendering panes.** `PaneProjection` (mount a pane into a slot), `EmptySlot` (the substrate's single
  empty-slot realization — resolves which placeholder shows and mounts it), and the pane-portal layer
  (`PanePortalLayer`, `PaneHost`, `usePaneAnchor`) so a pane mounts once and portals into whichever slot
  claims it — a re-parent relocates live DOM instead of tearing it down.
- **Drag and drop.** `useLayoutDrag`, `useDragStart`, and `DragOverlay` (the host-mounted preview of the
  resolved drop target). The router itself (`routeDrop`, wrap/dissolve) comes from `container-core`.
- **Pane affordances.** `PaneActions` (the grip / swap / close cluster), `paneActionsMenu` /
  `floatPaneRow` / `moveToWindowRow` (the ⋯ overflow menu), `usePaneSwap`, `useResizeDrag`, and the
  pane-header contribution hooks (`useOfferedHeaderRegion`, `useHeaderContribution`).
- **The picker.** `PanePicker` + `describeForPicker` — the empty-slot projection picker.
- **Bridges.** `installSelectionDrop` — the native-DnD bridge for a dropped selection (e.g. a wikilink
  dragged from the reader).

Note: `TabGroup` is NOT here. Now that tabs is a peer container, only it renders a tab strip, so that
lives in `projections/tabs`. This kit keeps only the shared bindings and helpers.

## How it's consumed

Consumed as **TypeScript source** — there is no build step. Import from `@arsumbris/container-kit`.

A React `container-projection` implements the `ContainerPlacement` contract (from `au-host-sdk`),
declares it with `useContainerPlacement`, and renders its children with `PaneProjection` / `EmptySlot`;
the shared router then handles drag, drop, and re-parenting across every container uniformly. See
`@arsumbris/au-host-sdk`'s README for the container-projection authoring flow.
