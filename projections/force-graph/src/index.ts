// Force-directed workspace graph over engine file links and type relationships.
// The projection owns presentation and pointer interaction; the host owns opening and previews.

import { defineProjection, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk'
import { fileSelection, isFileSelection, type Selection } from '@arsumbris/selection'
import { openIntent } from '@arsumbris/intent'
import { makeHoverContent } from '@arsumbris/preview-content'
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import {
  EngineGraphSource,
  configToScope,
  type GraphSource,
  type GraphSnapshot,
  type GraphView,
  type SubgraphScope,
} from './graph-source'
import { pickNode, reserveLabel, frameEase, paletteIndex, hoverEdgeAlpha, type LabelRect } from './interaction'
import { createNodeMaterials } from './node-material'
import { clippedEdge } from './edge-geometry'
import type { ForceGraph } from './generated'

// A vanilla-created `<au-checkbox>`, typed STRUCTURALLY — set-independent (names no set impl class, only
// the property shape the `au-checkbox` contract guarantees). Emits `au-change {checked}`.
type AuCheckboxEl = HTMLElement & { checked: boolean; indeterminate: boolean; disabled: boolean }

interface GNode extends SimulationNodeDatum {
  id: string // absolute file path — the node identity and the open-intent target
  deg: number // undirected degree, drives the node radius
  foc: number // eased 0→1: how strongly this node sits in the hovered neighbourhood
  repo: string | null // owning member — colorBy:'repo'
  kind: string | null // filetype (note / instance / type-def / asset) — colorBy:'kind', filetype filter
  pinned: boolean // fx/fy held — the node stays where it was dropped until unpinned
}

interface GLink extends SimulationLinkDatum<GNode> {
  lane: number
  source: string | GNode
  target: string | GNode
  kind?: string // reference kind (field / contributing / navigational) — edgeColorBy:'kind'
}

// --- the tunable FEEL (configuration-driven parameters) ------------------
export interface GraphParams {
  ease: number // hover neighbourhood ease, per-frame approach (0.03 slow … 0.3 instant)
  dimDepth: number // how far out-of-focus recedes on hover (0 none … 0.9 near-black)
  nodeScale: number // node radius multiplier (0.5 … 2)
  charge: number // repulsion strength (−120 loose … −10 tight)
  linkDistance: number // rest length of an edge (10 … 120)
  linkStrength: number // edge stiffness (0 … 1)
  labels: 'off' | 'hover' | 'zoom' | 'always'
  colorBy: 'none' | 'repo' | 'kind' // node fill: one ink, a hue per member, or a hue per filetype
  sizeBy: 'degree' | 'uniform' // node radius grows with connectivity, or every node the same
  showOrphans: boolean // draw the isolated degree-0 files, or hide them
  highlightOpen: boolean
  openLabelOpacity: number
  adjacentLabelOpacity: number
  edgeOpacity: number
  selectionZoom: number
  panToSelection: boolean
  pulseSelection: boolean
  edgeColorBy: 'uniform' | 'kind' // one faint line, or a hue per reference kind
}
export const DEFAULT_PARAMS: GraphParams = {
  ease: 0.12, // approach at a 60Hz reference rate; elapsed time keeps motion display-independent
  dimDepth: 0.5,
  nodeScale: 1,
  charge: -60,
  linkDistance: 40,
  linkStrength: 0.15,
  labels: 'hover',
  colorBy: 'kind',
  sizeBy: 'degree',
  showOrphans: true,
  edgeColorBy: 'uniform',
  highlightOpen: true,
  openLabelOpacity: 1,
  adjacentLabelOpacity: 0,
  edgeOpacity: 1,
  selectionZoom: 0.7,
  panToSelection: true,
  pulseSelection: true,
}
export function paramsFromConfig(cfg?: ForceGraph): GraphParams {
  return {
    highlightOpen: cfg?.highlightOpen ?? DEFAULT_PARAMS.highlightOpen,
    openLabelOpacity: cfg?.openLabelOpacity ?? DEFAULT_PARAMS.openLabelOpacity,
    adjacentLabelOpacity: cfg?.adjacentLabelOpacity ?? DEFAULT_PARAMS.adjacentLabelOpacity,
    edgeOpacity: cfg?.edgeOpacity ?? DEFAULT_PARAMS.edgeOpacity,
    selectionZoom: cfg?.selectionZoom ?? DEFAULT_PARAMS.selectionZoom,
    panToSelection: cfg?.panToSelection ?? DEFAULT_PARAMS.panToSelection,
    pulseSelection: cfg?.pulseSelection ?? DEFAULT_PARAMS.pulseSelection,
    ease: cfg?.ease ?? DEFAULT_PARAMS.ease,
    dimDepth: cfg?.dimDepth ?? DEFAULT_PARAMS.dimDepth,
    nodeScale: cfg?.nodeScale ?? DEFAULT_PARAMS.nodeScale,
    charge: cfg?.charge ?? DEFAULT_PARAMS.charge,
    linkDistance: cfg?.linkDistance ?? DEFAULT_PARAMS.linkDistance,
    linkStrength: cfg?.linkStrength ?? DEFAULT_PARAMS.linkStrength,
    labels: cfg?.labels ?? DEFAULT_PARAMS.labels,
    colorBy: cfg?.colorBy ?? DEFAULT_PARAMS.colorBy,
    sizeBy: cfg?.sizeBy ?? DEFAULT_PARAMS.sizeBy,
    showOrphans: cfg?.showOrphans ?? DEFAULT_PARAMS.showOrphans,
    edgeColorBy: cfg?.edgeColorBy ?? DEFAULT_PARAMS.edgeColorBy,
  }
}

/** Which appearance params persist to the composition config (the authored default), written back
 *  when the in-pane controls change. The FEEL params (charge/ease/…) stay configuration-driven. */
export type GraphConfigPatch = Partial<Pick<ForceGraph, 'colorBy' | 'sizeBy' | 'showOrphans' | 'edgeColorBy' | 'labels' | 'charge' | 'linkDistance' | 'nodeScale' | 'highlightOpen' | 'panToSelection' | 'pulseSelection' | 'selectionZoom' | 'edgeOpacity' | 'openLabelOpacity' | 'adjacentLabelOpacity'>>

// Canvas consumes resolved categorical roles; repository ordering and kind identities own assignment.
const REPO_TOKENS = Array.from({ length: 8 }, (_, i) => `--au-graph-repo-${i + 1}`)
const KIND_TOKENS: Record<string, string> = {
  note: '--au-graph-kind-note',
  instance: '--au-graph-kind-instance',
  'type-def': '--au-graph-kind-type-def',
  asset: '--au-graph-kind-asset',
}
const EDGE_KIND_TOKENS: Record<string, string> = {
  field: '--au-graph-edge-field',
  contributing: '--au-graph-edge-contributing',
  navigational: '--au-graph-edge-navigational',
  subtype: '--au-graph-edge-subtype',
  'field-type': '--au-graph-edge-field-type',
  'instance-of': '--au-graph-edge-instance-of',
}

// The in-pane controls overlay. Token-styled (force-graph is vanilla — no `.au-*` lane), with hex
// fallbacks so it reads even before the tokens resolve. Scoped under `.fg-ctl`.
const FG_CONTROLS_CSS = `
/* Fade the drawing only; controls and focus treatment remain opaque. */
.fg-canvas { outline:none; border-radius:var(--au-radius-row); mask-image:linear-gradient(to right,transparent,#000 var(--au-scroll-fade-size,var(--au-space-2)),#000 calc(100% - var(--au-scroll-fade-size,var(--au-space-2))),transparent),linear-gradient(to bottom,transparent,#000 var(--au-scroll-fade-size,var(--au-space-2)),#000 calc(100% - var(--au-scroll-fade-size,var(--au-space-2))),transparent); mask-composite:intersect; }
@media (forced-colors:active) { .fg-canvas { outline:none; border-radius:var(--au-radius-row); mask-image:none; } }
.fg-canvas:focus-visible { outline:1px solid var(--au-focus-outer); outline-offset:-1px; }
.fg-ctl { position:absolute; inset:var(--au-space-2) var(--au-space-2) auto auto; z-index:2; max-width:calc(100% - var(--au-space-2) * 2); font:var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); color:var(--au-ink-2); }
.fg-tools { display:flex; align-items:center; justify-content:flex-end; gap:var(--au-space-1); }
 .fg-tools { opacity:0; transition:opacity var(--au-m-fast) var(--au-e-std); }
.fg-canvas:hover + .fg-ctl .fg-tools, .fg-ctl:hover .fg-tools, .fg-ctl:focus-within .fg-tools, .fg-ctl:has([aria-expanded="true"]) .fg-tools { opacity:1; }
@media (hover:none) { .fg-tools { opacity:1; } }
@media (prefers-reduced-motion:reduce) { .fg-tools { transition:none; } }
.fg-ctl-body { margin-top:var(--au-space-1-5); box-sizing:border-box; width:300px; max-width:100%; max-height:max(80px,calc(var(--fg-height,600px) - 64px)); border-radius:var(--au-radius-panel); border:1px solid var(--au-line-2); background:var(--au-elev-3-fill); box-shadow:var(--au-sh-pop); }
.fg-ctl-body[hidden] { display:none; }
.fg-ctl-content { padding:var(--au-space-4); display:flex; flex-direction:column; gap:var(--au-space-4); }
.fg-ctl-heading { color:var(--au-ink-1); font-weight:var(--au-w-strong); }
.fg-ctl-section { display:flex; flex-direction:column; gap:var(--au-space-3); }
.fg-ctl-section + .fg-ctl-section { border-top:1px solid var(--au-line-1); padding-top:var(--au-space-4); }
.fg-ctl-row { display:flex; flex-direction:column; gap:var(--au-space-1-5); min-width:0; }
.fg-ctl-label { color:var(--au-ink-2); }
.fg-ctl au-segmented-control { display:block; min-width:0; }
.fg-check { display:flex; align-items:center; gap:var(--au-space-2); min-height:var(--au-row-h-dense); cursor:pointer; }
.fg-check span { flex:1; }
.fg-check small { color:var(--au-ink-3); font:inherit; font-variant-numeric:tabular-nums; }
.fg-ctl-kinds { display:flex; flex-direction:column; gap:var(--au-space-1); }
.fg-ctl-legend { display:flex; flex-wrap:wrap; gap:var(--au-space-2) var(--au-space-3); }
.fg-ctl-legend:empty { display:none; }
.fg-legend-item { display:flex; align-items:center; gap:var(--au-space-1-5); min-width:0; }
.fg-legend-item span:last-child { overflow-wrap:anywhere; }
.fg-edge-sw { width:16px; height:2px; flex:none; }
.fg-legend-sw { width:8px; height:8px; border-radius:50%; flex:none; }
.fg-ctl-hint { color:var(--au-ink-3); font-size:var(--au-t-2xs); line-height:var(--au-lh-xs); }
.fg-slider { display:grid; grid-template-columns:1fr auto; gap:var(--au-space-1-5); }
.fg-slider au-slider { grid-column:1/-1; width:100%; }
.fg-summary { color:var(--au-ink-2); font:var(--au-t-2xs)/var(--au-lh-xs) var(--au-font-sans); }
.fg-summary .fg-ctl-legend { margin-top:var(--au-space-1); }
.fg-summary strong { color:var(--au-ink-1); font-weight:var(--au-w-strong); }
.fg-summary-detail { color:var(--au-ink-3); overflow-wrap:anywhere; }
.fg-find-results { display:block; max-height:240px; }
.fg-find-row { padding-block:var(--au-space-2); min-width:0; }
.fg-find-row + .fg-find-row { border-top:1px solid var(--au-line-1); }
.fg-find-row au-button { max-width:100%; }
.fg-find-row au-button::part(label) { overflow:hidden; text-overflow:ellipsis; }
.fg-find-row .fg-ctl-hint { overflow-wrap:anywhere; }
@media (forced-colors:active) { .fg-canvas:focus-visible,.fg-ctl button:focus-visible { outline-color:Highlight; } }
`

export interface RunGraphOpts {
  source: GraphSource
  params: GraphParams // held by reference — `update()` mutates it in place
  scope?: SubgraphScope
  onOpen?: (path: string) => void
  selection?: MountHost['selection'] | null
  viewState?: MountHost['viewState'] | null
  preview?: MountHost['preview'] | null
  engine?: MountHost['engine'] // only for the ⌘-hover preview content builder
  /** The host's scoped-CSS injection for the in-pane controls chrome. `mount` wires it to
   *  `host.styles`; a standalone renderer passes none, so the controls render unstyled there. */
  styles?: MountHost['styles'] | null
  /** Persist an appearance choice (colorBy / orphans / …) to the composition config. The in-pane
   *  controls call it; `mount` wires it to `host.saveConfig`. Absent = session-only. */
  onConfigChange?: (patch: GraphConfigPatch) => void
}
export interface GraphControl {
  teardown(): void
  update(p: Partial<GraphParams>): void
}

const TAU = Math.PI * 2
const NODE_ALPHA = 0.95
const MIN_SCALE = 0.05
const MAX_SCALE = 8
const CLICK_SLOP = 3
const FIT_PAD = 48

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function baseName(path: string): string {
  const seg = path.split('/').pop() ?? path
  return seg.endsWith('.md') ? seg.slice(0, -3) : seg
}

/** The render + interaction core. Host-agnostic: data comes from `opts.source`, feel from
 *  `opts.params`. Returns a live handle so callers can tune params without remounting. */
export function runGraph(container: HTMLElement, opts: RunGraphOpts): GraphControl {
  const params = opts.params
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute' // out of flow, so the container's height is host-given, not driven by the canvas's own size
  canvas.style.inset = '0'
  canvas.style.width = '100%' // a <canvas> is a REPLACED element — inset:0 alone won't stretch it; it needs explicit size
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  canvas.style.cursor = 'default'
  canvas.style.touchAction = 'none'
  canvas.className = 'fg-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('aria-label', 'File graph. Drag to pan; pinch or use plus and minus to zoom. Press zero to fit.')
  container.style.position = 'relative' // anchor the absolute-filling canvas; the pane gives the container its box
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  const nodeMaterials = createNodeMaterials()

  let alive = true

  const token = (name: string, fallback: string): string => getComputedStyle(container).getPropertyValue(name).trim() || fallback
  // Canvas can't read var(), so each colour is the RESOLVED token via getComputedStyle; the hex is a
  // dead fallback (the tokens are @property-registered, so they always resolve). Fallbacks mirror the
  // current warm-mono token values so an unresolved token degrades in-palette, not to a stale hue.
  const colors = (): [string, string, string, string] => [
    token('--au-elev-3-fill', '#15130f'),
    token('--au-ink-2', token('--au-color-text', '#d9d6cd')),
    token('--au-line-2', 'rgba(245, 243, 238, 0.09)'),
    token('--au-ink-1', '#f5f3ee'),
  ]
  let [bgColor, nodeColor, edgeColor, accentColor] = colors()
  const resolveRoles = (roles: Record<string, string>, fallback: string): Record<string, string> =>
    Object.fromEntries(Object.entries(roles).map(([kind, name]) => [kind, token(name, fallback)]))
  let repoPalette = REPO_TOKENS.map(name => token(name, nodeColor))
  let kindColors = resolveRoles(KIND_TOKENS, nodeColor)
  let edgeKindColors = resolveRoles(EDGE_KIND_TOKENS, edgeColor)
  canvas.style.font = 'var(--au-w-body) var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-sans)'
  let presentationSignature = ''
  function readPresentation(): boolean {
    const signature = [...colors(), ...REPO_TOKENS.map(name => token(name, nodeColor)), ...Object.values(KIND_TOKENS).map(name => token(name, nodeColor)), ...Object.values(EDGE_KIND_TOKENS).map(name => token(name, edgeColor))].join('|')
    if (signature === presentationSignature) return false
    presentationSignature = signature
    nodeMaterials.clear()
    ;[bgColor, nodeColor, edgeColor, accentColor] = colors()
    repoPalette = REPO_TOKENS.map(name => token(name, nodeColor))
    kindColors = resolveRoles(KIND_TOKENS, nodeColor)
    edgeKindColors = resolveRoles(EDGE_KIND_TOKENS, edgeColor)
    recomputeRepoColors(lastSnap)
    return true
  }
  function refreshPresentation(): void {
    if (readPresentation()) syncControls?.()
    scheduleDraw()
  }
  canvas.style.background = 'transparent' // let the PaneFrame card surface + its inset ring show through; opaque --au-color-bg here erased the card outline

  let cssW = Math.max(1, container.clientWidth)
  let cssH = Math.max(1, container.clientHeight)
  let dpr = window.devicePixelRatio || 1

  let scale = 1
  let tx = 0
  let ty = 0
  let userInteracted = false
  let hasFitted = false
  const positions = new Map<string, GNode>()
  let fitAnimation: Animation | null = null
  const fitProgress = document.createElement('div')
  let fitFrom: { scale: number; tx: number; ty: number } | null = null
  let fitTarget: { scale: number; tx: number; ty: number } | null = null

  let nodes: GNode[] = []
  let links: GLink[] = []
  let neighbors = new Map<string, Set<string>>()
  let sim: Simulation<GNode, GLink> | null = null
  let hovered: GNode | null = null
  let hoverActive = 0

  let selectedId: string | null = null
  const openByPub = new Map<string, string>()
  let openIds = new Set<string>()

  // The raw seam snapshot, kept so a filter toggle (orphans / filetype) re-derives the DISPLAY
  // without re-reading the engine. `hiddenKinds` is the runtime filetype filter (session-scoped
  // exploration, not authored config). `repoColors` maps a member → a palette hue (colorBy:'repo').
  let lastSnap: GraphSnapshot = { nodes: [], edges: [] }
  const hiddenKinds = new Set<string>()
  const repoColors = new Map<string, string>()
  // Set by the in-pane controls; `rebuildDisplay` calls it to refresh their active-state + legend.
  let syncControls: (() => void) | null = null
  let syncIdentity: (() => void) | null = null

  /** Identity-based palette assignment survives unrelated repository additions. */
  function recomputeRepoColors(src: GraphSnapshot): void {
    repoColors.clear()
    const repos = [...new Set(src.nodes.map((n) => n.repo ?? '∅'))].sort()
    repos.forEach((r) => {
      repoColors.set(r, repoPalette[paletteIndex(r, repoPalette.length)]!)
    })
  }
  /** The fill for a node under the active `colorBy` — else the plain ink. */
  function nodeFillFor(n: GNode): string {
    if (params.colorBy === 'repo') return repoColors.get(n.repo ?? '∅') ?? nodeColor
    if (params.colorBy === 'kind') return (n.kind && kindColors[n.kind]) || nodeColor
    return nodeColor
  }
  /** The distinct (label, colour) legend entries for the active `colorBy`, or [] when none. */
  function legendEntries(): { label: string; color: string }[] {
    if (params.colorBy === 'repo') return [...repoColors].map(([r, c]) => ({ label: r === '∅' ? '(no repo)' : r, color: c }))
    if (params.colorBy === 'kind') {
      const present = new Set(nodes.map((n) => n.kind).filter(Boolean) as string[])
      return [...present].sort().map((k) => ({ label: k, color: kindColors[k] ?? nodeColor }))
    }
    return []
  }

  const nodeRadius = (n: GNode): number =>
    params.sizeBy === 'uniform' ? 4 * params.nodeScale : (3 + Math.sqrt(n.deg) * 1.4) * params.nodeScale

  function sizeCanvas(): void {
    cssW = Math.max(1, container.clientWidth)
    cssH = Math.max(1, container.clientHeight)
    dpr = window.devicePixelRatio || 1
    container.style.setProperty('--fg-height', `${cssH}px`)
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
  }

  function toWorld(p: { x: number; y: number }): { x: number; y: number } {
    return { x: (p.x - tx) / scale, y: (p.y - ty) / scale }
  }

  function cancelFit(): void {
    fitAnimation?.cancel()
    fitAnimation = null
    fitFrom = fitTarget = null
  }

  function fitToView(animate = false): void {
    if (animate) dismissGraphPreview()
    cancelFit()
    const from = { scale, tx, ty }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let any = false
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue
      any = true
      const r = nodeRadius(n)
      if (n.x - r < minX) minX = n.x - r
      if (n.x + r > maxX) maxX = n.x + r
      if (n.y - r < minY) minY = n.y - r
      if (n.y + r > maxY) maxY = n.y + r
    }
    if (!any) return
    const bw = Math.max(1, maxX - minX)
    const bh = Math.max(1, maxY - minY)
    const s = Math.min((cssW - FIT_PAD * 2) / bw, (cssH - FIT_PAD * 2) / bh)
    scale = clamp(s, MIN_SCALE, MAX_SCALE)
    tx = cssW / 2 - ((minX + maxX) / 2) * scale
    ty = cssH / 2 - ((minY + maxY) / 2) * scale
    if (animate && !reduced) {
      fitFrom = from
      fitTarget = { scale, tx, ty }
      ;({ scale, tx, ty } = from)
      const time = token('--au-m-slow', '420ms')
      const duration = parseFloat(time) * (time.endsWith('ms') ? 1 : 1000)
      fitAnimation = fitProgress.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: token('--au-e-soft', 'ease-out'), fill: 'both' })
      scheduleDraw()
    }
  }

  // REDUCED MOTION (live). Two things here are the large-travel motion the OS preference exists to
  // suppress and the pane offers no other way to stop: the node cloud flying in from a random scatter
  // under alpha decay, and the multi-frame hover ease. Mirrors usePrefersReducedMotion (file-tree-kit).
  const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)')
  let reduced = motionMq.matches
  const onMotionChange = (): void => {
    reduced = motionMq.matches
    if (reduced) {
      if (fitTarget) ({ scale, tx, ty } = fitTarget)
      cancelFit()
      settleNow()
    }
    scheduleDraw()
  }
  motionMq.addEventListener('change', onMotionChange)

  let pulseUntil = 0
  let pulseStarted = 0
  let pulseNode: string | null = null
  let pulseAmount = 0
  function emphasizeSelection(id: string): void {
    const node = nodes.find(n => n.id === id)
    if (!node || node.x == null || node.y == null) return
    if (params.pulseSelection && !reduced) {
      pulseNode = id
      pulseStarted = performance.now()
      const time = token('--au-m-slow', '420ms')
      pulseUntil = pulseStarted + parseFloat(time) * (time.endsWith('ms') ? 1 : 1000) * 2
    }
    if (params.panToSelection && mode === 'idle') {
      cancelFit()
      userInteracted = true
      const targetScale = clamp(params.selectionZoom, MIN_SCALE, MAX_SCALE)
      const target = { scale: targetScale, tx: cssW / 2 - node.x * targetScale, ty: cssH / 2 - node.y * targetScale }
      if (reduced) ({ scale, tx, ty } = target)
      else {
        fitFrom = { scale, tx, ty }; fitTarget = target
        const time = token('--au-m-slow', '420ms')
        fitAnimation = fitProgress.animate([{ opacity: 0 }, { opacity: 1 }], { duration: parseFloat(time) * (time.endsWith('ms') ? 1 : 1000), easing: token('--au-e-soft', 'ease-out'), fill: 'both' })
      }
    }
    scheduleDraw()
  }

  let frame = 0
  let lastDrawAt = 0
  function scheduleDraw(): void {
    if (frame || !alive) return
    frame = requestAnimationFrame((now) => {
      frame = 0
      const elapsed = lastDrawAt ? Math.min(64, now - lastDrawAt) : 1000 / 60
      lastDrawAt = now
      if (fitAnimation && fitFrom && fitTarget) {
        const progress = fitAnimation.effect?.getComputedTiming().progress ?? 1
        scale = fitFrom.scale + (fitTarget.scale - fitFrom.scale) * progress
        tx = fitFrom.tx + (fitTarget.tx - fitFrom.tx) * progress
        ty = fitFrom.ty + (fitTarget.ty - fitFrom.ty) * progress
        if (fitAnimation.playState === 'finished') cancelFit()
      }
      if (!userInteracted && !hasFitted && mode === 'idle') {
        fitToView()
        if (sim && sim.alpha() < 0.1) hasFitted = true
      }
      const eps = 0.004
      const ease = reduced ? 1 : frameEase(params.ease, elapsed) // an ease of 1 lands the neighbourhood in ONE frame
      const hid = hovered?.id ?? null
      const fset = hid ? neighbors.get(hid) : null
      const haTarget = hovered ? 1 : 0
      let easing = false
      if (Math.abs(hoverActive - haTarget) > eps) {
        hoverActive += (haTarget - hoverActive) * ease
        easing = true
      } else hoverActive = haTarget
      for (const n of nodes) {
        const t = hid && (n.id === hid || (fset?.has(n.id) ?? false)) ? 1 : 0
        if (Math.abs(n.foc - t) > eps) {
          n.foc += (t - n.foc) * ease
          easing = true
        } else n.foc = t
      }
      const pulsing = !reduced && params.pulseSelection && now < pulseUntil
      const pulseProgress = pulsing ? (now - pulseStarted) / (pulseUntil - pulseStarted) : 1
      // A quick, smooth rise followed by a longer settle; both ends have zero velocity.
      const phase = pulseProgress < .3 ? pulseProgress / .3 : (1 - pulseProgress) / .7
      pulseAmount = pulsing ? phase * phase * (3 - 2 * phase) : 0
      draw()
      if ((easing || fitAnimation || pulsing) && alive) scheduleDraw()
    })
  }
  function draw(): void {
    if (!ctx) return
    if (readPresentation()) syncControls?.()
    if (previewAnchor && shownKey && preview?.isShowing(shownKey)) {
      const node = nodes.find(n => n.id === previewAnchor?.id)
      if (!node || Math.hypot((node.x ?? 0)-previewAnchor.x,(node.y ?? 0)-previewAnchor.y)*scale > 12) dismissGraphPreview()
    }
    syncIdentity?.()
    const hid = hovered?.id ?? null

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, tx * dpr, ty * dpr)

    const traceEdge = (edge: GLink): void => {
      const source = edge.source as GNode, target = edge.target as GNode
      if (source.x == null || source.y == null || target.x == null || target.y == null) return
      if (source.id === target.id) {
        const r = nodeRadius(source)
        ctx.moveTo(source.x-r*.7,source.y-r*.7)
        ctx.bezierCurveTo(source.x-r*3,source.y-r*4,source.x+r*3,source.y-r*4,source.x+r*.7,source.y-r*.7)
        return
      }
      const distance = Math.hypot(target.x-source.x,target.y-source.y)
      const bend = Math.sign(edge.lane) * Math.min(Math.abs(edge.lane)*8/scale,distance*.18)
      const geometry = clippedEdge({x:source.x,y:source.y},{x:target.x,y:target.y},nodeRadius(source)+.6/scale,nodeRadius(target)+.6/scale,bend)
      if (!geometry) return
      ctx.moveTo(geometry.start.x,geometry.start.y)
      ctx.quadraticCurveTo(geometry.control.x,geometry.control.y,geometry.end.x,geometry.end.y)
    }
    ctx.lineCap = 'round'
    ctx.lineWidth = .8 / scale
    ctx.globalAlpha = clamp(params.edgeOpacity, 0, 1) * (1 - hoverActive * (0.4 + params.dimDepth * 0.5))
    if (params.edgeColorBy === 'kind') {
      for (const edge of links) {
        ctx.strokeStyle = (edge.kind && edgeKindColors[edge.kind]) || edgeColor
        ctx.beginPath()
        traceEdge(edge)
        ctx.stroke()
      }
    } else {
      ctx.strokeStyle = edgeColor
      ctx.beginPath()
      for (const edge of links) traceEdge(edge)
      ctx.stroke()
    }
    if (hid && hoverActive > 0.01) {
      const hf = hovered?.foc ?? 0
      const connectedCount = links.reduce((count, edge) => count + Number((edge.source as GNode).id === hid || (edge.target as GNode).id === hid), 0)
      ctx.strokeStyle = nodeColor
      ctx.lineWidth = .85 / scale
      ctx.globalAlpha = hoverEdgeAlpha(connectedCount) * hf
      ctx.beginPath()
      for (const l of links) {
        const s = l.source as GNode
        const t = l.target as GNode
        if (s.x == null || s.y == null || t.x == null || t.y == null) continue
        if (s.id === hid || t.id === hid) {
          traceEdge(l)
        }
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    for (const n of nodes) {
      if (n.x == null || n.y == null) continue
      const isOpen = params.highlightOpen && openIds.has(n.id)
      const isSel = n.id === selectedId
      const foc = n.foc
      const dim = hoverActive * (1 - foc) * params.dimDepth
      const pulse = n.id === pulseNode ? pulseAmount : 0
      const r = nodeRadius(n) * (isSel ? 1.3 : isOpen ? 1.12 : 1) * (1 + pulse * .12)

      ctx.globalAlpha = 1
      ctx.fillStyle = bgColor
      ctx.beginPath()
      ctx.arc(n.x, n.y, r, 0, TAU)
      ctx.fill()

      if (isSel || pulse > 0) {
        const haloRadius = r + 7 / scale
        const halo = ctx.createRadialGradient(n.x, n.y, r * .65, n.x, n.y, haloRadius)
        halo.addColorStop(0, accentColor)
        halo.addColorStop(1, 'transparent')
        ctx.fillStyle = halo
        ctx.globalAlpha = ((isSel ? .38 : .22) + pulse * .25) * (1 - dim * .35)
        ctx.beginPath()
        ctx.arc(n.x, n.y, haloRadius, 0, TAU)
        ctx.fill()
      }

      const color = nodeFillFor(n)
      ctx.globalAlpha = (isOpen || isSel ? 1 : NODE_ALPHA) * (1 - dim * (isOpen || isSel ? .35 : 1))
      if (r * scale < 2.5) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, TAU)
        ctx.fill()
      } else {
        ctx.drawImage(nodeMaterials.get(color), n.x-r, n.y-r, r*2, r*2)
        ctx.beginPath()
        ctx.arc(n.x,n.y,r-.35/scale,0,TAU)
        ctx.strokeStyle = accentColor
        ctx.lineWidth = .65/scale
        ctx.globalAlpha = (.14 + (n.id === hid ? .18*foc : 0)) * (1-dim)
        ctx.stroke()
      }
      if (n.id === hid) {
        ctx.beginPath()
        ctx.arc(n.x,n.y,r+2/scale,0,TAU)
        ctx.strokeStyle = accentColor
        ctx.lineWidth = .8/scale
        ctx.globalAlpha = .65*foc
        ctx.stroke()
      }

      // PIN marker: a small dot above a pinned node — visible regardless of the node's own colour.
      if (n.pinned) {
        ctx.globalAlpha = 0.9 * (1 - dim * 0.5)
        ctx.fillStyle = accentColor
        ctx.beginPath()
        ctx.arc(n.x, n.y - r - 2.5 / scale, 2 / scale, 0, TAU)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    if (params.labels !== 'off') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const labelStyle = getComputedStyle(canvas)
      ctx.font = `${labelStyle.fontWeight} ${labelStyle.fontSize} ${labelStyle.fontFamily}`
      const labelHeight = Math.max(parseFloat(labelStyle.fontSize), parseFloat(labelStyle.lineHeight) || 0)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const lod = params.labels === 'always' ? 1 : clamp((scale - 0.18) / 0.55, 0, 1)
      const occupied: LabelRect[] = []
      const nearbyLabels = new Set(hovered ? nodes.filter(n => neighbors.get(hovered!.id)?.has(n.id))
        .sort((a,b) => Math.hypot((a.x ?? 0)-(hovered!.x ?? 0),(a.y ?? 0)-(hovered!.y ?? 0)) - Math.hypot((b.x ?? 0)-(hovered!.x ?? 0),(b.y ?? 0)-(hovered!.y ?? 0)) || a.id.localeCompare(b.id))
        .slice(0,6).map(n => n.id) : [])
      const priority = (n: GNode): number => n.id === hid ? 1e9 : n.id === selectedId ? 1e8 : openIds.has(n.id) ? 1e7 : (nearbyLabels.has(n.id) ? 1e5 : 0) + n.deg
      const ordered = [...nodes].sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id))
      for (const n of ordered) {
        if (n.x == null || n.y == null) continue
        const isSel = n.id === selectedId
        const foc = n.foc
        const dim = hoverActive * (1 - foc) * params.dimDepth
        let a = params.labels === 'hover' || (params.labels === 'zoom' && scale < 1.2 && n.deg === 0) ? 0 : lod
        a = Math.max(a, n.id === hid ? foc : nearbyLabels.has(n.id) ? foc * clamp(params.adjacentLabelOpacity, 0, 1) : 0)
        if (isSel || openIds.has(n.id)) a = Math.max(a, clamp(params.openLabelOpacity, 0, 1))
        a *= 1 - dim
        if (a < 0.01) continue
        const sx = n.x * scale + tx
        const nodeY = n.y * scale + ty
        const below = nodeY + nodeRadius(n) * scale + 6
        const sy = below + labelHeight > cssH - 12 ? nodeY - nodeRadius(n) * scale - labelHeight - 6 : below
        if (sx < -80 || sx > cssW + 80 || sy < -20 || sy > cssH + 20) continue
        let label = baseName(n.id)
        while (label.length > 2 && ctx.measureText(label).width > Math.min(240, cssW - 24)) label = label.slice(0, -2) + '…'
        const width = ctx.measureText(label).width
        const labelX = clamp(sx, width / 2 + 8, cssW - width / 2 - 8)
        if (!reserveLabel(occupied, { x: labelX - width / 2 - 4, y: sy - 2, width: width + 8, height: labelHeight + 4 })) continue
        if (n.id === hid || isSel) {
          ctx.globalAlpha = a*.94
          ctx.fillStyle = bgColor
          ctx.beginPath()
          ctx.roundRect(labelX-width/2-6,sy-3,width+12,labelHeight+6,4)
          ctx.fill()
        }
        ctx.globalAlpha = a
        ctx.shadowColor = bgColor
        ctx.shadowBlur = 4
        ctx.fillStyle = n.id === hid || isSel ? accentColor : nodeColor
        ctx.fillText(label, labelX, sy)
        ctx.shadowBlur = 0
      }
      ctx.globalAlpha = 1
    }
  }

  // --- sim ------------------------------------------------------------------------------------
  function linkForce(): ReturnType<typeof forceLink<GNode, GLink>> {
    return forceLink<GNode, GLink>(links)
      .id((n) => n.id)
      .distance(params.linkDistance)
      .strength(params.linkStrength)
  }
  function startSim(): void {
    sim?.stop()
    sim = forceSimulation<GNode>(nodes)
      .velocityDecay(0.7)
      .force('charge', forceManyBody<GNode>().strength(params.charge))
      .force('center', forceCenter<GNode>(cssW / 2, cssH / 2))
      .force('collide', forceCollide<GNode>((n) => nodeRadius(n) + 2))
      .on('tick', scheduleDraw)
  }
  /** Re-apply the sim forces after a params change + a gentle reheat. */
  function reapplyForces(): void {
    if (!sim) return
    sim.force('charge', forceManyBody<GNode>().strength(params.charge))
    sim.force('collide', forceCollide<GNode>((n) => nodeRadius(n) + 2))
    if (links.length) sim.force('link', linkForce())
    sim.alpha(0.3).restart()
    if (reduced) settleNow()
  }
  /** REDUCED MOTION: converge the layout in ONE synchronous pass (d3-force's own offline-tick recipe:
   *  `tick()` advances the sim without dispatching, so no rAF storm) instead of animating alpha decay
   *  — the nodes are simply THERE on the next paint rather than flying in. */
  function settleNow(): void {
    if (!sim) return
    sim.stop()
    const steps = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()))
    for (let i = 0; i < steps; i++) sim.tick()
  }

  /** A new whole-graph payload arrived (initial or delta). Keep it raw + re-derive the display. */
  function applySnapshot(snap: GraphSnapshot): void {
    lastSnap = snap
    recomputeRepoColors(snap)
    rebuildDisplay()
  }

  /** Derive the drawn graph from `lastSnap` under the active FILTERS (showOrphans + hiddenKinds) —
   *  a filter toggle re-runs THIS, never a re-read. `deg` stays the FULL-graph degree (a node's
   *  importance), so hiding a filetype doesn't shrink the survivors. */
  function rebuildDisplay(): void {
    dismissGraphPreview()
    for (const n of nodes) positions.set(n.id, n)
    const liveIds = new Set(lastSnap.nodes.map(n => n.id))
    for (const id of positions.keys()) if (!liveIds.has(id)) positions.delete(id)
    const prev = positions
    const visible = lastSnap.nodes.filter((gn) => {
      if (!params.showOrphans && gn.degree === 0) return false
      if (gn.kind != null && hiddenKinds.has(gn.kind)) return false
      return true
    })
    nodes = visible.map((gn) => {
      const p = prev.get(gn.id)
      return {
        id: gn.id,
        deg: gn.degree,
        repo: gn.repo ?? null,
        kind: gn.kind ?? null,
        pinned: p?.pinned ?? false,
        foc: p?.foc ?? 0,
        x: p?.x,
        y: p?.y,
        vx: p?.vx ?? 0,
        vy: p?.vy ?? 0,
        fx: p?.fx ?? null,
        fy: p?.fy ?? null,
      }
    })
    const has = new Set(nodes.map((n) => n.id))
    const nb = new Map<string, Set<string>>()
    const link = (a: string, b: string): void => {
      let s = nb.get(a)
      if (!s) {
        s = new Set()
        nb.set(a, s)
      }
      s.add(b)
    }
    links = []
    for (const e of lastSnap.edges) {
      if (!has.has(e.source) || !has.has(e.target)) continue // drop edges to a filtered-out node
      links.push({ source: e.source, target: e.target, kind: e.kind, lane: 0 })
      link(e.source, e.target)
      link(e.target, e.source)
    }
    const bundles = new Map<string, GLink[]>()
    for (const edge of links) {
      const pair = [String(edge.source), String(edge.target)].sort()
      const key = JSON.stringify(pair)
      const bundle = bundles.get(key) ?? []
      bundle.push(edge)
      bundles.set(key, bundle)
    }
    for (const bundle of bundles.values()) {
      bundle.sort((a,b) => `${a.source}|${a.kind ?? ''}`.localeCompare(`${b.source}|${b.kind ?? ''}`))
      bundle.forEach((edge,index) => { edge.lane = (index-(bundle.length-1)/2) * (String(edge.source) < String(edge.target) ? 1 : -1) })
    }
    hovered = hovered ? nodes.find((n) => n.id === hovered?.id) ?? null : null
    neighbors = nb
    startSim()
    if (links.length) sim?.force('link', linkForce())
    sim?.alpha(hasFitted ? 0.18 : 0.6).restart()
    if (reduced) settleNow()
    syncControls?.()
    scheduleDraw()
  }

  function nodeAt(wx: number, wy: number): GNode | null {
    return pickNode(nodes, wx, wy, scale, nodeRadius)
  }
  function pointerPos(e: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // --- ⌘/Ctrl-hover note preview (optional — only when a preview surface is provided) --------
  const preview = opts.preview ?? null
  const content = preview && opts.engine ? makeHoverContent(opts.engine) : null
  let modHeld = false
  let shortcutHeld = false
  let shownKey: string | null = null
  let previewAnchor: {id:string;x:number;y:number} | null = null
  function dismissGraphPreview(): void {
    if (shownKey && preview?.isShowing(shownKey)) preview.hide()
    shownKey = null
    previewAnchor = null
  }
  let lastClient: { x: number; y: number } | null = null
  function nodeScreenRect(n: GNode): DOMRect {
    const rect = canvas.getBoundingClientRect()
    const sx = (n.x ?? 0) * scale + tx
    const sy = (n.y ?? 0) * scale + ty
    const rad = Math.max(nodeRadius(n) * scale + 3, 10)
    return new DOMRect(rect.left + sx - rad, rect.top + sy - rad, rad * 2, rad * 2)
  }
  function managePreview(clientX: number, clientY: number): void {
    if (!preview || !content || shortcutHeld) return
    if (preview.isOver(clientX, clientY)) return
    const rect = canvas.getBoundingClientRect()
    const w = toWorld({ x: clientX - rect.left, y: clientY - rect.top })
    const node = modHeld ? nodeAt(w.x, w.y) : null
    // The shared surface owns retention through its anchor-to-card safety hull.
    if (!node) return
    const key = `graph:file:${node.id}`
    if (preview.isShowing(key)) return
    // IMMEDIATE — no dwell: ⌘-hover a node and the peek shows at once.
    preview.show(
      key,
      nodeScreenRect(node),
      content.previewPath(node.id),
      (p) => content.previewPath(p),
      (p) => opts.onOpen?.(p),
    )
    shownKey = key
    previewAnchor = {id:node.id,x:node.x ?? 0,y:node.y ?? 0}
  }
  const onModKey = (e: KeyboardEvent): void => {
    const modifier = e.key === 'Meta' || e.key === 'Control'
    if (e.type === 'keydown' && !modifier && (e.metaKey || e.ctrlKey)) {
      shortcutHeld = true
      dismissGraphPreview()
      return
    }
    if (!modifier) return
    modHeld = e.metaKey || e.ctrlKey
    if (!modHeld) {
      shortcutHeld = false
      return
    }
    if (lastClient && !shortcutHeld) managePreview(lastClient.x, lastClient.y)
  }

  // --- interaction --------------------------------------------------------------------------
  let mode: 'idle' | 'pan' | 'drag' = 'idle'
  let dragging: GNode | null = null
  let dragReheated = false
  let dragOrigin: { x?:number; y?:number; fx?:number|null; fy?:number|null; pinned:boolean } | null = null
  let downAt = { x: 0, y: 0 }
  let panLast = { x: 0, y: 0 }
  let moved = false

  /** Pin a node at its current position (hold fx/fy), or release it back to the sim. */
  function setPinned(n: GNode, pinned: boolean): void {
    n.pinned = pinned
    n.fx = pinned ? (n.x ?? null) : null
    n.fy = pinned ? (n.y ?? null) : null
    sim?.alpha(0.2).restart()
    syncControls?.()
    scheduleDraw()
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    cancelFit()
    canvas.focus({ preventScroll: true })
    const p = pointerPos(e)
    downAt = p
    moved = false
    const w = toWorld(p)
    const hit = nodeAt(w.x, w.y)
    if (hit && e.shiftKey) {
      // Shift-click explicitly toggles the pin without opening the file.
      setPinned(hit, !hit.pinned)
      mode = 'idle'
      return
    }
    if (hit) {
      mode = 'drag'
      dragging = hit
      dragReheated = false
      dragOrigin = {x:hit.x,y:hit.y,fx:hit.fx,fy:hit.fy,pinned:hit.pinned}
      hit.fx = hit.x
      hit.fy = hit.y
    } else {
      mode = 'pan'
      panLast = p
    }
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* best-effort */
    }
  }
  const onPointerMove = (e: PointerEvent): void => {
    const p = pointerPos(e)
    lastClient = { x: e.clientX, y: e.clientY }
    modHeld = e.metaKey || e.ctrlKey
    if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > CLICK_SLOP) moved = true
    if (mode === 'drag' && dragging) {
      if (!moved) return
      userInteracted = true
      if (!dragReheated) {
        sim?.alphaTarget(0.15).restart()
        dragReheated = true
      }
      const w = toWorld(p)
      dragging.fx = w.x
      dragging.fy = w.y
      scheduleDraw()
    } else if (mode === 'pan') {
      userInteracted = true
      tx += p.x - panLast.x
      ty += p.y - panLast.y
      panLast = p
      scheduleDraw()
    } else {
      const w = toWorld(p)
      const hit = nodeAt(w.x, w.y)
      canvas.style.cursor = hit ? 'pointer' : 'default'
      if (hit !== hovered) {
        hovered = hit
        scheduleDraw()
      }
      managePreview(e.clientX, e.clientY)
    }
  }
  const onPointerUp = (e: PointerEvent): void => {
    const node = dragging
    const wasClick = e.type !== 'pointercancel' && mode === 'drag' && node != null && !moved
    if (mode === 'drag') {
      if (node) {
        if (e.type === 'pointercancel' && dragOrigin) {
          Object.assign(node, dragOrigin)
        } else if (!node.pinned) {
          node.fx = null // release the pointer hold so the node settles into the force layout
          node.fy = null
        }
      }
      sim?.alphaTarget(0)
      if (dragReheated) sim?.alpha(0.2).restart()
    }
    mode = 'idle'
    dragging = null
    dragOrigin = null
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* no-op */
    }
    syncControls?.()
    scheduleDraw()
    if (wasClick && node) { selectedId = node.id; emphasizeSelection(node.id); opts.onOpen?.(node.id) }
  }
  const onWheel = (e: WheelEvent): void => {
    dismissGraphPreview()
    e.preventDefault()
    cancelFit()
    userInteracted = true
    const p = pointerPos(e)
    const zoomGesture = e.ctrlKey || e.deltaMode !== 0
    if (zoomGesture) {
      const w = toWorld(p)
      const next = clamp(scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.05)), MIN_SCALE, MAX_SCALE)
      tx = p.x - w.x * next
      ty = p.y - w.y * next
      scale = next
    } else {
      tx -= e.deltaX
      ty -= e.deltaY
    }
    scheduleDraw()
  }
  const onCanvasLeave = (): void => {
    lastClient = null
    if (hovered) {
      hovered = null
      scheduleDraw()
    }
    // Pointer transfer and leaving the safety hull are handled by the shared preview surface.
  }

  const onCanvasKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    cancelFit()
    if (e.key === '0' || e.key === '+' || e.key === '=' || e.key === '-' || e.key.startsWith('Arrow')) dismissGraphPreview()
    if (e.key === '0') fitToView(true)
    else if (e.key === '+' || e.key === '=' || e.key === '-') {
      const center = toWorld({ x: cssW / 2, y: cssH / 2 })
      scale = clamp(scale * (e.key === '-' ? 1 / 1.2 : 1.2), MIN_SCALE, MAX_SCALE)
      tx = cssW / 2 - center.x * scale; ty = cssH / 2 - center.y * scale
    } else if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 80 : 30
      if (e.key === 'ArrowLeft') tx += step
      if (e.key === 'ArrowRight') tx -= step
      if (e.key === 'ArrowUp') ty += step
      if (e.key === 'ArrowDown') ty -= step
    } else return
    e.preventDefault(); e.stopPropagation(); userInteracted = true; scheduleDraw()
  }
  canvas.addEventListener('keydown', onCanvasKey)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onCanvasLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onModKey, true)
  window.addEventListener('keyup', onModKey, true)

  const ro = new ResizeObserver(() => {
    if (!alive) return
    dismissGraphPreview()
    sizeCanvas()
    scheduleDraw()
  })
  // Theme attributes cascade through the mounting ancestry, including scoped preview roots.
  const themeObserver = new MutationObserver(refreshPresentation)
  for (let ancestor: Element | null = container; ancestor; ancestor = ancestor.parentElement) {
    themeObserver.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class', 'data-au-theme'] })
  }
  document.fonts.addEventListener('loadingdone', refreshPresentation)
  ro.observe(container)
  sizeCanvas()

  const offSelection = opts.selection?.follow((val) => {
    if (!alive || !val || !isFileSelection(val as Selection)) return
    const next = (val as {path: string}).path
    if (next === selectedId) return
    selectedId = next
    emphasizeSelection(next)
    scheduleDraw()
  })
  const offOpen = opts.viewState?.watchAll('open-file', (pub, val) => {
    if (val == null) openByPub.delete(String(pub))
    else openByPub.set(String(pub), String(val))
    openIds = new Set(openByPub.values())
    if (alive) scheduleDraw()
  })

  // --- in-pane controls overlay --------------------------------------------------------------
  const KIND_ORDER = ['note', 'instance', 'type-def', 'asset']
  function releaseAllPins(): void {
    for (const n of new Set([...nodes, ...positions.values()])) {
      n.pinned = false
      n.fx = null
      n.fy = null
    }
    sim?.alpha(0.3).restart()
    syncControls?.()
    scheduleDraw()
  }
  function buildControls(): () => void {
    const disposeStyles = opts.styles?.inject(FG_CONTROLS_CSS, container)
    const panel = document.createElement('div')
    panel.className = 'fg-ctl'
    const toggle = document.createElement('au-button')
    toggle.className = 'fg-ctl-toggle'
    toggle.setAttribute('aria-label', 'Graph settings')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('variant', 'ghost'); toggle.setAttribute('size', 'sm')
    toggle.title = 'Graph settings'
    const settingsIcon = document.createElement('au-icon')
    settingsIcon.setAttribute('name', 'gear')
    toggle.append(settingsIcon)
    const body = document.createElement('au-scroll-area')
    body.setAttribute('axis', 'y')
    const bodyContent = document.createElement('div')
    bodyContent.className = 'fg-ctl-content'
    body.append(bodyContent)
    body.className = 'fg-ctl-body'
    body.hidden = true
    let panelAnimation: Animation | null = null
    function setPanelOpen(open: boolean): void {
      panelAnimation?.cancel()
      toggle.setAttribute('aria-expanded', String(open))
      if (reduced) { body.hidden = !open; return }
      if (open) body.hidden = false
      const time = token('--au-m-fast', '160ms')
      const duration = parseFloat(time) * (time.endsWith('ms') ? 1 : 1000)
      panelAnimation = body.animate(open ? [{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'translateY(0)'}] : [{opacity:1},{opacity:0}], {duration,easing:token('--au-e-std','ease-out')})
      panelAnimation.onfinish = () => { body.hidden = !open; panelAnimation = null }
    }
    toggle.addEventListener('au-activate', () => setPanelOpen(toggle.getAttribute('aria-expanded') !== 'true'))
    const dismiss = (e: PointerEvent): void => { if (!e.composedPath().includes(panel) && toggle.getAttribute('aria-expanded') === 'true') setPanelOpen(false) }
    const escape = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !body.hidden) { e.stopPropagation(); setPanelOpen(false); toggle.focus() } }
    document.addEventListener('pointerdown', dismiss)
    panel.addEventListener('keydown', escape)
    panel.append(toggle, body)
    container.append(panel)

    const rowSyncs: Array<() => void> = []

    function seg<T extends string>(label: string, choices: readonly T[], get: () => T, set: (v: T) => void): HTMLElement {
      const row = document.createElement('div')
      row.className = 'fg-ctl-row'
      const lab = document.createElement('span')
      lab.className = 'fg-ctl-label'
      lab.textContent = label
      const group = document.createElement('au-segmented-control') as HTMLElement & { items: {value:string;label:string}[]; value:string; label:string }
      const names: Record<string,string> = {none:'None',repo:'Repository',kind:'Kind',degree:'Connections',uniform:'Uniform',hover:'Hover',zoom:'Zoom',always:'Always',off:'Off'}
      group.label = label
      group.items = choices.map(value => ({value,label:names[value] ?? value}))
      group.addEventListener('au-change', (event) => {
        const value = (event as CustomEvent<{value:T}>).detail.value
        if (choices.includes(value)) { set(value); sync() }
      })
      row.append(lab, group)
      rowSyncs.push(() => { group.value = get() })
      return row
    }
    function check(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
      const row = document.createElement('label')
      row.className = 'fg-check'
      const box = document.createElement('au-checkbox') as AuCheckboxEl
      box.setAttribute('size', 'sm')
      box.setAttribute('aria-label', label)
      box.addEventListener('au-change', () => {
        set(box.checked)
        sync()
      })
      const lab = document.createElement('span')
      lab.textContent = label
      row.append(box, lab)
      rowSyncs.push(() => {
        box.checked = get()
      })
      return row
    }

    const colorRow = seg('Node colour', ['none', 'repo', 'kind'] as const, () => params.colorBy, (v) => {
      params.colorBy = v
      opts.onConfigChange?.({ colorBy: v })
      scheduleDraw()
    })
    const sizeRow = seg('Node size', ['degree', 'uniform'] as const, () => params.sizeBy, (v) => {
      params.sizeBy = v
      opts.onConfigChange?.({ sizeBy: v })
      reapplyForces()
      scheduleDraw()
    })
    const edgeRow = seg('Link colour', ['uniform', 'kind'] as const, () => params.edgeColorBy, (v) => {
      params.edgeColorBy = v
      opts.onConfigChange?.({ edgeColorBy: v })
      scheduleDraw()
    })
    const orphanRow = check('Include disconnected files', () => params.showOrphans, (v) => {
      params.showOrphans = v
      opts.onConfigChange?.({ showOrphans: v })
      rebuildDisplay()
    })

    const kindsWrap = document.createElement('div')
    kindsWrap.className = 'fg-ctl-kinds'
    const legend = document.createElement('div')
    legend.className = 'fg-ctl-legend'
    const edgeLegend = document.createElement('div')
    edgeLegend.className = 'fg-ctl-legend'
    const pinsBtn = document.createElement('au-button') as HTMLElement & {disabled:boolean}
    pinsBtn.setAttribute('variant', 'outline')
    pinsBtn.textContent = 'Release pins'
    pinsBtn.addEventListener('au-activate', () => releaseAllPins())
    const hint = document.createElement('div')
    hint.className = 'fg-ctl-hint'
    hint.textContent = 'Drag to move a node; release to let it settle. Shift-click to pin or unpin. Drag a pinned node to reposition it. Hold ⌘ or Ctrl to preview.'

    const heading = document.createElement('div')
    heading.className = 'fg-ctl-heading'
    heading.textContent = 'Graph settings'
    const labelsRow = seg('Labels', ['hover', 'zoom', 'always', 'off'] as const, () => params.labels, (v) => {
      params.labels = v
      opts.onConfigChange?.({ labels: v })
      scheduleDraw()
    })
    function slider(key: 'nodeScale' | 'charge' | 'linkDistance' | 'selectionZoom' | 'edgeOpacity' | 'openLabelOpacity' | 'adjacentLabelOpacity', label: string, min: number, max: number, step: number): HTMLElement {
      const row = document.createElement('div')
      row.className = 'fg-slider'
      const name = document.createElement('span')
      name.className = 'fg-ctl-label'
      name.textContent = label
      const value = document.createElement('output')
      const input = document.createElement('au-slider') as HTMLElement & {value:number;min:number;max:number;step:number;label:string}
      Object.assign(input,{min,max,step,label})
      const display = () => key === 'charge' ? String(-params[key]) : String(params[key])
      input.addEventListener('au-input', () => { params[key] = key === 'charge' ? -input.value : input.value; if (key === 'selectionZoom') { if (selectedId) emphasizeSelection(selectedId) } else if (key === 'nodeScale' || key === 'charge' || key === 'linkDistance') reapplyForces(); scheduleDraw(); value.value = display() })
      input.addEventListener('au-change', () => opts.onConfigChange?.({ [key]: params[key] }))
      rowSyncs.push(() => { input.value = key === 'charge' ? -params[key] : params[key]; value.value = display() })
      row.append(name, value, input)
      return row
    }
    const fit = document.createElement('au-button')
    fit.setAttribute('variant', 'ghost'); fit.setAttribute('size', 'sm'); fit.textContent = 'Fit graph'
    fit.addEventListener('au-activate', () => { userInteracted = true; fitToView(true); scheduleDraw() })
    const reset = document.createElement('au-button')
    reset.setAttribute('variant', 'outline'); reset.textContent = 'Restore defaults'
    reset.addEventListener('au-activate', () => {
      const patch = { openLabelOpacity: DEFAULT_PARAMS.openLabelOpacity, adjacentLabelOpacity: DEFAULT_PARAMS.adjacentLabelOpacity, edgeOpacity: DEFAULT_PARAMS.edgeOpacity, selectionZoom: DEFAULT_PARAMS.selectionZoom, highlightOpen: DEFAULT_PARAMS.highlightOpen, panToSelection: DEFAULT_PARAMS.panToSelection, pulseSelection: DEFAULT_PARAMS.pulseSelection, colorBy: DEFAULT_PARAMS.colorBy, sizeBy: DEFAULT_PARAMS.sizeBy, edgeColorBy: DEFAULT_PARAMS.edgeColorBy, showOrphans: DEFAULT_PARAMS.showOrphans, labels: DEFAULT_PARAMS.labels, nodeScale: DEFAULT_PARAMS.nodeScale, charge: DEFAULT_PARAMS.charge, linkDistance: DEFAULT_PARAMS.linkDistance }
      Object.assign(params, patch); hiddenKinds.clear(); opts.onConfigChange?.(patch); rebuildDisplay()
    })
    function section(title: string, children: HTMLElement[]): HTMLElement {
      const el = document.createElement('section')
      el.className = 'fg-ctl-section'
      const heading = document.createElement('div')
      heading.className = 'fg-ctl-heading'; heading.textContent = title
      el.append(heading, ...children)
      return el
    }
    const scopeNote = document.createElement('div')
    scopeNote.className = 'fg-ctl-hint'
    scopeNote.textContent = 'All workspace members, including framework files. Visibility filters apply to this pane; disconnected files have no links in the full graph.'
    const encoding = document.createElement('div')
    encoding.className = 'fg-ctl-hint'
    encoding.textContent = 'Connection size counts links in the full graph. Lines include file references and type relationships.'
    const searchInput = document.createElement('au-input') as HTMLElement & {value: string}
    searchInput.setAttribute('aria-label', 'Find a displayed file'); searchInput.setAttribute('placeholder', 'Find a displayed file…'); searchInput.setAttribute('size', 'sm'); searchInput.value = ''
    const searchResults = document.createElement('au-scroll-area'); searchResults.setAttribute('axis', 'y'); searchResults.className = 'fg-find-results'
    const searchHint = document.createElement('div'); searchHint.className = 'fg-ctl-hint'; searchHint.setAttribute('role', 'status')
    let matches: GNode[] = []
    const focusNode = (node: GNode) => {
      dismissGraphPreview(); cancelFit(); userInteracted = true; selectedId = node.id
      scale = Math.max(scale, 1.5); tx = cssW / 2 - (node.x ?? 0) * scale; ty = cssH / 2 - (node.y ?? 0) * scale
      setPanelOpen(false); canvas.focus(); syncIdentity?.(); scheduleDraw()
    }
    const searchFiles = () => {
      const query = searchInput.value.trim().toLocaleLowerCase()
      matches = query ? nodes.filter(node => node.id.toLocaleLowerCase().includes(query)).sort((a, b) => baseName(a.id).localeCompare(baseName(b.id))) : []
      searchResults.replaceChildren(); searchResults.hidden = !matches.length
      searchHint.textContent = !query ? 'Find within the visible graph. Choose a file to center it.' : !matches.length ? 'No displayed files match. Try another name or adjust visibility.' : `${matches.length} matching ${matches.length === 1 ? 'file' : 'files'}${matches.length > 30 ? ' · showing first 30; refine the name' : ''}`
      for (const node of matches.slice(0, 30)) {
        const row = document.createElement('div'); row.className = 'fg-find-row'
        const action = document.createElement('au-button'); action.setAttribute('variant', 'ghost'); action.setAttribute('size', 'sm'); action.textContent = baseName(node.id); action.title = node.id
        action.addEventListener('au-activate', () => focusNode(node))
        const path = document.createElement('div'); path.className = 'fg-ctl-hint'; path.textContent = node.id
        row.append(action, path); searchResults.append(row)
      }
    }
    searchInput.addEventListener('au-input', searchFiles)
    searchInput.addEventListener('keydown', event => {if (event.key === 'Enter' && matches[0]) {event.preventDefault(); focusNode(matches[0])}})
    searchFiles()
    bodyContent.append(heading, section('Find file', [searchInput, searchHint, searchResults]),
      section('Visibility', [scopeNote, orphanRow, kindsWrap]),
      section('Selection', [
        check('Highlight open files', () => params.highlightOpen, v => { params.highlightOpen = v; opts.onConfigChange?.({highlightOpen:v}); scheduleDraw() }),
        check('Pan to selected file', () => params.panToSelection, v => { params.panToSelection = v; opts.onConfigChange?.({panToSelection:v}); if (!v) cancelFit() }),
        slider('selectionZoom', 'Selection zoom', .2, 3, .1),
        check('Pulse selected file', () => params.pulseSelection, v => { params.pulseSelection = v; opts.onConfigChange?.({pulseSelection:v}); scheduleDraw() }),
      ]),
      section('Appearance', [colorRow, legend, sizeRow, edgeRow, edgeLegend, slider('edgeOpacity', 'Edge opacity', 0, 1, .05), encoding]),
      section('Labels', [labelsRow, slider('openLabelOpacity', 'Open file names', 0, 1, .05), slider('adjacentLabelOpacity', 'Adjacent names on hover', 0, 1, .05)]),
      section('Layout', [slider('nodeScale', 'Node scale', .5, 2, .1), slider('charge', 'Repulsion', 10, 120, 5), slider('linkDistance', 'Link distance', 10, 120, 5), pinsBtn]),
      reset, hint)
    const tools = document.createElement('div')
    tools.className = 'fg-tools'
    tools.append(toggle)
    bodyContent.append(fit)
    panel.prepend(tools)
    const summary = document.createElement('div')
    summary.className = 'fg-summary'
    const counts = document.createElement('strong')
    const detail = document.createElement('div')
    detail.className = 'fg-summary-detail'
    const identity = document.createElement('div')
    identity.className = 'fg-summary-detail'
    identity.hidden = true
    const summaryLegend = document.createElement('div')
    summaryLegend.className = 'fg-ctl-legend'
    summary.append(counts, detail, summaryLegend, identity)
    let identityKey = ''
    syncIdentity = () => {
      const node = hovered ?? nodes.find(n => n.id === selectedId)
      const key = node ? `${node.id}|${node.deg}|${node.pinned}` : ''
      if (key === identityKey) return
      identityKey = key
      identity.hidden = !node
      identity.textContent = node ? `${node.id} · ${node.deg} connections${node.pinned ? ' · pinned' : ''}` : ''
    }
    bodyContent.prepend(summary)


    function syncKinds(): void {
      const present = [...new Set(lastSnap.nodes.map((n) => n.kind as string | undefined).filter((k): k is string => !!k))]
      const ordered = KIND_ORDER.filter((k) => present.includes(k)).concat(present.filter((k) => !KIND_ORDER.includes(k)))
      kindsWrap.replaceChildren()
      if (ordered.length <= 1) return // nothing to filter by
      const title = document.createElement('div')
      title.className = 'fg-ctl-label'
      title.textContent = 'File kinds'
      kindsWrap.appendChild(title)
      for (const k of ordered) {
        const row = document.createElement('label')
        row.className = 'fg-check'
        const box = document.createElement('au-checkbox') as AuCheckboxEl
        box.setAttribute('size', 'sm')
        box.checked = !hiddenKinds.has(k)
        box.addEventListener('au-change', () => {
          if (box.checked) hiddenKinds.delete(k)
          else hiddenKinds.add(k)
          rebuildDisplay()
        })
        const lab = document.createElement('span')
        lab.textContent = ({note:'Notes',instance:'Instances','type-def':'Type definitions',asset:'Assets'} as Record<string,string>)[k] ?? k
        const count = document.createElement('small')
        count.textContent = String(lastSnap.nodes.filter(n => n.kind === k).length)
        box.setAttribute('aria-label', lab.textContent)
        row.append(box, lab, count)
        kindsWrap.appendChild(row)
      }
    }
    function syncLegend(): void {
      legend.replaceChildren()
      edgeLegend.replaceChildren()
      if (params.edgeColorBy === 'kind') {
        for (const kind of [...new Set(links.map(l => l.kind).filter((k): k is string => !!k))].sort()) {
          const item = document.createElement('div')
          item.className = 'fg-legend-item'
          const swatch = document.createElement('span')
          swatch.className = 'fg-edge-sw'
          swatch.style.background = edgeKindColors[kind] ?? edgeColor
          const label = document.createElement('span')
          label.textContent = kind.replaceAll('-', ' ')
          item.append(swatch, label)
          edgeLegend.append(item)
        }
      }
      summaryLegend.replaceChildren()
      for (const e of legendEntries()) {
        const item = document.createElement('div')
        item.className = 'fg-legend-item'
        const sw = document.createElement('span')
        sw.className = 'fg-legend-sw'
        sw.style.background = e.color
        const lab = document.createElement('span')
        lab.textContent = ({note:'Notes',instance:'Instances','type-def':'Type definitions',asset:'Assets'} as Record<string,string>)[e.label] ?? e.label
        item.append(sw, lab)
        legend.appendChild(item)
        if (params.colorBy === 'kind') summaryLegend.append(item.cloneNode(true))
      }
    }
    function sync(): void {
      const count = (shown: number, total: number) => shown === total ? shown.toLocaleString() : `${shown.toLocaleString()} of ${total.toLocaleString()}`
      counts.textContent = `${count(nodes.length, lastSnap.nodes.length)} files · ${count(links.length, lastSnap.edges.length)} links`
      detail.textContent = hiddenKinds.size || !params.showOrphans ? 'Workspace graph · visibility filters active' : 'Workspace graph · all files shown'
      const pins = new Set([...nodes, ...positions.values()].filter(n => n.pinned).map(n => n.id)).size
      pinsBtn.disabled = pins === 0
      pinsBtn.textContent = pins ? `Release ${pins} pinned ${pins === 1 ? 'node' : 'nodes'}` : 'Release pins'
      for (const s of rowSyncs) s()
      syncKinds()
      syncLegend()
      searchFiles()
    }
    sync()
    syncControls = sync

    return () => {
      syncControls = null
      document.removeEventListener('pointerdown', dismiss)
      panel.removeEventListener('keydown', escape)
      panelAnimation?.cancel()
      syncIdentity = null
      summary.remove()
      panel.remove()
      disposeStyles?.()
    }
  }
  const offControls = buildControls()

  const view: GraphView = opts.source.open(opts.scope ?? { base: { kind: 'global' } })
  const offView = view.subscribe(() => {
    if (!alive) return
    applySnapshot(view.snapshot())
  })

  return {
    teardown(): void {
      if (shownKey && preview?.isShowing(shownKey)) preview.hide()
      alive = false
      sim?.stop()
      cancelFit()
      positions.clear()
      nodeMaterials.clear()
      if (frame) cancelAnimationFrame(frame)
      ro.disconnect()
      themeObserver.disconnect()
      document.fonts.removeEventListener('loadingdone', refreshPresentation)
      canvas.removeEventListener('keydown', onCanvasKey)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onCanvasLeave)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onModKey, true)
      window.removeEventListener('keyup', onModKey, true)
      motionMq.removeEventListener('change', onMotionChange)
      offControls()
      offView()
      view.close()
      opts.source.dispose()
      offSelection?.()
      offOpen?.()
      canvas.remove()
    },
    update(p: Partial<GraphParams>): void {
      Object.assign(params, p)
      if (
        p.charge !== undefined ||
        p.linkDistance !== undefined ||
        p.linkStrength !== undefined ||
        p.nodeScale !== undefined ||
        p.sizeBy !== undefined
      ) {
        reapplyForces()
      }
      if (p.showOrphans !== undefined) rebuildDisplay() // a filter change re-derives the display
      syncControls?.()
      scheduleDraw()
    },
  }
}

