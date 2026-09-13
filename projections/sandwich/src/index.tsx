// The `sandwich` container-projection. A left | center | right layout: the sides
// (left/right) COLLAPSIBLE, the center fills. A PEER container (bento / tabs / dock /
// canvas), freely nestable — each region holds ONE child projection instance, which
// may itself be a container (a `tabs` for a tabbed region, a `bento`, a `canvas`):
// pure container NESTING.

// THE ACCEPTANCE GATE for the shared substrate: the sandwich owns ONLY its 3-region
// layout dialect + collapsibility, and composes the substrate for everything else —
// mount via `PaneProjection`, drag + cross-container re-parenting via `ContainerPlacement`
// + a drop dialect (the shared router drives it). No open-intent, no focus channel:
// a region delegates those to whatever container it holds. Building a new container
// should be cheap; that thinness is the proof.

// its config IS a `Sandwich` instance. Each region is a UNION — a bare child, or a
// `sandwich-slot` when the POSITION has something to say (`admits` / `fixed` / `size` /
// `sizing`). A sandwich with no rules is byte-identical to one authored before slots existed.

// Sandwich container: fixed named regions hold child references or slots.
// Position IDs identify placement slots; occupant IDs follow moved children and
// key terminal sessions and editor view state. Slot rules remain with positions.




import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type {
  ContainerPlacement,
  ContainerSlot,
  ContextMenuItem,
  DropTarget,
  Occupant,
  MountHost,
  Pane,
  PaneId,
  PaneInstance,
  Projection,
  ProjectionModule,
} from '@arsumbris/au-host-sdk'
import { defineProjection } from '@arsumbris/au-host-sdk'
import { isRevealPaneIntent } from '@arsumbris/intent'
import {
  makeSlotCodec,
  type SlotState as CoreSlotState,
  PaneProjection,
  EmptySlot,
  usePaneSwap,
  makePoolEdit,
  positionName,
  bareTypeName,
  projectionTitleLookup,
  projectionBreakpointsLookup,
  useContainerDialect,
  useContainerPlacement,
  useContainerModel,
  useDragStart,
  useMergedRef,
  useResizeDrag,
  useOfferedHeaderRegion,
  createChild,
  wrapPaneInteractive,
  dissolvePane,
  paneActionsMenu,
  floatPaneRow,
  moveToWindowRow,
  reloadPaneRows,
} from '@arsumbris/container-kit'
import { AuSplitter } from '@arsumbris/au-component-catalog/react'
import { sandwichDropDialect } from './drop-dialect'
import type { Sandwich } from './generated'

let idSeq = 0
function genId(): string {
  return `sw-${Date.now().toString(36)}-${(idSeq++).toString(36)}`
}

type RegionName = 'left' | 'center' | 'right'
const REGIONS: readonly RegionName[] = ['left', 'center', 'right']
const SIDES: readonly RegionName[] = ['left', 'right']

/**
 * THE UNION CODEC — reading and writing `<projection& | sandwich-slot>` is the substrate's job, not
 * sandwich's. Sandwich declares only what is genuinely its own: which slot type it writes, the two
 * extras it HONOURS, and its own id prefix.
 *
 * `size` and `sizing` are declared here as well as on the type-def, and the pair is not
 * redundant: the type-def says what may be AUTHORED, this says what sandwich ACTS ON.
 */
const slots = makeSlotCodec<Projection, SandwichExtras>({
  slotType: 'sandwich-slot',
  extras: ['size', 'sizing', 'minSize', 'showCollapseControl'],
  label: 'sandwich',
})

/** A region's occupant: its stable `^:` id + the projection instance it mounts. */
type ChildState = Occupant<Projection>

/** How a region is sized. `free` renders the child at its drag width; `compact` at the child's
 *  smallest declared width (`breakpoints-meta`), so the child renders its own compact form;
 *  `collapsed` hides the child behind sandwich's strip. Absent = `free`. */
type RegionSizing = 'free' | 'compact' | 'collapsed'

/** What sandwich adds to the shared slot base: a region's free-state width, and its sizing state. */
interface SandwichExtras {
  minSize?: number
  showCollapseControl?: boolean
  size?: number
  sizing?: RegionSizing
}

/** What the POSITION says, when it says anything. Every field optional by construction: a slot
 *  with nothing to say is never written, and the child sits bare in the region's field instead. */
type SlotState = CoreSlotState<SandwichExtras>

/** A region: an optional occupant plus what the position says about it. Both may be absent (an
 *  unoccupied, unruled region), and either may be present alone — an empty region KEEPS its rules,
 *  which is what makes a constrained-but-unfilled region stay constrained. */
interface RegionState {
  child?: ChildState
  slot: SlotState
}

type SandwichModel = Record<RegionName, RegionState>

const DEFAULT_SIDE_WIDTH = 240
const MIN_SIDE_WIDTH = 80
const MAX_SIDE_WIDTH = 640

