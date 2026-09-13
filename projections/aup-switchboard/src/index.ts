// The intent SWITCHBOARD — a visual patch-bay over the composition's intent wires.

// Every projection in the composition is a NODE. Its INPUT ports are the intents its type HANDLES, its
// OUTPUT ports are the intents it FIRES (both from `host.compositionEdit.nodes()`, the same discovery the
// dispatch gate uses — so a port never disagrees with routing). The composition's `intent-wires` are
// CABLES: an output port of the source wired to an input port of each recipient. Drag an output port to a
// matching input port to SET a wire (widen a `once` to a set); click a cable's tag to toggle its mode or
// delete it. Every write goes through `host.compositionEdit`, the app-owned surface that routes to the ONE
// guarded composition writer — the overlay never serializes a wire itself.

// Vanilla DOM + inline SVG on purpose: the node-graph is direct and imperative (drag, hit-test, live
// preview), and it demonstrates the mount contract needs no framework.



import { defineProjection, type ProjectionModule, type MountHost } from '@arsumbris/au-host-sdk'
import type { CompositionEditControl, CompositionNode, CompositionWire, HostApp } from '@arsumbris/au-host-app'
import { readTypes } from '@arsumbris/au-host-sdk/engine-reads'

const STYLE = `
.au-sb { position: relative; box-sizing: border-box; min-width: 0; min-height: 0; width: 100%; height: 100%; overflow: auto; scrollbar-gutter: stable; font: var(--au-t-xs) var(--au-font-mono); background: transparent; color: var(--au-ink-1); }
.au-sb-hint { position: sticky; top: 0; left: 0; z-index: 3; padding: var(--au-space-1) var(--au-space-2); background: var(--au-color-surface-1); border-bottom: 1px solid var(--au-color-border); color: var(--au-ink-3); display: flex; gap: var(--au-space-2) var(--au-space-3); align-items: baseline; flex-wrap: wrap; overflow-wrap: anywhere; }
.au-sb-hint .au-sb-broken-count { color: var(--au-color-danger); }
.au-sb-empty { padding: var(--au-space-4); color: var(--au-ink-4); }
.au-sb-canvas { padding: var(--au-space-6); box-sizing: border-box; position: relative; min-width: 100%; min-height: 100%; }
.au-sb-cables { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.au-sb-cables path.cable { fill: none; stroke: var(--au-color-accent); stroke-width: 2; pointer-events: stroke; cursor: pointer; }
.au-sb-cables path.cable.broken { stroke: var(--au-color-danger); stroke-dasharray: 5 4; }
.au-sb-cables path.cable:hover { stroke-width: 3; }
.au-sb-cables path.preview { fill: none; stroke: var(--au-color-accent); stroke-width: 2; stroke-dasharray: 4 4; opacity: 0.7; }
.au-sb-cables circle.au-sb-pulse { fill: var(--au-color-accent); filter: drop-shadow(0 0 4px var(--au-color-accent)); pointer-events: none; }
/* An UNWIRED (ambient / MRU-focus) delivery has no cable: a transient dashed arrow, muted + fading, so
 * a non-wired routing is VISIBLE and distinct from a solid wired cable. */
.au-sb-cables path.au-sb-ambient { fill: none; stroke: var(--au-ink-3); stroke-width: 1.5; stroke-dasharray: 3 4; opacity: 0.5; pointer-events: none; }
.au-sb-cables circle.au-sb-pulse.ambient { fill: var(--au-ink-3); filter: none; opacity: 0.85; }
/* A SELF-claim ("open here"): a node handling its own fire. The loop arcs over the node, and the node
   itself pulses, so it reads as "opened its own" rather than a delivery elsewhere. */
.au-sb-cables path.au-sb-self { stroke: var(--au-color-accent); opacity: 0.7; }
.au-sb-node.self-claim { box-shadow: 0 0 0 2px var(--au-color-accent), var(--au-sh-lift); }
.au-sb-dot.firing { background: var(--au-color-accent); box-shadow: 0 0 0 5px color-mix(in srgb, var(--au-color-accent) 35%, transparent); transition: box-shadow var(--au-m-fast) var(--au-e-std); }
.au-sb-node { position: absolute; min-width: 150px; background: var(--au-color-surface-1); border: 1px solid var(--au-color-border); border-radius: var(--au-radius-sm); box-shadow: var(--au-sh-lift); user-select: none; }
.au-sb-node-title { padding: var(--au-space-1) var(--au-space-2); font-weight: var(--au-w-strong); border-bottom: 1px solid var(--au-color-border); cursor: grab; white-space: nowrap; }
.au-sb-node.dragging .au-sb-node-title { cursor: grabbing; }
.au-sb-group { padding: var(--au-space-1) 0; }
.au-sb-group-label { padding: 0 var(--au-space-2); font-size: var(--au-t-2xs); color: var(--au-ink-4); text-transform: uppercase; letter-spacing: var(--au-ls-label); }
.au-sb-port { display: flex; align-items: center; gap: var(--au-space-2); padding: var(--au-space-0-5) var(--au-space-2); position: relative; }
.au-sb-port.out { justify-content: flex-end; }
.au-sb-dot { width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--au-color-accent); background: var(--au-color-surface-1); box-sizing: border-box; cursor: crosshair; flex: none; }
.au-sb-dot.wired { background: var(--au-color-accent); }
.au-sb-port.in .au-sb-dot { position: absolute; left: -6px; }
.au-sb-port.out .au-sb-dot { position: absolute; right: -6px; }
.au-sb-port.in { padding-left: var(--au-space-3); }
.au-sb-port.out { padding-right: var(--au-space-3); }
.au-sb-port.drop-ok .au-sb-dot { box-shadow: 0 0 0 4px color-mix(in srgb, var(--au-color-accent) 35%, transparent); }
.au-sb-port-label { white-space: nowrap; }
/* The ambient-reachability toggle on an input port, and the closed (wire-only) rendering. */
.au-sb-reach { margin-left: auto; border: none; background: transparent; color: var(--au-ink-3); cursor: pointer; font-size: var(--au-t-xs); line-height: 1; padding: 0 var(--au-space-0-5); }
.au-sb-reach:focus-visible { outline: 2px solid var(--au-focus-outer); outline-offset: 2px; }
.au-sb-reach:hover { color: var(--au-ink-1); }
.au-sb-port.closed .au-sb-port-label { text-decoration: line-through; color: var(--au-ink-4); }
.au-sb-port.closed .au-sb-dot { border-style: dashed; background: transparent; }
.au-sb-port.closed .au-sb-reach { color: var(--au-color-accent); }
.au-sb-cable-tag { position: absolute; z-index: 2; transform: translate(-50%, -50%); display: flex; align-items: center; gap: var(--au-space-1); padding: var(--au-space-0-5) var(--au-space-1); font-size: var(--au-t-2xs); background: var(--au-color-surface-1); border: 1px solid var(--au-color-border); border-radius: var(--au-radius-sm); }
.au-sb-cable-tag button { border: 0; background: transparent; font: inherit; color: inherit; padding: var(--au-space-0-5); cursor: pointer; }
.au-sb-cable-tag button:focus-visible { outline: 2px solid var(--au-focus-outer); outline-offset: 1px; }
.au-sb-cables .tag-leader { stroke: var(--au-ink-3); stroke-width: 1; stroke-dasharray: 2 3; fill: none; pointer-events: none; }
.au-sb-cable-tag .mode { cursor: pointer; }
.au-sb-cable-tag .mode.fallback { color: var(--au-color-accent); }
.au-sb-cable-tag .del { cursor: pointer; color: var(--au-ink-4); }
.au-sb-cable-tag .del:hover { color: var(--au-color-danger); }
.au-sb-tip { position: fixed; z-index: 10; max-width: 320px; padding: var(--au-space-1) var(--au-space-2); pointer-events: none; font-size: var(--au-t-2xs); line-height: var(--au-lh-2xs); }
.au-sb-tip .name { font-weight: var(--au-w-strong); }
.au-sb-tip .doc { color: var(--au-ink-2); margin-top: var(--au-space-0-5); white-space: pre-wrap; }
.au-sb-tip .doc.none { color: var(--au-ink-4); font-style: italic; }
@media (prefers-reduced-motion: reduce) { .au-sb-dot.firing { transition: none; animation: none; } }

`