/** The projection mount (locator `export`, default `mount`). Wraps runGraph with the real data source
 *  + the host channels. An optional `source` lets a harness inject a mock. */
function mount(container: HTMLElement, host: MountHost, source?: GraphSource): () => void {
  const cfg = host.config as ForceGraph | undefined
  // Accumulate appearance choices across the session — `host.config` is the MOUNT-time instance and
  // does not advance, so each patch merges onto the last SAVED config, not the original.
  let saved: ForceGraph | undefined = cfg
  const ctl = runGraph(container, {
    source: source ?? new EngineGraphSource(host.engine, host.engineReady),
    params: paramsFromConfig(cfg),
    scope: configToScope(cfg),
    onOpen: (p) => host.intent?.fire(openIntent(fileSelection(p), 'transient')),
    selection: host.selection ?? null,
    viewState: host.viewState ?? null,
    preview: host.preview ?? null,
    engine: host.engine,
    styles: host.styles ?? null,
    // Persist an appearance choice into the composition config (the authored default). The host
    // stamps the node's type onto saveConfig, so the merged fields alone are enough.
    onConfigChange: (patch) => {
      saved = { ...(saved ?? {}), ...patch } as ForceGraph
      host.saveConfig?.(saved)
    },
  })
  return () => ctl.teardown()
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
