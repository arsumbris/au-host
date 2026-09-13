import { displayFilePath } from '@arsumbris/au-host-sdk'
// focal-tree projection: a file's REFERENCE NEIGHBORHOOD as a FOCAL tree. The focus sits at the
// center; its neighbors ring outward; clicking a node CONTINUOUSLY ANIMATES the focus to it along the
// tree path (edge-constrained, stability-invariant per the focal-layout core). Shares radial-tree's
// contract: neighborhood-direct via the SDK helpers, FOLLOW/DRIVE linkage, prefixed-global CSS,
// own token sheet. The re-root is time-driven (rAF), unlike radial-tree's instant re-root.

import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { createElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactElement, MouseEvent as RMouseEvent, WheelEvent as RWheelEvent } from 'react'
import { defineProjection, type Intent, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk'
import { readNeighborhood, subscribeChanges, type WireNeighborhoodDirection, type WireNeighborhoodKind } from '@arsumbris/au-host-sdk/engine-reads'
import { fileSelection, isFileSelection, type Selection } from '@arsumbris/selection'
import { openIntent, isOpenIntent } from '@arsumbris/intent'
import { makeHoverContent } from '@arsumbris/preview-content'
import { layoutFocal, layoutFocalMorph, layoutCanonical, canonicalAnchor, ringRadius, pathBetween, findPath, type EdgePosition, type FocalNode, type FocalLayoutResult } from './lib/focal-layout'
import { neighborhoodToTree, mergeNeighborhood, type RadialNodeData } from './lib/neighborhood-to-tree'
import { subtreeSize, type TreeNode } from './lib/tree'

import { createNodeGrain } from './node-grain'
import { fitCamera, markerRadius, clippedEdge, placeLabels } from './lib/scene-geometry'

const ALL_KINDS: WireNeighborhoodKind[] = ['navigational', 'contributing', 'field']

/**
 * Every tunable, in one place. Each is a type-def config field (the authored default) AND a live
 * control in the settings popover, persisted per pane in the `viewStore` — resolution is
 * `viewStore ?? config ?? the default below`. Twiddling `shellWidthFactor` or `wedgeWeightExp` by
 * editing a yaml and reloading is exactly the loop the popover removes.
 */
interface Settings {
  // the walk — changing any of these re-reads the neighborhood
  depth: number
  direction: WireNeighborhoodDirection
  kinds: WireNeighborhoodKind[]
  readMaxNodes: number
  // growth
  expand: boolean
  expandDepth: number
  maxNodes: number
  // layout
  shellWidth: number
  shellWidthFactor: number
  wedgeWeightExp: number
  visibleDepth: number
  // readability
  labelDepth: number
  nodeScale: number
  animationMs: number
  // structure overlay
  showShells: boolean
  showWedges: boolean
}

const DEFAULTS: Settings = {
  depth: 2,
  direction: 'both',
  kinds: ALL_KINDS,
  readMaxNodes: 250,
  expand: true,
  expandDepth: 2,
  maxNodes: 600,
  shellWidth: 120,
  shellWidthFactor: 1,
  wedgeWeightExp: 0.5,
  visibleDepth: 3,
  labelDepth: 1,
  nodeScale: 0.5,
  animationMs: 450,
  showShells: false,
  showWedges: false,
}

/** viewStore (per-pane, persisted) beats config (authored) beats the built-in default. */
function initialSettings(host: MountHost, config: Record<string, unknown>): Settings {
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const stored = host.viewStore.get(key)
    const authored = config[key]
    const value = stored ?? authored
    if (value !== undefined && value !== null) (out as Record<string, unknown>)[key] = value
  }
  return out
}

// Diagnostic logging for the re-root layout investigation. OFF by default; flip to true to print,
// per re-root, the from/to canonical layouts joined per node (depth + angle + Δ) — reveals rotation
// (constant Δ), reflection/swap (order flip), or a stale re-fetch (seed/node-count change).
const DEBUG_FOCAL = false

function degOf(rad: number | undefined): string {
  if (rad === undefined) return '   -  '
  const d = (((rad * 180) / Math.PI) % 360 + 360) % 360
  return d.toFixed(1).padStart(6)
}

/**
 * Log the FROM and TO canonical layouts of a re-root, joined per node, so rotation (a constant
 * angle delta), mirroring (angular order reversal), or a stale re-fetch (node set / seed changes)
 * are all visible in one pasteable block. Only nodes near the pivot (depth <= 2 in either frame).
 */
function logReRoot(tree: TreeNode<RadialNodeData>, fromId: string, toId: string, path: string[]): void {
  if (!DEBUG_FOCAL) return
  const from = layoutCanonical(tree, fromId)
  const to = layoutCanonical(tree, toId)
  const fm = new Map(from.map((n) => [n.id, n]))
  const tm = new Map(to.map((n) => [n.id, n]))
  const lbl = (id: string): string => (fm.get(id) ?? tm.get(id))?.label ?? id
  const ids = [...new Set([...fm.keys(), ...tm.keys()])].sort((a, b) => {
    const da = fm.get(a)?.depth ?? 9
    const db = fm.get(b)?.depth ?? 9
    return da - db || (lbl(a) < lbl(b) ? -1 : 1)
  })
  const rows: string[] = []
  for (const id of ids) {
    const f = fm.get(id)
    const t = tm.get(id)
    if ((f?.depth ?? 9) > 2 && (t?.depth ?? 9) > 2) continue
    const dAng = f && t ? degOf(t.angle - f.angle + (t.angle < f.angle ? 2 * Math.PI : 0)) : '   -  '
    rows.push(
      `  ${lbl(id).slice(0, 26).padEnd(26)} ${(f ? String(f.depth) : '-').padStart(3)} ${degOf(f?.angle)}   ${(t ? String(t.depth) : '-').padStart(3)} ${degOf(t?.angle)}   Δ${dAng}`,
    )
  }
  console.log(
    `[focal] re-root  ${lbl(fromId)}  →  ${lbl(toId)}\n` +
      `  seed=${tree.label} nodes=${from.length} path=[${path.map(lbl).join(' , ')}]\n` +
      `  anchor: from=${degOf(canonicalAnchor(tree, fromId))}  to=${degOf(canonicalAnchor(tree, toId))}\n` +
      `  ${'node'.padEnd(26)} ${'fD'.padStart(3)} ${'fromA°'.padStart(6)}   ${'tD'.padStart(3)} ${'toA°'.padStart(6)}   ${'Δang°'}\n` +
      rows.join('\n'),
  )
}