type Pt = { x: number; y: number }

function mount(container: HTMLElement, host: MountHost): () => void {
  const edit: CompositionEditControl | undefined = (host as HostApp).compositionEdit

  const disposeStyles = host.styles?.inject(STYLE, container)

  if (!edit) {
    const empty = document.createElement('div')
    empty.className = 'au-sb-empty'
    empty.textContent = 'The switchboard is only available inside a composition.'
    container.appendChild(empty)
    return () => {
      disposeStyles?.()
      empty.remove()
    }
  }

  const root = document.createElement('div')
  root.className = 'au-sb'
  const hint = document.createElement('div')
  hint.className = 'au-sb-hint'
  const canvas = document.createElement('div')
  canvas.className = 'au-sb-canvas'
  const svgNS = 'http://www.w3.org/2000/svg'
  const cables = document.createElementNS(svgNS, 'svg')
  cables.setAttribute('class', 'au-sb-cables')
  canvas.appendChild(cables)
  root.append(hint, canvas)
  container.appendChild(root)

  // Intent DOCSTRINGS, name → `#:` doc, for the port hover tooltip. One workspace-wide `types` read
  // (name-keyed, so no `::repo` qualification needed); refreshed when the engine becomes ready.
  const docs = new Map<string, string>()
  const loadDocs = async (): Promise<void> => {
    const r = await readTypes(host.engine, { summary: true }).catch(() => null)
    if (!r || !('ready' in r) || !r.ready) return
    for (const t of r.result) if (typeof t.doc === 'string' && t.doc.length > 0) docs.set(t.name, t.doc)
  }

  // The hover tooltip — one reused element, positioned at the pointer over a port.
  const tip = document.createElement('au-hovercard')
  tip.setAttribute('role', 'tooltip')
  tip.className = 'au-sb-tip'
  tip.style.display = 'none'
  container.appendChild(tip)
  const showTip = (intent: string, x: number, y: number): void => {
    const doc = docs.get(intent)
    tip.innerHTML = ''
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = intent
    const body = document.createElement('div')
    body.className = doc ? 'doc' : 'doc none'
    body.textContent = doc ?? 'no docstring'
    tip.append(name, body)
    tip.style.left = `${x + 14}px`
    tip.style.top = `${y + 14}px`
    tip.style.display = 'block'
  }
  const hideTip = (): void => void (tip.style.display = 'none')
  // Delegated hover: show the tooltip for whichever port the pointer is over (skip while dragging).
  canvas.addEventListener('pointerover', (e) => {
    if (drag) return
    const port = (e.target as HTMLElement | null)?.closest<HTMLElement>('.au-sb-port')
    if (port?.dataset.intent) showTip(port.dataset.intent, e.clientX, e.clientY)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (drag || tip.style.display === 'none') return
    tip.style.left = `${e.clientX + 14}px`
    tip.style.top = `${e.clientY + 14}px`
  })
  canvas.addEventListener('pointerout', (e) => {
    const to = e.relatedTarget as HTMLElement | null
    if (!to?.closest('.au-sb-port')) hideTip()
  })

  // Session-only node positions, keyed by pool id (NOT persisted — the composition stores no switchboard
  // layout). New nodes get a deterministic auto-layout slot.
  const positions = new Map<string, Pt>()
  const moved = new Set<string>()
  // Live drag state: either dragging a NODE (reposition) or drawing a CABLE from an output port.
  type NodeDrag = { kind: 'node'; id: string; grab: Pt }
  type CableDrag = { kind: 'cable'; source: string; intent: string }
  let drag: NodeDrag | CableDrag | null = null

  // Rebuilt every render: a map "id|intent|dir" -> the port DOT element, for cable geometry + drop tests.
  let dots = new Map<string, HTMLElement>()
  const dotKey = (id: string, intent: string, dir: 'in' | 'out'): string => `${id}|${intent}|${dir}`

  const layoutNodes = (): void => {
    const elements = [...canvas.querySelectorAll<HTMLElement>('.au-sb-node')]
    const gap = parseFloat(getComputedStyle(canvas).paddingLeft) || 24
    type Box = Pt & { width: number; height: number }
    const occupied: Box[] = elements.filter((el) => moved.has(el.dataset.node!)).map((el) => ({
      ...positions.get(el.dataset.node!)!, width: el.offsetWidth, height: el.offsetHeight,
    }))
    let x = gap
    let y = gap
    let columnWidth = 0
    let count = 0
    for (const el of elements) {
      const id = el.dataset.node!
      if (moved.has(id)) continue
      if (count === 3) { x += columnWidth + gap * 2; y = gap; columnWidth = 0; count = 0 }
      const width = el.offsetWidth
      const height = el.offsetHeight
      let collision: Box | undefined
      do {
        collision = occupied.find((box) => x < box.x + box.width + gap && x + width + gap > box.x
          && y < box.y + box.height + gap && y + height + gap > box.y)
        if (collision) y = collision.y + collision.height + gap
      } while (collision)
      positions.set(id, { x, y })
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      occupied.push({ x, y, width, height })
      y += height + gap
      columnWidth = Math.max(columnWidth, width)
      count++
    }
    canvas.style.width = `${Math.max(0, ...occupied.map((box) => box.x + box.width)) + gap}px`
    canvas.style.height = `${Math.max(0, ...occupied.map((box) => box.y + box.height)) + gap}px`
  }

  const canvasPoint = (clientX: number, clientY: number): Pt => {
    const r = canvas.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }
  const dotCenter = (el: HTMLElement): Pt => {
    const r = el.getBoundingClientRect()
    const c = canvas.getBoundingClientRect()
    return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top }
  }
  const cablePath = (a: Pt, b: Pt): string => {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2)
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
  }
  /** A SELF-loop: a node's own out port → its own in port (a self-delivery, "open here"). A straight cable
   *  would fold back through the node, so arc it clearly UP and over the top instead. */
  const selfLoopPath = (a: Pt, b: Pt): string => {
    const top = Math.min(a.y, b.y) - 48
    return `M ${a.x} ${a.y} C ${a.x + 44} ${top}, ${b.x - 44} ${top}, ${b.x} ${b.y}`
  }

  // --- build one node's DOM (title + input group + output group) --------------------------------------
  const buildNode = (node: CompositionNode): HTMLElement => {
    if (!positions.has(node.id)) positions.set(node.id, { x: 0, y: 0 })
    const pos = positions.get(node.id)!
    const el = document.createElement('div')
    el.className = 'au-sb-node'
    el.dataset.node = node.id
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`

    const title = document.createElement('div')
    title.className = 'au-sb-node-title'
    title.textContent = node.type
    title.title = `${node.type}  (${node.id})`
    title.addEventListener('pointerdown', (e) => beginNodeDrag(e, node.id))
    el.appendChild(title)

    const group = (label: string, intents: string[], dir: 'in' | 'out'): HTMLElement => {
      const g = document.createElement('div')
      g.className = 'au-sb-group'
      const lbl = document.createElement('div')
      lbl.className = 'au-sb-group-label'
      lbl.textContent = label
      g.appendChild(lbl)
      for (const intent of intents) {
        const port = document.createElement('div')
        port.className = `au-sb-port ${dir}`
        port.dataset.node = node.id
        port.dataset.intent = intent
        port.dataset.dir = dir
        const dot = document.createElement('span')
        dot.className = 'au-sb-dot'
        const label2 = document.createElement('span')
        label2.className = 'au-sb-port-label'
        label2.textContent = intent
        // Output dot on the RIGHT, input dot on the LEFT (dataflow reads left→right).
        if (dir === 'out') port.append(label2, dot)
        else port.append(dot, label2)
        if (dir === 'out') dot.addEventListener('pointerdown', (e) => beginCableDrag(e, node.id, intent))
        if (dir === 'in') {
          // RUNG 2: a badge on the input port toggles its AMBIENT reachability. Closed = wire-only (ambient
          // skips it; a wire still lands). The port DOT stays the drag target; the badge is a separate button.
          const closed = node.closed.includes(intent)
          if (closed) port.classList.add('closed')
          const badge = document.createElement('button')
          badge.type = 'button'
          badge.className = 'au-sb-reach'
          badge.textContent = closed ? '⊘' : '○'
          badge.setAttribute('aria-label', `${intent}: ambient routing`)
          badge.setAttribute('aria-pressed', String(!closed))
          badge.title = closed
            ? 'wire-only (ambient off) — click to reopen to ambient routing'
            : 'ambient on — click to close (wire-only: only an explicit wire reaches this)'
          badge.addEventListener('click', (e) => {
            e.stopPropagation()
            edit.setReachability(node.id, intent, closed ? 'ambient' : 'wire-only')
            render()
          })
          port.appendChild(badge)
        }
        dots.set(dotKey(node.id, intent, dir), dot)
        g.appendChild(port)
      }
      return g
    }
    if (node.handles.length) el.appendChild(group('input', node.handles, 'in'))
    if (node.fires.length) el.appendChild(group('output', node.fires, 'out'))
    return el
  }

  // --- render: rebuild nodes, then cables -------------------------------------------------------------
  const render = (): void => {
    const focusKey = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.cableFocus : undefined
    const nodes = edit.nodes()
    const wires = edit.wires()
    const byId = new Map(nodes.map((n) => [n.id, n]))

    // Rebuild nodes (positions preserved across renders by id; drop positions for departed nodes).
    // Cable tags are cleared inside drawCables (so a drag-redraw clears them too).
    for (const el of [...canvas.querySelectorAll('.au-sb-node')]) el.remove()
    dots = new Map()
    for (const id of [...positions.keys()]) if (!byId.has(id)) { positions.delete(id); moved.delete(id) }
    nodes.forEach((n) => canvas.appendChild(buildNode(n)))
    layoutNodes()

    drawCables(wires, byId)
    updateHint(wires, byId)
    if (focusKey) requestAnimationFrame(() => {
      if (document.activeElement === document.body) [...root.querySelectorAll<HTMLElement>('[data-cable-focus]')].find((item) => item.dataset.cableFocus === focusKey)?.focus({ preventScroll: true })
    })
  }

  const drawCables = (wires: CompositionWire[], byId: Map<string, CompositionNode>): void => {
    while (cables.firstChild) cables.removeChild(cables.firstChild)
    // Cable TAGS are HTML siblings of the SVG, not svg children — clear them here too, so a redraw
    // during a node drag replaces them instead of smearing a trail of stacked tags.
    for (const el of [...canvas.querySelectorAll('.au-sb-cable-tag')]) el.remove()
    const wiredOut = new Set<string>() // "id|intent" output dots that carry at least one cable → filled.
    const wiredIn = new Set<string>()

    for (const w of wires) {
      const src = byId.get(w.source)
      const srcDot = dots.get(dotKey(w.source, w.intent, 'out'))
      for (const t of w.targets) {
        const tgt = byId.get(t)
        const tgtDot = dots.get(dotKey(t, w.intent, 'in'))
        // BROKEN (capability drift / departed node): source no longer fires it, or target no longer
        // handles it, or an endpoint left the pool. Liveness (unmounted) is NOT visible to a static
        // overlay — that is the dispatch-time `unavailable` case. Draw what we can; count the rest.
        const broken = !src || !srcDot || !tgt || !tgtDot || !src.fires.includes(w.intent) || !tgt.handles.includes(w.intent)
        if (!srcDot || !tgtDot) continue // no anchor to draw between — surfaced in the hint instead.
        const a = dotCenter(srcDot)
        const b = dotCenter(tgtDot)
        const path = document.createElementNS(svgNS, 'path')
        path.setAttribute('d', cablePath(a, b))
        path.setAttribute('class', broken ? 'cable broken' : 'cable')
        path.dataset.source = w.source // tag the endpoints so a live dispatch pulse finds this cable.
        path.dataset.target = t
        path.dataset.intent = w.intent
        cables.appendChild(path)
        wiredOut.add(`${w.source}|${w.intent}`)
        wiredIn.add(`${t}|${w.intent}`)
        appendCableTag(w, t, path)
      }
    }
    // Fill the dots that carry a cable, so a wired port reads at a glance.
    for (const key of wiredOut) dots.get(`${key}|out`)?.classList.add('wired')
    for (const key of wiredIn) dots.get(`${key}|in`)?.classList.add('wired')
  }

  // Cable controls occupy a clear point along the path, or an external gutter with a leader.
  const appendCableTag = (w: CompositionWire, target: string, path: SVGPathElement): void => {
    const tag = document.createElement('div')
    tag.className = 'au-sb-cable-tag'
    const mode = document.createElement('button')
    mode.type = 'button'
    const cur = w.mode ?? 'strict'
    mode.className = `mode ${cur}`
    mode.textContent = cur
    mode.title = 'toggle strict ↔ fallback'
    mode.setAttribute('aria-label', `${w.source}: ${w.intent} routing mode ${cur}; toggle strict or fallback`)
    mode.dataset.cableFocus = JSON.stringify([w.source, w.intent, target, 'mode'])
    mode.addEventListener('click', () => {
      void edit.setWire({ source: w.source, intent: w.intent, targets: w.targets, mode: cur === 'strict' ? 'fallback' : 'strict' })
    })
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'del'
    del.textContent = '×'
    del.title = 'remove this cable'
    del.setAttribute('aria-label', `Remove ${w.intent} connection from ${w.source} to ${target}`)
    del.dataset.cableFocus = JSON.stringify([w.source, w.intent, target, 'delete'])
    del.addEventListener('click', () => removeCable(w, target))
    tag.append(mode, del)
    canvas.appendChild(tag)
    const canvasRect = canvas.getBoundingClientRect()
    const clearance = parseFloat(getComputedStyle(tag).columnGap) || 4
    const width = tag.offsetWidth
    const height = tag.offsetHeight
    const obstacles = [...canvas.querySelectorAll<HTMLElement>('.au-sb-node, .au-sb-cable-tag')]
      .filter((item) => item !== tag).map((item) => {
        const rect = item.getBoundingClientRect()
        return { left: rect.left - canvasRect.left, top: rect.top - canvasRect.top,
          right: rect.right - canvasRect.left, bottom: rect.bottom - canvasRect.top }
      })
    const clearAt = (point: Pt): boolean => point.x - width / 2 >= clearance && point.y - height / 2 >= clearance
      && obstacles.every((box) => point.x + width / 2 + clearance <= box.left
        || point.x - width / 2 - clearance >= box.right || point.y + height / 2 + clearance <= box.top
        || point.y - height / 2 - clearance >= box.bottom)
    const length = path.getTotalLength()
    const midpoint = path.getPointAtLength(length / 2)
    let point: Pt | undefined
    for (const fraction of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const candidate = path.getPointAtLength(length * fraction)
      if (clearAt(candidate)) { point = candidate; break }
    }
    if (!point) {
      point = { x: Math.max(width / 2 + clearance, midpoint.x),
        y: Math.max(0, ...obstacles.map((box) => box.bottom)) + clearance + height / 2 }
      const leader = document.createElementNS(svgNS, 'path')
      leader.setAttribute('class', 'tag-leader')
      leader.setAttribute('d', `M ${midpoint.x} ${midpoint.y} L ${point.x} ${point.y}`)
      cables.appendChild(leader)
    }
    tag.style.left = `${point.x}px`
    tag.style.top = `${point.y}px`
    canvas.style.width = `${Math.max(canvas.offsetWidth, point.x + width / 2 + clearance)}px`
    canvas.style.height = `${Math.max(canvas.offsetHeight, point.y + height / 2 + clearance)}px`
  }

  const updateHint = (wires: CompositionWire[], byId: Map<string, CompositionNode>): void => {
    hint.textContent = ''
    const tip = document.createElement('span')
    tip.textContent = 'Drag an output port → a matching input port to wire an intent. A dashed arrow is an unwired (ambient/MRU) routing; a loop back to a node (with the node pulsing) is it handling its own — "open here". Click ○ on an input port to make it wire-only (⊘: ambient skips it, only a wire reaches it).'
    hint.appendChild(tip)
    let broken = 0
    for (const w of wires) {
      const src = byId.get(w.source)
      for (const t of w.targets) {
        const tgt = byId.get(t)
        if (!src || !tgt || !src.fires.includes(w.intent) || !tgt.handles.includes(w.intent)) broken++
      }
    }
    if (broken) {
      const b = document.createElement('span')
      b.className = 'au-sb-broken-count'
      b.textContent = `${broken} broken cable${broken > 1 ? 's' : ''}`
      hint.appendChild(b)
    }
  }

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const frames = new Set<number>()
  const timers = new Set<number>()
  const fades = new Set<Animation>()
  const duration = (token: '--au-m-base' | '--au-m-slow'): number => {
    const value = getComputedStyle(root).getPropertyValue(token).trim()
    const number = parseFloat(value)
    return Number.isFinite(number) ? Math.max(0, number * (value.endsWith('ms') ? 1 : 1000)) : 0
  }
  const after = (callback: () => void, delay: number): void => {
    const id = window.setTimeout(() => { timers.delete(id); callback() }, delay)
    timers.add(id)
  }
  const nextFrame = (callback: FrameRequestCallback): void => {
    const id = requestAnimationFrame(now => { frames.delete(id); callback(now) })
    frames.add(id)
  }
  const clearMotion = (): void => {
    frames.forEach(cancelAnimationFrame)
    frames.clear()
    timers.forEach(clearTimeout)
    timers.clear()
    fades.forEach(animation => animation.cancel())
    fades.clear()
    cables.querySelectorAll('.au-sb-pulse, .au-sb-ambient').forEach(el => el.remove())
    canvas.querySelectorAll('.firing, .self-claim').forEach(el => el.classList.remove('firing', 'self-claim'))
  }
  const onMotionPreference = (): void => { if (motionPreference.matches) clearMotion() }
  motionPreference.addEventListener('change', onMotionPreference)

  // --- live intent flow: animate the route an intent was actually delivered over ----------------------
  // Fed by host.compositionEdit.onDispatch (the REAL dispatch), which reports every delivery with
  // `viaWire`. A cycle-skipped echo never fires, so the animation shows the guard working.
  // - viaWire   → pulse along the drawn CABLE (a wired routing).
  // - !viaWire  → the delivery took the default focus-MRU walk, so there is NO cable: draw a TRANSIENT
  //   arrow between the ports and pulse along it, so an unwired routing is VISIBLE (this is why a
  //   "phantom sync" — deleting wires yet opens still route between two views — now reads as MRU routing).

  /** Animate a pulse dot traveling `path`, then run `onDone`. Reused by the wired + ambient cases. */
  const travel = (path: SVGPathElement, muted: boolean, onDone?: () => void): void => {
    if (motionPreference.matches || !path.isConnected) { onDone?.(); return }
    const len = path.getTotalLength()
    const dot = document.createElementNS(svgNS, 'circle')
    dot.setAttribute('class', muted ? 'au-sb-pulse ambient' : 'au-sb-pulse')
    dot.setAttribute('r', muted ? '3.5' : '4.5')
    cables.appendChild(dot)
    const start = performance.now()
    const travelDuration = duration('--au-m-slow')
    const tick = (now: number): void => {
      if (!path.isConnected || !dot.isConnected) { dot.remove(); return }
      const k = travelDuration > 0 ? Math.min(1, (now - start) / travelDuration) : 1
      const p = path.getPointAtLength(k * len)
      dot.setAttribute('cx', String(p.x))
      dot.setAttribute('cy', String(p.y))
      if (k < 1) nextFrame(tick)
      else {
        dot.remove()
        onDone?.()
      }
    }
    nextFrame(tick)
  }

  const flashPort = (id: string, intent: string, dir: 'in' | 'out'): void => {
    const d = dots.get(dotKey(id, intent, dir))
    if (!d) return
    d.classList.add('firing')
    after(() => d.classList.remove('firing'), duration('--au-m-base'))
  }

  /** Pulse the whole NODE — used on a self-claim ("open here") so it reads as "this node handled its own",
   *  not a delivery to somewhere else. */
  const flashNode = (id: string): void => {
    const n = canvas.querySelector<HTMLElement>(`.au-sb-node[data-node="${id}"]`)
    if (!n) return
    n.classList.add('self-claim')
    after(() => n.classList.remove('self-claim'), duration('--au-m-slow'))
  }

  const pulse = (ev: { source: string; target: string; intent: string; viaWire: boolean }): void => {
    // Flash the firing OUTPUT port and the receiving INPUT port, whether or not a cable is drawn.
    flashPort(ev.source, ev.intent, 'out')
    flashPort(ev.target, ev.intent, 'in')

    if (ev.viaWire) {
      const path = cables.querySelector<SVGPathElement>(
        `path.cable[data-source="${ev.source}"][data-target="${ev.target}"][data-intent="${ev.intent}"]`,
      )
      if (path) travel(path, false)
      return
    }
    // UNWIRED: no cable exists, so draw a transient one between the two ports and fade it after the pulse.
    const a = dots.get(dotKey(ev.source, ev.intent, 'out'))
    const b = dots.get(dotKey(ev.target, ev.intent, 'in'))
    if (!a || !b) return // an endpoint is not a shown node — nothing to draw between.
    const self = ev.source === ev.target // a self-claim ("open here"): the node handled its OWN fire.
    const path = document.createElementNS(svgNS, 'path')
    path.setAttribute('d', self ? selfLoopPath(dotCenter(a), dotCenter(b)) : cablePath(dotCenter(a), dotCenter(b)))
    path.setAttribute('class', self ? 'au-sb-ambient au-sb-self' : 'au-sb-ambient')
    if (self) flashNode(ev.source) // make the whole node pulse so "it opened its own" is unmistakable.
    cables.insertBefore(path, cables.firstChild) // BEHIND the real cables.
    travel(path, true, () => {
      if (motionPreference.matches || !path.isConnected) { path.remove(); return }
      const animation = path.animate([{ opacity: getComputedStyle(path).opacity }, { opacity: 0 }], {
        duration: duration('--au-m-slow'),
        easing: getComputedStyle(root).getPropertyValue('--au-e-std').trim() || 'linear',
        fill: 'forwards',
      })
      fades.add(animation)
      const finish = (): void => { fades.delete(animation); path.remove() }
      void animation.finished.then(finish, finish)
    })
  }

  // --- wire mutations (all through host.compositionEdit) ----------------------------------------------
  // Adding a target UNIONs onto the existing (source, intent) wire (widen); mode is preserved.
  const addTarget = (source: string, intent: string, target: string): void => {
    if (source === target) return // a self-cable on one intent is degenerate; disallow in the UI.
    const existing = edit.wires().find((w) => w.source === source && w.intent === intent)
    const targets = existing ? [...new Set([...existing.targets, target])] : [target]
    void edit.setWire({ source, intent, targets, mode: existing?.mode ?? 'strict' })
  }
  // Removing a cable drops that target; the last target removes the whole wire.
  const removeCable = (w: CompositionWire, target: string): void => {
    const rest = w.targets.filter((t) => t !== target)
    if (rest.length === 0) void edit.removeWire(w.source, w.intent)
    else void edit.setWire({ source: w.source, intent: w.intent, targets: rest, mode: w.mode ?? 'strict' })
  }

  // --- node drag --------------------------------------------------------------------------------------
  const beginNodeDrag = (e: PointerEvent, id: string): void => {
    e.preventDefault()
    const pos = positions.get(id)!
    const p = canvasPoint(e.clientX, e.clientY)
    drag = { kind: 'node', id, grab: { x: p.x - pos.x, y: p.y - pos.y } }
    canvas.querySelector(`.au-sb-node[data-node="${id}"]`)?.classList.add('dragging')
  }

  // --- cable drag (draw a new wire) -------------------------------------------------------------------
  let preview: SVGPathElement | null = null
  const beginCableDrag = (e: PointerEvent, source: string, intent: string): void => {
    e.preventDefault()
    e.stopPropagation()
    drag = { kind: 'cable', source, intent }
    preview = document.createElementNS(svgNS, 'path')
    preview.setAttribute('class', 'preview')
    cables.appendChild(preview)
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!drag) return
    const p = canvasPoint(e.clientX, e.clientY)
    if (drag.kind === 'node') {
      moved.add(drag.id)
      positions.set(drag.id, { x: p.x - drag.grab.x, y: p.y - drag.grab.y })
      const el = canvas.querySelector<HTMLElement>(`.au-sb-node[data-node="${drag.id}"]`)
      if (el) {
        const pos = positions.get(drag.id)!
        el.style.left = `${pos.x}px`
        el.style.top = `${pos.y}px`
      }
      redrawCablesOnly()
    } else {
      const srcDot = dots.get(dotKey(drag.source, drag.intent, 'out'))
      if (srcDot && preview) preview.setAttribute('d', cablePath(dotCenter(srcDot), p))
      highlightDropTargets(drag.intent, e)
    }
  }

  const onPointerUp = (e: PointerEvent): void => {
    if (!drag) return
    if (drag.kind === 'cable') {
      const port = (e.target as HTMLElement | null)?.closest<HTMLElement>('.au-sb-port.in')
      if (port && port.dataset.intent === drag.intent && port.dataset.node) {
        addTarget(drag.source, drag.intent, port.dataset.node)
      }
      preview?.remove()
      preview = null
      clearDropHighlights()
    } else {
      canvas.querySelector(`.au-sb-node[data-node="${drag.id}"]`)?.classList.remove('dragging')
    }
    drag = null
  }

  // Redraw cables in place during a node drag (positions changed) without a full node rebuild.
  const redrawCablesOnly = (): void => {
    const nodes = edit.nodes()
    drawCables(edit.wires(), new Map(nodes.map((n) => [n.id, n])))
  }

  const highlightDropTargets = (intent: string, e: PointerEvent): void => {
    clearDropHighlights()
    const port = (e.target as HTMLElement | null)?.closest<HTMLElement>('.au-sb-port.in')
    if (port && port.dataset.intent === intent) port.classList.add('drop-ok')
  }
  const clearDropHighlights = (): void => {
    for (const el of [...canvas.querySelectorAll('.drop-ok')]) el.classList.remove('drop-ok')
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  const unsubscribe = edit.subscribe(render)
  const unsubscribeFlow = edit.onDispatch(pulse) // live intent-flow animation on the cables.
  // Docstrings: load now, and reload once the engine is ready (a cold start may not have them yet).
  void loadDocs()
  const offReady = host.engineReady?.subscribe((ready) => {
    if (ready) void loadDocs()
  })
  render()

  return () => {
    motionPreference.removeEventListener('change', onMotionPreference)
    clearMotion()
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    unsubscribe()
    unsubscribeFlow()
    offReady?.()
    root.remove()
    tip.remove()
    disposeStyles?.()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
