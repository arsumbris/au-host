import { reloadPaneRows } from '@arsumbris/container-kit'
import {readWorkspaceStartup, selectStartupPath} from './workspace-startup'
import { makeOverlayMovable } from '@arsumbris/au-component-catalog/chooser-presentation'
import { KeySequenceHints } from './KeySequenceHints'
import type { PendingKeySequence } from '@arsumbris/au-host-sdk'
import { SearchPalette, type PaletteOption } from './SearchPalette'
import { pickerOptions, type PickerMode } from './command-pickers'
import { keyboardContext, directionalPane, focusPane, choosePane } from './pane-navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { ContextMenuItem, IntentPayload, MountHost, PopoverHandle, ProjectionSource, ProjectionDescriptor, DragSource, PaneInstance } from '@arsumbris/au-host-sdk'
import { isWritableMember, reportHostDiagnostic, deriveContainerSchemas, descriptorTitle, bareTypeName } from '@arsumbris/au-host-sdk'
import type { ContainerSchemas } from '@arsumbris/au-host-sdk'
import { readDiagnostics, readFiles, readInstancesOf, readResolveTarget, readSubtypes, subscribeTypes, subscribeChanges, type WireDiagnostic, type WireReader, type TypedSubscriber } from '@arsumbris/au-host-sdk/engine-reads'
import { resolveTargetsAll, resolveViewer, viewerPickOptions, setGroupingChooser, setContentResolver, placeContentDrop, isContentDropHit } from '@arsumbris/container-core'
import { getChooserSurface } from './chooser-surface'
import { installSelectionDrop, PanePortalLayer, usePaneAnchor, wrapPaneInteractive } from '@arsumbris/container-kit'
// JSX types for the raw <au-*> root chrome (side-effect), plus the React WRAPPERS the composition
// popover uses (props → element properties, typed `onAuXxx` events; the set-independent React seam).
import { AuIconButton, AuIcon, AuPopover, AuScrollArea, AuListRow, AuButton, AuInput, AuSelect, AuTypedValueEditor } from '@arsumbris/au-component-catalog/react'
import { resolve as resolveValue, makeReaderPort, normalize, validate, type ResolvedShape, type ResolveOptions, type EditorOption, type ValueDiagnostic } from '@arsumbris/typed-value'
import { setPanePortalParkingHost, installPaneAnchorObserver, createPortalRegistry, registerContainer, deregisterContainer } from '@arsumbris/container-core'
import { isFileSelection, isLinkSelection, type Selection } from '@arsumbris/selection'
import { matchesTypeIdentity, refName } from '@arsumbris/type-query'

import { CompositionRuntime, stableStringify } from './composition'
import { installCompositionReadBridge } from './event-read-bridge'
import { installKeybindGate } from './keybind-gate'
import { overlaySiteHasBlockingLayer } from './overlay-site'
import {
  deleteComposition,
  discoverCompositions,
  loadCrossFileClosure,
  qualifyComposition,
  readTypeOwners,
  writeComposition,
} from './composition-config'
import type { DiscoveredComposition, RootComposition } from './composition-config'
import { discoverProjections } from './discovery'
import { discoverCommands, type CommandDescriptor, type CommandSets } from './command-registry'
import { readKeymaps, commandRoutingFor } from './keymap-registry'
import type { RawKeymap } from '@arsumbris/au-host-sdk'
import { WindowRootShell } from './window-root-shell'
import { isMacRenderer } from './platform'
import { discoverComponentSets, discoverComponents } from './component-discovery'
import { registerComponentSets } from './component-registry'
import { getActiveLook, setDiscoveredSets } from './active-set-store'
import { discoverNotificationRenderers } from './notification-renderers'
import { discoverGroupingContainers, discoverSpatialContainers, groupingChoiceOf, groupNewPanesOf, installGroupingProvider, installWrapTargets } from './grouping-discovery'
import { installConfigOwnership } from './config-ownership'
import { discoverAgentIntents, installAgentIntents } from './agent-intent-gate'
import { installSlotTypeProvider } from './slot-types'
import { readNodeClosures } from './container-nodes'
import type { GroupingCapability } from '@arsumbris/container-core'
import { getNotificationSurface, setNotificationRenderers } from './notification-surface'
import { loadTokenSheets } from './token-sheets'
import type { DiscoveredProjection, RejectedProjection } from './discovery'
import { discoverMembers } from './members'
import type { WorkspaceMember } from './host-config'
import { createEngineReadiness } from './engine-readiness'
import type { ChromeContribution, CompositionCommit, LaunchEnv, OpaqueConfig } from './host-config'
import { sourceKey, sourceLocation } from './loader'
import { collectNodeIds, dropComposition, pruneToNodes } from './view-store'
import { applyStoredTheme } from './theme-store'
import type { ProjectionRegistration } from './loader'
import { createDaemonControl, createMcpControl, createFilesControl } from './mount-host'
import type { DaemonConfig } from '../../../shared/daemon-api'


/** Resolve a projection TYPE NAME to a loadable registration from a discovery snapshot. */
function registrationFor(
  discovered: DiscoveredProjection[],
  typeName: string,
): ProjectionRegistration | undefined {
  // schema-6 serves a cross-repo `type:` claim in `name::repo` form, while discovery keys each
  // projection by its bare name + owner `repo`. Match by cross-repo IDENTITY: a qualified claim pins
  // the owner, a bare claim matches by name (unambiguous while names are workspace-unique).
  const match = discovered.find((d) => matchesTypeIdentity({ name: d.typeName, repo: d.repo }, typeName))
  if (!match) return undefined
  const source: ProjectionSource = { mode: 'esm', path: match.packageRoot }
  return { key: sourceKey(sourceLocation(source)), source, entry: match.entry, export: match.export }
}


// --- agent-session pane -----------------------------------

/** The terminal-pane instance an agent session mounts. */
export interface AgentPane {
  ok: boolean
  error?: string
  /** The `terminal` projection instance (cwd + the agent launch command), when ok. */
  pane?: unknown
}

interface ProjectionHostProps {
  config: DaemonConfig
  onConfigChange: (patch: Partial<DaemonConfig>) => void
  /** Fires ONCE when the boot curtain would lift — the composition is genuinely painted (or the
   *  workspace is confirmed empty). The launcher waits on this to time its dissolve, so it holds its
   *  own loader (over the mist) until the workspace is ready, then reveals the finished composition. */
  onReady?: () => void
}

/**
 * Surface a host operational WARNING (e.g. a composition save the engine rejected) as a transient
 * toast in the host-owned notification frame, since a transient failure is easy to miss. Uses the
 * notification surface DIRECTLY rather than a broadcast `ui-notification`: this is the host telling
 * the human its own write failed, not an event projections should react to. Swap it for a broadcast
 * fire if save failures should also land in the notification-bell history.
 */
function warnToast(message: string): void {
  getNotificationSurface().show(
    { type: 'ui-notification', kind: 'broadcast', severity: 'warn', message } as unknown as IntentPayload,
    () => {},
  )
}

/** Track the renderer's web zoom factor (1 = 100%), updating when it changes. Web zoom scales CSS px but
 *  NOT the OS traffic lights (painted in fixed window points), so the app bar counter-scales by `1/zoom`
 *  to stay a fixed size that matches them. A resolution media query fires on every zoom change
 *  (devicePixelRatio moves); re-arm it each time and read the authoritative factor from the frame. */
function useZoomFactor(): number {
  const [zoom, setZoom] = useState(() => window.main.getZoomFactor?.() ?? 1)
  useEffect(() => {
    let disposed = false
    let dispose = (): void => {}
    const arm = (): void => {
      if (disposed) return
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      const onChange = (): void => {
        setZoom(window.main.getZoomFactor?.() ?? 1)
        arm()
      }
      mq.addEventListener('change', onChange, { once: true })
      dispose = (): void => mq.removeEventListener('change', onChange)
    }
    setZoom(window.main.getZoomFactor?.() ?? 1)
    arm()
    return () => {
      disposed = true
      dispose()
    }
  }, [])
  return zoom
}