const STYLE = `
.au-focal-tree { width: 100%; height: 100%; position: relative; overflow: hidden; display: flex; flex-direction: column;
  background: var(--au-focal-tree-bg); font: var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); }
.au-focal-tree-guidance { flex: 1; min-height: 0; }
.au-focal-tree-guidance::part(scroll) { display: flex; flex-direction: column; }
.au-focal-tree-guidance au-empty-state { flex: none; box-sizing: border-box; width: 100%; max-width: 32rem; margin: auto; }
.au-focal-tree-svg { width: 100%; height: 0; flex: 1; min-height: 0; display: block; cursor: grab; }
.au-focal-tree-header { display: flex; align-items: flex-start; gap: var(--au-space-2); padding: var(--au-space-2) var(--au-space-2-5); flex: 0 0 auto; }
.au-focal-tree-svg.grabbing { cursor: grabbing; }
.au-focal-tree-status { flex: 1; min-width: 0;
  color: var(--au-ink-3); pointer-events: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.au-focal-tree-status strong, .au-focal-tree-status span { display: block; overflow: hidden; text-overflow: ellipsis; }
.au-focal-tree-status .au-focal-tree-loading[hidden] { display: none; }
.au-focal-tree-status .au-focal-tree-loading { display: flex; align-items: center; gap: var(--au-space-1-5); }
.au-focal-tree-status strong { font-weight: var(--au-w-medium); color: var(--au-ink-2); }
.au-focal-tree-status span { font-size: var(--au-t-2xs); }
.au-focal-tree-node { cursor: pointer; transition: fill var(--au-m-fast) var(--au-e-std), stroke var(--au-m-fast) var(--au-e-std); }
.au-focal-tree-node:focus { outline:none; }
.au-focal-tree-node:focus-visible { stroke:var(--au-focus-outer); stroke-width:2px; }
.au-focal-tree-hit { fill: transparent; cursor: pointer; }
.au-focal-tree-nodeg[data-hovered="true"] .au-focal-tree-node { stroke: var(--au-focal-tree-focus); stroke-width: 1.5px; }
.au-focal-tree-label { fill: var(--au-focal-tree-label); cursor: pointer;
  font-size: var(--au-focal-tree-label-size); user-select: none; animation: au-focal-label-in var(--au-m-fast) var(--au-e-soft); }
/* a summary, not a target: it carries a tooltip but no click — re-root nearer to unfold it */
.au-focal-tree-cluster { cursor: inherit; }
.au-focal-tree-cluster circle { fill: var(--au-focal-tree-cluster); }
.au-focal-tree-cluster-count { fill: var(--au-focal-tree-cluster);
  font-size: var(--au-focal-tree-label-size); user-select: none; }
.au-focal-tree-edge { stroke: var(--au-focal-tree-edge); fill: none; stroke-width: 1; pointer-events: none; }
.au-focal-tree-edge.field { stroke: color-mix(in srgb, var(--au-focal-tree-edge-field) 40%, var(--au-focal-tree-edge)); }
.au-focal-tree-material, .au-focal-tree-grain, .au-focal-tree-focus-ring { pointer-events: none; }
.au-focal-tree-focus-ring { fill: none; stroke: var(--au-focal-tree-focus); stroke-opacity: .3; stroke-width: 1; }
.au-focal-tree-grain { mix-blend-mode: soft-light; opacity: .55; }
.au-focal-tree-nodeg { isolation: isolate; }
.au-focal-tree-hover { position: absolute; bottom: var(--au-space-2); left: var(--au-space-2-5); right: var(--au-space-2-5); pointer-events: none;
  color: var(--au-ink-1); font-size: var(--au-t-2xs); padding: var(--au-space-1) var(--au-space-1-5);
  background: var(--au-elev-5-fill); border: 1px solid var(--au-line-1); border-radius: var(--au-radius-chip);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis; animation: au-focal-label-in var(--au-m-fast) var(--au-e-soft); }
.au-focal-tree-legend { display: grid; grid-template-columns: 1fr 1fr; gap: var(--au-space-2); color: var(--au-ink-2); margin: var(--au-space-3) 0; padding-inline: var(--au-space-1); }
.au-focal-tree-legend span { display: flex; align-items: center; gap: var(--au-space-1-5); }
.au-focal-tree-legend i { width: 8px; height: 8px; border-radius: 50%; background: var(--au-focal-tree-focus); }
.au-focal-tree-legend .focus { outline: 1px solid var(--au-focal-tree-focus); outline-offset: 2px; }
.au-focal-tree-legend .seed { background: var(--au-focal-tree-node); }
.au-focal-tree-legend .field { height: 1px; border-radius: 0; background: var(--au-focal-tree-edge-field); }
.au-focal-tree-legend .out { background: var(--au-focal-tree-out); }
.au-focal-tree-legend .in { background: var(--au-focal-tree-in); }
.au-focal-tree-legend .cluster { background: var(--au-focal-tree-cluster); }
@keyframes au-focal-label-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .au-focal-tree-node { transition: none; }
  .au-focal-tree-label, .au-focal-tree-hover { animation: none; }
}
.au-focal-tree-explainer { color: var(--au-ink-3); line-height: var(--au-lh-sm); margin: var(--au-space-2) 0; }
.au-focal-tree-help { margin-top: var(--au-space-3); padding-top: var(--au-space-2); border-top: 1px solid var(--au-line-1); }
.au-focal-tree-help summary { cursor: pointer; color: var(--au-ink-2); }
.au-focal-tree-row au-checkbox { flex: 0 0 auto; }
/* the structure overlay: the layout's own geometry, drawn as guides under everything else */
.au-focal-tree-shell { fill: none; stroke: var(--au-focal-tree-shell); stroke-width: 1;
  stroke-dasharray: 3 5; }
.au-focal-tree-wedge { fill: none; stroke: var(--au-focal-tree-wedge); stroke-width: 1; }
.au-focal-tree-links { flex: 0 0 auto; display: flex; gap: var(--au-space-1); }
.au-focal-tree-panel { pointer-events: auto; width: 300px; max-width: calc(100vw - var(--au-space-4)); max-height: min(420px, calc(100dvh - var(--au-space-4))); box-sizing: border-box;
  font: var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); }

.au-focal-tree-row { display: flex; align-items: center; justify-content: space-between; gap: var(--au-space-2);
  padding: var(--au-space-0-5) 0; cursor: help; }
.au-focal-tree-row > span:first-child { color: var(--au-ink-2); }
.au-focal-tree-row select {
  width: 64px; background: var(--au-color-surface-1);
  color: var(--au-ink-1); border: 1px solid var(--au-line-control);
  border-radius: var(--au-radius-sm); padding: var(--au-space-0-5) var(--au-space-1); font: inherit; }
.au-focal-tree-slider { display: flex; align-items: center; gap: var(--au-space-1); }
.au-focal-tree-slider au-slider { width: 74px; }
.au-focal-tree-row au-number-input { width: 78px; }
.au-focal-tree-slider em { font-style: normal; color: var(--au-ink-3); width: 26px; text-align: right; }
.au-focal-tree-kinds { display: flex; gap: var(--au-space-1); }
.au-focal-tree-chip { background: transparent; color: inherit; cursor: pointer; font: inherit;
  padding: var(--au-space-0-5) var(--au-space-1); border-radius: var(--au-radius-sm); color: var(--au-ink-3);
  border: 1px solid var(--au-line-2); }
.au-focal-tree-chip.on { color: var(--au-ink-1);
  background: var(--au-chrome-active); border-color: var(--au-line-control); }
.au-focal-tree-chip:focus-visible, .au-focal-tree-help summary:focus-visible, .au-focal-tree-row select:focus-visible { outline: 2px solid var(--au-focus-outer); outline-offset: 2px; }
.au-focal-tree-chip:hover { background: var(--au-chrome-hover); color: var(--au-ink-1); }

`

