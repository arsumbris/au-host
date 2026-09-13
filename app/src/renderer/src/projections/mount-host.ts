import { projectionReload } from './projection-reload'
// The host side of the v2 RPC mount contract, in the host's own renderer.
//
// v2 has no by-reference fast path: even in-renderer, a projection reaches the
// engine through a protocol over a `HostTransport`, re-presented as a
// `MountHost` by the SDK's `createMountHost`. This module supplies the
// same-renderer transport — the broker just calls `window.main.engine` and
// streams replies back, with no IPC and no serialization.

import { createMountHost, MOUNT_CONTRACT_VERSION, reportHostDiagnostic } from '@arsumbris/au-host-sdk'

import { droppedOwnFields, mergeOwned, ownedFieldsOf } from './config-ownership'
import { refName } from '@arsumbris/type-query'
import type { HostToProjection, HostTransport, MountHost, MountHostInfo, ProjectionToHost, ProjectionDescriptor } from '@arsumbris/au-host-sdk'
import type { EngineReadResult, ReadRequest, SubscribeRequest, SubscriptionEvent } from '@arsumbris/au-host-sdk/engine-reads'

import type { ChromeContribution, CloseGuardChannel, CompositionCommit, CompositionEditControl, DaemonControl, EngineReadiness, FilesControl, FocusChannel, IntentChannel, KeymapsControl, McpControl, HostApp, OpaqueConfig, OpenSurfaces, PreviewSurface, ScopeControl, SelectionChannel, ShellControl, TerminalChannel, ViewStore, WindowControl, WorkspaceControl, WorkspaceMember } from './host-config'
import { getConfirmSurface } from './confirm-surface'
import { getChooserSurface } from './chooser-surface'
import { getContextMenuSurface } from './context-menu-surface'
import { getPopoverSurface } from './popover-surface'
import { getOverlaySite } from './overlay-site'
import type { DaemonConfig } from '../../../shared/daemon-api'
import { themeControl } from './theme-store'
import { tokenDiagnostics } from './token-registration'
import { componentSetControl } from './active-set-store'

/** The engine surface the broker brokers. Same-renderer it is `window.main.engine`. */
export interface EngineBridge {
  read(request: ReadRequest): Promise<EngineReadResult>
  subscribe(request: SubscribeRequest, onEvent: (event: SubscriptionEvent) => void): () => void
}

/**
 * A same-renderer transport. `send` drives the broker directly; replies arrive
 * through the handler registered in `receive`. The adapter mints ids/channels
 * and may send an `unsubscribe` before its `subscribe` is processed, so the
 * broker tolerates a dead channel (no-op the late subscribe).
 */
function createInProcessTransport(engine: EngineBridge): HostTransport {
  let onMessage: ((message: HostToProjection) => void) | null = null
  const channels = new Map<number, () => void>()
  const deadBeforeSubscribe = new Set<number>()

  return {
    send(message: ProjectionToHost) {
      switch (message.kind) {
        case 'read': {
          // window.main.engine.read surfaces failures as ok:false results, never rejects.
          void engine.read(message.request).then((result) => {
            onMessage?.({ kind: 'read-result', id: message.id, result })
          })
          return
        }
        case 'subscribe': {
          if (deadBeforeSubscribe.delete(message.channel)) return // unsubscribe raced ahead; stay dead.
          const unsubscribe = engine.subscribe(message.request, (event) => {
            onMessage?.({ kind: 'event', channel: message.channel, event })
          })
          channels.set(message.channel, unsubscribe)
          return
        }
        case 'unsubscribe': {
          const unsubscribe = channels.get(message.channel)
          if (unsubscribe) {
            channels.delete(message.channel)
            unsubscribe()
          } else {
            deadBeforeSubscribe.add(message.channel) // subscribe not processed yet; mark it dead.
          }
          return
        }
      }
    },
    receive(handler) {
      onMessage = handler
      return () => {
        if (onMessage === handler) onMessage = null
      }
    },
  }
}

/**
 * Named inputs for assembling a `MountHost`. The authority's window supplies direct channels and
 * capabilities; a secondary surface supplies proxies. Both builders name their inputs explicitly
 * so adding a field does not depend on positional argument order.
 */
