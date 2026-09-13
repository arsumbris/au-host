import { useSidebarNarrowing } from './use-sidebar-narrowing'
// The `aup-workspace-sidebar` container-projection. A VERTICAL frame — top | body | foot — where the top and foot
// are CHROME the rail renders (the OS-lights reserve, the workspace switcher, settings), and
// the BODY is the one placement slot, holding a container (a `column` that stacks the sidebar's views).
//
// A PEER container over the shared substrate (like sandwich): PaneProjection mounts the body child,
// ContainerPlacement lets the shared router re-parent it, a drop dialect declares its single drop zone.
// It is a container so its own slot goes bare (no parent masthead) and it owns its whole surface.
//
// The body holds ONE child by REFERENCE (`mountable*`), which carries its stable `^:` id across reload
// and re-parenting; an inline projection there is a type error.

import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ContainerPlacement,
  ContainerSlot,
  DropTarget,
  IntentPayload,
  MountHost,
  Occupant,
  Pane,
  PaneId,
  PaneInstance,
  Projection,
  ProjectionModule,
} from '@arsumbris/au-host-sdk'
import { defineProjection, isAuthoringMember } from '@arsumbris/au-host-sdk'
import {
  createChild,
  EmptySlot,
  makePoolEdit,
  mintBlockId,
  PaneProjection,
  useContainerDialect,
  useContainerModel,
  useContainerPlacement,
  useMergedRef,
} from '@arsumbris/container-kit'
// The generated set-independent React wrappers (render the tag, import no set class): props reach the
// element as properties + custom events wire as typed onAuXxx props — no ref + addEventListener.
import { AuIconButton, AuIcon, AuWorkspaceSwitcher, AuStatusDot, AuNavItem } from '@arsumbris/au-component-catalog/react'
import type { AuWorkspaceItem } from '@arsumbris/au-component-catalog'
import { railDropDialect } from './drop-dialect'
import type { AupWorkspaceSidebar } from './generated'

let idSeq = 0
function genId(): string {
  return `rail-${Date.now().toString(36)}-${(idSeq++).toString(36)}`
}

/** The empty-body slot id — the drop target when the body is vacant (a child id when occupied). */
const BODY_SLOT = 'body'

interface RailModel {
  /** The body's occupant: its stable `^:` id + the projection instance it mounts. */
  body?: Occupant<Projection>
}

function persistedId(child: Projection): string | undefined {
  const id = (child as { '^'?: unknown })['^']
  return typeof id === 'string' ? id : undefined
}

/** Read the body value into the runtime occupant. The body slot is `mountable*`, so its TYPE is a
 *  reference; the host resolves it to an inline instance before the container reads it, so the value
 *  seen at runtime is an object. A string (an unresolved ref) or absence → no body, never a throw. */
function bodyFrom(child: unknown): Occupant<Projection> | undefined {
  if (child == null || typeof child === 'string') return undefined
  const c = child as Projection
  return { id: persistedId(c) ?? mintBlockId(), instance: c }
}

function fromConfig(cfg: AupWorkspaceSidebar | undefined): RailModel {
  return { body: bodyFrom(cfg?.body) }
}

/** Emit only what the rail owns. Config ownership is the host's: it derives the owned set from the
 *  type graph and preserves every composition-level field (a root rail's `intent-routing`) untouched,
 *  so this returns `{ type, body }` and nothing else. */
function toConfig(model: RailModel): AupWorkspaceSidebar {
  const out: AupWorkspaceSidebar = { type: 'aup-workspace-sidebar' }
  if (model.body) out.body = { '^': model.body.id, ...model.body.instance } as unknown as AupWorkspaceSidebar['body']
  return out
}

/** Set the body's occupant, keeping (or minting) its stable id. */
function setBodyOn(model: RailModel, instance: Projection, id?: string): RailModel {
  return { ...model, body: { id: id ?? model.body?.id ?? mintBlockId(), instance } }
}

