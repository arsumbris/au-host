// Bar container: lays out child projections in start, centre, and end regions.
// Discovers contribution candidates for its role and persists accepted choices.
// Only the end region supports overflow: lower-priority eligible items move into
// a shared preview popover. Pinning an item makes it first visible. Start and
// centre regions do not provide an overflow popover.

import { defineProjection, type ProjectionModule, type ContextMenuItem, type MenuHandle, type MountHost, type ChildHandle, type OpaqueConfig } from '@arsumbris/au-host-sdk'
import type { Bar } from './generated'

type Instance = { type: string } & Record<string, unknown>
/** One placed bar item: bar's OWN `bar-item` type. `view` is the widget (a projection instance the
 *  runtime treats opaquely); `overflowEligible: false` pins it visible. The widget lives in `view`, not
 *  at the top level, so the slot walker skips a bar by type — see `bar-item.type.yaml`. */
type BarItem = { view: Instance; overflowEligible?: boolean }
/** Scalars come from the generated `Bar` config. The three regions use `BarItem[]`
 * because the runtime treats widgets as opaque `{ type }` records. The owned field
 * set is checked against the generated shape so schema changes fail at compile time. */
interface BarConfig extends Omit<Bar, 'type' | 'start' | 'center' | 'end'> {
  start?: BarItem[]
  center?: BarItem[]
  end?: BarItem[]
}
type Region = 'start' | 'center' | 'end'
const REGIONS: Region[] = ['start', 'center', 'end']
// The host derives config ownership from the type graph and preserves unowned fields
// at saveConfig. This projection emits only the fields it understands.
interface ChromeContribution {
  /** The candidate projection's TYPE NAME — what the bar mounts on accept. It IS a subtype of
   *  the bar's role KIND (the role is the kind; discovery returns kind members). */
  projection: string
  /** The role KIND this targets (matches the bar's resolved `role`). */
  role: string
  /** Default ordering hint within the role (first-come-first-served when unset). */
  order?: number
}
interface PreviewSurfaceLike {
  show(key: string, rect: DOMRect, fill: (card: HTMLElement, isCurrent: () => boolean) => void): void
  hide(): void
  isShowing(key: string): boolean
}
// A `reposition` intent the bar FIRES (firer-relative) for its parent dock to handle — "move me to
// edge X". The dock declares the capability; the host routes by ancestry. The capability is read through the local host shape.
type Edge = 'top' | 'bottom' | 'left' | 'right'
const EDGES: Edge[] = ['top', 'bottom', 'left', 'right']
type HostX = MountHost & {
  listContributions?: (role: string) => ChromeContribution[]
  subscribeContributions?: (listener: () => void) => () => void
  preview?: PreviewSurfaceLike
  intent?: { fire(intent: { type: string; edge?: Edge }): void }
}

const STYLE = `
.au-bar-frame { display:flex; box-sizing:border-box; padding:var(--au-space-2); min-width:0; min-height:0; width:100%; height:100%; }
.au-bar-frame > au-pane-frame { flex:1; min-width:0; min-height:0; }

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
 * The contributions targeting the bar's role whose projection is NOT already an accepted child
 * in any region — the AVAILABLE-TO-ADD set. Deduped by projection, ordered by `order` (then
 * first-come). Pure, so it is unit-testable without a DOM.
 */
export function availableContributions(
  config: Pick<BarConfig, 'start' | 'center' | 'end'>,
  candidates: ChromeContribution[],
): ChromeContribution[] {
  const accepted = new Set<string>()
  // Strip `::repo`: a placed member's `c.type` is a qualified config claim (`status-bar::au-host-sdk`),
  // but `cand.projection` is the BARE discovered typeName — dedup on bare, else a placed contribution is
  // wrongly re-offered as available-to-add.
  for (const r of REGIONS) for (const c of config[r] ?? []) if (c?.view?.type) accepted.add(c.view.type.split('::')[0])
  const seen = new Set<string>()
  const out: ChromeContribution[] = []
  for (const cand of candidates) {
    if (accepted.has(cand.projection) || seen.has(cand.projection)) continue
    seen.add(cand.projection)
    out.push(cand)
  }
  out.sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))
  return out
}

/**
 * The `end`-region item indices eligible to overflow, in BUNCHING order (lowest priority first =
 * last in list order). Policy: bunch by DEFAULT; an item is pinned-visible (never bunches) ONLY if
 * its matching contribution declares `overflowEligible: false`. So a cramped bar collapses its
 * trailing items naturally, and a contribution opts a critical item OUT explicitly. Pure /
 * unit-testable; the DOM measurement loop hides these in order until the bar fits.
 */
export function overflowOrder(end: BarItem[]): number[] {
  // `overflowEligible` is bar's own `bar-item` field (the item's placement policy, off the widget) —
  // `overflowEligible: false` pins an item visible (never bunches).
  const order: number[] = []
  for (let i = end.length - 1; i >= 0; i--) if (end[i]?.view?.type && end[i].overflowEligible !== false) order.push(i)
  return order
}

/** Resolve the bar's `role` def-ref (a wikilink `[[status-projection]]`) to the role KIND type name
 *  the contributions query keys on. Strips the wikilink brackets + any `|display` / `#anchor`.
 *  Undefined when no role is set (a pure explicit-config bar). */