export function ProjectionHost({ config, onConfigChange, onReady }: ProjectionHostProps): React.JSX.Element {
  const entryPath = config.entryPath
  // macOS app-bar light gap: sized against the live zoom so the OS traffic lights (which do not scale
  // with web zoom) always clear the bar's content.
  const isMac = isMacRenderer()
  const zoom = useZoomFactor()
  const [discovered, setDiscovered] = useState<DiscoveredProjection[]>([])
  // The command sets for the palette: curated commands (intents carrying a `command-meta`) + the
  // unregistered rest, folded from the type graph on the same discovery pass. Live — refreshed by
  // `rediscover` (which `subscribeTypes` re-runs).
  const [commands, setCommands] = useState<CommandSets>({ commands: [], unregistered: [] })
  // Subtypes that declare loadable code and failed the contract handshake. See `RejectedProjection`.
  const [rejectedProjections, setRejectedProjections] = useState<RejectedProjection[]>([])

  // Discover authored compositions across workspace members. `workingRef` holds the live composition
  // and its edits; `mounted` identifies the loaded composition so write-back does not remount the root.
  // `selectedPath` identifies the loaded file. Until one loads, the composition state is null and
  // an empty workspace mounts no synthesized default arrangement.
  const workingRef = useRef<RootComposition | null>(null)
  const [mounted, setMounted] = useState<RootComposition | null>(null)
  // Refs the (single-construction) runtime reads live for keybind dispatch: the mounted composition (its
  // `keymaps` list), the discovered command registry (intent routing), and the parsed keymap files.
  const mountedRef = useRef<RootComposition | null>(mounted)
  mountedRef.current = mounted
  const commandsRef = useRef<CommandSets>(commands)
  commandsRef.current = commands
  const keymapsRef = useRef<Map<string, RawKeymap>>(new Map())
  // False until the first composition-discovery pass completes. Distinguishes "still loading" from
  // "genuinely no composition", so cold start shows a loader rather than flashing the empty state.
  const [compositionsLoaded, setCompositionsLoaded] = useState(false)
  const [startupStopped, setStartupStopped] = useState(false)
  // The renderer's own engine readiness, mirrored as render state. A composition discovery that runs
  // BEFORE this is true can read zero (the connection is not serving complete reads yet), so the
  // empty state must not be trusted until the engine is ready. See engine-readiness.ts.
  const [engineReadyState, setEngineReadyState] = useState(false)
  // Set true once the portal's async mount (`primeForeign` + `mountRootPortal`) has gone live, so the
  // composition area is only revealed when it actually has content — never the bare pre-mount frame.
  const [portalLive, setPortalLive] = useState(false)
  // Latched true once `registerComponentSets` has defined the `<au-*>` chrome tags in the global
  // custom-element registry. The composition mounts those tags (bento/tabs frames); until they are
  // defined they render as `display:inline` light-DOM with no chrome, a collapsed unstyled frame. So
  // the boot curtain holds until this is true, never lifting on a portal that is live but undefined.
  const [componentsRegistered, setComponentsRegistered] = useState(false)
  const [compositions, setCompositions] = useState<DiscoveredComposition[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [saveAsName, setSaveAsName] = useState('')
  // The workspace members, as render state (a dropdown target for `save as`). Mirrors
  // `membersRef` (which feeds minted hosts); this copy re-renders the chrome. `saveAsMember`
  // is the user's explicit member pick for the next save-as ('' = auto-derive the default).
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [saveAsMember, setSaveAsMember] = useState('')
  const [compositionError, setCompositionError] = useState('')
  // Saving is explicit. `dirty` tracks structural divergence from the saved state, and `savedHashRef`
  // holds the loaded file's content hash for guarded writes. `baselineKeyRef` stores the stable-stringified
  // settled composition. Repeated identical load echoes do not mark it dirty. A null baseline captures
  // the next settled echo, including load normalization, before comparing later changes.
  const [dirty, setDirty] = useState(false)
  const savedHashRef = useRef<string | undefined>(undefined)
  const baselineKeyRef = useRef<string | null>(null)
  // The grouping capabilities discovered from the type graph. Held because installing the
  // substrate's lookup depends on TWO inputs that change independently: this, and the mounted
  // composition's `group-into` choice.
  const groupingCapsRef = useRef<GroupingCapability[]>([])
  // The SPATIAL containers (bento, canvas), discovered in the same pass. They join the grouping caps in
  // the WRAP-TARGET registry (a UNION), but NEVER the grouping provider — so the drop path is untouched.
  const spatialCapsRef = useRef<GroupingCapability[]>([])
  // The derived container-slot graph identifies child fields for pool normalization and resolution.
  // `rediscover` populates it from container-projection and container-node subtype reads. A ref lets
  // the runtime use updates without remounting. The inline path handles an unavailable graph.
  const schemasRef = useRef<ContainerSchemas>({ containers: new Map(), nodes: new Map() })
  // The PORTAL needs the slot graph to normalize a composition into the pool; without it
  // `mountRootPortal` returns null and renders nothing. `schemasRef` is a ref (no re-render), so this
  // STATE mirrors "the graph is ready" to gate the portal render — on a fresh start the graph fills
  // AFTER the first composition is mounted, and the render must re-attempt once it does.
  const [schemasReady, setSchemasReady] = useState(false)

  // Re-install the substrate's grouping lookup when the MOUNTED COMPOSITION changes. The other
  // input (the discovered capabilities) is refreshed by the discovery pass, which installs there.
  // Both are needed because a composition switch changes `group-into` without touching the type
  // graph, and a type-graph change can add a declarer without touching the composition.
  useEffect(() => {
    const groupInto = mounted ? groupingChoiceOf(mounted) : undefined
    installGroupingProvider(groupingCapsRef.current, groupInto, mounted ? groupNewPanesOf(mounted) : undefined)
    installWrapTargets(groupingCapsRef.current, spatialCapsRef.current, groupInto)
  }, [mounted])

  // Read compositions + discover projection types THROUGH the engine; write/delete
  // through the host.files STAND-IN (the engine SDK is read-only). Bound to the root.
  const reader = useMemo<WireReader>(
    () => ({ read: (request) => window.main.engine.read(entryPath, request) }),
    [entryPath],
  )
  const files = useMemo(() => createFilesControl(entryPath), [entryPath])

  // The root's config write-back: capture edits in the EPHEMERAL working buffer
  // only — no entry write (that would churn the engine's re-derivation on every
  // pane-drag). `save as` snapshots the working buffer to a file deliberately.
  // The root view's `saveConfig` hands back the whole root projection instance,
  // which IS the composition.
  // The runtime's live-mounted-pane node ids, read at reconcile time. A ref because `saveRootConfig`
  // is defined before the runtime and must stay `[]`-stable; bound just after the runtime memo below.
  const liveNodeIdsRef = useRef<() => string[]>(() => [])
  const saveRootConfig = useCallback((next: OpaqueConfig): void => {
    workingRef.current = next as RootComposition
    // Reconcile terminal sessions to the LIVE layout: a pane removed from the working
    // tree (closed) gets its pty killed. Reshuffle-safe — a moved node stays in the
    // tree (atomic), so it is not killed. Runs on every update, incl. the load echo
    // (harmless: a freshly-loaded composition has no sessions yet).
    if (selectedPathRef.current) {
      // Reap a terminal session only after its pane leaves both the serialized config and the live mount set.
      // Containers can allocate child IDs at load and echo them into config only on a later action, so
      // serialized config alone cannot establish that a mounted terminal has closed.
      const ids = [...new Set([...collectNodeIds(next), ...liveNodeIdsRef.current()])]
      window.main.terminal.reconcile(selectedPathRef.current, ids)
    }
    // Dirtiness is STRUCTURAL, not a call-count. Compare this echo to the settled baseline: the first
    // echo after a (re)mount CAPTURES the baseline (it is the load echo, normalized, not a user edit);
    // every later echo marks dirty ONLY if the structure actually diverged. So N identical load echoes
    // (the flat portal settles each pane independently) never mark dirty, and an edit that returns to
    // the baseline clears it.
    const key = stableStringify(next)
    if (baselineKeyRef.current === null) {
      baselineKeyRef.current = key
      return
    }
    setDirty(key !== baselineKeyRef.current)
  }, [])

  // Validate a loaded composition through the engine: a composition is a `composition` instance, so the
  // engine emits diagnostics on it (a bad `root` ref, a pool record with an unknown type, a bad `role`
  // def-ref, …). It still MOUNTS (the root types), but a broken field degrades silently — e.g. `role: status` (not a wikilink) makes
  // the status bar aggregate nothing. Surface the first error so "broken" is VISIBLE at load, not a
  // mystery empty pane. Best-effort, async, non-blocking (the mount already happened).
  const validateLoaded = useCallback(async (path: string): Promise<void> => {
    const d = await readDiagnostics(reader, { path })
    if (!('ready' in d) || !d.ready) return
    const errs = (d.result as WireDiagnostic[]).filter((x) => x.severity === 'error')
    if (errs.length) {
      setCompositionError(`⚠ this composition has ${errs.length} validation error${errs.length > 1 ? 's' : ''} — it may not display correctly: ${errs[0].message}`)
    }
  }, [reader])

  // Discover saved compositions across the workspace (each is a projection instance, anywhere),
  // ORDERED by the local recents overlay: most-recently-opened first, then discovery order. So the
  // composition <select> (the always-visible "list of recent ones") floats recents to the top, and
  // cold-start mounts the most-recent instead of an arbitrary first-found.
  const refreshCompositions = useCallback(async (): Promise<DiscoveredComposition[]> => {
    const [found, recent] = await Promise.all([discoverCompositions(reader), window.main.recents.listCompositions(entryPath)])
    const rank = new Map(recent.map((c, i) => [c.path, i])) // 0 = most recent
    const ordered = [...found].sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity))
    setCompositions(ordered)
    return ordered
  }, [reader, entryPath])

  // Discover compositions; if none is loaded yet, mount the MOST-RECENT (recents overlay; else the
  // first discovered). Idempotent: re-running once a composition is selected is a no-op, so it's
  // safe to fire on both entry and the engine-ready edge.
  const discoverAndMaybeMount = useCallback(async (): Promise<void> => {
    const found = await refreshCompositions()
    const [startup, recent] = await Promise.all([
      readWorkspaceStartup(reader, entryPath).catch(error => ({kind: 'error' as const, message: String(error)})), window.main.recents.listCompositions(entryPath),
    ])
    const choice = selectStartupPath(found.map(item => item.path), recent.map(item => item.path), startup)
    if (choice.kind === 'pending') return
    setCompositionsLoaded(true)
    setStartupStopped(choice.kind === 'empty' || choice.kind === 'error')
    if (choice.kind === 'error') { setCompositionError(choice.message); return }
    setSelectedPath((current) => {
      if (current) return current
      const first = choice.kind === 'composition' ? found.find(item => item.path === choice.path) : undefined
      if (!first) return ''
      workingRef.current = first.composition
      baselineKeyRef.current = null // recapture the baseline from the first settled load echo
      setMounted(first.composition)
      void window.main.recents.touchComposition(entryPath, first.path) // record the open
      void validateLoaded(first.path) // surface any engine diagnostics on the auto-mounted file
      return first.path
    })
  }, [refreshCompositions, entryPath, reader, validateLoaded])

  // On entry (and engine-root change): discover + maybe mount.
  useEffect(() => {
    void discoverAndMaybeMount()
  }, [discoverAndMaybeMount])

  // Load a discovered composition INTO the working buffer and remount. Edits
  // afterward diverge from the file (it stays frozen until re-saved).
  const loadComposition = (comp: DiscoveredComposition): void => {
    if (dirty && !window.confirm('Discard unsaved layout changes?')) return
    setCompositionError('')
    setStartupStopped(false)
    workingRef.current = comp.composition
    setMounted(comp.composition)
    setSelectedPath(comp.path)
    baselineKeyRef.current = null // recapture the baseline from the first settled load echo
    setDirty(false)
    void window.main.recents.touchComposition(entryPath, comp.path) // record the open (bumps recency)
    void validateLoaded(comp.path) // surface any engine diagnostics on the loaded file
  }

  // Only members writable IN PLACE are valid save targets — never write a composition into a
  // dependency, nor into an `edit` member that resolved read-only from the package cache.
  // `isWritableMember` is `editable && local`; the `local` half is what rules the cache case out.
  const savableMembers = members.filter(isWritableMember)
  // Is the LOADED composition consumed (in a non-writable member)? Then a save copies it into the
  // user's vault rather than overwriting the template — surfaced on the save button so it is not a
  // surprise. Most-specific owner wins (member roots can nest). See `saveConsumedAsCopy`.
  const loadedOwner = selectedPath
    ? members.filter((m) => selectedPath.startsWith(m.root)).sort((a, b) => b.root.length - a.root.length)[0]
    : undefined
  const loadedConsumed = !!loadedOwner && !isWritableMember(loadedOwner)

  // Save the working arrangement to a NEW file, next to the currently-loaded
  // composition (where the user keeps them). The engine re-derives the new file.
  // The member a save-as targets: the explicit dropdown pick, else the member owning the
  // currently-loaded composition (so "save as" stays next to it), else the first savable member.
  // Undefined only when no savable members are discovered yet (engine down / not ready).
  const memberForSave = (): WorkspaceMember | undefined => {
    if (saveAsMember) return savableMembers.find((m) => m.name === saveAsMember)
    if (selectedPath) {
      const owner = savableMembers.find((m) => selectedPath.startsWith(m.root))
      if (owner) return owner
    }
    return savableMembers[0]
  }

  // `nameArg` lets the command palette pass the name from the `save-composition-as-intent` payload; the
  // popover calls with no arg and uses the bound `saveAsName` state.
  const saveCompositionAs = async (nameArg?: string): Promise<void> => {
    const name = (nameArg ?? saveAsName).trim()
    if (!name) return
    setCompositionError('')
    // Save into the selected workspace member's root so the engine derives the file as a composition.
    // Fallbacks are the loaded composition's owning member, the first member, then the native directory
    // picker when no member is discovered. Cancel leaves the workspace unchanged.
    let dir = memberForSave()?.root ?? ''
    if (!dir) {
      const picked = await window.main.dialog.pickPath('directory')
      if (!picked) return
      dir = picked
    }
    const path = `${dir}/${name}.yaml`
    // Qualify bare `type:` claims to `name::repo` so the engine types the file as a composition
    // wherever it lands (a bare projection name won't resolve from the entry). Else it saves but
    // never re-surfaces in discovery.
    // Nothing mounted means nothing to write. Guarded rather than defaulted: there is no in-code
    // composition to fall back to, and inventing one here would be the same violation.
    const working = workingRef.current
    if (!working) {
      setCompositionError('there is no composition to save yet')
      return
    }
    const owners = await readTypeOwners(reader)
    const { composition: qualified, unresolved } = qualifyComposition(working, owners)
    const result = await writeComposition(files, path, qualified)
    if (!result.ok) {
      setCompositionError(result.error ?? `could not save “${name}”`)
      warnToast(`Couldn’t save “${name}”: ${result.error ?? 'write failed'}`)
      return
    }
    setSaveAsName('')
    setSelectedPath(path)
    // The save succeeded, but any bare type with no known owner won't type the file → the composition
    // won't re-surface in discovery. Warn instead of degrading silently.
    if (unresolved.length) {
      const msg = `saved, but no workspace member owns: ${unresolved.join(', ')} — the composition may not re-appear until they resolve`
      setCompositionError(msg)
      warnToast(msg)
    }
    void refreshCompositions()
  }

  const deleteSelected = async (): Promise<void> => {
    if (!selectedPath) return // nothing loaded
    setCompositionError('')
    const result = await deleteComposition(files, selectedPath)
    if (!result.ok) {
      setCompositionError(result.error ?? 'could not delete composition')
      warnToast(`Couldn’t delete “${selectedPath.split('/').pop() ?? 'composition'}”: ${result.error ?? 'delete failed'}`)
      return
    }
    dropComposition(selectedPath) // drop its view-state auto-store entries
    const remaining = compositions.filter((c) => c.path !== selectedPath)
    setCompositions(remaining)
    if (remaining[0]) loadComposition(remaining[0])
    else {
      // The last saved composition is deleted: mount nothing, matching a workspace with no saved layout.
      // The composition owns its arrangement; the host does not synthesize a default layout.
      workingRef.current = null
      setMounted(null)
      setSelectedPath('')
      savedHashRef.current = undefined
      baselineKeyRef.current = null // nothing mounted; the next composition's load echo sets the baseline
      setDirty(false)
    }
    void refreshCompositions()
  }

  // Save the working layout back to the loaded composition file (overwrite, guarded
  // by the loaded hash so a concurrent edit conflicts rather than clobbers). A
  // composition not yet on disk (the in-code default) has no path; use "save as".
  // Persist a composition to its loaded file (guarded overwrite). The single write
  // path for both the explicit save button and a structural gesture's immediate
  // commit (promote/detach via `commitComposition`). Updates the hash baseline and
  // clears dirty on success; surfaces a conflict instead of clobbering.
  // Saving a consumed composition creates a copy in a writable member and switches editing to it.
  const saveConsumedAsCopy = useCallback(
    async (next: RootComposition, sourcePath: string): Promise<CompositionCommit> => {
      // The user's vault: the entry folder-repo (always writable), else any writable member.
      const target =
        members.find((m) => m.role === 'entry' && isWritableMember(m)) ?? members.find(isWritableMember)
      if (!target) {
        warnToast('Couldn’t save a copy — no writable workspace member. Use “save as”.')
        return { ok: false, error: 'no writable workspace member to save a copy into — use “save as”' }
      }
      // Keep the template's basename, deduped within the target so a second edit-session of the same
      // template doesn't clobber the first copy.
      const stem = (sourcePath.slice(sourcePath.lastIndexOf('/') + 1) || 'composition').replace(/\.yaml$/, '')
      let name = stem
      for (let n = 2; await files.exists(`${target.root}/${name}.yaml`); n++) name = `${stem}-${n}`
      const path = `${target.root}/${name}.yaml`
      // A consumed composition's `[[ref]]` sub-layouts (if any) stay pointing at the template's own
      // files — the copy references the shared sub-layouts rather than duplicating them. full-shell has
      // none; a ref'd consumed template is an untested edge, flagged not handled.
      const owners = await readTypeOwners(reader)
      const { composition: qualified } = qualifyComposition(next, owners)
      const result = await writeComposition(files, path, qualified) // a NEW file, unguarded
      if (!result.ok) {
        warnToast(`Couldn’t save a copy of “${stem}”: ${result.error ?? 'write failed'}`)
        return { ok: false, error: result.error ?? 'could not save a copy of the template' }
      }
      workingRef.current = next
      savedHashRef.current = result.hash
      baselineKeyRef.current = stableStringify(next) // the saved form is the new baseline; a later edit diverges from it
      setSelectedPath(path) // further edits save the copy, in place
      setDirty(false)
      void window.main.recents.touchComposition(entryPath, path)
      void refreshCompositions()
      // Display this informational result through the strip's `compositionError` message surface.
      setCompositionError(`“${stem}” is a shipped template — saved a copy to ${target.name}/${name}.yaml; further edits save there`)
      return { ok: true }
    },
    [members, files, reader, entryPath, refreshCompositions],
  )

  const persistComposition = useCallback(
    async (next: RootComposition): Promise<CompositionCommit> => {
      if (!selectedPath) return { ok: false, error: 'composition is not on disk yet — use “save as” first' }
      // Never overwrite a consumed (non-writable) composition in place — redirect to a copy in the
      // user's vault. The MOST-SPECIFIC owning member wins (a member root can nest under another).
      const owner = members
        .filter((m) => selectedPath.startsWith(m.root))
        .sort((a, b) => b.root.length - a.root.length)[0]
      if (owner && !isWritableMember(owner)) return saveConsumedAsCopy(next, selectedPath)

      // The qualify chokepoint for THIS save: the parent qualifies its bare `type:` claims (incl. leaf
      // `content`) against the owner map, so its files resolve from the entry.
      const owners = await readTypeOwners(reader)
      const unresolved = new Set<string>() // bare types no member owns

      workingRef.current = next
      const { composition: qNext, unresolved: uNext } = qualifyComposition(next, owners)
      uNext.forEach((x) => unresolved.add(x))
      const result = await writeComposition(files, selectedPath, qNext, savedHashRef.current)
      if (!result.ok) {
        // Every disk-write save trigger (Mod-S, promote, detach, a wire-save commit) funnels through
        // here, so this one site toasts a warning for ALL of them — the caller still sets the standing
        // strip message. Name the file: the raw engine message ("path has uncommitted changes…") does
        // not, and a transient toast the human might only half-catch should say WHAT failed.
        const name = selectedPath.split('/').pop() ?? 'composition'
        if (result.conflict) {
          savedHashRef.current = result.conflict.currentHash
          warnToast(`“${name}” changed on disk — reload, or save again to overwrite.`)
          return { ok: false, conflict: true, error: 'this composition changed on disk — reload, or save again to overwrite' }
        }
        warnToast(`Couldn’t save “${name}”: ${result.error ?? 'could not save composition'}`)
        return { ok: false, error: result.error ?? 'could not save composition' }
      }
      savedHashRef.current = result.hash
      // Prune the view-state auto-store to the panes that survived this save: a closed
      // pane (and any transient preview, never in the saved layout) has dead view-state.
      if (selectedPath) pruneToNodes(selectedPath, collectNodeIds(next))
      baselineKeyRef.current = stableStringify(next) // the saved form is the new baseline; a later edit diverges from it
      setDirty(false)
      // Saved OK, but any bare type with no known owner won't type its file → surface a warning
      // rather than let the composition quietly become undiscoverable.
      if (unresolved.size) {
        const msg = `saved, but no workspace member owns: ${[...unresolved].join(', ')} — the composition may not re-appear until they resolve`
        setCompositionError(msg)
        warnToast(msg)
      }
      return { ok: true }
    },
    [selectedPath, files, reader, members, saveConsumedAsCopy],
  )

  const saveComposition = async (): Promise<void> => {
    setCompositionError('')
    const working = workingRef.current
    if (!working) {
      setCompositionError('there is no composition to save yet')
      return
    }
    const r = await persistComposition(working)
    if (!r.ok && r.error) setCompositionError(r.error)
  }

  // A stable handle on the latest persist, handed to the runtime so the ROOT view
  // (bento) can commit the composition immediately on a structural gesture. Stable
  // identity (a ref) keeps it out of the runtime memo's deps — no remount churn.
  const persistRef = useRef(persistComposition)
  persistRef.current = persistComposition
  const commitComposition = useCallback(
    (next: OpaqueConfig) => persistRef.current(next as RootComposition),
    [],
  )

  // Capture the loaded composition file's content hash as the guarded-save baseline,
  // whenever the loaded path changes (initial load, switch, save-as).
  useEffect(() => {
    if (!selectedPath) {
      savedHashRef.current = undefined
      return
    }
    let cancelled = false
    void files.read(selectedPath).then((r) => {
      if (!cancelled && r.ok) savedHashRef.current = r.hash
    })
    return () => {
      cancelled = true
    }
  }, [selectedPath, files])

  // The active keymap supplies ⌘S → save-intent; bindings remain visible, rebindable, and removable.
  // A window close does not currently prompt for unsaved composition changes. A renderer `beforeunload`
  // handler that cancels closure also prevents Electron from quitting; a native close confirmation belongs
  // in the main process. Composition switching uses the confirm in `loadComposition`.
  //
  // Resolve projection registrations through the latest discovery snapshot. A ref keeps the runtime
  // and routing trees stable across re-renders while the root-registration memo remains reactive.
  const discoveredRef = useRef(discovered)
  discoveredRef.current = discovered
  const resolve = useCallback(
    (typeName: string): ProjectionRegistration | undefined => registrationFor(discoveredRef.current, typeName),
    [],
  )
  // The discovered projection type names (LIVE off the ref), for a container's mount picker.
  const listProjectionNames = useCallback((): string[] => discoveredRef.current.map((d) => d.typeName), [])
  // The same discovered set, DESCRIBED — the kind closure, owning repo and declared meta blocks the
  // discovery pass already computed and had nowhere to publish. LIVE off the ref, like the names above.
  // `meta` carries the raw declared blocks (a header reads `projection-presentation-meta`); `doc` and
  // `opens` still wait for the thing that produces them. See `ProjectionDescriptor`.
  const describeProjectionSet = useCallback(
    (): ProjectionDescriptor[] =>
      discoveredRef.current.map((d) => ({ type: d.typeName, repo: d.repo, kinds: d.kinds, meta: d.meta })),
    [],
  )

  // The current composition's viewer-defaults (per file kind → viewer), bare-normalized, for the viewer
  // ladder on the drop path. Read off the working composition, the same field the CompositionRuntime
  // hands mounted containers via `host.viewerDefaults`.
  const readViewerDefaults = useCallback((): { opens: string; viewer: string }[] => {
    const vd = (workingRef.current as Record<string, unknown> | null)?.['viewer-defaults'] as
      | Record<string, unknown>
      | undefined
    const raw = vd?.['defaults']
    if (!Array.isArray(raw)) return []
    const out: { opens: string; viewer: string }[] = []
    for (const d of raw) {
      if (!d || typeof d !== 'object') continue
      const rec = d as Record<string, unknown>
      const opens = typeof rec['opens'] === 'string' ? rec['opens'] : undefined
      const viewerVal = typeof rec['viewer'] === 'string' ? rec['viewer'] : undefined
      const viewer = viewerVal?.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0]?.split('::')[0]?.trim()
      if (opens && viewer) out.push({ opens, viewer })
    }
    return out
  }, [])

  // Resolve dropped content to a viewer instance in the host. Resolve wikilink selections through
  // `readResolveTarget`, then choose a viewer from opens-meta eligibility and composition defaults.
  // Resolution is async because it can read the engine or ask the viewer chooser.
  // The container-core pointer resolver and the native selection-drop bridge both use this resolution
  // and `placeContentDrop`, sharing pooled minting, placement, and the grouping chooser.
  useEffect(() => {
    const resolveContent = async (raw: unknown): Promise<PaneInstance | null> => {
      const sel = raw as Selection
      if (!sel || typeof sel !== 'object' || typeof (sel as { type?: unknown }).type !== 'string') return null

      let path: string | null = null
      if (isFileSelection(sel)) {
        path = sel.path
      } else if (isLinkSelection(sel)) {
        // The ref may carry a `#anchor` / `^block-id`; v1 opens the FILE, so resolve its base target.
        const base = sel.target.split(/[#^]/)[0]?.trim()
        if (base) {
          const out = await readResolveTarget(reader, base)
          if ('ready' in out && out.ready && out.result) {
            const r = out.result as { path?: string; file_path?: string; source?: { file: string } | null }
            path = r.source ? r.source.file : (r.file_path ?? r.path ?? null)
          }
        }
      }
      if (!path) {
        reportHostDiagnostic({
          code: 'selection-drop-unresolved',
          severity: 'warning',
          subject: 'selection-drop',
          message: 'a dropped selection did not resolve to a file',
          detail: { selection: sel },
        })
        return null
      }

      const resolved = resolveViewer(path, describeProjectionSet(), { viewerDefaults: readViewerDefaults() })
      let viewer: string
      if ('mustPick' in resolved) {
        // Empty = NOTHING eligible → DECLINE. >=2 = a GENUINE choice: the host CHOOSER asks (no silent
        // default); a cancel abandons the drop.
        if (resolved.mustPick.length === 0) {
          reportHostDiagnostic({
            code: 'selection-drop-no-viewer',
            severity: 'warning',
            subject: 'selection-drop',
            message: `no projection declares it opens "${path}"`,
            detail: { path },
          })
          return null
        }
        const picked = await getChooserSurface().choose({
          title: `Open ${path.split('/').pop() ?? path} with`,
          options: viewerPickOptions(resolved.mustPick, describeProjectionSet()),
        })
        if (!picked) return null // cancelled → the drop is abandoned
        viewer = picked
      } else {
        viewer = resolved.viewer
      }
      return { type: viewer, file: path } as PaneInstance
    }

    // The POINTER path awaits this (the file-tree drag, `ctx.content`).
    setContentResolver(resolveContent)

    // The NATIVE bridge: resolve, then place through the UNIFIED path. A synthetic content source carries
    // the viewer `type` so a slot's `admits` can still veto; `__external__` never matches a real container.
    // Deepest target under the point wins, like the router; `placeContentDrop` resolves the container +
    // pools the viewer + asks the grouping chooser (mint-and-place, not an ad-hoc inject).
    const detach = installSelectionDrop(document.body, (sel, point) => {
      void (async () => {
        const instance = await resolveContent(sel)
        if (!instance) return
        const source: DragSource = {
          containerKind: '__external__',
          localId: '__selection-drop__',
          role: 'pane',
          label: (instance as { file?: string }).file ?? '',
          type: (instance as { type?: string }).type,
        }
        // The native reader-wikilink drag carries no store `content`, so no content-destination ever
        // accepts it (a folder's `accepts` fails) — the deepest hit is always a container zone. Narrow to
        // satisfy the type; a content-dest hit (never produced here) is ignored.
        const hit = resolveTargetsAll(point.clientX, point.clientY, source)[0]
        const target = hit && !isContentDropHit(hit) ? hit : null
        await placeContentDrop(instance, target)
      })()
    })
    return () => {
      setContentResolver(null)
      detach()
    }
  }, [reader, describeProjectionSet])

  // Install the substrate's grouping AMBIGUITY resolver: when a center-wrap could use two-plus declared
  // containers and none is requested, `routeDropWithGrouping` calls this, and it surfaces the host CHOOSER
  // over the available containers (labelled by their declared titles), returning the picked type name (or
  // null on cancel). Host code reaches the chooser surface directly.
  useEffect(() => {
    setGroupingChooser(async (available) => {
      const descriptors = describeProjectionSet()
      const options = available.map((name) => ({
        id: name,
        label: descriptorTitle((descriptors ?? []).find((d) => bareTypeName(d.type) === name)) ?? name,
      }))
      return getChooserSurface().choose({ title: 'Group panes into', options })
    })
    return () => setGroupingChooser(null)
  }, [describeProjectionSet])

  // The chrome CONTRIBUTIONS for a role KIND (LIVE off the ref), for a bar's candidate query.
  // The role IS the kind (kind-collapse): the candidates are the discovered projections whose KIND
  // closure includes it. The kernel only ANSWERS — it gathers candidates; a bar decides what to
  // surface / overflow / accept; it never places them.
  const listContributionsFor = useCallback(
    (kind: string): ChromeContribution[] =>
      discoveredRef.current.filter((d) => d.kinds.includes(kind)).map((d) => ({ projection: d.typeName, role: kind })),
    [],
  )
  // The KIND closure of a projection type — `[bare typeName, ...ancestors]` (LIVE off the ref). The
  // role-as-kind membership the runtime uses to resolve an `intent-defaults` role (a projection
  // kind) to the candidate owners the ambient scoper prefers/whitelists. The input `typeName` is a
  // node's config type, which is QUALIFIED (`tabs::tabs`), so match by IDENTITY
  // (not `===`, which would miss the bare discovered name) and return BARE kinds to compare against
  // the bare role names.
  const kindsOf = useCallback((typeName: string): string[] => {
    const d = discoveredRef.current.find((x) => matchesTypeIdentity({ name: x.typeName, repo: x.repo }, typeName))
    return d ? [d.typeName, ...d.kinds] : [refName(typeName)]
  }, [])
  // The intents a projection type declares it HANDLES (bare names), LIVE off the ref. Feeds host
  // INTROSPECTION (the agent-host transport `introspect` reports each node's declared capabilities).
  // Matches by cross-repo identity like `kindsOf`; empty when the type is unknown / declares none.
  const handlesOf = useCallback((typeName: string): string[] => {
    const d = discoveredRef.current.find((x) => matchesTypeIdentity({ name: x.typeName, repo: x.repo }, typeName))
    return d?.handles ?? []
  }, [])
  // The intents a projection type declares it handles ONLY WHEN AIMED (`handlesTargeted`) — the sibling of
  // `handlesOf`. Feeds the runtime's `isAmbientReachable` fold so a targeted-only handler (a viewer that can
  // be an open TARGET) is never an ambient candidate.
  const handlesTargetedOf = useCallback((typeName: string): string[] => {
    const d = discoveredRef.current.find((x) => matchesTypeIdentity({ name: x.typeName, repo: x.repo }, typeName))
    return d?.handlesTargeted ?? []
  }, [])
  // The intents a projection type declares it FIRES (bare names), LIVE off the ref — the mirror of
  // `handlesOf`. Feeds the runtime `.fire()` gate (flag a fire the type-def does not declare) and the
  // DECLARED intent census. Matches by cross-repo identity; empty when the type is unknown / declares none.
  const firesOf = useCallback((typeName: string): string[] => {
    const d = discoveredRef.current.find((x) => matchesTypeIdentity({ name: x.typeName, repo: x.repo }, typeName))
    return d?.fires ?? []
  }, [])
  // The composition-config ASPECTS a projection type declares it may EDIT (bare names), LIVE off the ref —
  // the sibling of `firesOf`/`handlesOf`, one axis over. Feeds the composition-aspect edit gate at
  // `compositionEdit`. Matches by cross-repo identity; empty when the type is unknown / declares none.
  const editsOf = useCallback((typeName: string): string[] => {
    const d = discoveredRef.current.find((x) => matchesTypeIdentity({ name: x.typeName, repo: x.repo }, typeName))
    return d?.edits ?? []
  }, [])
  // Build the declared intent census from projection discovery, mapping each intent to the projection
  // types that declare firing or handling it. This makes both sides discoverable before runtime activity.
  const declaredIntentCensus = useCallback((): { firers: Map<string, string[]>; handlers: Map<string, string[]> } => {
    const invert = (pick: (d: (typeof discoveredRef.current)[number]) => string[]): Map<string, string[]> => {
      const by = new Map<string, Set<string>>()
      for (const d of discoveredRef.current) for (const intentType of pick(d)) {
        let set = by.get(intentType)
        if (!set) by.set(intentType, (set = new Set()))
        set.add(d.typeName)
      }
      return new Map([...by].map(([k, v]) => [k, [...v].sort()]))
    }
    return { firers: invert((d) => d.fires), handlers: invert((d) => d.handles) }
  }, [])
  // Discovery-change subscription: a bar subscribes to re-query its contributions when the
  // discovered set changes. Listeners live in a ref (the callback stays stable so the runtime
  // doesn't rebuild); the effect below fires them whenever `discovered` updates.
  const contribListenersRef = useRef(new Set<() => void>())
  const subscribeContributions = useCallback((listener: () => void): (() => void) => {
    contribListenersRef.current.add(listener)
    return () => contribListenersRef.current.delete(listener)
  }, [])
  useEffect(() => {
    for (const listener of [...contribListenersRef.current]) listener()
  }, [discovered])

  // The workspace's members (STAND-IN), handed to every minted host so a
  // projection can be multi-root. A ref keeps the getter stable.
  const membersRef = useRef<WorkspaceMember[]>([])
  const getMembers = useCallback(() => membersRef.current, [])

  // The loaded composition's path, via a live ref — the view-state auto-store key.
  // The runtime is stable across composition switches, so it reads this getter, not
  // a static value. `''` (unsaved) keys an ephemeral bucket; entries firm up on save-as.
  const selectedPathRef = useRef(selectedPath)
  selectedPathRef.current = selectedPath
  const getCompositionId = useCallback(() => selectedPathRef.current, [])

  // The daemon-lifecycle STAND-IN, bound to the active config via a live ref so
  // it tracks path edits without rebuilding (and remounting) the tree.
  const configRef = useRef(config)
  configRef.current = config
  // Read `onConfigChange` through a ref so the daemon and runtime retain their identity across parent
  // re-renders. A callback identity change must not tear down a live composition during startup.
  const onConfigChangeRef = useRef(onConfigChange)
  onConfigChangeRef.current = onConfigChange
  const daemon = useMemo(() => createDaemonControl(() => configRef.current, (trace) => onConfigChangeRef.current({ trace })), [])

  // BUILD a new agent-session pane: a `terminal` instance running the adapter's launcher output at
  // the workspace. The host resolves the launch (it owns the tool paths); a container (bento) PLACES
  // the pane via an open-pane-intent at the previously-focused pane, so the host never mutates the
  // layout — no kernel remount, and placement respects focus.
  const launchAgentSession = useCallback(async (env?: LaunchEnv): Promise<AgentPane> => {
    const ws = configRef.current.entryPath
    if (!ws) return { ok: false, error: 'no workspace open' }
    // `entryPath` is the daemon ENTRY — under folder-repo a DIRECTORY, entry == root == home. The
    // adapter's `launch.ts` derives the au-mcp socket from it and pins CLAUDE_PROJECT_DIR to it; the
    // pty CWD is the same value. A FILE path here would be refused by the engine (`entry-not-a-repo`),
    // so the entry must stay a directory.
    //
    // The LAUNCHER owns the whole env: it mints `AU_MCP_SESSION`, assembles the `AU_MCP_*` vars, and
    // materializes the selected skills + injects into `--plugin-dir`s. au-host passes FLAGS ONLY and
    // sets zero env by hand, preventing env-name drift.
    //
    // Each `LaunchEnv` axis is tri-state end to end (undefined = the launcher's default; `[]` = none;
    // a list = only those), and every axis passes straight through to the launcher's flags:
    // `skills` / `inject` / `tools`, plus `nativeToolAllowlist` → `--native-tools` (the native-tool
    // whitelist: absent = all native tools, `[]` = a caged session, a list = only those).
    const r = await window.main.mcp.launch(ws, {
      resumeSession: env?.resumeSession,
      skills: env?.skills,
      inject: env?.inject,
      tools: env?.tools,
      nativeTools: env?.nativeToolAllowlist,
      // The chosen adapter (discovered `mcp.adapter` type name) + profile locator: forwarded so main
      // resolves the adapter (count rule) and its `--binary`. Absent adapter → main's single-adapter default.
      adapter: env?.adapter,
      profile: env?.profile,
    })
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, pane: { type: 'terminal', cwd: ws, command: r.command } }
  }, [])

  // The mcp-daemon control (STAND-IN), bound to the active workspace like `daemon`,
  // plus the host-provided `launchAgentSession` (needs composition access, lives here).
  const mcp = useMemo(
    () => ({ ...createMcpControl(() => configRef.current), launchAgentSession }),
    [launchAgentSession],
  )

  // One host-wide engine-readiness signal (STAND-IN); projections re-fetch on
  // the not-ready→ready edge. Backed by the main-process managed connection's
  // `connected` state (no poll). The watch is ref-counted on subscribers, so it
  // stops on its own when the last projection unmounts — no dispose effect needed
  // (and a dispose effect would fight StrictMode's re-subscribe cycle).
  const engineReady = useMemo(() => createEngineReadiness(entryPath), [entryPath])
  // Mirror engine readiness into render state (the source notifies on change, and its initial-value
  // re-query delivers the already-ready case), so the empty state can gate on a truly-ready engine.
  useEffect(() => engineReady.subscribe(setEngineReadyState), [engineReady])

  // The normalized subscribe surface for the chrome, with the entry pre-bound —
  // the same `TypedSubscriber` shape a mounted projection gets as `host.engine`.
  // Lets the host chrome open engine subscriptions (type-graph, ...) directly.
  const engineSubscriber = useMemo<TypedSubscriber>(
    () => ({ subscribe: (request, onEvent) => window.main.engine.subscribe(entryPath, request, onEvent) }),
    [entryPath],
  )

  // The composition runtime owns the mount tree for this entry.
  const runtime = useMemo(
    // ACTIVATE the composition pool: `schemas` lets mountRoot normalize the composition into the pool
    // and mount the RESOLVED root tree. bento reads the resolved (inline) tree, renders each child via
    // PaneProjection (which resolves FRESH from the pool), and emits `[[^^id]]` refs on save — the host
    // serializes the pool fresh, so no container re-serializes a stale child.
    // `onStructuralEdit` re-derives the mount tree after a structural pool edit (a re-parent /
    // wrap / close): the runtime hands back the fresh pool-form doc and `setMounted` re-runs
    // `KernelRoot`'s mount effect, so the whole gesture is ONE remount. (`setMounted` is a stable
    // state setter, so it needs no dep.)
    () => new CompositionRuntime({ entryPath, compositionId: getCompositionId, daemon, mcp, engineReady, resolve, members: getMembers, listProjections: listProjectionNames, describeProjections: describeProjectionSet, keymapFiles: () => keymapsRef.current, commandRouting: (intent) => commandRoutingFor(commandsRef.current, intent), kindsOf, handlesOf, handlesTargetedOf, firesOf, editsOf, declaredIntentCensus, listContributions: listContributionsFor, subscribeContributions, commitComposition, schemas: () => schemasRef.current, onStructuralEdit: (doc) => setMounted(doc as RootComposition) }),
    [entryPath, getCompositionId, daemon, mcp, engineReady, resolve, getMembers, listProjectionNames, describeProjectionSet, kindsOf, handlesOf, handlesTargetedOf, firesOf, editsOf, declaredIntentCensus, listContributionsFor, subscribeContributions, commitComposition],
  )
  // Bind the live-node getter now that the runtime exists (see `saveRootConfig`'s reconcile union).
  liveNodeIdsRef.current = () => runtime.liveNodeIds()
  // THE CROSS-FILE LOAD PRE-PASS. Before the portal mounts a composition, load its
  // `[[file]]` / `[[file^^id]]` nested closure (async reads) and prime the runtime, so the sync linker
  // (`linkPool`) folds them at mount. Runs from the portal effect, keyed by the same config, so it
  // re-primes on a switch. A no-nesting composition resolves to an empty map with no reads. Stable
  // identity (reads the path via a ref), so it does not itself re-run the portal effect.
  const primeForeign = useCallback(
    async (config: OpaqueConfig): Promise<void> => {
      const schemas = schemasRef.current
      const entry = selectedPathRef.current ?? undefined
      if (!schemas || config == null || typeof config !== 'object') {
        runtime.primeForeign(new Map(), entry)
        return
      }
      const foreign = await loadCrossFileClosure(reader, config as Record<string, unknown>, schemas, entry)
      runtime.primeForeign(foreign, entry)
    },
    [reader, runtime],
  )
  // Arm the runtime's host-transport + surface listeners while it's live; dispose them when it's
  // replaced (entry change) or the host unmounts. start()/dispose() live in an effect
  // (not the constructor) so StrictMode's mount→cleanup→mount leaves the KEPT runtime
  // armed (a constructor would leak the throwaway instance's IPC listeners).
  useEffect(() => {
    runtime.start()
    installCompositionReadBridge(() => runtime.serializeComposition()) // gated e2e/debug read of the persist payload
    return () => runtime.dispose()
  }, [runtime])

  const [pendingKeys, setPendingKeys] = useState<PendingKeySequence | null>(null)

  // The keybind gate for this (main) window: canonicalize + guards + arbitration, tracing each decision.
  // A surviving chord candidate goes to the authority runtime to resolve + fire; a consumed key is
  // suppressed. A floated window installs its own gate in the surface renderer.
  useEffect(() => {
    const cancel = (): void => runtime.cancelKeySequence(setPendingKeys)
    window.addEventListener('blur', cancel)
    const cancelOutside = (event: PointerEvent): void => {
      if (!event.composedPath().some(el => el instanceof Element && el.classList.contains('key-sequence-hints'))) cancel()
    }
    window.addEventListener('pointerdown', cancelOutside, true)
    const dispose = installKeybindGate(window, {
      hasPendingSequence: () => runtime.hasPendingKeySequence(setPendingKeys),
      cancelPendingSequence: cancel,
      isFocusedRawTextSurface: () => runtime.isFocusedRawTextSurface(),
      isBlockingModalOpen: overlaySiteHasBlockingLayer,
      onCandidate: (ks, e) => {
        if (runtime.pushKeystroke(ks, { observer: setPendingKeys })) e.preventDefault()
      },
    })
    return () => {
      cancel()
      dispose()
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerdown', cancelOutside, true)
    }
  }, [runtime])

  // Read the keymap FILES into the resolver-ready shape the runtime dispatches over, and RE-READ on every
  // knowledge-base change that touches a keymap file — so a rebind reaches the LIVE dispatcher with no
  // remount, whatever wrote it: the keymap-editor, an agent, or an external disk edit. The resolver reads
  // `keymapsRef` per keystroke and resolves the active set off the live pool (source-agnostic by design —
  // no editor poke). Mirrors the `subscribeTypes`→rediscover pattern; the daemon watches the FS and pushes
  // `knowledge-base-changed`. A transient close (daemon down) reopens on the not-ready→ready edge.
  useEffect(() => {
    let disposed = false
    let detach: (() => void) | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null
    const reread = (): void => {
      void readKeymaps(reader).then((map) => { if (!disposed) keymapsRef.current = map })
    }
    const touchesKeymap = (h: { added: string[]; removed: string[]; modified: string[] }): boolean =>
      [...h.added, ...h.removed, ...h.modified].some((p) => p.includes('.keymap.'))

    reread() // initial

    const open = (): void => {
      if (disposed || detach) return
      detach = subscribeChanges(engineSubscriber, (event) => {
        if (event.kind === 'change') {
          if (!touchesKeymap(event.scopeHint)) return
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(reread, 150)
        } else if (event.kind === 'closed') detach = null
      })
    }
    open()
    const offReady = engineReady.subscribe((ready) => { if (ready) open() })

    return () => {
      disposed = true
      if (debounce) clearTimeout(debounce)
      offReady()
      detach?.()
    }
  }, [reader, engineSubscriber, engineReady])

  // Discover projection types + workspace members through the engine.
  // Re-runnable. Members feed every minted host's multi-root content surface.
  const rediscover = useCallback(async (): Promise<void> => {
    try {
      const [discovery, members, nodeClosures, containerSubs, nodeSubs, mountableSubs, cmds] = await Promise.all([
        discoverProjections(reader),
        discoverMembers(reader),
        readNodeClosures(reader),
        readSubtypes(reader, 'container-projection'),
        readSubtypes(reader, 'container-node'),
        readSubtypes(reader, 'mountable'),
        discoverCommands(reader),
      ])
      membersRef.current = members
      // THE COMPOSITION POOL's slot graph: which fields of each container hold children. Derived from
      // the same subtype reads the rest of this pass uses, then handed to the runtime (live, via a
      // ref) so `normalizeToPool` / `resolvePoolToTree` know where a container's children live. A
      // WireSubtype IS a WireTypeDef, which satisfies the derivation's narrow view structurally. The
      // `mountable` subtypes let the derivation resolve a slot typed to a narrower mountable subtype
      // (a projection subtype / `composition*`) is-a `mountable`; a bare `mountable*` needs no family.
      if ('ready' in containerSubs && containerSubs.ready && 'ready' in nodeSubs && nodeSubs.ready) {
        const mountableDefs = 'ready' in mountableSubs && mountableSubs.ready ? mountableSubs.result.subtypes : []
        // The `window` branch of `mountable` holds a child (`content`) but is NOT a container-projection,
        // so it is enumerated separately or `window.content` is never walked and a window's view reaps.
        // `window` (+ any future subtype) sits in the mountable set already; filter it out here.
        const windowDefs = mountableDefs.filter((d) => bareTypeName(d.name) === 'window')
        schemasRef.current = deriveContainerSchemas(containerSubs.result.subtypes, nodeSubs.result.subtypes, mountableDefs, windowDefs)
        setSchemasReady(true) // gate the portal render: the pool normalize/resolve walk can now run
      }
      setMembers(members)
      setDiscovered(discovery.projections)
      setCommands(cmds)
      // A subtype that DECLARES loadable code and fails the handshake is not dropped silently. It is authored, discoverable, and absent — which without this reads as the type-def
      // having vanished. Surfaced in the strip rather than as a toast: it is a standing condition
      // until someone edits the type-def, not an event.
      setRejectedProjections(discovery.rejected)
      // SLOT RULES: the type-closure predicate the substrate checks a slot's `admits` with. Same
      // shape and same reason as the grouping install below — the substrate is a library with no
      // engine access, and `routeDrop` is synchronous — but it needs no loader, because the answer
      // is already in the `kinds` closure this pass just computed. See slot-types.ts.
      // The CONTAINER-NODE closures ride in the same predicate: the union normalizer asks the same
      // is-a question about slot types that `admits` asks about projections. Without them a SUBTYPE
      // of a container's slot reads as a bare child and silently loses the position's rules.
      installSlotTypeProvider(discovery.projections, nodeClosures)
      // Install each projection's effective-shape field ownership so `saveConfig` preserves other fields.
      // Refresh alongside discovery: synchronous saves require the ownership lookup to be ready.
      // See config-ownership.ts.
      installConfigOwnership(discovery.projections)
      // THE AGENT-INTENT GATE: which intents may be fired over the agent-host socket, and the
      // routing to stamp on one that may. Same install cadence and same reason as the two above —
      // `executeHostCommand` decides synchronously and cannot await a read. FAIL-CLOSED by
      // construction: until discovery populates it the table is empty and every socket fire is refused as an
      // unknown type, which is the safe direction for a channel that accepts every connection.
      // Needs `discovery.projections` for the derived payload check (which names mean "mountable").
      // See agent-intent-gate.ts for authorization and payload checks.
      installAgentIntents(await discoverAgentIntents(reader, discovery.projections))
      // Type-keyed notification CONTENT renderers: discover each `ui-notification` subtype's renderer
      // + register a host handler per subtype (the IntentTree matches by exact type). The base type
      // always uses the host default. See notification-renderers.ts.
      const notifRenderers = await discoverNotificationRenderers(reader)
      setNotificationRenderers(notifRenderers)
      runtime.installNotificationHandlers([...notifRenderers.keys()])
      // Resolve declared grouping capabilities eagerly and install a synchronous lookup for the substrate.
      // `routeDrop` cannot await discovery. Cache the type graph and composition's `group-into` separately,
      // since either can change independently. See grouping-discovery.ts.
      groupingCapsRef.current = await discoverGroupingContainers(reader)
      spatialCapsRef.current = await discoverSpatialContainers(reader)
      installGroupingProvider(groupingCapsRef.current, groupingChoiceOf(workingRef.current), groupNewPanesOf(workingRef.current))
      installWrapTargets(groupingCapsRef.current, spatialCapsRef.current, groupingChoiceOf(workingRef.current))
      // Component layer: discover the `component-set` +
      // `ui-component` subtypes, then register the resolved per-tag winners into the GLOBAL
      // custom-element registry (boot-swap). Idempotent — a tag defined this session stays, so a
      // re-run picks up newly-discovered sets/components without re-defining. A discovered tag no
      // active set provides gets a visible placeholder. See component-registry.ts.
      const [componentSets, componentDefs] = await Promise.all([
        discoverComponentSets(reader),
        discoverComponents(reader),
      ])
      // Stash the discovered sets so the components picker (a projection) can build a live scoped
      // preview through `host.components.buildPreview` — it can't discover/load sets itself.
      setDiscoveredSets(componentSets)
      // Eager-load each projection's AND each component set's token-declaration sheet at document
      // level so a theming pane can discover their `--au-<projection>-*` / `--au-<component>-*`
      // tokens via the CSSOM, mounted/active or not. Validated declarations-only; diagnostics
      // logged. One shared path: a component set surfaces its tokens exactly as a projection does.
      const tokenDiags = await loadTokenSheets([...discovery.projections, ...componentSets], files)
      for (const d of tokenDiags) {
        console.warn(`[token-sheet] ${d.projection} (${d.path}): ${d.message}`)
      }
      const reg = await registerComponentSets(componentSets, componentDefs, getActiveLook())
      for (const d of reg.diagnostics) console.warn(d)
    } finally {
      // Release the curtain gate: the `<au-*>` chrome is now defined in the global registry, so the
      // composition no longer flashes undefined frames. In `finally` so a discovery/registration
      // FAILURE degrades to the pre-gate behaviour (curtain lifts on `portalLive` alone) rather than
      // hanging the curtain forever. A latch: re-runs never drop it, an empty set still resolves here.
      setComponentsRegistered(true)
    }
  }, [reader, files, runtime])

  // Apply the persisted per-machine theme (the anonymous `--au-*` override layer) once at
  // boot, so a saved theme is live from launch — app-wide `:root`, independent of whether the
  // theming pane is ever mounted. See theme-store.ts.
  useEffect(() => {
    applyStoredTheme()
  }, [])

  useEffect(() => {
    void rediscover()
  }, [rediscover])

  // Self-heal when the daemon comes up AFTER mount: the host's own fetches
  // (composition discovery + projection-type discovery) ran once at load and would
  // otherwise stay empty until a manual rediscover. Re-run them on the not-ready→
  // ready edge so the composition picker fills and the root mounts on its own.
  useEffect(() => {
    return engineReady.subscribe((ready) => {
      if (!ready) return
      void discoverAndMaybeMount()
      void rediscover()
    })
  }, [engineReady, discoverAndMaybeMount, rediscover])

  // Live discovery: subscribe to the engine's `type-graph` channel and re-run
  // discovery on every change, so a newly-registered `projection` subtype (a new
  // projection type-def in the workspace) appears with NO app reload. The engine
  // already watches the FS and pushes `type-graph-changed`. Debounced against coalesced rebuilds. If the daemon is down at mount
  // the subscription closes transiently; it reopens on the not-ready→ready edge.
  useEffect(() => {
    let disposed = false
    let detach: (() => void) | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null

    const scheduleRediscover = (): void => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => void rediscover(), 200)
    }

    const open = (): void => {
      if (disposed || detach) return
      detach = subscribeTypes(engineSubscriber, (event) => {
        // Only re-discover on a CHANGE; the initial value duplicates the
        // mount-time / ready-edge rediscover, so ignore it here.
        if (event.kind === 'change') scheduleRediscover()
        // A transient close (daemon down) clears the handle so the ready edge reopens.
        else if (event.kind === 'closed') detach = null
      })
    }

    open()
    const offReady = engineReady.subscribe((ready) => {
      if (ready) open()
    })

    return () => {
      disposed = true
      if (debounce) clearTimeout(debounce)
      offReady()
      detach?.()
    }
  }, [engineSubscriber, engineReady, rediscover])

  // Keep the boot curtain until the engine can establish a truly empty workspace or the portal has
  // mounted its composition content. A discovery result from an unready engine can be transiently empty;
  // selecting a composition alone does not establish that its async mount has painted.
  const genuinelyEmpty = engineReadyState && compositionsLoaded && (compositions.length === 0 || startupStopped)
  const compositionLive = mounted !== null && schemasReady && portalLive && componentsRegistered
  const curtainLifted = compositionLive || genuinelyEmpty

  // Signal READY once, the moment the curtain would lift (composition painted, or confirmed empty).
  // The launcher waits on this to time its dissolve — it holds its own loader over the mist until the
  // workspace is genuinely ready, then reveals the finished composition. No hooks run after this point.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const readyFired = useRef(false)
  useEffect(() => {
    if (curtainLifted && !readyFired.current) {
      readyFired.current = true
      onReadyRef.current?.()
    }
  }, [curtainLifted])

  // HOST-GLOBAL COMMANDS as intents the host handles. The palette FIRES a command
  // intent; the host claims it here and runs the composition op. Registered once per runtime on a synthetic
  // gate-exempt node; the runners read the LATEST ops through a ref (they close over React state), so no
  // re-install churn. `installHostCommandHandlers({})` on teardown clears them.
  const commandOpsRef = useRef({ saveComposition, saveCompositionAs, deleteSelected })
  commandOpsRef.current = { saveComposition, saveCompositionAs, deleteSelected }
  useEffect(() => {
    runtime.installHostCommandHandlers({
      'toggle-pane-headers-intent': () => {const root=document.documentElement;root.dataset.auPaneHeaders=root.dataset.auPaneHeaders==='show'?'hide':'show'},
      'toggle-container-nesting-intent': () => {const root=document.documentElement;root.dataset.auNesting=root.dataset.auNesting==='expanded'?'quiet':'expanded'},
      'search-files-intent': () => window.dispatchEvent(new CustomEvent('au-open-picker',{detail:'files'})),
      'search-projections-intent': () => window.dispatchEvent(new CustomEvent('au-open-picker',{detail:'projections'})),
      'search-open-panes-intent': () => window.dispatchEvent(new CustomEvent('au-open-picker',{detail:'panes'})),
      'open-file-dialog-intent': () => {void window.main.dialog.pickPath('file').then(path=>{if(path)runtime.fireCommand({type:'open-intent',kind:'routed',dispatch:'ambient',target:{type:'file-selection',path}} as IntentPayload)}).catch(error=>warnToast(String(error)))},
      'choose-pane-intent': () => {void choosePane().catch(error=>warnToast(String(error)))},
      ...Object.fromEntries(['left','right','up','down'].map(direction=>[`focus-${direction}-intent`, (intent:IntentPayload)=>{
        const source=(intent as {target?:string}).target ?? keyboardContext().pane
        const target=source && directionalPane(source,direction)
        if(target) focusPane(target)
        else if (!source) warnToast('Click a pane or use Focus a pane… before moving focus.')
      }])),
      'save-composition-intent': () => void commandOpsRef.current.saveComposition(),
      'save-composition-as-intent': (intent) => {
        // `name` is a payload PARAM (not on the base IntentPayload); read it off the fired payload.
        const name = (intent as { name?: unknown }).name
        void commandOpsRef.current.saveCompositionAs(typeof name === 'string' ? name : undefined)
      },
      'delete-composition-intent': () => void commandOpsRef.current.deleteSelected(),
      // The host claims contextual save to save the composition when no focused editor handles it.
      // Ambient dispatch orders eligible handlers by focus recency.
      'save-intent': () => void commandOpsRef.current.saveComposition(),
      // Toggle the command palette through the operation it registers with the runtime.
      'toggle-command-palette-intent': () => runtime.togglePalette(),
      // Close the focused view (⌘W). The host resolves the focused pane and requests its removal; the
      // close-guard runs at the reap (the shared commit core). No editor coupling — any focused pane closes.
      'close-view-intent': () => runtime.closeFocusedView(),
    })
    return () => runtime.installHostCommandHandlers({})
  }, [runtime])


  // The composition picker + saver, bundled for the WINDOW ROOT HEADER (the only top chrome now).
  const compositionControl: CompositionControl = {
    compositions,
    selectedPath,
    loadComposition,
    dirty,
    loadedConsumed,
    saveComposition,
    deleteSelected,
    saveAsName,
    setSaveAsName,
    savableMembers,
    memberForSave,
    saveAsMember,
    setSaveAsMember,
    saveCompositionAs,
    compositionError,
    rejectedProjections,
  }

  return (
    <>
      {pendingKeys && <KeySequenceHints pending={pendingKeys} commands={commands} onInspect={paused => runtime.inspectKeySequence(setPendingKeys, paused)} onChoose={binding => runtime.chooseKeySequence(setPendingKeys, binding)} />}
      <div className="host-body">
        {mounted && schemasReady ? (
          // THE PORTAL PATH: the kernel drives the FLAT mount — one `PaneHost` per pool record, each
          // portaled into its container's anchor, so a re-parent never unmounts a pane. Keyed by the
          // composition so a switch is a clean remount; a structural edit re-derives via `onPoolChange`,
          // NOT a config change, so it never remounts here. The boot curtain below covers it until it
          // reports live, so the async portal mount never shows a bare frame.
          <KernelRootPortal
            key={selectedPath || 'unsaved'}
            config={mounted}
            onSaveConfig={saveRootConfig}
            primeForeign={primeForeign}
            runtime={runtime}
            onLive={setPortalLive}
            composition={compositionControl}
            commands={commands}
            reader={reader}
            isMac={isMac}
            zoom={zoom}
          />
        ) : genuinelyEmpty ? (
          <div className="host-empty">
            <p>{compositionError ? 'Could not open the initial layout' : 'No composition selected'}</p>
            <p role={compositionError ? 'alert' : undefined}>{compositionError || 'This workspace starts without a layout. Choose an available composition, or add a composition file to your workspace.'}</p>
            <AuScrollArea axis="y">
              {compositions.map(comp => <AuListRow key={comp.path} interactive primary={comp.name} onClick={() => loadComposition(comp)} />)}
            </AuScrollArea>
          </div>
        ) : null}
        {/* THE BOOT CURTAIN. One opaque overlay across the whole cold start — the transient-empty
            discovery, the slot-graph fill, the async portal mount — lifted only when the composition is
            genuinely live OR the workspace is confirmed (ready) empty. It fades out, so any residual
            sub-frame is masked rather than flashed. A single seam avoids per-stage
            placeholders flickering their own frames. */}
        {/* A plain opaque mask — NO visible loader. The LAUNCHER owns the boot indicator (it holds its
            own loader until the composition is genuinely painted, then dissolves), so a second bar here
            is redundant. This just hides the transient slot-graph / portal mount underneath, then fades
            out when the composition is live. */}
        <div className={`boot-curtain${curtainLifted ? ' lifted' : ''}`} aria-hidden={curtainLifted} />
      </div>
    </>
  )
}