/** Does this slot id address the body — its child id when occupied, or the empty-slot name? */
function bodyMatches(model: RailModel, slotId: string): boolean {
  return slotId === BODY_SLOT || model.body?.id === slotId
}

const STYLE = `
.au-rail {
  display: flex; flex-direction: column;
  height: 100%; width: 100%;
  box-sizing: border-box;
  background: transparent;
  position: relative;
  overflow: hidden;
}

/* The collapse control shares the identity row and stays at the trailing edge when narrowed. */
.au-rail-lights {
  position: absolute; inset-block-start: 0; inset-inline-end: 0;
  height: calc(var(--au-tabs-h) + var(--au-space-1));
  width: var(--au-side-w-mini);
  display: flex; align-items: center; justify-content: center;
}
/* The collapse control carries data-au-no-drag in the JSX so chrome.css's
   [data-au-drag] [data-au-no-drag] supplies -webkit-app-region:no-drag and keeps it clickable. */

/* IDENTITY — the WorkspaceSwitcher row (its own mark + name + chevron + menu). NOT a drag region:
   the lights row above is the window handle, and this row is interactive. A bottom hairline seams it
   off the body. */
.au-rail-identity {
  flex: none; display: flex; align-items: center;
  min-height: calc(var(--au-tabs-h) + var(--au-space-1));
  padding: var(--au-space-1) var(--au-side-w-mini) var(--au-space-1) var(--au-space-2);

}
.au-rail-identity > * { min-width: 0; flex: 1 1 auto; }
/* DIRTY MARKER — the quiet at-rest "unsaved work" dot trailing the wordmark. flex:none (kept by a
   selector specific enough to beat the > * flex above) makes it a fixed pip; the switcher keeps the
   row. Neutral ink StatusDot, no coloured accent — the whole signal is one small monochrome dot. */
.au-rail-identity .au-rail-dirty {
  flex: none;
  display: inline-flex; align-items: center;
  margin-inline-start: var(--au-space-1);
}

/* BODY — the view area. It holds the column (a container), so it goes BARE: no masthead here, the
   column draws its own per-view headers. Fills the remaining height. */
.au-rail-body {
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.au-rail-body > * { flex: 1 1 auto; min-width: 0; min-height: 0; }

/* FOOT — the Settings control (opens the Settings hub). NO theme toggle: the hub's Appearance
   section owns theme presets, so a second control here would be a duplicate. */
.au-rail-foot {
  flex: none;
  display: flex; align-items: center; gap: var(--au-space-1);
  padding: var(--au-space-1) var(--au-space-3);
  background: linear-gradient(var(--au-line-1), var(--au-line-1)) center top / calc(100% - var(--au-space-6)) 1px no-repeat;
}
.au-rail-foot__settings { flex: 1 1 auto; min-width: 0; }

/* ── NARROWED (icon-rail) ─────────────────────────────────────────────────────────────────────────
   The rail stays MOUNTED and NARROWS (the sandwich region drives the width; the rail responds to its
   own observed width). Everything that needs room folds away; the mark, collapse, and foot icons
   remain as the spine. This is ONE subtree narrowing — not a swap to a different tree — so the region
   width transition below is structurally possible, and the column in the body keeps its state.
   The parts that fold use a token-driven opacity/visibility so reduced-motion collapses the fade. */
/* Fold only after the opacity transition; keep the mounted body and its state intact. */
.au-rail-collapsible {
  transition: opacity var(--au-m-base) var(--au-e-std);
}
.au-rail[data-collapsing] .au-rail-collapsible { opacity: 0; pointer-events: none; }
/* NARROWED SPACING — the collapsed rail is exactly --au-side-w-mini (48px) wide; its spine is the
   persistent collapse toggle (top) + the foot gear (bottom). DELIBERATELY no rail-level padding-block:
   the toggle must keep the SAME vertical position it holds when expanded (it only travels HORIZONTALLY as
   the width animates), so top padding here would jog it downward on the narrowed commit. Top breathing
   room is the lights row's own reserve; bottom is the foot's own padding; both ride --au-space-*. */
.au-rail[data-narrowed] .au-rail-collapsible { display: none; }
/* The narrowed-only affordance: a foot Settings icon, and NOTHING at the top. The ONE persistent
   toggle is the whole top spine — a second narrowed-only mark button there duplicates it and pops in
   below it on collapse. */
.au-rail-foot-solo { display: none; }
.au-rail[data-narrowed] .au-rail-foot-solo { display: inline-flex; }
/* The narrowed-only dirty mirror rides the SAME gate as the solo gear: hidden while wide (the identity
   row's dot is the one shown), shown on the icon spine when narrowed. Centred like the foot icons. */
.au-rail-dirty-solo { display: none; }
.au-rail[data-narrowed] .au-rail-dirty-solo {
  display: inline-flex; align-items: center; justify-content: center;
}
/* The toggle remains anchored to the trailing edge in both width states. */
/* The body folds away when narrowed, so nothing grows to fill — anchor the foot icon to the bottom and
   centre it in the column. Spacing is all token-scale. */
.au-rail[data-narrowed] .au-rail-foot {
  flex-direction: column; align-items: center;
  gap: var(--au-space-2); padding: var(--au-space-2) 0;
  margin-block-start: auto; background: none;
}
@media (prefers-reduced-motion: reduce) { .au-rail-collapsible { transition: none; animation: none; } }

`

