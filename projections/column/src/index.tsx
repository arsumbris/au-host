import { reloadPaneRows } from '@arsumbris/container-kit'
// The `column` container-projection. A VERTICAL accordion: child projections stack
// top-to-bottom, arrangement is up/down only, and EACH item is COLLAPSIBLE by height
// (its section header stays; its body hides). A PEER container (bento / tabs / sandwich
// / dock / canvas), freely nestable — an item holds ONE child projection instance,
// which may itself be a container.

// Composes the shared substrate exactly like the sandwich (the thinness is the proof):
// `PaneProjection` mounts each item; `ContainerPlacement` + a drop dialect give drag +
// cross-container re-parenting; the column owns ONLY its vertical-stack + per-item-
// collapse dialect. The default content of a sandwich side.

// its config IS a `Column` instance. Each item is a UNION — a bare child, or a
// `column-slot` when the POSITION has something to say (`admits` / `fixed` / `size` /
// `collapsed`). A column with no rules is byte-identical to one authored before slots existed.

// TWO ID SPACES. An item's CHILD carries its own `^:` id — the THING, preserved across reload and
// re-parenting so a moved terminal reattaches. The POSITION is addressed by a per-mount ENTRY id,
// because a list position has no name to be addressed by and an EMPTY one still needs an address.
// That id is never persisted: drop targets are resolved during the gesture, so it need not survive
// a reload, and minting a `^:` for every position would write ids nothing points at.




import { createRoot } from 'react-dom/client'
import { Fragment, useCallback, useEffect, useMemo, useState, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
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
  GroupBuildFn,
  GroupingContainerModule,
} from '@arsumbris/au-host-sdk'
import { defineProjection } from '@arsumbris/au-host-sdk'
import { isRevealPaneIntent } from '@arsumbris/intent'
import {
  makeSlotCodec,
  type SlotState as CoreSlotState,
  PaneProjection,
  PanePicker,
  describeForPicker,
  EmptySlot,
  usePaneSwap,
  makePoolEdit,
  positionName,
  bareTypeName,
  projectionTitleLookup,
  useContainerDialect,
  useContainerModel,
  useContainerPlacement,
  useMergedRef,
  useOfferedHeaderRegion,
  createChild,
  wrapPaneInteractive,
  dissolvePane,
  paneActionsMenu,
  floatPaneRow,
  moveToWindowRow,
} from '@arsumbris/container-kit'
// AuChevron is the React WRAPPER (wires `au-activate` → onAuActivate); the named import also brings the
// JSX-type augmentation for the other <au-*> chrome intrinsic elements this file uses.
import { AuButton, AuChevron } from '@arsumbris/au-component-catalog/react'
import { ColumnSplitter, ColumnGrip } from './pane-controls'
import { columnDropDialect } from './drop-dialect'
import type { Column } from './generated'

let idSeq = 0
function genId(): string {
  return `col-${Date.now().toString(36)}-${(idSeq++).toString(36)}`
}

/** An item's occupant: its stable `^:` id + the projection instance it mounts. */
type ChildState = Occupant<Projection>

/** What column adds to the shared slot base: a row weight, and whether the row is collapsed. */
interface ColumnExtras {
  size?: number
  collapsed?: boolean
}

/** What the POSITION says, when it says anything. */
type SlotState = CoreSlotState<ColumnExtras>

/**
 * THE UNION CODEC — reading and writing `<projection& | column-slot>` is the substrate's, not
 * column's. Column declares only its slot type, the two extras it HONOURS, and its own id prefix.
 */
const slots = makeSlotCodec<Projection, ColumnExtras>({
  slotType: 'column-slot',
  extras: ['size', 'collapsed'],
  label: 'column',
})

/** One position in the column: an optional occupant, plus what the position says about it.
 *  `entryId` is the POSITION's runtime address — see the header note on the two id spaces. */
interface ItemState {
  entryId: string
  child?: ChildState
  slot: SlotState
}

interface ColumnModel {
  items: ItemState[]
  /** CHROME POLICY — how this container renders. Not slot state: it is a statement about the
   *  container, and a per-position version of it would say nothing a slot cannot already say. */
  showItemHeaders: boolean
  itemHeaders?: 'always' | 'hover' | 'hidden'
  addButton: 'always' | 'hover' | 'hidden'
  /** DROP EMISSION — which zones this container's dialect offers at all. Container-wide on
   *  purpose: `admits` refuses a drop AFTER the zone was offered, this suppresses the zone, and
   *  only the container-wide form covers children authored LATER (they arrive in a bare slot that
   *  no per-slot rule governs).  */
  allowWrap: boolean
}

const DEFAULT_ITEM_SIZE = 1
/** Match existing relative sizes so newly inserted content gets a usable share. */
function insertedItemSize(items: ItemState[], flat: boolean): number {
  const expanded = items.filter(item => flat || item.slot.collapsed !== true)
  return expanded.length
    ? expanded.reduce((sum, item) => sum + (item.slot.size ?? DEFAULT_ITEM_SIZE), 0) / expanded.length
    : DEFAULT_ITEM_SIZE
}

/** The height at which a pane stops being grabbable at all, so a resize may not go below it. */
const MIN_ITEM_PX = 48