/**
 * THE PORTAL KERNEL. The flat alternative to `KernelRoot`: instead of mounting the
 * resolved root TREE recursively, it renders one `PaneHost` per POOL RECORD (`PanePortalLayer`) and
 * makes the kernel container the ROOT record's anchor. Every pane mounts ONCE and is portaled into its
 * container's anchor, so a re-parent relocates the live element rather than unmounting it — a running
 * terminal / cursor survives, and React can never `removeChild` the pane's DOM (the crash).
 *
 * `mountRootPortal` normalizes the composition into the pool + returns a top-level host; a structural
 * edit re-derives via `onPoolChange` (not a config change), so this component never remounts on a drop
 * — only the affected containers' thin `PaneHost`s re-render their anchors. Keyed by the composition,
 * so a SWITCH is a clean remount (`disposePortal` on unmount tears the generation down).
 */
function KernelRootPortal({
  config,
  onSaveConfig,
  primeForeign,
  runtime,
  onLive,
  composition,
  commands,
  reader,
  isMac,
  zoom,
}: {
  config: OpaqueConfig
  onSaveConfig: (next: OpaqueConfig) => void
  primeForeign: (config: OpaqueConfig) => Promise<void>
  runtime: CompositionRuntime
  /** The composition picker + saver, owned by the window root header. */
  composition: CompositionControl
  /** The discovered command sets for the palette (curated + unregistered). */
  commands: CommandSets
  /** The engine reader, so the palette resolves a command's typed param shape + picker candidates. */
  reader: WireReader
  /** macOS: reserve the traffic-light gap in the root header. */
  isMac: boolean
  /** The renderer's web zoom, so the header counter-scales to match the fixed OS traffic lights. */
  zoom: number
  /** Reports the portal's live state up: true once mounted, false on teardown / switch. The host uses
   *  it to keep the boot curtain up until the composition actually has content. */
  onLive: (live: boolean) => void
}): React.JSX.Element {
  const [layer, setLayer] = useState<{ host: MountHost; rootId: string } | null>(null)
  const [records, setRecords] = useState<Array<{ id: string; contentKey: string }>>([])
  // The root content id, RECOMPUTED on every pool change — a restructure at the window root moves it (a
  // root-container dissolve re-points `window.content` to its lone child), so the root anchor must follow.
  const [rootId, setRootId] = useState<string | null>(null)
  const parkingRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // THE PER-RUNTIME PORTAL REGISTRY. A fresh registry per composition GENERATION (this runtime +
  // this config), so a switch to another composition — even one reusing a pane `^:` — gets its own
  // pane-host / anchor / parking maps and cannot collide with the disposing generation. Dropping this
  // component's generation drops the whole registry, so nothing leaks. Threaded into the observer, the
  // parking host, and every `PaneHost`.
  const portalRegistry = useMemo(() => createPortalRegistry(), [runtime, config])

  useEffect(() => {
    // ASYNC MOUNT: load the cross-file nested closure FIRST (async reads), prime the
    // runtime, THEN mount the portal (the linker folds the primed files synchronously). A no-nesting
    // composition primes an empty map with no reads, so the extra microtask is negligible. `disposed`
    // guards the StrictMode mount→cleanup→mount double-invoke and a switch that races the load.
    let disposed = false
    let teardown: (() => void) | undefined
    void (async () => {
      await primeForeign(config)
      if (disposed) return
      const started = runtime.mountRootPortal(config, onSaveConfig)
      if (!started) return
      setPanePortalParkingHost(portalRegistry, parkingRef.current) // Park panes inside the composition root during a move.
// The host observer derives pane anchors from `data-pane-id` elements under `.kernel-root`,
// keeping the anchor map current across container remounts for both vanilla and React projections.
// Disconnect the observer and clear the map on composition switch or unmount.

      const disposeObserver = rootRef.current ? installPaneAnchorObserver(portalRegistry, rootRef.current) : undefined
      // The per-window DOM-focus tracker: `focusin` over the kernel root feeds the focus recency from ACTUAL
      // focus (not opportunistic container reports), so routing-MRU + the active-pane ring are reliable on
      // load and after a programmatic / keyboard focus move.
      const disposeFocusTracker = rootRef.current ? runtime.installFocusTracker(rootRef.current) : undefined
      setLayer(started)
      setRecords(runtime.poolRecords())
      setRootId(runtime.currentRootId())
      onLive(true) // the composition now has content — the host may lift the boot curtain
      const unsub = runtime.onPoolChange(() => {
        setRecords(runtime.poolRecords())
        setRootId(runtime.currentRootId()) // a root-position restructure moves the root content id
      })
      teardown = () => {
        disposeObserver?.()
        disposeFocusTracker?.()
        unsub()
        runtime.disposePortal()
        setPanePortalParkingHost(portalRegistry, null)
        setLayer(null)
        setRecords([])
        onLive(false) // switching / unmounting — the curtain covers the next mount
      }
    })()
    return () => {
      disposed = true
      teardown?.()
    }
  }, [config, onSaveConfig, primeForeign, runtime, portalRegistry])

  return (
    <div className="kernel-root" ref={rootRef}>
      {/* Hidden holding area for a pane whose anchor is momentarily absent mid-move — inside the
          composition root, so the host's dom-bounds detector never flags it. */}
      <div ref={parkingRef} style={{ display: 'none' }} />
      {layer && <PanePortalLayer host={layer.host} registry={portalRegistry} records={records} />}
      {layer && rootId && (
        <WindowRootHeader host={layer.host} rootId={rootId} runtime={runtime} composition={composition} commands={commands} reader={reader} isMac={isMac} zoom={zoom} />
      )}
      <PortalRootAnchor rootId={layer ? rootId : null} runtime={runtime} />
    </div>
  )
}

