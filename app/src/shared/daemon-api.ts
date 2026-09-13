import type { TerminalAttachOptions, WorkspaceTemplateCatalog, MaterializeWorkspaceRequest } from '@arsumbris/au-host-sdk'
// Types shared between main, preload, and renderer.
// Pure types only — this file must stay import-safe for the renderer,
// hence the `/wire` subpath: it carries no node-only client code.

import type {
  EngineReadResult,
  ReadRequest,
  SubscribeRequest,
  SubscriptionEvent,
} from '@arsumbris/au-engine-sdk/wire'
import type { HostCommand, HostResult, HostEvent, RecentComposition, RecentWorkspace, CanonicalKeystroke } from '@arsumbris/au-host-sdk'
export type { EngineReadResult, SubscriptionEvent }

// The APP-OWNED capability DTOs now live in `@arsumbris/au-host-app`, the package that owns the
// `HostApp` tier, because four projections need them and a projection cannot import from `app/src`.
// Re-exported here so main, preload and the renderer keep importing from one place — there is ONE
// definition, not a copy. See `packages/au-host-app/src/dto.ts`.
export type {
  ActionResult,
  AdapterRuntime,
  AgentProfileData,
  ClosureMember,
  ClosureResult,
  CreateWorkspaceResult,
  DiscoveredAdapter,
  FoundDep,
  GateInspection,
  ToolPaths,
  ToolPathsInfo,
  ToolPathsPatch,
  TouchWorkspace,
  DaemonConfig,
  DaemonStatus,
  DeviceConfigResult,
  DormantSession,
  DormantSessionsResult,
  InjectManifest,
  InjectManifestEntry,
  InjectRole,
  McpStatus,
  ProfileSaveResult,
  RetentionConfig,
  RetentionConfigResult,
  RetireSessionResult,
  SkillManifest,
  SkillManifestEntry,
  WorkspaceMemberListRole,
} from '@arsumbris/au-host-app'

// Bound locally too: `export … from` re-exports without introducing the names into this module's
// scope, and `MainApi` below refers to them.
import type {
  ActionResult,
  AgentProfileData,
  ClosureResult,
  CreateWorkspaceResult,
  DiscoveredAdapter,
  FoundDep,
  GateInspection,
  ToolPathsInfo,
  ToolPathsPatch,
  TouchWorkspace,
  DaemonConfig,
  DaemonStatus,
  DeviceConfigResult,
  DormantSessionsResult,
  InjectManifest,
  McpStatus,
  ProfileSaveResult,
  RetentionConfigResult,
  RetireSessionResult,
  SkillManifest,
  WorkspaceMemberListRole,
} from '@arsumbris/au-host-app'

/**
 * The parsed output of the adapter's `bin/launch.ts` — ONE ready agent launch.
 * On success the launcher owns the whole `AU_MCP_*` env; the renderer runs `command`
 * (or spawns `{binary, argv, env}`) in a terminal pane. On failure there is nothing to
 * run (unlike gen-skills, which degrades), so the launch surfaces the error.
 */
export type AgentLaunchResult =
  | {
      ok: true
      /** The per-launch session handle (`AU_MCP_SESSION`), minted by the launcher. */
      session: string
      /** The env DELTA to merge onto the child (the `AU_MCP_*` vars + `CLAUDE_PROJECT_DIR`). */
      env: Record<string, string>
      /** The selected agent binary to spawn. */
      binary: string
      /** The launcher-supplied args (the `--plugin-dir` list); append your own agent arguments after. */
      argv: string[]
      /** A ready env-prefixed, shell-quoted command string — runnable in a terminal pane as-is. */
      command: string
    }
  | { ok: false; error: string }

/** Result of an add/remove-member edit on an existing workspace. */
export interface WorkspaceEditResult {
  ok: boolean
  error?: string
}

/** Result of a device-global `register` (repos.yaml location write via the daemon). */
export interface RegisterResult {
  ok: boolean
  /** The registered repo name (echoed) on success. */
  name?: string
  /** The recorded local path (echoed) on success. */
  path?: string
  /** Post-rebuild engine version on success. */
  version?: number
  error?: string
}

// The launcher-recents DTOs are the CONTRACT's — host-sdk owns them (MountHost.recents returns them),
// re-exported here so the app's shared surface + main-process store share one definition.
export type { RecentComposition, RecentWorkspace } from '@arsumbris/au-host-sdk'

/** Result of a host file read (via the engine `content` read). */
export interface FileReadResult {
  ok: boolean
  content?: string
  error?: string
  /**
   * The content's hash at read time — the read-before-write guard's baseline.
   * Carry it back as a later write's `expectedHash`. Absent when the engine
   * could not resolve the file's hash (the write then degrades to blind).
   */
  hash?: string
}

/** Result of a host file write/delete (via the engine mutation channel). */
export interface FileWriteResult {
  ok: boolean
  error?: string
  /**
   * The post-mutation entry version (the engine's monotonic write counter).
   * The echo-suppression key: a change event carrying this `at_version` is the
   * host's own write echoing back.
   */
  version?: number
  /** The content's hash after the write (`null`/absent for a delete). Seeds the next guarded write. */
  hash?: string
  /**
   * Present when the write was REJECTED by the read-before-write guard: the
   * file changed since `expectedHash` was read. `ok` is false; `currentHash` is
   * the engine's current content hash (re-read to merge, then retry).
   */
  conflict?: { currentHash: string }
}

/**
 * The MAIN-process capability surface, exposed to the renderer by the preload as `window.main`.
 *
 * This is the app's PRIVATE IPC bridge across the Electron process split — daemon supervision,
 * engine reads, fs writes, native dialogs, the pty, surface windows. It is NOT the projection
 * contract: projections talk to `MountHost` (from `@arsumbris/au-host-sdk`) and never touch this.
 * The two deliberately do not share a name, though several surfaces overlap (`files`, `workspace`,
 * `terminal`, `scope`).
 */
/** An opaque, JSON-serializable theme-preferences snapshot relayed between windows. The full app-global
 *  state (active theme, per-theme appearance edits, device preferences) travels each change, so a receiver
 *  persists + re-applies it. The renderer's theme-store owns the exact shape (`ThemePreferences`); main
 *  relays it verbatim without inspecting it, so this stays an opaque transport record. */
