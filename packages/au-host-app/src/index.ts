// `HostApp` — the APP-OWNED capability tier, and the reason it is a package rather than a member
// of `@arsumbris/au-host-sdk`.

// TWO TIERS, ONE RULE:
//   `MountHost`  the published mount contract. EVERY projection gets it, cross-repo ones included.
//                Version-locked by `MOUNT_CONTRACT_VERSION`.
//   `HostApp`    `MountHost` PLUS the capabilities that operate on the APP ITSELF.

// The rule that decides the tier, and it is already encoded twice in deliberate pairs:
//   READ the workspace shape        -> the contract.  `workspace.members`, `engine.readIgnores`
//   MUTATE it, or drive the app     -> app-owned.     `workspaceEdit`, `scope`, `daemon`, `mcp`
// A one-sentence test: could a third-party projection hold this, safely, forever? Yes -> contract.

// WHY NOT IN THE SDK. These controls speak app vocabulary (daemon status, agent governance, skill
// manifests) that the mount contract deliberately never mediates — the same rule that keeps
// `range` / `selection` / `intent` in their own packages. See `./dto.ts` for the longer note.

// WHAT THIS IS NOT: an enforcement boundary. `makeMountHost()` returns a `HostApp` and every
// projection is mounted with that one object, so a projection that casts reaches `daemon` whatever
// it declares. That is deliberate today — the trust boundary is the AGENT BRIDGE, and a projection
// is code the user chose to install. This tier buys API CLARITY ("is this mine, or the app's?"),
// not a sandbox or runtime permission boundary.


// daemon, mcp, workspaceEdit and scope are app-owned capabilities.
// commitComposition exposes the guarded composition writer while its shared contract is provisional.

import type { MountHost, OpaqueConfig } from '@arsumbris/au-host-sdk'

import type {
  ActionResult,
  AgentProfileData,
  DaemonConfig,
  DaemonStatus,
  DeviceConfigResult,
  DiscoveredAdapter,
  DormantSessionsResult,
  InjectManifest,
  McpStatus,
  ProfileSaveResult,
  RetentionConfigResult,
  RetireSessionResult,
  SkillManifest,
  ToolPathsInfo,
  ToolPathsPatch,
  WorkspaceMemberListRole,
} from './dto.ts'

export type * from './dto.ts'

/** Daemon lifecycle, bound by the host to the active config. */
export interface DaemonControl {
  /** The active daemon config (live), for read-only display. */
  readonly config: DaemonConfig
  status(): Promise<DaemonStatus>
  start(): Promise<ActionResult>
  stop(): Promise<ActionResult>
  onLog(listener: (line: string) => void): () => void
  onExit(listener: (code: number | null) => void): () => void
  /**
   * Dev-only: turn engine operation tracing on or off for the NEXT daemon spawn (`AU_TRACE`).
   *
   * Read at spawn, so it never affects a running daemon — a caller that wants it live must
   * stop and start. Persisted with the rest of the daemon config, so it survives a reload
   * (and stays on until turned off, which is the point: you enable it, then reproduce).
   *
   * A boolean, not an environment: the renderer never supplies env to a spawn. Main decides
   * what this flag is allowed to mean. See `DaemonConfig.trace`.
   */
  setTrace(on: boolean): void
}

/**
 * Workspace editing capability (APP-OWNED by design). Add / remove a LOCAL member of
 * an existing workspace by editing the entry's `.arsumbris/workspace.yaml` (`edit:` / `discover:`).
 * The member mounts / un-mounts LIVE — no daemon restart. App-global, like ShellControl.
 *
 * `role` picks which list, hence the member's role: `edit` (authoring surface, live) or `discover`
 * (mounted for type-discovery, pinned, not editable). Defaults to `edit`.
 */
