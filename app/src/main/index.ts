import { resolveProjectionSource, watchProjectionBuild, releaseProjectionSources } from './projection-builds'
import { resumeSelection } from './resume-selection'
import { orderedShutdown } from './ordered-shutdown'
import { readTerminalPreferences, saveTerminalPreferences } from './terminal-preferences'
import type { TerminalAttachOptions } from '@arsumbris/au-host-sdk'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, shell, protocol } from 'electron'
import { installApplicationMenu } from './app-menu'

import { DaemonSupervisor } from './daemon'
import { McpSupervisor } from './mcp'
import { deleteProfile, listProfiles, saveProfile } from './profiles'
import { skillManifest } from './skills'
import { injectManifest } from './inject'
import { launchAgent } from './agent-launch'
import { listAdapters, selectAdapter } from './adapter-discovery'
import { listDormant, retentionConfig, retentionPreview, retireSession, setRetentionWindow } from './retention'
import { loadToolPaths, saveToolPaths, ensurePathsFile } from './tool-paths'
import { SurfaceWindows } from './surface-windows'
import { macFrameOptions, reassertTrafficLights } from './window-frame'
import { EngineConnections } from './engine-connections'
import { HostBridge } from './host-bridge'
import { InstancePresence, focusExistingInstance, spawnInstance } from './instance-socket'
import { inspectGate } from './gate-inspect'
import { createWorkspace, discoverClosure, locateMembers, missingLocations, scaffoldEntry, scanFor } from './gate-create'
import { discoverWorkspaceTemplates, materializeWorkspace } from './workspace-templates'
import {hostConfigDir as templateHostConfigDir, engineConfigDir as templateEngineConfigDir} from './device-paths'
import type {MaterializeWorkspaceRequest} from '@arsumbris/au-host-sdk'
import { TerminalSessions } from './terminal'
import { addMember, declarePeer, removeMember, scaffoldRegistry, setMemberDisabled, setMemberRole } from './workspace-edit'
import { listCompositions, listWorkspaces, touchComposition, touchWorkspace } from './host-recents'
import { ViewStateStore } from './view-state-store'
import {
  installProjectionProtocol,
  projectionScheme,
  registerSource,
  unregisterSource,
} from './projection-sources'
import { installAssetProtocol, registerAsset, assetScheme, artifactScheme } from './asset-sources'
import { installSharedProtocol, sharedScheme } from './shared-deps-sources'
import { installRendererCsp } from './csp'
import type { AgentProfileData, DaemonConfig, FoundDep, SurfaceCommand, SurfaceOpenRequest, ThemeSyncState, ToolPathsPatch, TouchWorkspace, WorkspaceMemberListRole } from '../shared/daemon-api'
import type { ReadRequest, SubscribeRequest } from '@arsumbris/au-engine-sdk'
import type { HostCommand, HostResult } from '@arsumbris/au-host-sdk'

// KNOWN-BENIGN macOS/libuv teardown race, last-resort belt. A supervised child's (daemon / au-mcp) stdio
// pipe can deliver a POSITIVE `nread` to `Pipe.onStreamRead`, which builds an `ErrnoException` from it and
// throws `ERR_OUT_OF_RANGE` out of a libuv callback — UNCATCHABLE via a stream 'error' handler (the throw is
// in constructing the error). The supervisors detach their stdio before an app-INITIATED kill (see
// `detachStdio`), which covers the normal teardown; a child that dies on its OWN can still race that read.
// Swallow ONLY this exact fault (log it); re-throw everything else so real crashes still surface + exit.
process.on('uncaughtException', (err) => {
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'ERR_OUT_OF_RANGE' && /onStreamRead/.test(e.stack ?? '')) {
    console.warn('[main] ignored a benign child-stdio pipe-teardown read fault:', e.message)
    return
  }
  throw err
})

const supervisor = new DaemonSupervisor()
const mcp = new McpSupervisor()
const viewState = new ViewStateStore()
const connections = new EngineConnections()
const surfaces = new SurfaceWindows()
const terminals = new TerminalSessions()

// The host's main BrowserWindow — the renderer that owns the live composition and
// executes agent-host transport commands. Set in createWindow; the transport routes
// commands to it (a secondary surface is not a second command target).
let mainWindow: BrowserWindow | null = null