type Tree = TreeNode<RadialNodeData>
type Layout = FocalLayoutResult<RadialNodeData>
type FNode = FocalNode<RadialNodeData>

/** The authored config: the seed + every `Settings` field as an optional default. Linkage (which peer
 *  drives / follows this view) is the switchboard's concern now, not a per-projection toggle. */
type Config = Partial<Settings> & {
  root?: string
}

/** The node in `tree` with this id, or null. */
function findNode(tree: Tree, id: string): Tree | null {
  const path = findPath(tree, id)
  return path ? path[path.length - 1] : null
}

/** Focus node id from an edge position (the nearer endpoint). */
function focusNodeId(pos: EdgePosition): string {
  return pos.t < 0.5 ? pos.fromId : pos.toId
}

/** The initial focus for a freshly loaded tree: at the root, angled toward its first child. */
function initialFocus(tree: Tree): EdgePosition {
  const first = tree.children[0]
  return { fromId: tree.id, toId: first ? first.id : tree.id, t: 0 }
}

function nodeColor(n: FNode): string {
  if (n.depth === 0) return 'var(--au-focal-tree-focus)'
  if (n.data?.direction === 'out') return 'var(--au-focal-tree-out)'
  if (n.data?.direction === 'in') return 'var(--au-focal-tree-in)'
  return 'var(--au-focal-tree-node)'
}

