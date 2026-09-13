/**
 * The shared singletons: the drag store + the container-placement / dialect registries + the
 * host-installed provider holders. Every bundle (the shell + every projection) MUST see ONE instance, so
 * that cross-container drag between bento's bundle and the tabs bundle uses one store and the host's
 * providers reach the `routeDrop` running inside a projection.
 *
 * STORAGE. Every renderer bundle resolves ONE served copy of `container-core` (the shared-dep platform),
 * so this is a plain module singleton (`init()` → `local`). The ONE exception is `pnpm dev`: vite serves
 * the shell live on its own copy, so the shell and the projections are split instances — then, and only
 * then, they share the object through the `__AU_CONTAINER_CORE__` window-global (see `bridging()`). The
 * exported consts below bind to whichever `init()` returns.
 *
 */

import type { ContainerDialect, ContainerPlacement } from '@arsumbris/au-host-sdk';
import type { StoreApi } from 'zustand/vanilla';
import { createDragStore, type LayoutDragStore } from './store.ts';
import type { ContentDropSpec } from './types.ts';

const KEY = '__AU_CONTAINER_CORE__';

// Whether the shell + this bundle are SPLIT copies (the vite-served dev shell — see the header). Set once
// at renderer boot (`__AU_DEV__`) BEFORE this module evaluates (the entries import the flag first),
// so the eager `const shared = init()` below reads it correctly.
const bridging = (): boolean => (globalThis as Record<string, unknown>).__AU_DEV__ === true;

interface Shared {
  dragStore: StoreApi<LayoutDragStore>;
  /** Container root element → its declared `ContainerPlacement`. Auto-cleans on
   *  unmount (WeakMap) + on explicit deregister. */
  registry: WeakMap<Element, ContainerPlacement>;
  /** Container root element → its declared drop `ContainerDialect` (target
   *  emission + drag behaviours). Same key as `registry` (the container's root
   *  el). Auto-cleans on unmount (WeakMap) + on explicit deregister. */
  dialectRegistry: WeakMap<Element, ContainerDialect>;
  /** Surface element → its declared content-drop contract (`registerDropTarget`). A CONTENT-DESTINATION
   *  (a folder row) that is not a container: the hit-test consults it during the deepest-wins up-walk.
   *  Auto-cleans on unmount (WeakMap) + on explicit deregister. No enumerable twin — lookup is by the
   *  `cur` element during the walk, never a full scan. */
  contentDropTargets: WeakMap<Element, ContentDropSpec>;
  /** The ENUMERABLE set of registered container roots, parallel to `registry` (a
   *  WeakMap can't be iterated). Maintained by `registerContainer`/`deregisterContainer`,
   *  which are reliably paired on unmount (the container-kit callback ref deregisters
   *  the old el), so it does not leak. Enables pane→container resolution for an
   *  out-of-band caller (the agent-host transport `containerOp`), which has a stable
   *  pane id but no source DOM element to walk up from. */
  containerRoots: Set<Element>;
  /** The host-installed GROUPING lookup (see `grouping.ts`). A mutable holder rather than a
   *  bare field, so `setGroupingProvider` writes through to the one shared object every
   *  bundle's copy reads — the producer is the HOST bundle, the consumer is `routeDrop`
   *  running inside a PROJECTION bundle, so a module-level slot would not be seen. */
  grouping: {
    provider: import('./grouping.ts').GroupingProvider | null;
    /** The host-installed ASYNC resolver for an ambiguous group-creation choice. Same window-global
     *  holder as `provider` (same producer/consumer bundle split); async because it asks the user, so
     *  only an async wrapper above the sync `routeDrop` ever calls it. */
    chooser: import('./grouping.ts').GroupingChooser | null;
  };
  /** The host-installed WRAP-TARGET registry (see `grouping.ts`): the UNION of grouping ∪ spatial
   *  containers, family-tagged, that the WRAP action offers — DECOUPLED from `grouping` (which is the
   *  drop's stack-group set). Same window-global holder + producer/consumer split as `grouping`: the wrap
   *  pane action runs inside a PROJECTION bundle, so a module-level slot would not be seen. */
  wrapTargets: {
    targets: import('./grouping.ts').WrapTarget[];
    outcome: import('./grouping.ts').GroupingChoiceOutcome | null;
  };
  /** The host-installed TYPE-CLOSURE predicate `admits` is checked with (see `slots.ts`). Same
   *  producer/consumer split as `grouping`, so the same window-global holder. */
  slotTypes: { provider: import('./slots.ts').SlotTypeProvider | null };
  /** The host-installed live INTENT CENSUS getter (see `intent-census.ts`). On the window-global
   *  BECAUSE the layout-inspector is its OWN projection bundle: the host (app) is the producer and the
   *  inspector the consumer, in DIFFERENT bundles, so a module-level singleton would not be shared. */
  intentCensus: { provider: (() => import('./intent-census.ts').IntentCensus) | null };
  /** The PANE-HEADER CONTRIBUTION registry (see `pane-header.ts`): `paneId` → the header regions a
   *  container OFFERS and the ones an occupant has CLAIMED. Shared BECAUSE the offering container
   *  (bento) and the claiming occupant (tabs) are DIFFERENT projection bundles. Keyed by `paneId`
   *  (a string), resolved DOM-authoritatively from `data-pane-id`, so no id crosses the mount contract. */
  paneHeaders: Map<string, import('./pane-header.ts').HeaderOffer>;
  // The portal registry is NOT here. Only the HOST bundle touches
  // it (the flat `PaneHost` + the host-owned anchor observer; a projection only SETS `data-pane-id` and
  // resolves `placementForPane` by DOM query), so it needs no cross-bundle sharing. It is a PER-RUNTIME
  // `PortalRegistry` (see `pane-portal.ts`) the kernel owns, so a composition switch / detached hub does
  // not collide on a shared `^:`.
}

