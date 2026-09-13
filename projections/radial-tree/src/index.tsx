import { displayFilePath } from '@arsumbris/au-host-sdk'
// radial-tree projection: a file's REFERENCE NEIGHBORHOOD (the schema-20 `neighborhood` read)
// laid out as a radial tree. The focal file is the centre; its inbound / outbound references fan
// out on concentric shells, walked N hops. Generalized beyond MOC — the root is ANY file.
//
// A full citizen of the cross-working host: seeds from the config `root`, else the container's
// SELECTION, else an `open-intent` fired at it; selecting a node RE-ROOTS (transient view-state)
// and publishes the new focal selection. Data is neighborhood-direct via the SDK helpers — no raw
// engine client, no re-declared wire types. CSS is prefixed-global `.au-radial-tree-*`, token-only.

import { createRoot } from 'react-dom/client'
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, MouseEvent as RMouseEvent, WheelEvent as RWheelEvent } from 'react'
import { defineProjection, type Intent, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk'
import {
  readNeighborhood,
  subscribeChanges,
  type WireNeighborhoodDirection,
  type WireNeighborhoodKind,
} from '@arsumbris/au-host-sdk/engine-reads'
import { fileSelection, isFileSelection, type Selection } from '@arsumbris/selection'
import { openIntent, isOpenIntent } from '@arsumbris/intent'
import { computeRadialLayout, type PositionedNode, type RadialLayoutResult } from './lib/radial-layout'
import { neighborhoodToTree, type RadialNodeData } from './lib/neighborhood-to-tree'
import type { TreeNode } from './lib/tree'

const ALL_KINDS: WireNeighborhoodKind[] = ['navigational', 'contributing', 'field']
const MAX_NODES = 250

const STYLE = `
.au-radial-tree { width: 100%; height: 100%; position: relative; overflow: hidden; display: flex; flex-direction: column;
  background: var(--au-radial-tree-bg); font: var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); }
.au-radial-tree-header { display: flex; flex-wrap: wrap; align-items: center; gap: var(--au-space-2); padding: var(--au-space-2) var(--au-space-2-5); flex: none; }
.au-radial-tree-guidance { flex: 1; min-height: 0; }
.au-radial-tree-guidance au-empty-state { max-width: 32rem; }
.au-radial-tree-svg { width: 100%; height: 0; flex: 1; min-height: 0; display: block; cursor: grab; }
.au-radial-tree-svg.grabbing { cursor: grabbing; }
.au-radial-tree-status { display: flex; align-items: center; gap: var(--au-space-1-5); flex: 1 1 10rem; min-width: 0; overflow-wrap: anywhere; color: var(--au-ink-3); }
.au-radial-tree-links { display: flex; flex: none; gap: var(--au-space-1); }
.au-radial-tree-link { background: transparent; cursor: pointer; font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-sans);
  padding: var(--au-space-0-5) var(--au-space-1-5); border-radius: var(--au-radius-sm); color: var(--au-ink-3);
  border: 1px solid var(--au-line-control); }
.au-radial-tree-link:hover { background: var(--au-chrome-hover); color: var(--au-ink-1); }
.au-radial-tree-link.on { color: var(--au-ink-1); background: var(--au-chrome-active); border-color: var(--au-line-control); }
.au-radial-tree-link:focus-visible { outline: 1px solid var(--au-focus-outer); outline-offset: -1px; }
.au-radial-tree-node { cursor: pointer; }
.au-radial-tree-node:focus-visible { outline: 2px solid var(--au-focus-outer); outline-offset: 3px; }
.au-radial-tree-node:hover { stroke: var(--au-radial-tree-root); stroke-width: 1.5px; }
.au-radial-tree-label { fill: var(--au-radial-tree-label);
  font-size: var(--au-radial-tree-label-size); transform: translateY(var(--au-space-1)); pointer-events: none; user-select: none; }
.au-radial-tree-edge { stroke: var(--au-radial-tree-edge); fill: none; }
.au-radial-tree-edge.field { stroke: var(--au-radial-tree-edge-field); }
`

type Layout = RadialLayoutResult<RadialNodeData>
type PNode = PositionedNode<RadialNodeData>

interface Config {
  root?: string
  depth?: number
  direction?: WireNeighborhoodDirection
  // Two independent linkage axes. FOLLOW = consume external file-open (re-seed on others'
  // navigation). DRIVE = fire file-open on re-root (make others navigate to my new root).
  // Both off = locked (isolated). Default: both on (fully linked).
  follow?: boolean
  drive?: boolean
}

/** Lay out a neighborhood tree, splitting hemispheres when `direction` is `both`. */
function layoutTree(
  tree: TreeNode<RadialNodeData>,
  direction: WireNeighborhoodDirection,
  duplicates: Set<string>,
): Layout {
  if (direction !== 'both') {
    return computeRadialLayout(tree, { duplicates })
  }
  // outbound to the right hemisphere, inbound to the left.
  const out: TreeNode<RadialNodeData> = { ...tree, children: tree.children.filter((c) => c.data?.direction === 'out') }
  const inn: TreeNode<RadialNodeData> = { ...tree, children: tree.children.filter((c) => c.data?.direction === 'in') }
  const outL = computeRadialLayout(out, { duplicates, startAngle: -90, angleSpan: 180 })
  const inL = computeRadialLayout(inn, { duplicates, startAngle: 90, angleSpan: 180 })
  return {
    nodes: [...outL.nodes, ...inL.nodes.filter((n) => n.kind !== 'root')],
    edges: [...outL.edges, ...inL.edges],
  }
}

function nodeColor(node: PNode): string {
  if (node.isDuplicate) return 'var(--au-radial-tree-dup)'
  if (node.kind === 'root') return 'var(--au-radial-tree-root)'
  if (node.data?.direction === 'out') return 'var(--au-radial-tree-out)'
  if (node.data?.direction === 'in') return 'var(--au-radial-tree-in)'
  return 'var(--au-radial-tree-node)'
}

/** Whether to draw a persistent label (root, branches, and the first shell); leaves get a tooltip. */
function labelled(node: PNode): boolean {
  return node.kind !== 'leaf' || node.depth <= 1
}

function RadialTreeView({ host }: { host: MountHost }): ReactElement {
  const config = (host.config ?? {}) as Config
  const depth = config.depth ?? 1
  const direction: WireNeighborhoodDirection = config.direction ?? 'out'

  // The focal root is transient view-state: the config `root` is the authored default; a prior
  // re-root persists in the view store. Config wins on first mount only if nothing was stored.
  const storedRoot = host.viewStore.get('root') as string | undefined
  const [root, setRoot] = useState<string | null>(storedRoot ?? config.root ?? null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [status, setStatus] = useState<string>('select a file to see its reference neighborhood')

  // Two linkage axes, runtime toggles (transient view-state) over the authored config defaults.
  // FOLLOW: consume external file-open. DRIVE: fire file-open on re-root. Both off = locked.
  const storedFollow = host.viewStore.get('follow') as boolean | undefined
  const storedDrive = host.viewStore.get('drive') as boolean | undefined
  const [follow, setFollow] = useState<boolean>(storedFollow ?? config.follow ?? true)
  const [drive, setDrive] = useState<boolean>(storedDrive ?? config.drive ?? true)

  const aliveRef = useRef(true)
  const rootRef = useRef(root)
  rootRef.current = root
  const followRef = useRef(follow)
  followRef.current = follow
  const driveRef = useRef(drive)
  driveRef.current = drive

  const toggleFollow = useCallback((): void => {
    setFollow((v) => {
      const next = !v
      host.viewStore.set(next, 'follow')
      return next
    })
  }, [host])
  const toggleDrive = useCallback((): void => {
    setDrive((v) => {
      const next = !v
      host.viewStore.set(next, 'drive')
      return next
    })
  }, [host])

  // Drop async continuations that resolve after unmount.
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Set the focal file + persist it (transient). `rootRef` is updated SYNCHRONOUSLY so a
  // same-tick open-intent fire (drive) sees the new root and declines its own echo.
  const applyRoot = useCallback(
    (path: string): void => {
      if (path === rootRef.current) return
      rootRef.current = path
      setRoot(path)
      host.viewStore.set(path, 'root')
    },
    [host],
  )

  // A node-click re-root is EXPLICIT: apply, then (if driving) broadcast — publish the focal
  // selection so linked panes track, and fire an open-intent so a focused editor navigates.
  const reRoot = useCallback(
    (path: string): void => {
      if (path === rootRef.current) return
      applyRoot(path)
      if (driveRef.current) {
        host.selection.publish(fileSelection(path))
        host.intent.fire(openIntent(fileSelection(path)))
      }
    },
    [applyRoot, host],
  )

  const load = useCallback(
    async (path: string): Promise<void> => {
      setStatus('loading…')
      const outcome = await readNeighborhood(host.engine, {
        path,
        direction,
        depth,
        max_nodes: MAX_NODES,
        ...(depth > 1 ? { kinds: ALL_KINDS } : {}),
      })
      if (!aliveRef.current || rootRef.current !== path) return // superseded
      if ('ok' in outcome) {
        setStatus(outcome.error)
        setLayout(null)
        return
      }
      if (!outcome.ready) {
        setStatus('engine not ready')
        return
      }
      const { tree, duplicates } = neighborhoodToTree(outcome.result, path)
      if (!tree) {
        setStatus(`no node for ${path}`)
        setLayout(null)
        return
      }
      const result = layoutTree(tree, direction, duplicates)
      setLayout(result)
      const edgeCount = result.edges.length
      setStatus(`${result.nodes.length} nodes, ${edgeCount} edge${edgeCount === 1 ? '' : 's'}`)
    },
    [host, depth, direction],
  )

  // (Re)load whenever the focal root changes.
  useEffect(() => {
    if (root) void load(root)
    else setLayout(null)
  }, [root, load])

  // Re-read on engine changes + recover on the daemon-ready edge.
  useEffect(() => {
    const offChanges = subscribeChanges(host.engine, () => {
      if (rootRef.current) void load(rootRef.current)
    })
    const offReady = host.engineReady?.subscribe((ready) => {
      if (ready && rootRef.current) void load(rootRef.current)
    })
    return () => {
      offChanges()
      offReady?.()
    }
  }, [host, load])

  // FOLLOW (inbound, half 1): the container's selection re-seeds us. Ignored when follow is off.
  useEffect(() => {
    return host.selection.follow((value) => {
      if (!followRef.current) return
      if (!value || typeof value !== 'object') return
      const sel = value as Selection
      if (isFileSelection(sel)) applyRoot(sel.path)
    })
  }, [host, applyRoot])

  // FOLLOW (inbound, half 2): an open-intent fired at us. When following, re-seed + CLAIM — UNLESS
  // its target is already our root (nothing to do → DECLINE so it routes on to an editor; this is
  // also what lets our OWN drive-fired open reach the editor). Not following → decline always.
  useEffect(() => {
    return host.intent.handle('open-intent', {
      claim: (intent: Intent) => {
        if (!followRef.current) return false
        if (!isOpenIntent(intent)) return false
        const target = intent.target
        if (!(target && typeof target === 'object' && isFileSelection(target as Selection))) return false
        return (target as Selection & { path: string }).path !== rootRef.current // already here → decline, let an editor take it
      },
      commit: (intent: Intent) => {
        if (!isOpenIntent(intent)) return
        const target = intent.target
        if (!(target && typeof target === 'object' && isFileSelection(target as Selection))) return
        applyRoot((target as Selection & { path: string }).path)
      },
    })
  }, [host, applyRoot])

  return (
    <Scene
      layout={layout}
      needsSeed={!root}
      status={status}
      host={host}
      follow={follow}
      drive={drive}
      onToggleFollow={toggleFollow}
      onToggleDrive={toggleDrive}
      onReRoot={reRoot}
    />
  )
}

/** The SVG scene: pan/zoom camera over the positioned nodes + edges. */
function Scene({
  layout,
  needsSeed,
  status,
  host,
  follow,
  drive,
  onToggleFollow,
  onToggleDrive,
  onReRoot,
}: {
  layout: Layout | null
  needsSeed: boolean
  status: string
  host: MountHost
  follow: boolean
  drive: boolean
  onToggleFollow: () => void
  onToggleDrive: () => void
  onReRoot: (path: string) => void
}): ReactElement {
  const [size, setSize] = useState({ w: 800, h: 600 })
  const containerRef = useRef<SVGSVGElement | null>(null)

  // Camera: {tx, ty, scale}, restored from + persisted to the view store (transient).
  const stored = host.viewStore.get('camera') as { tx: number; ty: number; scale: number } | undefined
  const [cam, setCam] = useState(stored ?? { tx: 0, ty: 0, scale: 1 })
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
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Drag to pan.
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const onDown = (e: RMouseEvent): void => {
    drag.current = { x: e.clientX, y: e.clientY }
    setGrabbing(true)
  }
  const onMove = (e: RMouseEvent): void => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY }
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
  // Wheel to zoom (centre-anchored).
  const onWheel = (e: RWheelEvent): void => {
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setCam((c) => {
      const next = { ...c, scale: Math.min(4, Math.max(0.1, c.scale * factor)) }
      persistCam(next)
      return next
    })
  }

  const edgeById = useMemo(() => {
    const m = new Map<string, PNode>()
    if (layout) for (const n of layout.nodes) m.set(n.id, n)
    return m
  }, [layout])

  const transform = `translate(${size.w / 2 + cam.tx} ${size.h / 2 + cam.ty}) scale(${cam.scale})`

  return (
    <div className="au-radial-tree">
      <div className="au-radial-tree-header">
      <div className="au-radial-tree-status" role="status">{status === 'loading…' && createElement('au-spinner', { size: 'sm', 'aria-hidden': true })}{needsSeed ? 'Radial tree' : status}</div>
      <div className="au-radial-tree-links">
        <button
          type="button"
          className={`au-radial-tree-link${follow ? ' on' : ''}`}
          onClick={onToggleFollow}
          title={follow ? 'Follow ON — re-seeds when you navigate elsewhere' : 'Follow OFF — ignores external navigation'}
          aria-pressed={follow}
        >
          ↓ follow
        </button>
        <button
          type="button"
          className={`au-radial-tree-link${drive ? ' on' : ''}`}
          onClick={onToggleDrive}
          title={drive ? 'Drive ON — opens the file elsewhere when you re-root' : 'Drive OFF — re-rooting stays local'}
          aria-pressed={drive}
        >
          ↑ drive
        </button>
      </div>
      </div>
      {needsSeed && createElement('au-scroll-area', { className: 'au-radial-tree-guidance', axis: 'y', content: 'center' }, createElement('au-empty-state', { label: 'Explore a file’s references', hint: follow ? 'Select a file in a connected pane, or open a file into this view, to explore its references. Select a node to center it.' : 'Turn on Follow to receive a file from a connected pane or an open action. Drive controls whether selecting a node also navigates other panes.' }))}
      <svg style={needsSeed ? { display: 'none' } : undefined}
        ref={containerRef}
        className={`au-radial-tree-svg${grabbing ? ' grabbing' : ''}`}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={onWheel}
      >
        <g transform={transform}>
          {layout?.edges.map((e, i) => {
            const target = edgeById.get(e.targetId)
            const field = target?.data?.edgeKind === 'field'
            return (
              <line
                key={i}
                className={`au-radial-tree-edge${field ? ' field' : ''}`}
                x1={e.sourceX}
                y1={e.sourceY}
                x2={e.targetX}
                y2={e.targetY}
                strokeWidth={1}
              />
            )
          })}
          {layout?.nodes.map((n) => (
            <g key={n.id}>
              <circle
                className="au-radial-tree-node"
                role={n.data ? "button" : undefined}
                tabIndex={n.data ? 0 : undefined}
                aria-label={`Focus ${n.data?.path ?? n.label}`}
                onKeyDown={(ev) => {
                  if (n.data && (ev.key === "Enter" || ev.key === " ")) {
                    ev.preventDefault(); ev.stopPropagation(); onReRoot(n.data.path)
                  }
                }}
                cx={n.x}
                cy={n.y}
                r={Math.max(2, n.size)}
                fill={nodeColor(n)}
                onClick={(ev) => {
                  ev.stopPropagation()
                  if (n.data) onReRoot(n.data.path)
                }}
              >
                <title>{n.data?.path ? displayFilePath(n.data.path, host.workspace.members) : n.label}</title>
              </circle>
              {labelled(n) && (
                <text className="au-radial-tree-label" x={n.x} y={n.y + Math.max(2, n.size)} dy="1em">
                  {n.label}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}

function mount(container: HTMLElement, host: MountHost): () => void {
  // The CSS is injected through the host so it is `@scope`-confined to this projection's subtree and
  // CSP-exempt (a raw <style> a strict CSP would block).
  const disposeStyles = host.styles?.inject(STYLE, container)
  const root = createRoot(container)
  const view = <RadialTreeView host={host} />
  // Track liveness so async continuations after unmount are dropped.
  root.render(view)
  return () => {
    root.unmount()
    disposeStyles?.()
    container.replaceChildren()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