export interface MountHostOptions {
  // --- Common / per-window: owner-sourced, same SHAPE in both windows. ---
  entryPath: string
  engineReady: EngineReadiness
  members: WorkspaceMember[]
  viewState: MountHost['viewState']
  preview?: PreviewSurface
  listProjections?: () => string[]
  describeProjections?: () => ProjectionDescriptor[]
  viewerDefaults?: () => { opens: string; viewer: string }[]
  slotDefaults?: () => string | undefined

  // --- Per-record. ---
  config?: OpaqueConfig
  instanceId?: string
  windowRoot?: boolean
  viewStore?: ViewStore
  terminal?: TerminalChannel
  openSurfaces?: OpenSurfaces

  // --- CO-LOCATION channels: DIRECT (authority) vs PROXIED (surface). ---
  children: MountHost['children'] // real pool + portalActive vs proxied pool + portalActive:false
  intent?: IntentChannel // authority.intentTree (sync claim) vs `intent-fired` events (async remote candidate)
  focus?: FocusChannel // authority.focusTree vs coalesced `focus` events
  closeGuard?: CloseGuardChannel // authority.closeGuardTree (local gather) vs a proxied remote-guard stub
  selection: SelectionChannel // authority.selectionTree vs coalesced `selection-published` events
  saveConfig?: (next: OpaqueConfig) => void // direct `mergeRecord` sink vs `config-changed` event
  onOwnConfigChange?: (cb: (config: OpaqueConfig) => void) => () => void // authority inbound-handler vs the surface's local record.inbound

  // --- CO-LOCATION capabilities: REAL (authority) vs STUB/absent (surface). ---
  daemon: DaemonControl
  mcp: McpControl
  commitComposition?: (next: OpaqueConfig) => Promise<CompositionCommit>
  compositionEdit?: CompositionEditControl
  keymaps?: KeymapsControl
  listContributions?: (role: string) => ChromeContribution[]
  subscribeContributions?: (listener: () => void) => () => void
}

/**
 * Build an in-renderer `MountHost` bound to an entry, from a `MountHostOptions` binding. The body reads its
 * inputs from the destructured `o` below, so the co-location difference lives ENTIRELY in which values a
 * caller puts in the binding — one assembly path, two bindings (direct / proxied).
 */
