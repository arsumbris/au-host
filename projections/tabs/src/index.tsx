// The `tabs` container-projection. A PEER container (a peer of bento / dock /
// canvas / sandwich), freely nestable — a "tabbed pane" is a bento leaf whose
// `content` is a tabs instance. It composes container-kit's shared `TabGroup`
// (the strip) + `PaneProjection` (mounting each tab's child) and declares its
// `ContainerPlacement` so the shared router drives it.

// its config IS a `Tabs` instance (`{ tabs: projection&[+], activeTab? }`,
// the active tab named by its child `^:`); each child's TYPE names the view, its FIELDS are that view's
// config. Each tab carries its STABLE id as the engine `^:` block-id (like a bento
// node), preserved across reload + re-parenting so a moved terminal reattaches and
// a moved editor keeps its cursor.

// PER-CONTAINER OPEN: tabs OWNS the preview model. It declares the open
// verbs (`open-intent` / `show-pane-intent` / `open-pane-intent` / `promote-intent`)
// on the host intent channel and realizes them over its OWN tab set + `previewId`:
// a file opens as a transient preview tab, the next one replaces it in place, edit /
// promote makes it permanent. Routing (the host focus-MRU walk) picks WHICH container
// handles a fired open; tabs realizes it as a preview. bento (a peer) just splits.





import { mountReactRoot } from './mount-root'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ContainerPlacement,
  ContainerSlot,
  ContextMenuItem,
  DropTarget,
  Occupant,
  IntentPayload,
  MountHost,
  Pane,
  PaneId,
  PaneInstance,
  Projection,
  PublisherId,
  GroupBuildFn,
  GroupingContainerModule,
} from '@arsumbris/au-host-sdk'
import { reportHostDiagnostic, defineProjection, event, on, POOL_EDIT_NOOP } from '@arsumbris/au-host-sdk'
import {
  bareTypeName,
  projectionIconLookup,
  tabContentIcon,
  makeSlotCodec,
  type SlotState as CoreSlotState,
  PaneProjection,
  EmptySlot,
  makePoolEdit,
  usePaneSwap,
  positionName,
  projectionTitleLookup,
  startDragGesture,
  useContainerDialect,
  useContainerModel,
  useContainerPlacement,
  useLayoutDrag,
  useEnclosingPaneId,
  useHeaderContribution,
  useMergedRef,
  resolveViewer,
  viewerPickOptions,
  createChild,
  wrapPaneInteractive,
  dissolvePane,
  paneActionsMenu,
  floatPaneRow,
  moveToWindowRow,
  reloadPaneRows,
} from '@arsumbris/container-kit'
import { highlightIntent, isOpenIntent, isOpenPaneIntent, isRevealPaneIntent, isShowPaneIntent, openIntentViewer } from '@arsumbris/intent'
import { isFileSelection } from '@arsumbris/selection'
import { TabGroup, type TabItem } from './TabGroup'
import { resolveOpenMode } from './lib/open-mode.ts'
import { newFileTabIndex } from './lib/new-tab-position.ts'
import { tabsDropDialect } from './drop-dialect'
import type { Tabs as GeneratedTabs } from './generated'
type Tabs = Omit<GeneratedTabs, 'startView'> & { startView?: string | (Projection & { '^': string }) }

// A persisted child carries its STABLE identity as the engine inline-record `^:`
// block-id (the same scheme bento uses for its nodes), riding BESIDE the
// generated `Projection` shape. The engine surfaces `^` on read + preserves it on
// write; the host mints one when a child carries none.

let idSeq = 0
/** Mint a stable-enough tab id for a child that arrived without a `^:` id. */
function genId(): string {
  return `tab-${Date.now().toString(36)}-${(idSeq++).toString(36)}`
}

/** A tab's occupant: its stable `^:` id + the projection instance it mounts. */
interface ChildState {
  id: string
  instance: Projection
}

/** What the POSITION says, when it says anything. tabs honours only the shared base — it has
 *  neither a size nor a collapse — so there is no `tabs-slot` subtype and no extra field. */
type SlotState = CoreSlotState

/**
 * THE UNION CODEC — reading and writing `<projection& | container-slot>` is the substrate's, not
 * tabs'. Tabs names the shared BASE slot and declares NO extras, which is the runtime half of
 * having no slot subtype: an author cannot write a size here, and tabs would not act on one.
 */
const slots = makeSlotCodec<Projection>({ slotType: 'container-slot', label: 'tabs' })

/** One tab position: an optional occupant plus what the position says about it. `entryId` is the
 *  POSITION's address, DERIVED from the host-owned `^:` (the ruled position's own `^:`, else the bare
 *  position's child `^:`), so it ROUND-TRIPS and the resync never churns it. */
interface TabState {
  entryId: string
  child?: ChildState
  slot: SlotState
}

interface TabsModel {
  tabs: TabState[]
  activeIndex: number
  /** The single ephemeral PREVIEW tab, by `entryId`. RUNTIME-ONLY model state (never a config field): it
   *  marks WHICH tab is the preview so `commitModel` can clear its `pool.transient` flag when it promotes.
   *  The preview's non-persistence lives in `pool.transient` (set at mint), not here. */
  previewId?: string
}

/** Does this POSITION survive its child being closed? Only when it still governs something. */
const survivesEmpty = (slot: SlotState): boolean => slots.survivesEmpty(slot)

/** The POSITION's runtime address, DERIVED from the host-owned `^:` so it round-trips — never minted, so
 *  `fromConfig(toConfig(m))` reproduces it and the resync short-circuits instead of churning every id.
 *  A ruled position uses its own `^:` (`slot.id`); a bare position uses its child's `^:`; a truly id-less
 *  transient position (an empty bare tab, which does not survive a save) mints as a last resort. */
function entryIdOf(pos: { child?: { id: string }; slot: SlotState }): string {
  return pos.slot.id ?? pos.child?.id ?? genId()
}

/** Read one tab's union value into the runtime shape. */
function tabFrom(value: Tabs['tabs'][number]): TabState {
  const read = slots.read(value)
  return { entryId: entryIdOf(read), ...read }
}

/** Read a Tabs instance into the runtime model. Child records are supplied inline. */
function tabsFromConfig(cfg: Tabs | undefined): TabsModel {
  if (!cfg || !Array.isArray(cfg.tabs)) return { tabs: [], activeIndex: 0 }
  const tabs = cfg.tabs.map(tabFrom)
  // ACTIVE-BY-ID: resolve the persisted child `^:` to its current index. A soft pointer — an absent or
  // unresolved id (the active tab was a transient preview the substrate dropped) falls back to the first tab.
  const found = cfg.activeTab ? tabs.findIndex((t) => t.child?.id === cfg.activeTab) : -1
  return { tabs, activeIndex: found >= 0 ? found : 0 }
}

// The host derives config ownership from the type graph and preserves unowned fields
// at saveConfig. This projection emits only the fields it understands.
function tabToConfig(tab: TabState): Tabs['tabs'][number] | undefined {
  return slots.write(tab) as Tabs['tabs'][number] | undefined
}