/** The smallest WIDTH a child DECLARED it can render at (`breakpoints-meta`, off the descriptor), or
 *  null when it declared none. The isolation-safe read: no engine access, same carrier as titles. */
function childCompactWidth(host: MountHost, type: string | undefined): number | null {
  const widths = projectionBreakpointsLookup(host.describeProjections?.())(type)
    .map((b) => b.width)
    .filter((w): w is number => w !== undefined)
  return widths.length ? Math.min(...widths) : null
}

/** The next sizing on a toggle: `free ⇄ compact` when the child declares a compact width, else
 *  `free ⇄ collapsed`. From any non-free state the toggle returns to `free`. (The slot's enum still
 *  admits all three; an author may write `collapsed` on a compact-capable region, the control just
 *  does not step through it.) */
function nextSizing(current: RegionSizing, compactReachable: boolean): RegionSizing {
  if (current !== 'free') return 'free'
  return compactReachable ? 'compact' : 'collapsed'
}

/** Read one region's union value into the runtime shape. */
function regionFrom(value: Sandwich['left']): RegionState {
  return slots.read(value)
}

function fromConfig(cfg: Sandwich | undefined): SandwichModel {
  return { left: regionFrom(cfg?.left), center: regionFrom(cfg?.center), right: regionFrom(cfg?.right) }
}

// The host derives config ownership from the type graph and preserves unowned fields
// at saveConfig. This projection emits only the fields it understands.
function regionToConfig(region: RegionState): Sandwich['left'] {
  return slots.write(region) as Sandwich['left']
}

function toConfig(model: SandwichModel): Sandwich {
  const out: Sandwich = { type: 'sandwich' }
  for (const r of REGIONS) {
    const value = regionToConfig(model[r])
    if (value !== undefined) out[r] = value
  }
  //...and everything ELSE the instance carried. As the composition ROOT this sandwich also holds
  // `intent-defaults` / `initial-focus`, which are composition-level and NOT ours to re-emit: a
  // container emits what it owns, the rest comes through untouched, or a sidebar collapse strips
  // the composition's routing rule.
  return out
}

/** Resolve an id to its region. Accepts a region NAME (a drop target addresses the POSITION), a
 *  CHILD id (a drag source addresses the THING), or a SLOT id. All three, because the substrate's
 *  `slotFor` is defined as "the slot governing this id, whichever you named". */
function regionOf(model: SandwichModel, id: string): RegionName | null {
  if ((REGIONS as readonly string[]).includes(id)) return id as RegionName
  return REGIONS.find((r) => model[r].child?.id === id || model[r].slot.id === id) ?? null
}

/** The slot governing this id as a `ContainerSlot`, or null when the position says nothing. */
function slotOf(model: SandwichModel, id: string): ContainerSlot | null {
  const r = regionOf(model, id)
  if (!r) return null
  return slots.toSeamSlot(model[r].slot)
}

// Chrome is the token-only <au-*> vocabulary: the region header is <au-pane-header surface="rail"> (sides)
// or a nested <au-pane-header surface="panel"> inside the center's <au-pane-frame> card; the sash is
// <au-splitter>. Only the LAYOUT skeleton + sandwich's own collapse rail are styled here,
// and their colours are tokenized.
const STYLE = `
.au-sandwich { display: flex; width: 100%; height: 100%; overflow: hidden; }
.au-sw-compact-controls { display:flex; align-items:center; min-height:calc(var(--au-space-1)*7 + 2px); position:absolute; inset-block-start:var(--au-space-2); inset-inline-end:var(--au-space-2); z-index:2; opacity:0; transition:opacity var(--au-m-fast) var(--au-e-std); }
.au-sw-compact-controls + .au-sw-body { --au-pane-trailing-action-space:var(--au-space-8); }
.au-sw-left .au-sw-compact-controls { inset-inline-start:var(--au-space-2); inset-inline-end:auto; }
.au-sw-region:hover > .au-sw-content > .au-sw-compact-controls,.au-sw-compact-controls:focus-within { opacity:1; }
@media (prefers-reduced-motion:reduce) { .au-sw-compact-controls { transition:none; } }
.au-sw-region { display: flex; flex-direction: column; overflow: hidden; min-width: 0; min-height: 0; }
.au-sw-left, .au-sw-right { flex: 0 0 auto; position: relative; transition: width var(--au-m-base, 220ms) var(--au-e-std, cubic-bezier(0.2, 0, 0, 1)); }
.au-sw-region[data-resizing] { transition: none; }
.au-sw-content { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0;
  opacity: 1; transition: opacity var(--au-m-fast, 160ms) var(--au-e-std, cubic-bezier(0.2, 0, 0, 1)), visibility 0s; }
.au-sw-content[inert] { opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity var(--au-m-fast, 160ms) var(--au-e-std, cubic-bezier(0.2, 0, 0, 1)), visibility 0s var(--au-m-fast, 160ms); }
.au-sw-region > .au-sw-rail { position: absolute; inset: 0; border: 0; padding: 0; }
@media (prefers-reduced-motion: reduce) { .au-sw-left, .au-sw-right, .au-sw-content, .au-sw-content[inert] { transition: none; } }
.au-sw-center { flex: 1 1 auto; min-width: 0; }
.au-sw-body { flex: 1; min-height: 0; overflow: hidden; position: relative; }
.au-sw-empty { height: 100%; display: grid; place-items: center; color: var(--au-ink-4, #777); font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono); }
.au-sw-rail { flex: 0 0 24px; display: flex; align-items: center; justify-content: center; cursor: pointer;
  background: transparent; color: var(--au-ink-3, #aaa); appearance: none;
  flex-direction: column; gap: var(--au-space-2, 8px);
  border-radius: var(--au-radius-chip, 6px);
  font: var(--au-t-xs, 12px)/var(--au-lh-xs) var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); user-select: none; }
.au-sw-rail-label { writing-mode: vertical-rl; }
.au-sw-rail:hover { background: var(--au-chrome-hover, rgba(255,255,255,0.045)); color: var(--au-ink-1, #ededed); }
.au-sw-rail:active { background: var(--au-chrome-active, rgba(255,255,255,0.075)); }
.au-sw-rail:focus-visible { outline: 1px solid var(--au-focus-outer); outline-offset: -1px; }
@media (forced-colors: active) { .au-sw-rail:focus-visible { outline-color: Highlight; } }
`