export function createInProcessMountHost(o: MountHostOptions): HostApp {
  const {
    entryPath, children, viewState, selection, daemon, mcp, engineReady, members, config, saveConfig,
    commitComposition, intent, focus, closeGuard, windowRoot, viewStore, terminal, instanceId, preview, listProjections,
    listContributions, subscribeContributions, describeProjections, compositionEdit, keymaps, viewerDefaults,
    slotDefaults, onOwnConfigChange, openSurfaces,
  } = o
  // A no-op intent channel when a caller didn't supply one (keeps the contract
  // `intent` total). Every real mount routes through the composition runtime, which provides it.
  const intentChannel: IntentChannel = intent ?? { fire: () => false, handle: () => () => {} }
  // Likewise a no-op focus channel — every real mount supplies the runtime's.
  const focusChannel: FocusChannel = focus ?? { report: () => {} }
  // A no-op slot when none supplied (e.g. the composition root, no restorable view-state).
  const viewStoreSlot: ViewStore = viewStore ?? { get: () => undefined, set: () => {} }
  // A no-op terminal channel when none supplied (the root has no pty).
  const noopSession = {
    onData: () => () => {},
    onExit: () => () => {},
    write: () => {},
    resize: () => {},
    send: () => {},
    cwd: () => Promise.resolve(undefined),
    detach: () => {},
    close: () => {},
  }
  const terminalChannel: TerminalChannel = terminal ?? { attach: () => noopSession }
  // A no-op preview surface when none supplied (keeps the contract `preview` total). Every real
  // window passes the shared per-window singleton; a projection's hovers no-op without it.
  const previewSurface: PreviewSurface =
    preview ?? { show: () => {}, hide: () => {}, isOver: () => false, isShowing: () => false }
  const transport = createInProcessTransport({
    read: (request) => window.main.engine.read(entryPath, request),
    subscribe: (request, onEvent) => window.main.engine.subscribe(entryPath, request, onEvent),
  })
  // Pass contract capabilities through `MountHostInfo` to `createMountHost`.
  // Compose app-owned capabilities onto the resulting host separately.
  const info: MountHostInfo = {
    contractVersion: MOUNT_CONTRACT_VERSION,
    entry: { path: entryPath },
    children,
    viewState,
    config,
    saveConfig: stampingSaveConfig(config, saveConfig),
    // The inbound mirror of saveConfig. ABSENT when the caller supplies none (a root, or an id-less
    // mount with no pool), so a projection that guards `host.onOwnConfigChange?.(cb)` gets the
    // remount fallback — never a present-but-inert stub masquerading as a working capability.
    ...(onOwnConfigChange ? { onOwnConfigChange } : {}),
    files: createFilesControl(entryPath),
    // `pickFolder` is a CONTRACT capability now (optional on `MountHost`), not only reachable
    // through the app-owned `workspaceEdit`. Same underlying bridge call, one honest home.
    workspace: { members, pickFolder: () => window.main.workspace.pickFolder() },
    // Launcher recents (the local per-machine store) as a CONTRACT read, so a projection (the rail's
    // workspace switcher) lists workspaces without reaching the app's private bridge.
    recents: { listWorkspaces: () => window.main.recents.listWorkspaces() },
    // Engine assets as loadable URLs, scoped to this entry, so a projection renders an image reference
    // without reaching the app's private bridge or resolving paths itself.
    assets: { url: (fileRef) => window.main.assets.url(entryPath, fileRef) },
    selection,
    intent: intentChannel,
    focus: focusChannel,
    // Pass through the caller's close-guard capability when available. A projection checks it before
    // registering; absence means this mount has no removal lifecycle. Secondary surfaces supply a proxy.
    ...(closeGuard ? { closeGuard } : {}),
    viewStore: viewStoreSlot,
    instanceId,
    terminal: terminalChannel,
    listContributions: listContributions ?? (() => []),
    listProjections: listProjections ?? (() => []),
    // Left ABSENT when the caller supplies none, deliberately — an optional contract member that is
    // present-but-empty is indistinguishable from a host that implements it and found nothing.
    ...(describeProjections ? { describeProjections } : {}),
    // Same present-or-absent discipline as `describeProjections`: an optional contract member left
    // ABSENT when the caller supplies none, so present-but-empty never masquerades as unimplemented.
    ...(viewerDefaults ? { viewerDefaults } : {}),
    ...(slotDefaults ? { slotDefaults } : {}),
    subscribeContributions: subscribeContributions ?? (() => () => {}),
    preview: previewSurface,
    // The per-window overlay site is a module singleton that owns its root. Host surfaces and
    // projections claim layers through it whenever content must draw above the composition.
    overlay: getOverlaySite(),
    // OPEN SURFACES — the per-node capability minted by the composition runtime (`setContent` bound to
    // this node's publisher; the reads host-wide). Present-or-absent, like `describeProjections`: a
    // caller that supplies none leaves it absent rather than a present-but-inert stub.
    ...(openSurfaces ? { openSurfaces } : {}),
    // The right-click MENU, built over that same site (it claims a `dropdown` layer) — so this file
    // hands a projection two capabilities that share one owner of the document. A per-window
    // singleton like `theme` / `tokens` / `components`, and NOT installed as a no-op when absent:
    // an optional member that is present-but-inert is indistinguishable from a working one, which
    // is the trap `describeProjections` above already avoids.
    contextMenu: getContextMenuSurface(getOverlaySite()),
    projections: projectionReload,
    // The interactive anchored POPOVER, built over that same site (it claims a `dropdown` layer,
    // beside the context menu). A per-window singleton like `contextMenu`, and NOT installed as a
    // no-op when absent: a present-but-inert optional member is indistinguishable from a working one.
    popover: getPopoverSurface(getOverlaySite()),
    // The app-global per-machine theme layer — a module singleton, same instance for every
    // node (a theme is app-wide `:root`, not per pane). The theming pane reads/saves through it.
    theme: themeControl,
    // The host's TOKEN REGISTRATION report — a module singleton like `theme`, because token
    // registration is a document-wide fact, not a per-pane one. The host DETECTS (it is the side
    // that loads the sheets and holds their source text); a projection only renders. See
    // token-registration.ts for why a projection cannot derive this itself.
    tokens: tokenDiagnostics,
    // The app-global per-machine component-set selection — same singleton shape as `theme`. The
    // components picker (gallery chips) reads/persists through it; applied on reload (boot-swap).
    components: componentSetControl,
  }
  return {
    ...createMountHost(transport, info),
    daemon,
    mcp,
    shell: shellControl,
    workspaceEdit: createWorkspaceControl(entryPath),
    scope: createScopeControl(entryPath),
    // App-owned terminal appearance and behavior preferences, backed by main through the preload bridge.
    terminalPreferences: window.main.terminalPreferences,
    windows: windowControl,
    confirm: getConfirmSurface(),
    chooser: getChooserSurface(),
    engineReady,
    commitComposition,
    compositionEdit,
    keymaps,
    windowRoot,
  } as HostApp
}

