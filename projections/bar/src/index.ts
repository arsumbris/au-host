// Bar: a strip on a frame edge laying out bar items in start, centre, and end regions.
// Each item is an INLINE `bar-item-projection` record (a concrete item type plus its fields); the bar
// mounts it itself. The bar offers every discovered item subtype not yet placed as an item to add.
// Only the end region supports overflow: lower-priority eligible items move into a shared preview
// popover. Pinning an item makes it first visible. Start and centre regions do not provide an overflow
// popover.

import { defineProjection, descriptorTitle, type ProjectionModule, type ContextMenuItem, type MountHost, type ChildHandle, type OpaqueConfig } from '@arsumbris/au-host-sdk'
import type { Bar } from './generated'

/** The item KIND the bar lays out; every discovered subtype of it is an item the bar can add. */
const ITEM_KIND = 'bar-item-projection'

/** One placed item: an inline record claiming a concrete `bar-item-projection` subtype. Its placement
 *  hints are its own fields; everything else is the widget's config, opaque to the bar. */
type BarItem = { type: string; order?: number; minSize?: number; overflowEligible?: boolean } & Record<string, unknown>
/** The three regions hold `BarItem`s: the runtime treats a widget's config as opaque beyond its hints. */
interface BarConfig extends Omit<Bar, 'type' | 'start' | 'center' | 'end'> {
  start?: BarItem[]
  center?: BarItem[]
  end?: BarItem[]
}
type Region = 'start' | 'center' | 'end'
const REGIONS: Region[] = ['start', 'center', 'end']
/** An item type the bar can add: its bare type name and its display label. */
interface ItemCandidate {
  type: string
  label: string
}
interface PreviewSurfaceLike {
  show(key: string, rect: DOMRect, fill: (card: HTMLElement, isCurrent: () => boolean) => void): void
  hide(): void
  isShowing(key: string): boolean
}
type HostX = MountHost & { preview?: PreviewSurfaceLike }

const bareType = (type: string): string => type.split('::')[0]!

/** Counts mounted bars, so each bar's overflow popover has its own key on the shared preview surface. */
let mountedBars = 0

