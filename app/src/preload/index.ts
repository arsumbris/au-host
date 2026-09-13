// The only place the frame's capability surface reaches the renderer.
// Views get exactly what is exposed here, nothing more.

import { contextBridge, ipcRenderer, webFrame } from 'electron'

import type { ReadRequest, SubscribeRequest } from '@arsumbris/au-engine-sdk/wire'

import type { DaemonConfig, FoundDep, MainApi, SubscriptionEvent, SurfaceCommand, SurfaceEvent, SurfaceInit, SurfaceOpenRequest, TouchWorkspace, WorkspaceMemberListRole } from '../shared/daemon-api'

let nextSubscriptionToken = 1

const api: MainApi = {
  platform: process.platform,
  // The renderer's web zoom factor (1 = 100%). Chrome geometry needs it: the OS traffic lights are
  // painted in window points and do NOT scale with web zoom, so the app bar's light gap is sized in
  // CSS px as `base / zoomFactor`. `setZoomFactor` backs the bar's click-to-reset zoom indicator.
  getZoomFactor: () => webFrame.getZoomFactor(),
  setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
  daemon: {
    status: (config: DaemonConfig) => ipcRenderer.invoke('daemon:status', config),
    start: (config: DaemonConfig) => ipcRenderer.invoke('daemon:start', config),
    stop: (config: DaemonConfig) => ipcRenderer.invoke('daemon:stop', config),
    onLog: (listener) => {
      const wrapped = (_event: unknown, line: string): void => listener(line)
      ipcRenderer.on('daemon:log', wrapped)
      return () => ipcRenderer.removeListener('daemon:log', wrapped)
    },
    onExit: (listener) => {
      const wrapped = (_event: unknown, code: number | null, entryPath: string | null): void => listener(code, entryPath)
      ipcRenderer.on('daemon:exit', wrapped)
      return () => ipcRenderer.removeListener('daemon:exit', wrapped)
    },
  },
  app: {
    initialEntry: () => ipcRenderer.invoke('app:initial-entry'),
  },
  windows: {
    open: (entry: string) => ipcRenderer.invoke('windows:open', entry),
    newWorkspace: () => ipcRenderer.invoke('windows:new'),
  },
  hostbridge: {
    start: (entry: string) => ipcRenderer.invoke('hostbridge:start', entry),
    stop: () => ipcRenderer.invoke('hostbridge:stop'),
    onCommand: (handler) => {
      // Main forwards each socket command with a correlation id; run the handler and
      // send the result back under the same id. Errors surface as a rejected handler,
      // which main turns into an `ok: false` socket frame.
      const wrapped = (_event: unknown, message: { id: number; command: Parameters<typeof handler>[0] }): void => {
        void handler(message.command).then(
          (result) => ipcRenderer.send('hostbridge:command-reply', { id: message.id, result }),
          (err: unknown) =>
            ipcRenderer.send('hostbridge:command-reply', {
              id: message.id,
              error: err instanceof Error ? err.message : String(err),
            }),
        )
      }
      ipcRenderer.on('hostbridge:command', wrapped)
      return () => ipcRenderer.removeListener('hostbridge:command', wrapped)
    },
  },
  mcp: {
    status: (workspace: string) => ipcRenderer.invoke('mcp:status', workspace),
    start: (workspace: string) => ipcRenderer.invoke('mcp:start', workspace),
    stop: (workspace: string) => ipcRenderer.invoke('mcp:stop', workspace),
    skillManifest: (workspace: string, adapter?: string) => ipcRenderer.invoke('mcp:skill-manifest', workspace, adapter),
    injectManifest: (workspace: string, adapter?: string) => ipcRenderer.invoke('mcp:inject-manifest', workspace, adapter),
    listAdapters: (workspace: string) => ipcRenderer.invoke('mcp:list-adapters', workspace),
    launch: (
      workspace: string,
      opts: { resumeSession?: string; skills?: string[]; inject?: string[]; tools?: string[]; nativeTools?: string[]; profile?: string; adapter?: string },
    ) => ipcRenderer.invoke('mcp:launch', workspace, opts),
    listDormant: (workspace: string) => ipcRenderer.invoke('mcp:list-dormant', workspace),
    retentionPreview: (workspace: string, windowMs: number) => ipcRenderer.invoke('mcp:retention-preview', workspace, windowMs),
    retentionConfig: (workspace: string) => ipcRenderer.invoke('mcp:retention-config', workspace),
    setRetentionWindow: (workspace: string, windowDays: number) => ipcRenderer.invoke('mcp:set-retention-window', workspace, windowDays),
    retireSession: (workspace: string, session: string) => ipcRenderer.invoke('mcp:retire-session', workspace, session),
    saveProfile: (workspace: string, name: string, data: unknown) => ipcRenderer.invoke('mcp:save-profile', workspace, name, data),
    listProfiles: (workspace: string) => ipcRenderer.invoke('mcp:list-profiles', workspace),
    deleteProfile: (workspace: string, name: string, filePath?: string) =>
      ipcRenderer.invoke('mcp:delete-profile', workspace, name, filePath),
    toolPaths: () => ipcRenderer.invoke('mcp:tool-paths'),
    saveToolPaths: (patch) => ipcRenderer.invoke('mcp:save-tool-paths', patch),
    pathExists: (path: string) => ipcRenderer.invoke('mcp:path-exists', path),
    openPathsFile: () => ipcRenderer.invoke('mcp:open-paths-file'),
    onLog: (listener) => {
      const wrapped = (_event: unknown, line: string): void => listener(line)
      ipcRenderer.on('mcp:log', wrapped)
      return () => ipcRenderer.removeListener('mcp:log', wrapped)
    },
    onExit: (listener) => {
      const wrapped = (_event: unknown, code: number | null): void => listener(code)
      ipcRenderer.on('mcp:exit', wrapped)
      return () => ipcRenderer.removeListener('mcp:exit', wrapped)
    },
  },
  shell: {
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:show-item-in-folder', path),
    openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },
  workspace: {
    addMember: (wsRoot: string, member: { name: string; memberPath: string; role?: WorkspaceMemberListRole; description?: string }) => ipcRenderer.invoke('workspace:add-member', wsRoot, member),
    removeMember: (wsRoot: string, name: string) => ipcRenderer.invoke('workspace:remove-member', wsRoot, name),
    setMemberRole: (wsRoot: string, name: string, role: WorkspaceMemberListRole) => ipcRenderer.invoke('workspace:set-member-role', wsRoot, name, role),
    setMemberDisabled: (wsRoot: string, name: string, disabled: boolean) => ipcRenderer.invoke('workspace:set-member-disabled', wsRoot, name, disabled),
    declarePeer: (memberRoot: string, memberName: string, peerName: string, remote?: string) => ipcRenderer.invoke('workspace:declare-peer', memberRoot, memberName, peerName, remote),
    scaffoldRegistry: (memberRoot: string, memberName: string, description?: string) => ipcRenderer.invoke('workspace:scaffold-registry', memberRoot, memberName, description),
    pickFolder: () => ipcRenderer.invoke('dialog:pick-path', 'directory'),
  },
  recents: {
    listWorkspaces: () => ipcRenderer.invoke('recents:list-workspaces'),
    touchWorkspace: (ws: TouchWorkspace) => ipcRenderer.invoke('recents:touch-workspace', ws),
    listCompositions: (root: string) => ipcRenderer.invoke('recents:list-compositions', root),
    touchComposition: (root: string, compositionPath: string) => ipcRenderer.invoke('recents:touch-composition', root, compositionPath),
  },
  viewState: {
    load: (comp: string) => ipcRenderer.sendSync('viewstate:load', comp),
    loadNode: (comp: string, node: string) => ipcRenderer.sendSync('viewstate:load-node', comp, node),
    set: (comp: string, node: string, sub: string, value: unknown) => ipcRenderer.send('viewstate:set', comp, node, sub, value),
    prune: (comp: string, liveNodeIds: string[]) => ipcRenderer.send('viewstate:prune', comp, liveNodeIds),
    drop: (comp: string) => ipcRenderer.send('viewstate:drop', comp),
  },
  theme: {
    changed: (state) => ipcRenderer.send('theme:changed', state),
    onApply: (cb) => ipcRenderer.on('theme:apply', (_e, state) => cb(state)),
  },
  engine: {
    read: (entryPath: string, request: ReadRequest) =>
      ipcRenderer.invoke('engine:read', entryPath, request),
    subscribe: (entryPath: string, request: SubscribeRequest, onEvent) => {
      const token = nextSubscriptionToken++
      const listener = (_event: unknown, message: { token: number; event: SubscriptionEvent }): void => {
        if (message.token === token) onEvent(message.event)
      }
      ipcRenderer.on('engine:subscription-event', listener)
      void ipcRenderer.invoke('engine:subscribe', token, entryPath, request)
      return () => {
        ipcRenderer.removeListener('engine:subscription-event', listener)
        void ipcRenderer.invoke('engine:unsubscribe', token)
      }
    },
    watchReady: (entryPath: string, onReady: (ready: boolean) => void) => {
      const token = nextSubscriptionToken++
      const listener = (_event: unknown, message: { token: number; ready: boolean }): void => {
        if (message.token === token) onReady(message.ready)
      }
      ipcRenderer.on('engine:ready-change', listener)
      void ipcRenderer.invoke('engine:watch-ready', token, entryPath)
      return () => {
        ipcRenderer.removeListener('engine:ready-change', listener)
        void ipcRenderer.invoke('engine:unwatch-ready', token)
      }
    },
    register: (entryPath: string, name: string, path: string, remote?: string) =>
      ipcRenderer.invoke('engine:register', entryPath, name, path, remote),
    deviceConfig: (entryPath: string) => ipcRenderer.invoke('engine:device-config', entryPath),
  },
  projections: {
    isDevelopment: () => ipcRenderer.invoke('projection:development'),
    resolveSource: (key, directory, entry, fromDisk) => ipcRenderer.invoke('projection:resolve-source', key, directory, entry, fromDisk),
    watchBuild: (directory, enabled) => ipcRenderer.invoke('projection:watch-build', directory, enabled),
    onBuild: (listener) => {
      const wrapped = (_event: unknown, message: { root: string }): void => listener(message)
      ipcRenderer.on('projection:build', wrapped)
      return () => ipcRenderer.removeListener('projection:build', wrapped)
    },
    registerSource: (key: string, directory: string) =>
      ipcRenderer.invoke('projection:register-source', key, directory),
    unregisterSource: (key: string) => ipcRenderer.invoke('projection:unregister-source', key),
  },
  files: {
    read: (entryPath: string, filePath: string) =>
      ipcRenderer.invoke('files:read', entryPath, filePath),
    write: (entryPath: string, filePath: string, content: string, expectedHash?: string) =>
      ipcRenderer.invoke('files:write', entryPath, filePath, content, expectedHash),
    exists: (entryPath: string, filePath: string) =>
      ipcRenderer.invoke('files:exists', entryPath, filePath),
    delete: (entryPath: string, filePath: string, expectedHash?: string) =>
      ipcRenderer.invoke('files:delete', entryPath, filePath, expectedHash),
    rename: (entryPath: string, from: string, to: string) =>
      ipcRenderer.invoke('files:rename', entryPath, from, to),
  },
  assets: {
    url: (entryPath: string, fileRef: string) => ipcRenderer.invoke('assets:url', entryPath, fileRef),
  },
  scope: {
    setIgnores: (entryPath: string, root: string, patterns: string[]) =>
      ipcRenderer.invoke('scope:setIgnores', entryPath, root, patterns),
  },
  dialog: {
    select: () => ipcRenderer.invoke('dialog:select'),
    pickPath: (kind: 'file' | 'directory') => ipcRenderer.invoke('dialog:pick-path', kind),
  },
  gate: {
    workspaceTemplates: () => ipcRenderer.invoke('gate:workspace-templates'),
    materializeWorkspace: request => ipcRenderer.invoke('gate:materialize-workspace', request),
    inspect: (target: string) => ipcRenderer.invoke('gate:inspect', target),
    discoverClosure: (located: Record<string, string>) => ipcRenderer.invoke('gate:discover-closure', located),
    scanFor: (folder: string, names: string[]) => ipcRenderer.invoke('gate:scan-for', folder, names),
    missingLocations: (entry: string) => ipcRenderer.invoke('gate:missing-locations', entry),
    locateMembers: (entries: FoundDep[]) => ipcRenderer.invoke('gate:locate-members', entries),
    scaffoldEntry: (dir: string, name?: string) => ipcRenderer.invoke('gate:scaffold-entry', dir, name),
    createWorkspace: (dir: string, name: string, deps: FoundDep[]) =>
      ipcRenderer.invoke('gate:create-workspace', dir, name, deps),
  },
  surface: {
    // (authority) open / close / drive surfaces, receive their ready + events.
    open: (req: SurfaceOpenRequest) => ipcRenderer.invoke('surface:open', req),
    close: (surfaceId: string) => ipcRenderer.invoke('surface:close', surfaceId),
    focusMain: () => ipcRenderer.send('surface:focus-main'),
    onReady: (listener) => {
      const wrapped = (_event: unknown, surfaceId: string): void => listener(surfaceId)
      ipcRenderer.on('surface:ready-to-opener', wrapped)
      return () => ipcRenderer.removeListener('surface:ready-to-opener', wrapped)
    },
    onClosed: (listener) => {
      const wrapped = (_event: unknown, surfaceId: string): void => listener(surfaceId)
      ipcRenderer.on('surface:closed-to-opener', wrapped)
      return () => ipcRenderer.removeListener('surface:closed-to-opener', wrapped)
    },
    onCrashed: (listener) => {
      const wrapped = (_event: unknown, surfaceId: string): void => listener(surfaceId)
      ipcRenderer.on('surface:crashed-to-opener', wrapped)
      return () => ipcRenderer.removeListener('surface:crashed-to-opener', wrapped)
    },
    onCloseRequested: (listener) => {
      const wrapped = (_event: unknown, surfaceId: string): void => listener(surfaceId)
      ipcRenderer.on('surface:close-requested-to-opener', wrapped)
      return () => ipcRenderer.removeListener('surface:close-requested-to-opener', wrapped)
    },
    sendCommand: (surfaceId, command) => ipcRenderer.send('surface:command', surfaceId, command),
    onEvent: (listener) => {
      const wrapped = (_event: unknown, message: { surfaceId: string; event: SurfaceEvent }): void =>
        listener(message.surfaceId, message.event)
      ipcRenderer.on('surface:event-to-opener', wrapped)
      return () => ipcRenderer.removeListener('surface:event-to-opener', wrapped)
    },
    // (surface agent) ready handshake, receive commands, report events up.
    ready: () => ipcRenderer.send('surface:ready'),
    onInit: (listener) => {
      const wrapped = (_event: unknown, init: SurfaceInit): void => listener(init)
      ipcRenderer.on('surface:init', wrapped)
      return () => ipcRenderer.removeListener('surface:init', wrapped)
    },
    onCommand: (listener) => {
      const wrapped = (_event: unknown, command: SurfaceCommand): void => listener(command)
      ipcRenderer.on('surface:command', wrapped)
      return () => ipcRenderer.removeListener('surface:command', wrapped)
    },
    sendEvent: (event) => ipcRenderer.send('surface:event', event),
  },
  terminalPreferences: {
    get: () => ipcRenderer.invoke('terminal:preferences'),
    save: value => ipcRenderer.invoke('terminal:save-preferences',value),
    subscribe: listener => { const receive=(_event:unknown,value:import('@arsumbris/au-host-app').TerminalPreferences)=>listener(value);ipcRenderer.on('terminal:preferences-changed',receive);return()=>ipcRenderer.removeListener('terminal:preferences-changed',receive) },
  },
  terminal: {
    // Mirrors engine.subscribe: mint a token, register the data/exit listeners FIRST
    // (so the attach reply's replayed buffer is caught), then invoke attach.
    attach: (comp, node, opts, onData, onExit) => {
      const token = nextSubscriptionToken++
      const dataListener = (_event: unknown, m: { token: number; data: string }): void => {
        if (m.token === token) onData(m.data)
      }
      const exitListener = (_event: unknown, m: { token: number }): void => {
        if (m.token === token) onExit()
      }
      ipcRenderer.on('terminal:data', dataListener)
      ipcRenderer.on('terminal:exit', exitListener)
      // Do NOT void-swallow the attach rejection: if the main handler throws (e.g. pty.spawn
      // fails) the pane would otherwise sit blank with nothing in the renderer console. Surface
      // it into the xterm (via the already-registered onData) + the console, then signal exit.
      ipcRenderer.invoke('terminal:attach', token, comp, node, opts).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[terminal] attach failed:', err)
        onData(`\r\n\x1b[31m[terminal attach failed: ${msg}]\x1b[0m\r\n`)
        onExit()
      })
      const off = (): void => {
        ipcRenderer.removeListener('terminal:data', dataListener)
        ipcRenderer.removeListener('terminal:exit', exitListener)
      }
      return {
        write: (data: string) => ipcRenderer.send('terminal:write', comp, node, data),
        resize: (cols: number, rows: number) => ipcRenderer.send('terminal:resize', comp, node, cols, rows),
        send: (text: string) => ipcRenderer.send('terminal:write', comp, node, text),
        // Unmount: stop listening + drop this consumer, but KEEP the session alive.
        detach: () => {
          off()
          void ipcRenderer.invoke('terminal:detach', token, comp, node)
        },
        // Explicit kill: terminate the pty.
        close: () => {
          off()
          ipcRenderer.send('terminal:close', comp, node)
        },
      }
    },
    reconcile: (comp: string, liveNodeIds: string[]) =>
      ipcRenderer.send('terminal:reconcile', comp, liveNodeIds),
    cwd: (comp: string, node: string) => ipcRenderer.invoke('terminal:cwd', comp, node),
  },
}

contextBridge.exposeInMainWorld('main', api)