// App-global host instances. Not entry-bound (each call carries its own entry, or none),
// so it's a module singleton like shellControl. `open` focuses-or-spawns a workspace's instance;
// `newWorkspace` spawns a fresh instance at the gate.
const windowControl: WindowControl = {
  open: (entry) => window.main.windows.open(entry),
  newWorkspace: () => window.main.windows.newWorkspace(),
}

// App-global host → OS shell. Not entry-bound (absolute paths), so it's a
// module singleton shared by every minted host, no threading through the composition runtime.
const shellControl: ShellControl = {
  showItemInFolder: (path) => window.main.shell.showItemInFolder(path),
  openPath: (path) => window.main.shell.openPath(path),
  openExternal: (url) => window.main.shell.openExternal(url),
}

// App-global workspace editing. Add/remove a local member; mounts live. A
// module singleton, like shellControl.
function createWorkspaceControl(entryPath: string): WorkspaceControl {
  return {
    addMember: (wsRoot, member) => window.main.workspace.addMember(wsRoot, member),
    removeMember: (wsRoot, name) => window.main.workspace.removeMember(wsRoot, name),
    setMemberRole: (wsRoot, name, role) => window.main.workspace.setMemberRole(wsRoot, name, role),
    setMemberDisabled: (wsRoot, name, disabled) => window.main.workspace.setMemberDisabled(wsRoot, name, disabled),
    declarePeer: (memberRoot, memberName, peerName, remote) => window.main.workspace.declarePeer(memberRoot, memberName, peerName, remote),
    scaffoldRegistry: (memberRoot, memberName) => window.main.workspace.scaffoldRegistry(memberRoot, memberName),
    pickFolder: () => window.main.workspace.pickFolder(),
    // register + deviceConfig are DAEMON ops, keyed by this host's entry.
    register: (name, path, remote) => window.main.engine.register(entryPath, name, path, remote),
    deviceConfig: () => window.main.engine.deviceConfig(entryPath),
  }
}

/**
 * Wrap a projection's `saveConfig` so every emitted config is a COMPLETE instance
 * (an instance IS a config-with-`type`). The host stamps the NODE's known
 * type (from the mount `config`) onto whatever the projection emits — projections
 * own their fields, the composition owns the type. So `onChildConfigChange` consumers
 * always receive a valid instance and never re-stamp the discriminant themselves.
 *
 * A config save must NOT change a projection's type — that's a re-mount, a parent
 * gesture, never a save. So a child emitting a DIFFERENT type is kept at the node's
 * type and surfaced as a warning (a sign the projection is misbehaving).
 *
 * "Different" is by cross-repo IDENTITY (bare name), not string equality: a projection
 * that emits a bare `tabs` under a `tabs::tabs` node is the SAME type, just unqualified
 * (workspace-unique names) — not a type change, so it must NOT warn. Only a genuinely
 * different bare name is a misbehaving type change. The qualified node type is
 * always stamped, so the SAVE stays engine-valid either way.
 *
 * STAND-IN: this belongs in the SDK's `createMountHost` (the contract should
 * guarantee complete instances centrally). Host-local.
 */