/** The kernel container that claims the ROOT record's pane host: the root bento's live element is
 *  portaled in here, and its own children's anchors nest inside it.
 *
 *  It ALSO declares the window content as a re-pointable SLOT: it marks itself a `slot-rect` (id = the
 *  current content id) and registers the runtime's `rootContentPlacement`, so the restructure seam
 *  (unwrap/dissolve at the window root, and root-wrap) walks up past the root container, finds this
 *  placement, and re-points `window.content` through the SAME `setSlotContent` every container slot uses.
 *  The slot holds a bare projection OR a container equally — the window is not made a container. */
/** The composition picker + saver, bundled so the WINDOW ROOT HEADER (the only top chrome) owns it. */
interface CompositionControl {
  compositions: DiscoveredComposition[]
  selectedPath: string
  loadComposition: (comp: DiscoveredComposition) => void
  dirty: boolean
  loadedConsumed: boolean
  saveComposition: () => void | Promise<void>
  deleteSelected: () => void | Promise<void>
  saveAsName: string
  setSaveAsName: (s: string) => void
  savableMembers: WorkspaceMember[]
  memberForSave: () => WorkspaceMember | undefined
  saveAsMember: string
  setSaveAsMember: (s: string) => void
  saveCompositionAs: (name?: string) => void | Promise<void>
  compositionError: string
  rejectedProjections: RejectedProjection[]
}