export interface WorkspaceControl {
  addMember(wsRoot: string, member: { name: string; memberPath: string; role?: WorkspaceMemberListRole; description?: string }): Promise<{ ok: boolean; error?: string }>
  removeMember(wsRoot: string, name: string): Promise<{ ok: boolean; error?: string }>
  /** Move a member between the entry's `edit:` and `discover:` lists (change its role). Refuses the entry
   *  repo (pinned to `edit:`); a `dep`/`entry` is not workspace.yaml-listed and cannot be moved. */
  setMemberRole(wsRoot: string, name: string, role: WorkspaceMemberListRole): Promise<{ ok: boolean; error?: string }>
  /** Enable / disable a declared member via the entry `workspace.yaml`'s `disabled:` overlay — it stays
   *  declared (role kept) but mounts nothing while disabled. Add to disable, remove to re-enable. */
  setMemberDisabled(wsRoot: string, name: string, disabled: boolean): Promise<{ ok: boolean; error?: string }>
  /** Declare `peerName` as a cross-repo dependency of the member at `memberRoot` (edits/creates its
   *  `.arsumbris/repo.yaml` `deps:`), making the repo self-describing. Clears an `undeclared-peer`. */
  declarePeer(memberRoot: string, memberName: string, peerName: string, remote?: string): Promise<{ ok: boolean; error?: string }>
  /** Give a registry-less member a `repo.yaml` identity. Idempotent. */
  scaffoldRegistry(memberRoot: string, memberName: string): Promise<{ ok: boolean; error?: string }>
  /** Native directory picker for a member's repo folder; null on cancel. */
  pickFolder(): Promise<string | null>
  /**
 * Register a repository's device-global location through the daemon, then rebuild
 * so a newly locatable workspace member can mount.
 */
  register(name: string, path: string, remote?: string): Promise<{ ok: boolean; error?: string }>
  /** Read the per-user device-global config (`repos.yaml` / `workspaces.yaml`) + diagnostics. */
  deviceConfig(): Promise<DeviceConfigResult>
}

/** Outcome of a scope re-write (the `set_ignores` mutation; `hash`-null delete-style envelope). */
export interface ScopeWriteResult {
  ok: boolean
  /** The post-mutation entry version — already reflects the new scope. */
  version?: number
  error?: string
}

/**
 * File-scope management for a workspace member (APP-OWNED by design).
 * The `ignores` READ goes through the contract's `engine` read surface (`readIgnores`);
 * only the `set_ignores` MUTATION needs a host path, so this control carries just the write.
 */
export interface ScopeControl {
  /**
   * Replace member `root`'s `.auignore` lines with `patterns` — a FULL replacement.
   * An empty list removes the file, reverting to the default excludes. `root` is a
   * member root from the `ignores` read; a non-member `root` or malformed pattern rejects.
   */
  setIgnores(root: string, patterns: string[]): Promise<ScopeWriteResult>
}

/**
 * The resolved selection for a new agent session — the fields of an `agent-profile`
 * (whether a saved instance or the ad-hoc launch picker's transient selection). Each field
 * is optional; an all-undefined `LaunchEnv` reproduces the plain launcher (all skills, no
 * governance overrides).
 */
export interface LaunchEnv {
  /** Kernel dormant-session ID; main resolves its adapter, recipe and profile. */
  resumeSession?: string
  /** The adapter to launch with, as the discovered `mcp.adapter` subtype's TYPE NAME (== the live
   *  `AdapterInfo.harness`). Absent = the host's count rule (a single discovered adapter, else pick). */
  adapter?: string
  /** Typed profile locator resolved by the agent layer for hooks and their configuration. */
  profile?: string
  /**
   * The native (CC-built-in) tools this session may use, by name (→ the launcher's `--native-tools`
   * → `AU_MCP_NATIVE_TOOLS`). OPEN, the same three-state shape as `tools`: undefined = every native
   * tool, `[]` = none (a "caged" session), a subset = only those.
   */
  nativeToolAllowlist?: string[]
  /**
   * The skills to inject, as manifest keys (`<owner>:<name>`) passed to `gen-skills --skills`.
   * Undefined = materialize ALL discovered skills (the plain launcher). `[]` = an empty profile
   * (no skills). A subset = only those skills.
   */
  skills?: string[]
  /**
   * The always-on inject context, as manifest keys (`<owner>:<name>`) passed to `gen-inject --inject`.
   * The OPEN model DIVERGES from `skills` — absent does NOT mean "all":
   * - `undefined` = the ROLE-SCOPED DEFAULT SET (entry/edit-owned injects fire; dep/discover are
   *   opt-in and do NOT). A consumed dependency offers context, it never imposes it.
   * - `[]` = no injects at all.
   * - a subset = exactly those injects (which may opt-in a `dep`/`discover` inject).
   * Each key resolves to a `--plugin-dir` at launch; inject is PREPAID (its full body costs every
   * session), which is why the picker meters bytes.

   */
  inject?: string[]
  /**
   * The tools this session may SEE, as agent-facing tool names (`au_host_intent_fire`), populated by the
   * picker / a loaded profile. Serialized to the `AU_TOOLS` env — a per-launch visibility allowlist.
   *
   * OPEN: the field's PRESENCE is the restriction, exactly like `skills` above.
   * - `undefined` = no restriction; `AU_TOOLS` is left UNSET, so the session sees every tool
   *   (including any shipped later).
   * - `[]` = no tools at all; `AU_TOOLS=''`. Deliberately distinct from unset.
   * - a subset = exactly those tools.
   *
   * Visibility is the whole axis. A tool's engine access is its own declaration on its def, with no
   * human control over it: an absent tools field allows all tools; a present field restricts them.
   */
  tools?: string[]
}

