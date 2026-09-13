// The APP-OWNED capability vocabulary: the DTOs `HostApp`'s controls speak.

// These live HERE, not in `@arsumbris/au-host-sdk`, and not in `app/src`, for two different reasons.

// NOT IN THE SDK. The mount contract is framework-agnostic and deliberately knows no app
// vocabulary — the same rule that keeps `range` / `selection` / `intent` in their own packages.
// A daemon's status, a skill manifest, an agent-launch selection: none of that is something
// the projection MOUNT contract should be able to name. Putting it there would make every
// cross-repo projection carry vocabulary it will never use.


// These app-owned DTOs live in a package that projections can import without depending on app/src.

// So this package is the ONE definition. `app/src/shared/daemon-api.ts` re-exports from here, so
// main and preload are unchanged and there is no second copy anywhere.

import type { ReadyProbe } from '@arsumbris/au-engine-sdk/wire'
import type { WireDeviceConfigResult } from '@arsumbris/au-engine-sdk/reads'

/** Where the daemon binary lives and which entry it serves. User-driven. */
export interface DaemonConfig {
  binaryPath: string
  entryPath: string
  /**
   * Dev-only: spawn the daemon with engine operation tracing on (`AU_TRACE`).
   *
   * A BOOLEAN, deliberately, not an env map. This config crosses the contextBridge from the
   * renderer and feeds a process spawn, so a raw `Record<string, string>` would let the renderer
   * inject arbitrary environment into a child. Main validates this privileged input and
   * translates the flag to the one variable it is allowed to set.
   *
   * Read at SPAWN, so it takes effect on the next daemon start, never on a running one. The engine
   * writes its trace to `<entry>/.arsumbris/au-engine/logs/trace/`.
   */
  trace?: boolean
}

export interface DaemonStatus {
  /** A daemon answered the ready probe on the entry's socket. */
  running: boolean
  /**
   * A daemon has recorded a live pid for this entry but its socket is NOT yet
   * answering: it is mid cold-build (starting) or wedged. Never true at the same
   * time as `running` — a serving daemon answers its socket. Surfaced so a booting
   * or stuck daemon reads as "starting", not the false "stopped" the collapsed
   * `running` flag gave, and so a non-owned wedged one can be offered for reclaim.
   * Mirrors the SDK's `SupervisedDaemonStatus.booting`.
   */
  booting: boolean
  /** The frame currently owns a spawned daemon child process. */
  ownedByFrame: boolean
  probe: ReadyProbe | null
  /**
   * The wire schema version the host speaks (the SDK's `WIRE_SCHEMA_VERSION`). The
   * client rejects a daemon on a different schema, so a connected daemon matches this;
   * surfaced so a stale daemon (which then won't connect) is diagnosable, not cryptic.
   */
  schemaVersion: number
  /**
   * Set when a daemon is REACHABLE on the entry's socket but speaks a DIFFERENT wire
   * schema than the host SDK — so the client rejects every frame and `running` stays
   * false. Distinguishes "daemon up but wire-incompatible" (update the SDK or the
   * binary) from "daemon still starting / stuck", which otherwise BOTH surface as the
   * generic not-serving timeout. `null`/absent when the daemon is unreachable or matches.
   */
  schemaMismatch?: {
    /** The `schema_version` the daemon reported. */
    daemonSchema: number
    /** The `schema_version` this host's SDK speaks (mirror of `schemaVersion`). */
    hostSchema: number
    /** Ready-to-display explanation (the SDK's `schemaMismatchMessage`). */
    message: string
  }
}

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * The adapter's own operation bins + agent-binary name, from `adapter-runtime-meta`.
 * The bin entries are paths RELATIVE to the adapter `dir`.
 */
export interface AdapterRuntime {
  launchEntry: string
  skillsEntry: string
  injectEntry: string
  contractVersion: number
  /**
   * The agent-executable name this adapter launches. au-host resolves its
   * LOCATION (PATH-first, then a per-machine `paths.yaml` `binaries` override) and passes `--binary`.
   * Optional defensively; every shipped adapter's `adapter-runtime-meta` sets it (required there).
   */
  agentBinary?: string
}