function tabsToConfig(model: TabsModel, input?: unknown): Tabs {
  const activeChildId = model.tabs[model.activeIndex]?.child?.id
  const out: Tabs = {
    type: 'tabs',
    // ACTIVE-BY-ID: the active tab's child `^:`. Omitted for an empty / childless active tab (falls back to
    // the first on load). A transient preview's id round-trips fine here — the substrate drops the RECORD,
    // this soft pointer just dangles and self-heals to the first tab on reload.
    ...(activeChildId !== undefined ? { activeTab: activeChildId } : {}),
    tabs: model.tabs.map(tabToConfig).filter((v): v is Tabs['tabs'][number] => v !== undefined),
  }
  // AUTHORED and never mutated by us, but tabs OWNS it, and an owned field that is not emitted is
  // DROPPED on the first save. Carried only when present,
  // so an unconfigured group stays byte-identical.
  const authored = (input as Tabs | undefined)?.defaultOpenMode
  if (authored !== undefined) out.defaultOpenMode = authored
  const settings = input as Tabs | undefined
  if (settings?.newTabPosition !== undefined) out.newTabPosition = settings.newTabPosition
  if (settings?.startViewCompactWhen !== undefined) out.startViewCompactWhen = settings.startViewCompactWhen
  if (settings?.startView !== undefined) {
    out.startView = typeof settings.startView === 'string'
      ? settings.startView
      : `[[^^${settings.startView['^']}]]`
  }
  if (settings?.emptyPlaceholder !== undefined) out.emptyPlaceholder = settings.emptyPlaceholder
  if (settings?.replaceEmptyPlaceholderOnOpen !== undefined) out.replaceEmptyPlaceholderOnOpen = settings.replaceEmptyPlaceholderOnOpen
  return out
}

// NO per-container preview-stripping any more. tabs saves its FULL model (preview tab included) via
// `tabsToConfig`, so the preview's edge stays live in the pool (`parentMap` links it → selection / intent /
// focus reach it, the routing fix). The SUBSTRATE (`serializePoolToComposition`) drops the transient record
// and strips its inbound ref at serialize, so the preview never reaches disk. One drop path, host-owned.
function clampIndex(index: number, length: number): number {
  if (length === 0) return 0
  return Math.max(0, Math.min(index, length - 1))
}

/** The open file a tab holds (its `editor-pane` config's `file`), for the already-open check. */
function fileOf(instance: Projection): string | undefined {
  return (instance as { file?: string }).file
}

/** Build an opened pane with its file config. The caller resolves the viewer type
 * through explicit choice, composition defaults, eligibility, or the chooser.
 * One-shot ranges travel through reveal-if-exists and are not persisted in config. */
function fileContent(viewerType: string, sel: { path: string }): Projection {
  return { type: viewerType, file: sel.path } as Projection
}