/** The header's composition picker: switch, save, copy or delete a saved composition. */
function CompositionMenu({ c, host }: { c: CompositionControl; host: MountHost }): React.JSX.Element {
  const triggerRef = useRef<HTMLElement>(null)
  // The overlay layer element the host popover surface hands us; we PORTAL the React body into it, so
  // the form's controls stay reactive (the control re-flows on every keystroke) while the host owns the
  // layer + anchoring + dismissal. `null` when closed.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null)
  const handleRef = useRef<PopoverHandle | null>(null)
  const current = c.compositions.find((x) => x.path === c.selectedPath)

  const openMenu = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.close() // toggle: a second trigger click closes it
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect || !host.popover) return
    handleRef.current = host.popover.open(
      rect,
      (el) => setPortalEl(el),
      () => {
        // Dismissed for any reason (Esc / outside / blur / close()) — drop the portal + un-press.
        handleRef.current = null
        setPortalEl(null)
      },
    )
  }, [host])

  return (
    <span className="no-drag" style={{ display: 'inline-flex' }}>
      <AuIconButton
        ref={triggerRef}
        label={`Compositions${current ? ` — ${current.name}` : ''}`}
        aria-expanded={!!portalEl}
        onAuActivate={openMenu}
      >
        <AuIcon name="folder-open" />
      </AuIconButton>
      {portalEl &&
        createPortal(<CompositionPopoverBody c={c} onClose={() => handleRef.current?.close()} />, portalEl)}
    </span>
  )
}