/** au-mcp daemon lifecycle, bound by the host to the active workspace (APP-OWNED by design). */
export interface McpControl {
  toolPaths?(): Promise<ToolPathsInfo>
  saveToolPaths?(patch: ToolPathsPatch): Promise<void>
  pathExists?(path: string): Promise<boolean>
  status(): Promise<McpStatus>
  start(): Promise<ActionResult>
  stop(): Promise<ActionResult>
  onLog(listener: (line: string) => void): () => void
  onExit(listener: (code: number | null) => void): () => void
  /** The discovered, launchable adapter set (`subtypes('mcp.adapter')`, gated) — for the launch picker.
   *  The count rule (0 warn / 1 auto / ≥2 choose) is the caller's. */
  listAdapters(): Promise<DiscoveredAdapter[]>
  /** Read the discovered-skills manifest for the launch picker (`gen-skills --manifest`). Adapter-scoped:
   *  `adapter` names the discovered subtype whose skills to read; absent = the host's single discovered adapter. */
  skillManifest(adapter?: string): Promise<SkillManifest>
  /** Read the discovered-injects manifest for the launch picker (`gen-inject --manifest`) — with role + prepaid byte cost. Adapter-scoped like `skillManifest`. */
  injectManifest(adapter?: string): Promise<InjectManifest>
  /** Save the ad-hoc selection as a named profile (`<ws>/operations/agent-profile/<name>.yaml`). */
  saveProfile(name: string, data: Omit<AgentProfileData, 'name'>): Promise<ProfileSaveResult>
  /** List the saved profiles. */
  listProfiles(): Promise<AgentProfileData[]>
  /** Delete a saved profile. `filePath` (from the listing) addresses the real instance file. */
  deleteProfile(name: string, filePath?: string): Promise<{ ok: boolean; error?: string }>
  /**
   * Session RETENTION (control-plane, over the au-mcp daemon socket — host/user authority, NEVER an
   * agent tool). au-mcp owns the storage + the window; the host is a pure client. Each degrades to a
   * legible `{ ok: false, error }` when the au-mcp daemon is not up, rather than throwing.
   */
  /** The dormant (cleanly-closed, resumable) sessions to show for "resume or clean up". */
  listDormant(): Promise<DormantSessionsResult>
  /** DRY-RUN blast radius: which dormant sessions a proposed window WOULD retire, before it applies. */
  retentionPreview(windowMs: number): Promise<DormantSessionsResult>
  /** The current dormancy retention window. */
  retentionConfig(): Promise<RetentionConfigResult>
  /** Persist a new dormancy window (au-mcp stores it privately; the host never names the storage). */
  setRetentionWindow(windowDays: number): Promise<RetentionConfigResult>
  /** Explicitly retire one named dormant session now (GCs its store). */
  retireSession(session: string): Promise<RetireSessionResult>
  /**
   * Build a new agent-session pane: a `terminal` instance running the selected adapter's
   * launch command at the workspace, wired to the mcp daemon. The host builds it (it owns the
   * tool paths); a container PLACES it via an open-pane-intent. Optional on the base control
   * (a detached window omits it). `env.caged` prepends `AU_CAGE=1` and `env.traceOff` prepends
   * `AU_TRACE=0` to govern THIS session (each overrides the workspace file). Returns `{ ok, pane? }`.
   */
  launchAgentSession?(env?: LaunchEnv): Promise<{ ok: boolean; error?: string; pane?: unknown }>
}