// This instance's presence socket, bound while a workspace is open (see the hostbridge lifecycle
// below). A `focus` request from another instance raises this window — `windows.open` on an
// already-open workspace routes here instead of spawning a duplicate.
const instancePresence = new InstancePresence(() => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

// The agent-host transport server. Its handler round-trips each socket command to
// the renderer and awaits the reply: main mints an internal correlation id, sends
// the command to `mainWindow`, matches the `hostbridge:command-reply` by id, and
// returns the result to the socket client. A missing / not-ready renderer rejects
// cleanly (the bridge turns it into an `ok: false` socket frame); a stuck renderer
// times out so a pending command never leaks.
const HOST_COMMAND_TIMEOUT_MS = 10_000
let hostCmdSeq = 0
const pendingHostCmds = new Map<number, { resolve: (r: HostResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
const rendererHostCommand = (command: HostCommand): Promise<HostResult> =>
  new Promise<HostResult>((resolve, reject) => {
    const window = mainWindow
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      reject(new Error('no host renderer is ready to execute commands'))
      return
    }
    const id = ++hostCmdSeq
    const timer = setTimeout(() => {
      pendingHostCmds.delete(id)
      reject(new Error('host command timed out'))
    }, HOST_COMMAND_TIMEOUT_MS)
    pendingHostCmds.set(id, { resolve, reject, timer })
    window.webContents.send('hostbridge:command', { id, command })
  })
const hostBridge = new HostBridge(rendererHostCommand)

// Electron accepts privileged scheme registration only once, before ready.
protocol.registerSchemesAsPrivileged([projectionScheme, assetScheme, artifactScheme, sharedScheme])

/**
 * Navigation lockdown: the privileged renderer holds the full `frame`
 * capability surface, so it must never leave its own entry. Only the dev renderer URL, the
 * packaged `file://` renderer, and `au-projection://` assets may load. Every other navigation
 * or redirect is blocked; `window.open` is denied (an external `http(s)` target opens in the
 * system browser instead). Applied to EVERY web-contents — main and surface.
 */
function isAllowedNavigation(target: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev && (target === dev || target.startsWith(dev.replace(/\/+$/, '') + '/'))) return true
  if (target.startsWith('file://')) return true
  if (target.startsWith('au-projection://')) return true
  return false
}

const devLaneLabel = !app.isPackaged ? process.env.AU_DEV_LABEL?.trim() : undefined
const devLaneBadge = !app.isPackaged ? process.env.AU_DEV_BADGE?.trim() : undefined

function createWindow(): void {
  const window = new BrowserWindow({
    // Sized for a three-region shell (rail | content | rail); the centre is unusably narrow at 1100.
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: devLaneLabel ? `AU · ${devLaneLabel}` : 'au-host',
    // Dark native background so there is no white flash before the renderer paints. On macOS it is fully
    // transparent so the window's `vibrancy` material shows through beneath the theme-controlled chrome.
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#000000',
    // macOS: hide the title bar but KEEP the traffic lights in the shell's reserved gap (shared with every
    // floated surface, so windows are framed identically). Windows/Linux keep their native frame.
    ...macFrameOptions(),
    // E2E: create the window HIDDEN (never shown, never focus-stealing) so a Playwright run does not take
    // over the developer's screen. The renderer still runs in real Chromium with full layout — Playwright
    // drives it over CDP, so rendering, CSS, `:hover` and clicks all behave truthfully off-screen. Test-only.
    ...(process.env.AU_E2E_OFFSCREEN ? { show: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
      // Set the option explicitly rather than relying on Electron's default.
      sandbox: true,
    },
  })

  if (devLaneLabel) {
    window.on('page-title-updated', (event) => {
      event.preventDefault()
      window.setTitle(`AU · ${devLaneLabel}`)
    })
  }

  mainWindow = window
  reassertTrafficLights(window)
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // Guard against a destroyed renderer: a daemon/mcp child keeps emitting log + exit lines during and
  // after window teardown (the child outlives the window), so an unguarded `send` on a closing window
  // throws "Object has been destroyed" from the async socket callback and crashes the main process.
  const safeSend = (channel: string, ...args: unknown[]): void => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send(channel, ...args)
  }
  supervisor.onLog = (line) => safeSend('daemon:log', line)
  supervisor.onExit = (code, entryPath) => safeSend('daemon:exit', code, entryPath)
  mcp.onLog = (line) => safeSend('mcp:log', line)
  mcp.onExit = (code) => safeSend('mcp:exit', code)

  // EVENT-SUBSTRATE DEV TOGGLE via env, so a category is on from the FIRST frame — no reload dance.
  // `AU_HOST_EVENTS=portal` (or `*`, or `a,b`) turns those categories on AND the console mirror; the
  // renderer substrate reads it from `?au-events=` in `location.search` (the same query toggle it already
  // honours), so this needs no renderer plumbing. Relaunch to change it. Off when the var is unset.
  const eventsToggle = process.env['AU_HOST_EVENTS']
  const eventsQuery: Record<string, string> = eventsToggle
    ? { 'au-events': eventsToggle, 'au-events-mirror': '1' }
    : {}
  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    for (const [k, v] of Object.entries(eventsQuery)) url.searchParams.set(k, v)
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), { query: eventsQuery })
  }
}