const STYLE = `
/* A bar is window CHROME, not a pane card: it sits flush with its frame edge, square, on the window's own
   ground, with one hairline rule on the side facing the content. The docked <au-toolbar> look (transparent,
   --au-line-2 rule, --au-status-h height), oriented by the edge the bar sits on. */
.au-bar-frame { display:flex; box-sizing:border-box; min-width:0; min-height:0; width:100%; height:100%; min-block-size:var(--au-status-h); padding-inline:var(--au-space-2); }
.au-bar-frame.vertical { min-block-size:0; min-inline-size:var(--au-status-h); padding-inline:0; padding-block:var(--au-space-2); }
/* The rule faces the content. So does a small pad: bar items' glyphs render high in their line boxes, so
   box-centred text reads shifted inward; the inward pad moves it back to the optical centre. */
.au-bar-frame[data-edge='bottom'] { border-block-start:1px solid var(--au-line-2); padding-block-start:var(--au-space-0-5); }
.au-bar-frame[data-edge='top'] { border-block-end:1px solid var(--au-line-2); padding-block-end:var(--au-space-0-5); }
.au-bar-frame[data-edge='left'] { border-inline-end:1px solid var(--au-line-2); padding-inline-end:var(--au-space-0-5); }
.au-bar-frame[data-edge='right'] { border-inline-start:1px solid var(--au-line-2); padding-inline-start:var(--au-space-0-5); }

.au-bar { display: flex; align-items: center; gap: var(--au-space-1-5); height: 100%; width: 100%; box-sizing: border-box; overflow: hidden; background: transparent; }
.au-bar.vertical { flex-direction: column; align-items: stretch; width: 100%; height: 100%; }
/* left edge: reverse the main axis so start lands at the bottom / end at the top, matching the
   bottom-to-top reading of the 180°-flipped content (the mirror of the right edge). */
.au-bar.vertical.reverse-main { flex-direction: column-reverse; }
.au-bar-region { display: flex; gap: var(--au-space-1-5); align-items: center; min-width: 0; }
.au-bar.vertical .au-bar-region { flex-direction: column; align-items: stretch; }
.au-bar-spacer { flex: 1 1 auto; }
.au-bar-slot { display: flex; flex: 0 0 auto; }
.au-bar-slot[hidden] { display: none; }
/* CONTAINER-OWNED ROTATION (default): in a vertical (side) bar the container rotates each slot's
   content to read DOWN the bar, so a mounted projection needs NO rotation code. writing-mode turns
   the row top-to-bottom and rotates glyphs; height:auto sizes the slot to the content length (not
   the full bar height, which would eat the regions' distribution space). The left edge (reverse-main)
   flips 180° so glyph bottoms point INWARD (mirror of the right edge, whose bottom already points
   left = inward). A projection wanting custom vertical presentation overrides by reading
   data-au-axis / data-au-edge and resetting writing-mode on its own root. */
.au-bar.vertical .au-bar-slot { writing-mode: vertical-rl; height: auto; }
.au-bar.vertical.reverse-main .au-bar-slot { transform: rotate(180deg); }
.au-bar-more { font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-sans); color: var(--au-color-text); background: color-mix(in srgb, var(--au-color-muted) 18%, transparent); border: none; border-radius: var(--au-radius-sm); padding: var(--au-space-0-5) var(--au-space-2); cursor: pointer; white-space: nowrap; flex: 0 0 auto; }
.au-bar-more:hover { background: var(--au-chrome-hover); }
/* the empty-bar affordance: a "⋯" at the END of the bar (candidates are surfaced via right-click,
   not inline chips). flex:0 so the spacers push it to the trailing edge; hover/title shows intent. */
.au-bar-hint { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; min-width: 22px; padding: 0 var(--au-space-1-5); font: var(--au-t-base) var(--au-font-sans); line-height: 1; color: var(--au-ink-4); cursor: pointer; user-select: none; -webkit-user-select: none; }
.au-bar-hint:hover { color: var(--au-ink-1); }
.au-bar-error { color: var(--au-color-danger); font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono); padding: 0 var(--au-space-1-5); }
/* the "+N more" overflow popover content: it PORTALS to the host preview card (outside this pane's
   subtree), so its menu copies the host scope marker (see openOverflowPopover), and the host's
   scoped sheet reaches it there */
.au-bar-ov-menu { display: flex; flex-direction: column; min-width: 160px; }
.au-bar-ov-item { display: flex; justify-content: space-between; gap: var(--au-space-3); align-items: baseline; padding: var(--au-space-1-5) var(--au-space-2-5); background: transparent; border: none; color: var(--au-color-text); font: var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); cursor: pointer; text-align: left; }
.au-bar-ov-item:hover { background: var(--au-chrome-hover); }
.au-bar-ov-pin { color: var(--au-ink-3); font-size: var(--au-t-2xs); text-transform: uppercase; letter-spacing: var(--au-ls-label); }
/* Context-menu chrome belongs to host.contextMenu. */
`

/**
 * The candidate item types NOT already placed in any region: the add-able set, deduped, in label
 * order. Placed items and candidates both carry owner-qualified types
 * (`engine-status-bar-item::engine-status`), and both sides compare on the bare name. Pure, so it is
 * unit-testable without a DOM.
 */