/** Outcome of an immediate root-composition commit. */
export interface CompositionCommit {
  ok: boolean
  /** The file changed underneath the guarded write — not persisted; re-read + retry. */
  conflict?: boolean
  error?: string
}

/** One node of the intent switchboard — a projection record in the composition's pool, and one
 *  endpoint a wire addresses. `id` is its pool block-id (`^:`, the wire address); `type` is its BARE
 *  projection type name (a display label). `fires` (output ports) and `handles` (input ports) are the
 *  bare intent names the node's type DECLARES, sourced from the same discovery the dispatch gate uses —
 *  so a drawn cable's ports can never disagree with what routing enforces. */
export interface CompositionNode {
  id: string
  type: string
  fires: string[]
  handles: string[]
  /** The handled intents this node is WIRE-ONLY for (`intent-reach`): its ambient reachability is
   *  CLOSED, so it receives them only via an explicit wire. A subset of `handles`. The overlay renders a
   *  closed input port slashed; toggling it calls `setReachability`. Empty when the node is fully ambient. */
  closed: string[]
}

/** One explicit intent routing on the composition (an `intent-wire`): `source` fires `intent`, and the
 *  host delivers it to `targets` instead of the default recipients. `source` / `targets` are pool
 *  block-ids; `intent` is a BARE intent type name (the host qualifies the def-ref to `::repo` on write).
 *  `mode` disposes a `once`-intent non-claim — `strict` (default) fails closed, `fallback` then walks the
 *  default MRU. The host owns the write; a projection never serializes a wire itself. */
export interface CompositionWire {
  source: string
  intent: string
  targets: string[]
  mode?: 'strict' | 'fallback'
}

/** One live intent DELIVERY, translated to pool ids — the switchboard animates a pulse along the cable
 *  it names. `source` fired `intent`, delivered to `target`; `viaWire` is true when a wire routed it (a
 *  drawn cable), false for default routing. Payload-opaque: only the bare intent type is carried. */
export interface DispatchEvent {
  source: string
  target: string
  intent: string
  viaWire: boolean
}

/**
 * The intent-switchboard editing capability (APP-OWNED). Read the composition's
 * projection NODES and its explicit intent WIRES, set / remove a wire, and OBSERVE the live intent flow.
 * Editing the composition DOCUMENT is app vocabulary, the same tier rule that keeps `workspaceEdit` off
 * the mount contract.
 *
 * A wire edit is IN-MEMORY: it applies to LIVE dispatch immediately (the wire works while unsaved) and
 * marks the composition DIRTY — "unsaved changes", exactly like a layout drag — with no disk write per
 * edit. The normal save flow persists it (the intent def-ref is `::repo`-qualified on save). `setWire`
 * upserts (one wire per (source, intent)). Optional on `HostApp`: present only on a ROOT composition
 * mount, absent on a detached window or a non-composition site (like `commitComposition` itself).
 */
export interface CompositionEditControl {
  /** The composition's projection records (the switchboard nodes), a live snapshot. */
  nodes(): CompositionNode[]
  /** The current wire table, parsed from the composition document. */
  wires(): CompositionWire[]
  /** Subscribe to node / wire changes (a placed pane, an edited cable); returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Upsert one wire (one-per-(source, intent)). Applies live + marks the composition dirty (in-memory). */
  setWire(wire: CompositionWire): void
  /** Remove the wire for (source, intent). Applies live + marks dirty. A no-op when absent. */
  removeWire(source: string, intent: string): void
  /** Set a node's AMBIENT reachability for one intent (`intent-reach`). `wire-only` closes it
   *  (ambient delivery skips it; a wire still lands); `ambient` reopens it (removes the rule). Applies live
   *  + marks dirty. `node` is a pool block-id, `intent` a BARE intent type name (qualified on write). */
  setReachability(node: string, intent: string, reachability: 'ambient' | 'wire-only'): void
  /** Observe the LIVE intent flow — one event per delivery, for the switchboard's cable animation.
   *  Returns an unsubscribe. Fires from the same dispatch the wires drive, so a pulse tracks a real
   *  routing (and a cycle-skipped echo never fires — the animation shows the guard working). */
  onDispatch(listener: (ev: DispatchEvent) => void): () => void
}

