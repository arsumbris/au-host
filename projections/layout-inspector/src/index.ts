/** Inspect the composition through the same slot API used to enforce placement rules.
 * `containerRoots` enumerates containers; `registry.get(root)` retrieves their
 * ContainerPlacement; `slotFor(id)` returns the governing slot and its rules.
 * Third-party containers participate through this shared contract.
 *
 * The panel mounts as projection content. An overlay layer draws frames across
 * projection roots, and a separate tooltip-band layer displays details above them.
 * The host owns both layer frames, stacking, and teardown; this projection supplies
 * their content. The collection and rendering use DOM APIs without React. */

import {
  DATA_ATTR,
  bareTypeName,
  containerRoots,
  readIntentCensus,
  refToTypeName,
  registry,
} from '@arsumbris/container-core'
import type { IntentCensus } from '@arsumbris/container-core'
import { defineProjection, reportHostDiagnostic } from '@arsumbris/au-host-sdk'
import type { ContainerPlacement, MountHost, ProjectionModule } from '@arsumbris/au-host-sdk'
import { stringify } from 'yaml'

/** The inspector can show declared capability or live activity. Capability reads
 * firers and handlers from the type graph without requiring runtime activity.
 * Live mode shows the last firer per intent and currently mounted handlers. */
type CensusMode = 'capability' | 'live'

interface CensusView {
  types: string[]
  firers: (t: string) => readonly string[]
  handlers: (t: string) => readonly string[]
}

function viewOf(census: IntentCensus, mode: CensusMode): CensusView {
  if (mode === 'capability') {
    const types = [...new Set([...census.declaredFirers.keys(), ...census.declaredHandlers.keys()])].sort()
    return {
      types,
      firers: (t) => census.declaredFirers.get(t) ?? [],
      handlers: (t) => census.declaredHandlers.get(t) ?? [],
    }
  }
  const types = [...new Set([...census.lastFire.keys(), ...census.sinks.keys()])].sort()
  return {
    types,
    firers: (t) => {
      const f = census.lastFire.get(t)
      return f ? [f] : []
    },
    handlers: (t) => census.sinks.get(t) ?? [],
  }
}


interface Node {
  key: string
  el: Element
  role: 'container' | 'position'
  depth: number
  parent?: string
  /** Containers only: the kind tag it declared. */
  kind?: string
  /** Positions only. */
  slotId?: string
  shape?: string
  fixed?: boolean
  admits?: string[]
  /** Positions only: does the owning container answer `slotFor` at all? */
  governed?: boolean
}

/** Read the kind off a registered root — on the root itself, else the nearest ancestor carrying it. */
function kindOf(root: Element): string {
  return (
    root.getAttribute(DATA_ATTR.containerKind) ??
    root.closest(`[${DATA_ATTR.containerKind}]`)?.getAttribute(DATA_ATTR.containerKind) ??
    '?'
  )
}

/**
 * Snapshot the composition. Framework-free by construction: everything here is the shared substrate
 * plus the DOM, and nothing in it knows what draws the result.
 *
 * PARENTAGE IS DOM CONTAINMENT over the union of containers and positions, and that is the only
 * account true rather than declared. A container renders its positions inside itself and a nested
 * container renders inside the position holding it, so the nearest enclosing node yields the real
 * alternating chain: `bento → position right-column → tabs → position notes`.
 */
function collect(): Node[] {
  const roots = [...containerRoots]
  const byEl = new Map<Element, Node>()

  roots.forEach((root, i) => {
    let depth = 0
    for (const other of roots) if (other !== root && other.contains(root)) depth++
    byEl.set(root, { key: `c${i}`, el: root, role: 'container', depth, kind: kindOf(root) })
  })

  document.querySelectorAll(`[${DATA_ATTR.droptargetShape}]`).forEach((el, i) => {
    const slotId = el.getAttribute(DATA_ATTR.droptargetId) ?? ''
    const shape = el.getAttribute(DATA_ATTR.droptargetShape) ?? '?'

    // ASK THE OWNING CONTAINER — the identical question enforcement asks at every seam.
    let governed = false
    let fixed = false
    let admits: string[] = []
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      const placement = registry.get(cur)
      if (!placement) continue
      if (typeof placement.slotFor !== 'function') break // a container with no slots to govern
      governed = true
      const slot = slotId ? placement.slotFor(slotId) : null
      if (slot) {
        fixed = slot.fixed === true
        // `admits` holds def-ref links (`[[editor-pane::editor]]`); show the bare names.
        admits = (slot.admits ?? []).map((r) => refToTypeName(r) ?? bareTypeName(r) ?? r)
      }
      break
    }

    byEl.set(el, { key: `p${i}`, el, role: 'position', depth: 0, slotId, shape, fixed, admits, governed })
  })

  // A container's own KIND lives on its SLOT elements (`data-container-kind`), NOT on its registered
  // root — so `kindOf(root)` (self + ancestors only) reads nothing, or a PARENT container's kind. Each
  // position carries the attr, and `ownerOf` resolves it to its container, so a position tells its
  // container what it is. Authoritative, so it overrides the fallback. Without this, container nodes are
  // mis-kinded and the intent viz never frames a container HANDLER (bento / tabs / dock).
  for (const [el, node] of byEl) {
    if (node.role !== 'position') continue
    const k = el.getAttribute(DATA_ATTR.containerKind)
    if (!k) continue
    const owner = ownerOf(el, false)
    const ownerNode = owner ? byEl.get(owner.el) : undefined
    if (ownerNode?.role === 'container') ownerNode.kind = k
  }

  // Parentage + a position's depth, settled once every node exists. A position takes its OWNING
  // container's depth so it reads at the level it actually sits on.
  const out: Node[] = []
  for (const [el, node] of byEl) {
    let parent: string | undefined
    let depth = node.depth
    for (let cur = el.parentElement; cur; cur = cur.parentElement) {
      const anc = byEl.get(cur)
      if (!anc) continue
      if (parent === undefined) parent = anc.key
      if (node.role === 'container') break
      if (anc.role === 'container') {
        depth = anc.depth
        break
      }
    }
    out.push({ ...node, depth, ...(parent === undefined ? {} : { parent }) })
  }
  return out
}