export type ThemeSyncState = Record<string, unknown>

export interface MainApi {
  /**
   * The host OS (`process.platform`: 'darwin' | 'win32' | 'linux' | …). Exposed for CHROME GEOMETRY
   * only — with `titleBarStyle: 'hiddenInset'` macOS paints the OS traffic lights inside our top-left
   * corner, so the host app bar reserves a left gap for them. No other platform has in-window controls.
   * Never branch BEHAVIOUR on this.
   */
  platform: string
  /** The renderer's current web zoom factor (1 = 100%). The OS traffic lights are painted in window
   *  points and do not scale with web zoom, so the app bar sizes its light gap as `base / zoomFactor`. */
  getZoomFactor(): number
  /** Set the renderer's web zoom factor. Backs the app bar's click-to-reset zoom indicator. */
  setZoomFactor(factor: number): void
  daemon: {
    status(config: DaemonConfig): Promise<DaemonStatus>
    start(config: DaemonConfig): Promise<ActionResult>
    stop(config: DaemonConfig): Promise<ActionResult>
    onLog(listener: (line: string) => void): () => void
    /** The owned daemon child exited. `entryPath` is the entry it was SERVING (null if unknown) —
     *  required to tell a crash of the daemon you just started from the deliberate stop of the
     *  previous workspace's daemon during a switch, since both land inside one `start()` call. */
    onExit(listener: (code: number | null, entryPath: string | null) => void): () => void
  }
  /**
   * The agent-host transport socket the host SERVES (au-mcp's relay tools connect
   * as clients). The renderer starts it once in a workspace so it is up before
   * au-mcp's tools connect, receives each relayed command via `onCommand` and
   * executes it against the live UI, and stops it on teardown. Only the authority
   * runtime serves it — one server per workspace host.
   */
  hostbridge: {
    /** Bind the socket for the workspace `entry` (its root/manifest path — what the
     *  socket file name hashes). Resolves with the bound socket path, or an error. */
    start(entry: string): Promise<{ ok: true; socket: string | null } | { ok: false; error: string }>
    /** Close the socket. */
    stop(): Promise<void>
    /** Register the executor for relayed commands: each incoming command is run and
     *  its result returned to the socket client. Returns an unsubscribe. */
    onCommand(handler: (command: HostCommand) => Promise<HostResult>): () => void
  }
  /** The second daemon in the agent stack: the au-mcp broker, host-supervised. */
  mcp: {
    status(workspace: string): Promise<McpStatus>
    /** Spawn the au-mcp daemon (needs the au-mcp CLI path set in paths.yaml). */
    start(workspace: string): Promise<ActionResult>
    stop(workspace: string): Promise<ActionResult>
    /** The resolved per-machine tool paths + the config file location. */
    toolPaths(): Promise<ToolPathsInfo>
    /** Merge a patch into paths.yaml (an empty string clears a key). */
    saveToolPaths(patch: ToolPathsPatch): Promise<void>
    /** Whether a path exists on disk (for setup-flow validation). */
    pathExists(path: string): Promise<boolean>
    /** Create paths.yaml (from a template) if absent, then reveal it in the OS. */
    openPathsFile(): Promise<void>
    /**
     * Build a ready agent launch via the adapter's `bin/launch.ts`: the launcher mints the
     * session handle, assembles the whole `AU_MCP_*` env, and materializes the selected skills
     * + injects into `--plugin-dir`s. au-host passes flags only. Each axis is tri-state
     * (undefined = the launcher's default; `[]` = none; a list = only those). Needs the engine
     * daemon up. Returns `{ ok: false, error }` when no command could be produced.
     */
    launch(
      workspace: string,
      opts: { resumeSession?: string; skills?: string[]; inject?: string[]; tools?: string[]; nativeTools?: string[]; profile?: string; adapter?: string },
    ): Promise<AgentLaunchResult>
    /** The discovered, launchable `mcp.adapter` set for the launch picker (gated on `unmet_required_meta`). */
    listAdapters(workspace: string): Promise<DiscoveredAdapter[]>
    /**
     * Read the discovered-skills manifest for the launch picker (`gen-skills --manifest`) —
     * the skills to render + the skipped ones (visible-by-absence). Degrades to an empty
     * manifest on any failure. Needs the engine daemon up. (Materialization itself happens
     * inside `launch` — the adapter's `launch.ts` — not here.)
     */
    skillManifest(workspace: string, adapter?: string): Promise<SkillManifest>
    /**
     * Read the discovered-injects manifest for the launch picker (`gen-inject --manifest`) —
     * the injects to render (with role + prepaid byte cost) + the skipped ones
     * (visible-by-absence). Degrades to an empty manifest on any failure. Needs the daemon up.
     */
    injectManifest(workspace: string, adapter?: string): Promise<InjectManifest>
    /**
     * Session RETENTION over the au-mcp daemon socket (control-plane; host/user authority, never an
     * agent tool). Each derives the socket from `workspace` and degrades to `{ ok: false, error }`
     * when the au-mcp daemon is not up. au-mcp owns the storage + window; the host is a pure client.
     */
    listDormant(workspace: string): Promise<DormantSessionsResult>
    retentionPreview(workspace: string, windowMs: number): Promise<DormantSessionsResult>
    retentionConfig(workspace: string): Promise<RetentionConfigResult>
    setRetentionWindow(workspace: string, windowDays: number): Promise<RetentionConfigResult>
    retireSession(workspace: string, session: string): Promise<RetireSessionResult>
    /** Save the ad-hoc selection as a named profile under `<ws>/operations/agent-profile/`. */
    saveProfile(workspace: string, name: string, data: Omit<AgentProfileData, 'name'>): Promise<ProfileSaveResult>
    /** List the saved profiles for the workspace. */
    listProfiles(workspace: string): Promise<AgentProfileData[]>
    /** Delete a saved profile. `filePath` (from the listing) addresses the real instance file. */
    deleteProfile(workspace: string, name: string, filePath?: string): Promise<{ ok: boolean; error?: string }>
    onLog(listener: (line: string) => void): () => void
    onExit(listener: (code: number | null) => void): () => void
  }
  /** Host → OS shell: reveal a path in the file manager, or open it with the default app. */
  shell: {
    /** Reveal + select the item in the OS file manager (Finder/Explorer). */
    showItemInFolder(path: string): Promise<void>
    /** Open the path with its default handler (a folder opens in the file manager). Resolves to '' on success, else an error string. */
    openPath(path: string): Promise<string>
    /** Open an external URL in the default browser (guarded to http/https in main). */
    openExternal(url: string): Promise<void>
  }
  /** Edit an existing workspace's members (schema-16 raw-fs authoring: the entry's
   *  `.arsumbris/workspace.yaml` `edit:` / `discover:` lists + member `repo.yaml`).
   *  Member LOCATION is device-global — registered via `engine.register`, not here. */
  workspace: {
    /** List a member in the entry's `workspace.yaml` + seed its `repo.yaml` identity.
     *  `role` picks the LIST: `edit` = an authoring surface you edit live; `discover` = mounted for
     *  type-discovery, pinned, not editable.
     *  Register the member's location separately. */
    addMember(wsRoot: string, member: { name: string; memberPath: string; role?: WorkspaceMemberListRole; description?: string }): Promise<WorkspaceEditResult>
    /** Drop a member from the entry's `workspace.yaml` (its device `repos.yaml` entry is left; it's shared). */
    removeMember(wsRoot: string, name: string): Promise<WorkspaceEditResult>
    /** Move a member between the entry's `edit:` and `discover:` lists (change its role). The entry repo
     *  is pinned to `edit:`; a `dep` is not workspace.yaml-listed and cannot be moved this way. */
    setMemberRole(wsRoot: string, name: string, role: WorkspaceMemberListRole): Promise<WorkspaceEditResult>
    /** Enable / disable a declared member via the entry `workspace.yaml`'s `disabled:` overlay — it stays
     *  declared (role kept) but mounts nothing while disabled. Add to disable, remove to re-enable. */
    setMemberDisabled(wsRoot: string, name: string, disabled: boolean): Promise<WorkspaceEditResult>
    /** Declare `peerName` as a cross-repo dependency of the member at `memberRoot` (edits/creates its
     *  `.arsumbris/repo.yaml` `deps:`). Makes the repo self-describing; clears an `undeclared-peer`. */
    declarePeer(memberRoot: string, memberName: string, peerName: string, remote?: string): Promise<WorkspaceEditResult>
    /** Give a registry-less member a `repo.yaml` identity, so it stops being an anonymous implicit
     *  repo (and is device-registry-locatable). Idempotent. */
    scaffoldRegistry(memberRoot: string, memberName: string, description?: string): Promise<WorkspaceEditResult>
    /** Native directory picker for choosing a member's repo folder; null on cancel. */
    pickFolder(): Promise<string | null>
  }
  /** Host launcher recents (local, per-machine, non-git). Pre-fills the last, lists the rest. */
  app: {
    /**
     * The workspace entry this instance was launched to open, from the launch environment
     *  (`AU_ENTRY`), or null for a plain launch. A spawned instance boots straight to this
     *  workspace instead of the recents pre-fill.
     */
    initialEntry(): Promise<string | null>
  }
  windows: {
    /** Open a workspace entry in its own host instance: focus the running instance for `entry` if
     *  one exists, else spawn a new one. `focused` is true when an existing instance was raised. */
    open(entry: string): Promise<{ focused: boolean }>
    /** Open a new host instance at the startup gate, with no entry preselected. */
    newWorkspace(): Promise<void>
  }
  recents: {
    /** Recent workspaces, most-recent first (stale entries pruned). */
    listWorkspaces(): Promise<RecentWorkspace[]>
    /** Record a workspace open (upsert + timestamp). */
    touchWorkspace(ws: TouchWorkspace): Promise<void>
    /** A workspace's recent compositions, most-recent first. */
    listCompositions(root: string): Promise<RecentComposition[]>
    /** Record a composition open within a workspace (upsert + timestamp). */
    touchComposition(root: string, compositionPath: string): Promise<void>
  }
  /** The MAIN-owned restorable view-state auto-store (cursor / scroll / folds), keyed by composition + pool
   *  node id + sub-key. A renderer HYDRATES a composition's subtree once at boot (so a sync `get` reads a
   *  local cache), then writes each change through immediately; MAIN coalesces the disk flush, so the high
   *  write frequency never touches the authority wire. Because it is keyed by identity, a floated pane keeps
   *  its view-state across the window boundary. */
  viewState: {
    /** One composition's `nodeId -> subKey -> value` subtree, to seed a renderer's cache. SYNCHRONOUS (a
     *  `sendSync`) so a renderer can hydrate the cache BEFORE the first pane's sync `get`, without a race.
     *  Called once per composition load — rare, so the brief block is fine; the frequent `set` stays async. */
    load(comp: string): Record<string, Record<string, unknown>>
    /** One (composition, node) `subKey -> value` subtree. SYNCHRONOUS. Refreshes a SINGLE pane's slot from
     *  the authoritative store when it mounts — a pane moved into an already-open window whose cache predates
     *  the pane's latest state reads the truth here rather than its window's stale cache. */
    loadNode(comp: string, node: string): Record<string, unknown>
    /** Write one (composition, node, subKey) value (fire-and-forget; main debounces the disk flush). */
    set(comp: string, node: string, sub: string, value: unknown): void
    /** Drop a composition's entries whose node is not in `liveNodeIds` (prune after a layout save). */
    prune(comp: string, liveNodeIds: string[]): void
    /** Drop every entry for a composition (it was deleted). */
    drop(comp: string): void
  }
  /** CROSS-WINDOW THEME SYNC. Theme is APP-GLOBAL per-machine state, so a change in any window must reach
   *  every other. `changed` relays this window's new state UP to main; main fans it OUT to every OTHER
   *  window's `onApply`, which applies AND persists it (origin-independent, so each window's next boot is
   *  right). The one-authority hub pattern, like the main-relayed view-state / focus. */
  theme: {
    /** Relay this window's new theme state to the others (through main). */
    changed(state: ThemeSyncState): void
    /** Subscribe to another window's theme change, relayed by main. Install once per renderer at boot. */
    onApply(cb: (state: ThemeSyncState) => void): void
  }
  engine: {
    read(entryPath: string, request: ReadRequest): Promise<EngineReadResult>
    subscribe(
      entryPath: string,
      request: SubscribeRequest,
      onEvent: (event: SubscriptionEvent) => void,
    ): () => void
    /**
     * Watch engine readiness for an entry — the main-process managed connection's
     * `connected` state. `onReady` fires with the current value immediately, then
     * on every transition. Returns an unwatch function. Replaces the renderer's
     * daemon-status poll (the engine-readiness STAND-IN).
     */
    watchReady(entryPath: string, onReady: (ready: boolean) => void): () => void
    /**
     * Register a repo's device-global location (`~/.arsumbris/au-engine/config/repos.yaml`) via the daemon,
     * then rebuild so a newly-locatable member mounts. The schema-12 folder-picker bootstrap for a
     * `peer-unmounted` dependency. `path` is the repo's absolute local path; `remote` optional.
     */
    register(entryPath: string, name: string, path: string, remote?: string): Promise<RegisterResult>
    /** Read the per-user device-global config (`repos.yaml` / `workspaces.yaml`) + its diagnostics. */
    deviceConfig(entryPath: string): Promise<DeviceConfigResult>
  }
  projections: {
    isDevelopment(): Promise<boolean>
    resolveSource(key: string, directory: string, entry: string, fromDisk: boolean): Promise<string>
    watchBuild(directory: string, enabled: boolean): Promise<void>
    onBuild(listener: (event: { root: string }) => void): () => void
    /** Map `au-projection://<key>/` to a built-ESM directory on disk. */
    registerSource(key: string, directory: string): Promise<void>
    unregisterSource(key: string): Promise<void>
  }
  // The host file capability uses the engine's `content` read for reads and existence checks, and the
  // governed member-aware mutation channel for writes and deletion. It does not access raw filesystem data.
  files: {
    read(entryPath: string, path: string): Promise<FileReadResult>
    write(
      entryPath: string,
      path: string,
      content: string,
      expectedHash?: string,
    ): Promise<FileWriteResult>
    exists(entryPath: string, path: string): Promise<boolean>
    delete(entryPath: string, path: string, expectedHash?: string): Promise<FileWriteResult>
    /** Move `from` to `to`, rewriting inbound references (engine `rename`). Same-repo only. */
    rename(entryPath: string, from: string, to: string): Promise<FileWriteResult>
  }
  // Engine FILE ASSETS as loadable URLs: resolve a `file*` reference to an absolute
  // path over the engine, serve its bytes on the `au-asset://` origin. Backs the
  // `MountHost.assets` capability. See host-sdk `AssetsControl`.
  assets: {
    /** A `file*` reference (a `[[wikilink]]` or repo-relative path) to a loadable URL, else null. */
    url(entryPath: string, fileRef: string): Promise<string | null>
  }
  // Change a member's file scope through the governed `set_ignores` mutation.
  // Read ignore rules through `host.engine`; the app-owned scope capability supplies the mutation path.
  scope: {
    /**
     * Replace member `root`'s `.auignore` lines with `patterns` (a FULL replacement;
     * empty removes the file → default excludes). Delete-style envelope (`hash` null);
     * the returned `version` already reflects the re-scope. Rejects a non-member `root`
     * or a malformed pattern with no write.
     */
    setIgnores(entryPath: string, root: string, patterns: string[]): Promise<FileWriteResult>
  }
  dialog: {
    /**
     * Native open dialog for the boot gate: picks the workspace FOLDER (a folder-repo
     * entry). Directory-only. Returns the chosen path, or
     * null if the user cancelled.
     */
    select(): Promise<string | null>
    /** Generic native picker for a file or a directory (setup flows). Null if cancelled. */
    pickPath(kind: 'file' | 'directory'): Promise<string | null>
  }
  gate: {
    workspaceTemplates(): Promise<WorkspaceTemplateCatalog>
    materializeWorkspace(request: MaterializeWorkspaceRequest): Promise<CreateWorkspaceResult>
    /**
     * Validate a boot-gate selection with RAW filesystem checks (daemon-free, so it runs
     * before the engine starts). The entry must be a DIRECTORY carrying `.arsumbris/repo.yaml`;
     * a file, or a missing folder, is a problem. A directory that is merely not a repo YET
     * comes back as `notARepo` rather than a problem — see `GateInspection`.
     */
    inspect(target: string): Promise<GateInspection>
    /** Discover the full setup closure from the entry-point bundles, given what's located so far
     *  (name → absolute path). Drives the nested locate checklist. */
    discoverClosure(located: Record<string, string>): Promise<ClosureResult>
    /** Scan a folder for repos matching any of `names` (the general form; open-time locate). */
    scanFor(folder: string, names: string[]): Promise<FoundDep[]>
    /** The entry's declared members (`workspace.yaml` `edit:` + `discover:`, plus `repo.yaml` `deps`)
     *  NOT located in the device `repos.yaml` (would not mount). The pre-daemon first-run detector
     *  for a freshly-cloned workspace. */
    missingLocations(entry: string): Promise<string[]>
    /** Register located members into the device `repos.yaml` (pre-daemon raw writer). */
    locateMembers(entries: FoundDep[]): Promise<{ ok: boolean; error?: string }>
    /** Turn an existing plain directory into a folder-repo entry (writes `.arsumbris/repo.yaml` +
     *  `workspace.yaml`), so the engine will open it. Backs the gate's not-a-repo scaffold offer.
     *  Idempotent; the repo name defaults to the folder's basename. */
    scaffoldEntry(dir: string, name?: string): Promise<CreateWorkspaceResult>
    /** Create a workspace in `dir` named `name` with the located deps; returns the entry folder path. */
    createWorkspace(dir: string, name: string, deps: FoundDep[]): Promise<CreateWorkspaceResult>
  }
  /**
   * The mount / proxy command protocol transport. A SURFACE is a secondary window the
   * AUTHORITY (the main renderer's CompositionRuntime) drives — keyed by its WINDOW-NODE POOL ID, never
   * a `webContents.id` (which changes across a reload). Main is the IPC broker: it opens the window,
   * relays `SurfaceCommand`s DOWN to it and `SurfaceEvent`s UP to the opener, each tagged with the
   * surface id (derived from the sender, never trusted). It owns no protocol logic — the generation
   * guard + mount decisions live in the renderers.
   */
  surface: {
    /** (authority) Open an OS window for a surface, keyed by its window-node pool id. Idempotent — an
     *  already-open surface id focuses its window. The mount agent boots empty and signals `onReady`. */
    open(req: SurfaceOpenRequest): Promise<void>
    /** (authority) Close a surface's window by id. */
    close(surfaceId: string): Promise<void>
    /** (authority) Raise + focus the MAIN window (surface-0). For when an action in a secondary surface
     *  needs the user in the main window — e.g. dock opens the spatial chooser there, so the user should
     *  not have to click the main window first. */
    focusMain(): void
    /** (authority) A surface's mount agent signalled ready — the authority starts driving it. Disposer. */
    onReady(listener: (surfaceId: string) => void): () => void
    /** (authority) A surface window closed (user or programmatic). Returns a disposer. */
    onClosed(listener: (surfaceId: string) => void): () => void
    /** (authority) A surface's RENDERER crashed / was force-killed (`render-process-gone`, not a clean
     *  close). Its window-node stays dormant in the pool; the authority OFFERS to reopen it. Fires BEFORE
     *  the `onClosed` that the crash's window teardown also triggers. Returns a disposer. */
    onCrashed(listener: (surfaceId: string) => void): () => void
    /** (authority) The user asked to close a surface's OS window (the traffic-light / cmd-W). Main has
     *  PREVENTED the close and asks the authority what to do — an EMPTY window closes+reaps directly, a
     *  NON-EMPTY one prompts (a host `confirm-close` command rendered IN the closing window). A PROGRAMMATIC
     *  close (dock / move / quit) never reaches here. Distinct from a CRASH (involuntary → reopen). Disposer. */
    onCloseRequested(listener: (surfaceId: string) => void): () => void
    /** (authority) Drive a command onto surface `surfaceId`. Main guards the sender owns the window. */
    sendCommand(surfaceId: string, command: SurfaceCommand): void
    /** (authority) A surface reported an event, tagged with its surface id (main derives it from the
     *  sender, so a surface can't spoof another's). Returns a disposer. */
    onEvent(listener: (surfaceId: string, event: SurfaceEvent) => void): () => void
    /** (surface agent) Signal the mount agent is ready; the host replies with `onInit`. */
    ready(): void
    /** (surface agent) Receive the bootstrap params once. Returns a disposer. */
    onInit(listener: (init: SurfaceInit) => void): () => void
    /** (surface agent) Receive a command routed to this window by the authority. Returns a disposer. */
    onCommand(listener: (command: SurfaceCommand) => void): () => void
    /** (surface agent) Report an event up; main tags it with this surface's id and relays to the opener. */
    sendEvent(event: SurfaceEvent): void
  }
  /**
   * Host-owned pty terminal sessions, keyed per-pane (compositionId + stable nodeId).
   * The pty backend lives in the main process; a renderer terminal projection reaches
   * it ONLY through `host.terminal` (this is the process-boundary half). A session
   * survives a remount (detach + reattach to the same pty); it dies on pane removal
   * (reconcile), explicit close, process exit, or app quit.
   *
   */
  terminalPreferences: NonNullable<import('@arsumbris/au-host-sdk').MountHost['terminalPreferences']>
  terminal: {
    /**
     * Attach to this pane's session, spawning the pty if absent. `onData` receives the
     * replayed scrollback then the live stream; `onExit` fires when the pty ends.
     * Returns the session controls.
     */
    attach(
      comp: string,
      node: string,
      opts: TerminalAttachOptions,
      onData: (data: string) => void,
      onExit: () => void,
    ): {
      /** Forward keystrokes to the pty stdin. */
      write(data: string): void
      /** Resize the pty (driven by the xterm fit). */
      resize(cols: number, rows: number): void
      /** Inject text into the session (the agent-driver seam; today the same as write). */
      send(text: string): void
      /** Stop listening (the view unmounted). Does NOT kill the session. */
      detach(): void
      /** Explicit kill: terminate the pty + drop the session. */
      close(): void
    }
    /**
     * Tell the host which of `comp`'s panes still exist in the live layout; sessions for
     * removed panes (closed) are killed. Reshuffle-safe: a moved node stays in the set.
     */
    reconcile(comp: string, liveNodeIds: string[]): void
    /** The shell's current working directory (queried from its pid). The renderer polls
     *  this to persist the live cwd, so a reopened terminal spawns where you last were. */
    cwd(comp: string, node: string): Promise<string | undefined>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The mount / proxy command protocol.
//
// The AUTHORITY (one renderer's CompositionRuntime) owns the pool and the mount DECISION; a SURFACE
// (a window — main or secondary) owns only the DOM. The authority drives each surface with
// SurfaceCommands and receives its SurfaceEvents back. Every command carries a per-record GENERATION,
// so a surface drops a stale command (max-gen-wins): mount→unmount→mount is idempotent under
// reordering, and an in-flight command to a record the surface has advanced past is discarded.
//
// ONE model, two transports: in-process for surface 0 (resolves to local calls) and IPC for
// secondaries (crosses the process boundary). The message types carry OPAQUE payloads (`unknown` for
// config / intent / selection, cast to the renderer's `OpaqueConfig` on receipt), so this file stays
// import-safe for both processes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A serializable mount slot — a DOM element cannot cross the process boundary, so the authority names
 * WHERE within a surface a record mounts and the surface resolves it to a real element locally.
 *
 * A window mounts its single `content` mountable, so the only slot today is the window's content root.
 * Discriminated so (a floated CONTAINER with child panes) can add a container-path slot with
 * no reshape of the callers.
 */
export type SlotDescriptor = { kind: 'window-content' }

/**
 * AUTHORITY → SURFACE. A command driving one pool record's mount on a surface.
 * - `mount` / `remount` carry the resolved projection `typeName` (the surface resolves it to a
 *   loadable registration) plus the record's `config` and its `slot`; `remount` is a mount whose
 *   IDENTITY changed (tear down + re-mount), decided AUTHORITY-side from the pool, never remote DOM.
 * - `reflect` delivers a new `config` to an already-mounted record IN PLACE (no remount); it rides the
 *   record's CURRENT generation (it is a content update, not a lifecycle transition).
 * - `unmount` tears the record down.
 * `gen` is the per-record generation the authority assigns; `mount`/`remount`/`unmount` each advance it.
 */
export type SurfaceCommand =
  | { op: 'mount'; id: string; gen: number; typeName: string; config: unknown; slot: SlotDescriptor }
  | { op: 'reflect'; id: string; gen: number; config: unknown }
  | { op: 'remount'; id: string; gen: number; typeName: string; config: unknown; slot: SlotDescriptor }
  | { op: 'unmount'; id: string; gen: number }
  // POOL-SYNC: the authority mirrors the surface's subtree RECORDS (flat, referenced form)
  // down after any pool change, so the surface's proxied `children.pool` cache can serve `resolveRecord`
  // and fire `subscribe` — the seam a container re-reads through on an external structural edit. Carries a
  // full snapshot of the records reachable from the surface's window content; the surface replaces its
  // cache and notifies subscribers. Not generation-guarded (it is pool state, not a per-record lifecycle).
  | { op: 'pool-sync'; records: ReadonlyArray<{ id: string; config: unknown }> }
  // GRANT: the authority hands the surface a BLOCK of pool ids (the granted id-range), so a
  // floated container mints a FINAL, globally-unique `^:` SYNCHRONOUSLY without a per-draw round-trip. Sent
  // on ready (the initial active + reserve blocks) and on each `grant-request` refill. `{prefix, size}` is
  // the `IdBlock` shape (id-allocator.ts); an id is `${prefix}-${index}`. Not generation-guarded.
  | { op: 'grant'; blocks: ReadonlyArray<{ prefix: string; size: number }> }
  // CLAIM (gather-then-commit): the authority asks whether a REMOTE candidate — the handler
  // owned by record `id` on this surface — would CLAIM this intent. PURE: the surface runs the handler's
  // `claim` predicate and replies `claim-reply`; it does NOT act. The authority gathers these across windows
  // IN PARALLEL, then COMMITS only the winner. `cid` correlates the reply; `from` is the firer's RECORD id
  // ('s stable cross-window identity), which the surface maps to its own local publisher. Gen-
  // independent (not a lifecycle transition), so handled before the generation guard.
  | { op: 'claim'; id: string; cid: number; from: string; intent: unknown }
  // COMMIT: the authority tells the WINNING remote candidate to ACT — the surface runs record
  // `id`'s handler `commit`. Aimed (no walk); sent only to the first claimer, so exactly one actor.
  // `from` is the firer's RECORD id (see `claim`). `raise` (a ROUTED intent, never a broadcast) SURFACES the
  // OS window — a routed intent that lands here is a deliberate outcome the user should see (a cross-window
  // open), whereas a broadcast fan-out is passive and must never steal focus. `cause` is the authority's
  // causal-pass id: the surface runs the commit UNDER it, so a nested fire the commit makes carries it back
  // UP (`intent-fired`), letting the authority resume the same pass — the cross-window cycle guard.
  // `cid`: present when the authority wants a `commit-reply` ACK — the ROUTED re-home case, where
  // the winner acting-or-not decides whether the loop falls to the next claimer. The surface runs the
  // commit, catches a throw (a "could not act", state changed since the gather), and replies whether it
  // ACTED. Absent for a BROADCAST fan-out (no re-home) and an AIMED-no-fallback delivery: fire-and-forget.
  | { op: 'commit'; id: string; from: string; intent: unknown; raise?: boolean; cause?: number; cid?: number }
  // SELECTION-DELIVER: the ENCLOSING-CONTAINER selection a surface record FOLLOWS changed at the
  // authority's SelectionTree (which spans windows). The authority hands it down to the follower record on
  // this surface, which routes it to the callbacks `host.selection.follow` registered. The DOWN twin of the
  // `selection-follow` / `selection-published` events. Payload-opaque; not generation-guarded (channel state).
  | { op: 'selection-deliver'; id: string; value: unknown }
  // WINDOWS-CHANGED: the set of open windows changed (a float / dock / move / close). The
  // authority pushes the fresh `WindowSite` list to EVERY surface so its LOCAL "Move to other window" picker
  // renders in the window where it was triggered — the picker never has to round-trip for the list. Same
  // push pattern as `pool-sync`; near-static, tiny; not generation-guarded (it is window-set state).
  | { op: 'windows-changed'; windows: readonly WindowSite[] }
  // CONFIRM-CLOSE: the user asked to close this NON-EMPTY floated window (main prevented the OS close
  // and the authority found its content non-empty). Render the confirm IN THIS window — the closing one —
  // reusing its own host chooser: Close (→ `close-window` up: reap + close), Cancel (dismiss, the window
  // stays), or "move its panes to another window" (→ the surface's existing whole-content move-to-window,
  // which relocates then closes this window). A deliberate close, so NEVER the crash reopen. Not gen-guarded.
  | { op: 'confirm-close' }
  // GATHER-CLOSE-GUARD (close-removal lifecycle, cross-window): the authority is about to REAP a record that
  // lives on THIS surface (a floated pane), and that record reported a close-guard capability. Ask the surface
  // to run its OWN close-guard consensus for record `id` — interactively (it may show a save/discard/cancel
  // dialog LOCALLY, where the content is) — and reply `close-guard-reply`. `cid` correlates the reply. This is
  // the body of the authority's PROXY guard: a guard registered in the authority's own CloseGuardTree on the
  // remote record's publisher whose implementation is this round-trip, so `reapOrHold` gathers it like any
  // guard. NO timeout on the wire (a dialog takes human time); a surface-death settles it withheld. Not gen-guarded.
  | { op: 'gather-close-guard'; id: string; cid: number }
  // ACTIVE-CHORDS (keybinds, cross-window native suppression): the authority mirrors DOWN the set of keydowns
  // that BEGIN a bound chord in the current context (each the FIRST `CanonicalKeystroke` of an active keybind,
  // focus-scoped by the authority's focused type, deduped). A floated window's gate uses it for a MEMBERSHIP
  // check only — `preventDefault` a native default IFF the keydown is in this set — then forwards the chord UP
  // for the real resolve. The surface holds no resolver; focus-specificity / ordering / firing stay authority-
  // side. Re-pushed on focus + keymap change (coalesced). Best-effort precision; a stale frame at worst
  // suppresses/permits one native default. Not gen-guarded (window-wide input state, like `windows-changed`).
  | { op: 'active-chords'; chords: readonly CanonicalKeystroke[] }
  // The active-pane RING for THIS surface window: the `^:` of the window's most-recently-focused pane (the
  // ONE aggregate recency FILTERED to this window at the authority), or null when this window has none. The
  // surface renders its own ring from it, GATED locally by its OS-focus (a blurred window shows none).
  // Pushed on change (a focus report, or a structural move re-scoping a head). Not gen-guarded (window-wide
  // state, like `active-chords`).
  | { op: 'active-pane'; activePane: string | null }
  // CLOSE-PANE: the authority resolved a close-view command
  // whose target is a pane in THIS surface window, so it DELEGATES the close here — the authority cannot reach
  // a surface's per-renderer container placement. The surface runs `closePane(id)` locally (its container
  // proposes the reference-removal UP; the authority reaps the orphan + gathers the close-guard). Not
  // gen-guarded (a window command, not a record lifecycle).
  | { op: 'close-pane'; id: string }

/**
 * SURFACE → AUTHORITY. An event a surface reports for one of its mounted records — the projection
 * saved its config, a pane took focus, a projection fired an intent, or one published a selection. The
 * authority applies these to its one set of trees (keyed by pool id), so a node in any window is an
 * ordinary member. Payloads are opaque (`unknown`).
 */
export type SurfaceEvent =
  | { kind: 'config-changed'; id: string; config: unknown }
  | { kind: 'focus'; id: string }
  // `cause` (when the fire happened INSIDE a commit the authority sent under a causal pass) carries that
  // pass id back UP, so the authority resumes the same pass and the cross-window cycle guard spans windows.
  | { kind: 'intent-fired'; id: string; intent: unknown; cause?: number }
  | { kind: 'selection-published'; id: string; selection: unknown }
  // SELECTION-FOLLOW: record `id` on this surface wants (`follow`) or stops wanting (`unfollow`)
  // its ENCLOSING container's selection. The authority registers a follower on the record's publisher in its
  // SelectionTree (pool-parent-derived, so it follows the right container across windows) that delivers
  // `selection-deliver` DOWN. The UP twin of `selection-deliver`.
  | { kind: 'selection-follow'; id: string; op: 'follow' | 'unfollow' }
  // PROPOSE: a structural edit a floated container built (a re-parent / reorder / wrap of its
  // OWN panes). The surface holds no write; it BUILDS the edit batch (pure) and asks. The authority applies
  // it via `applyStructural` (the sole committer), then mirrors the result back with `pool-sync`. Edits are
  // `{ id, record }` (a pool record id → its new config), the same shape the local propose channel uses. A
  // MINTED group edit may carry EMBEDDED children (the surface has no schemas to flatten) — the authority
  // NORMALIZES each edit before applying, so the surface stays thin.
  | { kind: 'propose'; edits: ReadonlyArray<{ id: string; record: unknown }> }
  // MINT adds surface-created content immediately, without reaping, before the following `config-changed`
  // references it. FIFO delivery preserves that ordering. The surface stamps an ID from its granted range;
  // the authority normalizes embedded group children while retaining existing authoritative records.
  // Both bounded `createRecord` and `createGroup` use this event; structural edits use `propose`.
  | { kind: 'mint'; edits: ReadonlyArray<{ id: string; record: unknown }>; transient?: boolean }
  // SET-TRANSIENT: a floated container declared a child transient (a preview) or promoted it to
  // permanent. `setTransient` is per-window-local, so this carries the flag UP to the authority's
  // `pool.transient` (the set serialize consults). Fire-and-forget, symmetric with `mint`.
  | { kind: 'set-transient'; id: string; transient: boolean }
  // GRANT-REQUEST: the surface's id-range ran low and asks for another block. The authority
  // replies with a `grant` command. Fire-and-forget from the surface (the reserve covers the gap).
  | { kind: 'grant-request' }
  // CLAIM-REPLY: the surface's reply to a `claim` query — whether the addressed handler's pure
  // `claim` predicate returned true. `cid` correlates it to the query; the authority's parallel gather awaits
  // it, and a hung/closed surface is treated as a DECLINE by the query's timeout (so it never stalls the gather).
  | { kind: 'claim-reply'; cid: number; claimed: boolean }
  // COMMIT-REPLY: the surface's ack to an ack-carrying `commit` (a routed winner). `acted` is
  // whether the addressed handler's `commit` ran without throwing — a throw is the framework's "could not
  // act, state changed since the gather" signal. `cid` correlates it to the command; a hung/closed surface
  // resolves DECLINE via the query's timeout, so the authority's gather-then-commit RE-HOMES to the next
  // claimer rather than silently losing the intent (the cross-window half of the commit-failure fallback).
  | { kind: 'commit-reply'; cid: number; acted: boolean }
  // CAPABILITY: the surface declared (`add`) or dropped (`drop`) an intent handler for one of
  // its records (`host.intent.handle`). The authority registers a REMOTE-candidate stub in its IntentTree so
  // the record is a first-class ambient candidate a fired intent can route to across the window boundary.
  | { kind: 'capability'; id: string; intentType: string; op: 'add' | 'drop' }
  // MOVE-TO-WINDOW: the surface's "Move to other window" affordance — the user already PICKED
  // the target window in THIS (invoking) window's local chooser. The authority re-parents the subtree to
  // `targetWindowId`. `subtreeId` is the pool `^:` (stable cross-window). `sourceEdit` is the invoking
  // window's pre-computed post-EXTRACT record for a NESTED move (the source container after the subtree is
  // pulled, computed here because the container's `poolEdit` is local to this renderer, exactly as `float`
  // does); ABSENT for a WHOLE-WINDOW move (the subtree IS this window's content), where the authority splices
  // the source window root and auto-closes the emptied secondary. Moving to main docks the content. Every event carries a record ID: the authority knows every window record.
  // `wrapKind` (the TWIN-PICK): a move into an OCCUPIED SECONDARY window WRAPS
  // [content, moved] into a container — the invoking (secondary) window picks WHICH here, so the chooser
  // renders where the user acted, not at the authority. Absent for a move to MAIN (its spatial pick decides)
  // or when only one wrap target exists. The authority uses it in `injectOccupantIntoSecondaryRoot` in place
  // of its own ask / silent default.
  | { kind: 'move-to-window'; subtreeId: string; sourceEdit?: { id: string; record: unknown }; targetWindowId: string; wrapKind?: string }
  // REPOINT-ROOT: a floated window's ROOT re-point — unwrap-to-window-root fired in a SECONDARY
  // window. The surface's root placement (the symmetric twin of the main `rootContentPlacement`) has no pool,
  // so it proxies the re-point UP: the authority owns the window record and re-points THIS window's `content`
  // from `currentContentId` to `newContentId` via `repointWindowContent`. `currentContentId` is the window's
  // present content `^:` (the single-child container being dissolved); `newContentId` is its lone child, lifted
  // to become the window content. The window is located by `currentContentId` (any root, not just primary).
  | { kind: 'repoint-root'; currentContentId: string; newContentId: string }
  // CLOSE-WINDOW: the user CONFIRMED "Close" in the `confirm-close` dialog rendered in this window (a
  // deliberate discard, gated by the prompt). The authority splices this window's root and reaps its content
  // subtree, then closes the OS window — the panes leave the composition (the FILES are untouched). "Cancel"
  // emits nothing (the window stays); "move to another window" reuses `move-to-window` (relocate then close).
  | { kind: 'close-window' }
  // TRACE: a surface RELAYS an event from its own per-renderer event substrate up to the
  // authority, so the authority's ONE ring + `trace-inspector` span windows. Pull-safe (a subscriber on the
  // surface substrate forwards new events, never on the emit path). The authority re-records it with a
  // `surface` attribution field and PRESERVES its cause — a surface never mints a cause (it has no IntentTree),
  // so the cause is either absent or the authority's own (resumed during a commit), which threads correctly.
  | { kind: 'trace'; event: HostEvent }
  // KEYSTROKE: a floated window's keybind gate canonicalized + arbitrated a keydown
  // LOCALLY, and a surviving chord candidate (never plain typing) crosses UP. The authority resolves it
  // against its cross-window focus tree (which reflects this surface's focus via the `focus` events above)
  // and the composition's active keymaps, then fires — the SAME resolver the main window uses. The surface
  // adds NO resolver of its own. `emit` flushes the surface's pending focus before this, so focus is current.
  // `focus` CARRIES this window's transient focused pane `^:` (resolved locally at keystroke time, or absent
  // when focus sits in chrome), so the authority resolves the command's TARGET + when-context against the
  // ORIGINATING window — never main's DOM / the aggregate head.
  | { kind: 'keystroke'; ks: CanonicalKeystroke; focus?: string }
  // CLOSE-GUARD-CAPABILITY (close-removal lifecycle, cross-window): record `id` on this surface registered
  // (`add`) or dropped (`drop`) a close-guard (`host.closeGuard.register`). The authority mirrors presence by
  // registering (or dropping) a PROXY guard on the record's publisher in its own CloseGuardTree — so the reap
  // seam's SYNCHRONOUS `hasGuardAmong` fast-path stays sound for a remote record, and only a genuinely guarded
  // reap goes async. Reported on the 0→1 / 1→0 edge (net presence per record), mirroring the intent `capability`.
  | { kind: 'close-guard-capability'; id: string; op: 'add' | 'drop' }
  // CLOSE-GUARD-REPLY: the surface's reply to a `gather-close-guard` query — whether record `id`'s local
  // close-guard consensus CONSENTED to the close. `cid` correlates it to the query the authority's proxy guard
  // awaits. `false` blocks the reap (content-preserving); a surface-death settles the query `false` too.
  | { kind: 'close-guard-reply'; cid: number; consented: boolean }

/**
 * One open window, as the "Move to other window" picker sees it. Identity is the window-node
 *  pool `^:`; `title` is what the picker shows; `primary` marks the main window. Pushed to surfaces via
 *  `SurfaceInit.windows` + the `windows-changed` command so each window's LOCAL picker renders the list.
 */
export interface WindowSite {
  id: string
  title: string
  primary: boolean
}

/** Bootstrap params handed to a surface's mount agent once it signals ready. The agent boots EMPTY and
 *  waits for `mount` commands (the command protocol carries what to mount), so this is minimal: the
 *  engine root for entry-keyed reads, the surface's own identity, and the parent composition id for
 *  host-owned per-pane state keying. */
export interface SurfaceInit {
  /** The engine root, for entry-keyed engine/files IPC (engine reads stay main-direct). */
  entryPath: string
  /** This surface's identity — its WINDOW-NODE POOL ID (a stable `^:`), so a reload re-attaches. */
  surfaceId: string
  /** The parent composition's id, so host-owned per-pane state (the terminal pty) keys by the same
   *  composition and a floated pane reattaches to its original session. Absent → keyed under ''. */
  compositionId?: string
  /** The floated content's display title (from `WindowOptions.title`), shown in the surface chrome bar. */
  title?: string
  /**
   * The composition's VIEWER-DEFAULTS (per file kind → viewer), proxied from the authority so a floated
   *  container's file-open resolves the same default viewer the main window does, instead of falling to the
   *  chooser. Composition-GLOBAL and near-static, so it rides the init (sent once at open) rather than a live
   *  channel. this is `MountHost.viewerDefaults` on a surface.
   */
  viewerDefaults?: { opens: string; viewer: string }[]
  /** The composition's SLOT-DEFAULT placeholder (the empty-slot default), proxied for the same reason, so a
   *  floated container's empty slot resolves the composition's configured placeholder, not the picker.
   *  `MountHost.slotDefaults` on a surface; near-static, rides the init. */
  slotDefaults?: string
  /**
   * The open-window set at open time, so this surface's "Move to other window" picker has the
   *  list immediately; kept fresh by the `windows-changed` command.
   */
  windows?: readonly WindowSite[]
}

/** Request to open a surface window (a secondary mount surface the authority drives). Keyed by the
 *  window-node pool id, never a `webContents.id`. `options` mirrors the SDK `WindowOptions`. */
export interface SurfaceOpenRequest extends SurfaceInit {
  options?: { title?: string; bounds?: { x?: number; y?: number; width?: number; height?: number } }
}