/** The composition popover's CONTENT: an `<au-popover>` panel of `<au-*>` controls, portaled into the
 *  host popover surface's layer. The surface owns the frame (anchor + dismissal); this owns the body. */
function CompositionPopoverBody({ c, onClose }: { c: CompositionControl; onClose: () => void }): React.JSX.Element {
  return (
    <AuPopover arrow={false} heading="Compositions" className="composition-popover">
      <AuScrollArea axis="y" className="composition-popover__scroll">
        <div className="composition-popover__list">
          {c.compositions.length === 0 && <div className="composition-popover__empty">(default — none saved)</div>}
          {c.compositions.map((comp) => (
            <AuListRow
              key={comp.path}
              interactive
              selected={comp.path === c.selectedPath}
              primary={comp.name}
              className="composition-popover__row"
              onClick={() => {
                c.loadComposition(comp)
                onClose()
              }}
            />
          ))}
        </div>
      </AuScrollArea>
      <div className="composition-popover__actions">
        <AuButton size="sm" variant="ghost" disabled={!c.dirty || !c.selectedPath} onAuActivate={() => void c.saveComposition()}>
          {c.dirty ? (c.loadedConsumed ? 'Save copy' : 'Save') : 'Saved'}
        </AuButton>
        <AuButton
          size="sm"
          variant="ghost"
          disabled={!c.selectedPath}
          onAuActivate={() => {
            void c.deleteSelected()
            onClose()
          }}
        >
          Delete
        </AuButton>
      </div>
      <div className="composition-popover__saveas">
        <AuInput
          size="sm"
          value={c.saveAsName}
          placeholder="save as…"
          spellcheck={false}
          onAuInput={(e) => c.setSaveAsName((e.target as HTMLElement & { value: string }).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void c.saveCompositionAs()
          }}
        />
        {c.savableMembers.length > 0 && (
          <AuSelect
            size="sm"
            options={c.savableMembers.map((m) => ({ value: m.name, label: m.name }))}
            value={c.memberForSave()?.name ?? ''}
            onAuChange={(e) => c.setSaveAsMember((e.detail as { value: string }).value)}
          />
        )}
        <AuButton size="sm" variant="cta" disabled={!c.saveAsName.trim()} onAuActivate={() => void c.saveCompositionAs()}>
          Save as
        </AuButton>
      </div>
      {c.compositionError && <div className="composition-popover__error">{c.compositionError}</div>}
      {c.rejectedProjections.length > 0 && (
        <div
          className="composition-popover__error"
          title={c.rejectedProjections.map((r) => `${r.typeName}::${r.repo}\n  ${r.errors.join('\n  ')}`).join('\n\n')}
        >
          ⚠ {c.rejectedProjections.length} projection{c.rejectedProjections.length > 1 ? 's' : ''} rejected at the handshake
        </div>
      )}
    </AuPopover>
  )
}