/**
 * A discovered, launchable MCP adapter — a `mcp.adapter` subtype gated on empty
 * `unmet_required_meta`. `name` is the type NAME (== the live `AdapterInfo.harness`), the
 * selection + join key. Enumerated over the engine `subtypes` read; see the main
 * `adapter-discovery` module. Crosses IPC via `mcp.listAdapters()` for the launch picker.
 */
export interface DiscoveredAdapter {
  name: string
  /** The adapter repo's package root (from `source.file`); the bins resolve relative to it. */
  dir: string
  runtime: AdapterRuntime
  /** `adapter-presentation-meta.label`, falling back to the type name. */
  label: string
  description?: string
}

/** Liveness of the host-owned au-mcp daemon (the agent-tools broker). */
export interface McpStatus {
  /** The host owns a live au-mcp child for this workspace. */
  running: boolean
  /** The child announced it is listening on its socket (ready to broker). */
  listening: boolean
}

/** One discovered skill in the launch picker's manifest (`gen-skills --manifest`). */
export interface SkillManifestEntry {
  /** `<owner>:<name>` — the selection ref (passed to `--skills`) and the `/<owner>:<name>` slug. */
  key: string
  /** The owner repo (also the CC plugin name). */
  owner: string
  /** The skill's invocable slug. */
  name: string
  /** What CC auto-invokes on — the same string the picker shows. */
  description: string
  /** The agent-facing tool names the skill pre-approves (aligns with the tool picker's keys). */
  allowedTools: string[]
  /** The instance file, for a "go to source" affordance. */
  path: string
}

/** The launch picker's skill discovery: what materialized, and what did not (visible-by-absence). */
export interface SkillManifest {
  skills: SkillManifestEntry[]
  /** Authored-but-not-materialized skills, with the reason (a discovery-debug surface). */
  skipped: Array<{ path: string; reason: string }>
}

/**
 * The member-role of an inject's owner. Drives the DEFAULT-SET-vs-opt-in split: `entry`/`edit`
 * are the always-on default set, `dep`/`discover` are opt-in (offered, never imposed). The
 * inject axis' OPEN model DIVERGES here — absent = this role-scoped default set, not "all".
 */
export type InjectRole = 'entry' | 'edit' | 'discover' | 'dep'

/** One discovered inject in the launch picker's manifest (`gen-inject --manifest`). */
export interface InjectManifestEntry {
  /** `<owner>:<name>` — the selection ref (passed to `--inject`), one identity across manifest/arg/profile. */
  key: string
  /** The owner repo. */
  owner: string
  /** The inject's stable slug. */
  name: string
  /** What this context IS, for the human deciding whether to pay for it — a cost label, NOT a trigger. */
  description: string
  /** The owner's member-role: entry/edit are the always-on DEFAULT SET, dep/discover are OPT-IN. */
  role: InjectRole
  /** The PREPAID byte cost — the full body injected every session, sized WITHOUT fetching content. */
  bytes: number
  /** The instance file, for a "go to source" affordance. */
  path: string
}

/** The launch picker's inject discovery: what will inject, and what could not be assembled (visible-by-absence). */
export interface InjectManifest {
  injects: InjectManifestEntry[]
  /** Authored-but-not-assembled injects, with the reason (a discovery-debug surface). */
  skipped: Array<{ path: string; reason: string }>
}

/**
 * A saved agent-launch profile — a real `agent-profile` INSTANCE, normally under
 * `operations/agent-profile/`, discovered by `instances_of` rather than by folder scan.
 *
 * At THIS boundary `skills` / `tools` are TYPED REFS as authored in the instance
 * (`[[example-skill::example-package]]`, `[[mcp.tool.read_file::au-mcp]]`), NOT the runtime
 * identities the launch consumes. The renderer maps between the two, because only it holds the
 * skill manifest and discovered tool list needed to resolve an owner.
 */
