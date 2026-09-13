# `@arsumbris/container-core`

The **framework-agnostic runtime** of the au-host container substrate. No React.

A container arranges child views; the substrate is the shared machinery every container composes, so
a container owns ONLY its own layout dialect. This package is the framework-agnostic half of that
substrate — the drag store, the placement registry and drop router, the DOM hit-tester, the zone
geometry, and the model/resolution helpers. Its React bindings live in `@arsumbris/container-kit`.

## Where it sits

The container substrate splits into three layers:

- **`@arsumbris/au-host-sdk`** — the CONTRACT. Defines the `ContainerPlacement` interface a container
  implements, plus the drop/re-parent vocabulary. Pure types, no runtime.
- **`@arsumbris/container-core`** (this package) — the framework-agnostic RUNTIME over that contract.
  The registry that maps a container's root element to its `ContainerPlacement`, the drop router that
  drives it without knowing its dialect, the drag store, hit-testing, and the resolution helpers.
- **`@arsumbris/container-kit`** — the React paved-path IMPLEMENTATION. The bindings and components a
  React container uses to declare itself to this runtime.

`container-core` depends only on `au-host-sdk` (for the contract types) and `zustand` (the drag store).
It has NO React dependency.

## What's in it

- **The drag store + singletons.** `dragStore`, `containerRoots`, `registry` — shared across projection
  bundles via a window-global singleton, so every container (bento, tabs, the host overlay) shares ONE
  drag store and ONE placement registry. This is what makes cross-container drag possible.
- **The placement registry + fan-out drop router.** `registerContainer` / `deregisterContainer`,
  `registerDropTarget`, `routeDrop` / `routeDropWithGrouping`, and the placement ops a drop resolves to:
  `activatePane`, `closePane`, `wrapPane*`, `dissolvePane`, `setPaneContent`, `placeContentDrop`.
- **Zone geometry + hit-testing.** `computeRectZone`, `edgeBandPx`, `computeHorizontalInsertIndex`,
  `resolveTargetsAll` — the deepest-wins, dialect-driven resolution of a pointer to a drop target.
- **Re-parenting.** `reparentSafeCenter` — produces the record edits for an extract/inject move; one
  gesture-scoped apply is the sole commit.
- **Slot rules.** `slotFor`, `slotAdmits`, and the refusal predicates (`displacementRefused`,
  `occupantRefused`, ...) that enforce a slot's `admits` / `fixed` rules at the placement seam.
- **Resolution helpers.** `resolveViewer` (which viewer opens a file kind), `resolveDecision` (the host
  decision ladder), the grouping-capability lookup, and the projection-label helpers (`bareTypeName`,
  `projectionLabel`).
- **Identity + model.** `mintBlockId` (pool block-ids), `createChild` (the pool-identity seam),
  `createModelCell`, `makePoolEdit`, and the framework-free container declaration (`attachContainer`,
  `mountChild`) a vanilla (non-React) container uses directly.
- **The pane-portal registry + pane-header seam.** `createPortalRegistry` / `reconcilePanePortals`
  (mount-once-and-portal so a re-parent relocates live DOM), and `offerHeaderRegion` (an occupant
  contributes content into its pane's header).

## How it's consumed

Consumed as **TypeScript source** — there is no build step. Import from `@arsumbris/container-core`.

- a **React** container-projection normally reaches this runtime through `@arsumbris/container-kit`,
  which re-exports it.
- a **vanilla** (non-React) container (e.g. the dock) uses this package directly —
  `attachContainer`, `mountChild`, `makePoolEdit`.

Either way, a container's job is to implement the `ContainerPlacement` contract (from `au-host-sdk`)
and register it here; the router then drives placement without knowing the container's layout dialect.