// Special palette-item ids — host meta-actions, not intents.
const SHOW_UNREGISTERED = '__show_unregistered__'
const BACK_TO_COMMANDS = '__back_to_commands__'

/**
 * THE COMMAND PALETTE (header center). A command IS an intent carrying a `command-meta`.
 *  `au-command-palette` lists the CURATED commands (command-meta) + a trailing "Show unregistered" escape hatch
 *  that reveals the in-scope intents WITHOUT one (discovery, not curation). Running a command: a param-LESS one
 *  fires immediately; one with payload params opens the INLINE typed-value filler (`CommandValueFiller`), which
 *  resolves the intent's EFFECTIVE shape and renders the recursive `<au-typed-value-editor>`. Firing is generic
 *  (`runtime.fireCommand` from the gate-exempt host node, stamping the registry's kind/dispatch). Centered (⌘K),
 *  so it claims `host.overlay` directly.
 */
function CommandPalette({
  host,
  runtime,
  commands,
  reader,
}: {
  host: MountHost
  runtime: CompositionRuntime
  commands: CommandSets
  reader: WireReader
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<CommandDescriptor | null>(null) // a command awaiting its params (arg-filler)
  const [showUnregistered, setShowUnregistered] = useState(false)
  const [picker,setPicker]=useState<PickerMode|null>(null)
  const [choices,setChoices]=useState<PaletteOption[]>([])
  const [projectionChoices,setProjectionChoices]=useState<PaletteOption[]>([])
  useEffect(()=>{
    if(!open)return
    let current=true
    void pickerOptions('projections',host,reader).then(items=>{if(current)setProjectionChoices(items)})
    return ()=>{current=false}
  },[open,host,reader])
  const [pickerLoading,setPickerLoading]=useState(false)
  const [pickerError,setPickerError]=useState('')
  useEffect(()=>{
    let current=true
    if(!picker)return
    setPickerLoading(true);setChoices([]);setPickerError('')
    void pickerOptions(picker,host,reader).then(items=>{if(current)setChoices(items)},error=>{if(current)setPickerError(String(error))}).finally(()=>{if(current)setPickerLoading(false)})
    return ()=>{current=false}
  },[picker,host,reader])

  // The active keymap binds ⌘K to the palette toggle intent. The palette registers its toggle with
  // the runtime, keeping the binding visible, editable, and removable through the normal keymap.
  useEffect(() => runtime.setPaletteToggle(() => {
    setOpen(value => !value)
    setPicker(null)
    setPending(null)
    setShowUnregistered(false)
  }), [runtime])

  useEffect(() => {
    const pick = (event: Event): void => {
      const mode = (event as CustomEvent<PickerMode>).detail
      const closing = open && picker === mode
      setOpen(!closing)
      setPicker(closing ? null : mode)
      setPending(null)
    }
    window.addEventListener('au-open-picker', pick)
    return () => window.removeEventListener('au-open-picker', pick)
  }, [open, picker])

  const close = useCallback(() => {
    setOpen(false)
    setPicker(null)
    setPending(null)
    setShowUnregistered(false)
  }, [])

  const fire = useCallback(
    (cmd: CommandDescriptor, params: Record<string, unknown>) => {
      // Fire from the host (via the runtime's gate-exempt palette node), NOT `host.intent` (the root
      // projection node — that would trip the declared-fire gate). kind/dispatch come from the registry.
      close()
      runtime.fireCommand({ type: cmd.id, kind: cmd.kind, dispatch: cmd.dispatch, ...params } as IntentPayload)
    },
    [runtime, close],
  )

  const start = useCallback(
    (cmd: CommandDescriptor) => {
      if(cmd.id==='show-pane-intent'){setPicker('projections');return}
      if (cmd.params.length > 0) setPending(cmd) // fill its params inline
      else fire(cmd, {}) // short-circuit
    },
    [fire],
  )

  const onRun = useCallback(
    (id: string) => {
      const projection = projectionChoices.find(item=>`projection:${item.id}`===id)
      if(projection){
        close()
        runtime.fireCommand({type:'show-pane-intent',kind:'routed',dispatch:'ambient',paneType:projection.id} as IntentPayload)
        return
      }
      if (id === SHOW_UNREGISTERED) return setShowUnregistered(true)
      if (id === BACK_TO_COMMANDS) return setShowUnregistered(false)
      const pool = showUnregistered ? commands.unregistered : commands.commands
      const cmd = pool.find((c) => c.id === id)
      if (cmd) start(cmd)
    },
    [commands, showUnregistered, start, projectionChoices, close, runtime],
  )

  // A parameterized command's slots, shown inline (`[name] [mode] …`) so a command that will prompt reads
  // as such before selecting. Known for every intent (curated OR unregistered), from its payload fields.
  const paramHint = (c: CommandDescriptor): string | undefined =>
    c.params.length ? c.params.map((p) => `[${p.name}]`).join(' ') : undefined

  // The palette-open shortcut for the trigger tooltip — reverse-looked-up from the active keymaps.
  const paletteShortcut = runtime.shortcutForIntent('toggle-command-palette-intent')

  // The list depends on the mode: curated commands + a "show unregistered" escape hatch, or the
  // unregistered intents + a "back" row. Ungrouped meta-rows (undefined group) render header-less.
  const commandOrder = new Map(runtime.commandPaletteOrder().map((id, index) => [id, index]))
  const items = !open ? [] : showUnregistered
    ? [
        { id: BACK_TO_COMMANDS, label: '← Registered commands' },
        ...commands.unregistered.map((c) => ({ id: c.id, label: c.label, detail: paramHint(c), group: c.category })),
      ]
    : [
        ...[true, false].flatMap(bound => commands.commands
          .filter(c => Boolean(runtime.shortcutForIntent(c.id)) === bound)
          .sort((a, b) => bound ? (commandOrder.get(a.id) ?? Infinity) - (commandOrder.get(b.id) ?? Infinity) : 0)
          .map(c => ({
            id: c.id,
            label: c.label,
            icon: c.icon,
            group: bound ? 'Keyboard shortcuts' : c.category,
            shortcut: runtime.shortcutForIntent(c.id),
            detail: paramHint(c),
          }))),
        ...projectionChoices.map(item=>({...item,id:`projection:${item.id}`,label:`Show ${item.label}`,group:'Projections'})),
        ...(commands.unregistered.length > 0
          ? [{ id: SHOW_UNREGISTERED, label: `Show unregistered (${commands.unregistered.length})` }]
          : []),
      ]

  return (
    <>
      <button
        className="cmd-palette-trigger no-drag"
        onClick={() => setOpen(true)}
        // The tooltip's shortcut is reverse-looked-up from the active keymaps (not hardcoded), so it tracks
        // whatever binds toggle-command-palette-intent (or shows none if the keymap is dropped).
        title={`Command palette${paletteShortcut ? ` (${paletteShortcut})` : ''}`}
      >
        <span>Search commands…</span>
      </button>
      {
        <CommandOverlay open={open} host={host} onClose={close} heading={picker ? (picker==='files'?'Open file':picker==='panes'?'Focus open pane':'Open projection') : 'Commands'} onBack={picker ? ()=>setPicker(null) : undefined}>
          {picker ? <>
            {pickerError && <p role="alert">{pickerError}</p>}
            <SearchPalette key={picker} items={choices} loading={pickerLoading} placeholder={picker==='files'?'Search workspace files…':picker==='panes'?'Search open panes…':'Search projections…'} onRun={id=>{
              const mode=picker;close()
              if(mode==='panes')focusPane(id)
              else runtime.fireCommand(mode==='files'?{type:'open-intent',kind:'routed',dispatch:'ambient',target:{type:'file-selection',path:id}} as IntentPayload:{type:'show-pane-intent',kind:'routed',dispatch:'ambient',paneType:id} as IntentPayload)
            }}/>
          </> : pending ? (
            <CommandValueFiller
              cmd={pending}
              reader={reader}
              onCancel={() => setPending(null)}
              onSubmit={(v) => fire(pending, v)}
            />
          ) : (
            <SearchPalette
              placeholder={showUnregistered ? 'Run an unregistered intent…' : 'Search commands and projections…'}
              items={items}
              onRun={onRun}
            />
          )}
        </CommandOverlay>
      }
    </>
  )
}

/** The palette's CENTERED overlay: claims a `host.overlay` layer, portals its content in, centers it, and
 *  light-dismisses (Esc / outside pointerdown; a pointerdown on the trigger is ignored so the trigger toggles). */
function CommandOverlay({
  open,
  heading, onBack,
  host,
  onClose,
  children,
}: {
  open: boolean
  heading: string
  onBack?: () => void
  host: MountHost
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element | null {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const [present, setPresent] = useState(open)
  const lastContent = useRef({ heading, onBack, children })
  if (open) lastContent.current = { heading, onBack, children }
  useEffect(() => { if (open) setPresent(true) }, [open])
  useEffect(() => {
    if (!box || open) return
    box.inert = true
    const style = getComputedStyle(box)
    const token = style.getPropertyValue('--au-m-base').trim()
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0
      : parseFloat(token || '220ms') * (token.endsWith('ms') || !token ? 1 : 1000)
    const animation = box.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration, easing: style.getPropertyValue('--au-e-deep').trim() || 'ease-out', fill: 'forwards',
    })
    void animation.finished.then(() => setPresent(false), () => {})
    return () => { animation.cancel(); box.inert = false }
  }, [box, open])
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!present) return
    // `keyguard: false` — the palette is a keyboard LAUNCHER that manages its own keys, so its open layer
    // must NOT suppress keybind dispatch (else the `⌘K` keybind could not toggle it closed; ).
    const layer = host.overlay?.claim({ level: 'overlay', keyguard: false })
    if (!layer) return
    // The layer is pointer-events:none; this centered container re-enables them for itself.
    const el = document.createElement('div')
    el.className = 'cmd-palette-overlay'
    const handle = document.createElement('div')
    handle.className = 'command-overlay-heading'
    el.append(handle)
    const movement = makeOverlayMovable(el, handle)
    layer.el.appendChild(el)
    const before = document.activeElement as HTMLElement | null
    setBox(el)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node
      // Inside the palette LAYER — not just the panel — so a click on a control's popup nested under the
      // layer (a select's option list) does NOT read as outside and dismiss the palette. Or on the trigger
      // (so the trigger toggles rather than close-then-reopen). Either → keep open.
      if (layer.el.contains(t) || (t instanceof Element && t.closest('.cmd-palette-trigger'))) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    // Defer the outside-pointerdown one tick so the opening click does not dismiss immediately.
    const timer = setTimeout(() => document.addEventListener('pointerdown', onDown, true))
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      movement.dispose()
      const restoreFocus = document.activeElement === document.body || el.contains(document.activeElement)
      layer.release()
      if (restoreFocus && before?.isConnected) before.focus({preventScroll:true})
      setBox(null)
    }
  }, [host, present])
  return box ? <>
    {createPortal(<>{lastContent.current.onBack && <AuButton variant="ghost" size="sm" onAuActivate={lastContent.current.onBack}>← Commands</AuButton>}<span>{lastContent.current.heading}</span><span className="command-overlay-grip" aria-hidden="true">⠿</span></>, box.querySelector('.command-overlay-heading')!)}
    {createPortal(lastContent.current.children, box)}
  </> : null
}