export function availableItems(config: Pick<BarConfig, 'start' | 'center' | 'end'>, candidates: ItemCandidate[]): ItemCandidate[] {
  const placed = new Set<string>()
  for (const r of REGIONS) for (const item of config[r] ?? []) if (item?.type) placed.add(bareType(item.type))
  const seen = new Set<string>()
  const out: ItemCandidate[] = []
  for (const c of candidates) {
    const key = bareType(c.type)
    if (placed.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/** Where a newly added item goes in a region: before the first item with a larger `order` hint, else
 *  at the end. An item without a hint is placed last. */
export function insertionIndex(items: readonly BarItem[], order: number | undefined): number {
  if (order === undefined) return items.length
  const at = items.findIndex((item) => item.order !== undefined && item.order > order)
  return at === -1 ? items.length : at
}

/**
 * The `end`-region item indices eligible to overflow, in BUNCHING order (lowest priority first =
 * last in list order). An item bunches by default; `overflowEligible: false` pins it visible. So a
 * cramped bar collapses its trailing items naturally, and an item opts OUT explicitly. Pure /
 * unit-testable; the DOM measurement loop hides these in order until the bar fits.
 */
export function overflowOrder(end: BarItem[]): number[] {
  const order: number[] = []
  for (let i = end.length - 1; i >= 0; i--) if (end[i]?.type && end[i].overflowEligible !== false) order.push(i)
  return order
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const config: BarConfig = { ...((host.config as BarConfig | undefined) ?? {}) }
  // normalize the region arrays so we can mutate + round-trip them.
  for (const r of REGIONS) config[r] = [...(config[r] ?? [])]

  const preview = (host as HostX).preview
  // The candidate item types, read LIVE (an item type discovered after mount shows up), labelled by
  // their presentation title. `type` is the owner-qualified `name::repo` an added item record claims, the
  // same form dock writes for a bar, so the record validates from the composition's own repo.
  const itemCandidates = (): ItemCandidate[] => {
    const descriptors = host.describeProjections?.() ?? []
    return host.listContributions(ITEM_KIND).map((c) => {
      const d = descriptors.find((x) => bareType(x.type) === c.projection)
      return { type: d ? `${c.projection}::${d.repo}` : c.projection, label: descriptorTitle(d) ?? c.projection }
    })
  }
  const labelOf = (type: string): string => itemCandidates().find((c) => bareType(c.type) === bareType(type))?.label ?? bareType(type)
  // CONTAINER AXIS CONTEXT: the bar's OWN edge, if a dock mounted it on one (set on the bar's container
  // slot, relayed onto the portal host by the coordinator). Its orientation is a CONSEQUENCE of the
  // edge: left/right are vertical, top/bottom horizontal; off an edge it is horizontal.
  // REACTIVE: dock can move the bar to another edge, and the portal is never re-mounted, only
  // re-anchored (the coordinator relays the new `data-au-edge` onto the container). So the bar OBSERVES
  // its container's edge and re-derives, rather than reading it once at mount.
  let myEdge = container.dataset.auEdge
  const deriveOrientation = (): 'horizontal' | 'vertical' =>
    myEdge === 'left' || myEdge === 'right' ? 'vertical' : 'horizontal'
  let orientation = deriveOrientation()
  let reverseMain = orientation === 'vertical' && myEdge === 'left'

  const root = document.createElement('div')
  const strip = document.createElement('div')
  // On the LEFT edge the content reads bottom-to-top (flipped 180° so its bottom points inward), so the
  // main axis is REVERSED — start at the bottom, end at the top (the mirror of the right edge).
  const applyRootChrome = (): void => {
    root.className = 'au-bar' + (orientation === 'vertical' ? ' vertical' : '') + (reverseMain ? ' reverse-main' : '')
    strip.className = 'au-bar-frame' + (orientation === 'vertical' ? ' vertical' : '')
    if (myEdge) strip.dataset.edge = myEdge
    else delete strip.dataset.edge
  }
  applyRootChrome()

  // Re-derive orientation when the container's edge changes under a mounted bar, refresh the root chrome,
  // and re-render so regions/items re-propagate the new axis. A no-op when the edge is unchanged.
  const syncOrientation = (): void => {
    if (container.dataset.auEdge === myEdge) return
    myEdge = container.dataset.auEdge
    orientation = deriveOrientation()
    reverseMain = orientation === 'vertical' && myEdge === 'left'
    applyRootChrome()
    render()
  }
  // Component CSS scoped to this pane by the host (`@scope`-wrapped, CSP-exempt), never a raw `<style>`.
  // The overflow popover PORTALS to the host preview card (outside this subtree), so it copies the scope
  // marker onto its menu (see `openOverflowPopover`) — preserving scoped styles across the portal.
  const disposeStyles = host.styles?.inject(STYLE, container)
  strip.append(root)
  container.appendChild(strip)

  let alive = true
  // The shared preview surface is keyed; this bar's overflow popover gets its own key.
  const overflowKey = `bar-overflow:${++mountedBars}`
  // A render generation: a re-render (accept/pin) increments it, so a child mount or a measure
  // callback that fires for a STALE generation no-ops instead of touching the live DOM.
  let gen = 0
  let handles: ChildHandle[] = []
  // The live `end`-region slots for the current generation: each item's slot + its instance, so the
  // overflow measure can hide/show them. The `more` button + the set of overflowed indices are the
  // EPHEMERAL overflow result (recomputed on resize, never persisted).
  let endSlots: { slot: HTMLElement; item: BarItem; index: number }[] = []
  let endGroup: HTMLElement | null = null
  let moreBtn: HTMLButtonElement | null = null
  let overflowed: { item: BarItem; index: number }[] = []

  // Persist the bar's complete instance up the tree; the host stamps `type: bar` centrally.
  function persist(): void {
    const next: BarConfig = {}
    // Always emit each owned region — `[]` when empty, never omitted. Removing the last item from a
    // region (via the context menu) empties it; omitting the key then drops an OWNED field and trips
    // `config-own-field-dropped`, recording the removal as ambiguous absence. (Same class as dock.)
    for (const r of REGIONS) next[r] = config[r] ?? []
    // The bar emits only the regions it owns; the host derives ownership from the type graph and
    // carries every field the bar does not own.
    host.saveConfig?.(next as OpaqueConfig)
  }

  // Add an item of a candidate type to a region (default `end`), placed by its order hint, persist, re-render.
  function addItem(type: string, region: Region = 'end'): void {
    const item: BarItem = { type }
    config[region]!.splice(insertionIndex(config[region]!, item.order), 0, item)
    persist()
    render()
  }

  // ── member edits (the right-click context menu) — each is a bar-owned config write ──
  function removeMember(region: Region, index: number): void {
    const list = config[region]!
    if (index < 0 || index >= list.length) return
    list.splice(index, 1)
    persist()
    render()
  }
  function moveMemberToRegion(region: Region, index: number, target: Region): void {
    const list = config[region]!
    if (region === target || index < 0 || index >= list.length) return
    const [item] = list.splice(index, 1)
    config[target]!.push(item)
    persist()
    render()
  }
  function reorderMember(region: Region, index: number, dir: -1 | 1): void {
    const list = config[region]!
    const j = index + dir
    if (index < 0 || index >= list.length || j < 0 || j >= list.length) return
    ;[list[index], list[j]] = [list[j], list[index]]
    persist()
    render()
  }

  // Build menu rows locally and map them to host.contextMenu items at one seam.
  // The host owns placement, dismissal, and menu chrome.
  type MenuRow = { label: string; onClick?: () => void; head?: boolean; disabled?: boolean; sep?: boolean; id?: string }

  /** One bar row as a contract item. `head` is a section, `sep` a separator, the rest an action. */
  function toItem(row: MenuRow, i: number): ContextMenuItem {
    if (row.sep) return { separator: true }
    if (row.head) return { section: row.label }
    const enabled = !row.disabled && Boolean(row.onClick)
    return {
      // Ids are positional because a bar row IS positional (a member at an index, a candidate in a
      // discovered list). Stable within one opening, which is all anything reads them for today.
      id: row.id ?? `bar.row.${i}`,
      label: row.label,
      enabled,
      // Disabled rows include a reason so the unavailable action is understandable.
      reason: enabled ? undefined : 'unavailable here',
      run: () => row.onClick?.(),
    }
  }

  function openMenu(x: number, y: number, rows: MenuRow[]): void {
    // Dismiss our OWN overflow popover only — the preview surface is a shared singleton, so an
    // unconditional hide() would tear down another consumer's card.
    if (preview?.isShowing(overflowKey)) preview.hide()
    // The enclosing container's rows for this bar (a dock's move / remove / add), after the bar's own.
    const containerRows = host.containerActions?.() ?? []
    const items = [...rows.map(toItem), ...(containerRows.length ? [{ separator: true } as const, ...containerRows] : [])]
    host.contextMenu?.open({ x, y }, items)
  }

  // Candidate rows shared by both menus: the add-able item types, each adding to the given region.
  // A disabled row when none.
  function candidateRows(region: Region): MenuRow[] {
    const available = availableItems(config, itemCandidates())
    if (!available.length) return [{ label: 'No items to add', disabled: true }]
    return available.map((c) => ({ label: `+ ${c.label}`, onClick: () => addItem(c.type, region) }))
  }

  // Right-click ON a member: remove / move-region / reorder + add candidates (into this region).
  function openItemMenu(region: Region, index: number, x: number, y: number): void {
    const list = config[region]!
    const item = list[index]
    if (!item) return openBarMenu(x, y)
    const rows: MenuRow[] = [{ label: labelOf(item.type), head: true }]
    rows.push({ label: 'Remove', onClick: () => removeMember(region, index) })
    for (const target of REGIONS) {
      if (target !== region) rows.push({ label: `Move to ${target}`, onClick: () => moveMemberToRegion(region, index, target) })
    }
    rows.push({ label: '◂ Move earlier', onClick: () => reorderMember(region, index, -1), disabled: index === 0 })
    rows.push({ label: 'Move later ▸', onClick: () => reorderMember(region, index, 1), disabled: index === list.length - 1 })
    rows.push({ label: '', sep: true }, { label: 'Add', head: true }, ...candidateRows(region))
    openMenu(x, y, rows)
  }

  // Right-click on the BAR background: add items (into end).
  function openBarMenu(x: number, y: number): void {
    openMenu(x, y, [{ label: 'Bar', head: true }, { label: 'Add item', head: true }, ...candidateRows('end')])
  }

  // PIN an overflowed item: move it to the FRONT of `end` (highest priority = first-visible),
  // persist, re-render. The promoted item becomes the first visible item.
  function pinToFront(index: number): void {
    const end = config.end!
    if (index < 0 || index >= end.length) return
    const [item] = end.splice(index, 1)
    end.unshift(item)
    persist()
    render()
  }

  function mountChild(myGen: number, region: Region, index: number, slot: HTMLElement): Promise<void> {
    const child = config[region]![index]
    if (!child?.type) return Promise.resolve()
    // Which SURFACE the widget mounts is intrinsic to its TYPE (the locator's `export`), resolved by
    // the host — the bar names the item's type and mounts that, with the item record as its config.
    return host.children
      .mount(slot, {
        id: child.type,
        config: child as OpaqueConfig,
        onChildConfigChange: (next: OpaqueConfig) => {
          // The widget writes its own fields; the placement hints are the bar's to keep.
          const { order, minSize, overflowEligible } = config[region]![index]!
          config[region]![index] = { ...(next as BarItem), ...(order !== undefined && { order }), ...(minSize !== undefined && { minSize }), ...(overflowEligible !== undefined && { overflowEligible }) }
          persist()
        },
      })
      .then((h) => {
        if (!alive || myGen !== gen) h.unmount()
        else handles.push(h)
      })
      .catch((err) => {
        if (!alive || myGen !== gen) return
        const e = document.createElement('div')
        e.className = 'au-bar-error'
        e.textContent = err instanceof Error ? err.message : String(err)
        slot.appendChild(e)
      })
  }

  function render(): void {
    const myGen = ++gen
    for (const h of handles) h.unmount()
    handles = []
    endSlots = []
    endGroup = null
    moreBtn = null
    overflowed = []
    // Clear regions, spacer, and the empty-bar hint before rebuilding render output.
    root.querySelectorAll('.au-bar-region, .au-bar-spacer, .au-bar-hint').forEach((n) => n.remove())

    const mounts: Promise<void>[] = []
    // Build [start][spacer][center][spacer][end]; the two spacers center the center region
    // and push start/end to the edges, along whichever main axis the orientation sets.
    REGIONS.forEach((region, ri) => {
      if (ri > 0) {
        const spacer = document.createElement('div')
        spacer.className = 'au-bar-spacer'
        root.appendChild(spacer)
      }
      const group = document.createElement('div')
      group.className = 'au-bar-region'
      group.dataset.region = region
      const items = config[region] ?? []
      items.forEach((item, index) => {
        const slot = document.createElement('div')
        slot.className = 'au-bar-slot'
        // CONTAINER AXIS CONTEXT: tell the mounted content which axis this bar lays out along, so
        // it can adapt (rotate-to-align in a vertical bar, or fit either way). The slot IS the
        // child's `container`, so content reads `container.dataset.auAxis`.
        slot.dataset.auAxis = orientation
        // The item's `minSize` hint clamps it along the bar's main axis.
        if (item.minSize !== undefined) slot.style[orientation === 'vertical' ? 'minHeight' : 'minWidth'] = `${item.minSize}px`
        // propagate the bar's own edge (if any) so content picks a rotation direction (bottom-inward).
        if (myEdge) slot.dataset.auEdge = myEdge
        // Right-click a member → its context menu (remove / move-region / reorder / add). Stop
        // propagation so the bar-background handler doesn't also fire.
        slot.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          e.stopPropagation()
          openItemMenu(region, index, e.clientX, e.clientY)
        })
        group.appendChild(slot)
        mounts.push(mountChild(myGen, region, index, slot))
        if (region === 'end') endSlots.push({ slot, item, index })
      })
      if (region === 'end') endGroup = group
      root.appendChild(group)
    })

    // EMPTY-BAR HINT: candidates are surfaced via the right-click menu (not inline chips). When the
    // bar holds NO members, show a discoverable hint with the candidate count; left-click (or
    // right-click anywhere) opens the bar menu to populate it.
    const memberCount = REGIONS.reduce((n, r) => n + (config[r]?.length ?? 0), 0)
    if (memberCount === 0) {
      const available = availableItems(config, itemCandidates())
      const hint = document.createElement('div')
      hint.className = 'au-bar-hint'
      hint.textContent = '⋯'
      hint.title = `Right-click to populate (${available.length} available)`
      hint.addEventListener('click', (e) => openBarMenu(e.clientX, e.clientY))
      root.appendChild(hint)
    }

    // Measure overflow once the children have mounted + laid out (then the ResizeObserver
    // keeps it current on every bar-size change).
    void Promise.allSettled(mounts).then(() => {
      if (alive && myGen === gen) requestAnimationFrame(() => { if (alive && myGen === gen) measureOverflow() })
    })
  }

  // Does the bar's content exceed its box on the main axis? (a 1px slack avoids jitter)
  function overflowsMainAxis(): boolean {
    return orientation === 'vertical'
      ? root.scrollHeight > root.clientHeight + 1
      : root.scrollWidth > root.clientWidth + 1
  }

  // EPHEMERAL overflow result: show every end slot, then — while the bar overflows — hide the
  // lowest-priority eligible `end` items (bunching them into "+N more"). Recomputed on resize;
  // never persisted (the priority/pin order in `config.end` is the durable part).
  function measureOverflow(): void {
    if (!endGroup) return
    for (const e of endSlots) e.slot.hidden = false
    if (moreBtn) { moreBtn.remove(); moreBtn = null }
    overflowed = []

    if (!overflowsMainAxis()) return // everything fits

    // a "+N more" button will be needed; create it up front so its width counts in the fit check.
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'au-bar-more'
    endGroup.appendChild(btn)
    moreBtn = btn

    const order = overflowOrder(config.end ?? [])
    const slotByIndex = new Map(endSlots.map((e) => [e.index, e]))
    for (const idx of order) {
      if (!overflowsMainAxis()) break
      const e = slotByIndex.get(idx)
      if (!e) continue
      e.slot.hidden = true
      overflowed.push({ item: e.item, index: e.index })
    }

    if (overflowed.length === 0) {
      // nothing eligible to bunch (all visible items are non-eligible / pinned) — drop the button.
      btn.remove()
      moreBtn = null
      return
    }
    btn.textContent = `+${overflowed.length} more`
    btn.title = `${overflowed.length} hidden — click to show / pin`
    btn.addEventListener('click', () => openOverflowPopover(btn))
  }

  // The "+N more" popover: the host's ephemeral overlay (reuse the overlay site,
  // not a bespoke widget) listing the overflowed items; clicking one PINS it (first-visible).
  function openOverflowPopover(btn: HTMLButtonElement): void {
    if (!preview) return
    if (preview.isShowing(overflowKey)) { preview.hide(); return } // toggle
    const snapshot = [...overflowed]
    preview.show(overflowKey, btn.getBoundingClientRect(), (card) => {
      const menu = document.createElement('div')
      menu.className = 'au-bar-ov-menu'
      // Scoped rules match the menu beneath a dedicated scope ancestor.
      const scopeRoot = document.createElement('div')
      const scope = container.getAttribute('data-au-scope')
      if (scope) scopeRoot.setAttribute('data-au-scope', scope)
      scopeRoot.append(menu)
      for (const ov of snapshot) {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'au-bar-ov-item'
        const name = document.createElement('span')
        name.textContent = labelOf(ov.item.type)
        const pin = document.createElement('span')
        pin.className = 'au-bar-ov-pin'
        pin.textContent = 'pin'
        row.append(name, pin)
        row.title = `Pin ${labelOf(ov.item.type)} to front (first-visible)`
        row.addEventListener('click', () => { preview.hide(); pinToFront(ov.index) })
        menu.appendChild(row)
      }
      card.replaceChildren(scopeRoot)
    })
  }

  // Right-click the bar BACKGROUND (not a member) → the bar menu (add candidates; move-edge).
  // Member slots stopPropagation, so this only fires off-member.
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    openBarMenu(e.clientX, e.clientY)
  })

  // Re-measure without remounting when the viewport or inherited theme metrics change.
  let measureFrame = 0
  const scheduleMeasure = (): void => {
    if (!alive || measureFrame) return
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0
      if (alive) measureOverflow()
    })
  }
  const ro = new ResizeObserver(scheduleMeasure)
  ro.observe(root)
  const themeObserver = new MutationObserver(scheduleMeasure)
  for (let node: HTMLElement | null = container; node;) {
    themeObserver.observe(node, { attributes: true, attributeFilter: ['style', 'class'] })
    const tree = node.getRootNode()
    node = node.parentElement ?? (tree instanceof ShadowRoot ? tree.host as HTMLElement : null)
  }

  render()

  // React to the edge CHANGING under a mounted bar: a move to another edge re-anchors the portal host,
  // the coordinator relays the new `data-au-edge` onto it, and the mount site mirrors it onto this
  // `container`; the bar is never re-mounted. So observe the attribute and re-orient.
  const edgeObserver = new MutationObserver(syncOrientation)
  edgeObserver.observe(container, { attributes: true, attributeFilter: ['data-au-edge'] })

  // Re-render when discovery changes, so an item type discovered AFTER this bar mounted shows up in
  // its add-menu / hint count (the candidate query is live, not a mount-time snapshot).
  const offContrib = host.subscribeContributions(() => { if (alive) render() })

  return () => {
    alive = false
    ro.disconnect()
    themeObserver.disconnect()
    if (measureFrame) cancelAnimationFrame(measureFrame)
    edgeObserver.disconnect()
    offContrib()
    for (const h of handles) h.unmount()
    disposeStyles?.()
    container.replaceChildren()
  }
}

/** The bar's mount export (the default `mount`). */
// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