function FocalTreeView({ host }: { host: MountHost }): ReactElement {
  const config = (host.config ?? {}) as Config

  const [settings, setSettings] = useState<Settings>(() =>
    initialSettings(host, config as Record<string, unknown>),
  )
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]): void => {
      setSettings((s) => ({ ...s, [key]: value }))
      host.viewStore.set(value, key)
    },
    [host],
  )

  const { depth, direction, kinds, readMaxNodes, expand } = settings
  const kindsKey = kinds.join(',')
  const layoutParams = useMemo(
    () => ({
      shellWidth: settings.shellWidth,
      shellWidthFactor: settings.shellWidthFactor,
      wedgeWeightExp: settings.wedgeWeightExp,
      visibleDepth: settings.visibleDepth,
    }),
    [settings.shellWidth, settings.shellWidthFactor, settings.wedgeWeightExp, settings.visibleDepth],
  )

  const storedRoot = host.viewStore.get('root') as string | undefined
  const [root, setRoot] = useState<string | null>(storedRoot ?? config.root ?? null)

  const [tree, setTree] = useState<Tree | null>(null)
  const [focus, setFocus] = useState<EdgePosition | null>(null)
  const [status, setStatus] = useState<string>('select a file to focus its neighborhood')
  // A merge in flight: the PRE-merge tree plus how far the arrival has animated. The grown tree is
  // already in `tree`, so the morph only decides what is drawn while the new nodes settle in.
  const [morph, setMorph] = useState<{ prev: Tree; t: number } | null>(null)

  const aliveRef = useRef(true)
  const rootRef = useRef(root)
  rootRef.current = root
  const treeRef = useRef<Tree | null>(null)
  treeRef.current = tree
  const focusRef = useRef<EdgePosition | null>(null)
  focusRef.current = focus
  const rafRef = useRef<number | undefined>(undefined)
  const motionPreference = useRef<MediaQueryList | null>(null)
  if (!motionPreference.current) motionPreference.current = window.matchMedia('(prefers-reduced-motion: reduce)')
  const animTokenRef = useRef(0)
  const morphRafRef = useRef<number | undefined>(undefined)
  // Nodes whose own neighborhood has already been fetched — the seed at load, then each settled focus.
  const expandedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      if (morphRafRef.current !== undefined) cancelAnimationFrame(morphRafRef.current)
    }
  }, [])

  const toggleExpand = useCallback((): void => {
    setSetting('expand', !settingsRef.current.expand)
  }, [setSetting])

  const loadGeneration = useRef(0)
  // New seeds reset focus; refreshes retain the explored node when it still exists.
  const load = useCallback(
    async (seed: string, preserveFocus = false): Promise<void> => {
      const generation = ++loadGeneration.current
      setStatus('loading…')
      const outcome = await readNeighborhood(host.engine, {
        path: seed,
        direction,
        depth,
        max_nodes: readMaxNodes,
        kinds,
      })
      if (!aliveRef.current || rootRef.current !== seed || generation !== loadGeneration.current) return
      if ('ok' in outcome) {
        setStatus(outcome.error)
        setTree(null)
        return
      }
      if (!outcome.ready) {
        setStatus('engine not ready')
        return
      }
      const { tree: t } = neighborhoodToTree(outcome.result, seed)
      if (!t) {
        setStatus(`no node for ${seed}`)
        setTree(null)
        return
      }
      // supersede any running animation
      animTokenRef.current++
      if (morphRafRef.current !== undefined) cancelAnimationFrame(morphRafRef.current)
      setMorph(null)
      expandedRef.current = new Set([seed]) // a fresh tree: only the seed's neighborhood is loaded
      setTree(t)
      const previous = preserveFocus ? focusRef.current : null
      if (previous && findNode(t, previous.fromId)?.children.some(child => child.id === previous.toId)) {
        setFocus(previous)
      } else {
        const retained = previous && findNode(t, focusNodeId(previous))
        setFocus(initialFocus(retained || t))
      }
      setStatus(`${outcome.result.nodes.length} nodes`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kindsKey stands in for the kinds array
    [host, depth, direction, kindsKey, readMaxNodes],
  )

  /**
   * PROGRESSIVE EXPANSION. Load the settled focus's OWN neighborhood and merge it into the tree, so
   * navigating outward grows the graph instead of running into the seed's cutoff.
   *
   * Only ever called on a SETTLED focus (never mid-move), at most once per node, and only while under
   * the growth cap. The merge is monotonic (see `mergeNeighborhood`), so every already-placed node
   * keeps its position; the few degrees of wedge widening the new nodes cause are ANIMATED via a morph
   * from the pre-merge layout.
   */
  const expandAt = useCallback(
    async (focusId: string): Promise<void> => {
      const s = settingsRef.current
      if (!s.expand) return
      const before = treeRef.current
      if (!before || expandedRef.current.has(focusId)) return
      const node = findNode(before, focusId)
      if (!node?.data) return
      const size = subtreeSize(before)
      if (size >= s.maxNodes) {
        setStatus(`${size} nodes — growth cap reached`)
        return
      }
      expandedRef.current.add(focusId)
      const seed = rootRef.current
      const generation = loadGeneration.current
      const outcome = await readNeighborhood(host.engine, {
        path: node.data.path,
        direction: s.direction,
        depth: s.expandDepth,
        max_nodes: s.readMaxNodes,
        kinds: s.kinds,
      })
      // a re-seed happened while we were fetching → this growth belongs to a tree that is gone
      if (!aliveRef.current || rootRef.current !== seed || generation !== loadGeneration.current) return
      if ('ok' in outcome || !outcome.ready) return
      const current = treeRef.current
      if (!current) return
      const merged = mergeNeighborhood(current, outcome.result, focusId)
      if (!merged.added.length) return

      // Animate the arrival: hold the pre-merge layout and morph into the grown one.
      if (morphRafRef.current !== undefined) cancelAnimationFrame(morphRafRef.current)
      const prev = current
      treeRef.current = merged.tree
      setTree(merged.tree)
      setMorph({ prev, t: 0 })
      setStatus(`${subtreeSize(merged.tree)} nodes (+${merged.added.length})`)
      const start = performance.now()
      const step = (now: number): void => {
        if (!aliveRef.current) return
        const frac = motionPreference.current?.matches ? 1 : Math.min(1, (now - start) / s.animationMs)
        if (frac < 1) {
          setMorph({ prev, t: frac })
          morphRafRef.current = requestAnimationFrame(step)
        } else {
          setMorph(null)
        }
      }
      morphRafRef.current = requestAnimationFrame(step)
    },
    [host],
  )

  // Announce a re-root to peers, SYNCHRONOUSLY at the decision (not on animation arrival): publish the
  // focal selection + fire an open-intent. Synchronous is load-bearing — it keeps the fire INSIDE the
  // causal pass when this re-root is itself a FOLLOW (handling a peer's open), so the dispatch cycle
  // guard skips the delivery back to the origin while still propagating the chain onward. It also lets
  // peers sync instantly instead of after the 450ms animation. No follow/drive gate: the switchboard
  // (wires) is the control surface now.
  const announceReRoot = useCallback(
    (targetId: string): void => {
      host.selection.publish(fileSelection(targetId))
      host.intent.fire(openIntent(fileSelection(targetId)))
    },
    [host],
  )

  // Re-seed to a new root file (a genuine jump OUTSIDE the loaded neighborhood): re-fetch.
  const reseed = useCallback(
    (seed: string): void => {
      if (seed === rootRef.current) return
      announceReRoot(seed) // a re-seed is a re-root too — notify peers synchronously (see animateTo).
      rootRef.current = seed
      setRoot(seed)
      host.viewStore.set(seed, 'root')
    },
    [host, announceReRoot],
  )

  // Animate the focus to `targetId` along the tree path (the continuous re-root). The peer notification
  // fires at the DECISION (here), not on arrival — see `announceReRoot`.
  const animateTo = useCallback(
    (targetId: string): void => {
      const t = treeRef.current
      const f = focusRef.current
      if (!t || !f) return
      const path = pathBetween(t, focusNodeId(f), targetId)
      if (path.length < 2) return
      announceReRoot(targetId)
      logReRoot(t, focusNodeId(f), targetId, path)
      const token = ++animTokenRef.current
      const steps = path.length - 1
      const start = performance.now()
      const tick = (now: number): void => {
        if (!aliveRef.current || animTokenRef.current !== token) return
        const frac = motionPreference.current?.matches ? 1 : Math.min(1, (now - start) / settingsRef.current.animationMs)
        const s = frac * steps
        const i = Math.min(steps - 1, Math.floor(s))
        setFocus({ fromId: path[i], toId: path[i + 1], t: s - i })
        if (frac < 1) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          const final = { fromId: path[steps - 1], toId: path[steps], t: 1 }
          focusRef.current = final
          setFocus(final)
          // SETTLED — only now may the graph grow (never while moving through a multi-edge path).
          void expandAt(targetId)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [host, expandAt, announceReRoot],
  )

  // A target file: NAVIGATE to it if it is in the loaded neighborhood (stable in-tree move, the
  // previous focus keeps its relative side), else RE-SEED (a genuine jump outside the neighborhood).
  const navigateOrReseed = useCallback(
    (path: string): void => {
      const t = treeRef.current
      const f = focusRef.current
      if (t && f && focusNodeId(f) === path) return // already focused here
      if (t && findPath(t, path)) animateTo(path)
      else reseed(path)
    },
    [animateTo, reseed],
  )

  // Load whenever the seed changes.
  useEffect(() => {
    if (root) void load(root)
    else setTree(null)
  }, [root, load])

  // Re-read on engine changes + recover on ready.
  useEffect(() => {
    const offChanges = subscribeChanges(host.engine, () => {
      if (rootRef.current) void load(rootRef.current, true)
    })
    const offReady = host.engineReady?.subscribe((ready) => {
      if (ready && rootRef.current) void load(rootRef.current, true)
    })
    return () => {
      offChanges()
      offReady?.()
    }
  }, [host, load])

  const navigateRef = useRef(navigateOrReseed)
  navigateRef.current = navigateOrReseed
  // FOLLOW inbound: external navigation moves the focus (in-tree) or re-seeds (out-of-tree).
  useEffect(() => {
    return host.selection.follow((value) => {
      if (!value || typeof value !== 'object') return
      const sel = value as Selection
      if (isFileSelection(sel)) navigateRef.current(sel.path)
    })
  }, [host])
  useEffect(() => {
    return host.intent.handle('open-intent', {
      claim: (intent: Intent) => {
        if (!isOpenIntent(intent)) return false
        const target = intent.target
        if (!(target && typeof target === 'object' && isFileSelection(target as Selection))) return false
        const path = (target as Selection & { path: string }).path
        const f = focusRef.current
        // Already focused here → decline (a no-op re-root), so an ambient open routes past us to another
        // handler. The dispatch cycle guard now prevents our OWN re-announce from returning to us.
        return !(f && focusNodeId(f) === path)
      },
      commit: (intent: Intent) => {
        if (!isOpenIntent(intent)) return
        const target = intent.target
        if (!(target && typeof target === 'object' && isFileSelection(target as Selection))) return
        navigateOrReseed((target as Selection & { path: string }).path)
      },
    })
  }, [host, navigateOrReseed])

  const layout: Layout | null = useMemo(() => {
    if (!tree || !focus) return null
    // Mid-growth, draw the blend of the pre-merge and grown trees at the SAME focus, so the two
    // interpolations (re-root and expansion) compose instead of fighting.
    if (morph) return layoutFocalMorph(morph.prev, tree, focus, morph.t, layoutParams)
    return layoutFocal(tree, focus, layoutParams)
  }, [tree, focus, morph, layoutParams])

  return (
    <Scene
      layout={layout}
      needsSeed={!root}
      status={status}
      host={host}
      expand={expand}
      settings={settings}
      onSet={setSetting}
      onToggleExpand={toggleExpand}
      onNodeClick={animateTo}
    />
  )
}

/**
 * A COLLAPSED region: a huddle of dots with its node count, standing in for everything beyond the
 * visible depth. Deliberately NOT clickable — it is a summary, not a place. Re-rooting nearer brings
 * it inside the visible band and it unfolds into its real nodes, inside the wedge it already held.
 */
function Cluster({ node, r }: { node: FNode; r: number }): ReactElement {
  const dots: [number, number, number][] = [
    [-0.45, -0.35, 0.55],
    [0.5, -0.2, 0.45],
    [0.05, 0.45, 0.5],
  ]
  return (
    <g className="au-focal-tree-cluster">
      {dots.map(([dx, dy, s], i) => (
        <circle key={i} cx={node.cx + dx * r} cy={node.cy + dy * r} r={Math.max(2, r * s)} />
      ))}
      <text className="au-focal-tree-cluster-count" x={node.cx + r + 4} y={node.cy + 3}>
        {node.cluster}
      </text>
      <title>{`${node.cluster} nodes — re-root closer to unfold`}</title>
    </g>
  )
}

/**
 * The STRUCTURE OVERLAY: the layout's own geometry drawn as guides.
 *
 * SHELLS are the concentric rings a node's graph distance puts it on. WEDGES are the annular sector
 * each node owns (`angle ± arcSpan/2` over its ring band) — a sunburst read of the same partition, so
 * the weight-balancing and the nesting become visible instead of inferred. Both animate with the
 * layout, because the wedge fields interpolate alongside the positions.
 */
function StructureOverlay({
  nodes,
  shells,
  wedges,
  shellWidth,
  shellWidthFactor,
}: {
  nodes: FNode[]
  shells: boolean
  wedges: boolean
  shellWidth: number
  shellWidthFactor: number
}): ReactElement | null {
  if (!shells && !wedges) return null
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0)
  /** Local ring thickness at a depth (the geometric factor makes it shrink outward). */
  const band = (depth: number): number => shellWidth * Math.pow(shellWidthFactor, Math.max(0, depth - 1))
  const arcPath = (n: FNode): string => {
    const r = Math.hypot(n.cx, n.cy)
    const half = band(n.depth) / 2
    const rIn = Math.max(0, r - half)
    const rOut = r + half
    const a0 = n.angle - n.arcSpan / 2
    const a1 = n.angle + n.arcSpan / 2
    const large = n.arcSpan > Math.PI ? 1 : 0
    const p = (rr: number, a: number): string => `${rr * Math.cos(a)} ${rr * Math.sin(a)}`
    return (
      `M ${p(rIn, a0)} L ${p(rOut, a0)} A ${rOut} ${rOut} 0 ${large} 1 ${p(rOut, a1)}` +
      ` L ${p(rIn, a1)} A ${rIn} ${rIn} 0 ${large} 0 ${p(rIn, a0)} Z`
    )
  }
  return (
    <g className="au-focal-tree-overlay">
      {shells &&
        Array.from({ length: maxDepth }, (_, i) => i + 1).map((d) => (
          <circle
            key={d}
            className="au-focal-tree-shell"
            cx={0}
            cy={0}
            r={ringRadius(d, shellWidth, shellWidthFactor)}
          />
        ))}
      {wedges &&
        nodes
          .filter((n) => n.depth > 0 && n.arcSpan > 0 && n.arcSpan < 2 * Math.PI - 1e-6)
          .map((n) => <path key={n.id} className="au-focal-tree-wedge" d={arcPath(n)} />)}
    </g>
  )
}

/** One labelled row in the settings popover. */
function Row({ label, hint, children }: { label: string; hint: string; children: ReactElement }): ReactElement {
  return (
    <label className="au-focal-tree-row" title={hint}>
      {label && <span>{label}</span>}
      {children}
    </label>
  )
}

/**
 * The live tuning popover. Every knob here is also a config field; this is the twiddle-and-look path,
 * persisted per pane. Walk knobs (depth / direction / kinds / per-read cap) re-read the neighborhood;
 * layout and readability knobs apply on the next frame.
 */
function SettingsPanel({
  settings: s,
  onSet,
}: {
  settings: Settings
  onSet: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}): ReactElement {
  const num = (key: keyof Settings, min: number, max: number, step: number): ReactElement =>
    createElement('au-number-input', { value: s[key], min, max, step, label: key, size: 'sm',
      'onau-change': (event: CustomEvent<{value: number | null}>) => {
        if (event.detail.value !== null) onSet(key as never, event.detail.value as never)
      },
    })
  const slider = (key: keyof Settings, min: number, max: number, step: number): ReactElement => (
    <span className="au-focal-tree-slider">
      {createElement('au-slider', { value: s[key], min, max, step, label: key,
        'onau-input': (event: CustomEvent<{value: number}>) => onSet(key as never, event.detail.value as never),
      })}
      <em>{(s[key] as number).toFixed(2)}</em>
    </span>
  )
  const check = (key: keyof Settings): ReactElement =>
    createElement('au-checkbox', { checked: s[key], label: key === 'showShells' ? 'Depth rings' : 'Branch sectors',
      'onau-change': (event: CustomEvent<{checked: boolean}>) => onSet(key as never, event.detail.checked as never),
    })
  const toggleKind = (kind: WireNeighborhoodKind): void => {
    const next = s.kinds.includes(kind) ? s.kinds.filter((k) => k !== kind) : [...s.kinds, kind]
    onSet('kinds', next.length ? next : [kind]) // never leave the walk with nothing to follow
  }

  return (
    <div className="au-focal-tree-tuning">
      {createElement('au-settings-section', { heading: 'Layout', compact: true }, <>
      <Row label="ring width" hint="Distance between concentric rings, in px.">
        {num('shellWidth', 20, 400, 10)}
      </Row>
      <Row
        label="ring falloff"
        hint="Geometric ring spacing. Below 1 each ring outward is narrower: near context spreads, far context compresses."
      >
        {slider('shellWidthFactor', 0.4, 1.2, 0.05)}
      </Row>
      <Row
        label="wedge weight"
        hint="How hard angular share follows subtree size. 0 = every wedge equal, 1 = fully proportional."
      >
        {slider('wedgeWeightExp', 0, 1, 0.05)}
      </Row>
      <Row label="visible depth" hint="Last ring drawn in full; beyond it a region collapses into one cluster node.">
        {num('visibleDepth', 1, 8, 1)}
      </Row>

      <h4>readability</h4>
      <Row label="label depth" hint="How many rings out still carry a text label.">
        {num('labelDepth', 0, 8, 1)}
      </Row>
      <Row label="node scale" hint="Relative marker size, bounded on screen so the focus and nearby files stay readable.">
        {slider('nodeScale', 0.1, 1.5, 0.05)}
      </Row>
      <Row label="animation ms" hint="Duration of a re-root and of a growth arrival.">
        {num('animationMs', 0, 2000, 50)}
      </Row>
      <Row label="" hint="Draw the concentric depth rings.">
        {check('showShells')}
      </Row>
      <Row label="" hint="Draw each node's angular sector — a sunburst read of the partition.">
        {check('showWedges')}
      </Row>

      </>)}
      {createElement('au-settings-section', { heading: 'Reference walk', description: 'Changes reread the neighborhood.', compact: true }, <>
      <Row label="seed depth" hint="Hop count of the neighborhood walk around the seed.">
        {num('depth', 1, 6, 1)}
      </Row>
      <Row label="direction" hint="Which edges to walk: outbound, inbound, or both.">
        <select
          value={s.direction}
          onChange={(e) => onSet('direction', e.target.value as WireNeighborhoodDirection)}
        >
          <option value="both">both</option>
          <option value="out">out</option>
          <option value="in">in</option>
        </select>
      </Row>
      <Row label="kinds" hint="Which reference kinds the walk follows. At least one stays on.">
        <span className="au-focal-tree-kinds">
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              className={`au-focal-tree-chip${s.kinds.includes(k) ? ' on' : ''}`}
              aria-pressed={s.kinds.includes(k)}
              aria-label={k}
              onClick={() => toggleKind(k)}
              type="button"
            >
              {k.slice(0, 3)}
            </button>
          ))}
        </span>
      </Row>
      <Row label="read cap" hint="Max nodes ONE neighborhood read may return.">
        {num('readMaxNodes', 25, 1000, 25)}
      </Row>

      </>)}
      {createElement('au-settings-section', { heading: 'Growth', compact: true }, <>
      <Row label="expand depth" hint="Hop count of the read fired when a re-root settles.">
        {num('expandDepth', 1, 4, 1)}
      </Row>
      <Row label="node cap" hint="Expansion stops once the loaded tree reaches this many nodes.">
        {num('maxNodes', 50, 5000, 50)}
      </Row>
      </>)}
    </div>
  )
}