/** Does this ENTRY survive its child being closed? The list-specific half of the lifecycle, and the
 *  question a named region never has to ask (sandwich's `left` persists as a field either way). */
const survivesEmpty = (slot: SlotState): boolean => slots.survivesEmpty(slot)

/** The POSITION's runtime address, DERIVED from the host-owned `^:` so it round-trips — never minted, so
 *  `fromConfig(toConfig(m))` reproduces it and the resync short-circuits instead of churning every id.
 *  A ruled position uses its own `^:` (`slot.id`); a bare position uses its child's `^:`; a truly id-less
 *  transient position mints as a last resort. */
function entryIdOf(pos: { child?: { id: string }; slot: SlotState }): string {
  return pos.slot.id ?? pos.child?.id ?? genId()
}

/** Read one item's union value into the runtime shape. */
function itemFrom(value: Column['items'][number]): ItemState {
  const read = slots.read(value)
  return { entryId: entryIdOf(read), ...read }
}

function fromConfig(cfg: Column | undefined): ColumnModel {
  return {
    items: (cfg?.items ?? []).map(itemFrom),
    showItemHeaders: cfg?.showItemHeaders ?? true,
    itemHeaders: cfg?.itemHeaders,
    addButton: cfg?.addButton ?? 'always',
    allowWrap: cfg?.allowWrap ?? true,
  }
}

// The host derives config ownership from the type graph and preserves unowned fields
// at saveConfig. This projection emits only the fields it understands.
function itemToConfig(item: ItemState): Column['items'][number] | undefined {
  return slots.write(item) as Column['items'][number] | undefined
}

function toConfig(model: ColumnModel): Column {
  const out: Column = {
    type: 'column',
    items: model.items
      .map(itemToConfig)
      .filter((v): v is Column['items'][number] => v !== undefined),
  }
  // Written only when they DIFFER from the default, so a plain column stays byte-identical.
  // Both are in the column's OWN shape, which is what makes a conditional write safe: an omitted key is a
  // genuine removal rather than a stale value resurrected from the instance we were handed.
  if (model.addButton !== 'always') out.addButton = model.addButton
  if (!model.showItemHeaders) out.showItemHeaders = false
  if (model.itemHeaders) out.itemHeaders = model.itemHeaders
  if (!model.allowWrap) out.allowWrap = false
  return out
}

/** The slot governing this id as a `ContainerSlot`, or null when the position says nothing.
 *  Resolves an ENTRY id (a drop target), a CHILD id (a drag source), or a SLOT id. */
function slotOf(model: ColumnModel, id: string): ContainerSlot | null {
  const item = model.items.find((i) => i.entryId === id || i.child?.id === id || i.slot.id === id)
  return item ? slots.toSeamSlot(item.slot) : null
}

// Shared components own header, splitter and add-control presentation; these rules size their slots.
const STYLE = `
.au-col { display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; }
.au-col-item { display: flex; flex-direction: column; overflow: hidden; min-height: 0; border-bottom: 1px solid var(--au-line-1, rgba(255,255,255,0.09)); }
.au-col-item { position: relative; }
.au-col:not([data-item-headers="always"]) .au-col-item > au-pane-header {
  min-height: 0;
  height: 0;
  padding-block: 0;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: height var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
    opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
    visibility 0s var(--au-m-fast,160ms);
}
.au-col:not([data-item-headers="always"])[data-reveal-headers] .au-col-item > au-pane-header {
  height: var(--au-tabs-h,36px);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition-delay: 0s;
}
.au-col-edge-controls { position: relative; display:flex; align-items:center; justify-content:flex-start; flex:none; min-height:var(--au-space-6); padding-inline:var(--au-space-2); z-index:var(--au-z-raised); opacity: 0; transition: opacity var(--au-m-fast) var(--au-e-std); }
.au-col-item:hover > .au-col-edge-controls,
.au-col-edge-controls:focus-within,
.au-col-edge-controls:has([aria-expanded="true"]) { opacity: 1; }
.au-col[data-reveal-headers] .au-col-edge-controls { display: none; }
@media (hover: none) { .au-col-edge-controls { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .au-col-edge-controls,
  .au-col:not([data-item-headers="always"]) .au-col-item > au-pane-header { transition: none; }
}
.au-col-item.before-sash {border-bottom:0;}
/* An expanded item's share of the height is its WEIGHT, so a resize redistributes between two
   neighbours without pinning anyone to pixels and without breaking when the column is resized. */
.au-col-item.expanded { flex: var(--au-col-weight, 1) 1 0; }
.au-col-item.collapsed { flex: 0 0 auto; }
.au-col-body { flex: 1; min-height: 0; overflow: hidden; position: relative; }
/* The "+ pane" picker: BOUND its height so a long projection list scrolls inside its slot instead of
 * expanding to full content height and squeezing the existing items (PanePicker is height:100% + an
 * internal scroll, so it needs a definite bounded parent). */
.au-col-add { flex-shrink: 0; height: min(280px, 50%); min-height: 0; overflow: hidden; border-top: 1px solid var(--au-line-1, rgba(255,255,255,0.09)); }
.au-col-addbtn { flex-shrink: 0; min-width: 0; align-self: stretch; margin: var(--au-space-2); }
.au-col[data-add-button="hover"] .au-col-addbtn { opacity: 0; transition: opacity var(--au-m-fast) var(--au-e-std); }
.au-col[data-add-button="hover"]:hover .au-col-addbtn,
.au-col[data-add-button="hover"]:focus-within .au-col-addbtn { opacity: 1; }
@media (hover: none) { .au-col[data-add-button="hover"] .au-col-addbtn { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .au-col[data-add-button="hover"] .au-col-addbtn { transition: none; } }
.au-col-addbtn::part(button) { width: 100%; box-sizing: border-box; }
`