function stampingSaveConfig(
  config: OpaqueConfig | undefined,
  saveConfig: ((next: OpaqueConfig) => void) | undefined,
): (next: OpaqueConfig) => void {
  const sink = saveConfig ?? ((): void => {})
  const declared = (config as { type?: unknown } | undefined)?.type
  // A `type` claim can be a list. Its first claim identifies the mounted projection; the remaining
  // claims are record-level mixins. Stamp the projection identity and preserve fields contributed by
  // those mixins, just as for a single claim.
  const knownType = typeof declared === 'string' ? declared : Array.isArray(declared) && typeof declared[0] === 'string' ? (declared[0] as string) : undefined
  // No node type at all (a config-less mount) — nothing to stamp against, pass through.
  if (knownType === undefined) return sink
  return (next: OpaqueConfig): void => {
    if (next === null || typeof next !== 'object') {
      // A non-object config can't carry a type; nothing to stamp.
      sink(next)
      return
    }
    const emitted = (next as { type?: unknown }).type
    // Compare by IDENTITY (bare name), so a bare `tabs` under a `tabs::tabs` node is NOT
    // flagged (same type, just unqualified) — only a genuinely different bare name warns.
    if (typeof emitted === 'string' && refName(emitted) !== refName(knownType)) {
      reportHostDiagnostic({
        code: 'config-type-mismatch',
        severity: 'warning',
        subject: knownType,
        message: `saveConfig emitted type "${emitted}" but its node is "${knownType}" — keeping "${knownType}". Changing a projection's type is a re-mount, not a config save.`,
        detail: { emitted, knownType },
      })
    }

    // OWNERSHIP. The projection owns its own effective shape; the host guarantees everything else
    // on the instance it was handed. See config-ownership.ts.
    const owned = ownedFieldsOf(knownType)
    if (owned === undefined) {
      // UNKNOWN SHAPE — no discovery pass yet, or a type-def that is not discoverable. Stated
      // explicitly rather than left to fall out of the code: carry EVERYTHING the projection
      // emitted. It cannot compute a boundary, so it must not enforce one, and a pass-through can
      // never destroy what the projection kept.
      sink({ ...(next as object), type: declared } as OpaqueConfig)
      return
    }
    const body = next as Record<string, unknown>
    const dropped = droppedOwnFields(config, body, owned)
    if (dropped.length > 0) {
      // NOT corrected. Omission of an OWN field legitimately means removal — that is why the host
      // trusts a projection with its own shape. But an honest mistake looks identical to a
      // deliberate removal here, so it is surfaced rather than silently accepted.
      reportHostDiagnostic({
        code: 'config-own-field-dropped',
        severity: 'warning',
        subject: knownType,
        message: `saveConfig for "${knownType}" omitted ${dropped.length} field(s) it owns and was handed: ${dropped.join(', ')}. Treated as removal. If that was not intended, the projection is rebuilding its config from a model that does not carry them.`,
        detail: { knownType, dropped },
      })
    }
    // `type` is re-stamped from the DECLARED form, so a mixin list survives intact.
    sink({ ...mergeOwned(config, body, owned), type: declared } as OpaqueConfig)
  }
}

/**
 * Build the file capability STAND-IN, bound to this host's entry. Unlike
 * `daemon`/`engineReady` (which need the live config and a shared poll), `files`
 * needs only the entry path the host already has, so it is built here rather than
 * threaded through the composition runtime. Delegates to `window.main.files`; the
 * projection never sees `window.main`. In main, the whole capability is engine-
 * backed: read/exists via the `content` read, write/delete via the governed
 * member-aware mutation channel (SDK `mutate`). No raw fs.
 *
 * Returns the contract `FilesControl`: the read-before-write guard is now part of
 * it (v5) — `read` surfaces the read-time `hash`, `write`/`delete` forward an
 * `expectedHash` and return `version`/`hash`/`conflict`. A guard-aware projection
 * (the editor) reads the hash off the contract result directly; no cast.
 */