/**
 * Render the command payload with the recursive `<au-typed-value-editor>` using its effective shape,
 * including inherited fields. Validate live and pass the completed payload to the caller; the engine
 * performs authoritative validation.
 */
function CommandValueFiller({
  initialValue = {},
  cmd,
  reader,
  onCancel,
  onSubmit,
}: {
  initialValue?: Record<string,unknown>
  cmd: CommandDescriptor
  reader: WireReader
  onCancel: () => void
  onSubmit: (value: Record<string, unknown>) => void
}): React.JSX.Element {
  const [schema, setSchema] = useState<ResolvedShape | null>(null)
  const [value, setValue] = useState<Record<string, unknown>>(initialValue)
  const [diagnostics, setDiagnostics] = useState<ValueDiagnostic[]>([])

  // Resolve the intent type's EFFECTIVE fields (own + inherited) as a record — the top-level form.
  useEffect(() => {
    let alive = true
    void resolveValue({ kind: 'record', name: cmd.id }, makeReaderPort(reader)).then((s) => {
      if (alive) setSchema(s)
    })
    return () => {
      alive = false
    }
  }, [cmd.id, reader])

  // One picker source for every reference slot: walk the resolved schema to the slot, then read the ceiling.
  const resolveOptions = useCallback<ResolveOptions>(
    async (slotPath, query) => (schema ? optionsForSlot(schema, slotPath, query, reader) : []),
    [schema, reader],
  )

  const onChange = useCallback(
    (next: Record<string, unknown>) => {
      setValue(next)
      if (schema) setDiagnostics(validate(next, schema))
    },
    [schema],
  )

  const onComplete = useCallback(
    (raw: Record<string, unknown>) => {
      const valDiags = schema ? validate(raw, schema) : []
      const { value: payload, diagnostics: fireDiags } = normalize(raw, 'fire')
      const all = [...valDiags, ...fireDiags]
      if (all.some((d) => d.severity === 'error')) {
        setDiagnostics(all) // surface, do NOT fire — the editor marks each invalid slot inline
        return
      }
      onSubmit(payload as Record<string, unknown>)
    },
    [schema, onSubmit],
  )

  if (!schema) {
    return (
      <AuPopover arrow={false} className="cmd-value-filler cmd-value-filler--loading" role="status">
        Resolving “{cmd.label}”…
      </AuPopover>
    )
  }
  return (
    <AuPopover arrow={false} className="cmd-value-filler" role="dialog" aria-label={cmd.label}>
      <div className="cmd-value-filler__crumb">
        <button className="cmd-value-filler__back no-drag" onClick={onCancel} title="Back to commands">
          ←
        </button>
        <span className="cmd-value-filler__cmd">{cmd.label}</span>
      </div>
      <AuScrollArea className="cmd-value-filler__scroll" axis="y">
        <AuTypedValueEditor
          className="cmd-value-filler__editor"
          schema={schema}
          value={value}
          diagnostics={diagnostics}
          resolveOptions={resolveOptions}
          submit-label="Run"
          onAuValueChange={(e) => onChange(((e as CustomEvent).detail as { value: Record<string, unknown> }).value)}
          onAuValueComplete={(e) => onComplete(((e as CustomEvent).detail as { value: Record<string, unknown> }).value)}
        />
      </AuScrollArea>
    </AuPopover>
  )
}

/** Walk a resolved schema to the shape at a value path, then map that shape to picker candidates via the
 *  engine reads. Non-terminal path segments are record field-names or list indices; the terminal
 *  reference / inline-or-reference / pinned / compound-reference shape names the ceiling type(s) whose
 *  instances (or files) are the candidates. Absent shape → no options (the picker degrades to free text). */
async function optionsForSlot(
  root: ResolvedShape,
  slotPath: string[],
  query: string,
  reader: WireReader,
): Promise<EditorOption[]> {
  const shape = shapeAtPath(root, slotPath)
  return shape ? optionsForShape(shape, query, reader) : []
}

function shapeAtPath(root: ResolvedShape, path: string[]): ResolvedShape | undefined {
  let shape: ResolvedShape | undefined = root
  for (const seg of path) {
    if (!shape) return undefined
    shape = stepIntoShape(shape, seg)
  }
  return shape
}

/** One value-path segment into a resolved shape: a record's field, a list's element, an inline record's
 *  field, or (best-effort, the path carries no branch marker) a compound branch declaring the field. */
function stepIntoShape(shape: ResolvedShape, seg: string): ResolvedShape | undefined {
  switch (shape.kind) {
    case 'record':
      return shape.fields.find((f) => f.name === seg)?.shape
    case 'inline-or-reference':
      return shape.record.kind === 'record' ? shape.record.fields.find((f) => f.name === seg)?.shape : undefined
    case 'list':
      return shape.inner // seg is a numeric list index
    case 'pinned':
      return stepIntoShape(shape.inner, seg)
    case 'union':
    case 'intersection': {
      for (const branch of shape.branches) {
        const inner = stepIntoShape(branch, seg)
        if (inner) return inner
      }
      return undefined
    }
    default:
      return undefined
  }
}

/** Map a terminal reference-bearing shape to its picker candidates: a `T*` reads that type's instances, a
 *  `file*` / `any*` reads workspace files, a compound-reference merges its ceilings. */
async function optionsForShape(shape: ResolvedShape, query: string, reader: WireReader): Promise<EditorOption[]> {
  switch (shape.kind) {
    case 'reference':
      return shape.typeName === 'file' || shape.typeName === 'any'
        ? fileOptions(reader, query)
        : instanceOptions(reader, shape.typeName, query)
    case 'inline-or-reference':
      return instanceOptions(reader, shape.typeName, query)
    case 'pinned':
      return optionsForShape(shape.inner, query, reader)
    case 'compound-reference': {
      const lists = await Promise.all(shape.typeNames.map((t) => instanceOptions(reader, t, query)))
      return dedupeById(lists.flat())
    }
    default:
      return []
  }
}

/** The wikilink target for a catalogued file path: the repo-relative path minus ONE trailing extension
 *  (the engine's stem rule), so a `[[target]]` resolves it by path. */
function linkTarget(path: string): string {
  return path.replace(/\.[^./]+$/, '')
}

const OPTION_CAP = 50

async function instanceOptions(reader: WireReader, type: string, query: string): Promise<EditorOption[]> {
  const r = await readInstancesOf(reader, type, { origins: ['file'] })
  if (!('ready' in r) || !r.ready || !r.result) return []
  const opts = r.result.map((m) => {
    const target = linkTarget(m.path)
    return { id: `[[${target}]]`, label: target.split('/').pop() ?? target, detail: m.claim.join(', ') || m.member }
  })
  return filterOptions(opts, query)
}

async function fileOptions(reader: WireReader, query: string): Promise<EditorOption[]> {
  const r = await readFiles(reader, {})
  if (!('ready' in r) || !r.ready || !r.result) return []
  const opts = r.result.map((f) => ({
    id: `[[${linkTarget(f.path)}]]`,
    label: f.stem,
    detail: f.repo ?? undefined,
  }))
  return filterOptions(opts, query)
}

function filterOptions(opts: EditorOption[], query: string): EditorOption[] {
  const q = query.trim().toLowerCase()
  const hit = q ? opts.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)) : opts
  return hit.slice(0, OPTION_CAP)
}

function dedupeById(opts: EditorOption[]): EditorOption[] {
  const seen = new Set<string>()
  const out: EditorOption[] = []
  for (const o of opts) {
    if (seen.has(o.id)) continue
    seen.add(o.id)
    out.push(o)
  }
  return out.slice(0, OPTION_CAP)
}

/** THE WINDOW ROOT HEADER — the window draws the root content's pane header exactly like any container
 *  draws its child's (the window HOLDS the root; no container is above it). This one header IS the top
 *  chrome — there is NO separate app bar. It carries a hardcoded layout for the root case:
 *    [ macOS traffic-light gap · (grow) · command palette · composition icon · (grow) · the root ⋯ ]
 *  The `⋯` acts on the WHOLE root content (wrap/unwrap/pop-out) through the ROOT placement (for a
 *  container root, `placementForPane` would resolve the container's OWN placement — the wrong holder). */
function WindowRootHeader({
  host,
  rootId,
  runtime,
  composition,
  commands,
  reader,
  isMac,
  zoom,
}: {
  host: MountHost
  rootId: string
  runtime: CompositionRuntime
  composition: CompositionControl
  commands: CommandSets
  reader: WireReader
  isMac: boolean
  zoom: number
}): React.JSX.Element {
  const choose = host.chooser ? host.chooser.choose.bind(host.chooser) : async () => null
  const rows: ContextMenuItem[] = [
    {
      id: 'root.wrap',
      label: 'Wrap in a container',
      icon: 'wrap',
      enabled: true,
      run: () => void wrapPaneInteractive(rootId, { choose }, runtime.rootContentPlacement()),
    },
  ]
  const rootLabel = runtime.rootTypeLabel() || 'root'
  // The main window's leading edge is a clickable WORKSPACE-NAME button that opens the workspace-details
  // projection (the single `workspace-panel`, if one is present), fired as an ambient show-pane intent.
  const workspaceName = host.entry.path.split(/[\\/]/).filter(Boolean).at(-1) || host.entry.path
  const workspacePanels = host.describeProjections?.().filter(d => d.type === 'workspace-panel') ?? []
  const workspacePanel = workspacePanels.length === 1 ? workspacePanels[0] : undefined
  const openWorkspace = (): void => {
    // The button is disabled unless a single workspace-panel is present, so a fire always has a target.
    if (!workspacePanel || !host.intent) return
    host.intent.fire({
      type: 'show-pane-intent', dispatch: 'ambient', paneType: `${workspacePanel.type}::${workspacePanel.repo}`,
    } as unknown as IntentPayload)
  }
  const workspaceButton = (
    <AuButton
      slot="leading"
      className="window-root-header__workspace no-drag"
      variant="ghost"
      size="sm"
      aria-label={`Open workspace details — ${workspaceName}`}
      title={`${workspaceName}\n${workspacePanel ? 'Open workspace details' : 'Workspace details projection is not available'}`}
      disabled={!workspacePanel || !host.intent}
      onAuActivate={openWorkspace}
    >
      <span className="window-root-header__label">{workspaceName}</span>
    </AuButton>
  )
  // The main window renders the shared shell with the FULL center (palette + composition folder) and the
  // workspace-name button. A surface renders the same shell WITHOUT the center and falls back to the plain
  // root label (see window-root-shell.tsx).
  return (
    <WindowRootShell
      host={host}
      rootLabel={rootLabel}
      rootActions={() => [...rows, ...reloadPaneRows(host, rootId)]}
      isMac={isMac}
      zoom={zoom}
      leading={workspaceButton}
      center={
        <>
          <CommandPalette host={host} runtime={runtime} commands={commands} reader={reader} />
          <CompositionMenu c={composition} host={host} />
        </>
      }
    />
  )
}

function PortalRootAnchor({ rootId, runtime }: { rootId: string | null; runtime: CompositionRuntime }): React.JSX.Element {
  const ref = usePaneAnchor(rootId ?? '')
  useEffect(() => {
    const el = ref.current
    if (!el || !rootId) return
    el.setAttribute('data-droptarget-shape', 'slot-rect')
    el.setAttribute('data-droptarget-id', rootId)
    registerContainer(el, runtime.rootContentPlacement())
    return () => {
      deregisterContainer(el)
      el.removeAttribute('data-droptarget-shape')
      el.removeAttribute('data-droptarget-id')
    }
  }, [ref, rootId, runtime])
  return <div className="kernel-container" ref={ref} />
}