/** An item's header — the token-only <au-pane-header surface="rail"> frame that also OFFERS its `center`
 *  contribution region, so a `tabs` occupant portals its strip into THIS bar (one bar, like bento) instead
 *  of drawing its own strip below the item header. The offer hook lives here so its lifecycle tracks the
 *  header's presence. `claimed` (an occupant contributed) drops the item's own title AND disables the
 *  whole-row toggle — clicking a contributed tab must not collapse the item, so only the chevron toggles then. */
function ItemHeader({
  paneId,
  container,
  onToggle,
  leading,
  label,
  actions,
}: {
  paneId: PaneId | null
  container?: boolean
  onToggle?: () => void
  leading: ReactNode
  label: string
  actions: ReactNode
}): ReactNode {
  const { ref, claimed } = useOfferedHeaderRegion(paneId, 'center')
  return (
    <au-pane-header
      surface="rail"
      compact={container === true && !claimed}
      context={claimed ? label : undefined}
      style={{ cursor: claimed || !onToggle ? 'default' : 'pointer' }}
      onClick={claimed ? undefined : onToggle}
    >
      {leading}
      {!claimed && <span slot="title">{label}</span>}
      {/* The offered center region: a tabs occupant contributes its strip here; empty (present) otherwise. */}
      <div ref={ref} style={{ display: 'flex', alignItems: 'center', minWidth: 0, height: '100%' }} />
      {actions}
    </au-pane-header>
  )
}