export function createFilesControl(entryPath: string): FilesControl {
  return {
    read: (filePath) => window.main.files.read(entryPath, filePath),
    write: (filePath, content, expectedHash) =>
      window.main.files.write(entryPath, filePath, content, expectedHash),
    exists: (filePath) => window.main.files.exists(entryPath, filePath),
    delete: (filePath, expectedHash) => window.main.files.delete(entryPath, filePath, expectedHash),
    rename: (from, to) => window.main.files.rename(entryPath, from, to),
  }
}

/**
 * Entry-bound scope control. Delegates the `set_ignores`
 * mutation to `window.main.scope`; the projection never sees `window.main`. The
 * READ side (`ignores`) rides the contract's `engine` surface, so it is not here.
 */
export function createScopeControl(entryPath: string): ScopeControl {
  return {
    setIgnores: (root, patterns) => window.main.scope.setIgnores(entryPath, root, patterns),
  }
}

/**
 * Build the daemon-lifecycle STAND-IN, bound to the active config via a live
 * getter so it tracks config edits without a rebuild. Delegates to the
 * already-exposed `window.main.daemon`; the projection never sees `window.main`.
 */
export function createDaemonControl(
  getConfig: () => DaemonConfig,
  setTrace: (on: boolean) => void,
): DaemonControl {
  return {
    get config() {
      return getConfig()
    },
    // `start` reads the config LIVE per call, so a trace flag set here is picked up by the next
    // spawn with no IPC change: the flag rides the same config object that already crosses.
    status: () => window.main.daemon.status(getConfig()),
    start: () => window.main.daemon.start(getConfig()),
    stop: () => window.main.daemon.stop(getConfig()),
    setTrace,
    onLog: (listener) => window.main.daemon.onLog(listener),
    onExit: (listener) => window.main.daemon.onExit(listener),
  }
}

/** The mcp-daemon control, bound to the active workspace (the config's entry path). */
export function createMcpControl(getConfig: () => DaemonConfig): McpControl {
  return {
    // Per-machine tool locations (paths.yaml): node / au-mcp CLI + the `binaries` agent-binary
    // overrides. Adapters are DISCOVERED typed nodes
    // (`listAdapters`), each with its dir + bins from the `mcp.adapter` subtype's `source.file` + meta.
    toolPaths: () => window.main.mcp.toolPaths(),
    saveToolPaths: (patch) => window.main.mcp.saveToolPaths(patch),
    pathExists: (path) => window.main.mcp.pathExists(path),
    status: () => window.main.mcp.status(getConfig().entryPath),
    start: () => window.main.mcp.start(getConfig().entryPath),
    stop: () => window.main.mcp.stop(getConfig().entryPath),
    onLog: (listener) => window.main.mcp.onLog(listener),
    onExit: (listener) => window.main.mcp.onExit(listener),
    listAdapters: () => window.main.mcp.listAdapters(getConfig().entryPath),
    skillManifest: (adapter) => window.main.mcp.skillManifest(getConfig().entryPath, adapter),
    injectManifest: (adapter) => window.main.mcp.injectManifest(getConfig().entryPath, adapter),
    saveProfile: (name, data) => window.main.mcp.saveProfile(getConfig().entryPath, name, data),
    listProfiles: () => window.main.mcp.listProfiles(getConfig().entryPath),
    deleteProfile: (name, filePath) => window.main.mcp.deleteProfile(getConfig().entryPath, name, filePath),
    listDormant: () => window.main.mcp.listDormant(getConfig().entryPath),
    retentionPreview: (windowMs) => window.main.mcp.retentionPreview(getConfig().entryPath, windowMs),
    retentionConfig: () => window.main.mcp.retentionConfig(getConfig().entryPath),
    setRetentionWindow: (windowDays) => window.main.mcp.setRetentionWindow(getConfig().entryPath, windowDays),
    retireSession: (session) => window.main.mcp.retireSession(getConfig().entryPath, session),
  }
}

