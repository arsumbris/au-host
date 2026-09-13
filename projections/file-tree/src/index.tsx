import { displayFilePath } from '@arsumbris/au-host-sdk'
// File-tree projection over engine file reads and subscriptions. The tree separates
// authoring roots from consumed dependencies, supports inline search and contextual
// actions, and opens selected content through the intent channel.

import { createRoot } from 'react-dom/client'
import { stableOpenSurfaces } from './stable-open-surfaces'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  defineProjection,
  viewersFor,
  descriptorTitle,
  bareTypeName,
  type ContextMenuItem,
  type MountHost,
  type OpenSurface,
  type ProjectionModule,
} from '@arsumbris/au-host-sdk'
import {
  readDirEntries,
  readReferencesIn,
  readDiagnostics,
  subscribeDiagnostics,
  subscribeFiles,
  subscribeChanges,
  type WireReferenceIn,
  type WireDiagnostic,
  type WireDiagnosticSeverity,
  type WireDirEntry,
} from '@arsumbris/au-host-sdk/engine-reads'
import { fileSelection, isFileSelection, type Selection } from '@arsumbris/selection'
import { notificationIntent, openIntent, openPaneIntent, showPaneIntent, highlightIntent, revealPaneIntent, type OpenIntent } from '@arsumbris/intent'
import { makeHoverContent } from '@arsumbris/preview-content'
import { useDragStart, CONTENT_SOURCE_KIND, registerDropTarget, isContentDropHit, dragStore } from '@arsumbris/container-kit'
// The generated React wrappers (set-independent — render the tag, import no set class) + the JSX-type
// augmentation for the still-intrinsic <au-*> elements (the import runs the augmentation as a side effect).
import { AuSectionHeader, AuNavGroup, AuTreeRow, AuBadge, AuButton, AuInput, AuScrollArea, type AuTreeRowProps } from '@arsumbris/au-component-catalog/react'
import type { FileTree } from './generated.ts'

// Worst-first severity order (mirrors the diagnostics projection); index 0 = worst.
const DX_SEVERITY: WireDiagnosticSeverity[] = ['error', 'warning', 'drift', 'hint']
// The <au-badge> tone per severity — hue only where it is a genuine status: an error is danger, a
// warning is warn, the softer tiers stay the neutral ink chip.
const DX_TONE: Record<WireDiagnosticSeverity, 'ink' | 'ok' | 'warn' | 'danger'> = { error: 'danger', warning: 'warn', drift: 'ink', hint: 'ink' }

/** Directories first, then case-insensitive by name. */
function dirsFirst(a: WireDirEntry, b: WireDirEntry): number {
  const ad = a.kind === 'directory'
  const bd = b.kind === 'directory'
  if (ad !== bd) return ad ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** Every ancestor DIRECTORY of `path` inside its owning member, deepest-first, EXCLUDING the member
 *  root (its children are always loaded) — the folders reveal must unfold to surface a row. */
function ancestorDirs(path: string, memberRoot: string): string[] {
  const out: string[] = []
  for (
    let p = path.slice(0, path.lastIndexOf('/'));
    p.length > memberRoot.length && p.startsWith(memberRoot + '/');
    p = p.slice(0, p.lastIndexOf('/'))
  ) {
    out.push(p)
  }
  return out
}

/** A brief background pulse on a revealed row (the warm chrome-active fill, never an accent bar). */
function flashRow(el: HTMLElement): void {
  el.classList.remove('au-ft-reveal-flash')
  void el.offsetWidth
  el.classList.add('au-ft-reveal-flash')
}

/** Fold activity into the closest rendered row without opening a collapsed subtree. */
function changeRow(root: HTMLElement | null, path: string): HTMLElement | undefined {
  for (let candidate = path; candidate; candidate = candidate.slice(0, candidate.lastIndexOf('/'))) {
    const row = root?.querySelector<HTMLElement>(`[data-path="${CSS.escape(candidate)}"]`)
    if (row && !row.closest('.au-ft-subtree:not([data-open])')) return row
    if (candidate.lastIndexOf('/') <= 0) break
  }
}

/** Batch the animation reset: ten writes under one closed folder produce one flash. */
function flashChangedRows(rows: Set<HTMLElement>): void {
  for (const row of rows) row.classList.remove('au-ft-reveal-flash')
  const first = rows.values().next().value
  if (first) void first.offsetWidth
  for (const row of rows) row.classList.add('au-ft-reveal-flash')
}

// Deletion requires confirmation. This projection currently uses a fixed default
// rather than a shared settings preference.
const confirmBeforeDelete = (): boolean => true

// The projection's own sheet: layout + the expand/collapse motion + the hover guide state. The <au-*>
// components self-style in shadow, so this is thin. Injected via host.styles.inject at mount.
const STYLE = `
.au-ft-diagnostics-action::part(button) { padding-inline:var(--au-space-0-5); height:var(--au-space-6); min-width:var(--au-space-6); }

@keyframes au-ft-reveal-flash { from { background-color: var(--au-chrome-active); } to { background-color: transparent; } }
.au-ft-reveal-flash { animation: au-ft-reveal-flash var(--au-m-cinema) var(--au-e-std); }
@media (prefers-reduced-motion: reduce) { .au-ft-reveal-flash { animation: none; } }
.au-ft {
  height: 100%; width: 100%; min-height: 0;
  display: flex; flex-direction: column;
  background: transparent;
  font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  overflow: hidden;
}
.au-ft-filter {
  flex: none; display: flex; align-items: center;
  margin-block-start: var(--au-space-2);
  padding: 0 var(--au-space-3) var(--au-space-2);
}
.au-ft-filter au-input { flex: 1 1 auto; min-width: 0; }
.au-ft-status { flex: none; padding: var(--au-space-1, 4px) var(--au-space-2, 8px); color: var(--au-ink-4, #777); font-size: var(--au-t-xs,12px); font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace); }
/* The "Open editors" section — a fixed collapsible header above the scrolling tree. */
.au-ft-open-editors { flex: none; padding: var(--au-space-2, 8px) var(--au-space-3, 12px); display: flex; flex-direction: column; gap: var(--au-space-0-5, 2px); background: linear-gradient(var(--au-line-1), var(--au-line-1)) center bottom / calc(100% - var(--au-space-6)) 1px no-repeat; }
.au-ft-viewer-kind { color: var(--au-ink-4, #777); font-size: var(--au-t-xs, 12px); font-weight: var(--au-w-body, 400); }
.au-ft-scroll { flex: 1 1 auto; min-height: 0; }
/* Role clusters (Edit / Discover / Dependency) get the inter-cluster breathing gap. */
.au-ft-groups { padding: var(--au-space-2, 8px) var(--au-space-3, 12px); display: flex; flex-direction: column; gap: var(--au-space-6, 24px); }
/* Within a cluster: the role eyebrow then its member groups, each a step tighter than between clusters. */
.au-ft-cluster { display: flex; flex-direction: column; gap: var(--au-space-1, 4px); }
/* Air scales with content. Two COLLAPSED members are neighbouring rows and read as a list; the moment
   either one opens it becomes a BLOCK and earns a full cluster step on both sides. Both values add to
   the cluster's own gap, so the totals are 12px (list) and 24px (block). The rule lives here because
   the groups are light-DOM siblings — a shadow root cannot reach across two hosts. */
.au-ft-cluster > au-nav-group + au-nav-group { margin-top: var(--au-space-1, 4px); }
.au-ft-cluster > au-nav-group[open] + au-nav-group,
.au-ft-cluster > au-nav-group + au-nav-group[open] { margin-top: var(--au-space-4, 16px); }
/* Hovering the tree fades in every row's nesting guides (each row reads this inherited var in shadow). */
.au-ft-scroll:hover { --au-tree-guide-opacity: 1; }
/* Inline new-file / new-folder input row. */
.au-ft-create { padding-block: var(--au-space-1, 4px); }
/* The animated collapsible subtree — the Accordion measured-height grid (0fr -> 1fr), so a subtree
   eases to its TRUE content height with no magic constant. */
.au-ft-subtree { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)); }
.au-ft-subtree[data-open] { grid-template-rows: 1fr; }
.au-ft-subtree__inner { display: flex; flex-direction: column; gap: var(--au-space-0-5, 2px); overflow: hidden; min-height: 0; opacity: 0; transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)); }
.au-ft-subtree[data-open] .au-ft-subtree__inner { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .au-ft-subtree, .au-ft-subtree__inner { transition: none; } }
/* The folder a content drag is hovering over (a file will move here). Set imperatively on the au-tree-row
   HOST while a content drag hovers it — the host element is in the light DOM, so the injected sheet reaches it. */
au-tree-row[data-drop-active] { outline: 2px solid var(--au-accent-signal, #6ba7ff); outline-offset: -2px; border-radius: var(--au-radius-row,8px); background: color-mix(in oklab, var(--au-accent-signal, #6ba7ff) 12%, transparent); }
`

/** Tracks the OS reduced-motion preference (live), threaded to every Subtree. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

type SubtreePhase = 'closed' | 'entering' | 'open' | 'exiting'

/** The animated collapsible wrapper around a folder's rendered child rows.
 *  A small phase machine: first open animates 0fr->1fr; a restore-on-mount opens
 *  with no animation; a reveal/reduced-motion snaps open; a close keeps the last children mounted through
 *  an exiting phase and unmounts them on the grid's own transitionend. */
function Subtree({ open, snap, animateEntry, children }: { open: boolean; snap: boolean; animateEntry: boolean; children: ReactNode }): ReactNode {
  const [phase, setPhase] = useState<SubtreePhase>(() => (!open ? 'closed' : snap || !animateEntry ? 'open' : 'entering'))
  const wasOpen = useRef(open)
  const held = useRef<ReactNode>(children)
  if (open) held.current = children
  if (open !== wasOpen.current) {
    wasOpen.current = open
    setPhase(open ? (snap ? 'open' : 'entering') : snap ? 'closed' : 'exiting')
  }
  useEffect(() => {
    if (phase === 'entering') {
      if (snap) {
        setPhase('open')
        return
      }
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')))
      return () => cancelAnimationFrame(r)
    }
    if (phase === 'exiting' && snap) setPhase('closed')
  }, [phase, snap])
  if (phase === 'closed') return null
  return (
    <div
      className="au-ft-subtree"
      role="presentation"
      data-open={phase === 'open' ? '' : undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows' && phase === 'exiting') setPhase('closed')
      }}
    >
      <div className="au-ft-subtree__inner" role="presentation">
        {held.current}
      </div>
    </div>
  )
}