/** A recently-opened workspace, as the host's local recents store reports it. A minimal, defensively
 *  re-declared view of the app's `RecentWorkspace` — the rail is a projection and does not import the
 *  app's shared types. */
interface RecentWorkspaceLite {
  /** The folder-repo ENTRY root — the recents store key, and the thing a switch opens. */
  root: string
  /** Epoch ms of the last open (drives the meta line + ordering). */
  lastOpened: number
  /** True when the root no longer carries `.arsumbris/repo.yaml` — shown as stale, not hidden. */
  stale?: boolean
}

/** The optional host capabilities the rail's launcher chrome reaches through the `host` it is mounted
 *  with. Every field is optional and every call is optional-chained, so a capability the host does not
 *  yet provide degrades to a marked no-op rather than a crash — the rail never reaches past `host`. */
interface RailCaps {
  /** The launcher recents store — the workspaces the switcher lists. */
  recents?: { listWorkspaces?: () => Promise<RecentWorkspaceLite[]> }
  /** The native folder picker (returns an absolute path, or null on cancel). */
  workspace?: { pickFolder?: () => Promise<string | null> }
  /** Host instances: `open` opens a workspace entry in its own independent instance (focusing an
   *  existing one for that entry if already open); `newWorkspace` opens a fresh instance at the setup
   *  gate. */
  windows?: {
    open?: (entryPath: string) => Promise<unknown>
    newWorkspace?: () => Promise<void> | void
  }
}
function caps(host: MountHost): Partial<RailCaps> {
  return host as unknown as Partial<RailCaps>
}

/** The last path segment of an entry root — the workspace's human name in the recents surfaces. */
function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return (idx >= 0 ? trimmed.slice(idx + 1) : trimmed) || path
}

/** Observe the host-owned composition dirty flag on `<html>`. The document
 * attribute is visible across projection bundles; the host aggregates dirty state
 * across panes. An absent attribute reads as false. */
const COMPOSITION_DIRTY_ATTR = 'data-au-composition-dirty'
function useCompositionDirty(): boolean {
  const read = (): boolean =>
    typeof document !== 'undefined' && document.documentElement.hasAttribute(COMPOSITION_DIRTY_ATTR)
  const [dirty, setDirty] = useState(read)
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const root = document.documentElement
    const sync = (): void => setDirty(root.hasAttribute(COMPOSITION_DIRTY_ATTR))
    sync() // catch a flip that landed between the lazy initial read and this effect running
    const mo = new MutationObserver(sync)
    mo.observe(root, { attributes: true, attributeFilter: [COMPOSITION_DIRTY_ATTR] })
    return () => mo.disconnect()
  }, [])
  return dirty
}