/** The SVG scene: pan/zoom camera over the positioned nodes + edges. */
function Scene({
  layout,
  needsSeed,
  status,
  host,
  expand,
  settings,
  onSet,
  onToggleExpand,
  onNodeClick,
}: {
  layout: Layout | null
  needsSeed: boolean
  status: string
  host: MountHost
  expand: boolean
  settings: Settings
  onSet: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  onToggleExpand: () => void
  onNodeClick: (id: string) => void
}): ReactElement {
  const [size, setSize] = useState({ w: 0, h: 0 })
  const materialId = useId().replace(/:/g, '')
  const grain = useMemo(createNodeGrain, [])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const cameraReady = useRef(false)
  const cameraFrame = useRef<number | undefined>(undefined)
  const [panel, setPanel] = useState(false)
  const [panelLayer, setPanelLayer] = useState<HTMLElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const stored = host.viewStore.get('camera') as { tx: number; ty: number; scale: number } | undefined
  const [cam, setCam] = useState(stored ?? { tx: 0, ty: 0, scale: 1 })
  const camRef = useRef(cam)
  camRef.current = cam
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const persistCam = useCallback(
    (next: typeof cam) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => host.viewStore.set(next, 'camera'), 400)
    },
    [host],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const svg = el.querySelector('svg.au-focal-tree-svg')!
    const ro = new ResizeObserver(() => setSize({ w: svg.clientWidth, h: svg.clientHeight }))
    ro.observe(svg)
    return () => {
      ro.disconnect()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (cameraFrame.current !== undefined) cancelAnimationFrame(cameraFrame.current)
    }
  }, [])

  const fit = (): void => {
    if (!layout?.nodes.length) return
    if (cameraFrame.current !== undefined) cancelAnimationFrame(cameraFrame.current)
    const from = camRef.current, target = fitCamera(layout.nodes, size.w, size.h)
    const time = getComputedStyle(containerRef.current!).getPropertyValue('--au-m-slow').trim()
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : parseFloat(time) * (time.endsWith('ms') ? 1 : 1000)
    const start = performance.now()
    const tick = (now: number): void => {
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1
      const ease = 1 - Math.pow(1 - t, 3)
      setCam({ tx: from.tx + (target.tx - from.tx) * ease, ty: from.ty + (target.ty - from.ty) * ease, scale: from.scale + (target.scale - from.scale) * ease })
      if (t < 1) cameraFrame.current = requestAnimationFrame(tick)
      else persistCam(target)
    }
    cameraFrame.current = requestAnimationFrame(tick)
  }
  useEffect(() => {
    if (cameraReady.current || !layout?.nodes.length || !size.w || !size.h) return
    cameraReady.current = true
    if (!stored) setCam(fitCamera(layout.nodes, size.w, size.h))
  }, [layout, size, stored])

  useEffect(() => {
    if (!panel || !containerRef.current) return
    let mounted = true
    const trigger = containerRef.current.querySelector<HTMLElement>('[data-settings-trigger]')
    const restoreFocus = (): void => { if (trigger?.isConnected) trigger.focus() }
    if (!host.popover || !trigger) {
      const keydown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        setPanel(false)
        restoreFocus()
      }
      const parent = containerRef.current
      parent.addEventListener('keydown', keydown)
      return () => { parent.removeEventListener('keydown', keydown) }
    }
    const handle = host.popover.open(trigger.getBoundingClientRect(), (element) => {
      const scope = containerRef.current?.closest('[data-au-scope]')?.getAttribute('data-au-scope')
      if (scope) element.setAttribute('data-au-scope', scope)
      setPanelLayer(element)
    }, () => {
      if (!mounted) return
      setPanel(false)
      setPanelLayer(null)
      restoreFocus()
    })
    return () => { mounted = false; handle.close() }
  }, [panel, host])

  useEffect(() => {
    if (!panel) return
    const frame = requestAnimationFrame(() => {
      const content = panelLayer ?? containerRef.current
      content?.querySelector<HTMLElement>('.au-focal-tree-panel au-checkbox')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [panel, panelLayer])

  // CMD+HOVER PEEK: cmd/ctrl-hover a node → the host's shared preview overlay shows that file, the
  // same affordance (and the same 240ms dwell + sticky + surface-owned dismissal) the editor,
  // backlinks, and type-list already use. A cluster is not peekable — it is a summary, not a file.
  useEffect(() => {
    const surface = host.preview
    const el = containerRef.current
    if (!surface || !el) return
    const content = makeHoverContent(host.engine)
    let modHeld = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastPointer: { x: number; y: number } | null = null
    const clearTimer = (): void => {
      if (timer) clearTimeout(timer)
      timer = undefined
    }
    const manageHover = (x: number, y: number): void => {
      if (surface.isOver(x, y)) return clearTimer() // sticky: the pointer is in the card
      const hit = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
        '[data-focal-path]',
      ) as HTMLElement | null
      const path = modHeld ? hit?.dataset.focalPath : undefined
      if (!path) return clearTimer() // the surface's cones own dismissal — don't hide here
      const key = `focal:${path}`
      if (surface.isShowing(key)) return
      clearTimer()
      timer = setTimeout(() => {
        surface.show(
          key,
          hit!.getBoundingClientRect(),
          content.previewPath(path),
          (p) => content.previewPath(p),
          (p) => host.intent.fire(openIntent(fileSelection(p))),
        )
      }, 240)
    }
    const onMove = (e: MouseEvent): void => {
      // Read the modifier off the move event: a keyup is missed when the window loses focus while
      // cmd is held, which would otherwise leave `modHeld` stuck and peek on a plain hover.
      modHeld = e.metaKey || e.ctrlKey
      lastPointer = { x: e.clientX, y: e.clientY }
      manageHover(e.clientX, e.clientY)
    }
    const onModKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Meta' && e.key !== 'Control') return
      modHeld = e.metaKey || e.ctrlKey
      if (lastPointer) manageHover(lastPointer.x, lastPointer.y)
    }
    const onBlur = (): void => {
      modHeld = false
      clearTimer()
    }
    el.addEventListener('mousemove', onMove)
    window.addEventListener('keydown', onModKey)
    window.addEventListener('keyup', onModKey)
    window.addEventListener('blur', onBlur)
    return () => {
      clearTimer()
      el.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onModKey)
      window.removeEventListener('keyup', onModKey)
      window.removeEventListener('blur', onBlur)
      surface.hide()
    }
  }, [host])

  const drag = useRef<{ x: number; y: number; distance: number } | null>(null)
  const dragged = useRef(false)
  const activateNode = (id: string): void => { if (!dragged.current) onNodeClick(id) }
  const [grabbing, setGrabbing] = useState(false)
  const onDown = (e: RMouseEvent): void => {
    if (e.button !== 0) return
    if (cameraFrame.current !== undefined) cancelAnimationFrame(cameraFrame.current)
    drag.current = { x: e.clientX, y: e.clientY, distance: 0 }
    dragged.current = false
    setGrabbing(true)
  }
  const onMove = (e: RMouseEvent): void => {
    setHoveredId((e.target as Element).closest('[data-focal-id]')?.getAttribute('data-focal-id') ?? null)
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY, distance: drag.current.distance + Math.hypot(dx, dy) }
    dragged.current = drag.current.distance > 3
    setCam((c) => {
      const next = { ...c, tx: c.tx + dx, ty: c.ty + dy }
      persistCam(next)
      return next
    })
  }
  const endDrag = (): void => {
    drag.current = null
    setGrabbing(false)
  }
  const onWheel = (e: RWheelEvent): void => {
    if (cameraFrame.current !== undefined) cancelAnimationFrame(cameraFrame.current)
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setCam((c) => {
      const next = { ...c, scale: Math.min(4, Math.max(0.1, c.scale * factor)) }
      persistCam(next)
      return next
    })
  }

  const screenNodes = (layout?.nodes ?? []).map(n => ({ ...n,
    x: size.w / 2 + cam.tx + n.cx * cam.scale,
    y: size.h / 2 + cam.ty + n.cy * cam.scale,
    label: n.label.replace(/\.(md|markdown)$/, ''),
    r: markerRadius(n.radius, settings.nodeScale, cam.scale, n.depth),
  }))
  const byId = new Map(screenNodes.map(n => [n.id, n]))
  const hoveredNode = hoveredId ? byId.get(hoveredId) : undefined
  const focusNode = screenNodes.reduce<(typeof screenNodes)[number] | undefined>((best, n) => !best || n.depth < best.depth ? n : best, undefined)
  const inView = screenNodes.filter(n => n.x >= n.r && n.x <= size.w - n.r && n.y >= n.r && n.y <= size.h - n.r).length
  const measure = useMemo(() => {
    const ctx = document.createElement('canvas').getContext('2d')!
    const style = containerRef.current ? getComputedStyle(containerRef.current) : null
    ctx.font = `${style?.getPropertyValue('--au-focal-tree-label-size').trim() || '11px'} ${style?.fontFamily || 'sans-serif'}`
    return (text: string): number => ctx.measureText(text).width
  }, [size.w])
  const labels = placeLabels(screenNodes, size.w, size.h, settings.labelDepth, measure)
  const transform = `translate(${size.w / 2 + cam.tx} ${size.h / 2 + cam.ty}) scale(${cam.scale})`
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
  const iconButton = (label: string, icon: string, action: () => void, expanded?: boolean): ReactElement =>
    createElement('au-icon-button', { size: 'xs', label, 'aria-expanded': expanded, 'data-settings-trigger': expanded === undefined ? undefined : '', onClick: action }, createElement('au-icon', { name: icon, size: 'sm' }))

  const settingsContent = createElement('au-popover', { className: 'au-focal-tree-panel', heading: 'Focal tree', arrow: false, scrollable: true },
          <>
            {createElement('au-checkbox', { checked: expand, label: 'Expand as you explore', 'onau-change': onToggleExpand })}
            <SettingsPanel settings={settings} onSet={onSet} />
            <details className="au-focal-tree-help"><summary>Reading this tree</summary>
            <p className="au-focal-tree-explainer">Click to move through references. {modifier}-hover to preview without moving.</p>
            <p className="au-focal-tree-explainer">Distant branches fold into counted groups. Move closer to reveal them. Not every graph connection is drawn.</p>
            <div className="au-focal-tree-legend" aria-label="Node colors">
              <span><i className="focus" />Focus</span><span><i className="seed" />Original seed</span>
              <span><i className="out" />Outgoing link</span><span><i className="in" />Incoming link</span>
              <span><i className="cluster" />Collapsed branch</span><span><i className="field" />Field link</span>
            </div>
            <p className="au-focal-tree-explainer">Link colors describe each node’s relationship to its original tree parent. Unfocused nodes retain those colors as you move.</p>
            </details>
          </>)

  return (
    <div className="au-focal-tree" ref={containerRef}>
      <div className="au-focal-tree-header">
      <div className="au-focal-tree-status" title={`${focusNode?.data?.path ? displayFilePath(focusNode.data.path, host.workspace.members) : 'Focal tree'} · ${status}. ${inView} of ${screenNodes.length} markers in view. A spanning tree of references; some graph connections are not drawn.`}><strong>{focusNode?.label.replace(/\.(md|markdown|yaml|yml)$/, '') ?? 'Focal tree'}</strong><span hidden={needsSeed} className="au-focal-tree-loading" role="status">{status === 'loading…' && createElement('au-spinner', { size: 'sm', 'aria-hidden': true })}{status}</span></div>
      <div className="au-focal-tree-links">
        {iconButton('Fit neighborhood', 'maximize', fit)}
        {iconButton('Focal tree settings', 'gear', () => setPanel(v => !v), panel)}
      </div>
      </div>
      {panel && (panelLayer ? createPortal(settingsContent, panelLayer) : !host.popover ? settingsContent : null)}
      {needsSeed && createElement('au-scroll-area', { className: 'au-focal-tree-guidance', axis: 'y' }, createElement('au-empty-state', { label: 'Explore a file’s references', hint: 'Select a file in a connected pane, or open a file into this view, to explore its reference neighborhood. Select a node to move the focus.' }))}
      <svg style={needsSeed ? { display: 'none' } : undefined} className={`au-focal-tree-svg${grabbing ? ' grabbing' : ''}`} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={endDrag} onMouseLeave={() => { endDrag(); setHoveredId(null) }} onWheel={onWheel}>
        <defs>
          <radialGradient id={materialId} cx="28%" cy="20%" r="90%">
            <stop offset="0" stopColor="white" stopOpacity=".26" />
            <stop offset=".6" stopColor="white" stopOpacity="0" />
            <stop offset="1" stopColor="black" stopOpacity=".22" />
          </radialGradient>
          <pattern id={`${materialId}-grain`} width="1" height="1" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox"><image href={grain} width="1" height="1" preserveAspectRatio="none" /></pattern>
        </defs>
        <g transform={transform}><StructureOverlay nodes={layout?.nodes ?? []} shells={settings.showShells} wedges={settings.showWedges} shellWidth={settings.shellWidth} shellWidthFactor={settings.shellWidthFactor} /></g>
        {layout?.edges.map(e => {
          const a = byId.get(e.sourceId), b = byId.get(e.targetId)
          if (!a || !b) return null
          const ends = clippedEdge(a, b)
          return ends && <line key={`${e.sourceId}:${e.targetId}`} className={`au-focal-tree-edge${b.data?.edgeKind === 'field' ? ' field' : ''}`} x1={ends[0].x} y1={ends[0].y} x2={ends[1].x} y2={ends[1].y} />
        })}
        {screenNodes.filter(n => !n.cluster).map(n => <circle key={n.id} className="au-focal-tree-hit" cx={n.x} cy={n.y} r={n.r + 6} data-focal-id={n.id} data-focal-path={n.data?.path} onClick={ev => { ev.stopPropagation(); activateNode(n.id) }} />)}
        {labels.map(label => {
          const node = byId.get(label.id)!
          return <text key={label.id} className="au-focal-tree-label" x={label.x} y={label.y + 11} data-focal-id={node.id} data-focal-path={node.data?.path} onClick={ev => { ev.stopPropagation(); activateNode(node.id) }}><title>{node.label} · Click to focus · {modifier}-hover to preview</title>{label.text}</text>
        })}
        {screenNodes.map(n => n.cluster ? <Cluster key={n.id} node={{...n, cx:n.x, cy:n.y}} r={n.r} /> :
          <g key={n.id} className="au-focal-tree-nodeg" data-focused={n.depth === 0} data-hovered={hoveredId === n.id}>
            <circle className="au-focal-tree-focus-ring" cx={n.x} cy={n.y} r={n.r + 3} opacity={Math.max(0, 1 - n.depth)} />
            <circle className="au-focal-tree-node" role="button" tabIndex={0} aria-label={`Focus ${n.data?.path ?? n.label}`} onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); activateNode(n.id) } }} cx={n.x} cy={n.y} r={n.r} fill={nodeColor(n)} data-focal-id={n.id} data-focal-path={n.data?.path} onClick={ev => { ev.stopPropagation(); activateNode(n.id) }}><title>{n.label} · Click to focus · {modifier}-hover to preview</title></circle>
            <circle className="au-focal-tree-material" cx={n.x} cy={n.y} r={n.r} fill={`url(#${materialId})`} />
            <circle className="au-focal-tree-grain" cx={n.x} cy={n.y} r={n.r} fill={`url(#${materialId}-grain)`} />
          </g>
        )}
      </svg>
      {hoveredNode && !grabbing && <div className="au-focal-tree-hover">{hoveredNode.label} · {modifier}-hover to preview</div>}
    </div>
  )
}

function mount(container: HTMLElement, host: MountHost): () => void {
  // The CSS is injected through the host so it is `@scope`-confined to this projection's subtree and
  // CSP-exempt (a raw <style> a strict CSP would block).
  const disposeStyles = host.styles?.inject(STYLE, container)
  const root = createRoot(container)
  root.render(<FocalTreeView host={host} />)
  return () => {
    root.unmount()
    disposeStyles?.()
    container.replaceChildren()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