/** The <au-tree-row> via its set-independent wrapper. The disclosure chevron's `au-toggle` is wired
 *  through `onAuToggle` (the chevron `stopPropagation`s its own click; native click / dblclick /
 *  contextmenu / focus reach React directly). The forwarded ref anchors the content-drop registration. */
function TreeRowEl({
  onToggle,
  dropDir,
  moveFileInto,
  children,
  ...props
}: {
  onToggle?: () => void
  /** When set (a FOLDER row), register this row as a content-DESTINATION: a file dropped here moves into
   *  `dropDir`. Absent (a file row) → not a destination. */
  dropDir?: string
  moveFileInto?: (filePath: string, dir: string) => void
  children?: ReactNode
} & Record<string, unknown>): ReactNode {
  const ref = useRef<HTMLElement>(null)
  // A folder row is a content-drop DESTINATION while mounted: it accepts a FILE content drag and moves
  // the file into its dir (through the blast-radius preview, owned by `moveFileInto`). The seam is
  // framework-general — a projection registers exactly as any surface would.
  useEffect(() => {
    const el = ref.current
    if (!el || dropDir === undefined || !moveFileInto) return
    return registerDropTarget(el, {
      previewLabel: 'Move',
      accepts: (_src, content) => isFileSelection(content as Selection),
      onDrop: (_src, content) => {
        const sel = content as Selection
        if (isFileSelection(sel)) moveFileInto(sel.path, dropDir)
      },
    })
  }, [dropDir, moveFileInto])
  const handleToggle = onToggle
    ? (e: CustomEvent): void => {
        e.stopPropagation()
        ref.current?.focus({ preventScroll: true })
        onToggle()
      }
    : undefined
  return (
    <AuTreeRow ref={ref} {...(props as AuTreeRowProps)} onAuToggle={handleToggle}>
      {children}
    </AuTreeRow>
  )
}

/** Engine-readiness is an optional host capability (not on the base contract). */
interface EngineReadiness {
  subscribe(listener: (ready: boolean) => void): () => void
}

async function loadChildren(host: MountHost, dir: string): Promise<WireDirEntry[]> {
  const outcome = await readDirEntries(host.engine, dir)
  if ('ok' in outcome) return []
  if (!outcome.ready) return []
  return outcome.result
}

