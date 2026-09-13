// Dock container: places bars along its edges and one child in its centre.
// Top and bottom edges span the full width; left and right fit between them.
// Each position is a child reference or container-slot. Position IDs remain
// stable across content swaps; occupant IDs travel with children and key view state.

import type { ContainerPlacement, ContainerSlot, Occupant, MountHost, OpaqueConfig, Pane, PaneInstance, ProjectionModule, PublisherId } from '@arsumbris/au-host-sdk'
import { defineProjection, reportHostDiagnostic } from '@arsumbris/au-host-sdk'
import { DATA_ATTR, attachContainer, displacementRefused, makePoolEdit, makeSlotCodec, mintBlockId, mountChild, type ChildMount, type SlotState as CoreSlotState } from '@arsumbris/container-core'
import type { Dock } from './generated'
import { dockDropDialect, DOCK_KIND } from './drop-dialect'

type Instance = { type: string } & Record<string, unknown>
type Edge = 'top' | 'bottom' | 'left' | 'right'
const EDGES: Edge[] = ['top', 'bottom', 'left', 'right']
/** The centre is a NAMED position, addressed by this literal — the fill region always exists as a
 *  place even when nothing occupies it, exactly as a sandwich region does. */
const CENTER = 'center'

// The host derives config ownership from the type graph and preserves unowned fields
// at saveConfig. This projection emits only the fields it understands.


let idSeq = 0
const genId = (): string => `dk-${Date.now().toString(36)}-${(idSeq++).toString(36)}`

/**
 * THE UNION CODEC — reading and writing `<projection& | container-slot>` is the substrate's, not
 * dock's. Dock declares only what is genuinely its own: which slot type it writes, that it honours
 * no extras (it sizes its edges by CSS grid, so neither a size nor a collapse would be acted on),
 * and its own id prefix.
 */
const slots = makeSlotCodec<Instance>({ slotType: 'container-slot', label: 'dock' })

/** A position's occupant: its stable `^:` id + the projection instance it mounts. */
type ChildState = Occupant<Instance>
/** What the POSITION says. dock adds nothing to the shared base. */
type SlotState = CoreSlotState

/** One position: an optional occupant plus what the position says about it. `entryId` is the
 *  POSITION's runtime address — see the header note on the two id spaces. */
interface PosState { entryId: string; child?: ChildState; slot: SlotState }

interface DockModel { top: PosState[]; bottom: PosState[]; left: PosState[]; right: PosState[]; center: PosState }

/** Does this POSITION survive its child being closed? Only when it still governs something. */
const survivesEmpty = (slot: SlotState): boolean => slots.survivesEmpty(slot)

function posFrom(value: unknown): PosState {
  // The ENTRY id is dock's own: a POSITION needs a runtime address the codec knows nothing about,
  // because how a position is addressed is each container's business.
  return { entryId: genId(), ...slots.read(value) }
}

/** Serialize one position back to its union value: absent, a bare child, or a slot record. */
function posToConfig(pos: PosState): unknown {
  return slots.write(pos)
}

function fromConfig(cfg: Dock | undefined): DockModel {
  const edge = (v: unknown[] | undefined): PosState[] => (v ?? []).map(posFrom)
  return {
    top: edge(cfg?.top),
    bottom: edge(cfg?.bottom),
    left: edge(cfg?.left),
    right: edge(cfg?.right),
    center: posFrom(cfg?.center),
  }
}

// `host.intent` (the intent/capability channel) is a contract capability. The payload is
// OPAQUE to the host (it routes by `type`); a consumer casts it to its own intent vocab. The
// dock's `reposition` intent carries the target `edge`.
interface RepositionIntent {
  type: string
  edge?: Edge
}