function TabsApp({ host }: { host: MountHost }): ReactNode {
  // The tabs container's own stable group id — the `gap` drop-target slot id + the
  // container-path slot attr for nested addressing.
  const groupId = useMemo(() => genId(), [])
  const initial = useMemo(() => tabsFromConfig(host.config as Tabs | undefined), [host])
  // The authored open-disposition for this group. Read from the mounted config rather than the
  // runtime model: nothing here mutates it, so it is not model state.
  const defaultOpenMode = useMemo(() => (host.config as Tabs | undefined)?.defaultOpenMode, [host])
  // The shared model cell advances live state and persists each commit synchronously.
  // All seam operations read the live model, including multiple calls in one event.
  const { model, live, commit: commitRaw } = useContainerModel<TabsModel>(
    initial,
    (next) => host.saveConfig(tabsToConfig(next, host.config)),
    // RE-SEED on an external structural edit, so a drag-out of a non-active tab (which doesn't change the
    // active tab) still updates this group's rendered tab set. `toConfig` gates the re-seed in CONFIG space.
    // The preview tab is now saved in the config like any tab and appears on BOTH sides of the compare, so
    // it never reads as a divergence — only a genuine change to the group's own config re-seeds.
    { host, fromConfig: (raw) => tabsFromConfig(raw as Tabs | undefined), toConfig: (m) => tabsToConfig(m, host.config) },
  )
  // Every model mutation goes through `commitModel` so the transient CLEAR is centralized + synchronous:
  // when the preview moves away from a child (promote / pin / close / replace-away), clear its
  // `pool.transient` flag BEFORE the commit's save, so the promoted record persists on that very save (a
  // render-effect cleanup would be too late). The SET is at mint (`createChild({transient})`); the file-tree
  // italic derives from `pool.transient`, so this one call drives both consumers.
  const commitModel = useCallback((next: TabsModel): void => {
    const prev = live()
    const prevId = prev.tabs.find((t) => t.entryId === prev.previewId)?.child?.id
    const nextId = next.tabs.find((t) => t.entryId === next.previewId)?.child?.id
    if (prevId && prevId !== nextId) host.openSurfaces?.setTransient(prevId, false)
    commitRaw(next)
  }, [live, commitRaw, host])
  // A tab's mounted child publisher maps through the host's publisher ↔ `^:` bridge (a tab's id IS its
  // child's `^:`), so a firer-relative `promote-intent` maps back to the tab that fired it, and focus
  // reports the active child. The bridge works whether tabs mounts its children itself (legacy) or the
  // PORTAL mounts them flat (tabs then renders only anchors, so a mount callback is unavailable).
  const activeIndex = clampIndex(model.activeIndex, model.tabs.length)

  // Report THIS tabs as the active container (its active tab's child), so the host
  // focus-MRU walk routes a fired open-intent here when the user is working in it.
  const reportFocusFor = useCallback(
    (tabId: string | undefined): void => host.focus.report(tabId ? host.children.publisherOf?.(tabId) : undefined),
    [host],
  )

  // Seed focus through the publisher-to-node bridge so the active child is a live
  // open target whether children are mounted locally or through portal anchors.
  useEffect(() => {
    reportFocusFor(live().tabs[activeIndex]?.child?.id)
  }, [activeIndex, reportFocusFor])

  // The ACTIVE pane's `^:` from the HOST focus signal — the tabs group rings its active tab's content
  // when that content is the active pane. The host owns the truth; tabs renders its own ring from it.

  const [activePane, setActivePane] = useState<string | null>(null)
  useEffect(() => host.focus.watchActive?.((id) => setActivePane(id)), [host])
  const activeTabChildId = model.tabs[activeIndex]?.child?.id
  const groupFocused = activePane != null && activePane === activeTabChildId

  // Hold the in-flight drag-gesture disposer so an unmount mid-press (composition switch / pane closed
  // before pointerup) tears down its window listeners instead of orphaning them. `startDragGesture`'s
  // disposer is idempotent, so a stale one left after a normal pointerup is a harmless no-op here.
  const dragDisposeRef = useRef<null | (() => void)>(null)
  const draggedClickRef = useRef(false)
  useEffect(() => () => dragDisposeRef.current?.(), [])

  // DIRTY DOT: track which children have unsaved changes (published on the `dirty` view-state slice by the
  // occupant, e.g. the editor). Keyed by PUBLISHER; a tab maps its `^:` (entryId) to a publisher via
  // `children.publisherOf`. `watchAll` replays the latest per publisher on subscribe, so a tab open before
  // this mounts still lights up. Discovery only — the interactive veto is the close-guard at the reap.
  const [dirtyPubs, setDirtyPubs] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(
    () =>
      host.viewState.watchAll('dirty', (publisher, value) => {
        setDirtyPubs((prev) => {
          const wanted = value === true
          if (wanted === prev.has(publisher)) return prev
          const next = new Set(prev)
          if (wanted) next.add(publisher)
          else next.delete(publisher)
          return next
        })
      }),
    [host],
  )

  const selectTab = (index: number): void => {
    const m = live()
    const i = clampIndex(index, m.tabs.length)
    commitModel({ ...m, activeIndex: i })
    reportFocusFor(m.tabs[i]?.child?.id)
  }

  /** Locate a position by ANY of its addresses: entry id, child id, or slot id. */
  const indexOf = (id: string): number =>
    live().tabs.findIndex((t) => t.entryId === id || t.child?.id === id || t.slot.id === id)

  /** Shared close/extract path. Enforce fixity, preserve surviving empty positions,
   * clear the preview marker when needed, and keep the active index in range.
   * Groups of one or zero tabs remain valid. */
  const removeAt = (idx: number): ChildState | null => {
    const m = live()
    const tab = m.tabs[idx]
    if (!tab) return null
    if (tab.slot.fixed) return null // a fixed slot can never be emptied/closed; the substrate refuses too
    // Keep an empty position only when it held a child and its slot survives empty.
    // Remove non-persistent positions and already-empty tabs outright.
    const tabs =
      tab.child && survivesEmpty(tab.slot)
        ? m.tabs.map((t, n) => (n === idx ? { entryId: t.entryId, slot: t.slot } : t))
        : m.tabs.filter((_, n) => n !== idx)
    commitModel({
      ...m,
      tabs,
      previewId: m.previewId === tab.entryId ? undefined : m.previewId,
      activeIndex: clampIndex(m.activeIndex > idx ? m.activeIndex - 1 : m.activeIndex, tabs.length),
    })
    return tab.child ?? null
  }

  /** The ✕ on a tab. An extract whose result nobody keeps. */
  const closeTab = (id: string): void => void removeAt(indexOf(id))

  /** Replace one position's OCCUPANT. `occupantId` names the id the new occupant carries; absent
   *  keeps the current one. The position itself (`entryId`, `slot`) is untouched either way. */
  const updateChild = (id: string, next: Projection, occupantId?: string): void => {
    const m = live()
    const at = indexOf(id)
    if (at < 0) return
    commitModel({
      ...m,
      tabs: m.tabs.map((t, n) =>
        n === at ? { ...t, child: { id: occupantId ?? t.child?.id ?? createChild(host, next), instance: next } } : t,
      ),
    })
  }

  // Universal swap: replace a tab's occupant in place, carrying its document. The affordance lives on
  // the ACTIVE tab (TabGroup's `renderTabActions` is called for the active tab only), so one strip
  // control swaps the tab you are looking at. Routes through the ONE placement-seam address-op
  // (`setPaneContent`), which honours `fixed` / `admits` at the seam — no tabs-local fixity check, and
  // the ⇄ is hidden for a fixed tab. Keyed by `entryId` (which IS the occupant's `^:`).
  const swapPane = usePaneSwap(host)

  /** A tab position holding a fresh child, for the open / show / add paths. The entry id IS the child's
   *  host-assigned `^:` (a bare position), so it round-trips from the moment of creation — no mint. */
  const newTab = (instance: Projection, transient = false): TabState => {
    const id = createChild(host, instance, { transient }) // fresh content → host assigns the pool id; a preview is minted transient
    return { entryId: id, child: { id, instance }, slot: {} }
  }

  /** The strip's "+" — add a fresh EMPTY tab and focus it. No child, so it renders the placeholder picker
   *  (`EmptySlot`): the moldable "add a tab" that lets you pick what to open, consistent with an empty
   *  group's first tab. A bare empty tab does not persist (`slots.write` drops it via `entryIdOf`'s
   *  last-resort mint), so an unfilled "+" that gets saved leaves nothing behind. */
  const addEmptyTab = useCallback((): void => {
    const m = live()
    commitModel({ ...m, tabs: [...m.tabs, { entryId: genId(), slot: {} }], activeIndex: m.tabs.length })
  }, [live, commitModel])

  // The tab whose mounted child fired an intent (for firer-relative promote). A tab's id is its child's
  // `^:`, so the firer's `^:` (from the bridge) IS the tab id — but only if it is one of OUR tabs.
  const tabForPublisher = (from: PublisherId): string | null => {
    const childId = host.children.nodeIdOf?.(from)
    return childId && live().tabs.some((t) => t.child?.id === childId) ? childId : null
  }

  // ── Per-container open realization. tabs OWNS preview; each handler reads modelRef
  //    (current) and commits. Routing (focus-MRU) is the host's; realization is ours.

  // open-intent (ambient): open the file as a PREVIEW tab. Open FOLLOWS FOCUS — a focused tab
  // group claims (the host focus-MRU walk only reaches us when we are the active container), so
  // there is NO editor-role gate: a file opens wherever you are working, editor or not.
  // `apply` gates the side effects: the CLAIM runs it dry (apply=false → pure predicate), the COMMIT runs
  // it live (apply=true). Same synchronous dispatch tick → identical state → they agree by construction.
  const handleOpen = useCallback(
    (intent: IntentPayload, from: PublisherId, apply: boolean): boolean => {
      if (!isOpenIntent(intent)) return false
      const sel = intent.target
      if (typeof sel === 'string' || !isFileSelection(sel)) {
        if (apply && on('intent')) event('intent', 'declined', { by: 'tabs', reason: 'not a file to open' }) // trace WHY it declined
        return false // ref-arm unsupported
      }
      const path = sel.path
      // An ABSENT mode means the firer had no opinion, so THIS CONTAINER decides — realization is
      // ours, routing was the host's. The authored `defaultOpenMode` answers; unset, tabs falls to
      // `transient`.
      // An EXPLICIT mode always wins: a double-click means "keep this" and that is the firer's to know.
      const mode = resolveOpenMode(intent.mode, defaultOpenMode)
      const newIsTransient = mode !== 'permanent'
      const pinCurrent = mode === 'preview-pin'
      // The VIEWER resolves through the explicit ladder (never an implicit default): the firer's
      // `open-intent.with`, then the composition's `viewer-defaults`, then the sole eligible viewer, else
      // a MUST-PICK. `opens-meta` is eligibility only.
      const descriptors = host.describeProjections?.()
      const resolved = resolveViewer(path, descriptors, {
        with: openIntentViewer(intent),
        viewerDefaults: host.viewerDefaults?.(),
      })

      // The open, once a viewer is DECIDED. Re-reads the CURRENT model (`live()`), so it is safe both
      // synchronously (sole / with / composition-default) and after the async chooser resolves (a
      // must-pick, where tabs may have changed). Returns the claim/decline boolean.
      const openWith = (viewerType: string): void => {
        const m = live()
        const content = fileContent(viewerType, sel)
        // The range rides the command channel on EVERY claiming branch below, so one path covers the
        // already-open tab, the reused preview tab, and a brand-new tab alike. Deferred past this
        // dispatch + the activation render, so the target tab is active before it scrolls. Broadcast,
        // so every editor showing this file scrolls — the declared per-copy model, not one winner.
        // A freshly-mounted editor parks it until its async file load resolves.
        const revealRange = (): void => {
          if (sel.range) queueMicrotask(() => host.intent.fire(highlightIntent(sel, 'reveal-if-exists')))
        }

        // (a) already open in this group → activate it (permanent promotes it).
        const existingIdx = m.tabs.findIndex((t) => t.child && fileOf(t.child.instance) === path)
        if (existingIdx >= 0) {
          const existing = m.tabs[existingIdx]!
          const previewId = mode === 'permanent' && m.previewId === existing.entryId ? undefined : m.previewId
          commitModel({ ...m, activeIndex: existingIdx, previewId })
          revealRange()
          return
        }

        // An explicitly selected empty viewer is the user's chosen destination. Fill it before
        // recycling a different preview tab; compare the resolved viewer kind, never a first-party id.
        const active = m.tabs[clampIndex(m.activeIndex, m.tabs.length)]
        if (active?.child && !fileOf(active.child.instance) &&
          bareTypeName(active.child.instance.type) === bareTypeName(viewerType)) {
          const tabs = m.tabs.map(tab => tab === active
            ? { ...tab, child: { ...active.child!, instance: content } }
            : tab)
          commitModel({ ...m, tabs, previewId: newIsTransient ? active.entryId : m.previewId === active.entryId ? undefined : m.previewId })
          revealRange()
          return
        }

        // (b) a preview tab exists → replace its file IN PLACE (reuse the one preview tab).
        if (m.previewId && !pinCurrent) {
          const idx = m.tabs.findIndex((t) => t.entryId === m.previewId)
          if (idx >= 0) {
            const tabs = m.tabs.map((t, i) =>
              i === idx ? { ...t, child: { id: t.child?.id ?? createChild(host, content, { transient: newIsTransient }), instance: content } } : t,
            )
            const previewId = mode === 'permanent' ? undefined : m.previewId
            commitModel({ ...m, tabs, activeIndex: idx, previewId })
            revealRange()
            return
          }
        }

        // preview-pin → PIN the current preview (drop its marker), then add the new one below.
        const basePreviewId = pinCurrent ? undefined : m.previewId
        // (c) add a new tab. Transient → it becomes the group's single preview tab.
        const tab = newTab(content, newIsTransient)
        const sourceId = tabForPublisher(from)
        const sourceIndex = sourceId ? m.tabs.findIndex((entry) => entry.child?.id === sourceId) : -1
        const insertAt = newFileTabIndex(m.tabs.length, m.activeIndex, sourceIndex, (host.config as Tabs | undefined)?.newTabPosition)
        const tabs = [...m.tabs.slice(0, insertAt), tab, ...m.tabs.slice(insertAt)]
        commitModel({ ...m, tabs, activeIndex: insertAt, previewId: newIsTransient ? tab.entryId : basePreviewId })
        revealRange()
      }

      if ('mustPick' in resolved) {
        // Empty = NOTHING eligible → DECLINE, let another container try. >=2 = a GENUINE choice: the host
        // CHOOSER asks the user (no silent default), and this group opens with the pick. The chooser is
        // host-owned chrome; the open stays ours. A cancel abandons the open — already claimed here.

        if (resolved.mustPick.length === 0) {
          if (apply) reportHostDiagnostic({
            code: 'no-viewer-for-file',
            severity: 'warning',
            message: `no projection declares (opens-meta) that it opens "${path}"; the open was declined`,
            subject: path,
          })
          return false
        }
        const chooser = host.chooser
        if (!chooser) {
          if (apply) reportHostDiagnostic({
            code: 'viewer-ambiguous-no-default',
            severity: 'warning',
            message: `multiple viewers can open "${path}" (${resolved.mustPick.join(', ')}) but no chooser surface is available; the open was declined`,
            subject: path,
          })
          return false
        }
        if (apply) {
          void chooser
            .choose({ title: `Open ${path.split('/').pop() ?? path} with`, options: viewerPickOptions(resolved.mustPick, descriptors) })
            .then((picked) => { if (picked) openWith(picked) })
        }
        return true // CLAIMED: this group opens it once the user picks (or abandons on cancel).
      }
      if (apply) openWith(resolved.viewer)
      return true
    },
    [commitModel, host, defaultOpenMode],
  )

  // promote-intent (firer-relative): the editor fires it on first edit; its tab loses
  // the preview marker (stays permanent). A double-click on the tab also promotes.
  const handlePromote = useCallback(
    (_intent: IntentPayload, from: PublisherId, apply: boolean): boolean => {
      const tabId = tabForPublisher(from)
      if (!tabId) return false // not our firer (firer-relative shouldn't reach us) → decline.
      if (apply) {
        const m = live()
        if (m.previewId === tabId) commitModel({ ...m, previewId: undefined })
      }
      return true
    },
    [commitModel],
  )

  // Reveal a matching tab or create a permanent tab from the requested type name.
  // Both outcomes claim the intent; the container owns placement and activation.
  const handleShow = useCallback((intent: IntentPayload, apply: boolean): boolean => {
    if (!isShowPaneIntent(intent)) return false
    const m = live()
    const idx = m.tabs.findIndex((t) => t.child && bareTypeName(t.child.instance.type) === bareTypeName(intent.paneType))
    if (idx >= 0) {
      if (apply) commitModel({ ...m, activeIndex: idx }) // REVEAL: already a tab here.
      return true
    }
    // CREATE: a bare instance of the requested type, as a new permanent tab.
    if (apply) {
      const tabs = [...m.tabs, newTab({ type: intent.paneType } as Projection)]
      commitModel({ ...m, tabs, activeIndex: tabs.length - 1 })
    }
    return true
  }, [commitModel, live])

  // open-pane-intent (ambient): place a caller-supplied projection as a new PERMANENT tab.
  const handleOpenPane = useCallback((intent: IntentPayload, apply: boolean): boolean => {
    if (!isOpenPaneIntent(intent) || !intent.pane) return false
    if (apply) {
      const m = live()
      const settings = host.config as Tabs | undefined
      const placeholder = settings?.emptyPlaceholder?.replace(/^\[\[/, '').replace(/\]\]$/, '').split('::')[0]
      const replace = settings?.replaceEmptyPlaceholderOnOpen && m.tabs.length === 1 &&
        bareTypeName(m.tabs[0]?.child?.instance.type ?? '') === placeholder
      const tabs = [...(replace ? [] : m.tabs), newTab(intent.pane as Projection)]
      commitModel({ ...m, tabs, activeIndex: tabs.length - 1 })
    }
    return true
  }, [commitModel, live])

  // REVEAL a specific pane by id: claim + activate the tab holding it (open-surfaces → "Open editors"
  // click). Declines when this group does not hold the pane, so the routed walk reaches the group that does.
  const handleReveal = useCallback((intent: IntentPayload, apply: boolean): boolean => {
    if (!isRevealPaneIntent(intent)) return false
    const m = live()
    const idx = m.tabs.findIndex((t) => t.child?.id === intent.paneId)
    if (idx < 0) return false
    if (apply) commitModel({ ...m, activeIndex: idx })
    return true
  }, [live, commitModel])

  useEffect(() => {
    const ch = host.intent
    const offs = [
      ...([-1, 1] as const).map(step=>ch.handle(step===1?'next-tab-intent':'previous-tab-intent', {
        claim:()=>true,
        commit:()=>{const m=live();if(m.tabs.length)commitModel({...m,activeIndex:(clampIndex(m.activeIndex,m.tabs.length)+step+m.tabs.length)%m.tabs.length})},
      })),
      ch.handle('select-tab-intent', {
        claim:()=>true,
        commit:(intent)=>{const m=live();const key=Number('key' in intent ? intent.key : undefined);const index=key===9?m.tabs.length-1:key-1;if(Number.isInteger(key)&&key>=1&&key<=9&&index>=0&&index<m.tabs.length)commitModel({...m,activeIndex:index})},
      }),
      ch.handle('keep-tab-intent', {claim:()=>true,commit:()=>{const m=live();if(m.previewId===m.tabs[clampIndex(m.activeIndex,m.tabs.length)]?.entryId)commitModel({...m,previewId:undefined})}}),
      ch.handle('new-tab-intent', { claim: () => true, commit: () => addEmptyTab() }),
      ch.handle('open-intent', { claim: (i, f) => handleOpen(i, f, false), commit: (i, f) => void handleOpen(i, f, true) }),
      ch.handle('promote-intent', { claim: (i, f) => handlePromote(i, f, false), commit: (i, f) => void handlePromote(i, f, true) }),
      ch.handle('show-pane-intent', { claim: (i) => handleShow(i, false), commit: (i) => void handleShow(i, true) }),
      ch.handle('open-pane-intent', { claim: (i) => handleOpenPane(i, false), commit: (i) => void handleOpenPane(i, true) }),
      ch.handle('reveal-pane-intent', { claim: (i) => handleReveal(i, false), commit: (i) => void handleReveal(i, true) }),
    ]
    return () => offs.forEach((off) => off())
  }, [host, handleOpen, handlePromote, handleShow, handleOpenPane, handleReveal, addEmptyTab, live, commitModel])

  // TRANSIENT declaration is synchronous. The preview's `pool.transient` flag is SET at
  // mint (`createChild({transient})`) and CLEARED synchronously by `commitModel` when the preview moves off
  // a child — both BEFORE the triggering save's serialize. The file-tree "Open editors" italic DERIVES from
  // `pool.transient` (host-owned), so tabs never writes the display index; the fact and its view stay in sync
  // by construction, and there is no late-cleanup race.

  // The pure re-point seam: each transform mirrors the mutating seam below but returns the
  // new model; `makePoolEdit` serializes it via `tabsToConfig` + `withCarry` (the substrate drops the
  // transient preview at serialize, not here), and the router batches src+tgt into one atomic commit. `idxIn` is `indexOf`
  // over a passed model.
  const idxIn = (m: TabsModel, id: string): number =>
    m.tabs.findIndex((t) => t.entryId === id || t.child?.id === id || t.slot.id === id)
  const removeTab = (m: TabsModel, idx: number): { model: TabsModel; child: ChildState } | null => {
    const tab = m.tabs[idx]
    if (!tab?.child || tab.slot.fixed) return null
    const tabs = survivesEmpty(tab.slot)
      ? m.tabs.map((t, n) => (n === idx ? { entryId: t.entryId, slot: t.slot } : t))
      : m.tabs.filter((_, n) => n !== idx)
    return {
      model: {
        ...m,
        tabs,
        previewId: m.previewId === tab.entryId ? undefined : m.previewId,
        activeIndex: clampIndex(m.activeIndex > idx ? m.activeIndex - 1 : m.activeIndex, tabs.length),
      },
      child: tab.child,
    }
  }
  const poolEdit = makePoolEdit<TabsModel>({
    host,
    live,
    ownedKeys: ['type', 'activeTab', 'tabs', 'defaultOpenMode', 'newTabPosition', 'startView', 'startViewCompactWhen', 'emptyPlaceholder', 'replaceEmptyPlaceholderOnOpen'],
    toConfig: (m) => tabsToConfig(m, host.config),
    remove: (m, localId) => {
      // POSITION-native: the substrate resolves the inbound address to an `entryId` at the boundary
      // (`resolve` below), so locate via `idxIn` (entryId / child.id / slot.id) — a raw `child.id ===`
      // match would miss a resolved RULED-tab entryId (`slot.id ≠ child.id`).
      const r = removeTab(m, idxIn(m, localId))
      return r ? { model: r.model, occupant: { instance: r.child.instance, id: r.child.id } } : null
    },
    place: (m, occ, target) => {
      const child: ChildState = { id: occ.id, instance: occ.instance as Projection }
      if (target.shape === 'gap' || target.shape === 'slot-rect') {
        const at = target.shape === 'gap' ? clampIndex(target.index, m.tabs.length + 1) : m.tabs.length
        const hole = m.tabs.findIndex((t) => t.child === undefined)
        if (target.shape === 'slot-rect' && hole >= 0) {
          return { ...m, tabs: m.tabs.map((t, n) => (n === hole ? { ...t, child } : t)), activeIndex: hole }
        }
        const tab: TabState = { entryId: child.id, child, slot: {} }
        const tabs = m.tabs.slice()
        tabs.splice(at, 0, tab)
        return { ...m, tabs, activeIndex: tabs.indexOf(tab) }
      }
      const tab: TabState = { entryId: child.id, child, slot: {} }
      const tabs = [...m.tabs, tab]
      return { ...m, tabs, activeIndex: tabs.length - 1 }
    },
    reorder: (m, sourceLocalId, target) => {
      if (target.shape !== 'gap' && target.shape !== 'slot-rect') return null
      const from = idxIn(m, sourceLocalId)
      if (from < 0) return null
      const tabs = m.tabs.slice()
      const [moved] = tabs.splice(from, 1)
      if (!moved) return null
      const at = target.shape === 'gap' ? clampIndex(target.index, tabs.length + 1) : tabs.length
      if (at === from) return POOL_EDIT_NOOP // no-op reorder — no change, no commitModel, and NOT a refusal
      tabs.splice(at, 0, moved)
      return { ...m, tabs, activeIndex: tabs.indexOf(moved) }
    },
    wrap: (m, slotId, groupId, groupInstance, removeLocalId) => {
      let cur = m
      if (removeLocalId != null) {
        // POSITION-native: `removeLocalId` arrives resolved to an `entryId` (the boundary resolve).
        const r = removeTab(cur, idxIn(cur, removeLocalId))
        if (r) cur = r.model
      }
      const at = idxIn(cur, slotId)
      if (at < 0) return null
      const tabs = cur.tabs.map((t, n) =>
        n === at ? { ...t, child: { id: groupId, instance: groupInstance as Projection } } : t,
      )
      return { ...cur, tabs }
    },
  })

  // ── ContainerPlacement — the substrate drives this container through the seam.
  //    panes/findPane/activate/getSlotContent are live now; moveWithin/extract/
  //    inject/setSlotContent back the drag + wrap/dissolve.
  const placement: ContainerPlacement = {
    panes: () => live().tabs.map((t) => t.child?.id).filter((id): id is string => id !== undefined),
    findPane: (id: PaneId): Pane | null => {
      const t = live().tabs.find((x) => x.child?.id === id)
      return t ? { id, type: t.child!.instance.type ?? '' } : null
    },
    // The resolve-at-boundary normalizer: map any inbound address (an `entryId`, a child `^:` OCCUPANT
    // id, or a slot id) to the canonical POSITION id — the tab's `entryId`. `indexOf` resolves all three;
    // a bare `entryId` is idempotent. A bare tab's `entryId` EQUALS its `child.id` (self-map); a ruled tab's
    // is `slot.id`. `null` when this container holds no such id.
    resolve: (address) => {
      if (address === groupId && live().tabs.length === 0) return groupId
      const i = indexOf(address)
      return i >= 0 ? (live().tabs[i]?.entryId ?? null) : null
    },
    activate: (id: PaneId) => {
      // POSITION-native: `id` arrives resolved to an `entryId` (the boundary resolve).
      const i = indexOf(id)
      if (i >= 0) selectTab(i)
    },
    // The OCCUPANT: its instance AND its own `^:` id, which is not the position's — `indexOf`
    // accepts an `entryId`, a `slot.id` or a `child.id`, so the address reaching here may be any
    // of three and only one of them names the occupant.
    getSlotContent: (slotId: string): Occupant | null => {
      const child = live().tabs[indexOf(slotId)]?.child
      return child ? { instance: child.instance, id: child.id } : null
    },
    setSlotContent: (slotId: string, instance: PaneInstance, occupantId?: string) => {
      // No local `admits` guard: the substrate checks it at every seam that reaches here, BEFORE
      // anything destructive runs.
      const m = live()
      if (m.tabs.length === 0) {
        // EMPTY CONTAINER: no position exists yet, so `updateChild` would no-op. CREATE the first tab —
        // the empty-slot driver (`EmptySlot`) materializing its placeholder into an empty group. Addressed
        // by `groupId`; the group having zero tabs is the unambiguous trigger.
        const child: ChildState = { id: occupantId ?? createChild(host, instance as Projection), instance: instance as Projection }
        commitModel({ ...m, tabs: [{ entryId: child.id, child, slot: {} }], activeIndex: 0 })
        return
      }
      updateChild(slotId, instance as Projection, occupantId)
    },
    moveWithin: (sourceLocalId: string, target: DropTarget) => {
      // In-tabs move. A `gap` (strip) reorders to its logical index; a `slot-rect`
      // (body) has no split, so it means "move to the end" (the add-a-tab position).
      if (target.shape !== 'gap' && target.shape !== 'slot-rect') return false
      const m = live()
      const from = indexOf(sourceLocalId)
      if (from < 0) return false
      const tabs = m.tabs.slice()
      const [moved] = tabs.splice(from, 1)
      if (!moved) return false
      const at = target.shape === 'gap' ? clampIndex(target.index, tabs.length + 1) : tabs.length
      // A no-op reorder (dropped back in its own place) is ACCEPTED but not committed — the strip
      // claims its whole area during the drag, so a drop in the tab's own neighbourhood lands here
      // rather than the pane, and must not churn the config.
      if (at === from) return true
      tabs.splice(at, 0, moved)
      commitModel({ ...m, tabs, activeIndex: tabs.indexOf(moved) })
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
      // Dropping onto an EMPTY position fills it rather than inserting beside it, so a position
      // kept alive by `admits` can actually be refilled by a drop.
      if (target.shape === 'gap' || target.shape === 'slot-rect') {
        const at = target.shape === 'gap' ? clampIndex(target.index, m.tabs.length + 1) : m.tabs.length
        const hole = m.tabs.findIndex((t) => t.child === undefined)
        if (target.shape === 'slot-rect' && hole >= 0) {
          commitModel({ ...m, tabs: m.tabs.map((t, n) => (n === hole ? { ...t, child } : t)), activeIndex: hole })
          return
        }
        const tab: TabState = { entryId: child.id, child, slot: {} }
        const tabs = m.tabs.slice()
        tabs.splice(at, 0, tab)
        commitModel({ ...m, tabs, activeIndex: tabs.indexOf(tab) })
        return
      }
      const tab: TabState = { entryId: child.id, child, slot: {} }
      const tabs = [...m.tabs, tab]
      commitModel({ ...m, tabs, activeIndex: tabs.length - 1 })
    },
    // The lookup only this container can answer. NOTE: tabs emits exactly ONE `slot-rect` — the
    // whole group body — and `gap` targets carry an index rather than a position id, so a per-slot
    // `admits` has no drop target of its own to attach to on a plain inject. It still governs the
    // SOURCE side (`fixed` refusing a drag-out or a close) and any `setSlotContent`, which is what
    // a wrap or a dissolve goes through.
    slotFor: (id: string): ContainerSlot | null => {
      if (id === groupId && live().tabs.length === 0) {
        const placeholder = (host.config as Tabs | undefined)?.emptyPlaceholder
        if (placeholder) return { placeholder } as ContainerSlot
      }
      const tab = live().tabs[indexOf(id)]
      return tab ? slots.toSeamSlot(tab.slot) : null
    },
    ...(poolEdit ? { poolEdit } : {}),
  }
  // tabs declares BOTH its placement + its drop dialect on its root element.
  const setPlacementRoot = useContainerPlacement(placement)
  const setDialectRoot = useContainerDialect(tabsDropDialect)
  // Capture the root element too, to resolve the pane tabs OCCUPIES (its enclosing `data-pane-id`) and
  // contribute the strip into that pane header's `center` region — ONE bar with the pane's grip +
  // actions. `headerTarget` is `null` at the composition root / when no region is offered, so the strip
  // then renders inline above the body (fallback).
  const [rootEl, setRootEl] = useState<Element | null>(null)
  const setContainerRoot = useMergedRef(setPlacementRoot, setDialectRoot, setRootEl)
  const enclosingPaneId = useEnclosingPaneId(rootEl)
  const headerTarget = useHeaderContribution(enclosingPaneId, 'center')
  // The strip is PORTALED into the enclosing container's header DOM, so the DOM-authoritative drop
  // router would resolve a drag that STARTS inside the portaled strip to THAT container (a tab handle's
  // nearest registered root would be bento). Declare the offered region as a SECOND tabs root (placement
  // + dialect, second hook instances over the same live objects), so a tab drag/drop inside the portaled
  // strip routes to tabs — reorder-in-place (source + gap both resolve to the region) and cross-container
  // extract (region ≠ the target) both hold. Only while the strip is contributed.
  const setRegionPlacement = useContainerPlacement(placement)
  const setRegionDialect = useContainerDialect(tabsDropDialect)
  useEffect(() => {
    if (!headerTarget) return
    setRegionPlacement(headerTarget)
    setRegionDialect(headerTarget)
    // Declare the SAME container id as the body root, so a drag from this portaled strip onto the body
    // resolves as same-container (multi-surface identity). The region is the pane owner's DOM; tabs owns
    // it only while contributing, so the marker is set and cleared with the registration.
    headerTarget.setAttribute('data-container-id', groupId)
    return () => {
      setRegionPlacement(null)
      setRegionDialect(null)
      headerTarget.removeAttribute('data-container-id')
    }
  }, [headerTarget, setRegionPlacement, setRegionDialect, groupId])
  // A fixed slot refuses both movement and removal. The tab remains visible and
  // selectable, but has no drag handle or close action.
  const descriptors = host.describeProjections?.() ?? []
  const titleOf = projectionTitleLookup(descriptors)
  const iconOf = projectionIconLookup(descriptors)
  const containerTypes = new Set(descriptors.filter((p) => p.kinds.includes('container-projection')).map((p) => bareTypeName(p.type)))
  const tabItems: TabItem[] = model.tabs.map((t) => ({
    id: t.entryId,
    icon: tabContentIcon(t.child && fileOf(t.child.instance), iconOf(t.child?.instance.type)),
    // An authored slot `label`, else the occupant's declared title, else its derived name. NEVER
    // suppressed: a tab label distinguishes SIBLINGS, so a blank one is a tab nobody can aim at.
    // The POSITION's name wins whether or not it is occupied; only a nameless empty one falls
    // back. Gating on the child drops an authored label the moment the tab is emptied.
    label: t.slot.label || (t.child && fileOf(t.child.instance))?.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || positionName(t.slot, t.child?.instance.type, titleOf(t.child?.instance.type)) || 'New pane',
    isPreview: t.entryId === model.previewId,
    group: !!t.child && containerTypes.has(bareTypeName(t.child.instance.type)),
    groupLabel: t.child ? titleOf(t.child.instance.type) || positionName({}, t.child.instance.type) : undefined,
    fixed: t.slot.fixed === true,
    dirty: dirtyPubs.has(host.children.publisherOf?.(t.entryId) ?? ''),
  }))
  // The tab currently being dragged (from the shared drag store), so the strip lifts that cell. The
  // store addresses the source by its CHILD id; map it back to the tab POSITION the strip renders.
  const dragSourceLocalId = useLayoutDrag((s) => s.drag?.source.localId ?? null)
  const draggingTabId =
    dragSourceLocalId != null ? (model.tabs.find((t) => t.child?.id === dragSourceLocalId)?.entryId ?? null) : null

  const startRef = (host.config as Tabs | undefined)?.startView
  const startId = typeof startRef === 'string'
    ? startRef.replace(/^\[\[\^\^/, '').replace(/\]\]$/, '')
    : startRef?.['^']
  const startRecord = startId
    ? host.children.pool?.resolveRecord(startId) as Projection | undefined
    : undefined
  const compactFor = (host.config as Tabs | undefined)?.startViewCompactWhen
  const hasMatchingSurface = () => !!compactFor && !!host.openSurfaces?.list().some(surface => bareTypeName(surface.projection) === bareTypeName(compactFor.replace(/^\[\[/, '').replace(/\]\]$/, '')))
  const [compactStart, setCompactStart] = useState(hasMatchingSurface)
  useEffect(() => host.openSurfaces?.subscribe(() => setCompactStart(hasMatchingSurface())), [host, compactFor])
  const emptyType=(host.config as Tabs | undefined)?.emptyPlaceholder?.replace(/^\[\[/,'').replace(/\]\]$/,'')
  const unusedPlaceholder=!!(host.config as Tabs | undefined)?.replaceEmptyPlaceholderOnOpen && model.tabs.length===1 && !!emptyType && bareTypeName(model.tabs[0]?.child?.instance.type??'')===bareTypeName(emptyType)
  const startEmpty=(model.tabs.length===0 || unusedPlaceholder) && !compactStart
  return (
    <div
      ref={setContainerRoot}
      data-layout-container-slot={groupId}
      data-container-kind="tabs"
      // Multi-surface identity: this body root AND the strip's portaled region (below) both declare the
      // same container id, so a tab dragged from the header strip onto its own body is same-container
      // (a no-op), not a cross-container re-inject (which duplicated the view). See sameContainerRoot.
      data-container-id={groupId}
      className="au-tabs-layout"
      data-start-empty={!!startRecord && startEmpty}
      style={{ width: '100%', height: '100%' }}
      // Any interaction inside marks this tabs the active container (focus-MRU), so a
      // subsequent file-tree open routes here.
      onPointerDownCapture={() => reportFocusFor(model.tabs[activeIndex]?.child?.id)}
    >
      {startRecord && startId && <div className="au-tabs-start" data-droptarget-shape={startEmpty?'slot-rect':undefined} data-container-kind="tabs" data-droptarget-id={groupId}>
        <PaneProjection host={host} paneId={startId} id={startRecord.type??''} config={startRecord} onChildConfig={()=>{}} />
      </div>}
      <div className="au-tabs-content" hidden={!!startRecord && startEmpty}>
      {model.tabs.length === 0 ? (
        startRecord && startEmpty ? null : (
        // An empty tabs is a first-class DROP TARGET (owns "add the first tab", so a drop
        // lands here directly, never wrapping at the parent) + shows the projection PICKER.
        <div
          data-droptarget-shape="slot-rect"
          data-container-kind="tabs"
          data-droptarget-id={groupId}
          style={{ width: '100%', height: '100%' }}
        >
          {/* Empty group: the substrate resolves the placeholder and materializes it as the first tab via
              the seam (setSlotContent above creates it). Addressed by `groupId`. */}
          <EmptySlot host={host} slotId={groupId} />
        </div>)
      ) : (
        <TabGroup
          hideStrip={!!(host.config as Tabs)?.replaceEmptyPlaceholderOnOpen && model.tabs.length===1 && bareTypeName(model.tabs[0]!.child?.instance.type??'')===(host.config as Tabs)?.emptyPlaceholder?.replace(/^\[\[/,'').replace(/\]\]$/,'').split('::')[0]}
          tabs={tabItems}
          activeIndex={activeIndex}
          containerKind="tabs"
          slotId={groupId}
          headerTarget={headerTarget}
          draggingTabId={draggingTabId}
          focused={groupFocused}
          onActivate={(index) => { if (!draggedClickRef.current) selectTab(index) }}
          onClose={closeTab}
          // Double-click promotes the preview tab, matching the promotion performed on its first edit.
          onTabDoubleClick={(tab) => {
            const m = live()
            if (m.previewId === tab.id) commitModel({ ...m, previewId: undefined })
          }}
          // The strip's "+" adds a fresh empty tab with the placeholder picker.
          onAdd={addEmptyTab}
          // Swap the ACTIVE tab: TabGroup calls this for the active tab only, and wraps it with
          // stopPropagation, so the strip carries one swap control for the tab in view.
          renderTabActions={(tab) => {
            if (tab.fixed) return null
            // The occupant's own id (its `data-pane-id`) is what the wrap/unwrap seams address.
            const contentId = model.tabs.find((t) => t.entryId === tab.id)?.child?.id
            const choose = host.chooser ? host.chooser.choose.bind(host.chooser) : async () => null
            // The current tab's dropdown addresses its content; the enclosing pane's overflow
            // addresses the entire tab container. Distinct triggers preserve both action scopes.
            const rows: ContextMenuItem[] = [
              { id: 'tab.swap', label: 'Swap pane', icon: 'swap', enabled: true, run: () => swapPane.toggle(tab.id) },
            ]
            if (contentId) {
              rows.push({
                id: 'tab.wrap',
                label: 'Wrap in a container',
                icon: 'wrap',
                enabled: true,
                run: () => void wrapPaneInteractive(contentId, { choose }),
              })
              // Unwrap this tabs only when it holds ONE tab (lift the occupant into the grandparent slot).
              if (model.tabs.length === 1)
                rows.push({ id: 'tab.unwrap', label: 'Unwrap container', icon: 'unwrap', enabled: true, run: () => dissolvePane(contentId) })
              const floatRow = floatPaneRow(host, contentId) // the GENERIC host float, shared across containers
              if (floatRow) rows.push(floatRow)
            }
            // "Move to other window" appended LAZILY — its gate reflects the CURRENT window set at open, not
            // this tab's render (a foreign window opening does not re-render this container). See paneActionsMenu.
            return paneActionsMenu(host, () => {
              const moveRow = contentId ? moveToWindowRow(host, contentId) : null
              return [...rows, ...(moveRow ? [moveRow] : []), ...(contentId ? reloadPaneRows(host, contentId) : [])]
            }, 'Current tab actions', 'chevron-down')
          }}
          onTabDragStart={(tabId, point, sourceEl) => {
            // A drag began on a tab's grip (the bar's au-tab-drag-start). Start the container's drag
            // protocol directly (raw coords + a source element, no React event). `type` lets a TARGET
            // slot decide whether it admits this pane; it comes from the model the item was built from.
            const t = model.tabs.find((x) => x.entryId === tabId)
            if (!t?.child) return // an empty position has nothing to drag
            dragDisposeRef.current?.()
            draggedClickRef.current = false
            dragDisposeRef.current = startDragGesture(
              {
                containerKind: 'tabs',
                localId: t.child.id,
                role: 'tab',
                onDragStart: () => {
                  draggedClickRef.current = true
                  const release = (): void => {
                    window.removeEventListener('pointerup', release)
                    window.removeEventListener('pointercancel', release)
                    setTimeout(() => { draggedClickRef.current = false }, 0)
                  }
                  window.addEventListener('pointerup', release)
                  window.addEventListener('pointercancel', release)
                },
                label: tabItems.find((it) => it.id === tabId)?.label ?? '',
                type: t.child.instance.type,
              },
              point,
              sourceEl,
            )
          }}
          renderContent={(tab) => {
            const t = model.tabs.find((x) => x.entryId === tab.id)
            if (!t) return null
            // A position kept alive by its rules, waiting for content: the picker, narrowed to
            // what it admits, using the SAME predicate the seam refuses with.
            if (!t.child) {
              // A position kept alive by its rules, waiting for content: the substrate resolves the
              // placeholder and materializes it into this position via the seam. `admits` is honoured at
              // the seam (`occupantRefused`); a slot admitting no placeholder shows truly empty.
              return <EmptySlot host={host} slotId={t.entryId} />
            }
            const child = t.child
            // Swap picker for this tab (only the active tab shows the swap control that sets this).
            if (swapPane.isSwapping(t.entryId)) return swapPane.swapPicker(t.entryId, child.instance)
            return (
              <PaneProjection
                // Key on type + the open FILE (if any) — matches bento: an open
                // that swaps this tab's file remounts the child; a same-file config
                // save keeps the key stable, so it does not remount.
                key={`${child.instance.type}:${(child.instance as { file?: string }).file ?? ''}`}
                host={host}
                paneId={child.id}
                id={child.instance.type ?? ''}
                config={child.instance}
                onChildConfig={(next) => updateChild(t.entryId, next as Projection)}
              />
            )
          }}
        />
      )}
      </div>
    </div>
  )
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const release=host.styles?.inject(`
    .au-tabs-layout { display:flex; flex-direction:column; min-height:0; }
    .au-tabs-start { flex:0 0 calc(var(--au-row-h) + var(--au-space-4)); min-height:0; }
    .au-tabs-layout[data-start-empty="true"] .au-tabs-start { flex:1; }
    .au-tabs-content { flex:1; min-height:0; }
    .au-tabs-content[hidden] { display:none; }
  `,container)
  const dispose=mountReactRoot(container, <TabsApp host={host} />)
  return()=>{dispose();release?.()}
}

/** Build a tabs group through the container-owned module export. Each child keeps
 * its stable pane id as its `^:` block-id, preserving terminal sessions and editor
 * view state across grouping. The last child becomes active.
 * The emitted type is bare; the host qualifies it through `qualifyComposition`. */
const buildGroup: GroupBuildFn<Tabs> = (children) => ({
  type: 'tabs',
  activeTab: children[children.length - 1]?.id, // active = the LAST child (the one just dropped), by id
  tabs: children.map((c) => ({ '^': c.id, ...(c.instance as Record<string, unknown>) })) as Tabs['tabs'],
})

/**
 * The registered module — the projection's single default export. `defineProjection` brands it as the
 * loader's registration gate (the host resolves `mount` and `buildGroup` off the branded default), and
 * typing `GroupingContainerModule<Tabs>` makes a missing / mis-shaped surface a COMPILE error here —
 * `buildGroup` returns the generated `Tabs`, so a malformed group is caught too.

 */
export default defineProjection<GroupingContainerModule<Tabs>>({ mount, buildGroup })