function roleName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined
  // Strip the `[[ ]]`, any `|display` / `#anchor`, AND the `::repo` qualifier — a
  // role def-ref can be qualified (`[[status-projection::au-host-sdk]]`), but the contributions query keys
  // on the BARE kind name (`d.kinds` carry bare names). Without the `::repo` strip a bar aggregates nothing.
  const name = ref.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0].split('::')[0].trim()
  return name || undefined
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const config: BarConfig = { ...((host.config as BarConfig | undefined) ?? {}) }
  // normalize the region arrays so we can mutate + round-trip them.
  for (const r of REGIONS) config[r] = [...(config[r] ?? [])]

  const hostx = host as HostX
  const listContributions = hostx.listContributions
  const subscribeContributions = hostx.subscribeContributions
  const preview = hostx.preview
  // The role this bar aggregates: config.role is a def-ref wikilink; resolve to the role KIND name
  // (e.g. `status-projection`) that `listContributions` keys on. Undefined = no aggregation.
  const role = roleName(config.role)
  // CONTAINER AXIS CONTEXT: the bar's OWN edge, if a dock mounted it on one (set on the bar's container
  // slot, relayed onto the portal host by the coordinator). A DOCKED bar's orientation is a CONSEQUENCE
  // of its edge, never its own config: left/right are vertical, top/bottom horizontal. Derived on READ
  // from the edge — so the dock never writes `orientation` into this instance. Falls back to the
  // AUTHORED `orientation` off a dock edge (the only case where the author's value is meaningful).


  // REACTIVE: the edge can CHANGE while the bar is mounted — a reposition moves it to another edge, and
  // the portal is never re-mounted, only re-anchored (the coordinator relays the new `data-au-edge` onto
  // the container). So the bar OBSERVES its container's edge and re-derives, rather than reading it once
  // at mount. `let`, not `const`, for exactly that.
  let myEdge = container.dataset.auEdge
  const deriveOrientation = (): 'horizontal' | 'vertical' | undefined =>
    myEdge ? (myEdge === 'left' || myEdge === 'right' ? 'vertical' : 'horizontal') : config.orientation
  let orientation = deriveOrientation()
  let reverseMain = orientation === 'vertical' && myEdge === 'left'

  const root = document.createElement('div')
  // On the LEFT edge the content reads bottom-to-top (flipped 180° so its bottom points inward), so the
  // main axis is REVERSED — start at the bottom, end at the top (the mirror of the right edge).
  const applyRootChrome = (): void => {
    root.className = 'au-bar' + (orientation === 'vertical' ? ' vertical' : '') + (reverseMain ? ' reverse-main' : '')
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
  const frame = document.createElement('au-pane-frame')
  frame.setAttribute('flush', '')
  const inset = document.createElement('div')
  inset.className = 'au-bar-frame'
  frame.append(root)
  inset.append(frame)
  container.appendChild(inset)

  let alive = true
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
    if (config.orientation) next.orientation = config.orientation
    if (config.role) next.role = config.role
    // Always emit each owned region — `[]` when empty, never omitted. Removing the last item from a
    // region (via the context menu) empties it; omitting the key then drops an OWNED field and trips
    // `config-own-field-dropped`, recording the removal as ambiguous absence. (Same class as dock.)
    for (const r of REGIONS) next[r] = config[r] ?? []
    // Re-emit the composition-authored locks verbatim. OWNED (base-declared, so in our effective
    // shape), and `next` is rebuilt from five keys, so without this they are dropped.
    // `next` is rebuilt from the bar's own keys, so anything else the instance carried
    // (`intent-defaults` / `initial-focus` were this bar a root) would be destroyed by a member
    // edit. Re-emit what the bar does not own.
    host.saveConfig?.(next as OpaqueConfig)
  }

  // Accept a candidate: append its instance to a region (default `end`), persist, re-render.
  function accept(projection: string, region: Region = 'end'): void {
    config[region]!.push({ view: { type: projection } })
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
  // Retain the handle so disposal closes only this projection's menu.
  let menu: MenuHandle | null = null
  function closeMenu(): void {
    menu?.close()
    menu = null
  }

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
    if (preview?.isShowing('bar-overflow:' + (role ?? ''))) preview.hide()
    menu = host.contextMenu?.open({ x, y }, rows.map(toItem)) ?? null
  }

  // Candidate rows shared by both menus: the surfaced available-to-add contributions, each adding
  // to the given region. Empty (disabled) row when none.
  function candidateRows(region: Region): MenuRow[] {
    const available = role && listContributions ? availableContributions(config, listContributions(role)) : []
    if (!available.length) return [{ label: 'No contributions to add', disabled: true }]
    return available.map((c) => ({ label: `+ ${c.projection}`, onClick: () => accept(c.projection, region) }))
  }

  // "Move bar to edge" rows — fire a firer-relative `reposition` intent the parent dock handles.
  // Present only when an intent channel exists (i.e. the bar is inside something that can route it).
  function moveBarRows(): MenuRow[] {
    if (!hostx.intent) return []
    return [
      { label: '', sep: true },
      { label: 'Move bar to edge', head: true },
      ...EDGES.map((edge) => ({ label: `▸ ${edge}`, onClick: () => hostx.intent!.fire({ type: 'reposition', edge }) })),
    ]
  }

  // Right-click ON a member: remove / move-region / reorder + add candidates (into this region).
  function openItemMenu(region: Region, index: number, x: number, y: number): void {
    const list = config[region]!
    const item = list[index]
    if (!item) return openBarMenu(x, y)
    const rows: MenuRow[] = [{ label: item.view.type, head: true }]
    rows.push({ label: 'Remove', onClick: () => removeMember(region, index) })
    for (const target of REGIONS) {
      if (target !== region) rows.push({ label: `Move to ${target}`, onClick: () => moveMemberToRegion(region, index, target) })
    }
    rows.push({ label: '◂ Move earlier', onClick: () => reorderMember(region, index, -1), disabled: index === 0 })
    rows.push({ label: 'Move later ▸', onClick: () => reorderMember(region, index, 1), disabled: index === list.length - 1 })
    rows.push({ label: '', sep: true }, { label: 'Add', head: true }, ...candidateRows(region))
    rows.push(...moveBarRows())
    openMenu(x, y, rows)
  }

  // Right-click on the BAR background: add candidates (into end) + move the bar to a dock edge.
  function openBarMenu(x: number, y: number): void {
    const rows: MenuRow[] = [{ label: role ? `${role.split('.').pop()} bar` : 'bar', head: true }, ...candidateRows('end')]
    rows.push(...moveBarRows())
    openMenu(x, y, rows)
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
    if (!child?.view?.type) return Promise.resolve()
    // Which SURFACE the widget mounts is intrinsic to its TYPE (the locator's `export`), resolved by
    // the host — the bar names the widget type off `bar-item.view` and mounts that.
    return host.children
      .mount(slot, {
        id: child.view.type,
        config: child.view as OpaqueConfig,
        onChildConfigChange: (next: OpaqueConfig) => {
          config[region]![index] = { ...config[region]![index], view: next as Instance }
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
        slot.dataset.auAxis = orientation === 'vertical' ? 'vertical' : 'horizontal'
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
      const available = role && listContributions ? availableContributions(config, listContributions(role)) : []
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
    const key = `bar-overflow:${role ?? ''}`
    if (preview.isShowing(key)) { preview.hide(); return } // toggle
    const snapshot = [...overflowed]
    preview.show(key, btn.getBoundingClientRect(), (card) => {
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
        name.textContent = ov.item.view.type
        const pin = document.createElement('span')
        pin.className = 'au-bar-ov-pin'
        pin.textContent = 'pin'
        row.append(name, pin)
        row.title = `Pin ${ov.item.view.type} to front (first-visible)`
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

  // React to the edge CHANGING under a mounted bar: a reposition re-anchors the portal host and the
  // coordinator relays the new `data-au-edge` onto the container, but the bar is never re-mounted. So
  // observe the attribute the portal writes and re-orient. `container` is the STABLE portal host, so
  // this one observer survives every re-anchor.
  const edgeObserver = new MutationObserver(syncOrientation)
  edgeObserver.observe(container, { attributes: true, attributeFilter: ['data-au-edge'] })

  // Re-render when discovery changes, so a contribution discovered AFTER this bar mounted shows up
  // in its add-menu / hint count (listContributions is live, not a mount-time snapshot). Only a
  // role-aggregating bar cares; a pure explicit-config bar has nothing to re-query.
  const offContrib = role ? subscribeContributions?.(() => { if (alive) render() }) : undefined

  return () => {
    alive = false
    ro.disconnect()
    themeObserver.disconnect()
    if (measureFrame) cancelAnimationFrame(measureFrame)
    edgeObserver.disconnect()
    offContrib?.()
    closeMenu()
    // Only dismiss the shared preview surface if OUR overflow popover is the one showing.
    if (preview?.isShowing('bar-overflow:' + (role ?? ''))) preview.hide()
    for (const h of handles) h.unmount()
    disposeStyles?.()
    container.replaceChildren()
  }
}

/** The bar's mount export (the default `mount`). */
// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