function FileTreeView({ host }: { host: MountHost }): ReactNode {
  const members = host.workspace.members
  // Cluster members by their workspace ROLE, mirroring workspace.yaml terminology (edit / discover /
  // dependency). A cluster shows only when it has members; each member is a collapsible group.
  const clusters = useMemo(() => {
    const inRoles = (roles: string[]): typeof members => members.filter((m) => roles.includes(m.role))
    return [
      { key: 'edit', label: 'Edit', members: inRoles(['entry', 'edit']) },
      { key: 'discover', label: 'Discover', members: inRoles(['discover']) },
      { key: 'dep', label: 'Dependency', members: inRoles(['dep']) },
    ].filter((c) => c.members.length > 0)
  }, [members])

  // revealActiveFile is the tree's OWN per-instance config field (deliberately not a global pref).
  const revealActiveFile = (host.config as FileTree | undefined)?.revealActiveFile === true

  // RESTORABLE VIEW-STATE (per-machine auto-store, NOT the git-tracked config).
  interface FileTreeViewState {
    expanded?: string[]
    memberOpen?: string[]
    roleOpen?: string[]
  }
  const savedView = host.viewStore?.get() as FileTreeViewState | undefined
  // Which ROLE clusters are expanded (default all). Which MEMBERS are expanded (default: editable open).
  const [roleOpen, setRoleOpen] = useState<Set<string>>(() => (savedView?.roleOpen ? new Set(savedView.roleOpen) : new Set(['edit', 'discover', 'dep'])))
  const [memberOpen, setMemberOpen] = useState<Set<string>>(() =>
    savedView?.memberOpen ? new Set(savedView.memberOpen) : new Set(members.filter((m) => m.role === 'entry' || m.role === 'edit').map((m) => m.root)),
  )
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(savedView?.expanded ?? []))
  const [kids, setKids] = useState<Map<string, WireDirEntry[]>>(() => new Map())
  const loadedDirs = useRef(kids)
  loadedDirs.current = kids
  const arrivingPaths = useRef(new Map<string, number>())

  // The input and incoming filter intents share this tree instance’s query state.
  const [filter, setFilter] = useState('')
  useEffect(() => {
    return host.intent?.handle('filter-intent', {
      claim: () => true, // always applies the filter (a set, not a claim/decline); commit unconditionally.
      commit: (i) => {
        const q = (i as { query?: unknown }).query
        setFilter(typeof q === 'string' ? q : '')
      },
    })
  }, [host])
  // The WHOLE-TREE data the filter runs over — every catalogued file path across every member, fed by
  // the `files` subscription (NOT the lazy `kids`). Filtering derives its visible set from this, so a
  // match in a never-opened folder is found. Hidden paths are excluded at model-build (below), matching
  // the dir_entries browse semantics.
  const [catalogue, setCatalogue] = useState<Set<string>>(() => new Set())
  // while filtering a folder is revealed OPEN by default; an explicit toggle records
  // here so the user's collapse/expand wins over the auto-reveal. Reset whenever the query changes, so a
  // new query re-reveals fresh. Cleared when the filter clears, restoring the normal `expanded` state.
  const [filterCollapsed, setFilterCollapsed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setFilterCollapsed(new Set())
  }, [filter])

  // ── the whole-tree filter model ──
  // The query, and the visible set it induces over the ENTIRE catalogue (not the lazy `kids`). A match
  // is a file OR folder whose basename contains the query; a matched folder reveals its whole subtree
  // (every path under it is visible); every ancestor folder up to the member root becomes a visible
  // container. `children` is the visible child list per folder; `visibleDirs` gates open-state; a member
  // with no visible content is dropped (`visibleRoots`).
  const q = filter.trim().toLowerCase()
  const filtering = q.length > 0
  const filterModel = useMemo(() => {
    if (!filtering) return null
    const roots = members.map((m) => m.root)
    const rootOf = (p: string): string | undefined => roots.find((r) => p === r || p.startsWith(r + '/'))
    const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1).toLowerCase()
    const children = new Map<string, Map<string, WireDirEntry>>()
    const visibleDirs = new Set<string>()
    const addChild = (parent: string, e: WireDirEntry): void => {
      let mm = children.get(parent)
      if (!mm) {
        mm = new Map()
        children.set(parent, mm)
      }
      if (!mm.has(e.path)) mm.set(e.path, e)
    }
    for (const path of catalogue) {
      const root = rootOf(path)
      if (root === undefined) continue
      const rel = path.slice(root.length + 1)
      const segs = rel.split('/')
      if (segs.some((s) => s.startsWith('.'))) continue // hidden — match the dir_entries browse
      // The folder chain root..parent(path). A member root never counts as a self-match (matching a
      // member's own folder name should not reveal all of it); its content is what makes it visible.
      const chain: string[] = [root]
      let cur = root
      for (let i = 0; i < segs.length - 1; i++) {
        cur = cur + '/' + segs[i]
        chain.push(cur)
      }
      const fileMatch = base(path).includes(q)
      const dirMatchOnPath = chain.some((d) => d !== root && base(d).includes(q))
      if (!(fileMatch || dirMatchOnPath)) continue
      for (const d of chain) visibleDirs.add(d)
      addChild(chain[chain.length - 1], { path, name: path.slice(path.lastIndexOf('/') + 1), kind: 'file' })
      for (let i = 1; i < chain.length; i++) {
        addChild(chain[i - 1], { path: chain[i], name: chain[i].slice(chain[i].lastIndexOf('/') + 1), kind: 'directory' })
      }
    }
    const sorted = new Map<string, WireDirEntry[]>()
    for (const [dir, mm] of children) sorted.set(dir, [...mm.values()].sort(dirsFirst))
    return { children: sorted, visibleDirs, visibleRoots: new Set(roots.filter((r) => visibleDirs.has(r))) }
  }, [filtering, q, catalogue, members])

  // The two render/coordinate walks read children + open-state through these, so filtering (catalogue,
  // filter collapse-override) and browsing (lazy kids, `expanded`) share ONE recursion.
  const childEntries = useCallback(
    (dir: string): WireDirEntry[] => {
      if (filtering) return filterModel?.children.get(dir) ?? []
      return (kids.get(dir) ?? []).slice().sort(dirsFirst)
    },
    [filtering, filterModel, kids],
  )
  const isDirOpen = useCallback(
    (dir: string): boolean => {
      if (filtering) return (filterModel?.visibleDirs.has(dir) ?? false) && !filterCollapsed.has(dir)
      return expanded.has(dir)
    },
    [filtering, filterModel, filterCollapsed, expanded],
  )
  // While filtering, a member (workspace project) with no match anywhere in its subtree
  // is dropped, and a role cluster left with no members drops with it.
  const visibleClusters = useMemo(() => {
    if (!filtering) return clusters
    return clusters
      .map((c) => ({ ...c, members: c.members.filter((m) => filterModel?.visibleRoots.has(m.root)) }))
      .filter((c) => c.members.length > 0)
  }, [filtering, clusters, filterModel])

  // MULTI-SELECT (local). `selected` is the picked set; `anchorRef` is the shift-range pivot.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const anchorRef = useRef<string | null>(null)

  // ROVING FOCUS: the row that holds the tree's single tab stop (au-tree-row carries the host tabindex).
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const treeRootRef = useRef<HTMLElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)

  // Reveal plumbing.
  const revealTarget = useRef<string | null>(null)
  const [revealTick, setRevealTick] = useState(0)
  const lastActiveRef = useRef<string | null>(null)
  const revealSnapRef = useRef<Set<string>>(new Set())
  const reducedMotion = usePrefersReducedMotion()
  const initiallyExpandedRef = useRef<Set<string>>(new Set(savedView?.expanded ?? []))

  // Inline new-file / new-folder input.
  const createInFlight = useRef(false)
  const [creating, setCreating] = useState<{ dir: string; kind: 'file' | 'directory' } | null>(null)

  // DIAGNOSTICS: worst-severity + count per path, rolled UP onto ancestors, live via subscribe.
  const [diagIndex, setDiagIndex] = useState<{ sev: Map<string, number>; count: Map<string, number> }>({ sev: new Map(), count: new Map() })

  const ensure = useCallback(
    async (dir: string) => {
      const entries = await loadChildren(host, dir)
      setKids((m) => {
        const n = new Map(m)
        n.set(dir, entries)
        return n
      })
    },
    [host],
  )

  const toggleMember = useCallback((root: string) => {
    setMemberOpen((s) => {
      const n = new Set(s)
      if (n.has(root)) n.delete(root)
      else n.add(root)
      return n
    })
  }, [])
  const toggleRole = useCallback((key: string) => {
    setRoleOpen((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }, [])

  // Load each OPEN member's top level now + on the readiness edge (a closed member is fetched on open).
  useEffect(() => {
    let live = true
    const openRoots = members.filter((m) => memberOpen.has(m.root)).map((m) => m.root)
    for (const r of openRoots) void ensure(r)
    const ready = (host as { engineReady?: EngineReadiness }).engineReady
    const off = ready?.subscribe((r) => {
      if (r && live) for (const rt of openRoots) void ensure(rt)
    })
    return () => {
      live = false
      off?.()
    }
  }, [members, memberOpen, host, ensure])

  // RESTORE: load children for every folder restored as expanded (by absolute path, flat parallel).
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  useEffect(() => {
    let live = true
    const loadRestored = (): void => {
      for (const dir of expandedRef.current) if (live && !kids.has(dir)) void ensure(dir)
    }
    loadRestored()
    const ready = (host as { engineReady?: EngineReadiness }).engineReady
    const off = ready?.subscribe((r) => {
      if (r && live) loadRestored()
    })
    return () => {
      live = false
      off?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, ensure])

  // PERSIST the expansion + open-member + open-role slice.
  useEffect(() => {
    host.viewStore?.set({ expanded: [...expanded], memberOpen: [...memberOpen], roleOpen: [...roleOpen] })
  }, [host, expanded, memberOpen, roleOpen])

  // LIVE REFRESH: the engine pushes entry.files deltas — re-read each touched dir (the parent of each
  // changed path) so external changes (a git checkout, another editor) reconcile in place.
  useEffect(() => {
    const off = subscribeFiles(host.engine, (event) => {
      if (event.kind === 'initial-value') {
        setCatalogue(new Set(event.result.map((f) => f.path)))
        return
      }
      if (event.kind !== 'change') return
      // Keep the whole-tree catalogue current for the filter.
      setCatalogue((s) => {
        const n = new Set(s)
        for (const p of event.scopeHint.added) n.add(p)
        for (const p of event.scopeHint.removed) n.delete(p)
        return n
      })
      const dirs = new Set<string>()
      for (const p of event.scopeHint.added) arrivingPaths.current.set(p, performance.now())
      for (const p of [...event.scopeHint.added, ...event.scopeHint.removed]) {
        // A new nested directory changes the nearest visible ancestor too.
        for (const d of loadedDirs.current.keys()) if (p.startsWith(d + '/')) dirs.add(d)
        dirs.add(p.slice(0, p.lastIndexOf('/')))
      }
      for (const d of dirs) if (loadedDirs.current.has(d)) void ensure(d)
      // A member-root-level add/remove has no cached parent dir; refresh the open member roots.
      for (const m of members) if (memberOpen.has(m.root) && dirs.has(m.root)) void ensure(m.root)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, ensure, members, memberOpen])

  useEffect(() => {
    const rows = new Set<HTMLElement>()
    for (const [path, arrived] of arrivingPaths.current) {
      const row = changeRow(treeRootRef.current, path)
      if (row && !reducedMotion) rows.add(row)
      if (row || performance.now() - arrived > 2000) arrivingPaths.current.delete(path)
    }
    flashChangedRows(rows)
  }, [kids, reducedMotion])

  // A completed write is a brief change signal, not a claim that an agent is still working.
  useEffect(() => subscribeChanges(host.engine, event => {
    if (event.kind !== 'change' || reducedMotion) return
    const rows = new Set<HTMLElement>()
    for (const path of event.scopeHint.modified) {
      const row = changeRow(treeRootRef.current, path)
      if (row) rows.add(row)
    }
    flashChangedRows(rows)
  }), [host, reducedMotion])

  // DIAGNOSTICS: build the per-path index (worst severity + count, rolled up), live.
  const indexDiagnostics = useCallback((list: WireDiagnostic[]) => {
    const sev = new Map<string, number>()
    const count = new Map<string, number>()
    for (const d of list) {
      const s = DX_SEVERITY.indexOf(d.severity)
      if (s < 0) continue
      for (let p = d.span.file; ; ) {
        const cur = sev.get(p)
        if (cur === undefined || s < cur) sev.set(p, s)
        count.set(p, (count.get(p) ?? 0) + 1)
        const parent = p.slice(0, p.lastIndexOf('/'))
        if (!parent || parent === p) break
        p = parent
      }
    }
    setDiagIndex({ sev, count })
  }, [])
  useEffect(() => {
    let live = true
    const refresh = async (): Promise<void> => {
      const out = await readDiagnostics(host.engine, { scope: 'all' })
      if (!live || 'ok' in out || !out.ready) return
      indexDiagnostics(out.result)
    }
    const off = subscribeDiagnostics(host.engine, (event) => {
      if (!live) return
      if (event.kind === 'initial-value') indexDiagnostics(event.result)
      else if (event.kind === 'change') void refresh()
    })
    return () => {
      live = false
      off()
    }
  }, [host, indexDiagnostics])

  // ── OPEN SURFACES: the "Open editors" section reads the host index (what is mounted + what each
  //    surface addresses). A file open in editor + reader + graph is N surfaces under ONE path; the
  //    section groups by path, badges the surface count, and italicises a transient (preview) one.
  //    Clicking a row opens/focuses the file (act rides the intent, never a method on the capability). ──
  const [openSurfaces, setOpenSurfaces] = useState<OpenSurface[]>([])
  useEffect(() => {
    const presentation = stableOpenSurfaces(setOpenSurfaces)
    const unsubscribe = host.openSurfaces?.subscribe(presentation.update)
    return () => { unsubscribe?.(); presentation.dispose() }
  }, [host])
  const [openEditorsOpen, setOpenEditorsOpen] = useState(true)
  // ONE ROW PER SURFACE (not per file): a file open in editor + reader is two rows, each revealing its
  // own pane on click — which shows the many-to-many directly and makes the reveal unambiguous. An
  // id-less surface (no pane to focus) is skipped.
  const openRows = useMemo(() => {
    const rows: { surfaceId: string; path: string; kind: string; transient: boolean }[] = []
    for (const s of openSurfaces) {
      if (s.surfaceId === undefined) continue
      for (const c of s.contents) {
        const sel = c.payload as Selection
        if (!isFileSelection(sel)) continue
        rows.push({ surfaceId: s.surfaceId, path: sel.path, kind: s.projection, transient: s.transient === true })
      }
    }
    return rows.sort(
      (a, b) => (a.path.split('/').pop() ?? '').localeCompare(b.path.split('/').pop() ?? '') || a.kind.localeCompare(b.kind),
    )
  }, [openSurfaces])

  // ── file-opening gestures ──
  //   plain click      -> container default (the composition decides preview versus kept tab)
  //   cmd/ctrl + click  -> preview-pin  (pin the current preview, peek this as a new one)
  //   double click      -> permanent    (a kept tab)
  const openFile = useCallback(
    (path: string, mode: OpenIntent['mode']) => {
      lastActiveRef.current = path
      host.selection?.publish(fileSelection(path))
      host.intent?.fire(openIntent(fileSelection(path), mode))
    },
    [host],
  )

  // A file ROW is a CONTENT drag SOURCE (the unified drag protocol): dragging it out carries a
  // `fileSelection`, and WHERE it lands decides the outcome — a pane opens it, a folder
  // moves it. `draggedRef` suppresses the open-click that also fires on pointerup after a real drag.
  const startDrag = useDragStart()
  const draggedRef = useRef(false)

  const toggle = useCallback(
    (dir: string) => {
      // while filtering, a toggle overrides the auto-reveal (records into filterCollapsed) rather
      // than mutating the persistent browse expansion — so the reveal snaps back when the filter clears.
      if (filtering) {
        setFilterCollapsed((s) => {
          const n = new Set(s)
          if (n.has(dir)) n.delete(dir)
          else n.add(dir)
          return n
        })
        return
      }
      setExpanded((s) => {
        const n = new Set(s)
        if (n.has(dir)) n.delete(dir)
        else {
          n.add(dir)
          if (!kids.has(dir)) void ensure(dir)
        }
        return n
      })
    },
    [filtering, kids, ensure],
  )

  // ── mutations behind the context menu ──
  const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/'))
  const lastSeg = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
  const plural = (n: number): string => `${n} reference${n === 1 ? '' : 's'}`
  const relativePath = (p: string): string => {
    const m = members.find((mm) => p === mm.root || p.startsWith(mm.root + '/'))
    return m ? p.slice(m.root.length + 1) || p : p
  }

  const reportFailure = useCallback(
    (msg: string): void => {
      host.intent?.fire(notificationIntent('error', msg))
    },
    [host],
  )

  type Referrers = { paths: string[] } | { unavailable: string }
  const affectedBy = useCallback(
    async (path: string): Promise<Referrers> => {
      const bl = await readReferencesIn(host.engine, path)
      if (!('ready' in bl)) return { unavailable: `the reference read failed (${bl.error})` }
      if (!bl.ready) return { unavailable: 'the engine is still loading the workspace' }
      const srcs = new Set<string>()
      for (const b of bl.result as WireReferenceIn[]) if (b.source && b.source !== path) srcs.add(b.source)
      return { paths: [...srcs] }
    },
    [host],
  )
  const radius = (r: Referrers): { affected?: string[]; unavailable?: string } => ('paths' in r ? { affected: r.paths } : { unavailable: r.unavailable })

  // Create a file/folder via an inline name-input. The engine has no mkdir, so a folder is a.gitkeep
  // write inside it (write creates parent dirs).
  const beginCreate = useCallback(
    (dir: string, kind: 'file' | 'directory') => {
      setExpanded((s) => {
        const n = new Set(s)
        n.add(dir)
        return n
      })
      if (!kids.has(dir)) void ensure(dir)
      setCreating({ dir, kind })
    },
    [kids, ensure],
  )
  const commitCreate = useCallback(
    async (rawName: string) => {
      const c = creating
      if (!c || createInFlight.current) return
      const name = rawName.trim()
      if (!name || name.includes('/')) return
      const target = `${c.dir}/${name}`
      const path = c.kind === 'directory' ? `${target}/.gitkeep` : target
      createInFlight.current = true
      try {
        const res = await host.files.write(path, '')
        if (!res.ok) { reportFailure(res.error ?? `could not create ${name}`); return }
        setCreating(null)
        await ensure(c.dir)
        if (c.kind === 'file') openFile(target, 'permanent')
      } catch (error) {
        reportFailure(error instanceof Error ? error.message : `could not create ${name}`)
      } finally {
        createInFlight.current = false
      }
    },
    [creating, host, ensure, openFile, reportFailure],
  )

  const renameEntry = useCallback(
    async (entry: WireDirEntry) => {
      const confirmSurface = host.confirm
      if (!confirmSurface) return
      const parent = parentOf(entry.path)
      const aff = await affectedBy(entry.path)
      const out = await confirmSurface.confirm({
        title: 'Rename file',
        message: 'paths' in aff ? `Renaming “${entry.name}” will update ${plural(aff.paths.length)}.` : `Renaming “${entry.name}” will update any references to it.`,
        ...radius(aff),
        input: { value: entry.name },
        confirmLabel: 'Rename',
      })
      if (!out.confirmed) return
      const name = out.value?.trim()
      if (!name || name === entry.name || name.includes('/')) return
      const res = await host.files.rename(entry.path, `${parent}/${name}`)
      if (!res.ok) reportFailure(res.error ?? `could not rename ${entry.name}`)
      else void ensure(parent)
    },
    [host, affectedBy, ensure, reportFailure],
  )

  // MOVE a file into a folder (the content-destination drop outcome). A move IS an engine rename to a new
  // path, which rewrites every reference — so it goes THROUGH the same blast-radius preview a rename does,
  // never a bare rename. Same-dir is a no-op; the enclosing folders refresh on success.
  const moveFileInto = useCallback(
    async (filePath: string, dir: string) => {
      const base = filePath.split('/').pop() ?? filePath
      const dest = `${dir}/${base}`
      if (dest === filePath) return // dropped into its own folder → nothing to do
      const owner = (path: string) => members.filter(m => path === m.root || path.startsWith(m.root + '/')).sort((a, b) => b.root.length - a.root.length)[0]
      const fromMember = owner(filePath)
      const toMember = owner(dir)
      if (!fromMember || !toMember || fromMember.root !== toMember.root) {
        reportFailure('Moving files between repositories is not supported by the engine yet. Nothing was moved.')
        return
      }
      const confirmSurface = host.confirm
      if (!confirmSurface) return
      const aff = await affectedBy(filePath)
      const out = await confirmSurface.confirm({
        title: 'Move file',
        message:
          'paths' in aff
            ? `Move “${base}” to “${dir}”? This updates references in ${aff.paths.length} file(s), potentially in other repositories.`
            : `Move “${base}” to “${dir}”? The reference impact could not be measured.`,
        ...radius(aff),
        confirmLabel: 'Move',
      })
      if (!out.confirmed) return
      const res = await host.files.rename(filePath, dest)
      if (!res.ok) reportFailure(res.error ?? `could not move ${base}`)
      else {
        void ensure(dir)
        void ensure(parentOf(filePath))
      }
    },
    [host, affectedBy, ensure, reportFailure, members],
  )

  const chooseMove = useCallback(async (entry: WireDirEntry) => {
    const dir = await host.workspace.pickFolder?.()
    if (dir) await moveFileInto(entry.path, dir)
  }, [host, moveFileInto])

  // Claim file drops inside the tree before the enclosing pane can open them.
  useEffect(() => {
    const tree = surfaceRef.current
    if (!tree) return
    return registerDropTarget(tree, {
      previewLabel: 'Choose a folder',
      accepts: (_source, content) => isFileSelection(content as Selection),
      onDrop: () => reportFailure('Drop onto a folder or workspace member to move the file.'),
    })
  }, [reportFailure, members.length])

  // HIGHLIGHT the folder a content drag is hovering. Subscribe to the vanilla drag store IMPERATIVELY (no
  // React re-render of the whole tree per hover): the hovered content-destination hit carries its own row
  // element, so toggle `data-drop-active` on it directly. The injected sheet styles that attribute.
  useEffect(() => {
    let prev: HTMLElement | null = null
    const apply = (): void => {
      const hover = dragStore.getState().drag?.hover ?? null
      const el = isContentDropHit(hover) ? (hover.el as HTMLElement) : null
      if (el === prev) return
      prev?.removeAttribute('data-drop-active')
      el?.setAttribute('data-drop-active', '')
      prev = el
    }
    const unsub = dragStore.subscribe(apply)
    return () => {
      unsub()
      prev?.removeAttribute('data-drop-active')
    }
  }, [])

  // AUTO-SCROLL the tree while a CONTENT drag hovers near its top/bottom edge, so a file can be dropped
  // into a folder further up/down a scrolled list. A drag BEHAVIOUR (the drop-dialect model): it runs on
  // pointermove during a drag, independent of what commits. Speed ramps with depth into the edge zone. The
  // scroller lives in au-scroll-area's shadow (its exposed `part=scroll`). Each scrolled frame dispatches a
  // synthetic pointermove at the held cursor, so the overlay re-resolves the drop target + the folder
  // highlight tracks the rows scrolling under it.
  useEffect(() => {
    const host = treeRootRef.current
    if (!host) return
    const EDGE = 44 // px hot zone at each edge
    const MAX_SPEED = 16 // px/frame at the very edge
    let raf = 0
    let velocity = 0
    let lastX = 0
    let lastY = 0
    const tick = (): void => {
      const sc = host.shadowRoot?.querySelector('[part=scroll]') as HTMLElement | null
      if (velocity !== 0 && sc) {
        const before = sc.scrollTop
        sc.scrollTop += velocity
        if (sc.scrollTop !== before) {
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: lastX, clientY: lastY, bubbles: true }))
        }
        raf = requestAnimationFrame(tick)
      } else {
        raf = 0
      }
    }
    const onMove = (e: PointerEvent): void => {
      lastX = e.clientX
      lastY = e.clientY
      const drag = dragStore.getState().drag
      if (!drag || drag.content === undefined) {
        velocity = 0
        return
      }
      const r = host.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        velocity = 0
        return
      }
      const top = e.clientY - r.top
      const bot = r.bottom - e.clientY
      if (top < EDGE) velocity = -Math.ceil(((EDGE - top) / EDGE) * MAX_SPEED)
      else if (bot < EDGE) velocity = Math.ceil(((EDGE - bot) / EDGE) * MAX_SPEED)
      else velocity = 0
      if (velocity !== 0 && raf === 0) raf = requestAnimationFrame(tick)
    }
    const stop = (): void => {
      velocity = 0
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const deleteEntry = useCallback(
    async (entry: WireDirEntry) => {
      const parent = parentOf(entry.path)
      if (confirmBeforeDelete()) {
        const confirmSurface = host.confirm
        if (!confirmSurface) return
        const aff = await affectedBy(entry.path)
        const out = await confirmSurface.confirm({
          title: 'Delete file',
          message:
            'paths' in aff
              ? aff.paths.length > 0
                ? `Deleting “${entry.name}” will BREAK ${plural(aff.paths.length)} to it.`
                : `Delete “${entry.name}”? This cannot be undone.`
              : `Delete “${entry.name}”? This cannot be undone, and may BREAK references to it.`,
          danger: true,
          ...radius(aff),
          confirmLabel: 'Delete',
        })
        if (!out.confirmed) return
      }
      const res = await host.files.delete(entry.path)
      if (!res.ok) reportFailure(res.error ?? `could not delete ${entry.name}`)
      else void ensure(parent)
    },
    [host, affectedBy, ensure, reportFailure],
  )

  const entriesByPath = useMemo(() => {
    const m = new Map<string, WireDirEntry>()
    for (const list of kids.values()) for (const e of list) m.set(e.path, e)
    return m
  }, [kids])
  const isDirPath = useCallback(
    (p: string): boolean => {
      if (filtering) return filterModel?.visibleDirs.has(p) ?? entriesByPath.get(p)?.kind === 'directory'
      return entriesByPath.get(p)?.kind === 'directory'
    },
    [filtering, filterModel, entriesByPath],
  )

  // Build the descriptor list for one right-clicked entry. Every enabled:false row carries a reason.
  const actionsFor = useCallback(
    (entry: WireDirEntry): ContextMenuItem[] => {
      const isDir = entry.kind === 'directory'
      const dir = isDir ? entry.path : parentOf(entry.path)
      const intent = host.intent
      const shell = host.shell
      const items: ContextMenuItem[] = []

      if (!isDir) {
        // OPEN — the primary verb, plus the projections that DECLARE they open this file (opens-meta).
        items.push({ id: 'file.open', label: 'Open', enabled: true, run: () => void intent?.fire(openIntent(fileSelection(entry.path), 'permanent')) })
        const descriptors = host.describeProjections?.()
        const viewers = viewersFor(entry.path, descriptors)
        if (viewers.length >= 2) {
          items.push({
            id: 'file.openWith',
            label: 'Open with',
            enabled: true,
            items: viewers.map((v) => ({
              id: `file.openWith.${v}`,
              label: descriptorTitle((descriptors ?? []).find((d) => bareTypeName(d.type) === v)) ?? v,
              enabled: true,
              run: () => intent?.fire(openIntent(fileSelection(entry.path), 'permanent', v)),
            })),
          })
        }
        // TIER-2 — reveal-else-open (never a bare open on repeat, which would duplicate the pane).
        items.push({
          id: 'file.backlinks',
          label: 'Show backlinks',
          enabled: true,
          run: () => {
            host.selection?.publish(fileSelection(entry.path))
            intent?.fire(showPaneIntent('backlinks'))
          },
        })
        items.push({
          id: 'file.revealViews',
          label: 'Reveal across views',
          enabled: true,
          run: () => void intent?.fire(highlightIntent(fileSelection(entry.path), 'reveal-if-exists')),
        })
        items.push({ separator: true })
      }

      items.push({ id: 'file.new', label: 'New file…', enabled: true, run: () => beginCreate(dir, 'file') })
      if (isDir) items.push({ id: 'folder.new', label: 'New folder…', enabled: true, run: () => beginCreate(dir, 'directory') })
      if (!isDir) items.push({ id: 'file.rename', label: 'Rename…', enabled: !!host.confirm, reason: host.confirm ? undefined : 'Renaming needs the host confirm surface, which is unavailable.', run: () => void renameEntry(entry) })
      if (!isDir) items.push({ id: 'file.move', label: 'Move…', enabled: !!host.confirm && !!host.workspace.pickFolder, reason: host.confirm && host.workspace.pickFolder ? undefined : 'Moving needs a folder picker and reference-impact confirmation.', run: () => void chooseMove(entry) })
      items.push({ id: 'file.copyPath', label: 'Copy full path', enabled: true, run: () => void navigator.clipboard.writeText(entry.path) })
      items.push({ id: 'file.copyRelPath', label: 'Copy relative path', enabled: true, run: () => void navigator.clipboard.writeText(relativePath(entry.path)) })
      items.push({
        id: 'file.reveal',
        label: isDir ? 'Open in Finder' : 'Reveal in Finder',
        enabled: !!shell,
        reason: shell ? undefined : 'The OS shell capability is unavailable.',
        run: () => {
          if (!shell) return
          if (isDir) void shell.openPath(entry.path)
          else void shell.showItemInFolder(entry.path)
        },
      })
      items.push({ id: 'file.terminal', label: 'Open in terminal here', enabled: true, run: () => void intent?.fire(openPaneIntent({ type: 'terminal', cwd: dir })) })
      if (!isDir) {
        items.push({ separator: true })
        items.push({
          id: 'file.delete',
          label: 'Delete…',
          enabled: !confirmBeforeDelete() || !!host.confirm,
          reason: confirmBeforeDelete() && !host.confirm ? 'Deleting needs the host confirm surface, which is unavailable.' : undefined,
          destructive: true,
          run: () => void deleteEntry(entry),
        })
      }
      return items
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [host, beginCreate, renameEntry, chooseMove, deleteEntry, members],
  )

  // ── visible order (coordinate space) ──
  // The VISIBLE paths in DOM order — the shift-range + keyboard-nav coordinate space, sharing the ONE
  // recursion (childEntries + isDirOpen) with renderLevel so the two cannot drift.
  const flattenVisible = useCallback(
    (dir: string): string[] => {
      const out: string[] = []
      for (const e of childEntries(dir)) {
        out.push(e.path)
        if (e.kind === 'directory' && isDirOpen(e.path)) out.push(...flattenVisible(e.path))
      }
      return out
    },
    [childEntries, isDirOpen],
  )
  // While filtering, a member/cluster with content is force-revealed (roleOpen/memberOpen ignored, so
  // the reveal snaps back on clear); the members list is already restricted to matches by visibleClusters.
  const visibleOrder = useMemo(() => {
    const order: string[] = []
    for (const c of visibleClusters) {
      if (!filtering && !roleOpen.has(c.key)) continue
      for (const m of c.members) if (filtering || memberOpen.has(m.root)) order.push(...flattenVisible(m.root))
    }
    return order
  }, [visibleClusters, filtering, roleOpen, memberOpen, flattenVisible])

  const activePath = useMemo(() => (focusedPath && visibleOrder.includes(focusedPath) ? focusedPath : visibleOrder[0]), [focusedPath, visibleOrder])

  // Keyboard creation uses the same named-file form as the context menu.
  useEffect(()=>host.intent.handle('create-file-intent', {
    claim:()=>true,
    commit:()=>{void (async()=>{
      let dir=activePath ? (isDirPath(activePath)?activePath:parentOf(activePath)) : undefined
      if(!dir) dir=await host.chooser?.choose({title:'Create file in…',options:members.map(member=>({id:member.root,label:member.name}))}) ?? undefined
      if(!dir)return
      setFilter('')
      for(const cluster of clusters) for(const member of cluster.members) {
        if(dir===member.root || dir.startsWith(member.root+'/')) {
          setMemberOpen(previous=>new Set([...previous,member.root]))
          setRoleOpen(previous=>new Set([...previous,cluster.key]))
          const ancestors:string[]=[]
          for(let path=dir;path.startsWith(member.root);path=parentOf(path)){ancestors.push(path);if(path===member.root)break}
          setExpanded(previous=>new Set([...previous,...ancestors]))
        }
      }
      beginCreate(dir,'file')
    })()},
  }),[host,activePath,isDirPath,members,clusters,beginCreate])

  // ── selection gestures ──
  const selectSingle = useCallback((path: string) => {
    anchorRef.current = path
    setSelected(new Set([path]))
  }, [])
  const toggleSelect = useCallback((path: string) => {
    anchorRef.current = path
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })
  }, [])
  const rangeSelect = useCallback(
    (path: string) => {
      const anchor = anchorRef.current
      const ai = anchor ? visibleOrder.indexOf(anchor) : -1
      const bi = visibleOrder.indexOf(path)
      if (ai < 0 || bi < 0) {
        selectSingle(path)
        return
      }
      const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai]
      setSelected(new Set(visibleOrder.slice(lo, hi + 1)))
    },
    [visibleOrder, selectSingle],
  )

  // ── keyboard navigation (ARIA tree) ──
  const focusRow = useCallback((path: string) => {
    setFocusedPath(path)
    treeRootRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus()
  }, [])
  const onTreeKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLElement>) => {
      if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return
      const target = ev.target as HTMLElement
      if (target.closest('input, textarea')) return
      const order = visibleOrder
      const active = activePath
      if (!active || order.length === 0) return
      const idx = order.indexOf(active)
      const openHere = isDirOpen(active)
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault()
          focusRow(order[Math.min(idx + 1, order.length - 1)])
          break
        case 'ArrowUp':
          ev.preventDefault()
          focusRow(order[Math.max(idx - 1, 0)])
          break
        case 'Home':
          ev.preventDefault()
          focusRow(order[0])
          break
        case 'End':
          ev.preventDefault()
          focusRow(order[order.length - 1])
          break
        case 'ArrowRight':
          ev.preventDefault()
          if (isDirPath(active)) {
            if (!openHere) toggle(active)
            else if (order[idx + 1]?.startsWith(active + '/')) focusRow(order[idx + 1])
          }
          break
        case 'ArrowLeft':
          ev.preventDefault()
          if (isDirPath(active) && openHere) toggle(active)
          else {
            const parent = active.slice(0, active.lastIndexOf('/'))
            if (order.includes(parent)) focusRow(parent)
          }
          break
        case 'Enter':
        case ' ':
          ev.preventDefault()
          selectSingle(active)
          if (isDirPath(active)) toggle(active)
          else openFile(active, 'permanent')
          break
        default:
          break
      }
    },
    [visibleOrder, activePath, isDirOpen, isDirPath, toggle, focusRow, selectSingle, openFile],
  )

  // ── reveal-active-file ──
  const revealPath = useCallback(
    (path: string) => {
      const member = members.find((m) => path === m.root || path.startsWith(m.root + '/'))
      if (!member) return
      const roleKey = member.role === 'entry' || member.role === 'edit' ? 'edit' : member.role
      setRoleOpen((s) => (s.has(roleKey) ? s : new Set(s).add(roleKey)))
      setMemberOpen((s) => (s.has(member.root) ? s : new Set(s).add(member.root)))
      const ancestors = ancestorDirs(path, member.root)
      for (const anc of ancestors) revealSnapRef.current.add(anc)
      setExpanded((s) => {
        const n = new Set(s)
        for (const anc of ancestors) {
          n.add(anc)
          if (!kids.has(anc)) void ensure(anc)
        }
        return n
      })
      revealTarget.current = path
      setRevealTick((t) => t + 1)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, ensure],
  )
  useEffect(() => {
    return host.intent?.handle('ui-intent-highlight', {
      claim: () => true, // broadcast highlight — every copy highlights its own; claim ignored, always commit.
      commit: (i) => {
        const path = (i as { target?: { path?: string } }).target?.path
        if (typeof path !== 'string') return
        if ((i as { mode?: string }).mode !== 'reveal-if-exists') {
          const el = treeRootRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
          if (el) flashRow(el)
          return
        }
        revealPath(path)
      },
    })
  }, [host, revealPath])
  useEffect(() => {
    if (!revealActiveFile) return
    return host.selection?.follow((value) => {
      if (!value || typeof value !== 'object') return
      const sel = value as Selection
      if (!isFileSelection(sel) || sel.path === lastActiveRef.current) return
      lastActiveRef.current = sel.path
      revealPath(sel.path)
    })
  }, [host, revealPath, revealActiveFile])
  useEffect(() => {
    const path = revealTarget.current
    if (!path) return
    const el = treeRootRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
    if (!el) return
    revealTarget.current = null
    revealSnapRef.current.clear()
    el.scrollIntoView({ block: 'nearest' })
    flashRow(el)
  }, [revealTick, kids, expanded, memberOpen, roleOpen, visibleOrder])

  // ── cmd-hover preview ──
  useEffect(() => {
    const el = treeRootRef.current
    const preview = host.preview
    const content = makeHoverContent(host.engine)
    let modHeld = false
    let hoverTimer: ReturnType<typeof setTimeout> | undefined
    let lastPointer: { x: number; y: number } | null = null
    const clearTimer = (): void => {
      if (hoverTimer) clearTimeout(hoverTimer)
      hoverTimer = undefined
    }
    const manage = (x: number, y: number): void => {
      if (preview.isOver(x, y)) return clearTimer()
      const row = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-path]') as HTMLElement | null
      const path = modHeld && row && el?.contains(row) && row.dataset.kind === 'file' ? row.dataset.path : undefined
      if (!path) return clearTimer()
      const key = `ft:path:${path}`
      if (preview.isShowing(key)) return
      clearTimer()
      hoverTimer = setTimeout(() => {
        hoverTimer = undefined
        if (!modHeld || !lastPointer || !row || !el?.contains(row)) return
        const hit = document.elementFromPoint(lastPointer.x, lastPointer.y)
        if (!hit || !row.contains(hit)) return
        preview.show(key, row!.getBoundingClientRect(), content.previewPath(path), (p) => content.previewPath(p), (p) => host.intent?.fire(openIntent(fileSelection(p))))
      }, 240)
    }
    const onMove = (e: MouseEvent): void => {
      modHeld = e.metaKey || e.ctrlKey
      lastPointer = { x: e.clientX, y: e.clientY }
      manage(e.clientX, e.clientY)
    }
    const onKey = (e: KeyboardEvent2): void => {
      if (e.key !== 'Meta' && e.key !== 'Control') return
      modHeld = e.metaKey || e.ctrlKey
      if (lastPointer) manage(lastPointer.x, lastPointer.y)
    }
    const onLeave = (): void => {
      lastPointer = null
      clearTimer()
    }
    const onBlur = (): void => {
      lastPointer = null
      modHeld = false
      clearTimer()
    }
    el?.addEventListener('mousemove', onMove)
    el?.addEventListener('mouseleave', onLeave)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      clearTimer()
      el?.removeEventListener('mousemove', onMove)
      el?.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [host])

  // ── diagnostics reveal ──
  const revealScopedDiagnostics = useCallback(
    (path: string, isDir: boolean) => {
      const scope = isDir ? { path_prefix: path, label: lastSeg(path) || path } : { path, label: lastSeg(path) }
      host.viewState.publish('diagnostics-scope', scope)
      host.intent?.fire(showPaneIntent('diagnostics'))
    },
    [host],
  )

  // ── the trailing diagnostic badge for a row (worst severity + count, click reveals the pane) ──
  const badgeFor = (path: string, isDir: boolean): ReactNode => {
    const s = diagIndex.sev.get(path)
    if (s === undefined) return null
    const sevName = DX_SEVERITY[s]
    const count = diagIndex.count.get(path) ?? 0
    return (
      <AuButton
        className="au-ft-diagnostics-action"
        slot="trailing"
        variant="ghost"
        size="sm"
        aria-label={`Open diagnostics for ${lastSeg(path) || path}: ${count} ${sevName}${count === 1 ? '' : 's'}`}
        title={`${count} ${sevName}${count === 1 ? '' : 's'} at or below — open diagnostics`}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
        }}
        onAuActivate={(e: Event) => {
          e.stopPropagation()
          revealScopedDiagnostics(path, isDir)
        }}
      >
        <AuBadge variant="count" tone={DX_TONE[sevName]} aria-hidden="true">{count}</AuBadge>
      </AuButton>
    )
  }

  // ── row rendering (recursion; mirrors flattenVisible) ──
  // Visibility is precomputed (kids while browsing, the filter model while filtering), so this walk only
  // renders what childEntries yields and recurses where isDirOpen says.
  const renderLevel = (dir: string, level: number): ReactNode[] => {
    const entries = childEntries(dir)
    const out: ReactNode[] = []
    for (const e of entries) {
      const isDir = e.kind === 'directory'
      const isOpen = isDir && isDirOpen(e.path)
      const children = isOpen ? renderLevel(e.path, level + 1) : []
      const kidCount = kids.get(e.path)?.length ?? 0
      const isLoadedDir = isDir && kidCount > 0
      out.push(
        <div key={e.path} style={{ display: 'contents' }}>
          <TreeRowEl
            kind={isDir ? 'folder' : 'file'}
            level={level}
            open={isOpen}
            selected={selected.has(e.path)}
            data-path={e.path}
            data-kind={e.kind}
            tabIndex={e.path === activePath ? 0 : -1}
            dropDir={isDir ? e.path : dir}
            moveFileInto={moveFileInto}
            onToggle={isDir ? () => { selectSingle(e.path); toggle(e.path) } : undefined}
            onFocus={() => setFocusedPath(e.path)}
            // Drag files as content sources. Folders are not openable pane content.
  // A 5px threshold keeps ordinary selection clicks from starting a drag.
            onPointerDown={(ev: React.PointerEvent) => {
              draggedRef.current = false
              if (isDir || ev.button !== 0) return
              startDrag(ev, {
                containerKind: CONTENT_SOURCE_KIND,
                localId: e.path,
                role: 'pane',
                label: e.name,
                content: fileSelection(e.path),
                onDragStart: () => {
                  draggedRef.current = true
                },
              })
            }}
            // au-toggle is a custom event; but a folder's row click also toggles (au-activate → onClick
            // fires via the native click bubbling through the shadow), so we wire onClick for both.
            onClick={(ev: React.MouseEvent<HTMLElement>) => {
              if (draggedRef.current) return // a completed drag is not also an open
              // Selection and opening must not leave keyboard input in the filter. Focus the actual
              // clicked row (a file may appear under more than one workspace member).
              ev.currentTarget.focus({ preventScroll: true })
              if (ev.shiftKey && anchorRef.current) {
                ev.preventDefault()
                rangeSelect(e.path)
                return
              }
              if (ev.metaKey || ev.ctrlKey) {
                ev.preventDefault()
                toggleSelect(e.path)
                return
              }
              selectSingle(e.path)
              if (isDir) toggle(e.path)
              else openFile(e.path, undefined)
            }}
            onDoubleClick={
              isDir ? undefined : () => { if (!draggedRef.current) openFile(e.path, 'permanent') }
            }
            onContextMenu={(ev: React.MouseEvent) => {
              ev.preventDefault()
              ev.stopPropagation()
              if (!selected.has(e.path)) selectSingle(e.path)
              host.contextMenu?.open({ x: ev.clientX, y: ev.clientY }, actionsFor(e))
            }}
          >
            {e.name}
            {badgeFor(e.path, isDir)}
          </TreeRowEl>
          {isDir
            ? filtering
              ? children.length
                ? children
                : null
              : isLoadedDir
                ? (
                    <Subtree open={isOpen} snap={reducedMotion || revealSnapRef.current.has(e.path)} animateEntry={!initiallyExpandedRef.current.has(e.path)}>
                      {children}
                    </Subtree>
                  )
                : null
            : null}
        </div>,
      )
    }
    if (creating && creating.dir === dir) {
      out.unshift(
        <div key="__creating" className="au-ft-create" style={{ paddingInlineStart: `calc(var(--au-space-1) + var(--au-space-6) * ${level})` }}>
          <AuInput
            autoFocus
            placeholder={creating.kind === 'directory' ? 'new folder name' : 'new file name'}
            onKeyDown={(ev: React.KeyboardEvent<HTMLInputElement>) => {
              if (ev.key === 'Enter') {
                ev.preventDefault()
                void commitCreate((ev.target as HTMLInputElement).value)
              } else if (ev.key === 'Escape') {
                ev.preventDefault()
                setCreating(null)
              }
            }}
            onBlur={() => setCreating(null)}
          />
        </div>,
      )
    }
    return out
  }

  if (!members.length) {
    return (
      <div ref={surfaceRef} className="au-ft">
        <p style={{ color: 'var(--au-ink-4)', padding: 'var(--au-space-4)', margin: 0 }}>No workspace member to show.</p>
      </div>
    )
  }

  return (
    <div ref={surfaceRef} className="au-ft">
      <div className="au-ft-filter">
        <AuInput
          value={filter}
          placeholder="Filter…"
          aria-label="Filter files"
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key !== 'ArrowDown' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
            if (!activePath) return
            event.preventDefault()
            event.stopPropagation()
            focusRow(activePath)
          }}
          onAuInput={(e) => setFilter((e.target as HTMLElement & { value: string }).value)}
        />
      </div>
      {openRows.length > 0 && (
        <div className="au-ft-open-editors">
          <AuSectionHeader collapsible chevronEnd open={openEditorsOpen} onAuToggle={() => setOpenEditorsOpen((o) => !o)}>
            Open editors
          </AuSectionHeader>
          {openEditorsOpen &&
            openRows.map((r) => (
              <TreeRowEl
                key={`${r.surfaceId}\0${r.path}`}
                kind="file"
                level={0}
                data-path={r.path}
                title={`${displayFilePath(r.path, host.workspace.members)} — ${r.kind}${r.transient ? ' (preview)' : ''}`}
                style={r.transient ? { fontStyle: 'italic' } : undefined}
                onClick={() => host.intent?.fire(revealPaneIntent(r.surfaceId))}
              >
                {r.path.split('/').pop() ?? r.path}
                <span slot="trailing" className="au-ft-viewer-kind" title={r.kind}>
                  {r.kind.replace(/^aup-/, '').replace(/-pane$/, '')}
                </span>
              </TreeRowEl>
            ))}
        </div>
      )}
      <AuScrollArea ref={treeRootRef} axis="y" role="tree" aria-label="File tree" aria-multiselectable="true" onKeyDown={onTreeKeyDown} className="au-ft-scroll">
        <div className="au-ft-groups">
          {visibleClusters.map((c) => {
            // While filtering, force the matched cluster + its members open to REVEAL the matches (the
            // reveal is not persisted, so clearing the filter restores roleOpen/memberOpen). Folder-level
            // filter collapse still applies inside, via isDirOpen.
            const clusterOpen = filtering || roleOpen.has(c.key)
            return (
              <div key={c.key} className="au-ft-cluster">
                <ClusterHeader label={c.label} open={clusterOpen} onToggle={() => toggleRole(c.key)} />
                {clusterOpen
                  ? c.members.map((m) => {
                      const memberShown = filtering || memberOpen.has(m.root)
                      return (
                        <MemberGroup key={m.root} dropDir={m.root} moveFileInto={moveFileInto} name={m.name} open={memberShown} onToggle={() => toggleMember(m.root)}>
                          {memberShown ? renderLevel(m.root, 0) : null}
                        </MemberGroup>
                      )
                    })
                  : null}
              </div>
            )
          })}
        </div>
      </AuScrollArea>
    </div>
  )
}