function ColumnApp({ host }: { host: MountHost }): ReactNode {
  const [revealHeaders,setRevealHeaders]=useState(()=>document.documentElement.dataset.auPaneHeaders==='show')
  useEffect(()=>{
    const root=document.documentElement
    const update=()=>setRevealHeaders(root.dataset.auPaneHeaders==='show')
    const observer=new MutationObserver(update)
    observer.observe(root,{attributes:true,attributeFilter:['data-au-pane-headers']})
    update()
    return ()=>observer.disconnect()
  },[])

  const columnId = useMemo(() => genId(), [])
  const initial = useMemo(() => fromConfig(host.config as Column | undefined), [host])

  // `model` renders, `live()` is what every mutation and every seam method reads, `commit`
  // advances and persists. One drop drives the seam several times in ONE tick, so a seam method
  // reading the render-closure model rebuilds from a stale snapshot and resurrects what an earlier
  // commit removed. See `useContainerModel`.
  const { model, live, commit } = useContainerModel<ColumnModel>(
    initial,
    (next) => host.saveConfig(toConfig(next)),
    // RE-SEED on an external structural edit (a drag re-parent / closePane / wrapPane), so this column's
    // item anchors track its authoritative record instead of going stale.
    { host, fromConfig: (raw) => fromConfig(raw as Column | undefined) },
  )
  const [adding, setAdding] = useState(false)
  const addTrigger = useRef<HTMLElement>(null)
  const restoreAddFocus = useRef(false)
  const dismissAdd = (): void => { restoreAddFocus.current=true;setAdding(false) }
  useEffect(() => {
    if (adding || !restoreAddFocus.current) return
    restoreAddFocus.current = false
    // The replacement custom element must finish its first render before focus delegates inside.
    const frame = requestAnimationFrame(() => addTrigger.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [adding])
  /** The in-flight weights of the pair being resized. Transient — see `startResize`. */
  const [dragSizes, setDragSizes] = useState<{ aboveId: string; belowId: string; above: number; below: number } | null>(
    null,
  )

  /** Locate a position by ANY of its addresses: entry id, child id, or slot id. */
  const indexOf = (id: string): number =>
    live().items.findIndex((i) => i.entryId === id || i.child?.id === id || i.slot.id === id)

  const isCollapsed = (id: string): boolean => live().items[indexOf(id)]?.slot.collapsed === true

  /** Replace one position, addressed by any of its ids. */
  const withItem = (id: string, next: (item: ItemState) => ItemState): ColumnModel => {
    const m = live()
    const at = indexOf(id)
    if (at < 0) return m
    const items = m.items.slice()
    items[at] = next(items[at]!)
    return { ...m, items }
  }

  const toggle = (id: string): void => {
    // Collapsing MATERIALIZES the slot; expanding drops the flag, and `itemToConfig` collapses the
    // record back to a bare child when that was its last reason to exist.
    const now = isCollapsed(id)
    commit(
      withItem(id, (i) => ({
        ...i,
        slot: { ...i.slot, ...(now ? { collapsed: undefined } : { collapsed: true }) },
      })),
    )
  }

  // REVEAL a specific pane by id: expand its (possibly collapsed) section, claim (open-surfaces →
  // "Open editors" click). Declines when this column does not hold the pane. An item is always visible,
  // so this only un-collapses its section. `live` is ref-stable, so the handler reads current state.
  useEffect(() => {
    return host.intent.handle('reveal-pane-intent', {
      // CLAIM (pure): this column holds the pane. COMMIT: un-collapse its section (idempotent).
      claim: (intent) => isRevealPaneIntent(intent) && live().items.some((x) => x.child?.id === intent.paneId),
      commit: (intent) => {
        if (isRevealPaneIntent(intent) && isCollapsed(intent.paneId)) toggle(intent.paneId)
      },
    })
  }, [host])

  /**
   * Close an item's child. THE LIST-SLOT LIFECYCLE, and the one place it is decided: the entry
   * SURVIVES when its position still governs something (`admits`, or an `^:` id something may
   * point at) and goes otherwise. A surviving empty entry renders the picker narrowed to what it
   * admits, which is the "waiting for content" case falling out rather than needing a mechanism.
   */
  /** Remove an occupant for close or extraction. Both paths share the fixed-rule
   * check and empty-position lifecycle; extraction also retains the removed child. */
  const removeAt = (at: number): ChildState | null => {
    const m = live()
    const item = m.items[at]
    if (!item?.child) return null
    if (item.slot.fixed) return null // a fixed slot can never be emptied; the substrate refuses too
    const items = survivesEmpty(item.slot)
      ? m.items.map((i, n) => (n === at ? { entryId: i.entryId, slot: i.slot } : i))
      : m.items.filter((_, n) => n !== at)
    commit({ ...m, items })
    return item.child
  }

  /** The ✕ in an item's header. An extract whose result nobody keeps. */
  const removeItem = (id: string): void => void removeAt(indexOf(id))

  /** Replace one position's OCCUPANT. `occupantId` names the id the new occupant carries; absent
   *  keeps the current one. The position itself (`entryId`, `slot`) is untouched either way. */
  const updateItem = (id: string, instance: Projection, occupantId?: string): void =>
    commit(
      // Fresh content into an empty position → the HOST assigns the pool id; a named or existing id is reused.
      withItem(id, (i) => ({ ...i, child: { id: occupantId ?? i.child?.id ?? createChild(host, instance), instance } })),
    )

  // Universal swap: replace an item's occupant in place, carrying its document. Routes through the ONE
  // placement-seam address-op (`setPaneContent`), which honours `fixed` / `admits` at the seam — no
  // column-local fixity check, and the ⇄ is hidden for a fixed item. Keyed by `entryId` (which IS the
  // occupant's `^:`), resolved via the portal anchor and column's `slotFor` / `setSlotContent`.
  const swapPane = usePaneSwap(host)

  /** Fill an empty position, or append a new one when no id is given. */
  const placeItem = (typeId: string, at?: string): void => {
    const instance = { type: typeId } as Projection
    if (at !== undefined) return updateItem(at, instance)
    const m = live()
    const id = createChild(host, instance) // fresh content → the host assigns the pool id, which IS the entry id
    commit({ ...m, items: [...m.items, { entryId: id, child: { id, instance }, slot: { size: insertedItemSize(m.items, isFlat()) } }] })
  }

  /** Hidden item chrome leaves the content expanded and removes its header controls. */
  const headerMode = (): 'always' | 'hover' | 'hidden' => model.itemHeaders ?? (model.showItemHeaders ? 'always' : 'hidden')
  const isFlat = (): boolean => headerMode() !== 'always'

  /**
   * Resize the seam between two neighbours. The in-flight size is TRANSIENT UI state (`dragSizes`),
   * committed ONCE on release. The pointer-capture lifecycle is the shared `useResizeDrag` hook (see
   * `ColSash`); the PHYSICS — a pixel drag mapped to flex-grow weights against the two neighbours,
   * read off the sash's own siblings — stay column's. Weights, not pixels: a column's items share the
   * height, so a raw pixel size would not survive the container being resized.
   */
  const startResize = useCallback(
    (aboveId: string, belowId: string, e: ReactPointerEvent) => {
      const el = e.currentTarget as HTMLElement
      const aboveEl = el.previousElementSibling as HTMLElement | null
      const belowEl = el.nextElementSibling as HTMLElement | null
      if (!aboveEl || !belowEl) return null
      const startY = e.clientY
      const aboveH = aboveEl.getBoundingClientRect().height
      const belowH = belowEl.getBoundingClientRect().height
      const total = aboveH + belowH
      if(total <= MIN_ITEM_PX * 2) return null
      const startAbove = live().items[indexOf(aboveId)]?.slot.size ?? DEFAULT_ITEM_SIZE
      const startBelow = live().items[indexOf(belowId)]?.slot.size ?? DEFAULT_ITEM_SIZE
      const weightTotal = startAbove + startBelow
      let next: { above: number; below: number } | null = null
      return {
        onMove: (ev: PointerEvent): void => {
          // Clamp so neither side can be squeezed below the height at which a pane stops being usable.
          const h = Math.max(MIN_ITEM_PX, Math.min(total - MIN_ITEM_PX, aboveH + (ev.clientY - startY)))
          // The PAIR's weight sum is preserved, so a drag never disturbs an item elsewhere in the stack
          // and never changes the column's total.
          const above = (h / total) * weightTotal
          next = { above, below: weightTotal - above }
          setDragSizes({ aboveId, belowId, ...next })
        },
        onEnd: (commitDrag: boolean): void => {
          setDragSizes(null)
          if (!commitDrag || !next) return
          const m = live()
          const a = indexOf(aboveId)
          const b = indexOf(belowId)
          const items = m.items.slice()
          items[a] = { ...items[a]!, slot: { ...items[a]!.slot, size: next.above } }
          items[b] = { ...items[b]!, slot: { ...items[b]!.slot, size: next.below } }
          commit({ ...m, items })
        },
      }
    },
    [live, commit, indexOf],
  )

  const keyboardResize = (aboveId:string, belowId:string, event:ReactKeyboardEvent<HTMLElement>): void => {
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key) || event.altKey || event.metaKey || event.ctrlKey) return
    const aboveEl=event.currentTarget.previousElementSibling
    const belowEl=event.currentTarget.nextElementSibling
    if(!aboveEl || !belowEl) return
    const height=aboveEl.getBoundingClientRect().height
    const total=height+belowEl.getBoundingClientRect().height
    if(total<=MIN_ITEM_PX*2) return
    event.preventDefault();event.stopPropagation()
    const step=event.shiftKey ? 48 : 16
    const requested=event.key==='Home' ? MIN_ITEM_PX : event.key==='End' ? total-MIN_ITEM_PX : height+(event.key==='ArrowUp' ? -step : step)
    const nextHeight=Math.max(MIN_ITEM_PX,Math.min(total-MIN_ITEM_PX,requested))
    const m=live();const a=indexOf(aboveId);const b=indexOf(belowId)
    if(a<0 || b<0) return
    const totalWeight=(m.items[a]!.slot.size??DEFAULT_ITEM_SIZE)+(m.items[b]!.slot.size??DEFAULT_ITEM_SIZE)
    const weight=nextHeight/total*totalWeight
    const items=m.items.slice()
    items[a]={...items[a]!,slot:{...items[a]!.slot,size:weight}}
    items[b]={...items[b]!,slot:{...items[b]!.slot,size:totalWeight-weight}}
    commit({...m,items})
  }

  const sizeOf = (item: ItemState): number => {
    if (dragSizes?.aboveId === item.entryId) return dragSizes.above
    if (dragSizes?.belowId === item.entryId) return dragSizes.below
    return item.slot.size ?? DEFAULT_ITEM_SIZE
  }

  // The pure re-point seam: each transform mirrors the mutating seam below but returns the
  // new model instead of committing; `makePoolEdit` serializes it via `toConfig` + `withCarry` and the
  // router batches src+tgt into one atomic commit. `idxIn` is the model-scoped form of `indexOf`.
  const idxIn = (mm: ColumnModel, id: string): number =>
    mm.items.findIndex((i) => i.entryId === id || i.child?.id === id || i.slot.id === id)
  const poolEdit = makePoolEdit<ColumnModel>({
    host,
    live,
    ownedKeys: ['type', 'items', 'showItemHeaders', 'itemHeaders', 'addButton', 'allowWrap'],
    toConfig,
    remove: (m, localId) => {
      const at = idxIn(m, localId)
      const item = m.items[at]
      if (!item?.child) return null
      if (item.slot.fixed) return null
      const items = survivesEmpty(item.slot)
        ? m.items.map((i, n) => (n === at ? { entryId: i.entryId, slot: i.slot } : i))
        : m.items.filter((_, n) => n !== at)
      return { model: { ...m, items }, occupant: { instance: item.child.instance, id: item.child.id } }
    },
    place: (m, occ, target) => {
      const child: ChildState = { id: occ.id, instance: occ.instance as Projection }
      // Sizes are relative weights, not pixels. New panes must use the destination's scale.
      const fresh = { entryId: child.id, child, slot: { size: insertedItemSize(m.items, isFlat()) } }
      if (target.shape === 'slot-rect') {
        const ti = idxIn(m, target.slotId)
        if (ti >= 0 && m.items[ti]!.child === undefined) {
          return { ...m, items: m.items.map((i, n) => (n === ti ? { ...i, child, slot: { ...i.slot, collapsed: undefined } } : i)) }
        }
        if (ti >= 0) {
          const items = m.items.slice()
          items.splice(target.zone === 'bottom' ? ti + 1 : ti, 0, fresh)
          return { ...m, items }
        }
      }
      return { ...m, items: [...m.items, fresh] }
    },
    reorder: (m, sourceLocalId, target) => {
      if (target.shape !== 'slot-rect') return null
      const from = idxIn(m, sourceLocalId)
      let to = idxIn(m, target.slotId)
      if (from < 0 || to < 0) return null
      if (target.zone === 'bottom') to += 1
      const items = m.items.slice()
      const [moved] = items.splice(from, 1)
      if (!moved) return null
      items.splice(from < to ? to - 1 : to, 0, moved)
      return { ...m, items }
    },
    wrap: (m, slotId, groupId, groupInstance, removeLocalId) => {
      let items = m.items
      if (removeLocalId != null) {
        // POSITION-native: `removeLocalId` arrives resolved to an `entryId` (the boundary resolve).
        const at = items.findIndex((i) => i.entryId === removeLocalId || i.child?.id === removeLocalId || i.slot.id === removeLocalId)
        const item = items[at]
        if (item?.child) {
          items = survivesEmpty(item.slot)
            ? items.map((i, n) => (n === at ? { entryId: i.entryId, slot: i.slot } : i))
            : items.filter((_, n) => n !== at)
        }
      }
      const ti = items.findIndex((i) => i.entryId === slotId || i.child?.id === slotId || i.slot.id === slotId)
      if (ti < 0) return null
      items = items.map((i, n) => (n === ti ? { ...i, child: { id: groupId, instance: groupInstance as Projection } } : i))
      return { ...m, items }
    },
  })

  // ── ContainerPlacement — the shared router drives the column through the seam.
  //    Items are the slots (keyed by stable id). A slot-rect top/bottom zone inserts
  //    above/below the target item; center is the router's wrap-into-tabs.
  const placement: ContainerPlacement = {
    panes: () =>
      live().items.map((i) => i.child?.id).filter((id): id is string => id !== undefined),
    findPane: (id: PaneId): Pane | null => {
      const it = live().items.find((x) => x.child?.id === id)
      return it ? { id, type: it.child!.instance.type ?? '' } : null
    },
    // The resolve-at-boundary normalizer: map any inbound address (an `entryId`, a child `^:` OCCUPANT
    // id, or a slot id) to the canonical POSITION id — the item's `entryId`. `indexOf` resolves all three;
    // a bare `entryId` is idempotent. A bare item's `entryId` EQUALS its `child.id` (self-map); a ruled
    // item's is `slot.id`. `null` when this container holds no such id.
    resolve: (address) => {
      if (address === columnId && live().items.length === 0) return columnId
      const i = indexOf(address)
      return i >= 0 ? (live().items[i]?.entryId ?? null) : null
    },
    activate: (id: PaneId) => {
      // Revealing a pane expands its (possibly collapsed) section. `isCollapsed` routes through the dual
      // `indexOf`, so the resolved `entryId` the boundary passes locates the item.
      if (isCollapsed(id)) toggle(id)
    },
    // The OCCUPANT: its instance AND its own `^:` id, which is not the position's — `indexOf`
    // accepts an `entryId`, a `slot.id` or a `child.id`, and only the last names the occupant.
    getSlotContent: (slotId: string): Occupant | null => {
      const child = live().items[indexOf(slotId)]?.child
      return child ? { instance: child.instance, id: child.id } : null
    },
    setSlotContent: (slotId: string, instance: PaneInstance, occupantId?: string) => {
      // No local `admits` guard: the substrate checks it at every seam that reaches here (the
      // centre-wrap and the dissolve), BEFORE anything destructive runs.
      const m = live()
      if (m.items.length === 0) {
        // EMPTY CONTAINER: no position exists yet, so `updateItem` would no-op. CREATE the first item —
        // the empty-slot driver (`EmptySlot`) materializing its placeholder into an empty column.
        const child = { id: occupantId ?? createChild(host, instance as Projection), instance: instance as Projection }
        commit({ ...m, items: [{ entryId: child.id, child, slot: {} }] })
        return
      }
      updateItem(slotId, instance as Projection, occupantId)
    },
    moveWithin: (sourceLocalId: string, target: DropTarget) => {
      if (target.shape !== 'slot-rect') return false
      const m = live()
      const from = indexOf(sourceLocalId)
      let to = indexOf(target.slotId)
      if (from < 0 || to < 0) return false
      if (target.zone === 'bottom') to += 1
      const items = m.items.slice()
      const [moved] = items.splice(from, 1)
      if (!moved) return false
      items.splice(from < to ? to - 1 : to, 0, moved)
      commit({ ...m, items })
      return true
    },
    extract: (localId: string): Occupant | null => {
      // The SAME removal the ✕ performs — see `removeAt`. The seam simply keeps what came out.
      // POSITION-native: `localId` arrives resolved to an `entryId` (the boundary resolve).
      const child = removeAt(indexOf(localId))
      return child ? { instance: child.instance, id: child.id } : null
    },
    inject: (instance: PaneInstance, id: PaneId, target: DropTarget) => {
      const m = live()
      const child: ChildState = { id, instance: instance as Projection }
      if (target.shape === 'slot-rect') {
        const ti = indexOf(target.slotId)
        // Dropping ONTO an empty position fills it rather than inserting beside it — otherwise a
        // slot kept alive by `admits` could never actually be refilled by a drop.
        if (ti >= 0 && m.items[ti]!.child === undefined) {
          commit({ ...m, items: m.items.map((i, n) => (n === ti ? { ...i, child } : i)) })
          return
        }
        if (ti >= 0) {
          const items = m.items.slice()
          items.splice(target.zone === 'bottom' ? ti + 1 : ti, 0, { entryId: child.id, child, slot: {} })
          commit({ ...m, items })
          return
        }
      }
      commit({ ...m, items: [...m.items, { entryId: child.id, child, slot: {} }] })
    },
    // The lookup only this container can answer. The substrate owns what the answer MEANS.
    slotFor: (id: string): ContainerSlot | null => slotOf(live(), id),
    ...(poolEdit ? { poolEdit } : {}),
  }

  const setPlacementRoot = useContainerPlacement(placement)
  const setDialectRoot = useContainerDialect(columnDropDialect)
  const setContainerRoot = useMergedRef(setPlacementRoot, setDialectRoot)
  // A child's DECLARED title (`projection-presentation-meta`) off the host descriptor set, built once
  // per render pass and reused across items — reaches the item header without column reading the engine.
  const descriptors = host.describeProjections?.() ?? []
  const titleOf = projectionTitleLookup(descriptors)
  const containerTypes = new Set(descriptors.filter((p) => p.kinds.includes('container-projection')).map((p) => bareTypeName(p.type)))

  return (
    <div
      ref={setContainerRoot}
      data-layout-container-slot={columnId}
      data-container-kind="column"
      // This column's own declaration, read by its OWN dialect off the root it already receives.
      // Only written when it differs from the default, so the attribute is absent in the common case.
      {...(model.allowWrap ? {} : { 'data-allow-wrap': 'false' })}
      className="au-col"
      data-item-headers={headerMode()}
      data-reveal-headers={revealHeaders || undefined}
      data-add-button={model.addButton}
    >
      {model.items.length === 0 ? (
        <div
          data-droptarget-shape="slot-rect"
          data-container-kind="column"
          data-droptarget-id={columnId}
          style={{ flex: 1, minHeight: 0 }}
        >
          {/* Empty column: the substrate resolves the placeholder and materializes it as the first item
              via the seam (setSlotContent creates it). Addressed by `columnId`. */}
          <EmptySlot host={host} slotId={columnId} />
        </div>
      ) : (
        model.items.map((item, index) => {
          const flat = isFlat()
          // A flat item has no header, so there is no toggle to collapse it and no header to leave
          // behind — it is always expanded.
          const collapsed = !flat && item.slot.collapsed === true
          const fixed = item.slot.fixed === true
          const child = item.child
          const below = model.items[index + 1]
          // A sash only exists between two EXPANDED neighbours: a collapsed item is `flex: 0 0 auto`
          // with no height to give or take, so a sash against one would be a control that cannot do
          // anything.
          const resizable =
            below !== undefined && !collapsed && !(below.slot.collapsed === true && !isFlat())
          // An authored slot `label`, else the occupant's declared title, else its derived name. NEVER
          // suppressed: a column item header distinguishes SIBLINGS, so a blank one is a row nobody can
          // aim at. The POSITION's name wins whether or not it is occupied; only a nameless empty one
          // falls back. See the sandwich note: gating on `child` drops an authored label the moment the
          // position is emptied.
          const label = positionName(item.slot, child?.instance.type, titleOf(child?.instance.type)) || 'empty'
          const actionRows = (): ContextMenuItem[] => {
            if(!child || fixed)return []
            const choose=host.chooser ? host.chooser.choose.bind(host.chooser) : async()=>null
            const rows:ContextMenuItem[]=[...[-1,1].map(direction=>({
              id:direction<0?'item.move-up':'item.move-down',label:direction<0?'Move up':'Move down',
              enabled:!!model.items[index+direction] && !model.items[index+direction]!.slot.fixed,
              run:()=>{const current=live();const at=indexOf(child.id);const target=current.items[at+direction];if(at<0||!target||target.slot.fixed||current.items[at]!.slot.fixed)return;placement.moveWithin?.(child.id,{shape:'slot-rect',slotId:target.entryId,zone:direction<0?'top':'bottom'} as DropTarget)},
            })),
              {id:'item.swap',label:"Swap this item's content",icon:'swap',enabled:true,run:()=>swapPane.toggle(item.entryId)},
              {id:'item.wrap',label:'Wrap in a container',icon:'wrap',enabled:true,run:()=>void wrapPaneInteractive(child.id,{choose})},
            ]
            if(model.items.length===1)rows.push({id:'item.unwrap',label:'Unwrap container',icon:'unwrap',enabled:true,run:()=>dissolvePane(child.id)})
            const floatRow=floatPaneRow(host,child.id);if(floatRow)rows.push(floatRow)
            const moveRow=moveToWindowRow(host,child.id);if(moveRow)rows.push(moveRow)
            rows.push({id:'item.remove',label:'Remove',enabled:true,run:()=>removeItem(item.entryId)})
            return [...rows, ...reloadPaneRows(host, child.id)]
          }
          const grip=child&&!fixed ? <ColumnGrip host={host} paneId={child.id} type={child.instance.type} label={label} rows={actionRows} /> : null

          return (
            <Fragment key={item.entryId}>
            <section
              className={`au-col-item ${collapsed ? 'collapsed' : 'expanded'} ${resizable ? 'before-sash' : ''}`}
              id={`${columnId}-${item.entryId}`}
              style={{ ['--au-col-weight' as string]: sizeOf(item) }}
              data-droptarget-shape="slot-rect"
              data-container-kind="column"
              // The POSITION's address, never the occupant's — so an EMPTY position kept alive by
              // `admits` is still a drop target and can be refilled.
              data-droptarget-id={item.entryId}
            >
              {headerMode()==='hover' && grip && <div className="au-col-edge-controls">{grip}</div>}
              {(
              // The WHOLE row toggles collapse (a generous hit target); each interactive control SHIELDS
              // with stopPropagation so it does not also toggle (the chevron shields + toggles itself → one
              // net toggle). ItemHeader offers the center contribution region so a tabs occupant fills THIS
              // bar (and then the row-toggle is disabled — clicking a tab must not collapse the item). // controls slotted, wired via native events.
              <ItemHeader
                paneId={headerMode()==='always' ? child?.id ?? null : null}
                container={!collapsed && !!child && containerTypes.has(bareTypeName(child.instance.type))}
                onToggle={headerMode()==='always' ? () => toggle(item.entryId) : undefined}
                label={label}
                leading={
                  <span slot="leading" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--au-space-1)' }}>
                    {headerMode()==='always' && <AuChevron
                      open={!collapsed}
                      label={collapsed ? 'Expand' : 'Collapse'}
                      // au-chevron SWALLOWS its native click and re-emits `au-activate`, so a raw
                      // `onClick` never fires (it read as "collapse does nothing"). Listen for au-activate
                      // via the wrapper. au-chevron already stops the native click internally, so no
                      // stopPropagation is needed and the row-header onClick never double-toggles.
                      onAuActivate={() => toggle(item.entryId)}
                    />}
                    {child &&
                      (fixed ? (
                        <au-icon name="lock" size="xs" label="Fixed — this item cannot be moved out or closed" />
                      ) : (
                        grip
                      ))}
                  </span>
                }
                actions={
                  child && !fixed ? (
                    <span slot="actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--au-space-1)' }}>
                      {/* The occupant-level actions collapse behind ONE `⋯` overflow menu; the close (Remove)
                          stays a distinct destructive affordance. The item header owns its own collapse
                          click, so the menu button + the close both stopPropagation (the menu via the helper). */}
                      {paneActionsMenu(host, actionRows)}
                      <au-close-button
                        tone="danger"
                        label="Remove"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeItem(item.entryId)
                        }}
                      />
                    </span>
                  ) : null
                }
              />
              )}
              {!collapsed && (
                <div className="au-col-body">
                  {child ? (
                    swapPane.isSwapping(item.entryId) ? (
                      swapPane.swapPicker(item.entryId, child.instance)
                    ) : (
                    <PaneProjection
                      key={`${child.instance.type}:${(child.instance as { file?: string }).file ?? ''}`}
                      host={host}
                      paneId={child.id}
                      id={child.instance.type ?? ''}
                      config={child.instance}
                      onChildConfig={(next) => updateItem(item.entryId, next as Projection)}
                    />
                    )
                  ) : (
                    // A position kept alive by its rules, waiting for content: the substrate resolves the
                    // placeholder and materializes it here via the seam. `admits` is honoured at the seam;
                    // a position admitting no placeholder shows truly empty.
                    <EmptySlot host={host} slotId={item.entryId} />
                  )}
                </div>
              )}
            </section>
            {resizable && (
              <ColumnSplitter key={`sash-${item.entryId}`} label={label} controls={`${columnId}-${item.entryId}`}
                value={100*sizeOf(item)/(sizeOf(item)+sizeOf(below!))} minPixels={MIN_ITEM_PX}
                begin={e=>startResize(item.entryId,below!.entryId,e)} onResize={e=>keyboardResize(item.entryId,below!.entryId,e)} />
            )}
            </Fragment>
          )
        })
      )}
      {model.items.length > 0 &&
        (adding ? (
          <div className="au-col-add">
            <PanePicker
              onPick={(id) => {
                placeItem(id)
                dismissAdd()
              }}
              onCancel={dismissAdd}
              title="Add pane"
              descriptors={describeForPicker(host)}
            />
          </div>
        ) : model.addButton !== 'hidden' && (
          <AuButton ref={addTrigger} className="au-col-addbtn" variant="outline" size="sm" onAuActivate={() => setAdding(true)}>
            Add pane
          </AuButton>
        ))}
    </div>
  )
}

function mount(container: HTMLElement, host: MountHost): () => void {
  // The column's CSS is injected through the host so it is `@scope`-confined to this projection's
  // subtree and CSP-exempt (a raw <style> a strict CSP would block).
  const disposeStyles = host.styles?.inject(STYLE, container)
  const root = createRoot(container)
  root.render(<ColumnApp host={host} />)
  return () => {
    root.unmount()
    disposeStyles?.()
  }
}

/** Build a group of ordered children using column's own config schema.
 * Every child is visible; there is no active-child index. New items are expanded.
 * With no declared minimum arity, a column can retain a single child. */
const buildGroup: GroupBuildFn<Column> = (children) => ({
  type: 'column',
  items: children.map((c) => ({ '^': c.id, ...(c.instance as Record<string, unknown>) })) as Column['items'],
})

/**
 * The registered module — the projection's single default export. `defineProjection` brands it as the
 * loader's registration gate (the host resolves `mount` and `buildGroup` off the branded default), and
 * typing `GroupingContainerModule<Column>` makes a missing / mis-shaped surface a COMPILE error here —
 * `buildGroup` returns the generated `Column`, so a malformed group is caught too.

 */
export default defineProjection<GroupingContainerModule<Column>>({ mount, buildGroup })