const STYLE = `
.au-dock { display: grid; height: 100%; width: 100%; box-sizing: border-box;
  grid-template-areas: "top top top" "left center right" "bottom bottom bottom";
  grid-template-rows: auto 1fr auto; grid-template-columns: auto 1fr auto; }
.au-dock-top { grid-area: top; display: flex; flex-direction: column; }
.au-dock-bottom { grid-area: bottom; display: flex; flex-direction: column; }
.au-dock-left { grid-area: left; display: flex; flex-direction: row; }
.au-dock-right { grid-area: right; display: flex; flex-direction: row; }
.au-dock-center { grid-area: center; overflow: hidden; min-width: 0; min-height: 0; }
.au-dock-slot { display: flex; }
.au-dock-top > .au-dock-slot, .au-dock-bottom > .au-dock-slot { width: 100%; }
.au-dock-left > .au-dock-slot, .au-dock-right > .au-dock-slot { height: 100%; }
/* the CENTER is a FILL region: a single grid cell (1fr/1fr) stretches its child to fill BOTH axes,
   so the center child stays pinned to the cell regardless of its own width/height (a flex slot only
   stretched the cross axis, leaving the main axis content-sized — which made a nested bento's sash
   resize drift its total width). min-width/height:0 lets it shrink below content instead of growing the cell. */
.au-dock-center > .au-dock-slot { display: grid; grid-template: 1fr / 1fr; width: 100%; height: 100%; }
.au-dock-center > .au-dock-slot > * { min-width: 0; min-height: 0; }
`