/**
 * Opening a workspace in its own host instance (APP-OWNED by design; it drives the app).
 * A workspace is one host instance: one process, one daemon, one window. A DIFFERENT workspace opens
 * a NEW independent instance rather than a second window of this one, and opening one that is already
 * open focuses it.
 */
export interface WindowControl {
  /** Open a workspace entry in its own host instance: focus the running instance for `entry` if one
   *  exists, else spawn a new one. `focused` is true when an existing instance was raised. */
  open(entry: string): Promise<{ focused: boolean }>
  /** Open a new host instance at the startup gate, with no entry preselected — the new-workspace flow. */
  newWorkspace(): Promise<void>
}

export interface HostApp extends MountHost {
  /** Daemon lifecycle (app-owned; DTOs are app vocabulary). */
  readonly daemon: DaemonControl
  /** au-mcp daemon lifecycle (app-owned; DTOs are app vocabulary). */
  readonly mcp: McpControl
  /** Add / remove a workspace member (app-owned, schema-15 coupled). Distinct from
   *  the contract's read-only `workspace.members`. */
  readonly workspaceEdit: WorkspaceControl
  /** Re-scope a member's `.auignore` file scope (app-owned, schema-15 coupled). The
   *  READ side is `readIgnores` over the contract's `engine` surface. */
  readonly scope: ScopeControl
  /** Open a workspace in its own host instance, or a new instance at the gate (app-owned;
   *  it drives the app). */
  readonly windows: WindowControl
  /** Commit the root composition to disk now, guarded (STAND-IN). */
  readonly commitComposition?: (next: OpaqueConfig) => Promise<CompositionCommit>
  /** Edit the composition's intent switchboard — read/set/remove its intent wires (app-owned;
   *  the WRITE rides on the guarded `commitComposition` writer). Present only on a
   *  ROOT composition mount, like `commitComposition`. The switchboard overlay is its consumer. */
  readonly compositionEdit?: CompositionEditControl
  /** Edit the composition's ACTIVE KEYMAP LIST (app-owned). Present only on a ROOT
   *  composition mount, like `compositionEdit`. The keymap editor is its consumer. */
  readonly keymaps?: KeymapsControl
}

/**
 * Edit the composition's ACTIVE KEYMAP LIST (APP-OWNED). Changing which keymap files are
 * active is a composition-DOCUMENT mutation that fits NEITHER existing bucket — it is not a
 * `composition-config` aspect (a keymap is a shareable, removable FILE, not inline config) and not a pool
 * edit (a keymap is not a projection record). So it gets its OWN narrow capability, the tier rule that keeps
 * `workspaceEdit` off the mount contract applied once more.
 *
 * Edits apply LIVE — the active keybinds change immediately (the resolver re-reads the list) — and mark the
 * composition dirty; the normal save flow persists them, exactly like a wire edit (no disk write per edit).
 * Precedence is list order (later overrides earlier for a chord). Operates on keymap NAMES (a keymap file's
 * stem, e.g. `default.keymap`); the host maps a name to its `[[name]]` reference in the document.
 */
export interface KeymapsControl {
  /** Composition sequence wait in milliseconds; zero disables automatic expiry. */
  sequenceTimeout(): number
  /** Applies live and marks the composition dirty, like keymap list edits. */
  setSequenceTimeout(milliseconds: number): void
  /** The active keymap names, in order. */
  list(): string[]
  /** Subscribe to changes in the active list (an add / remove / reorder, here or elsewhere). Returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Append a keymap to the active list. No-op if already present. Applies live + marks dirty. */
  add(name: string): void
  /** Remove a keymap from the active list. No-op if absent. Applies live + marks dirty. */
  remove(name: string): void
  /** Reorder the active list to exactly `names` (precedence = order). Applies live + marks dirty. */
  reorder(names: string[]): void
}