export interface AgentProfileData {
  /** Revision captured when loading the editable profile. */
  revision?: string
  /** The adapter this profile pins, as the discovered `mcp.adapter` subtype's TYPE NAME
   *  matching the live `AdapterInfo.harness`. Absent = the host's
   *  count rule (a single discovered adapter, else the user must pick at launch). */
  adapter?: string
  /**
   * Def-refs to the `mcp.hook` subtypes this session runs (`type<mcp.hook>*[]`), as wikilinks. OPEN,
   * tri-state like `tools`: undefined = every hook, `[]` = only the critical (mandatory) ones, a
   * subset = those plus the critical ones. Configuring a hook is the separate `hookConfig` axis.
   */
  hooks?: string[]
  /**
   * Typed config for hooks that take it (`mcp.hook&[+]`): inline-or-ref `mcp.hook` INSTANCES whose
   * fields ARE the config. A separate axis from `hooks` — it configures, it does not select. Absent =
   * inherit; present = a non-empty list of instances (inline record objects, not refs).
   */
  hookConfig?: unknown[]
  /** The filename stem (the user-chosen name). */
  name: string
  /** The instance file, so a delete addresses the real file even outside the conventional folder. */
  path?: string
  /**
   * Instance-refs to the `mcp.skill` files to inject; undefined = all discovered skills, `[]` = none.
   * OPEN: the field's presence is the restriction.
   */
  skills?: string[]
  /**
   * Def-refs to the `mcp.tool` subtypes the session may see (→ `AU_TOOLS`); undefined = every tool,
   * `[]` = none. OPEN, the same shape as `skills`. Absent and empty are DIFFERENT profiles and must
   * round-trip as such.
   */
  tools?: string[]
  /**
   * Instance-refs to the `mcp.inject` files this session injects (→ `gen-inject --inject`). The OPEN
   * model DIVERGES from skills/tools: undefined = the ROLE-SCOPED DEFAULT SET (entry/edit injects,
   * NOT all), `[]` = none, a subset = exactly those. Absent and empty are DIFFERENT profiles and
   * must round-trip as such.
   */
  inject?: string[]
  /**
   * The native (CC-built-in) tools this session may use, by name (→ `AU_MCP_NATIVE_TOOLS`). OPEN, the
   * same three-state shape as `tools`: undefined = every native tool, `[]` = none, a subset = only those. Owned by the au-mcp-sdk `agent-profile` type.
   */
  nativeToolAllowlist?: string[]
}

/** Outcome of saving a profile. */
export interface ProfileSaveResult {
  ok: boolean
  error?: string
  /** The sanitized name actually written. */
  name?: string
}

/**
 * A dormant (cleanly-closed, resumable) agent session in the au-mcp kernel's retention store.
 * Mirrors the au-mcp-sdk wire shape; the host re-declares it so the DTO tier stays decoupled.
 */
export interface DormantSession {
  harness?: string
  resumeRef?: string
  profile?: string
  /** The session id. */
  id: string
  /** The run counter (a resume-after-retire is a genuinely fresh run). */
  run: number
  /** Newest store-file mtime (ms) — the session's last activity. */
  lastActiveMs: number
  /** Total bytes of the session's durable store. */
  sizeBytes: number
}

/** The current dormancy retention window (how long a dormant session's store is kept). */
export type RetentionConfig = { windowDays: number; windowMs: number }

/** A list of dormant sessions, or a legible error (e.g. the au-mcp daemon is not up). */
export type DormantSessionsResult = { ok: true; sessions: DormantSession[] } | { ok: false; error: string }

/** The retention window, or a legible error. */
export type RetentionConfigResult = ({ ok: true } & RetentionConfig) | { ok: false; error: string }

/** The outcome of retiring one dormant session. */
export type RetireSessionResult = { ok: true; session: string } | { ok: false; error: string }

/** Result of reading the per-user device-global config (`repos.yaml` / `workspaces.yaml`). */
export interface DeviceConfigResult {
  ok: boolean
  /** The two device-global files + their field-shape diagnostics; null when no per-user config dir resolves. */
  config?: WireDeviceConfigResult | null
  error?: string
}

/** Which `workspace.yaml` list a member is declared in — its ROLE in the workspace.
 *  `edit` = an editable authoring surface; `discover` = mounted for type-discovery, pinned.
 *  (A `dep` is not authored here: it lives in a repo's own `repo.yaml`.) */
export type WorkspaceMemberListRole = 'edit' | 'discover'

// ── The startup-gate / launcher DTOs ────────────────────────────────────────────────────────────
// App-owned vocabulary the launcher speaks (`@arsumbris/au-host-launcher` imports these, the app's
// `MainApi` returns them). Here — not in `app/src/shared` — so the launcher package can import them
// without reaching into the app. `app/src/shared/daemon-api.ts` re-exports them, one definition.