/** The label a node carries in both views. */
function labelOf(n: Node): string {
  if (n.role === 'container') return n.kind ?? '?'
  const rules = [n.fixed ? 'fixed' : '', (n.admits?.length ?? 0) > 0 ? `admits ${n.admits!.join(', ')}` : '']
    .filter(Boolean)
    .join(' · ')
  return `${n.slotId || n.shape}${rules ? ` — ${rules}` : ''}${n.governed === false ? ' — ungoverned' : ''}`
}

const isRuled = (n: Node): boolean => n.role === 'position' && (n.fixed === true || (n.admits?.length ?? 0) > 0)


/**
 * The record inside `value` whose engine `^:` id is `id`, or null.
 *
 * THE `^:` ID IS THE CORRESPONDENCE, and that is what makes this exact rather than heuristic. A
 * node's id addresses its record in the composition file — it is literally what `[[file^^id]]`
 * resolves — so locating a live node's config subtree is a lookup, not a guess.
 */
function findById(value: unknown, id: string): unknown {
  if (value == null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findById(v, id)
      if (hit) return hit
    }
    return null
  }
  const rec = value as Record<string, unknown>
  if (rec['^'] === id) return rec
  for (const k of Object.keys(rec)) {
    const hit = findById(rec[k], id)
    if (hit) return hit
  }
  return null
}

/** The nearest registered container at or above `el`, skipping `el` itself when asked. */
function ownerOf(el: Element, skipSelf: boolean): { el: Element; placement: ContainerPlacement } | null {
  for (let cur: Element | null = skipSelf ? el.parentElement : el; cur; cur = cur.parentElement) {
    const placement = registry.get(cur)
    if (placement) return { el: cur, placement }
  }
  return null
}

/**
 * `stringify`, but a debug tool must never take down the pane it is inspecting. A live model is
 * plain data in practice (it came from YAML), so this should not fire — which is exactly why it is
 * worth having: the case that "cannot happen" is the one that would crash a projection mid-hover.
 */
function safeYaml(value: unknown): string {
  try {
    return stringify(value)
  } catch (err) {
    return `# could not serialize this node\n# ${String(err)}`
  }
}

interface ConfigView {
  yaml: string
  /** How complete this is, stated rather than implied. */
  note: string
}

/**
 * The config subtree for a node, resolved through the seam.
 *
 * TWO SOURCES, PREFERRED IN ORDER, because the enforcement seam is DELIBERATELY LOSSY.
 * `slotFor` -> `toSeamSlot` passes only `admits` and `fixed`: the substrate has no use for a
 * container's `size` / `collapsed` / `label` / carried fields, which is right for enforcement and
 * useless for inspection. So a config view built on `slotFor` structurally cannot be complete.
 *
 *  1. THE OWNING CONTAINER'S OWN INSTANCE, obtained from ITS parent, then located by `^:` id. That
 *     instance contains the container's full slot records, so this is LOSSLESS — and it needs no
 *     debug-only method on the contract, which is exactly the shape this tool refuses elsewhere.
 *  2. Failing that (the ROOT container has no parent to ask), the occupant instance alone, which is
 *     complete for the child but omits whatever the position says about it. Marked as partial.
 */