/** A region's header — the token-only <au-pane-header> frame that also OFFERS its `center` contribution
 *  region, so a `tabs` occupant portals its strip into THIS bar (one bar with the region's grip + actions,
 *  exactly like bento) instead of drawing its own strip below it. The offer hook lives in this component so
 *  its offer/withdraw lifecycle tracks the header's presence — a side collapsing to a rail unmounts this and
 *  withdraws the region. `claimed` (an occupant contributed) drops the region's own title. */
function RegionHeader({
  paneId,
  container,
  label,
  surface,
  leading,
  title,
  actions,
}: {
  paneId: PaneId | null
  container?: boolean
  label: string
  surface: 'rail' | 'panel'
  leading: ReactNode
  title: ReactNode
  actions: ReactNode
}): ReactNode {
  const { ref, claimed } = useOfferedHeaderRegion(paneId, 'center')
  return (
    <au-pane-header surface={surface} compact={container === true && !claimed} context={claimed ? label : undefined}>
      {leading}
      {!claimed && title}
      {/* The offered center region: empty (present, flexing) until a tabs occupant contributes its strip
          here — the occupant's `useHeaderContribution` resolves this node by the enclosing `data-pane-id`. */}
      <div ref={ref} style={{ display: 'flex', alignItems: 'center', minWidth: 0, height: '100%' }} />
      {actions}
    </au-pane-header>
  )
}

/** The side↔centre resize sash: the token-only <au-splitter> LOOK + the shared `useResizeDrag`
 *  pointer-capture lifecycle. `line={false}` because the centre card draws its own edge. The PHYSICS
 *  are sandwich's, carried by `begin` (its `startResize`), which returns the move/end handlers on
 *  pointerdown. Its own component so the hook is called at a stable position, like bento's `Sash`. */
function SwSash({
  begin, side, width, controls, onResize, minWidth,
}: {
  side: 'left' | 'right'
  minWidth: number
  width: number
  controls: string
  onResize: (width: number) => void
  begin: (e: ReactPointerEvent) => { onMove: (e: PointerEvent) => void; onEnd?: (commit: boolean) => void } | null
}): ReactNode {
  const { onPointerDown, dragging } = useResizeDrag(begin)
  return <AuSplitter orientation="vertical" line={false} dragging={dragging} onPointerDown={onPointerDown}
    aria-label={`Resize ${side} sidebar`} aria-controls={controls}
    aria-valuemin={minWidth} aria-valuemax={MAX_SIDE_WIDTH} aria-valuenow={Math.round(width)}
    aria-valuetext={`${Math.round(width)} pixels`}
    onKeyDown={event => {
      if (dragging) return
      const step = event.shiftKey ? 10 : 1
      const direction = side === 'left' ? 1 : -1
      let next: number
      if (event.key === 'ArrowLeft') next = width - step * direction
      else if (event.key === 'ArrowRight') next = width + step * direction
      else if (event.key === 'Home') next = minWidth
      else if (event.key === 'End') next = MAX_SIDE_WIDTH
      else return
      event.preventDefault()
      event.stopPropagation()
      next = Math.max(minWidth, Math.min(MAX_SIDE_WIDTH, next))
      if (next !== width) onResize(next)
    }} />
}