function RailApp({ host }: { host: MountHost }): ReactNode {
  const groupId = useMemo(() => genId(), [])
  const initial = useMemo(() => fromConfig(host.config as AupWorkspaceSidebar | undefined), [host])
  // `model` renders, `live()` is what every seam method reads, `commit` advances and persists. One drop
  // drives the seam several times in ONE tick, so a seam reading the render closure would rebuild from a
  // stale snapshot; `live()` is always current. The rule lives in `useContainerModel` / `ModelCell`.
  const { model, live, commit } = useContainerModel<RailModel>(
    initial,
    (next) => host.saveConfig(toConfig(next)),
    // RE-SEED on an external structural edit, so the rail's body anchor tracks its authoritative record.
    { host, fromConfig: (raw) => fromConfig(raw as AupWorkspaceSidebar | undefined) },
  )

  // The at-rest DIRTY signal — "you have unsaved work", surfaced quietly by the workspace wordmark
  // below (and mirrored on the icon spine when narrowed). Read from the host's document flag, so it is
  // false until the host wires it (see useCompositionDirty). A named boolean, not a lifecycle effect.
  const dirty = useCompositionDirty()

  // A stable handle on the mount host, so an empty-deps callback (the ResizeObserver below) can reach
  // the host capabilities without re-binding when nothing about the host changed.
  const hostRef = useRef(host)
  hostRef.current = host

  // The workspace identity for the switcher: the ENTRY member's name — the folder-repo the daemon
  // entered on, which IS the workspace. Falls back to any authoring member, then the first, then a
  // neutral label. (Not `isAuthoringMember` first: that picks whichever authoring member sorts first,
  // e.g. a member repo, over the entry the workspace is actually named by.)
  const wsName = useMemo(() => {
    const members = host.workspace.members
    return (
      members.find((m) => m.role === 'entry')?.name ??
      members.find(isAuthoringMember)?.name ??
      members[0]?.name ??
      'Workspace'
    )
  }, [host])
  // The CURRENT workspace's ENTRY root — the folder-repo the daemon entered on (`role: 'entry'`). This
  // is the recents-store KEY for "this workspace", so it is what marks the current row in the switcher
  // and what a recents list excludes. Falls back to the first authoring member's root.
  const currentRoot = useMemo(() => {
    const members = host.workspace.members
    return members.find((m) => m.role === 'entry')?.root ?? members.find(isAuthoringMember)?.root ?? ''
  }, [host])
  const { narrowed, collapsing, measureRef } = useSidebarNarrowing()

  // REAL RECENTS — the host's local recents store, the workspaces the switcher lists. Read once at
  // mount (most-recent first, stale pruned by the store). Optional-chained so a host that does not yet
  // expose recents yields an empty list rather than throwing — nothing fabricated, just fewer rows.
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspaceLite[]>([])
  useEffect(() => {
    let alive = true
    void caps(host)
      .recents?.listWorkspaces?.()
      .then((list) => {
        if (alive) setRecentWorkspaces(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        /* a recents-read failure is not fatal to the rail — leave the list empty */
      })
    return () => {
      alive = false
    }
  }, [host])

  // OPEN A WORKSPACE IN ITS OWN INSTANCE — the switch action, the recents-row click, and "Open folder…"
  // all land here, via the host's `windows.open(entryPath)`. Optional-chained + warn-on-absence so the
  // rail runs even against a host that does not yet expose it; when the cap is present, a switch just works.
  const openWorkspace = useCallback(
    (root: string): void => {
      if (!root) return
      const open = caps(host).windows?.open
      if (open) void open(root).catch(() => {})
      else console.warn(`[rail] windows.open capability not present yet; ignored open of ${root}`)
    },
    [host],
  )

  // The workspaces the switcher offers: the CURRENT workspace first (marked via `currentId`), then the
  // real recents with the current one removed (it is already shown as current). `id` IS the entry root,
  // so a selection opens that exact workspace.
  const workspaces: AuWorkspaceItem[] = useMemo(() => {
    const items: AuWorkspaceItem[] = []
    if (currentRoot) items.push({ id: currentRoot, name: wsName })
    for (const w of recentWorkspaces) {
      if (w.root === currentRoot) continue
      items.push({ id: w.root, name: baseName(w.root) })
    }
    return items
  }, [currentRoot, wsName, recentWorkspaces])

  // Selecting the CURRENT workspace (the marked row) is a no-op — you are already in it; only another
  // workspace opens a window.
  const onSwitchWorkspace = useCallback(
    (id: string): void => {
      if (id === currentRoot) return
      openWorkspace(id)
    },
    [openWorkspace, currentRoot],
  )

  // "Open folder…" — the native picker, then open the chosen folder as a workspace in its own instance.
  const onOpenFolder = useCallback((): void => {
    void caps(host)
      .workspace?.pickFolder?.()
      .then((dir) => {
        if (dir) openWorkspace(dir)
      })
      .catch(() => {})
  }, [host, openWorkspace])

  // "New workspace…" — the host's setup-gate flow, opening a fresh instance. Optional-chained until the
  // host exposes it; a marked no-op otherwise, never a fabricated create.
  const onNewWorkspace = useCallback((): void => {
    const create = caps(host).windows?.newWorkspace
    if (create) void create()
    else console.warn('[rail] new-workspace launcher flow not present yet; ignored')
  }, [host])

  // The foot "Settings" opens the Settings HUB (projections/settings — sections Appearance / Engine /
  // Workspace / About), NOT the raw theming pane: the hub is the umbrella, and Appearance IS the
  // theming pane inside it. An ambient open-pane-intent realized by the focused container. Built inline
  // (like ProjectionHost) so the rail needs no @arsumbris/intent dependency for one payload.
  const openSettings = (): void => {
    host.intent?.fire({
      type: 'open-pane-intent',
      dispatch: 'ambient',
      pane: { type: 'settings-hub' },
    } as IntentPayload)
  }

  // Collapse / expand THIS sidebar — fire `collapse-region` (firer-relative), which reaches the sandwich
  // holding the rail; it maps the rail back to its region. The sandwich NARROWS the region and keeps the
  // rail mounted, and treats the intent as a TOGGLE, so this ONE control both collapses and (when
  // narrowed) expands. Built inline so the rail needs no @arsumbris/intent dependency for one payload.
  const toggleCollapse = (): void => {
    host.intent?.fire({ type: 'collapse-region', kind: 'routed', dispatch: 'firer-relative' } as IntentPayload)
  }

  // NOTE: NO right-rail toggle here — ONE control on the left is the rule, so the rail never fires
  // `toggle-right-sidebar`. The right rail is toggled from OUTSIDE this projection (⌥⌘B / the palette,
  // owned by the sandwich) and while hidden re-shows itself from its own hover strip on the right edge.

  // The pure re-point seam. The rail is ONE placement slot (no reorder — `reorder` is null, mirroring
  // `moveWithin: () => false`). ownedKeys are the rail's own fields; a root rail's composition-level
  // fields are carried through by the host.
  const poolEdit = makePoolEdit<RailModel>({
    host,
    live,
    ownedKeys: ['type', 'body'],
    toConfig,
    remove: (m, localId) => {
      if (m.body?.id !== localId) return null
      const child = m.body
      return { model: { ...m, body: undefined }, occupant: { instance: child.instance, id: child.id } }
    },
    place: (m, occ) => ({ ...m, body: { id: occ.id, instance: occ.instance as Projection } }),
    reorder: () => null,
    wrap: (m, slotId, groupId, groupInstance, removeLocalId) => {
      let mm = m
      if (removeLocalId != null && mm.body?.id === removeLocalId) mm = { ...mm, body: undefined }
      if (!bodyMatches(mm, slotId)) return null
      return { ...mm, body: { id: groupId, instance: groupInstance as Projection } }
    },
  })

  // ── ContainerPlacement — the shared router drives the rail through its single body slot.
  const placement: ContainerPlacement = {
    panes: () => {
      const b = live().body
      return b ? [b.id] : []
    },
    findPane: (id: PaneId): Pane | null => {
      const b = live().body
      return b?.id === id ? { id, type: b.instance.type ?? '' } : null
    },
    // The body is always visible; nothing to reveal.
    activate: () => {},
    getSlotContent: (slotId: string): Occupant | null => {
      const b = live().body
      return b && bodyMatches(live(), slotId) ? { instance: b.instance, id: b.id } : null
    },
    setSlotContent: (slotId: string, instance: PaneInstance, occupantId?: string) => {
      if (!bodyMatches(live(), slotId)) return
      // POOL a fresh occupant immediately (createRecord) so its id does not dangle through the
      // composition re-derive — an unpooled reference renders empty and re-fires the empty-slot driver's
      // materialize → an infinite loop. `setBodyOn`'s `mintBlockId` fallback is only for the pure reducer.
      const id = occupantId ?? live().body?.id ?? createChild(host, instance as Projection)
      commit(setBodyOn(live(), instance as Projection, id))
    },
    // One slot, no reorder — returns false (nothing moved); the router never actually calls it.
    moveWithin: () => false,
    extract: (localId: string): Occupant | null => {
      const m = live()
      if (m.body?.id !== localId) return null
      const child = m.body
      commit({ ...m, body: undefined })
      return { instance: child.instance, id: child.id }
    },
    inject: (instance: PaneInstance, id: PaneId, _target: DropTarget) => {
      commit(setBodyOn(live(), instance as Projection, id))
    },
    // The rail's body is a bare `mountable*` — no slot rules — so it governs nothing.
    slotFor: (): ContainerSlot | null => null,
    ...(poolEdit ? { poolEdit } : {}),
  }

  const setPlacementRoot = useContainerPlacement(placement)
  const setDialectRoot = useContainerDialect(railDropDialect)
  // measureRef rides the same node so the ResizeObserver watches the rail's actual width.
  const setContainerRoot = useMergedRef(setPlacementRoot, setDialectRoot, measureRef)

  const body = model.body
  const slotId = body ? body.id : BODY_SLOT

  return (
    <div
      ref={setContainerRoot}
      data-layout-container-slot={groupId}
      data-container-kind="rail"
      data-narrowed={narrowed ? '' : undefined}
      data-collapsing={collapsing ? '' : undefined}
      className="au-rail"
      onClick={(event) => {
        if (!narrowed) return
        const interactive = event.nativeEvent.composedPath().some(node => node instanceof Element &&
          node.matches('button,a,input,select,textarea,[role="button"],au-button,au-icon-button'))
        if (!interactive) toggleCollapse()
      }}
    >
      {/* TOP — the rail's top band holds the ONE collapse / expand toggle (right-aligned). This SAME element is the icon-rail's expand
          affordance when narrowed: it is never swapped for a different button, it simply TRAVELS along the
          shrinking right edge as the width animates (see the CSS), so the icon moves rather than jumping.
          panel-left toggles THIS (primary) sidebar and nothing else; the RIGHT is reached via ⌥⌘B / the
          palette and re-shows from its own edge strip. The chord stays DISCOVERABLE via `title`.

          `data-au-drag` opts this row into the kit's shared chrome seam (chrome.css) — it becomes the
          OS window-drag handle; the collapse control below re-opts-out with `data-au-no-drag` so its
          press activates the button instead of starting a window move. Both in place of an inline
          `-webkit-app-region` (see the CSS). */}
      <div className="au-rail-lights" data-au-drag>
        <AuIconButton
          className="au-rail-collapse"
          data-au-no-drag
          size="sm"
          aria-expanded={narrowed ? 'false' : 'true'}
          label={narrowed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={narrowed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleCollapse}
        >
          <AuIcon name="panel-left" />
        </AuIconButton>
      </div>

      {/* WIDE — the workspace switcher (mark + name + chevron + menu): the WORKSPACE WORDMARK's home.
          Folds away when narrowed.
          A quiet DIRTY marker trails it: a neutral ink dot, no coloured accent — the at-rest "unsaved
          work" signal. Rendered only when dirty; folds with this row when narrowed, where the foot
          spine carries a mirror instead. */}
      <div className="au-rail-identity au-rail-collapsible">
        <AuWorkspaceSwitcher
          name={wsName}
          items={workspaces}
          currentId={currentRoot || undefined}
          onAuSelect={(e) => onSwitchWorkspace((e.detail as { id: string }).id)}
          onAuOpenFolder={onOpenFolder}
          onAuNewWorkspace={onNewWorkspace}
        />
        {dirty && (
          <span className="au-rail-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes">
            <AuStatusDot size="sm" />
          </span>
        )}
      </div>

      {/* BODY — the one slot. Holds the column (a container), so it renders bare (no rail masthead).
          Stays MOUNTED when narrowed (folded by CSS) so the column keeps its state. */}
      <div
        className="au-rail-body au-rail-collapsible"
        data-droptarget-shape="slot-rect"
        data-container-kind="rail"
        data-droptarget-id={slotId}
      >
        {body ? (
          <PaneProjection
            key={`${body.instance.type}:${(body.instance as { file?: string }).file ?? ''}`}
            host={host}
            paneId={body.id}
            id={body.instance.type ?? ''}
            config={body.instance}
            onChildConfig={(next) => commit(setBodyOn(live(), next as Projection, body.id))}
          />
        ) : (
          // Empty body: the substrate resolves the placeholder and materializes it into the body slot
          // via the seam (setSlotContent → setBodyOn). The body slot always exists, so no create. `admits`
          // is honoured at the seam. Addressed by `slotId` (BODY_SLOT when empty).
          <EmptySlot host={host} slotId={slotId} />
        )}
      </div>

      {/* FOOT — Settings opens the Settings hub. When narrowed it collapses to a single gear IconButton.
          NO theme toggle: theme presets live in the hub's Appearance section. */}
      <div className="au-rail-foot">
        {/* NARROWED mirror of the dirty marker: the identity row (and its dot) folds away when narrowed,
            so the icon spine carries the "unsaved work" signal here instead. Same show-when-narrowed gate
            as the solo gear below — only one dirty dot is ever visible (identity when wide, this when
            narrowed). Rendered only when dirty. */}
        {dirty && (
          <span
            className="au-rail-dirty-solo"
            role="img"
            aria-label="Unsaved changes"
            title="Unsaved changes"
          >
            <AuStatusDot size="sm" />
          </span>
        )}
        <AuNavItem
          className="au-rail-foot__settings au-rail-collapsible"
          onClick={openSettings}
        >
          <AuIcon slot="icon" name="gear" size="sm" />
          Settings
        </AuNavItem>
        <AuIconButton
          className="au-rail-foot-solo"
          size="sm"
          label="Settings"
          title="Settings"
          onClick={openSettings}
        >
          <AuIcon name="gear" />
        </AuIconButton>
      </div>
    </div>
  )
}

function mount(container: HTMLElement, host: MountHost): () => void {
  // The <au-*> components self-style from the host's live --au-* tokens inside their own shadow roots,
  // so the rail injects NO component CSS — its own layout is the STYLE sheet, injected through the host
  // so it is `@scope`-confined to this projection's subtree and CSP-exempt.
  const disposeStyles = host.styles?.inject(STYLE, container)
  const mountPoint = document.createElement('div')
  mountPoint.style.height = '100%'
  container.appendChild(mountPoint)
  const root = createRoot(mountPoint)
  root.render(<RailApp host={host} />)
  return () => {
    root.unmount()
    disposeStyles?.()
    mountPoint.remove()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