function configFor(n: Node): ConfigView {
  const owner = ownerOf(n.el, n.role === 'container')
  const id = n.role === 'position' ? (n.slotId ?? '') : undefined

  // 1. the lossless path — the owning container's own instance, located by id.
  if (owner) {
    const grand = ownerOf(owner.el, true)
    const ownInstance = grand?.placement.getSlotContent(
      // The container sits in SOME position of its grandparent; find the one holding it.
      findSlotIdHolding(grand.placement, owner.el) ?? '',
    )?.instance
    if (ownInstance != null && id) {
      const rec = findById(ownInstance, id)
      if (rec) return { yaml: safeYaml(rec), note: 'live model · full record, position rules included' }
    }
    if (ownInstance != null && n.role === 'container') {
      return { yaml: safeYaml(ownInstance), note: 'live model · full instance' }
    }
  }

  // 2. the partial path — the occupant alone.
  if (owner && id) {
    const occ = owner.placement.getSlotContent(id)
    if (occ) {
      return {
        yaml: safeYaml(occ.instance),
        note: "live model · OCCUPANT ONLY — this position's own record is not reachable (its container is the root, so there is nothing above it to ask)",
      }
    }
    return { yaml: '# empty position', note: 'live model · nothing occupies this position' }
  }
  return { yaml: '# not reachable through the placement seam', note: 'the root container has no parent to ask for its own instance' }
}

/** Which of `placement`'s positions currently holds `child`? Matched by containment. */
function findSlotIdHolding(placement: ContainerPlacement, child: Element): string | null {
  for (const el of document.querySelectorAll(`[${DATA_ATTR.droptargetId}]`)) {
    if (!el.contains(child) || el === child) continue
    if (ownerOf(el, false)?.placement !== placement) continue
    const id = el.getAttribute(DATA_ATTR.droptargetId)
    if (id && placement.getSlotContent(id)) return id
  }
  return null
}

const PANEL_CSS = `
.au-li { box-sizing: border-box; height: 100%; min-width: 0; min-height: 0; overflow: auto; scrollbar-gutter: stable; font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono);
  color: var(--au-ink-1); background: transparent; padding: var(--au-space-4); }
.au-li-head { display: flex; align-items: center; gap: var(--au-space-2); margin-bottom: var(--au-space-2); flex-wrap: wrap; }
.au-li-count { color: var(--au-ink-3); }
.au-li-row { display: flex; align-items: center; gap: var(--au-space-1-5); padding: var(--au-space-1) 0; white-space: normal; overflow-wrap: anywhere; min-width: 0; }
.au-li-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
.au-li-dot.pos { width: 6px; height: 6px; }
.au-li-kind { font-weight: var(--au-w-strong); }
.au-li-rule { color: var(--au-ink-2); }
.au-li-empty { color: var(--au-ink-4); padding: var(--au-space-3) 0; }
.au-li-row:hover { background: var(--au-chrome-hover); border-radius: var(--au-radius-sm); cursor: default; }
/* The INTENT CENSUS — who fires and who handles each intent type. Read from the host-installed census
   (window-global); the responder chain's ORDER is deliberately NOT shown — this is the candidate set. */
.au-li-icontrols { display: flex; gap: var(--au-space-1); flex-wrap: wrap; margin: var(--au-space-0-5) 0 var(--au-space-1-5); }
.au-li-intents { margin-top: var(--au-space-3); border-top: 1px solid var(--au-line-2); padding-top: var(--au-space-2); }
.au-li-subhead { font-weight: var(--au-w-strong); color: var(--au-ink-2); margin-bottom: var(--au-space-1-5); }
.au-li-irow { display: block; width: 100%; border: 0; background: transparent; color: inherit; font: inherit; text-align: start; overflow-wrap: anywhere; padding: var(--au-space-0-5) var(--au-space-1); white-space: normal; cursor: pointer; border-radius: var(--au-radius-sm); }
.au-li-irow:hover { background: var(--au-chrome-hover); }
.au-li-ipin { background: var(--au-selection-bg); color: var(--au-selection-fg); box-shadow: inset 2px 0 0 var(--au-color-accent); }
.au-li-iname { font-weight: var(--au-w-strong); color: var(--au-color-accent); }
.au-li-imeta { color: var(--au-ink-3); font-family: var(--au-font-sans); }
.au-li-ifields { display: grid; gap: var(--au-space-1); margin-top: var(--au-space-1); }
.au-li-ifield { display: grid; grid-template-columns: 6em minmax(0, 1fr); gap: var(--au-space-2); }
.au-li-irow + .au-li-irow { margin-top: var(--au-space-2); }
.au-li-row:focus-visible, .au-li-irow:focus-visible { outline: 2px solid var(--au-focus-outer); outline-offset: -2px; }
.au-li-idash { color: var(--au-ink-4); }
/* The tooltip occupies its own tooltip-band layer. It ignores pointer events
   so it cannot intercept clicks intended for the content it describes. */
.au-li-tip { position: fixed; max-width: min(460px, calc(100vw - 32px)); max-height: 60vh; overflow: auto;
  font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono);
  padding: var(--au-space-2) var(--au-space-3); pointer-events: none;
  white-space: pre-wrap; overflow-wrap: anywhere; }
.au-li-tip-head { color: var(--au-ink-3); margin-bottom: var(--au-space-1); white-space: normal; }
.au-li-tip-note { color: var(--au-color-warn); margin-bottom: var(--au-space-1-5); white-space: normal; }
`