function SandwichApp({ host }: { host: MountHost }): ReactNode {
  const groupId = useMemo(() => genId(), [])
  const initial = useMemo(() => fromConfig(host.config as Sandwich | undefined), [host])

  // `model` renders, `live()` is what every mutation and every seam method reads, `commit`
  // advances and persists. The rule and the reason live in `useContainerModel` / `ModelCell`:
  // one drop drives the seam several times in ONE tick, so a seam method reading the render-closure
  // model rebuilds from a stale snapshot and resurrects what an earlier commit removed.
  const { model, live, commit } = useContainerModel<SandwichModel>(
    initial,
    (next) => host.saveConfig(toConfig(next)),
    // RE-SEED on an external structural edit (a drag re-parent / closePane / wrapPane writes this
    // sandwich's record without a local commit), so its region anchors never go stale.
    { host, fromConfig: (raw) => fromConfig(raw as Sandwich | undefined) },
  )
  /** The width of the side currently being dragged, if any. Transient — see `startResize`. */
  const [dragWidth, setDragWidth] = useState<{ side: RegionName; width: number } | null>(null)
  // The ACTIVE pane's `^:` from the HOST focus signal — the centre card rings when its occupant is the
  // active pane (the sides are flat rails with no card, so they show no ring by design). The host owns
  // the truth; sandwich renders its own ring from it.
  const [activePane, setActivePane] = useState<string | null>(null)
  useEffect(() => host.focus.watchActive?.((id) => setActivePane(id)), [host])

  // A region is FIXED when its own slot says so. No id keying, so nothing to mis-key: the rule
  // sits on the position it governs. The substrate refuses the gesture at the seam; this only
  // decides what to RENDER, which stays the container's own business.
  const isFixed = (name: RegionName): boolean => live()[name].slot.fixed === true

  /** Update one region's slot, collapsing it to silence when it loses its last reason to exist. */
  const withSlot = (name: RegionName, patch: Partial<SlotState>): SandwichModel => {
    const m = live()
    return { ...m, [name]: { ...m[name], slot: { ...m[name].slot, ...patch } } }
  }

  // Drag a side border to resize it: the in-flight width is TRANSIENT UI state (`dragWidth`), committed
  // ONCE on release, never per frame. The pointer-capture lifecycle is the shared `useResizeDrag` hook
  // (see `SwSash`); the PHYSICS — a pointer delta clamped to the min/max side width — stays sandwich's.
  const minWidthOf = (name: RegionName): number => {
    const value = live()[name].slot.minSize
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(MIN_SIDE_WIDTH, Math.min(MAX_SIDE_WIDTH, value)) : MIN_SIDE_WIDTH
  }
  const startResize = useCallback(
    (side: 'left' | 'right', e: ReactPointerEvent) => {
      const startX = e.clientX
      const startW = live()[side].slot.size ?? DEFAULT_SIDE_WIDTH
      let latest = startW
      return {
        onMove: (ev: PointerEvent): void => {
          const dx = side === 'left' ? ev.clientX - startX : startX - ev.clientX
          latest = Math.max(minWidthOf(side), Math.min(MAX_SIDE_WIDTH, startW + dx))
          setDragWidth({ side, width: latest })
        },
        onEnd: (commitDrag: boolean): void => {
          setDragWidth(null)
          if (commitDrag && latest !== startW) commit(withSlot(side, { size: latest }))
        },
      }
    },
    [live, commit, withSlot],
  )

  /** Put an occupant in a region, keeping the position's rules exactly where they were. The child
   *  changes; the slot does not. That is containment, not attachment. */
  const setRegion = (name: RegionName, instance: Projection, id?: string): SandwichModel => {
    const m = live()
    // A FRESH occupant (no named id, no existing child) is POOLED immediately via `createChild`
    // (`createRecord`), NOT `mintBlockId`: an unpooled id dangles through the composition re-derive, so
    // the empty-slot driver's materialize would render empty and re-fire → an infinite loop. bento/tabs/
    // column pool here for the same reason.
    return { ...m, [name]: { ...m[name], child: { id: id ?? m[name].child?.id ?? createChild(host, instance), instance } } }
  }

  const sizingOf = (name: RegionName): RegionSizing => live()[name].slot.sizing ?? 'free'

  /** The smallest declared width of the region's child, or null when it declared none. */
  const compactWidthOf = (name: RegionName): number | null =>
    childCompactWidth(host, live()[name].child?.instance.type)

  const setSizing = (name: RegionName, value: RegionSizing): void => {
    // A non-`free` sizing MATERIALIZES the slot; `free` drops the field, and `regionToConfig`
    // collapses the record back to a bare child when that was its last reason to exist.
    commit(withSlot(name, { sizing: value === 'free' ? undefined : value }))
  }

  /** Toggle the region's sizing (the collapse control + the collapse-region intent both call it). */
  const toggleSizing = (name: RegionName): void =>
    setSizing(name, nextSizing(sizingOf(name), compactWidthOf(name) !== null))

  useEffect(() => {
    const releases = (['left', 'right'] as const).map(side =>
      host.intent.handle(`toggle-${side}-sidebar-intent`, {
        claim: () => true,
        commit: () => {
          const current = live()[side].slot.sizing ?? 'free'
          const compact = childCompactWidth(host, live()[side].child?.instance.type) !== null
          commit(withSlot(side, { sizing: nextSizing(current, compact) }))
        },
      }))
    return () => releases.forEach(release => release())
  }, [host])

  // A region occupant (the rail) fires `collapse-region` for ITSELF; as the firer's enclosing container
  // the sandwich TOGGLES the SIDE region holding it. `nodeIdOf` maps the firer publisher to its region
  // occupant id (`regionOf` matches a child id); a side toggles + CLAIMS, the non-collapsible center or an
  // unknown id DECLINES so the firer-relative walk continues to an outer container. `live`/`commit` are
  // ref-stable, so the handler reads current state. Only a DIRECT region occupant maps — the rail is one.
  useEffect(() => {
    const offCollapse = host.intent.handle('collapse-region', {
      // CLAIM (pure): the firer sits in one of our SIDE regions. COMMIT: cycle its sizing.
      claim: (_intent, from) => {
        const childId = host.children.nodeIdOf?.(from)
        if (childId === undefined) return false
        const region = regionOf(live(), childId)
        return region !== null && (SIDES as readonly string[]).includes(region)
      },
      commit: (_intent, from) => {
        const childId = host.children.nodeIdOf?.(from)
        if (childId === undefined) return
        const m = live()
        const region = regionOf(m, childId)
        if (region === null || !(SIDES as readonly string[]).includes(region)) return
        const reachable = childCompactWidth(host, m[region].child?.instance.type) !== null
        const next = nextSizing(m[region].slot.sizing ?? 'free', reachable)
        commit({
          ...m,
          [region]: { ...m[region], slot: { ...m[region].slot, sizing: next === 'free' ? undefined : next } },
        })
      },
    })
    // REVEAL a specific pane by id: expand the (compact/collapsed) SIDE holding it, claim. Declines when
    // this sandwich does not hold the pane. A region is always visible, so this only un-collapses a side.
    const offReveal = host.intent.handle('reveal-pane-intent', {
      // CLAIM (pure): this sandwich holds the pane. COMMIT: un-collapse the side holding it (idempotent).
      claim: (intent) => isRevealPaneIntent(intent) && REGIONS.some((x) => live()[x].child?.id === intent.paneId),
      commit: (intent) => {
        if (!isRevealPaneIntent(intent)) return
        const m = live()
        const r = REGIONS.find((x) => m[x].child?.id === intent.paneId)
        if (!r) return
        if (sizingOf(r) !== 'free') setSizing(r, 'free')
      },
    })
    return () => {
      offCollapse()
      offReveal()
    }
  }, [host, live, commit])

  /** Empty a named region without removing the region itself. The parent renders
   * the close control; the slot's fixed rule refuses both close and drag-out. */
  const clearRegion = (name: RegionName): void => void removeFrom(name)

  /**
   * Take the child out of a region. THE ONE REMOVAL PATH: a close and an extract are the same
   * operation, and the only difference is whether the caller keeps what came out. Written once so
   * the `fixed` refusal cannot disagree between the ✕ and the seam.
   *
   * The CHILD goes; the REGION stays, rules and all, because a region is a named field that always
   * exists. So this is "remove what is in here", not "remove this" — and a constrained-but-emptied
   * region is still constrained.
   */
  const removeFrom = (name: RegionName): ChildState | null => {
    const m = live()
    const child = m[name].child
    if (!child) return null
    if (m[name].slot.fixed) return null
    commit({ ...m, [name]: { slot: m[name].slot } })
    return child
  }

  const widthOf = (name: RegionName): number =>
    Math.max(minWidthOf(name), (dragWidth?.side === name ? dragWidth.width : undefined) ?? live()[name].slot.size ?? DEFAULT_SIDE_WIDTH)

  // The pure re-point seam. A region is one placement slot (no reorder — `reorder` is null,
  // mirroring `moveWithin: () => false`). ownedKeys are the sandwich's own fields; a root sandwich's
  // `intent-defaults` / `initial-focus` are carried through by `withCarry`.
  const poolEdit = makePoolEdit<SandwichModel>({
    host,
    live,
    ownedKeys: ['type', 'left', 'center', 'right'],
    toConfig,
    remove: (m, localId) => {
      // POSITION-native: the substrate resolves the inbound address to a region name at the boundary
      // (`resolve` below), so match by `regionOf` (region name / child id / slot id) — a raw
      // `child.id ===` match would miss the resolved region name.
      const r = regionOf(m, localId)
      if (!r) return null
      const child = m[r].child
      if (!child || m[r].slot.fixed) return null
      return { model: { ...m, [r]: { slot: m[r].slot } }, occupant: { instance: child.instance, id: child.id } }
    },
    place: (m, occ, target) => {
      const slotId = target.shape === 'slot-rect' ? target.slotId : REGIONS.find((r) => !m[r].child) ?? 'center'
      const r = regionOf(m, slotId) ?? 'center'
      return { ...m, [r]: { ...m[r], child: { id: occ.id, instance: occ.instance as Projection } } }
    },
    reorder: () => null,
    wrap: (m, slotId, groupId, groupInstance, removeLocalId) => {
      let mm = m
      if (removeLocalId != null) {
        // POSITION-native: `removeLocalId` arrives resolved to a region name (the boundary resolve).
        const rr = regionOf(mm, removeLocalId)
        if (rr && !mm[rr].slot.fixed) mm = { ...mm, [rr]: { slot: mm[rr].slot } }
      }
      const r = regionOf(mm, slotId)
      if (!r) return null
      return { ...mm, [r]: { ...mm[r], child: { id: groupId, instance: groupInstance as Projection } } }
    },
  })

  // ── ContainerPlacement — the shared router drives the sandwich through the seam.
  //    Region-level: a region is a single placement slot (no split). panes/findPane/extract key by
  //    the CHILD's id (the thing); get/set/inject key by the region NAME (the position). One
  //    address space each, which is the fix for the emptied-region defect.
  const placement: ContainerPlacement = {
    panes: () => REGIONS.map((r) => live()[r].child?.id).filter((id): id is string => id !== undefined),
    findPane: (id: PaneId): Pane | null => {
      const m = live()
      const r = REGIONS.find((x) => m[x].child?.id === id)
      return r ? { id, type: m[r].child!.instance.type ?? '' } : null
    },
    // The resolve-at-boundary normalizer: map any inbound address (a region NAME, a child `^:`
    // OCCUPANT id, or a slot id) to the canonical POSITION — the region name. `regionOf` already
    // resolves all three; a bare region name is idempotent. `null` when this sandwich holds no such id.
    resolve: (address) => regionOf(live(), address),
    activate: (id: PaneId) => {
      // A region is always visible; a compact or collapsed SIDE holding it expands so the pane shows.
      // POSITION-native: `id` arrives resolved to a region name (the boundary resolve).
      const m = live()
      const r = regionOf(m, id)
      if (r && sizingOf(r) !== 'free') setSizing(r, 'free')
    },
    // Extraction returns the occupant instance and stable occupant ID. The region
    // remains a position with its own identity and rules.
    getSlotContent: (slotId: string): Occupant | null => {
      const m = live()
      const r = regionOf(m, slotId)
      const child = r ? m[r].child : undefined
      return child ? { instance: child.instance, id: child.id } : null
    },
    setSlotContent: (slotId: string, instance: PaneInstance, occupantId?: string) => {
      // No local `admits` guard: the substrate checks it at every seam that reaches here (the
      // centre-wrap and the dissolve), BEFORE anything destructive runs. A second copy of the rule
      // in each of six containers is exactly the divergence `slotFor` exists to remove.
      const r = regionOf(live(), slotId)
      // Pass the arriving occupant's ID to setRegion to preserve its identity.
      if (r) commit(setRegion(r, instance as Projection, occupantId))
    },
    // The sandwich emits only CENTER targets (a region has no split), so the router
    // always takes the wrap-into-tabs / place path (setSlotContent / inject) and never
    // moveWithin — implemented defensively as a no-op. Returns false because nothing moved;
    // it is never actually called, so the reorder-refused report never fires.
    moveWithin: () => false,
    extract: (localId: string): Occupant | null => {
      // POSITION-native: `localId` arrives resolved to a region name (the boundary resolve).
      const r = regionOf(live(), localId)
      if (!r) return null
      // The SAME removal the ✕ performs — see `removeFrom`. The seam simply keeps what came out.
      // The `fixed` refusal there is defense-in-depth: the substrate already refused before calling.
      const child = removeFrom(r)
      return child ? { instance: child.instance, id: child.id } : null
    },
    inject: (instance: PaneInstance, id: PaneId, target: DropTarget) => {
      const m = live()
      const slotId =
        target.shape === 'slot-rect' ? target.slotId : REGIONS.find((r) => !m[r].child) ?? 'center'
      const r = regionOf(m, slotId) ?? 'center'
      commit(setRegion(r, instance as Projection, id))
    },
    // The lookup only this container can answer: which slot governs this id, whether the caller
    // named the position, its occupant, or the slot itself. The substrate owns what the answer
    // MEANS; sandwich only knows where its slots are.
    slotFor: (id: string): ContainerSlot | null => slotOf(live(), id),
    ...(poolEdit ? { poolEdit } : {}),
  }

  const setPlacementRoot = useContainerPlacement(placement)
  const setDialectRoot = useContainerDialect(sandwichDropDialect)
  const setContainerRoot = useMergedRef(setPlacementRoot, setDialectRoot)
  const startDrag = useDragStart()
  // A child's DECLARED title (`projection-presentation-meta`) off the host descriptor set, built once
  // per render and reused across regions — reaches the region header without sandwich reading the engine.
  const descriptors = host.describeProjections?.() ?? []
  const titleOf = projectionTitleLookup(descriptors)
  const containerTypes = new Set(descriptors.filter((p) => p.kinds.includes('container-projection')).map((p) => bareTypeName(p.type)))

  // Universal swap: replace a region's occupant in place, carrying its document. Routes through the ONE
  // placement-seam address-op (`setPaneContent`), which honours `fixed` / `admits` at the seam. Keyed by
  // the OCCUPANT's `^:` id (never the region NAME): `setPaneContent` resolves the container by the portal
  // anchor, which carries the child id, and sandwich's `findPane` matches child ids only — a region name
  // would not resolve. `regionOf` accepts the child id, so `slotFor` / `setSlotContent` map it back.
  const swapPane = usePaneSwap(host)

  const renderRegion = (name: RegionName): ReactNode => {
    const child = model[name].child
    const sizing = sizingOf(name)
    const compactW = compactWidthOf(name)
    // The strip shows for `collapsed`, and for `compact` when the child declared no width to narrow to
    // (the compact → collapsed fallback). Otherwise the child renders — at its compact width, or free.
    const showStrip = (SIDES as readonly string[]).includes(name) && (sizing === 'collapsed' || (sizing === 'compact' && compactW === null))
    const fixed = isFixed(name)
    const isSide = (SIDES as readonly string[]).includes(name)
    // The position asked for NO container header — a self-chrome occupant (a rail with its own top
    // band) owns its surface, and a sandwich region header would stack a second bar over it. Sandwich
    // honours the base `hideHeader` field; the region then renders only its body. `hideHeader` hides
    // the header ONLY: `fixed`/`admits` still enforce, `size`/`sizing` still drive width + collapse.
    const hideHeader = model[name].slot.hideHeader === true
    // Use the slot label, then the occupant's declared title, then its derived name.
    const posName = positionName(model[name].slot, child?.instance.type, titleOf(child?.instance.type))

    // Use an authored slot label even when the region is empty; otherwise show the
    // occupant's display name or the region's structural hint.
    const label = posName || `${name} (empty)`

    // CHROME is the token-only <au-*> vocabulary now: sandwich SLOTS its own controls into the header
    // frame and wires their handlers directly (data-in = attributes, data-out = native events;
    // the `/react` JSX types do NOT wire `onau-*`, so grip uses `onPointerDown`, close/swap `onClick`).
    // A FIXED region shows a lock glyph instead of the drag grip: presentation only — the substrate
    // refuses the gesture at the seam regardless.
    const leading = child
      ? fixed
        ? <au-icon slot="leading" name="lock" size="xs" label="Fixed — this region's occupant cannot be moved out" />
        : (
          <au-grip-glyph
            slot="leading"
            label="Drag this region's content"
            onPointerDown={(e) =>
              startDrag(e, {
                containerKind: 'sandwich',
                localId: child.id,
                role: 'pane',
                label: posName,
                // `type` lets a TARGET slot decide whether it admits this pane.
                type: child.instance.type,
              })
            }
          />
        )
      : null
    const titleNode = (
      <span slot="title" title={label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    )
    // actions: swap + close (only a non-fixed occupant), plus the region collapse toggle. The toggle is
    // sandwich's own chrome (a side panel), so it uses a mirrored panel glyph — panel-left /
    // panel-right — NOT a chevron, which would read as "expand a section" and point the wrong way.
    const actions = (
      <span slot="actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--au-space-1)' }}>
        {/* The occupant-level actions collapse behind ONE `⋯` overflow menu; close (Remove) + the region
            collapse toggle stay distinct affordances. */}
        {child &&
          !fixed &&
          (() => {
            const choose = host.chooser ? host.chooser.choose.bind(host.chooser) : async () => null
            const rows: ContextMenuItem[] = [
              { id: 'region.swap', label: "Swap this region's content", icon: 'swap', enabled: true, run: () => swapPane.toggle(child.id) },
              { id: 'region.wrap', label: 'Wrap in a container', icon: 'wrap', enabled: true, run: () => void wrapPaneInteractive(child.id, { choose }) },
            ]
            // Unwrap this sandwich only when ONE region is occupied (lift the occupant into the grandparent slot).
            if (REGIONS.filter((r) => model[r].child != null).length === 1)
              rows.push({ id: 'region.unwrap', label: 'Unwrap container', icon: 'unwrap', enabled: true, run: () => dissolvePane(child.id) })
            const floatRow = floatPaneRow(host, child.id) // the GENERIC host float, shared across containers
            if (floatRow) rows.push(floatRow)
            // "Move to other window" appended LAZILY — its gate reflects the CURRENT window set at open (a
            // foreign window opening does not re-render this container). See paneActionsMenu.
            return paneActionsMenu(host, () => {
              const moveRow = moveToWindowRow(host, child.id)
              return [...rows, ...(moveRow ? [moveRow] : []), ...(child.id ? reloadPaneRows(host, child.id) : [])]
            })
          })()}
        {child && !fixed && (
          <au-close-button label="Remove this region's content" onClick={() => clearRegion(name)} />
        )}
        {isSide && (
          <au-icon-button size="xs" label={`Collapse ${name}`} onClick={() => toggleSizing(name)}>
            <au-icon name={name === 'left' ? 'panel-left' : 'panel-right'} />
          </au-icon-button>
        )}
      </span>
    )
    const body = (
      <div
        className="au-sw-body"
        data-droptarget-shape="slot-rect"
        data-container-kind="sandwich"
        // The POSITION's id, always the region name — never the occupant's. Addressing a target
        // by whoever happens to sit in it is what made a refilled region lose its pin.
        data-droptarget-id={name}
      >
        {child ? (
          swapPane.isSwapping(child.id) ? (
            swapPane.swapPicker(child.id, child.instance)
          ) : (
            <PaneProjection
              key={`${child.instance.type}:${(child.instance as { file?: string }).file ?? ''}`}
              host={host}
              paneId={child.id}
              id={child.instance.type ?? ''}
              config={child.instance}
              onChildConfig={(next) => commit(setRegion(name, next as Projection, child.id))}
            />
          )
        ) : (
          // Empty region: the substrate resolves the placeholder and materializes it into this region
          // via the seam (setSlotContent → setRegion). `admits` is honoured at the seam; a region
          // admitting no placeholder shows truly empty. Addressed by the region name.
          <EmptySlot host={host} slotId={name} />
        )}
      </div>
    )

    return (
      <div
        key={name}
        id={`${groupId}-${name}`}
        className={`au-sw-region au-sw-${name}`}
        data-sizing={sizing}
        data-resizing={dragWidth?.side === name ? '' : undefined}
        // A `compact` side takes the child's declared width (the child narrows itself there); `free`
        // takes the drag width. The centre is never a side, so it fills.
        style={isSide ? { width: showStrip ? 24 : sizing === 'compact' && compactW !== null ? compactW : widthOf(name) } : undefined}
      >
        <div className="au-sw-content" inert={showStrip} style={showStrip ? { width: widthOf(name) } : undefined}>
          {hideHeader ? (
            // A self-chrome occupant owns its surface — no region header, and no card either (bare).
            <>
              {isSide && model[name].slot.showCollapseControl && (
                <div className="au-sw-compact-controls">
                  <au-icon-button size="sm" label={`Collapse ${name}`} onClick={() => toggleSizing(name)}>
                    <au-icon name={name === 'left' ? 'panel-left' : 'panel-right'} size="sm" />
                  </au-icon-button>
                </div>
              )}
              {body}
            </>
          ) : isSide ? (
            // A side sits flat on the shell with a rail header.
            <>
              <RegionHeader label={label} container={!!child && containerTypes.has(bareTypeName(child.instance.type))} paneId={child?.id ?? null} surface="rail" leading={leading} title={titleNode} actions={actions} />
              {body}
            </>
          ) : (
            // The CENTRE is the one card: an <au-pane-frame flush> shell (its own label bar stays empty,
            // so the nested <au-pane-header surface="panel"> is the single masthead — bento's flush-nest).
            <au-pane-frame flush nested={!!child && containerTypes.has(bareTypeName(child.instance.type))} focused={!!child && activePane === child.id}>
              <RegionHeader label={label} container={!!child && containerTypes.has(bareTypeName(child.instance.type))} paneId={child?.id ?? null} surface="panel" leading={leading} title={titleNode} actions={actions} />
              {body}
            </au-pane-frame>
          )}
        </div>
        {showStrip && (
          <button type="button" className={`au-sw-rail au-sw-rail-${name}`}
            aria-label={`Expand ${name}`} aria-expanded={false} title={`Expand ${posName || name}`} onClick={() => toggleSizing(name)}>
            <span className="au-sw-rail-label">{posName || name}</span>
            <span aria-hidden="true">{name === 'right' ? '‹' : '›'}</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={setContainerRoot} data-layout-container-slot={groupId} data-container-kind="sandwich" className="au-sandwich">
      {renderRegion('left')}
      {/* A resize sash sits on a FREE side's inner border only — a compact side is fixed at the child's
          declared width, and a collapsed side is a rail; neither is drag-resizable. */}
      {sizingOf('left') === 'free' && <SwSash key="sash-left" side="left" minWidth={minWidthOf('left')} width={widthOf('left')} controls={`${groupId}-left`} onResize={size => commit(withSlot('left', { size }))} begin={(e) => startResize('left', e)} />}
      {renderRegion('center')}
      {sizingOf('right') === 'free' && <SwSash key="sash-right" side="right" minWidth={minWidthOf('right')} width={widthOf('right')} controls={`${groupId}-right`} onResize={size => commit(withSlot('right', { size }))} begin={(e) => startResize('right', e)} />}
      {renderRegion('right')}
    </div>
  )
}

function mount(container: HTMLElement, host: MountHost): () => void {
  // The sandwich's CSS is injected through the host so it is `@scope`-confined to this projection's
  // subtree and CSP-exempt (a raw <style> a strict CSP would block).
  const disposeStyles = host.styles?.inject(STYLE, container)
  const root = createRoot(container)
  root.render(<SandwichApp host={host} />)
  return () => {
    root.unmount()
    disposeStyles?.()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