void app.whenReady().then(() => {
  if (devLaneBadge) app.dock?.setBadge(devLaneBadge)
  installApplicationMenu()

  // Unpackaged macOS builds need an explicit Dock icon; packaged apps use their bundle icon.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const iconPath = path.join(__dirname, '../../build/icon.png')
    if (fs.existsSync(iconPath)) app.dock?.setIcon(iconPath)
  }

  // The workspace entry this instance was launched to open (set by `windows.open` when it spawns
  // a new instance). A plain launch has none, so the renderer falls back to the recents pre-fill.
  ipcMain.handle('app:initial-entry', () => process.env['AU_ENTRY'] ?? null)

  ipcMain.handle('daemon:status', (_event, config: DaemonConfig) => supervisor.status(config))
  ipcMain.handle('daemon:start', (_event, config: DaemonConfig) => supervisor.start(config))
  ipcMain.handle('daemon:stop', (_event, config: DaemonConfig) => supervisor.stop(config))

  // au-mcp daemon supervision (the agent-tools broker, keyed on the workspace root).
  ipcMain.handle('mcp:status', (_event, workspace: string) => mcp.status(workspace))
  ipcMain.handle('mcp:start', (_event, workspace: string) => {
    const { paths } = loadToolPaths()
    if (!paths.auMcp) {
      return { ok: false as const, error: 'au-mcp CLI path is not set — set it in paths.yaml (open config from the mcp panel)' }
    }
    return mcp.start({ node: paths.node, nodeArgs: paths.nodeArgs, cliPath: paths.auMcp, workspace })
  })
  ipcMain.handle('mcp:stop', (_event, workspace: string) => mcp.stop(workspace))
  // Read the skills/injects discovery MANIFEST for the launch picker (`--manifest`); the actual
  // materialization happens inside `launch` below. stderr rides the mcp:log channel.
  // The manifest reads + launch are ADAPTER-SCOPED (which adapter's bins to run). The adapter is
  // resolved main-side over the discovered `mcp.adapter` set (count rule): `opts.adapter` names one,
  // else the single discovered adapter is used. A manifest with no resolvable adapter degrades to
  // empty (the picker shows none); a launch surfaces the resolution error.
  // Resolve the adapter to launch/scope with, SAFELY: a connect failure (daemon unreachable) is
  // caught and returned as `{ ok: false }` rather than rejecting — `wireReader` (unlike `read`) does
  // not swallow a dead connection, and the manifest reads must keep their degrade-to-empty contract.
  const resolveAdapterSafe = async (workspace: string, adapter?: string) => {
    try {
      return await selectAdapter(await connections.wireReader(workspace), adapter)
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  }
  ipcMain.handle('mcp:skill-manifest', async (event, workspace: string, adapter?: string) => {
    const sel = await resolveAdapterSafe(workspace, adapter)
    if (!sel.ok) return { skills: [], skipped: [] }
    return skillManifest(workspace, sel.adapter, (line) => event.sender.send('mcp:log', line))
  })
  ipcMain.handle('mcp:inject-manifest', async (event, workspace: string, adapter?: string) => {
    const sel = await resolveAdapterSafe(workspace, adapter)
    if (!sel.ok) return { injects: [], skipped: [] }
    return injectManifest(workspace, sel.adapter, (line) => event.sender.send('mcp:log', line))
  })
  // The discovered, launchable adapter set — for the launch picker (count rule lives in the caller).
  // A connect failure degrades to an empty set (the picker shows none), never a rejected promise.
  ipcMain.handle('mcp:list-adapters', async (_event, workspace: string) => {
    try {
      return await listAdapters(await connections.wireReader(workspace))
    } catch {
      return []
    }
  })
  // Build a ready agent launch via the resolved adapter's `launch.ts` — the launcher owns the whole
  // `AU_MCP_*` env (session handle, tool/native-tool allowlists, materialized skill+inject dirs),
  // so the renderer delegates command construction to it. stderr rides the mcp:log surface.
  ipcMain.handle(
    'mcp:launch',
    async (event, workspace: string, opts: { resumeSession?: string; skills?: string[]; inject?: string[]; tools?: string[]; nativeTools?: string[]; profile?: string; adapter?: string }) => {
      let launchOptions: Parameters<typeof launchAgent>[1] = opts
      let adapter = opts.adapter
      if (opts.resumeSession !== undefined) {
        const result = await listDormant(workspace)
        if (!result.ok) return result
        try {
          const selected = resumeSelection(result.sessions, opts.resumeSession)
          adapter = selected.adapter
          launchOptions = selected.options
        } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) } }
      }
      const sel = await resolveAdapterSafe(workspace, adapter)
      if (!sel.ok) return { ok: false as const, error: sel.error }
      return launchAgent(workspace, launchOptions, sel.adapter, (line) => event.sender.send('mcp:log', line))
    },
  )
  // Session retention: control-plane reads/writes over the au-mcp daemon socket (host/user authority).
  ipcMain.handle('mcp:list-dormant', (_event, workspace: string) => listDormant(workspace))
  ipcMain.handle('mcp:retention-preview', (_event, workspace: string, windowMs: number) => retentionPreview(workspace, windowMs))
  ipcMain.handle('mcp:retention-config', (_event, workspace: string) => retentionConfig(workspace))
  ipcMain.handle('mcp:set-retention-window', (_event, workspace: string, windowDays: number) => setRetentionWindow(workspace, windowDays))
  ipcMain.handle('mcp:retire-session', (_event, workspace: string, session: string) => retireSession(workspace, session))
  ipcMain.handle('mcp:save-profile', (_event, workspace: string, name: string, data: Omit<AgentProfileData, 'name'>) =>
    saveProfile(connections, workspace, name, data),
  )
  ipcMain.handle('mcp:list-profiles', (_event, workspace: string) => listProfiles(connections, workspace))
  ipcMain.handle(
    'mcp:delete-profile',
    (_event, workspace: string, name: string, filePath?: string) =>
      deleteProfile(connections, workspace, name, filePath),
  )

  // The agent-host transport socket, keyed on the workspace entry. The renderer
  // starts it once it enters a workspace (so the socket is up before au-mcp's
  // relay tools connect). `entry` is the workspace root / manifest path — the same
  // string the socket file name hashes, so au-mcp derives the path identically.
  ipcMain.handle('hostbridge:start', async (_event, entry: string) => {
    // The instance presence socket rides the same workspace-open lifecycle as the agent transport:
    // this instance is now serving `entry`, so announce it so a `windows.open` of the same workspace
    // focuses here rather than spawning a duplicate. A distinct socket, not the transport's.
    instancePresence.bind(entry).catch((err) => {
      console.warn(`[instance] could not bind presence socket for ${entry}: ${err instanceof Error ? err.message : String(err)}`)
    })
    try {
      await hostBridge.start(entry)
      return { ok: true as const, socket: hostBridge.boundSocket }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('hostbridge:stop', () => {
    hostBridge.stop()
    instancePresence.unbind()
  })

  // Open a workspace in its own host instance: focus the running instance for `entry` if one is
  // serving it, else spawn a new independent instance at that entry.
  ipcMain.handle('windows:open', async (_event, entry: string) => {
    const focused = await focusExistingInstance(entry)
    if (!focused) spawnInstance(entry)
    return { focused }
  })
  // Open a NEW host instance at the startup gate (no entry preselected) — the new-workspace flow.
  ipcMain.handle('windows:new', () => {
    spawnInstance(null)
  })
  // The renderer's reply to a forwarded command: settle the pending round-trip by id.
  // A reply carries either a `result` (success) or an `error` (the renderer's handler threw).
  ipcMain.on('hostbridge:command-reply', (event, msg: { id: number; result?: HostResult; error?: string }) => {
    // only the main window is ever sent a `hostbridge:command`, so only it may reply. The preload is
    // shared with secondary-surface renderers, so without this a surface could `send` a FORGED reply for a
    // guessed id and settle an agent round-trip with attacker-chosen data. Validate the sender
    // before accepting a result.
    if (event.sender !== mainWindow?.webContents) return
    const pending = pendingHostCmds.get(msg.id)
    if (!pending) return // already timed out / unknown id — drop it.
    pendingHostCmds.delete(msg.id)
    clearTimeout(pending.timer)
    if (msg.error !== undefined) pending.reject(new Error(msg.error))
    else if (msg.result !== undefined) pending.resolve(msg.result)
    else pending.reject(new Error('malformed command reply'))
  })
  ipcMain.handle('mcp:tool-paths', () => loadToolPaths())
  ipcMain.handle('mcp:save-tool-paths', (_event, patch: ToolPathsPatch) => saveToolPaths(patch))
  ipcMain.handle('mcp:path-exists', (_event, p: string) => {
    if (!p || !p.trim()) return false
    try {
      fs.accessSync(p)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('mcp:open-paths-file', async () => {
    await shell.openPath(ensurePathsFile())
  })

  // Host → OS shell: reveal a path in the OS file manager, or open it with the default app.
  // Absolute paths; used by projection context menus (e.g. the file-tree "open in Finder").
  ipcMain.handle('shell:show-item-in-folder', (_event, p: string) => {
    shell.showItemInFolder(p)
  })
  ipcMain.handle('shell:open-path', (_event, p: string) => shell.openPath(p))
  // Open an external URL in the default browser. Guarded to http/https so a malformed or
  // non-web scheme (file:, javascript:, …) can never reach the OS handler.
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  // Workspace editing: add / remove a LOCAL member of an existing workspace (manifest + location).
  // Mounts / un-mounts live — no daemon restart (verified). Raw fs, like gate-create.
  ipcMain.handle('workspace:add-member', (_event, wsRoot: string, member: { name: string; memberPath: string; role?: WorkspaceMemberListRole; description?: string }) => addMember(wsRoot, member))
  ipcMain.handle('workspace:remove-member', (_event, wsRoot: string, name: string) => removeMember(wsRoot, name))
  ipcMain.handle('workspace:set-member-role', (_event, wsRoot: string, name: string, role: WorkspaceMemberListRole) => setMemberRole(wsRoot, name, role))
  ipcMain.handle('workspace:set-member-disabled', (_event, wsRoot: string, name: string, disabled: boolean) => setMemberDisabled(wsRoot, name, disabled))
  ipcMain.handle('workspace:declare-peer', (_event, memberRoot: string, memberName: string, peerName: string, remote?: string) => declarePeer(memberRoot, memberName, peerName, remote))
  ipcMain.handle('workspace:scaffold-registry', (_event, memberRoot: string, memberName: string, description?: string) => scaffoldRegistry(memberRoot, memberName, description))

  // Host launcher recents (local, per-machine, non-git). Best-effort; never blocks startup.
  ipcMain.handle('recents:list-workspaces', () => listWorkspaces())
  ipcMain.handle('recents:touch-workspace', (_event, ws: TouchWorkspace) => touchWorkspace(ws))
  ipcMain.handle('recents:list-compositions', (_event, root: string) => listCompositions(root))
  ipcMain.handle('recents:touch-composition', (_event, root: string, compositionPath: string) => touchComposition(root, compositionPath))

  // The MAIN-owned view-state auto-store: `load` (hydrate a renderer's cache, invoke/async) + fire-and-forget
  // `set`/`prune`/`drop` (send; main coalesces the disk flush). One store, every window reads it — a floated
  // pane keeps its view-state because the key is its pool id, not the window.
  ipcMain.on('viewstate:load', (event, comp: string) => { event.returnValue = viewState.loadComposition(comp) }) // SYNC (sendSync): hydrate before the first pane's sync get.
  ipcMain.on('viewstate:load-node', (event, comp: string, node: string) => { event.returnValue = viewState.loadNode(comp, node) }) // SYNC: refresh ONE pane's slot on mount (a moved-in pane whose window cache is stale).
  ipcMain.on('viewstate:set', (_event, comp: string, node: string, sub: string, value: unknown) => viewState.set(comp, node, sub, value))
  ipcMain.on('viewstate:prune', (_event, comp: string, liveNodeIds: string[]) => viewState.prune(comp, liveNodeIds))
  ipcMain.on('viewstate:drop', (_event, comp: string) => viewState.drop(comp))
  // CROSS-WINDOW THEME SYNC: a window's theme change fans out to every OTHER window (main + surfaces), which
  // apply + persist it. Theme is app-global per-machine state; main is the one-authority relay hub. Excludes
  // the sender (it already applied locally), so there is no echo loop.
  ipcMain.on('theme:changed', (event, state: ThemeSyncState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const wc = win.webContents
      if (wc.id !== event.sender.id && !wc.isDestroyed()) wc.send('theme:apply', state)
    }
  })

  ipcMain.handle('engine:read', (_event, entryPath: string, request: ReadRequest) =>
    connections.read(entryPath, request),
  )

  ipcMain.handle('engine:register', (_event, entryPath: string, name: string, path: string, remote?: string) =>
    connections.register(entryPath, name, path, remote),
  )

  ipcMain.handle('engine:device-config', (_event, entryPath: string) => connections.readDeviceConfig(entryPath))

  // Subscriptions: the renderer correlates events by its own token. Tokens are
  // minted PER-RENDERER, so a surface window can reuse the main window's token
  // numbers — key the detach map by (sender, token), not the token alone.
  const subscriptionDetach = new Map<string, () => void>()
  const subKey = (senderId: number, token: number): string => `${senderId}:${token}`
  ipcMain.handle(
    'engine:subscribe',
    async (event, token: number, entryPath: string, request: SubscribeRequest) => {
      const sender = event.sender
      const detach = await connections.subscribe(entryPath, request, (subscriptionEvent) => {
        if (!sender.isDestroyed()) {
          sender.send('engine:subscription-event', { token, event: subscriptionEvent })
        }
      })
      subscriptionDetach.set(subKey(sender.id, token), detach)
    },
  )
  ipcMain.handle('engine:unsubscribe', (event, token: number) => {
    const key = subKey(event.sender.id, token)
    subscriptionDetach.get(key)?.()
    subscriptionDetach.delete(key)
  })

  // Engine-readiness watch: the renderer's engineReady subscribes to the
  // main-process managed connection's `connected` edge.
  // Routed by token so each watcher hears only its entry.
  // Keyed by (sender, token) for the same per-renderer-token reason as subscriptions.
  const readyWatchers = new Map<string, { token: number; entryPath: string; sender: Electron.WebContents }>()
  connections.onReadyChange = (entryPath, ready) => {
    for (const watcher of readyWatchers.values()) {
      if (watcher.entryPath === entryPath && !watcher.sender.isDestroyed()) {
        watcher.sender.send('engine:ready-change', { token: watcher.token, ready })
      }
    }
  }
  ipcMain.handle('engine:watch-ready', (event, token: number, entryPath: string) => {
    const sender = event.sender
    const key = subKey(sender.id, token)
    // Retain the entry's managed connection for the life of this watcher, so an entry with
    // no remaining watchers/subscriptions is evicted (no idle socket + reconnect storm).
    if (!readyWatchers.has(key)) connections.retainEntry(entryPath)
    readyWatchers.set(key, { token, entryPath, sender })
    // Seed the watcher with the current state (ensures the manager exists + connecting).
    const ready = connections.watchReady(entryPath)
    if (!sender.isDestroyed()) sender.send('engine:ready-change', { token, ready })
  })
  ipcMain.handle('engine:unwatch-ready', (event, token: number) => {
    const key = subKey(event.sender.id, token)
    const watcher = readyWatchers.get(key)
    if (watcher) {
      readyWatchers.delete(key)
      connections.releaseEntry(watcher.entryPath)
    }
  })

  // Trust boundary: every web-contents (main + surface) is locked to
  // its own entry, and on destroy its subscriptions / ready-watchers / terminal subscribers
  // are purged — a renderer that dies WITHOUT running its disposers must not leak them.
  app.on('web-contents-created', (_event, contents) => {
    const blockNav = (e: Electron.Event, url: string): void => {
      if (!isAllowedNavigation(url)) e.preventDefault()
    }
    contents.on('will-navigate', blockNav)
    contents.on('will-redirect', blockNav)
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.once('destroyed', () => {
      const prefix = `${contents.id}:`
      for (const [key, detach] of subscriptionDetach) {
        if (key.startsWith(prefix)) {
          detach() // also releases the entry refcount (subscribe's detach does both)
          subscriptionDetach.delete(key)
        }
      }
      for (const [key, watcher] of readyWatchers) {
        if (key.startsWith(prefix)) {
          readyWatchers.delete(key)
          connections.releaseEntry(watcher.entryPath)
        }
      }
      terminals.purgeSender(contents.id)
    })
  })
  ipcMain.handle('projection:register-source', (_event, key: string, directory: string) =>
    registerSource(key, directory),
  )
  ipcMain.handle('projection:unregister-source', (_event, key: string) => unregisterSource(key))
  const projectionDevelopment = process.env.AU_PROJECTION_DEV === '1'
  ipcMain.handle('projection:development', () => projectionDevelopment)
  const projectionOwners = new Set<number>()
  ipcMain.handle('projection:resolve-source', async (event, key: string, directory: string, entry: string, fromDisk: boolean) => {
    const owner = event.sender.id
    if (!projectionOwners.has(owner)) {
      projectionOwners.add(owner)
      event.sender.once('destroyed', () => {
        projectionOwners.delete(owner)
        void releaseProjectionSources(owner).catch(error => console.warn('Projection cache cleanup failed:', error))
      })
    }
    const source = await resolveProjectionSource(key, directory, entry, fromDisk, projectionDevelopment, owner)
    if (event.sender.isDestroyed()) await releaseProjectionSources(owner)
    return source
  })
  const projectionWatchers = new Map<number, Map<string, () => void>>()
  ipcMain.handle('projection:watch-build', (event, directory: string, enabled: boolean) => {
    if (enabled && !projectionDevelopment) throw new Error('Projection development is disabled')
    let watches = projectionWatchers.get(event.sender.id)
    if (!watches) {
      watches = new Map()
      projectionWatchers.set(event.sender.id, watches)
      const senderId = event.sender.id
      event.sender.once('destroyed', () => {
        for (const stop of watches!.values()) stop()
        projectionWatchers.delete(senderId)
      })
    }
    watches.get(directory)?.()
    watches.delete(directory)
    if (enabled) watches.set(directory, watchProjectionBuild(event.sender, directory))
  })

  // The whole file capability goes through the engine now: read/exists via the
  // `content` read, write/delete via the governed mutation channel (member-aware,
  // so scattered members resolve by absolute path). No raw main-process fs.
  ipcMain.handle('files:read', (_event, entryPath: string, filePath: string) =>
    connections.readFile(entryPath, filePath),
  )
  ipcMain.handle(
    'files:write',
    (_event, entryPath: string, filePath: string, content: string, expectedHash?: string) =>
      connections.writeFile(entryPath, filePath, content, expectedHash),
  )
  ipcMain.handle('files:exists', (_event, entryPath: string, filePath: string) =>
    connections.fileExists(entryPath, filePath),
  )
  ipcMain.handle('files:delete', (_event, entryPath: string, filePath: string, expectedHash?: string) =>
    connections.deleteFile(entryPath, filePath, expectedHash),
  )
  ipcMain.handle('files:rename', (_event, entryPath: string, from: string, to: string) =>
    connections.rename(entryPath, from, to),
  )

  // Turn a `file*` asset reference into a loadable `au-asset://` URL: resolve the ref to
  // an absolute path over the engine (within-workspace only), register it for serving,
  // return the URL. null when it does not resolve. Strips a surrounding `[[ ]]` so both a
  // wikilink value and a bare target are accepted.
  ipcMain.handle('assets:url', async (_event, entryPath: string, fileRef: string) => {
    const target = fileRef.replace(/^\[\[(.*)\]\]$/, '$1').trim()
    if (!target) return null
    const abs = await connections.resolveTarget(entryPath, target)
    if (!abs) return null
    const token = await registerAsset(abs)
    return token === null ? null : /\.html?$/i.test(abs) ? `au-artifact://${token}/index.html` : `au-asset://${token}`
  })

  // Scope management: re-scope a member's `.auignore` via the governed `set_ignores`
  // mutation (member-aware by absolute `root`). The READ side (`ignores`) goes through
  // the normal engine read channel; only this mutation needs a host path.
  ipcMain.handle('scope:setIgnores', (_event, entryPath: string, root: string, patterns: string[]) =>
    connections.setIgnores(entryPath, root, patterns),
  )

  // Boot-gate target picker: a native open dialog. Directory-ONLY under folder-repo — the entry is
  // a folder carrying `.arsumbris/repo.yaml`, and a file entry is refused by the engine. Keeps
  // `createDirectory` so the user can make the workspace folder from the picker.
  ipcMain.handle('dialog:select', async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // Generic native path picker for setup flows (a file or a directory).
  ipcMain.handle('dialog:pick-path', async (event, kind: 'file' | 'directory'): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options =
      kind === 'directory'
        ? { properties: ['openDirectory' as const] }
        : { properties: ['openFile' as const] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // Boot-gate validation (raw fs, daemon-free): catch a wrong engine root before start.
  ipcMain.handle('gate:inspect', (_event, target: string) => inspectGate(target))
  const templatePaths = {hostConfig: templateHostConfigDir(), engineConfig: templateEngineConfigDir()}
  ipcMain.handle('gate:workspace-templates', () => discoverWorkspaceTemplates(templatePaths))
  ipcMain.handle('gate:materialize-workspace', (_event, request: MaterializeWorkspaceRequest) => {
    const result = materializeWorkspace(templatePaths, request)
    if (result.ok && result.entryPath) touchWorkspace({root: result.entryPath})
    return result
  })
  ipcMain.handle('gate:discover-closure', (_event, located: Record<string, string>) => discoverClosure(located))
  ipcMain.handle('gate:scan-for', (_event, folder: string, names: string[]) => scanFor(folder, names))
  ipcMain.handle('gate:missing-locations', (_event, entry: string) => missingLocations(entry))
  ipcMain.handle('gate:locate-members', (_event, entries: FoundDep[]) => locateMembers(entries))
  ipcMain.handle('gate:scaffold-entry', (_event, dir: string, name?: string) => scaffoldEntry(dir, name))
  ipcMain.handle('gate:create-workspace', (_event, dir: string, name: string, deps: FoundDep[]) =>
    createWorkspace(dir, name, deps),
  )

  // The mount/proxy command protocol transport, keyed by window-node POOL ID. The authority
  // (main renderer) opens a surface, drives it with `surface:command`, and receives its
  // `surface:event`s back; the surface's mount agent signals ready (`surface:ready`) and gets its init.
  // Surface-id-from-sender or opener-guarded, never trusting a renderer-supplied id.
  surfaces.onReady = (surfaceId, opener) => {
    if (!opener.isDestroyed()) opener.send('surface:ready-to-opener', surfaceId)
  }
  surfaces.onClosed = (surfaceId, opener) => {
    if (!opener.isDestroyed()) opener.send('surface:closed-to-opener', surfaceId)
  }
  surfaces.onCloseRequested = (surfaceId, opener) => {
    if (!opener.isDestroyed()) opener.send('surface:close-requested-to-opener', surfaceId)
  }
  surfaces.onCrashed = (surfaceId, opener) => {
    if (!opener.isDestroyed()) opener.send('surface:crashed-to-opener', surfaceId)
  }
  ipcMain.handle('surface:open', (event, req: SurfaceOpenRequest) => surfaces.open(req, event.sender))
  ipcMain.handle('surface:close', (_event, surfaceId: string) => surfaces.close(surfaceId))
  ipcMain.on('surface:ready', (event) => {
    const init = surfaces.handleReady(event.sender)
    if (init && !event.sender.isDestroyed()) event.sender.send('surface:init', init)
  })
  ipcMain.on('surface:command', (event, surfaceId: string, command: SurfaceCommand) =>
    surfaces.sendCommand(event.sender, surfaceId, command),
  )
  ipcMain.on('surface:event', (event, ev) => surfaces.relayEvent(event.sender, ev))
  // Raise + focus the main window (surface-0) — e.g. dock in a secondary surface opens the spatial
  // chooser here, so the user should not have to click the main window first.
  ipcMain.on('surface:focus-main', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Never SURFACE a deliberately-hidden window (a `show:false` headless/e2e main). Only bring forward a
    // window that is already on screen (visible) or minimized — otherwise `show()` would un-hide it.
    if (!mainWindow.isVisible() && !mainWindow.isMinimized()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  // Host-owned pty terminal sessions (`host.terminal`). Attach mints a per-consumer
  // token (like engine:subscribe); data/exit push to that token. A remount detaches
  // (keeps the session) and reattaches; reconcile kills sessions for removed panes.
  ipcMain.handle('terminal:preferences',()=>readTerminalPreferences())
  ipcMain.handle('terminal:save-preferences',(_event,value:unknown)=>{const next=saveTerminalPreferences(value);for(const window of BrowserWindow.getAllWindows())window.webContents.send('terminal:preferences-changed',next);return next})
  ipcMain.handle(
    'terminal:attach',
    (event, token: number, comp: string, node: string, opts: TerminalAttachOptions) =>
      terminals.attach(comp, node, token, event.sender, opts ?? {}),
  )
  ipcMain.on('terminal:write', (_event, comp: string, node: string, data: string) =>
    terminals.write(comp, node, data),
  )
  ipcMain.on('terminal:resize', (_event, comp: string, node: string, cols: number, rows: number) =>
    terminals.resize(comp, node, cols, rows),
  )
  ipcMain.handle('terminal:detach', (_event, token: number, comp: string, node: string) =>
    terminals.detach(comp, node, token),
  )
  ipcMain.on('terminal:close', (_event, comp: string, node: string) => terminals.kill(comp, node))
  ipcMain.on('terminal:reconcile', (_event, comp: string, liveNodeIds: string[]) =>
    terminals.reconcile(comp, liveNodeIds),
  )
  ipcMain.handle('terminal:cwd', (_event, comp: string, node: string) => terminals.cwd(comp, node))

  installProjectionProtocol()
  installAssetProtocol()
  // The host's shared-dep bundle (React + the SDKs), built by `pnpm --filter app build:shared-deps` into
  // app/shared-deps/dist. `__dirname` is app/out/main under electron-vite, so the bundle sits two up. A
  // packaged app relocates out/, so the bundle must be packaged alongside it for this path to resolve there.
  installSharedProtocol(path.join(__dirname, '../../shared-deps/dist'))
  // The interim renderer CSP: strict in prod (no unsafe-eval, importmap hashed),
  // loose in dev (vite needs unsafe-inline + unsafe-eval + ws). Set before the window loads its document.
  installRendererCsp({ dev: !!process.env['ELECTRON_RENDERER_URL'], rendererDir: path.join(__dirname, '../renderer') })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function disposeApplication(): void {
  surfaces.dispose()
  connections.dispose()
  mcp.dispose()
  supervisor.dispose()
  terminals.killAll()
  hostBridge.stop()
  viewState.dispose() // flush the last cursor positions so they survive a restart.
}

let quitting = false
let disposed = false
app.on('before-quit', event => {
  if (disposed) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void (async () => {
    let reason = 'Some terminal processes have not finished exiting. Their sessions may not yet be saved for resuming.'
    try {
      if (await orderedShutdown(() => terminals.drain(), disposeApplication)) {
        disposed = true
        app.quit()
        return
      }
    } catch (error) { reason = `Could not verify terminal shutdown: ${error instanceof Error ? error.message : String(error)}` }
    const choice = await dialog.showMessageBox({
      type: 'warning', title: 'Sessions are still closing', message: 'Keep the app open to allow session cleanup?',
      detail: reason, buttons: ['Keep app open', 'Quit anyway'], defaultId: 0, cancelId: 0,
    })
    if (choice.response === 1) {
      disposeApplication()
      disposed = true
      app.quit()
    } else quitting = false
  })().catch(error => { quitting = false; console.error('[shutdown]', error) })
})

// Dev runners also need the normal quit path; a direct signal otherwise bypasses adapter cleanup.
process.on('SIGINT', () => app.quit())
process.on('SIGTERM', () => app.quit())