/** A role CLUSTER header — a collapsible <au-section-header> (quiet sans eyebrow, trailing chevron).
 *  Collapsing a cluster hides all its members. `chevronEnd` reaches the element as a property and
 *  `onAuToggle` is wired by the AuSectionHeader wrapper — no ref / setAttribute / addEventListener. */
function ClusterHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }): ReactNode {
  return (
    <AuSectionHeader collapsible chevronEnd open={open} onAuToggle={onToggle}>
      {label}
    </AuSectionHeader>
  )
}

/** A workspace MEMBER as a collapsible <au-nav-group> (label = member name, trailing chevron). Same
 *  wrapper ergonomics as ClusterHeader — the property + event are set by AuNavGroup. `sans` is the
 *  NAMED-entity face: a member is a thing with a name, one rung above the mono caps eyebrow that
 *  labels the cluster it sits in, so the two never read as the same rank. */
function MemberGroup({ name, open, onToggle, children, dropDir, moveFileInto }: { name: string; open: boolean; onToggle: () => void; children: ReactNode; dropDir: string; moveFileInto: (file: string, dir: string) => void }): ReactNode {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return registerDropTarget(el, {
      previewLabel: 'Move',
      accepts: (_source, content) => isFileSelection(content as Selection),
      onDrop: (_source, content) => {
        if (isFileSelection(content as Selection)) moveFileInto((content as {path: string}).path, dropDir)
      },
    })
  }, [dropDir, moveFileInto])
  return (
    <AuNavGroup ref={ref} sans label={name} collapsible chevronEnd open={open} onAuToggle={onToggle}>
      {children}
    </AuNavGroup>
  )
}

// A local alias so the cmd-hover key handler's DOM KeyboardEvent isn't shadowed by the React import.
type KeyboardEvent2 = globalThis.KeyboardEvent

function mount(container: HTMLElement, host: MountHost): () => void {
  container.classList.add('au-app')
  container.dataset.surface = 'inherit'
  const disposeStyles = host.styles?.inject(STYLE, container)
  const root = createRoot(container)
  root.render(<FileTreeView host={host} />)
  return () => {
    root.unmount()
    disposeStyles?.()
    container.classList.remove('au-app')
  }
}

export default defineProjection<ProjectionModule>({ mount })