/** The raw-fs validation of a boot-gate selection (daemon-free, runs before the engine starts). */
export interface GateInspection {
  /** The engine root — the entry folder itself (entry == root == home). */
  root: string
  /** True when there are no problems and the target is a folder-repo — safe to start the engine. */
  ok: boolean
  /** True when the target is a directory that simply is not a repo yet; the gate offers a scaffold. */
  notARepo: boolean
  /** Human-readable problems; empty when `ok` or `notARepo`. */
  problems: string[]
}

/** A located repo on disk during a folder scan. */
export interface FoundDep {
  name: string
  /** Absolute path to the located repo. */
  path: string
}

/** One member of the setup closure: its name, its located path (null = not found yet), and its `deps`. */
export interface ClosureMember {
  name: string
  /** Absolute path once located; null while still missing. */
  path: string | null
  /** The member's declared `repo.yaml` deps (populated only once located) — the checklist's sub-items. */
  deps: string[]
}

/** The discovered setup closure from the entry-point bundles — drives the nested locate checklist. */
export interface ClosureResult {
  /** The entry-point bundle names (the checklist roots). */
  roots: string[]
  /** Every needed member (roots + transitively reached via located members' deps), name-unique, sorted. */
  members: ClosureMember[]
  /** Members not yet located. */
  missing: string[]
  allLocated: boolean
}

/** Outcome of creating a starter workspace at the gate. `entryPath` is the folder to open on success. */
export interface CreateWorkspaceResult {
  ok: boolean
  /** Absolute path to the created folder-repo ENTRY (the directory the daemon is pointed at). */
  entryPath?: string
  error?: string
}

/** What `touchWorkspace` records for a just-opened workspace. */
export interface TouchWorkspace {
  /** The folder-repo entry that was just opened. */
  root: string
}

/** Per-machine tool locations, resolved from `~/.arsumbris/au-host/config/paths.yaml`. */
export interface ToolPaths {
  /**
   * Explicit override for the `au` engine daemon binary. Undefined = not configured, so the host
   * resolves `au` from PATH (see `resolveDaemonBinary`). File-based, so an install script can seed it
   * (`au: /abs/path/to/au`) for an out-of-the-box open without any UI step. An explicit value wins over
   * PATH discovery.
   */
  au?: string
  /** The au-mcp CLI entry. Undefined = not configured. */
  auMcp?: string
  /**
   * Per-machine AGENT-BINARY location overrides, keyed by the executable NAME an adapter's
   * `adapter-runtime-meta.agentBinary` declares. Consulted only when the
   * binary is NOT on `PATH` (PATH-first). Absent/empty = rely on `PATH`. The open, per-adapter
   * agent-binary config; see `resolveAgentBinary`.
   */
  binaries: Record<string, string>
  /** The node binary (defaults to `'node'`). */
  node: string
  /** Node args before the script (defaults to type-stripping). */
  nodeArgs: string[]
}

/** The resolved tool paths plus where they came from, for the config UI. */
export interface ToolPathsInfo {
  paths: ToolPaths
  /** The paths.yaml location (present whether or not the file exists yet). */
  file: string
  /** Set when the file exists but could not be read/parsed. */
  problem?: string
  /** Home-relative dev-default guesses, to prefill the setup UI (never written unless the user saves). */
  suggested: { auMcp: string }
}

/** A partial update to paths.yaml. An empty string clears a key (back to its default). */
export interface ToolPathsPatch {
  /** Explicit `au` engine-binary override; an empty string clears it (back to PATH discovery). */
  au?: string
  auMcp?: string
  /** Per-machine agent-binary overrides, keyed by executable NAME. Sent WHOLESALE (the settings UI
   *  posts the full map); an empty-string entry clears that override. See `ToolPaths.binaries`. */
  binaries?: Record<string, string>
  node?: string
  nodeArgs?: string[]
}

// TerminalPreferences belongs to the framework-agnostic MountHost contract.
// Re-export it here for app-side consumers.
export type { TerminalPreferences } from '@arsumbris/au-host-sdk'