function mount(container: HTMLElement, host: MountHost): () => void {
  // The LIVE model. dock is vanilla, so this is a plain mutable binding rather than container-kit's
  // `useContainerModel` — but the discipline it enforces is the same one: every mutator and every
  // seam method reads THIS, never a snapshot, because one drop drives the seam several times in one
  // synchronous tick.
  let model: DockModel = fromConfig(host.config as Dock | undefined)

  const root = document.createElement('div')
  root.className = 'au-dock'
  // Marks this element as the dock's own container slot, so its dialect can tell ITS slots from
  // those of a nested dock (deepest-wins needs the distinction).
  root.setAttribute(DATA_ATTR.containerSlot, '')
  container.appendChild(root)
  const disposeStyles = host.styles?.inject(STYLE, container)

  // A child's live mount + the edge it sits on + its slot element, keyed by the child's STABLE `^:` id.
  // This is dock's MOUNT BOOKKEEPING: which children are live, so a render can unmount the ones that
  // left. It is NOT an anchor mechanism, and NOT a slot-reuse mechanism. Anchoring is DOM-authoritative
  // (a slot carries `data-pane-id`; the host-owned observer derives placement, reconciling the whole
  // mutation batch BEFORE paint), and the portal relays a slot's layout-context (`data-au-edge` /
  // `data-au-axis`) onto the pane host, so a rebuilt slot's child reads its edge and fills its width the
  // same as before. So dock simply rebuilds its slots each render — the framework-native vanilla path,
  // no stable-slot reuse needed for correctness OR for a portaled bar's orientation.
  const childMounts = new Map<string, { mount: ChildMount; edge: Edge | 'center'; el: HTMLElement }>()

  /** Every position on an edge, or the centre, as `(entryId, edge, index, pos)`. */
  function positions(): { edge: Edge | 'center'; index: number; pos: PosState }[] {
    const out: { edge: Edge | 'center'; index: number; pos: PosState }[] = []
    for (const e of EDGES) model[e].forEach((pos, index) => out.push({ edge: e, index, pos }))
    out.push({ edge: 'center', index: 0, pos: model.center })
    return out
  }

  /** Locate a position by ANY of its addresses: entry id, child id, slot id, or the centre literal. */
  function locate(id: string): { edge: Edge | 'center'; index: number; pos: PosState } | undefined {
    if (id === CENTER) return { edge: 'center', index: 0, pos: model.center }
    return positions().find(
      (e) => e.pos.entryId === id || e.pos.child?.id === id || e.pos.slot.id === id,
    )
  }

  /** Write a position back into the live model. */
  function put(edge: Edge | 'center', index: number, pos: PosState): void {
    if (edge === 'center') model = { ...model, center: pos }
    else model = { ...model, [edge]: model[edge].map((p, n) => (n === index ? pos : p)) }
  }

  // Persist the dock's complete instance up the tree; the host stamps `type: dock`.
  function persist(): void {
    const next: Record<string, unknown> = {}
    for (const e of EDGES) {
      // Always emit the edge — `[]` when empty, never omitted. The dock OWNS these fields, so dropping
      // an emptied edge from the save trips `config-own-field-dropped` and records "empty" as ambiguous
      // ABSENCE rather than an explicit empty. Repositioning the last bar OFF an edge must persist.
      next[e] = model[e].map(posToConfig).filter((v) => v !== undefined)
    }
    const center = posToConfig(model.center)
    if (center !== undefined) next[CENTER] = center
    // The dock is `DEFAULT_COMPOSITION`'s ROOT, so its instance carries composition-level fields
    // (`intent-defaults`, `initial-focus`), and an authored `locks` it no longer owns. `next` is
    // rebuilt from the positions alone, so it MUST go through `preserveUnowned` or every save strips
    // them and the next launch silently falls back to the unscoped focus-MRU walk.
    host.saveConfig?.(next as OpaqueConfig)
  }

  const commit = (): void => {
    persist()
    render()
  }

  // Mount through the shared mountChild helper. Its synchronous handle owns
  // asynchronous cancellation, so tracking and disposing the handle is sufficient.
  function mountInto(
    slotEl: HTMLElement,
    edge: Edge | 'center',
    index: number,
  ): void {
    const pos = edge === 'center' ? model.center : model[edge][index]
    const child = pos?.child
    if (!child?.instance.type) return
    // AUTO-POOL a child mounted inline (a legacy inline node), so it becomes an addressable pool
    // record and its `[[^^childId]]` reference never dangles. No-op once pooled. Same rule as
    // PaneProjection, applied in dock's own (vanilla) mount path.
    if (host.children.pool && host.children.pool.resolveRecord(child.id) == null) {
      host.children.pool.ensureRecord(child.id, child.instance as OpaqueConfig)
    }
    const mount = mountChild(host, slotEl, {
      id: child.instance.type,
      // The CHILD's stable id keys its restorable view-state and its terminal session.
      paneId: child.id,
      config: child.instance as OpaqueConfig,
      onChildConfigChange: (next) => {
        const at = locate(child.id)
        if (!at) return
        put(at.edge, at.index, { ...at.pos, child: { id: child.id, instance: next as Instance } })
        persist()
      },
      renderError: (target, message) => {
        // The child-mount error condition is an `<au-banner>` (danger tone). Set-INDEPENDENT: `message`
        // is the only property this vanilla projection sets.
        const e = document.createElement('au-banner') as HTMLElement & { message: string }
        e.setAttribute('tone', 'danger')
        e.message = message
        target.appendChild(e)
      },
    })
    childMounts.set(child.id, { mount, edge, el: slotEl })
  }

  /** A slot element's chrome. An EDGE slot is a drop target tagged with its edge (the container-axis
   *  context a bar reads to orient) + the POSITION id the placement addresses it by. The centre is a
   *  bare fill cell, never a drop target. */
  function dressSlot(slotEl: HTMLElement, edge: Edge | 'center', pos: PosState): void {
    slotEl.className = 'au-dock-slot'
    if (edge === 'center') return
    slotEl.dataset.auEdge = edge
    slotEl.setAttribute(DATA_ATTR.droptargetShape, 'slot-rect')
    slotEl.setAttribute(DATA_ATTR.containerKind, DOCK_KIND)
    slotEl.setAttribute(DATA_ATTR.droptargetId, pos.entryId)
  }

  function render(): void {
    // NUKE-AND-REBUILD. Unmount every current child (a portal-mode unmount just clears its slot's
    // `data-pane-id`), drop all region chrome, then rebuild fresh slots and tag the occupied ones. The
    // host-owned observer sees the old tags leave and the new tags arrive in ONE mutation batch and
    // re-anchors each live pane into its new slot BEFORE the browser paints; the portal relays each
    // slot's `data-au-edge` onto the pane host, so a rebuilt bar reads its edge and fills its width just
    // as a reused slot would. So a rebuild needs no stable-slot reuse. Occupied slots are tagged AFTER
    // the chrome is appended (the `toMount` deferral), so the observer sees each `data-pane-id` on a slot
    // already in its final DOM position. This is the framework-native vanilla path.
    for (const { mount, el } of childMounts.values()) {
      mount.unmount()
      el.remove()
    }
    childMounts.clear()
    root.querySelectorAll('.au-dock-top, .au-dock-bottom, .au-dock-left, .au-dock-right, .au-dock-center').forEach((n) => n.remove())
    const toMount: { slotEl: HTMLElement; edge: Edge | 'center'; index: number }[] = []

    for (const edge of EDGES) {
      const region = document.createElement('div')
      region.className = `au-dock-${edge}`
      model[edge].forEach((pos, index) => {
        const slotEl = document.createElement('div')
        dressSlot(slotEl, edge, pos)
        region.appendChild(slotEl)
        if (pos.child?.instance.type) toMount.push({ slotEl, edge, index })
      })
      root.appendChild(region)
    }

    // The fill centre: one position (typically a bento).
    const center = document.createElement('div')
    center.className = 'au-dock-center'
    if (model.center.child?.instance.type) {
      const slotEl = document.createElement('div')
      dressSlot(slotEl, 'center', model.center)
      center.appendChild(slotEl)
      toMount.push({ slotEl, edge: 'center', index: 0 })
    }
    root.appendChild(center)

    // Tag/mount every occupied slot, now that the chrome is in its final shape.
    for (const { slotEl, edge, index } of toMount) mountInto(slotEl, edge, index)
  }

  // Handle a child bar's `reposition` request: move its position's child from its current edge to
  // `edge`, persist, re-render. `from` is the firer's publisher; the host's publisher → `^:` bridge
  // (`nodeIdOf`) plus dock's own `locate` map it to the edge/index — works whether dock mounts its
  // children (legacy) or the PORTAL mounts them flat (dock then renders only anchors, no mount callback).
  // CLAIM / DECLINE: `false` on every path that did nothing, so the responder-chain walk continues.

  // Publish edge orientation as container-axis context on the slot.
  // The bar derives its orientation without the dock writing the child's config.

  function reposition(from: PublisherId, edge?: Edge): boolean {
    if (!edge || !EDGES.includes(edge)) return false
    const childId = host.children.nodeIdOf?.(from)
    const cur = childId ? locate(childId) : undefined
    // Not one of THIS dock's edge children (the centre is not repositioned; or already there) — not ours.
    if (!cur || cur.edge === 'center' || cur.edge === edge) return false
    const occupant = model[cur.edge][cur.index]?.child
    if (!occupant) return false
    // Repositioning moves a child and must respect the source slot's fixed rule.
    // Report a refused move so it can be distinguished from an unrecognized bar.
    if (displacementRefused(placement, occupant.id, 'move')) return true
    const child = removeFrom(cur.edge, cur.index)
    if (!child) return false
    // THE SLOT DOES NOT TRAVEL. A list position is a place, so the child arrives in a FRESH bare
    // position and picks up whatever rules the destination has — which, appended to an edge, is
    // none. Carrying the source's `admits` / `fixed` along would make a rule follow a thing, which
    // is containment-not-attachment inverted.
    model = { ...model, [edge]: [...model[edge], { entryId: genId(), child, slot: {} }] }
    commit()
    return true // CLAIMED: the bar moved.
  }

  /**
   * Take the child out of a position. THE ONE REMOVAL PATH: a close and an extract are the same
   * operation, and the only difference is whether the caller keeps what came out. Written once so the
   * `fixed` refusal and the empty-position lifecycle cannot disagree between the two.
   *
   * An EDGE position is a list entry, so it goes unless it still governs something. The CENTRE is a
   * named position that always exists, so it is only ever emptied.
   */
  function removeFrom(edge: Edge | 'center', index: number): ChildState | null {
    const pos = edge === 'center' ? model.center : model[edge][index]
    if (!pos?.child) return null
    if (pos.slot.fixed) return null // a fixed slot can never be emptied; the substrate refuses too
    const child = pos.child
    if (edge === 'center') model = { ...model, center: { entryId: pos.entryId, slot: pos.slot } }
    else if (survivesEmpty(pos.slot)) put(edge, index, { entryId: pos.entryId, slot: pos.slot })
    else model = { ...model, [edge]: model[edge].filter((_, n) => n !== index) }
    return child
  }

  /** Say WHY a placement op refused. A silent refusal in a container is indistinguishable from a
   *  working drop that landed somewhere unexpected. */
  function refuse(op: string, why: string, detail?: Record<string, unknown>): void {
    reportHostDiagnostic({
      code: 'dock-drop-refused',
      severity: 'warning',
      subject: 'dock',
      message: `${op}: ${why}`,
      detail: { op, ...detail },
    })
  }

  /** Where a `slot-rect` target with this zone inserts, relative to the addressed position. */
  function insertIndexFor(index: number, zone: string): number {
    // `top`/`left` mean BEFORE the addressed slot; `bottom`/`right` mean after.
    const before = zone === 'top' || zone === 'left'
    return before ? index : index + 1
  }

  // The pure re-point seam: each transform mirrors the mutating seam below but returns a
  // NEW model without touching the live `model`; `makePoolEdit` serializes it via `toConfigPure` +
  // `withCarry` and the router batches src+tgt into one atomic commit. These operate on the PASSED
  // model, so they never read the outer `model` binding (the `positions`/`locate`/`removeFrom`
  // helpers above do, which is why they cannot be reused here).
  const posesOf = (mm: DockModel): { edge: Edge | 'center'; index: number; pos: PosState }[] => {
    const out: { edge: Edge | 'center'; index: number; pos: PosState }[] = []
    for (const e of EDGES) mm[e].forEach((pos, index) => out.push({ edge: e, index, pos }))
    out.push({ edge: 'center', index: 0, pos: mm.center })
    return out
  }
  const locateIn = (mm: DockModel, id: string): { edge: Edge | 'center'; index: number; pos: PosState } | undefined =>
    id === CENTER
      ? { edge: 'center', index: 0, pos: mm.center }
      : posesOf(mm).find((e) => e.pos.entryId === id || e.pos.child?.id === id || e.pos.slot.id === id)
  const removeFromPure = (mm: DockModel, edge: Edge | 'center', index: number): { model: DockModel; child: ChildState } | null => {
    const pos = edge === 'center' ? mm.center : mm[edge][index]
    if (!pos?.child || pos.slot.fixed) return null
    const child = pos.child
    const bare = { entryId: pos.entryId, slot: pos.slot }
    const next: DockModel =
      edge === 'center'
        ? { ...mm, center: bare }
        : survivesEmpty(pos.slot)
          ? { ...mm, [edge]: mm[edge].map((p, n) => (n === index ? bare : p)) }
          : { ...mm, [edge]: mm[edge].filter((_, n) => n !== index) }
    return { model: next, child }
  }
  const toConfigPure = (mm: DockModel): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const e of EDGES) {
      const list = mm[e].map(posToConfig).filter((v) => v !== undefined)
      if (list.length) out[e] = list
    }
    const center = posToConfig(mm.center)
    if (center !== undefined) out[CENTER] = center
    return out
  }
  const poolEdit = makePoolEdit<DockModel>({
    host,
    live: () => model,
    ownedKeys: ['type', 'top', 'bottom', 'left', 'right', 'center'],
    toConfig: toConfigPure,
    remove: (mm, localId) => {
      const hit = posesOf(mm).find((e) => e.pos.child?.id === localId)
      if (!hit || hit.edge === 'center') return null
      const r = removeFromPure(mm, hit.edge, hit.index)
      return r ? { model: r.model, occupant: { instance: r.child.instance, id: r.child.id } } : null
    },
    place: (mm, occ, target) => {
      if (target.shape !== 'slot-rect') return null
      const to = locateIn(mm, target.slotId)
      if (!to || to.edge === 'center') return null
      const edge = to.edge
      const child: ChildState = { id: occ.id, instance: occ.instance as Instance }
      if (to.pos.child === undefined) {
        return { ...mm, [edge]: mm[edge].map((p, n) => (n === to.index ? { ...to.pos, child } : p)) }
      }
      const at = insertIndexFor(to.index, target.zone)
      return { ...mm, [edge]: [...mm[edge].slice(0, at), { entryId: genId(), child, slot: {} }, ...mm[edge].slice(at)] }
    },
    reorder: (mm, sourceLocalId, target) => {
      const from = posesOf(mm).find((e) => e.pos.child?.id === sourceLocalId)
      if (!from || from.edge === 'center') return null
      if (target.shape !== 'slot-rect') return null
      const to = locateIn(mm, target.slotId)
      if (!to || to.edge === 'center') return null
      const toEdge = to.edge
      let insertAt = insertIndexFor(to.index, target.zone)
      const r = removeFromPure(mm, from.edge, from.index)
      if (!r) return null
      if (from.edge === toEdge && from.index < insertAt) insertAt -= 1
      return {
        ...r.model,
        [toEdge]: [...r.model[toEdge].slice(0, insertAt), { entryId: genId(), child: r.child, slot: {} }, ...r.model[toEdge].slice(insertAt)],
      }
    },
    wrap: (mm, slotId, groupId, groupInstance, removeLocalId) => {
      let cur = mm
      if (removeLocalId != null) {
        const hit = posesOf(cur).find((e) => e.pos.child?.id === removeLocalId)
        if (hit && hit.edge !== 'center') {
          const r = removeFromPure(cur, hit.edge, hit.index)
          if (r) cur = r.model
        }
      }
      const to = locateIn(cur, slotId)
      if (!to) return null
      const child: ChildState = { id: groupId, instance: groupInstance as Instance }
      if (to.edge === 'center') return { ...cur, center: { ...to.pos, child } }
      const edge = to.edge
      return { ...cur, [edge]: cur[edge].map((p, n) => (n === to.index ? { ...to.pos, child } : p)) }
    },
  })

  const placement: ContainerPlacement = {
    panes: () => positions().flatMap((e) => (e.pos.child ? [e.pos.child.id] : [])),
    findPane: (id) => {
      const hit = positions().find((e) => e.pos.child?.id === id)
      return hit?.pos.child ? ({ id, type: hit.pos.child.instance.type } satisfies Pane) : null
    },
    // A dock child is always visible — every edge region and the centre render at once — so there is
    // nothing to reveal. An honest no-op rather than a false claim of having focused something.
    activate: () => {},
    // The OCCUPANT: its instance AND its own `^:` id, which is not the position's (an edge + index).
    getSlotContent: (slotId) => {
      const child = locate(slotId)?.pos.child
      return child ? ({ instance: child.instance, id: child.id } as Occupant) : null
    },
    setSlotContent: (slotId, instance, occupantId) => {
      // No local `admits` guard: the substrate checks it at every seam that reaches here, BEFORE
      // anything destructive runs.
      const at = locate(slotId)
      if (!at) return
      // Absent keeps the occupant's current id; present means the caller is naming it. `...at.pos`
      // carries the POSITION's own fields through untouched — replacing an occupant is not
      // replacing a position.
      const id = occupantId ?? at.pos.child?.id ?? mintBlockId() // pool `^:` id: the substrate minter, not dock's genId (position ids)
      put(at.edge, at.index, { ...at.pos, child: { id, instance: instance as Instance } })
      commit()
    },
    /** A reorder WITHIN this dock: move a bar to another position, possibly on another edge. */
    moveWithin: (sourceLocalId, target) => {
      const from = positions().find((e) => e.pos.child?.id === sourceLocalId)
      if (!from) {
        refuse('moveWithin', `no dock child with id "${sourceLocalId}"`, { sourceLocalId })
        return false
      }
      if (from.edge === 'center') {
        refuse('moveWithin', 'the dock CENTRE cannot be moved; it is the fill region, not a list item')
        return false
      }
      if (target.shape !== 'slot-rect') {
        refuse('moveWithin', `a dock only accepts a slot-rect target, got "${target.shape}"`, { shape: target.shape })
        return false
      }
      const to = locate(target.slotId)
      if (!to || to.edge === 'center') {
        refuse('moveWithin', 'a dock child can only move to another EDGE slot', { slotId: target.slotId })
        return false
      }
      const toEdge = to.edge
      let insertAt = insertIndexFor(to.index, target.zone)
      const child = removeFrom(from.edge, from.index)
      if (!child) return false
      // Removing from the SAME list shifts every later index down by one, including the target.
      if (from.edge === toEdge && from.index < insertAt) insertAt -= 1
      model = {
        ...model,
        [toEdge]: [
          ...model[toEdge].slice(0, insertAt),
          { entryId: genId(), child, slot: {} },
          ...model[toEdge].slice(insertAt),
        ],
      }
      commit()
      return true
    },
    /** Remove a bar and hand it to the router, which injects it into the target container. */
    extract: (localId): Occupant | null => {
      const hit = positions().find((e) => e.pos.child?.id === localId)
      // The CENTRE is not extractable: it is the fill region, and removing it would leave the dock
      // structurally empty rather than smaller. Returning null is the contract's "not mine".
      if (!hit || hit.edge === 'center') return null
      // The SAME removal a close performs — see `removeFrom`. The seam simply keeps what came out.
      const child = removeFrom(hit.edge, hit.index)
      if (!child) return null
      commit()
      return { instance: child.instance as PaneInstance, id: child.id }
    },
    /** Place a subtree arriving from another container into one of this dock's edges. */
    inject: (instance, id, target) => {
      // Every refusal below REPORTS. A refused inject is the worst silence in the substrate: the
      // router has ALREADY extracted the subtree from its source, so a quiet return loses a pane.
      if (target.shape !== 'slot-rect') {
        refuse('inject', `a dock only accepts a slot-rect target, got "${target.shape}"`, { shape: target.shape })
        return
      }
      const to = locate(target.slotId)
      if (!to) {
        refuse('inject', `no dock slot with id "${target.slotId}"`, { slotId: target.slotId })
        return
      }
      if (to.edge === 'center') {
        refuse('inject', 'the dock CENTRE is a fill region owned by the container inside it, not a drop slot')
        return
      }
      const child: ChildState = { id, instance: instance as Instance }
      // Dropping ONTO an empty position FILLS it rather than inserting beside it — otherwise a
      // position kept alive by `admits` could never actually be refilled by a drop.
      if (to.pos.child === undefined) {
        put(to.edge, to.index, { ...to.pos, child })
        commit()
        return
      }
      const at = insertIndexFor(to.index, target.zone)
      const edge = to.edge
      model = {
        ...model,
        [edge]: [...model[edge].slice(0, at), { entryId: genId(), child, slot: {} }, ...model[edge].slice(at)],
      }
      commit()
    },
    // The lookup only this container can answer: which slot governs this id, whether the caller named
    // the position, its occupant, or the slot itself. The substrate owns what the answer MEANS.
    slotFor: (id): ContainerSlot | null => {
      const at = locate(id)
      return at ? slots.toSeamSlot(at.pos.slot) : null
    },
    ...(poolEdit ? { poolEdit } : {}),
  }

  const attached = attachContainer(root, { placement, dialect: dockDropDialect })

  const disposeIntent = host.intent.handle('reposition', {
    claim: () => true, // the dock is the sole handler of its own reposition (firer-relative); always claim.
    commit: (intent, from) => {
      reposition(from, (intent as RepositionIntent).edge)
    },
  })

  render()

  return () => {
    disposeStyles?.()
    disposeIntent() // intent.handle always returns a disposer
    attached.detach()
    for (const { mount } of childMounts.values()) mount.unmount()
    childMounts.clear()
    container.replaceChildren()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