function createShared(): Shared {
  return {
    dragStore: createDragStore(),
    registry: new WeakMap(),
    dialectRegistry: new WeakMap(),
    contentDropTargets: new WeakMap(),
    containerRoots: new Set(),
    grouping: { provider: null, chooser: null },
    wrapTargets: { targets: [], outcome: null },
    slotTypes: { provider: null },
    intentCensus: { provider: null },
    paneHeaders: new Map(),
  };
}

let local: Shared | null = null;

function init(): Shared {
  // PROD: every bundle resolves the ONE served container-core → a plain module singleton, no window-global.
  if (!bridging()) return (local ??= createShared());

  // DEV split: the ONE shared object lives on the window-global so the shell's (vite) copy and the
  // projections' (served) copy share it. Idempotent + FORWARD-COMPATIBLE: an older copy that predates a
  // field may have created it without one; backfill so a mixed-version dev load is safe.
  const g = globalThis as unknown as Record<string, Shared | undefined>;
  const existing = g[KEY];
  if (existing) {
    if (!existing.dialectRegistry) existing.dialectRegistry = new WeakMap();
    if (!existing.contentDropTargets) existing.contentDropTargets = new WeakMap();
    if (!existing.containerRoots) existing.containerRoots = new Set();
    if (!existing.grouping) existing.grouping = { provider: null, chooser: null };
    else if (existing.grouping.chooser === undefined) existing.grouping.chooser = null;
    if (!existing.wrapTargets) existing.wrapTargets = { targets: [], outcome: null };
    if (!existing.slotTypes) existing.slotTypes = { provider: null };
    if (!existing.intentCensus) existing.intentCensus = { provider: null };
    if (!existing.paneHeaders) existing.paneHeaders = new Map();
    return existing;
  }
  const shared = createShared();
  g[KEY] = shared;
  return shared;
}

const shared = init();

/** The one shared drag store. The React `useLayoutDrag` hook (container-kit)
 *  binds this via `useStore`. */
export const dragStore: StoreApi<LayoutDragStore> = shared.dragStore;

/** The one shared placement registry. */
export const registry: WeakMap<Element, ContainerPlacement> = shared.registry;

/** The one shared drop-dialect registry. */
export const dialectRegistry: WeakMap<Element, ContainerDialect> = shared.dialectRegistry;

/** The one shared content-destination registry (`registerDropTarget`). */
export const contentDropTargets: WeakMap<Element, ContentDropSpec> = shared.contentDropTargets;

/** The one shared, ENUMERABLE set of registered container roots (for pane resolution). */
export const containerRoots: Set<Element> = shared.containerRoots;

/** The one shared holder for the host-installed grouping lookup. See `grouping.ts`. */
export const grouping: {
  provider: import('./grouping.ts').GroupingProvider | null;
  chooser: import('./grouping.ts').GroupingChooser | null;
} = shared.grouping;

/** The one shared holder for the host-installed WRAP-TARGET registry (grouping ∪ spatial). See `grouping.ts`. */
export const wrapTargets: {
  targets: import('./grouping.ts').WrapTarget[];
  outcome: import('./grouping.ts').GroupingChoiceOutcome | null;
} = shared.wrapTargets;

/** The one shared holder for the host-installed slot type-closure predicate. See `slots.ts`. */
export const slotTypes: { provider: import('./slots.ts').SlotTypeProvider | null } = shared.slotTypes;

/** The one shared holder for the host-installed live intent census getter. See `intent-census.ts`. */
export const intentCensus: { provider: (() => import('./intent-census.ts').IntentCensus) | null } = shared.intentCensus;

/** The one shared pane-header contribution registry (paneId → offered/claimed regions). See `pane-header.ts`. */
export const paneHeaders: Map<string, import('./pane-header.ts').HeaderOffer> = shared.paneHeaders;

/** Walk up from `el` to the nearest registered container root and its declared placement.
 *  Lives here, beside the registry it reads, so both `registry.ts` (the router) and `slots.ts`
 *  (the drag-start check) reach it without importing each other. */
export function findContainerRoot(el: Element | null): { el: Element; placement: ContainerPlacement } | null {
  let cur: Element | null = el;
  while (cur) {
    const placement = registry.get(cur);
    if (placement) return { el: cur, placement };
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Two roots identify the same container when they are the same element or declare the same
 * data-container-id. A container can expose several surfaces, such as a tab strip and its body,
 * while keeping same-container drag behavior. Roots without a shared id use element identity.
 */
export function sameContainerRoot(a: Element, b: Element): boolean {
  if (a === b) return true;
  const ai = (a as HTMLElement).dataset?.containerId;
  const bi = (b as HTMLElement).dataset?.containerId;
  return !!ai && ai === bi;
}

export function dragSourceIsFrom(containerRoot: Element): boolean {
  const drag = dragStore.getState().drag;
  // A CONTENT drag is never a same-container move — it MINTS a pane, it does not move one from any
  // container. So same-container drop SUPPRESSION must never fire for it: a file must be droppable onto
  // the very container the file-tree lives in. (Its `sourceEl` is a file ROW, which DOES resolve to that
  // container, so without this guard every dialect would wrongly suppress its drop there.)
  if (drag?.content !== undefined) return false;
  const sourceEl = drag?.sourceEl ?? null;
  if (!sourceEl) return false;
  const srcRoot = findContainerRoot(sourceEl)?.el;
  return !!srcRoot && sameContainerRoot(srcRoot, containerRoot);
}