/**
 * Mount the inspector as an indented tree. Containers and their full-size positions can have
 * coincident rectangles; indentation keeps their separate places in the hierarchy readable.
 */
function mount(container: HTMLElement, host: MountHost): () => void {
  // Component CSS scoped to this pane by the host (`@scope`-wrapped, CSP-exempt), never a raw `<style>`.
  // The tooltip PORTALS to a host overlay layer (outside this subtree), so it copies the scope marker
  // onto itself (see `tip` below) — preserving scoped styles across the portal.
  const disposeStyles = host.styles?.inject(PANEL_CSS, container)

  const root = document.createElement('div')
  root.className = 'au-li'
  container.appendChild(root)

  // Claim a non-capturing host overlay layer for cross-pane frames. The host owns
  // its stacking and teardown. Without that capability, the panel remains usable
  // and the in-place overlay is unavailable.
  const layer = host.overlay?.claim({ level: 'overlay' })
  if (!layer) {
    reportHostDiagnostic({
      code: 'overlay-site-unavailable',
      severity: 'warning',
      subject: 'layout-inspector',
      message: 'this host offers no overlay site, so the in-place frame overlay is unavailable; the panel still works',
    })
  }
  // OUR element, inside the host's layer — never the host's element itself. The layer is the FRAME
  // and toggling its `display` or restyling it would be reaching into the host's half of the seam.
  // It also keeps every draw site below unchanged and null-free: with no layer this element is
  // simply never attached, so the frames are computed into a detached node and nothing renders.
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none'
  layer?.el.appendChild(overlay)

  // The tooltip uses its own host overlay layer in the tooltip band, above the
  // frame layer. This also lets it escape the scrolling panel's clipping boundary.
  const tipLayer = host.overlay?.claim({ level: 'tooltip' })
  const tip = document.createElement('au-hovercard')
  tip.setAttribute('role', 'tooltip')
  tip.className = 'au-li-tip'
  tip.style.display = 'none'
  // The overlay layer is the scope ancestor of the tooltip and its content.
  const tipScope = container.getAttribute('data-au-scope')
  if (tipScope && tipLayer) tipLayer.el.setAttribute('data-au-scope', tipScope)
  tipLayer?.el.appendChild(tip)

  const showTip = (n: Node, row: HTMLElement): void => {
    const view = configFor(n)
    tip.textContent = ''
    const head = document.createElement('div')
    head.className = 'au-li-tip-head'
    head.textContent = labelOf(n)
    const note = document.createElement('div')
    note.className = 'au-li-tip-note'
    // ALWAYS STATED, never inferred from which view you got. A debugging instrument whose default
    // meaning shifts with state is the one property it cannot afford — and if you are chasing a
    // SERIALIZATION defect, this view is showing you the bug's output, which is the point.
    note.textContent = view.note
    const body = document.createElement('div')
    body.textContent = view.yaml
    tip.append(head, note, body)

    tip.style.display = 'block'
    const r = row.getBoundingClientRect()
    const t = tip.getBoundingClientRect()
    tip.style.left = `${Math.min(r.right + 8, window.innerWidth - t.width - 8)}px`
    tip.style.top = `${Math.min(r.top, window.innerHeight - t.height - 8)}px`
  }
  const hideTip = (): void => {
    tip.style.display = 'none'
  }

  // TWO INDEPENDENT IN-PLACE LAYERS. `boxes` frames every node where it sits; `links` draws the
  // nesting tree as dots joined to their parents. They answer different questions — "what governs
  // this rect" and "what is inside what" — so they toggle separately rather than as one switch.
  let boxes = false
  let links = false
  /** The panel row under the cursor, mirrored into the in-place layers. */
  let hovered: string | null = null
  /** The intent TYPE whose census row is hovered (transient preview) — draws fire→handle over the app. */
  let hoveredIntent: string | null = null
  /** A PINNED intent (click a census row), so the viz persists without holding the hover. */
  let pinnedIntent: string | null = null
  /** The two intent-overlay toggles (default on): the highlight FRAMES and the connecting ARROWS. */
  let intentFrames = true
  let intentArrows = true
  /** The intent the viz draws: a pin wins over a hover. */
  const activeIntent = (): string | null => pinnedIntent ?? hoveredIntent
  /** The census MODE. CAPABILITY (default) draws the DECLARED graph — who CAN fire/handle, from the
   *  type graph, populated on mount. LIVE draws the runtime reality (last fire + mounted handlers).
   *  Default CAPABILITY because LIVE is empty until something fires. */
  let censusMode: CensusMode = 'capability'
  let raf = 0
  // Rebuild the panel only when its structure changes. Keeping row and button DOM stable between
  // changes preserves hover targets and open tooltips.
  let lastSig = ''

  /** The in-place overlay shows when ANY layer wants it: the boxes/tree-lines toggles, or an active
   *  intent viz (a pinned or hovered census row). */
  const syncOverlay = (): void => {
    overlay.style.display = boxes || links || activeIntent() !== null ? 'block' : 'none'
  }

  const draw = (): void => {
    const nodes = collect()
    const ruled = nodes.filter(isRuled)
    const containers = nodes.filter((n) => n.role === 'container')

    // The intent census (host-installed; empty until the host wires it, or in a bare bundle), viewed
    // through the current mode: CAPABILITY (declared graph) or LIVE (runtime last-fire + handlers).
    const census = readIntentCensus()
    const view = viewOf(census, censusMode)
    const intentTypes = view.types

    // ── the panel, rebuilt only on a structural change (incl. a census / mode change) ──────────
    const censusSig = intentTypes
      .map((t) => `${t}>${view.firers(t).join(',')}>${view.handlers(t).join(',')}`)
      .join('|')
    const sig = `${boxes}|${links}|${intentFrames}|${intentArrows}|${censusMode}|${pinnedIntent ?? ''}|${nodes.map((n) => `${n.key}:${n.parent ?? ''}:${labelOf(n)}`).join('|')}#${censusSig}`
    if (sig === lastSig) return drawOverlay(nodes)
    lastSig = sig
    const focusKey = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined
    hideTip()
    root.textContent = ''
    const head = document.createElement('div')
    head.className = 'au-li-head'
    // These controls use buttons and claim no global keyboard chords. Projection commands belong
    // in the shared keybinding system so bindings remain explicit and composition-owned.
    const toggle = (label: string, on: boolean, set: (v: boolean) => void): HTMLElement => {
      const b = document.createElement('au-button')
      b.className = 'au-li-btn'
      b.setAttribute('size', 'sm')
      b.dataset.focusKey = label
      b.textContent = label
      b.setAttribute('aria-pressed', String(on))
      b.addEventListener('au-activate', () => {
        set(!on)
        syncOverlay()
        draw()
      })
      return b
    }
    const btnBoxes = toggle('boxes', boxes, (v) => { boxes = v })
    const btnLinks = toggle('tree lines', links, (v) => { links = v })
    // The two intent-overlay toggles independently control highlight frames and connecting arrows.
    // They draw for the active intent: a pinned or hovered census row.
    const btnFrames = toggle('intent frames', intentFrames, (v) => { intentFrames = v })
    const btnArrows = toggle('intent arrows', intentArrows, (v) => { intentArrows = v })
    // The census MODE switch (not a boolean toggle): capability (declared graph) ↔ live (runtime).
    // Its label IS the current mode, so one button both shows and changes it.
    const btnMode = document.createElement('au-button')
    btnMode.className = 'au-li-btn'
    btnMode.setAttribute('size', 'sm')
    btnMode.dataset.focusKey = 'census-mode'
    btnMode.textContent = censusMode
    btnMode.title = 'intent census: capability (who CAN fire/handle, declared) ↔ live (last fire + mounted handlers)'
    btnMode.setAttribute('aria-pressed', String(censusMode === 'capability'))
    btnMode.addEventListener('au-activate', () => {
      censusMode = censusMode === 'capability' ? 'live' : 'capability'
      hoveredIntent = null // a transient hover from the other mode may name a now-absent row.
      syncOverlay()
      draw()
    })
    const count = document.createElement('span')
    count.className = 'au-li-count'
    count.textContent = `${containers.length} container${containers.length === 1 ? '' : 's'} · ${
      nodes.length - containers.length
    } position${nodes.length - containers.length === 1 ? '' : 's'} · ${ruled.length} ruled`
    // The intent-only controls (frames / arrows / capability↔live) live in the Intents section below,
    // beside the census they act on — not in this top row, which governs the structure layers.
    head.append(btnBoxes, btnLinks, count)
    root.appendChild(head)

    if (nodes.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'au-li-empty'
      empty.textContent = 'No containers registered in this window.'
      root.appendChild(empty)
    }

    // Depth-first from the roots, so the list reads as the tree it is.
    const children = new Map<string | undefined, Node[]>()
    for (const n of nodes) {
      const list = children.get(n.parent) ?? []
      list.push(n)
      children.set(n.parent, list)
    }
    const walk = (parent: string | undefined, indent: number): void => {
      for (const n of children.get(parent) ?? []) {
        const row = document.createElement('div')
        row.className = 'au-li-row'
        row.tabIndex = 0
        row.dataset.focusKey = `node:${n.key}`
        row.style.paddingLeft = `calc(var(--au-tree-indent) * ${indent})`
        const dot = document.createElement('span')
        dot.className = `au-li-dot${n.role === 'position' ? ' pos' : ''}`
        dot.style.background = isRuled(n) ? 'var(--au-ink-2)' : 'var(--au-ink-3)'
        const text = document.createElement('span')
        if (n.role === 'container') text.className = 'au-li-kind'
        if (isRuled(n)) text.classList.add('au-li-rule')
        text.textContent = labelOf(n)
        row.append(dot, text)
        row.addEventListener('mouseenter', () => {
          hovered = n.key
          showTip(n, row)
          drawOverlay(nodes)
        })
        row.addEventListener('mouseleave', () => {
          hovered = null
          hideTip()
          drawOverlay(nodes)
        })
        row.addEventListener('focus', () => { hovered = n.key; showTip(n, row); drawOverlay(nodes) })
        row.addEventListener('blur', () => { hovered = null; hideTip(); drawOverlay(nodes) })
        row.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTip() })
        root.appendChild(row)
        walk(n.key, indent + 1)
      }
    }
    walk(undefined, 0)

    // ── the intent census: who FIRES and who HANDLES each type ─────────────────────────────────
    // Makes routing legible without grepping projections — "file-tree fires open-intent; bento, tabs,
    // radial-tree, focal-tree handle it". Deliberately shows the candidate SET, never the winner (the
    // MRU/claim ORDER is a separate thing). Absent until the host installs the census provider.
    if (intentTypes.length > 0) {
      const section = document.createElement('div')
      section.className = 'au-li-intents'
      const subhead = document.createElement('div')
      subhead.className = 'au-li-subhead'
      subhead.textContent = censusMode === 'capability' ? 'Intents · capability (declared)' : 'Intents · live (runtime)'
      section.appendChild(subhead)
      // The intent controls sit beside the census they drive:
      // the capability↔live mode, and the two overlay toggles (frames / arrows).
      const icontrols = document.createElement('div')
      icontrols.className = 'au-li-icontrols'
      icontrols.append(btnMode, btnFrames, btnArrows)
      section.appendChild(icontrols)
      const dash = (names: readonly string[]): string => (names.length ? names.join(', ') : '—')
      for (const t of intentTypes) {
        const irow = document.createElement('button')
        irow.type = 'button'
        irow.dataset.focusKey = `intent:${t}`
        irow.setAttribute('aria-pressed', String(pinnedIntent === t))
        irow.className = 'au-li-irow'
        const name = document.createElement('span')
        name.className = 'au-li-iname'
        name.textContent = t
        const fields = document.createElement('span')
        fields.className = 'au-li-ifields'
        for (const [label, values] of [
          [censusMode === 'capability' ? 'Can fire' : 'Last fired', view.firers(t)],
          [censusMode === 'capability' ? 'Can handle' : 'Handled', view.handlers(t)],
        ] as const) {
          const field = document.createElement('span')
          field.className = 'au-li-ifield'
          const caption = document.createElement('span')
          caption.className = 'au-li-imeta'
          caption.textContent = label
          const value = document.createElement('span')
          value.textContent = dash(values)
          field.append(caption, value)
          fields.append(field)
        }
        irow.append(name, fields)
        if (pinnedIntent === t) irow.classList.add('au-li-ipin')
        // HOVER previews an intent's fire→handle viz; CLICK pins it, so it persists without holding the
        // hover (and click again to unpin). The `intent frames` / `intent arrows` toggles decide what
        // draws. Its own overlay mode: shown even when boxes/tree-lines are off.
        irow.addEventListener('mouseenter', () => {
          hoveredIntent = t
          syncOverlay()
          drawOverlay(nodes)
        })
        irow.addEventListener('mouseleave', () => {
          hoveredIntent = null
          syncOverlay()
          drawOverlay(nodes)
        })
        irow.addEventListener('focus', () => { hoveredIntent = t; syncOverlay(); drawOverlay(nodes) })
        irow.addEventListener('blur', () => { hoveredIntent = null; syncOverlay(); drawOverlay(nodes) })
        irow.addEventListener('click', () => {
          pinnedIntent = pinnedIntent === t ? null : t
          syncOverlay()
          draw() // rebuild to move the pin highlight
        })
        section.appendChild(irow)
      }
      root.appendChild(section)
    }

    if (focusKey) {
      const target = [...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find((item) => item.dataset.focusKey === focusKey)
      requestAnimationFrame(() => { if (target?.isConnected && document.activeElement === document.body) target.focus({ preventScroll: true }) })
    }
    drawOverlay(nodes)
  }

  // ── the in-place layers ──────────────────────────────────────────────────────────────────────

  const ANCHOR_PAD = 11
  const DEPTH_STEP = 9

  /** Stagger node dots near the top-left corner by nesting level. Nested boxes
   * can share the same rectangle; distinct offsets keep dots and connecting lines
   * visible. A position uses half a step to separate it from its container. */
  const anchorOf = (n: Node): { x: number; y: number } => {
    const r = n.el.getBoundingClientRect()
    const step = ANCHOR_PAD + (n.depth + (n.role === 'position' ? 0.5 : 0)) * DEPTH_STEP
    return {
      x: r.left + Math.min(step, Math.max(r.width / 2, 2)),
      y: r.top + Math.min(step, Math.max(r.height / 2, 2)),
    }
  }

  const colourOf = (n: Node): string =>
    isRuled(n) ? 'var(--au-ink-2)' : 'var(--au-ink-3)'

  // ── the intent fire→handle visualization ──────────────────────────────────────────────────────

  /**
   * Each projection type currently on screen → the NODE(s) where it sits, taken from the collected node
   * list so each carries the depth/role `anchorOf` needs. The census names SOURCES and SINKS by
   * projection TYPE, and this locates them: a container node matches by its KIND (== the type for a
   * first-party container), a leaf occupant by its instance `type`, read through the same
   * `getSlotContent` seam everything else here uses.
   */
  const typeNodes = (nodes: Node[]): Map<string, Node[]> => {
    const out = new Map<string, Node[]>()
    // Key by BARE type name. A leaf occupant's `type` is the config's QUALIFIED claim
    // (`file-tree::file-tree`), but the census names projections by bare name (its declared half comes
    // from the discovery `typeName`, which is bare). Without this the capability viz never matches a
    // leaf — the exact bug behind "live highlights file-tree, capability does not".
    const add = (type: string | undefined, node: Node): void => {
      if (!type) return
      const key = type.split('::')[0] ?? type
      const list = out.get(key) ?? []
      list.push(node)
      out.set(key, list)
    }
    for (const n of nodes) {
      if (n.role === 'container') add(n.kind, n)
      else if (n.slotId)
        add((ownerOf(n.el, false)?.placement.getSlotContent(n.slotId)?.instance as { type?: string } | undefined)?.type, n)
    }
    return out
  }

  const NS = 'http://www.w3.org/2000/svg'
  const AMBER = '35 92% 60%'
  const BLUE = '210 92% 66%'

  /**
   * The intent fire→handle visualization for the ACTIVE intent, over the live app. FRAMES
   * (`intent frames`) outline each source pane amber and each sink blue; ARROWS (`intent arrows`) curve
   * from each source to each sink. The WHY of the census — an invisible routing edge made pointable.
   *
   * ARROWS ANCHOR LIKE THE TREE LINES — `anchorOf` (top-left + a per-depth stagger), NOT the rect
   * CENTRE. Nested boxes here are routinely COINCIDENT (a container and its sole position share a rect),
   * so centre-to-centre arrows collapsed onto each other; the stagger is the same fix the tree view
   * uses, a position taking a half-step so a container and its own occupant do not land on one point.
   * FRAMES still outline the full rect; only the arrow ENDPOINTS are staggered.
   *
   * Shows the candidate SET (every source→sink pair), not the responder-chain winner.
   */
  const drawIntentViz = (type: string, nodes: Node[]): void => {
    const view = viewOf(readIntentCensus(), censusMode)
    const tn = typeNodes(nodes)
    const nodesFor = (names: readonly string[]): Node[] => [...new Set(names.flatMap((n) => tn.get(n) ?? []))]
    const srcNodes = nodesFor(view.firers(type))
    const snkNodes = nodesFor(view.handlers(type))
    if (srcNodes.length === 0 && snkNodes.length === 0) return

    const svg = document.createElementNS(NS, 'svg')
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible'

    if (intentFrames) {
      const frame = (n: Node, colour: string, label: string): void => {
        const r = n.el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return
        const rect = document.createElementNS(NS, 'rect')
        rect.setAttribute('x', String(r.left))
        rect.setAttribute('y', String(r.top))
        rect.setAttribute('width', String(r.width))
        rect.setAttribute('height', String(r.height))
        rect.setAttribute('rx', '3')
        rect.setAttribute('fill', `hsl(${colour} / 0.09)`)
        rect.setAttribute('stroke', `hsl(${colour})`)
        rect.setAttribute('stroke-width', '2')
        svg.appendChild(rect)
        const tag = document.createElementNS(NS, 'text')
        tag.setAttribute('x', String(r.left + 5))
        tag.setAttribute('y', String(r.top + 13))
        tag.setAttribute('fill', `hsl(${colour})`)
        tag.setAttribute('font-family', 'ui-monospace, monospace')
        tag.setAttribute('font-size', '10')
        tag.setAttribute('font-weight', '700')
        tag.textContent = label
        svg.appendChild(tag)
      }
      for (const n of srcNodes) frame(n, AMBER, 'fires')
      for (const n of snkNodes) frame(n, BLUE, 'handles')
    }

    if (intentArrows) {
      const defs = document.createElementNS(NS, 'defs')
      const marker = document.createElementNS(NS, 'marker')
      marker.setAttribute('id', 'au-li-arrow')
      marker.setAttribute('viewBox', '0 0 10 10')
      marker.setAttribute('refX', '9')
      marker.setAttribute('refY', '5')
      marker.setAttribute('markerWidth', '7')
      marker.setAttribute('markerHeight', '7')
      marker.setAttribute('orient', 'auto-start-reverse')
      const head = document.createElementNS(NS, 'path')
      head.setAttribute('d', 'M0,0 L10,5 L0,10 z')
      head.setAttribute('fill', `hsl(${BLUE})`)
      marker.appendChild(head)
      defs.appendChild(marker)
      svg.appendChild(defs)

      // A curved dashed arrow per (source, sink) pair, anchored TREE-LINE style (staggered top-left,
      // not centre) and bowed perpendicular so coincident pairs separate.
      for (const s of srcNodes) {
        const a = anchorOf(s)
        for (const k of snkNodes) {
          if (s === k) continue
          const b = anchorOf(k)
          if (a.x === b.x && a.y === b.y) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.hypot(dx, dy) || 1
          const bow = Math.min(70, len * 0.22)
          const cx = (a.x + b.x) / 2 - (dy / len) * bow
          const cy = (a.y + b.y) / 2 + (dx / len) * bow
          const path = document.createElementNS(NS, 'path')
          path.setAttribute('d', `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`)
          path.setAttribute('fill', 'none')
          path.setAttribute('stroke', 'hsl(200 88% 64% / 0.9)')
          path.setAttribute('stroke-width', '2')
          path.setAttribute('stroke-dasharray', '5 4')
          path.setAttribute('marker-end', 'url(#au-li-arrow)')
          svg.appendChild(path)
        }
      }
    }
    overlay.appendChild(svg)
  }

  const drawOverlay = (nodes: Node[]): void => {
    overlay.textContent = ''
    if (!boxes && !links && activeIntent() === null) return

    if (boxes) {
      for (const n of nodes) {
        const r = n.el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const on = hovered === n.key
        const colour = on ? 'var(--au-color-accent)' : colourOf(n)
        const box = document.createElement('div')
        box.style.cssText = [
          'position:absolute',
          `left:${r.left}px`,
          `top:${r.top}px`,
          `width:${r.width}px`,
          `height:${r.height}px`,
          `border:${on ? 3 : isRuled(n) ? 2 : 1}px ${n.role === 'container' ? 'solid' : 'dashed'} color-mix(in srgb, ${colour} ${on || isRuled(n) ? 95 : 50}%, transparent)`,
          `background:color-mix(in srgb, ${colour} ${on ? 14 : isRuled(n) ? 7 : 3}%, transparent)`,
          'pointer-events:none',
        ].join(';')
        // Draw labels only for the hovered node and positions with rules to keep nested
        // frames readable without covering the content they describe.
        if (on || isRuled(n)) {
          const tag = document.createElement('span')
          tag.style.cssText = [
            'position:absolute',
            n.role === 'container' ? 'left:0;top:0' : 'right:0;bottom:0',
            'font:var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono)',
            'padding:var(--au-space-0-5) var(--au-space-1)',
            'color:#fff',
            `background:color-mix(in srgb, ${colour} 92%, transparent)`,
            'white-space:nowrap',
          ].join(';')
          tag.textContent = labelOf(n)
          box.appendChild(tag)
        }
        overlay.appendChild(box)
      }
    }

    if (links) {
      const svg = document.createElementNS(NS, 'svg')
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
      const at = new Map(nodes.map((n) => [n.key, anchorOf(n)]))
      // Edges first, so a dot is never obscured by a line leaving it.
      for (const n of nodes) {
        const a = at.get(n.key)
        const b = n.parent ? at.get(n.parent) : undefined
        if (!a || !b) continue
        const line = document.createElementNS(NS, 'line')
        line.setAttribute('x1', String(b.x))
        line.setAttribute('y1', String(b.y))
        line.setAttribute('x2', String(a.x))
        line.setAttribute('y2', String(a.y))
        const on = hovered === n.key || hovered === n.parent
        line.setAttribute('stroke', on ? 'var(--au-color-accent)' : 'var(--au-ink-3)')
        line.setAttribute('stroke-width', on ? '2.5' : '1.5')
        svg.appendChild(line)
      }
      for (const n of nodes) {
        const a = at.get(n.key)
        if (!a) continue
        const on = hovered === n.key
        const dot = document.createElementNS(NS, 'circle')
        dot.setAttribute('cx', String(a.x))
        dot.setAttribute('cy', String(a.y))
        dot.setAttribute('r', String(on ? 8 : n.role === 'container' ? 6 : isRuled(n) ? 5 : 3.5))
        dot.setAttribute('fill', on ? 'var(--au-color-accent)' : isRuled(n) ? 'var(--au-ink-2)' : 'var(--au-ink-3)')
        dot.setAttribute('stroke', 'rgba(10,14,22,0.9)')
        dot.setAttribute('stroke-width', '1.5')
        svg.appendChild(dot)
      }
      overlay.appendChild(svg)
    }

    const active = activeIntent()
    if (active) drawIntentViz(active, nodes)
  }

  // Sampled each frame, so the view tracks scroll, resize, a live drag and any layout mutation
  // without wiring a listener per source. Cheap: reading rects and rebuilding a short list.
  const tick = (): void => {
    draw()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(raf)
    // Give BOTH layers back, which takes our elements with them. Releasing rather than only removing
    // our own divs matters: a layer that outlived its claimant would be an empty full-viewport sheet
    // holding a position in the stacking ladder for nothing.
    layer?.release()
    tipLayer?.release()
    disposeStyles?.()
    root.remove()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
