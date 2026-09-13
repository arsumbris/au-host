import { mountReloadableProjection } from './projection-reload'
import type { ActiveKeybind, PendingKeySequence } from '@arsumbris/au-host-sdk'
// The host-side composition runtime: the implementation behind
// `MountHost.children`. The SDK declares the contract and owns the RPC adapter
// but ships no loader, so resolving an id, loading the module, minting the
// child's host, and cascading unmounts are the host's job.
//
// One runtime per entry. Every mounted projection — top-level or nested — is a
// node in one tree, so unmounting any node tears down its whole subtree
// depth-first (children before self), exactly as the contract promises.
//
// A floated pane is a `window` pool record the authority realizes as an OS surface
// (`children.pool.float` / `moveToWindow`), driven by this one runtime — never a child mounted in
// its own second runtime.

import type { ChildHandle, ContainerOp, ContainerOpOutcome, ContainerSchemas, ContainerPlacement, HostCommand, HostResult, MountHost, LoadedModule, Occupant, PaneInstance, PublisherId, SnapshotNode, WindowOptions, ProjectionDescriptor, CompositionPool, PoolRecord, RawKeymap, CanonicalKeystroke } from '@arsumbris/au-host-sdk'
import { analyzePool, bareTypeName, blockRef, buildActiveKeybinds, detectGhostRefCollapse, ENTRY_SCOPE, formatChord, isDefinedProjection, KeybindDispatcher, linkPool, normalizeToPool, parentMap, parseBlockRef, primaryContentId, qualifyScopedId, reachableFromRoot, reachableRecordIds, recordMountType, reportHostDiagnostic, resolveLogicalParent, resolvePoolToTree, restoreCrossFileRefs, serializePoolToComposition } from '@arsumbris/au-host-sdk'
import type { ForeignFile, ScopeTable } from '@arsumbris/au-host-sdk'
import { classifyWireDelivery, removeWire, toAuthoredWires, upsertWire, validateWires } from './intent-wires'
import type { Wire, WireEndpoint } from './intent-wires'

import { activatePane, closePane, findPlacementByPane } from '@arsumbris/container-kit'

import { checkAgentIntent } from './agent-intent-gate'
import { activeKeymapsFor } from './keymap-registry'
import { paneIdOfActiveElement } from './pane-focus'
import type { ProjectionRegistration } from './loader'
import type { ChromeContribution, CompositionCommit, CompositionEditControl, CompositionNode, CompositionWire, DaemonControl, DispatchEvent, EngineReadiness, IntentPayload, KeymapsControl, McpControl, OpaqueConfig, WorkspaceMember } from './host-config'
import { createInProcessMountHost } from './mount-host'
import { IdAllocator, IdRange, DEFAULT_WATERMARK } from './id-allocator'
import { IpcSurfaceTransport } from './surface-transports'
import type { SurfaceTransport } from './surface-protocol'
import { Correlator, type CommitOutcome } from './surface-protocol'
import type { SurfaceEvent, WindowSite } from '../../../shared/daemon-api'
import { pickTargetWindow } from './window-picker'
import { getOpenSurfacesIndex, makeOpenSurfaces, LOCAL_WINDOW } from './open-surfaces'
// The pure key + reflect-decision logic (no renderer deps, probe-drivable — see probe-leaf-reflect.ts).
import { containerSchemaOf, leafTypeKey, leafDigest, contentKeyOf, reflectDecision } from './content-key'
import type { ReflectState } from './content-key'
export { stableStringify } from './content-key' // re-exported so ProjectionHost keeps importing it from here
import { getNotificationSurface } from './notification-surface'
import { getChooserSurface } from './chooser-surface'
import { chooseOpeningPlan } from './opening-journey'
import { pickThenResolve } from './placement-reresolve'
import { getPreviewSurface } from './preview-surface'
import { createTerminalChannel } from './terminal-channel'
import { createViewStore, hydrate as hydrateViewState } from './view-store'
import { IntentTree } from './intent-channel'
import { setIntentCensusProvider, resolveViewer, viewerPickOptions, descriptorLabel, wrapPane, wrapPaneSolo, setPaneContent, wrapTargets, wrapTargetForKind, wrapTargetOutcome, placementForPane, resolveAddress, findContainerRoot, groupingForNewGroup, isGroupingKind, reparentSafeCenter, projectionLabel } from '@arsumbris/container-core'
import { viewersFor, handlersFor, currentCause, resumeCause, event, on, record } from '@arsumbris/au-host-sdk'
import { isFileSelection } from '@arsumbris/selection'
import type { IntentCensus, WrapOutcome } from '@arsumbris/container-core'
import { FocusTree } from './focus-channel'
import { SelectionTree } from './selection-channel'
import { CloseGuardTree } from './close-guard-channel'
import { ViewStateBus } from './view-state'

// The synthetic owner id the host-owned notification surface registers its `ui-notification`
// broadcast handler under. Not a real mount node (not in `this.nodes`); the broadcast fan-out keys
// capabilities by owner id alone, so a stable synthetic id is enough. See the constructor.
const HOST_NOTIFICATIONS_NODE: PublisherId = 'host:notifications'
// The host's COMMAND handler node. A synthetic PublisherId (not a real mount node, not in `this.nodes`),
// so it is EXEMPT from the declared-capability gate — the host declares no `handles-intent-meta`. Host-global
// commands (save / delete composition, …) are routed intents the host handles here; the host node is the
// SOLE owner of those types, so it always claims. Same synthetic-node shape as HOST_NOTIFICATIONS_NODE.
const HOST_COMMANDS_NODE: PublisherId = 'host:commands'

// The host's command FIRER node (the palette). A synthetic gate-exempt node, DISTINCT from
// HOST_COMMANDS_NODE so a host-handled command does not cycle-skip its own handler. At ENTRY_SCOPE
// (a synthetic node defaults there), so a routed fire reaches every ENTRY_SCOPE handler — where the
// host command node sits. Firing from a real projection node instead would trip the declared-fire gate.
const HOST_PALETTE_NODE: PublisherId = 'host:palette'

/** The `lastWindowActive` map key for the MAIN window's scoped active-pane head (a surface uses its own
 *  surfaceId). Distinct from any surfaceId (surface ids are pool `^:`s, never this literal). */
const WINDOW_ACTIVE_MAIN = '\0main'

interface Node {
  parentId: PublisherId | null
  children: Set<PublisherId>
  onUnmount?: () => void
  unmountSelf: (() => void) | null
  /**
   * The projection TYPE name (a child's id IS its type; the root's is passed at
   *  mountRoot). Used to resolve an `intent-defaults` role to candidate owners by kind-closure.
   *  null for a window node (no single projection type).
   */
  type: string | null
  /** The child's STABLE `^:` node id (its container-supplied `nodeId`), keyed the same as the
   *  host-owned per-pane state (terminal pty, view-store). '' for the root and any id-less mount.
   *  The authority on which panes are CURRENTLY MOUNTED, so terminal-session reaping can diff
   *  against what is really on screen rather than a lagging serialized config. */
  nodeId: string
}

/** One parsed `intent-default` routing rule (bare names). */
interface RoutingRule {
  intent: string
  roles: string[]
  mode: 'priority' | 'whitelist' | 'block'
  // OPTIONAL firer condition: the rule applies only when the FIRER plays this role-kind. Absent = any
  // firer. A bare kind name (`intent-default.source`, a `type<projection>*` def-ref). See scopeAmbient.
  source?: string
}

/** RUNG 2 — one `intent-reach` rule, per-(node, intent). `node` is a pool `^:` id; `wireOnly` closes the
 *  node to AMBIENT delivery of `intent` (it is then reached only by an explicit wire). See isAmbientReachable. */
interface ReachRule {
  node: string
  intent: string
  wireOnly: boolean
}


/** The bare NAME of a def-ref wikilink value (`[[editor-pane::editor|x]]` -> `editor-pane`).
 *  Strips the `[[ ]]`, any `|display` / `#anchor`, and the `::repo` qualifier — matching the BARE
 *  names discovery's kind-closure carries. Undefined for a non-string / empty value. */
function refBareName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined
  const inner = ref.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0]?.trim() ?? ''
  const name = inner.split('::')[0]?.trim() ?? ''
  return name || undefined
}

/** Extract a composition's `intent-routing` aspect record off its captured meta bag (`pool.meta`, or a
 *  nested scope's meta). Undefined when the composition declared no routing (an unset `intent-routing`
 *  field = absence), so every routing kind reads empty. */
function routingOf(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const r = meta?.['intent-routing']
  return r != null && typeof r === 'object' ? (r as Record<string, unknown>) : undefined
}

/** A public `CompositionWire` (host DTO, `mode?` optional) → the runtime `Wire` (mode defaulted STRICT,
 *  the design default). The two are otherwise the same shape. */
function toWire(w: CompositionWire): Wire {
  return { source: w.source, intent: w.intent, targets: [...w.targets], mode: w.mode === 'fallback' ? 'fallback' : 'strict' }
}

/** The OPEN IDENTITY of a pool record: its `type` claim plus the open `file`, mirroring the React key
 *  tabs/bento remount on. A container that REUSES a pane `^:` for a different file (a preview tab
 *  swapping files) changes this, which is exactly when the flat pool record must be overwritten rather
 *  than kept. A `type` mixin list is joined so an array vs string never spuriously differs. */
function openIdentity(rec: Record<string, unknown> | undefined): string {
  if (!rec) return ''
  const t = rec['type']
  const type = Array.isArray(t) ? t.join(',') : String(t ?? '')
  return `${type}:${String(rec['file'] ?? '')}`
}

/** The `^:` block-id an inline record carries, surfaced under the literal `^` key. The pool merge
 *  key for the root record (mountRoot carries it on `config`); a child passes its `nodeId` instead. */
function recordIdOf(config: OpaqueConfig | undefined): string | undefined {
  if (config == null || typeof config !== 'object') return undefined
  const id = (config as Record<string, unknown>)['^']
  return typeof id === 'string' ? id : undefined
}

/** A `window` pool record is a SITE (a sealed `mountable` branch with no loadable module), so the flat
 *  portal never mounts it — the host opens an OS surface and mounts the window's `content` instead. */
function isWindowRecord(record: unknown): boolean {
  const t = recordMountType(record)
  return t === 'window' || (typeof t === 'string' && t.startsWith('window::'))
}

/** Whether two pool records are structurally equal, ignoring the host-stamped `^` id — the "did the
 *  origin change since the float?" witness for `dock`. A structural (JSON) compare is enough: both sides
 *  are the SAME container's serialization, so key order matches; a false mismatch only downgrades dock to
 *  the main-window fallback, never corrupts. */
function recordsEqualIgnoringId(a: unknown, b: unknown): boolean {
  const strip = (r: unknown): string => {
    if (r === null || typeof r !== 'object') return JSON.stringify(r)
    const { ['^']: _omit, ...rest } = r as Record<string, unknown>
    return JSON.stringify(rest)
  }
  return strip(a) === strip(b)
}

export interface CompositionRuntimeOptions {
  entryPath: string
  /** The loaded composition's id (its path), read LIVE — keys the view-state auto-store
   *  per composition. The runtime is stable across composition switches, so this is a
   *  getter, not a static value. */
  compositionId?: () => string
  /** Daemon lifecycle (STAND-IN), bound to the active config; handed to every minted host. */
  daemon: DaemonControl
  /** au-mcp daemon lifecycle (STAND-IN), bound to the active workspace; handed to every minted host. */
  mcp: McpControl
  /** Engine-readiness edge (STAND-IN); handed to every minted host. */
  engineReady: EngineReadiness
  /** The workspace's members (STAND-IN), read at mint time so a projection is multi-root. */
  members: () => WorkspaceMember[]
  /**
   * Commit the root composition to disk now, guarded (STAND-IN). Handed to every
   * minted host, but only the ROOT composition view (bento) calls it — a structural
   * gesture (promote/detach) persisting immediately so the source file isn't stale.
   */
  commitComposition?: (next: OpaqueConfig) => Promise<CompositionCommit>
  /**
   * Resolve a projection TYPE NAME to a loadable registration (source + entry),
   * or undefined if unknown. a child's id IS its instance's `type`; code
   * resolves through the type owner (the projection subtype's package + meta entry).
   */
  resolve: (typeName: string) => ProjectionRegistration | undefined
  /**
   * THE COMPOSITION POOL. The runtime OWNS the authoritative in-memory pool (the hub) and is the
   * single writer. `schemas` is the derived container-slot graph the normalize/resolve walk needs
   * (which fields hold children); `mintBlockId` supplies a `^:` id to a record the composition
   * authored without one. `mountRootPortal` normalizes the composition into the pool and mounts the
   * root RECORD from it; every mounted node's `saveConfig` merges its OWN record into the pool by `^:`
   * (no parent embeds a child); and `host.children.pool` exposes the record ops to containers. The pool
   * is null only before wiring (a freshly-constructed runtime that has not mounted a composition yet).
   * On persist the host serializes the pool FRESH to the on-disk POOL FORM (a `composition` document:
   * a `root` reference plus the flat `projections` list — `serializePoolToComposition`), assembled from
   * the authoritative pool, so no container's stale view is ever re-serialized and no parent embeds a
   * child. Discovery is `instances_of(composition)`.
   */
  schemas?: () => ContainerSchemas
  mintBlockId?: () => string
  /**
   * Re-derive the composition after a structural pool edit. The runtime supplies a freshly serialized
   * composition document to the callback. The recursive mount path remounts from that document;
   * the portal path uses `onPoolChange` to relocate existing panes.
   */
  onStructuralEdit?: (doc: OpaqueConfig) => void
  /**
   * The mountable projection type names the host discovered, read LIVE at call time
   * (STAND-IN). Handed to every minted host as `host.listProjections`; a container
   * (bento) renders them as its pane-picker options. Lazy so it reflects projections
   * discovered after mount.
   */
  listProjections?: () => string[]
  /**
   * The discovered projections WITH their kind closure and owning repo, read LIVE (STAND-IN).
   * Handed to every minted host as `host.describeProjections`. The same set `listProjections`
   * names — described rather than merely listed, so a chooser can GROUP (containers apart from
   * panes) or FILTER without a query per kind. Optional end to end: absent here means the
   * contract member is absent, which a caller guards with `host.describeProjections?.()`.
   */
  describeProjections?: () => ProjectionDescriptor[]
  /**
   * The keymap FILES available in the workspace — every `keymap` instance parsed to `RawKeymap`, keyed by
   * keymap name. The runtime resolves the ACTIVE set itself, from the LIVE pool's `keymaps` list against
   * this map (`resolvedActiveKeymaps`), so the pool is the single source of truth for what is bound: a
   * `host.keymaps` add/remove/reorder mutates `pool.meta.keymaps` and reaches the resolver with no remount,
   * and a keymap-file rebind reaches it as soon as this map re-reads. Read live per keystroke. Absent means
   * no keybinds.
   */
  keymapFiles?: () => Map<string, RawKeymap>
  /**
   * The routing (`kind` / `dispatch`) for an intent type, read from the command registry, so a keybind
   * fires with the same stamped payload the palette uses. `null` when the intent is unknown.
   */
  commandRouting?: (intent: string) => { kind: string; dispatch?: string } | null
  /**
   * The KIND closure of a projection type — `[typeName, ...ancestors]` — from discovery
   * (STAND-IN, read live). The role-as-kind membership test: a node of type T plays role R
   * iff R is in `kindsOf(T)`. Used to resolve an `intent-defaults` role (a projection kind) to
   * the candidate owners the ambient scoper prefers/whitelists.

   */
  kindsOf?: (typeName: string) => string[]
  /**
   * The intents a projection TYPE declares it HANDLES (bare names) — from discovery's
   * `handles` meta, read LIVE (STAND-IN). Used by host INTROSPECTION (the agent-host
   * transport `introspect`) to report each mounted node's declared capabilities. Empty when
   * the type declares none / is not in the current discovery snapshot.

   */
  handlesOf?: (typeName: string) => string[]
  /**
   * The intents a projection type declares it handles ONLY WHEN AIMED (`handlesTargeted`), never as an
   * ambient candidate. Folded into `isAmbientReachable`: a node whose type declares `intentType` as
   * targeted-only (and not in `handles`) is excluded from the ambient walk, so a VIEWER is an open
   * target without hijacking ambient opens.
   */
  handlesTargetedOf?: (typeName: string) => string[]
  /**
   * The intents a projection type declares it FIRES (bare names) — the mirror of `handlesOf`. Feeds
   * the runtime `.fire()` gate (flag a fire the type-def does not declare in `fires-intent-meta`) and
   * the DECLARED intent census. Empty when the type declares none / is not in the discovery snapshot.
   */
  firesOf?: (typeName: string) => string[]
  /**
   * The composition-config ASPECTS a projection type declares it may EDIT (bare names) — the sibling of
   * `firesOf`/`handlesOf`, one axis over (bounded to `composition-config`). Feeds the composition-aspect
   * edit gate at the `compositionEdit` seam. Empty when the type declares none / is not in the snapshot.
   */
  editsOf?: (typeName: string) => string[]
  /**
   * The DECLARED intent census, inverted from the discovery snapshot: intent type → the projection
   * TYPE names that declare firing / handling it (`fires-intent-meta` / `handles-intent-meta`). The
   * type-graph half of the layout-inspector census, populated with zero runtime activity. Provided by
   * the host (which holds the discovery set); empty when absent.
   */
  declaredIntentCensus?: () => { firers: Map<string, string[]>; handlers: Map<string, string[]> }
  /**
   * The chrome CONTRIBUTIONS targeting a role, discovered from projection meta and read
   * LIVE (STAND-IN). Handed to every minted host as `host.listContributions`; a bar
   * projection queries its role for candidates. The kernel only answers the query — it
   * never merges candidates into the tree.
   */
  listContributions?: (role: string) => ChromeContribution[]
  /**
   * Discovery-change subscription, handed to every minted host as
   * `host.subscribeContributions`. A bar subscribes to re-query its role's contributions
   * (and re-render) when a projection is discovered/removed while it is mounted.
   */
  subscribeContributions?: (listener: () => void) => () => void
}

export class CompositionRuntime {
  // THE AUTHORITATIVE COMPOSITION POOL (the hub). Set at `mountRootPortal` when a composition mounts;
  // the runtime is the single writer. `poolPersist` is the root's persist closure — the runtime
  // serializes the pool FRESH back to the inline root instance on every merge and hands it here. Null
  // only before wiring (a freshly-constructed runtime that has not mounted a composition yet).
  private pool: CompositionPool | null = null
  // THE MOUNT POOL — the authoritative pool with the duplicate case degraded (each non-canonical edge
  // redirected to a synthetic placeholder record). Derived by `analyzePool` ONCE per mount GENERATION
  // (`mountRoot`). Every resolve reads THIS, so the per-child re-resolve (keyed by id alone) yields the
  // real record at the first site and a placeholder at every other, with no per-site context. Writes
  // still target `this.pool` (the authoritative one); the degrade never touches disk. Equals `this.pool`
  // by reference when the graph is clean (the common case).
  private mountPool: CompositionPool | null = null
  private poolPersist: ((next: OpaqueConfig) => void) | null = null
  // The cross-file scope table records each nested record's enclosing scope, rules, and parent chain.
  // Dispatch walks `parentScopeId` for precedence. Structural writes reject foreign records because
  // nested compositions are read-only. An unnested composition has an empty table. See `linkPool` and `ScopeTable`.
  private scopes: ScopeTable | null = null
  // Foreign composition/projection files pre-loaded (async) for the cross-file load PRE-PASS, keyed by
  // wikilink target. The linker resolves each SYNCHRONOUSLY at mount (the fold is sync; the reads are
  // not). Primed by ProjectionHost before a load/switch; kept across structural remounts (they reuse
  // the same cross-file refs). `entryPath` seeds the cross-file cycle check (a nested ref back to entry).
  private foreignFiles = new Map<string, ForeignFile>()
  private entryPath: string | undefined
  // Whether the load pre-pass warned that a foreign-scope edit was refused, so the read-only-nested
  // hint fires ONCE per generation, not on every resize.
  private foreignEditWarned = false
  // The set of records REACHABLE last pool generation, and the root it was captured under, kept so a
  // generation transition that mass-reaps pre-existing records (the pane-identity ghost-ref collapse)
  // is caught as a DELTA — but only WITHIN one composition, so switching compositions (a wholesale
  // record turnover) never reads as a reap. See `detectGhostRefCollapse`.
  private prevReachable: Set<string> | null = null
  // The roots the reachability baseline was computed for, as a joined key. A composition switch changes
  // the window-root SET (a wholesale record turnover), which this detects so a switch never reads as an
  // edit-orphan reap. Multi-window: keyed on the whole `roots` list, not a single root.
  private prevReachableRootsKey: string | null = null
  // The authority's ID allocator grants disjoint ranges to each surface. Local draws are synchronous;
  // remote surfaces refill their reserved blocks over IPC. IDs retain creation provenance while
  // current location comes from the pool topology.
  // STANDIN: engine `assign_block_id` addresses persisted files by path and position, so it cannot
  // assign an ID to an in-memory record during a gesture; see `container-core/block-id.ts`.
  private readonly surfaceId = '0'
  private readonly idAllocator = new IdAllocator()
  private readonly idRange = new IdRange(
    () => this.idAllocator.grantBlock(this.surfaceId), // in-process grant: synchronous
    DEFAULT_WATERMARK,
    this.idAllocator.grantBlock(this.surfaceId), // the active block
    this.idAllocator.grantBlock(this.surfaceId), // the reserve
  )
  private readonly nodes = new Map<PublisherId, Node>()
  // THE PORTAL PLUMBING. All inert until `portalActive` is set by the kernel.
  // The reverse of `Node.nodeId`: a mounted pane's stable `^:` → its live publisher. Maintained on
  // mount/unmount (non-empty ids only). Lets a container map a firer/focused publisher back to a pane
  // (`host.children.nodeIdOf`/`publisherOf`) now that the portal mounts panes flat, not under it.
  private readonly nodeIdToPublisher = new Map<string, PublisherId>()
  // THE DEFINITION-SITE REGISTRY (`host.children.locate`). A publisher → where it was defined: its
  // projection type, authored `^:` id, and the composition source file active when it mounted. Populated
  // at every mount and RETAINED past unmount — so an introspection surface (the trace inspector's actor
  // chips) can still say "what is this and where does it come from" for a pane that has since unmounted or
  // whose composition was switched away. `nodes.has(publisher)` gives the live `mounted` flag on top.
  private readonly nodeSites = new Map<PublisherId, { type: string | undefined; nodeId: string; compositionFile: string | undefined }>()
  // The pool's child → PARENT map for THIS mount generation (from `parentMap`, recomputed at mountRoot
  // and after every structural edit). The routing channels derive parentage from HERE, not the mount
  // call, so the flat portal mount does not collapse intent/focus/selection nesting.
  private poolParents = new Map<string, string>()
  // Pool-change subscribers (the kernel's PanePortalLayer). Fired COALESCED (one microtask per burst)
  // on structural/set changes only — a plain dialect `mergeRecord` (a resize) never fires it, so a
  // container never remounts on resize. A leaf's `contentKey` is stable across a move, so it survives.
  private readonly poolChangeListeners = new Set<() => void>()
  private poolChangeScheduled = false
  // REFLECT-IN-PLACE state (leaves). A leaf that registers `host.onOwnConfigChange` reflects a content
  // change in place; one that does not is remounted. Decoupled from the LIVE registration bit via an EPOCH,
  // so a leaf registering after it mounts never flips its own `contentKey` (that would be a spurious remount
  // landing on the very edit we mean to reflect). Keyed by the pane's `^:` nodeId.
  // - inboundHandlers: nodeId → the registered `onOwnConfigChange` callbacks (a Set: idempotent add/remove
  //   across a StrictMode double-effect, and one pane could register more than once).
  // - contentEpoch: nodeId → a monotonic counter IN the leaf's `contentKey`. Bumped ONLY when an unregistered
  //   leaf's content changes (→ remount); registration never touches it.
  // - lastLeaf: nodeId → the last-seen { content digest, type key }, the reflect pass's change detector.
  // All three are cleared when the record leaves the pool (reapOrphan / the reachability sweep) and wholesale
  // on disposePortal — the runtime is stable across composition switches, so a reused `^:` must not inherit
  // stale reflect state (→ silent stale content).
  private readonly inboundHandlers = new Map<string, Set<(config: OpaqueConfig) => void>>()
  private readonly contentEpoch = new Map<string, number>()
  private readonly lastLeaf = new Map<string, ReflectState>()
  // When the portal is wired, a structural edit re-derives via the pool-change subscription (no full
  // remount); when it is not, `applyStructural` falls back to the `onStructuralEdit` full remount.
  private portalActive = false
  // One ephemeral view-state bus for the whole tree, so siblings can follow each other.
  private readonly viewState = new ViewStateBus()
  // One selection tree for the whole mount tree; selection bubbles up it, a consumer follows its
  // enclosing container (its parent node). Keyed by the STABLE `^:` (like the focus recency), so a
  // container remount keeps its followers; the runtime bridges publisher -> node id.
  private readonly selectionTree = new SelectionTree(
    (nodeId) => this.poolParents.get(nodeId) ?? null, // the pool parent of a `^:`
    (publisher) => this.nodes.get(publisher)?.nodeId ?? null, // a publisher's CURRENT `^:`
  )
  // One intent channel routes commands across the mount tree. Dispatch orders eligible handlers
  // by focus recency or the firer's ancestry, according to the intent's declared routing policy.
  // Selection and view-state carry standing state separately.
  private readonly intentTree = new IntentTree(
    (id) => this.logicalParent(id),
  )
  // One focus channel for the whole tree: tracks the active pane (most-recently-focused,
  // retained across focus moves). It disambiguates intent routing — the IntentTree prefers
  // the focused capable owner, resolved through here. Recency is keyed by the STABLE `^:`
  // node id (survives a remount); the three bridges below map publisher <-> node id and walk
  // the pool parent by node id.
  private readonly focusTree = new FocusTree(
    (nodeId) => this.poolParents.get(nodeId) ?? null, // the pool parent of a `^:` (null at a pool root)
    (publisher) => this.nodes.get(publisher)?.nodeId ?? null, // a publisher's CURRENT `^:`
    () => { this.scheduleActiveChordsPush(); this.scheduleWindowActive() }, // re-mirror bound chords + re-derive every window's ring
  )
  // ── The per-window active-pane signal (the RING driver). The ONE aggregate recency (focusTree) FILTERED
  //    per window; only the OS-focused window shows a ring. Both the window-scoping and the OS-focus
  //    gate live HERE (the host `focus`-channel wiring), so containers + `au-pane-frame` are UNCHANGED.
  //
  // The MAIN window's containers subscribe here (in-process); each SURFACE gets its scoped head pushed down.
  private readonly mainActiveListeners = new Set<(activePane: string | null) => void>()
  // Last-fired scoped head per window for change detection: the MAIN sentinel key + one per surfaceId.
  private readonly lastWindowActive = new Map<string, string | null>()
  private windowActiveScheduled = false
  // the ring shows only in the OS-focused window. Optimistic TRUE (the main window is focused at boot;
  // a real `blur` corrects it) — avoids a headless window that never fires `focus` gating the ring off.
  private mainOsFocused = true
  // One close-guard channel for the whole tree: a projection registers a guard consulted before its
  // record is reaped. The projection-side participation in the removal lifecycle; keyed by publisher.
  // The commit core gathers it over the publishers of the records an edit would reap (each orphaned
  // record maps to its own publisher — the orphaned set already includes the whole cascade), so the
  // channel needs no mount-tree walk.
  private readonly closeGuardTree = new CloseGuardTree()
  // True while close guards decide whether a held orphan may be reaped. Refuse further pool commits
  // through `applyStructural` and `mergeRecord` during that decision, preserving both the held record
  // and the pool state the decision concerns. Clear the flag when guard gathering resolves.
  private guardPending = false
  private seq = 0
  // The agent-host transport command-executor registration. Armed by start(), removed by dispose().
  // NOT in the constructor: React StrictMode double-invokes the useMemo that builds a runtime, so a
  // constructor that registered IPC listeners would leak a throwaway instance's listeners. start() /
  // dispose() ride a useEffect instead, which StrictMode re-runs, so the kept runtime's listeners end ACTIVE.
  private disposeHostBridge: (() => void) | null = null
  // THE MOUNT/PROXY COMMAND PROTOCOL. A secondary window (a floated record's site) is a
  // SURFACE the authority drives: `surfaceTransports` holds one IPC transport per open surface, keyed
  // by its window-node POOL ID; `surfaceGen` is the per-record generation the authority assigns on each
  // mount/remount/unmount so the surface's guard drops a stale command. Disposers for the authority's
  // global surface listeners (ready / event / closed), armed in start(), cleared in dispose().
  private readonly surfaceTransports = new Map<string, SurfaceTransport>()
  private readonly surfaceGen = new Map<string, number>()
  // The selected composition path served by this portal. The runtime is reused within one workspace.
  // `mountRootPortal` compares incoming IDs to distinguish a composition switch, which closes old
  // surfaces and settles their claims, from a structural remount, which keeps those surfaces open.
  // Undefined before the first mount.
  private servingCompositionId: string | undefined = undefined
  private disposeSurfaceReady: (() => void) | null = null
  private disposeSurfaceClosed: (() => void) | null = null
  private disposeSurfaceCrashed: (() => void) | null = null
  private disposeSurfaceCloseRequested: (() => void) | null = null
  // CROSS-WINDOW GATHER. Correlates a `claim` query to a remote candidate with its `claim-reply`,
  // so the parallel gather can await a remote candidate's pure claim; a hung/closed surface is declined by
  // the timeout, so one slow window never stalls the gather (and only the winner is then sent a `commit`).
  private readonly intentClaims = new Correlator<boolean>(false) // timeout = decline (a slow window is skipped).
// CROSS-WINDOW COMMIT ACK. The routed re-home site sends the WINNER an ack-carrying `commit`
// and awaits its `commit-reply`. A winner definitively GONE resolves `'declined'` and the gather-then-commit
// RE-HOMES to the next claimer. A winner alive-but-SILENT past the budget resolves `'timeout'` — the
// re-home site does NOT re-home there (that would double-act a slow-but-alive winner), it surfaces the miss.
// Mirrors `intentClaims`; only the routed winner acks (broadcast / wired / aimed never re-home).
  private readonly intentCommits = new Correlator<CommitOutcome>('timeout')
  // CROSS-WINDOW CLOSE-GUARD GATHER (close-removal lifecycle). The authority is the sole reaper; when a record
  // it is about to reap lives on a SURFACE and reported a close-guard, the authority's PROXY guard (registered
  // in `closeGuardTree` on that record's publisher) awaits this correlated `gather-close-guard` → `close-guard-
  // reply` round-trip. Timeout value `false` = WITHHELD consent (content-preserving: withholding blocks the
  // reap, never loses work). Unlike the intent claim, the gather is INTERACTIVE (a save/discard/cancel dialog),
  // so it is NOT wire-timed on human decision time — a surface-death settles it `false` (see `onSurfaceClosed`).
  private readonly closeGuardQueries = new Correlator<boolean>(false)
  // REMOTE CANDIDATE STUBS: a capability a surface reported for one of ITS records, registered in
  // this authority's IntentTree so the record is a first-class ambient candidate. Keyed
  // `surfaceId\0recordId\0intentType` → the IntentTree deregister disposer; dropped on capability-drop /
  // record-unmount / surface-close. The stub's `claim` awaits `queryRemoteClaim`, `commit` sends the aimed commit.
  private readonly remoteStubs = new Map<string, () => void>()
  // The publisher this authority minted for a remote record (a record mounted on a SURFACE, not locally), so
  // it is a node in the dispatch trees. Keyed by the record's pool id. Distinct from `nodeIdToPublisher`
  // (local mounts); merged into the same `nodes` map for `logicalParent` / ordering.
  private readonly remoteRecordPublishers = new Map<string, PublisherId>()
  // SELECTION FOLLOWS a surface registered, keyed `surfaceId\0recordId` → the SelectionTree
  // unfollow. A surface record following its enclosing container gets ONE follow on its publisher here that
  // delivers `selection-deliver` DOWN; dropped on `selection-follow`/unfollow, record unmount, or surface close.
  private readonly remoteSelectionFollows = new Map<string, () => void>()
  // PROXY CLOSE-GUARDS a surface reported (close-removal lifecycle), keyed `surfaceId\0recordId` → the
  // `closeGuardTree` unregister for the proxy guard. A surface record's `close-guard-capability add` registers
  // a guard on its publisher whose body is `queryRemoteCloseGuard`; dropped on capability-drop, record reap
  // (`releaseRemoteRecord`), or surface close. Idempotent per (surface, record). Keeps the reap seam unchanged:
  // the proxy is an ordinary `closeGuardTree` guard, so `hasGuardAmong` (sync) + `gatherAmong` just work.
  private readonly remoteCloseGuards = new Map<string, () => void>()
  // Every record a surface has a publisher-node for (via focus / selection / intent / a reported capability),
  // so a surface close drops ALL of them from the dispatch trees — not only the ones with an intent stub.
  private readonly surfaceRemoteRecords = new Map<string, Set<string>>()
  // A remote candidate's CLAIM query has this long to reply before it is treated as a DECLINE (a hung or
  // crashed surface must never stall the parallel gather). Generous vs a real IPC round-trip, tight vs a
  // stuck window. Only the winner is then sent a `commit`, so a slow window can never cause a double-open.
  private static readonly REMOTE_INTENT_TIMEOUT_MS = 1500
  // The close-guard gather is INTERACTIVE (a save/discard/cancel dialog in the floated window), so it must NOT
  // time out on human decision time — a timeout that fired mid-dialog would withhold consent, then the user's
  // later "discard" reply would arrive at an already-settled query and be dropped. The real liveness signal is
  // a surface-death (settled `false` in `onSurfaceClosed`); this large backstop only prevents a pathological
  // silent-but-alive surface from wedging `guardPending` forever. Ten minutes: far past any real dialog.
  private static readonly REMOTE_CLOSE_GUARD_BACKSTOP_MS = 10 * 60 * 1000
  // The authority runtime's root node (parentId === null): the composition root, and the agent-host
  // transport's fire / introspect entry point. Set per mountRoot, cleared on unmount.
  private mainRoot: PublisherId | null = null
  // Each eligible handler claims or declines an intent, including its firer; ordering does not exclude
  // the firer. A composition controls placement eligibility through its containers and routing rules.
  //
  // The composition's `intent-defaults` are parsed to bare names from `pool.meta`. The ambient scoper
  // reads them to prefer or restrict role-kinds. Reset them on each composition mount.
  private routingRules: RoutingRule[] = []
  // The composition's EXPLICIT per-connection routings (`wires`), pool-addressed. Read off the same
  // metadata bag as `routingRules`; consumed by the dispatch wire-override. Reset per
  // mountRoot. A wire OVERRIDES the default routing for its one (source, intent) connection.
  private wires: Wire[] = []
  // The composition's per-(node, intent) ambient-reachability rules (`intent-reach`, rung 2). Read off the
  // same metadata bag as `wires`; consumed by the ambient-reachability predicate injected into IntentTree.
  // These three (routingRules / wires / reach) are the ENTRY scope's — the switchboard edits them.
  private reach: ReachRule[] = []
  // PER-SCOPE routing rules: each nesting scope's own `intent-defaults` / `wires` / `reach`,
  // keyed by scopeId. Entry = ENTRY_SCOPE (bare ids, same objects as the three fields above); a nested
  // scope's wire/reach ids are QUALIFIED to match the mounted nodes. The scope-aware ambient walk resolves
  // a candidate's / firer's rules from HERE, so a nested composition governs its own subtree. Rebuilt per
  // installRouting; a no-nesting composition holds only ENTRY_SCOPE, so dispatch is unchanged.
  private rulesByScope = new Map<string, { routingRules: RoutingRule[]; wires: Wire[]; reach: ReachRule[] }>()
  // Subscribers to the live intent-flow (the switchboard's cable animation). Fed by the delivery
  // observer (constructor), which translates each delivery to pool-ids. See `onDispatch`.
  private readonly dispatchListeners = new Set<(ev: DispatchEvent) => void>()
  // The document's declared `initial-focus` role, pending until a node playing it mounts (children
  // mount async), then seeded into the focus channel so the first ambient open is deterministic.
  private pendingInitialFocus: string | null = null
  // Disposers for the host notification surface's `ui-notification` (+ subtype) broadcast handlers,
  // so a re-install (after subtype discovery) drops the prior set. See installNotificationHandlers.
  private notificationDisposers: (() => void)[] = []
  private hostCommandDisposers: (() => void)[] = []

  constructor(private readonly opts: CompositionRuntimeOptions) {
    // Rank ambient-intent candidates by focus recency (most-recently-focused first). The
    // responder-chain AMBIENT walk consumes this order; the head is the focused owner, and each
    // candidate then claims or declines for itself.

    this.intentTree.setFocusRanker((candidates) => this.focusTree.rankByFocus(candidates))
    // The host command node is a FALLBACK: its ambient handlers (save-intent → save the composition,
    // toggle-command-palette-intent, …) are the empty-focus default, so it must be ordered LAST in every
    // ambient walk. A focused editor handling save-intent then claims ⌘S ahead of it (saving the FILE); the
    // composition save runs only when no mount-tree handler claims. Without this the host node wins proximity
    // (a keybind fires from `host:palette`, right beside it) and swallows the command.
    this.intentTree.setFallbackNode((node) => node === HOST_COMMANDS_NODE)
    // The open-surfaces italic DERIVES from the ONE source of transient-ness — the authority pool. Injected
    // once (reads `this.pool` lazily); `pool.transient` holds every window's ids, so the derivation is
    // cross-window-correct, and there is no separate side-map to keep in sync.
    getOpenSurfacesIndex().setTransientSource((id) => this.pool?.transient.has(id) ?? false)
    // Ambient candidate scoper: the composition root's `intent-defaults` (this.routingRules)
    // partition the capable owners by role-kind. Reads the rules LIVE, so a composition switch only
    // updates the rules (installRouting), not the scoper. Null when no rule matches the intent.
    this.intentTree.setCandidateScoper((intentType, from, owners, scopeId) => this.scopeAmbient(intentType, from, owners, scopeId))
    // NESTED-SCOPE dispatch: a node's enclosing scope + the firer's scope chain, from the
    // cross-file scope table. Makes the ambient walk inner-scope-first + bubbling. Empty table (no nesting)
    // → every node is ENTRY_SCOPE and the chain is [s0], so the walk is the flat global one, unchanged.
    this.intentTree.setScopes((node) => this.scopeOfNode(node), (from) => this.scopeChainOf(from))
    // Rung 2 (`intent-reach` wire-only): exclude a node the composition closed from the AMBIENT candidate
    // set. Reads `this.reach` LIVE, so a composition switch only updates the rules (installRouting).
    this.intentTree.setAmbientReachable((node, intentType) => this.isAmbientReachable(node, intentType))
    // The REASON a capable handler is skipped from the ambient walk (aimed-only / reach-closed), so the
    // trace can explain "the editor is here, why didn't it open?" — routing is unaffected.
    this.intentTree.setAmbientExclusionReason((node, intentType) => this.ambientExclusionReason(node, intentType))
    // The declared-capability gate: resolve a node to the intents its type-def
    // declares it handles, so `IntentTree.handle` can flag a registration the type-def does not declare.
    // The declared set is the UNION of `handles` (AMBIENT) and `handlesTargeted` (AIMED-ONLY): a viewer
    // like editor-pane declares open-intent as `handlesTargeted` (an aimed open replaces its content) and
    // registers a handler for it — that is DECLARED, just aimed-only, so the gate must not flag it. A node
    // not in `this.nodes` (a host-owned surface) or with an unknown type resolves `undefined` and is
    // exempt — the rule is about PROJECTIONS declaring what they handle.
    this.intentTree.setDeclaredHandles((node) => {
      const type = this.nodes.get(node)?.type
      if (!type) return undefined
      return [...(this.opts.handlesOf?.(type) ?? []), ...(this.opts.handlesTargetedOf?.(type) ?? [])]
    })
    // Name the projection in a declaration-gate warning (the tree holds only opaque publisher ids).
    this.intentTree.setNodeDescriber((node) => this.nodes.get(node)?.type ?? undefined)
    // Describe an intent's SUBJECT for the trace (the file an open targets) — a debug-surface describer,
    // the tree stays payload-opaque for routing. The file lives in a `target` that is a FileSelection;
    // any other payload has no meaningful subject. Never affects dispatch.
    this.intentTree.setIntentDescriber((intent) => {
      const target = (intent as { target?: unknown }).target
      if (target && typeof target === 'object' && isFileSelection(target as never)) {
        const p = (target as { path?: unknown }).path
        return typeof p === 'string' ? p : undefined
      }
      return undefined
    })
    // The mirror gate on the FIRE side: resolve a node to its type-def's declared `fires` so
    // `IntentTree.fire` can flag a fire the type-def does not declare in `fires-intent-meta`. Same
    // exemption — a host-owned surface or unknown type resolves `undefined` and is not gated.
    this.intentTree.setDeclaredFires((node) => {
      const type = this.nodes.get(node)?.type
      return type ? (this.opts.firesOf?.(type) ?? []) : undefined
    })
    // The switchboard wire-override: resolve the composition's explicit `intent-wires` for a fired
    // (firer, intent) to its recipient publishers. Reads `this.wires` LIVE, so a composition switch
    // only re-installs the wire table (installRouting), not the resolver.
    this.intentTree.setWireResolver((from, intentType) => this.resolveWire(from, intentType))

    // The DELIVERY OBSERVER: translate each intent delivery (firer → recipient publishers) to POOL ids
    // and fan it out to `dispatchListeners` — the switchboard's live flow animation (a pulse travels the
    // cable an intent is actually routed over). A delivery to/from a host-owned node (no pool id) is
    // dropped (nothing to animate). See `onDispatch`.
    this.intentTree.setDeliveryObserver((from, to, type, viaWire, kind) => {
      // RAISE MAIN: a ROUTED intent fired FROM a floated window that lands in the MAIN window surfaces main,
      // so the user sees where it went — the symmetric twin of commitToSurface's raise (which surfaces a
      // floated TARGET). Gated to a routed intent (a broadcast fan-out is passive, never steals focus) and to
      // a REMOTE firer + LOCAL target: a main firer keeps main already-focused, and a floated target is raised
      // by commitToSurface, so this covers only the surface→main direction (no double-raise).
      if (kind !== 'broadcast' && this.isRemotePublisher(from) && !this.isRemotePublisher(to)) {
        window.main.surface.focusMain()
      }
      if (this.dispatchListeners.size === 0) return
      const source = this.nodes.get(from)?.nodeId
      const target = this.nodes.get(to)?.nodeId
      if (!source || !target) return
      const ev = { source, target, intent: type.split('::')[0] ?? type, viaWire }
      for (const l of [...this.dispatchListeners]) l(ev)
    })

    // The HOST-OWNED notification surface: register a `ui-notification` broadcast handler so every
    // fired notification renders in the host toast frame with NO composition required (guaranteed
    // delivery). See installNotificationHandlers. Registered with the base type up front; the runtime
    // owner (ProjectionHost) re-registers with the discovered SUBTYPES too, so a fired subtype (which
    // the IntentTree matches by EXACT type) also reaches the host surface. See notification-surface.ts

    this.installNotificationHandlers([])

    // An intent nobody claims must FAIL LOUDLY, not vanish.
    //
    // Containers can DECLINE and routing can whitelist candidates: dissolve a tab group
    // down to a bare reader, click a file it declines, and nothing happens anywhere with no feedback.
    //
    // REPORTED, NOT REPAIRED. The host cannot know which surface should have taken it. Surfacing
    // it is what turns "the app ignored me" into something someone can act on.
    this.intentTree.setUnhandled((intent, from) => {
      const type = typeof intent.type === 'string' ? intent.type : 'intent'
      // THE OPEN FLOOR: a file-open fired into a composition with no AMBIENT-eligible open handler
      // would dead-end silently. Offer the host-owned escape so opening is never a dead end. The
      // count is AMBIENT-reachable owners, NOT all owners: a `handlesTargeted` viewer (an aimed-only
      // open TARGET) is not a place an ambient open can land, so it must not suppress the floor — it
      // becomes a REPLACE row inside the floor instead. A `whitelist`/`block` RULE leaves the
      // ambient owners non-empty (they are excluded by the rule, not absent), so it falls through to
      // the warning below, which NAMES the rule (respect the deliberate lock).
      if (type === 'open-intent') {
        if (this.ambientOwnersOf(type).length === 0) void this.openFloor(intent, from)
        else this.showUnhandledWarning(type, from)
        return
      }
      // A FIRER-RELATIVE intent routes ONLY to the firer's own ancestor chain — there is no global
      // fallback, so "nobody claimed" means the firer's own context simply does not support it (a bare
      // editor pane has no tab to promote; a rail outside a sandwich has no region to collapse). That is
      // the expected terminal outcome, not a failure, so it stays silent — a firer that must know checks
      // `fireReport`'s claimed outcome. Only a GLOBAL (ambient) route finding no taker is worth surfacing.
      if ((intent as { dispatch?: string }).dispatch === 'firer-relative') return
      // THE UNHANDLED-INTENT FLOOR: no present handler claimed this ambient intent. Rather than a passive
      // notification (a silent dead end when it regresses), offer to ADD a capable handler discovered from
      // the type graph, place it, and re-dispatch. The notification is the fallback inside, when nothing is
      // even capable or the user cancels.
      void this.addHandlerFloor(intent, from, type)
    })
    // Re-dispatch a floored intent the moment a container capable of it becomes live (its handler binds in
    // a mount effect, so this is the precise readiness point — never a timer). Cleared on first match.
    this.intentTree.setOnHandlerRegistered((type) => {
      const pending = this.pendingRedispatch.get(type)
      if (!pending) return
      this.pendingRedispatch.delete(type)
      resumeCause(pending.cause, () => { void this.intentTree.fireReport(pending.from, pending.intent) })
    })
  }

  /** Floored intents awaiting a capable handler to mount, keyed by intent type. Set by `addHandlerFloor`
   *  after it wraps in a chosen container; drained by the `onHandlerRegistered` hook above. A stale entry
   *  (the container never registered) is swept after a bounded window so it never re-fires a later add. */
  private readonly pendingRedispatch = new Map<string, { intent: IntentPayload; from: PublisherId; cause: number | undefined }>()

  /**
   * (Re)register the host-owned notification surface's broadcast handlers. The `IntentTree` matches
   * a fired intent by EXACT `type`, so the base `ui-notification` AND every discovered SUBTYPE that
   * ships a content renderer each needs its own handler (all delivering to the one host surface,
   * which picks the renderer by type). Called with `[]` at construction (the base is always on) and
   * re-called with the discovered subtype names after `subtypes('ui-notification')` discovery. The
   * prior set is disposed first. See notification-renderers.ts.
   */
  installNotificationHandlers(subtypes: string[]): void {
    for (const dispose of this.notificationDisposers) dispose()
    this.notificationDisposers = []
    const channel = this.intentTree.forNode(HOST_NOTIFICATIONS_NODE)
    const show = (intent: IntentPayload): void =>
      getNotificationSurface().show(intent, (i) => channel.fire(i as IntentPayload))
    for (const type of ['ui-notification', ...subtypes]) {
      this.notificationDisposers.push(channel.handle(type, { claim: () => true, commit: (intent) => show(intent) }))
    }
  }

  /**
   * (Re)register the host's COMMAND handlers on the synthetic `HOST_COMMANDS_NODE`. A host-global command
   * (save / delete composition, …) is a routed intent the host handles here; `handlers` maps each intent
   * TYPE to a runner that reads the fired payload (e.g. `save-composition-as-intent` reads `intent.name`).
   * The runner CLAIMS (returns true) — the host node is the sole owner of these types, so the routed walk
   * ends here. Re-callable: the runners close over React state (the composition control), so ProjectionHost
   * re-installs with fresh closures; the prior set is disposed first. Mirrors `installNotificationHandlers`.
   */
  /** Fire a command from the host (the command palette), FIRE-AND-FORGET. Fires from the gate-exempt
   *  `HOST_PALETTE_NODE` so it does not trip the declared-fire gate a real projection node would, and reaches
   *  the ENTRY_SCOPE host command node. The claim outcome is not read (the palette closes on fire); a host
   *  caller that needs it uses `intentTree.fireReport`. */
  fireCommand(intent: IntentPayload): void {
    this.intentTree.forNode(HOST_PALETTE_NODE).fire(intent)
  }

  // The command palette is host CHROME (a React component deep in the render tree), but `toggle-command-
  // palette-intent` is a host command routed through the intent tree. So the palette REGISTERS its toggle op
  // here (it already holds the runtime), and the host command handler invokes it via `togglePalette()` — the
  // same command→chrome seam `installHostCommandHandlers` uses for saveComposition, without prop-drilling a ref.
  private paletteToggle: (() => void) | null = null

  /** The command palette registers its open/close toggle; returns a disposer. */
  setPaletteToggle(toggle: () => void): () => void {
    this.paletteToggle = toggle
    return () => {
      if (this.paletteToggle === toggle) this.paletteToggle = null
    }
  }

  /** Toggle the command palette (invoked by the `toggle-command-palette-intent` host handler). A no-op until
   *  the palette registers — harmless if fired before the palette mounts. */
  togglePalette(): void {
    this.paletteToggle?.()
  }

  /** Close the FOCUSED view (invoked by the `close-view-intent` host command — e.g. ⌘W). Resolves the
   *  most-recently-focused node (a container reports its active child's publisher, so this is the focused
   *  CONTENT, not the container chrome) to its pool `^:`, and requests its removal. The removal flows through
   *  the shared commit core, so the close-guard runs at the reap — a dirty view vetoes or saves first. A
   *  no-op when nothing holds focus, or the focused node is not a pooled pane. */
  closeFocusedView(): void {
    // A SURFACE keystroke: the target is a pane in the ORIGINATING floated window —
    // its carried transient focus, then that window's retained head. The authority cannot reach a surface's
    // per-renderer container placement, so it DELEGATES the close to that surface (it runs `closePane` locally
    // → propose UP → the authority reaps + gathers the close-guard). A floated ⌘W
    // resolves against its originating window's focus.
    const origin = this.keystrokeOrigin
    if (origin && origin.windowId !== this.primaryWindowId()) {
      const target = origin.focus ?? this.activePaneForWindow(origin.windowId) ?? undefined
      // The transport can be gone (a surface-teardown race). Resolve it up front so the trace reflects whether
      // the delegate was actually SENT (`delegated`) or the window vanished first (`window-gone`), never a false
      // `delegated`.
      const transport = target ? this.surfaceTransports.get(origin.windowId) : undefined
      if (target && transport) transport.sendCommand({ op: 'close-pane', id: target })
      if (on('placement')) event('placement', 'close-view-command', {
        paneId: target ?? null, source: origin.focus ? 'surface-focus' : 'surface-head',
        window: origin.windowId, resolved: target != null,
        outcome: !target ? 'no-focused-pane' : transport ? 'delegated' : 'window-gone',
      })
      return
    }
    // The MAIN window: the TRANSIENT current focus — the pane holding main's DOM focus right now (a surface
    // keystroke aimed at the primary is the defensive `origin.focus` case). Fall back to the MAIN-scoped
    // RETAINED head (NOT the aggregate head, which can be a FLOATED pane) when focus sits in chrome / a dialog
    // / nothing, so ⌘W still closes the main pane they were last in rather than no-op'ing or closing another
    // window's pane. `data-pane-id` carries the pane's `^:`, exactly what `requestClosePane` takes.
    const domPaneId = origin?.focus ?? paneIdOfActiveElement()
    let paneId = domPaneId && findPlacementByPane(domPaneId) ? domPaneId : undefined
    let source = paneId ? 'dom-focus' : 'none'
    if (!paneId) {
      paneId = this.activePaneForWindow(undefined) ?? undefined // main's window-scoped retained head
      if (paneId) source = 'focus-channel'
    }
    const outcome = paneId ? this.requestClosePane(paneId) : undefined
    if (on('placement')) event('placement', 'close-view-command', {
      paneId: paneId ?? null,
      source,
      resolved: paneId != null,
      outcome: outcome ? (outcome.done ? 'closed' : `refused: ${outcome.reason}`) : 'no-focused-pane',
    })
  }

  /** Install the per-window DOM-focus tracker over `root` (the window's kernel root). On every `focusin`,
   *  resolve the focused PANE (`paneIdOfActiveElement`, shadow-piercing, innermost-first) and report its
   *  `^:` to the focus recency. This is the single authoritative focus feeder in the steady state: focus
   *  landing OUTSIDE any pane (chrome / a dialog / the body) resolves to nothing and reports nothing, so
   *  the retained head is unchanged. Recency is RETAINED, so there is nothing to do on blur — `focusout`
   *  is not handled. Returns a disposer. Runs per window (the main window here; each surface installs its
   *  own in its renderer).  */
  installFocusTracker(root: HTMLElement): () => void {
    const onFocusIn = (): void => {
      const paneId = paneIdOfActiveElement()
      if (paneId !== undefined) this.focusTree.reportNode(paneId)
    }
    root.addEventListener('focusin', onFocusIn)
    // the ring shows only in the OS-focused window. Track THIS (main) window's OS-focus and re-derive
    // its scoped active-pane head, so a blur clears the ring and a refocus re-rings the retained head. A
    // surface tracks its own OS-focus locally. `window` focus/blur fire on OS-focus transitions
    // (a click inside an already-focused window does not), so this flips only on a real window switch.
    const onWinFocus = (): void => { this.mainOsFocused = true; this.notifyWindowActive() }
    const onWinBlur = (): void => { this.mainOsFocused = false; this.notifyWindowActive() }
    window.addEventListener('focus', onWinFocus)
    window.addEventListener('blur', onWinBlur)
    return () => {
      root.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('focus', onWinFocus)
      window.removeEventListener('blur', onWinBlur)
    }
  }

  /** The active pane in `windowId` (undefined → the primary / main window): the FIRST aggregate-recency `^:`
   *  whose containing window is `windowId`. The ONE aggregate FILTERED per window — a pure derived view, no
   *  second recency. This is the ring driver each window reads (the main window in-process, a surface via a
   *  pushed `active-pane` command).  */
  activePaneForWindow(windowId: string | undefined): string | null {
    const target = windowId ?? this.primaryWindowId()
    if (target == null) return null
    for (const nodeId of this.focusTree.recencyList()) {
      if (this.windowOfSubtree(nodeId) === target) return nodeId
    }
    return null
  }

  /**
   * The MAIN window's scoped active pane, gated by its OS-focus: null when the main window is blurred,
   *  so its ring hides while another window is focused and re-rings its retained head on refocus.
   */
  private mainActiveHead(): string | null {
    return this.mainOsFocused ? this.activePaneForWindow(undefined) : null
  }

  /** Subscribe a MAIN-window container to its window-scoped active pane (the ring). Fires IMMEDIATELY with
   *  the current value, then on every change. The window-scoped, OS-gated replacement for the raw aggregate
   *  head — so a container renders its ring for its OWN window's active pane, not a pane in another window. */
  private watchMainActive(listener: (activePane: string | null) => void): () => void {
    this.mainActiveListeners.add(listener)
    listener(this.mainActiveHead())
    return () => this.mainActiveListeners.delete(listener)
  }

  /** Coalesce a re-derivation of every window's scoped active-pane head (the ring). Fired on any focus-recency
   *  mutation (`focusTree.onChange`) and any structural pool change (a pane moving between windows re-scopes a
   *  head). Mirrors `scheduleActiveChordsPush` — a microtask, so a burst re-derives once. */
  private scheduleWindowActive(): void {
    if (this.windowActiveScheduled) return
    this.windowActiveScheduled = true
    queueMicrotask(() => {
      this.windowActiveScheduled = false
      this.notifyWindowActive()
    })
  }

  /** Re-derive every window's scoped active-pane head and notify what changed. The MAIN window's containers
   *  are notified in-process (gated by main's OS-focus); each SURFACE gets its scoped head PUSHED DOWN as
   *  an `active-pane` command (the surface gates locally by its own OS-focus). Change-detected per window so an
   *  unchanged head fires nothing (no wire churn on an unrelated focus move). */
  private notifyWindowActive(): void {
    const mainHead = this.mainActiveHead()
    if (this.lastWindowActive.get(WINDOW_ACTIVE_MAIN) !== mainHead) {
      this.lastWindowActive.set(WINDOW_ACTIVE_MAIN, mainHead)
      for (const l of [...this.mainActiveListeners]) l(mainHead)
    }
    for (const [surfaceId, transport] of this.surfaceTransports) {
      const head = this.activePaneForWindow(surfaceId)
      if (this.lastWindowActive.get(surfaceId) === head) continue
      this.lastWindowActive.set(surfaceId, head)
      transport.sendCommand({ op: 'active-pane', activePane: head })
    }
  }

  installHostCommandHandlers(handlers: Record<string, (intent: IntentPayload) => void>): void {
    for (const dispose of this.hostCommandDisposers) dispose()
    this.hostCommandDisposers = []
    const channel = this.intentTree.forNode(HOST_COMMANDS_NODE)
    for (const [type, run] of Object.entries(handlers)) {
      this.hostCommandDisposers.push(
        channel.handle(type, {
          claim: () => true, // the host is the sole handler of this command type
          commit: (intent) => run(intent),
        }),
      )
    }
  }

  /** Begin serving the authority's host-transport + surface listeners. Idempotent. Driven by a useEffect
   *  in ProjectionHost so it survives StrictMode's mount→cleanup→mount cycle. */
  start(): void {
    if (this.disposeHostBridge) return
    // Install this window's live intent census for the layout-inspector (which reads the window-global
    // holder from its own bundle). Armed in start(), not the constructor, because StrictMode builds a
    // throwaway runtime whose getter would capture a dead instance. Cleared in dispose().
    setIntentCensusProvider(() => this.intentCensus())

    // Serve the agent-host transport: register the command executor, then bring the socket up so it is
    // listening before au-mcp's relay tools connect. The entry path is the socket file name's hash key.
    this.disposeHostBridge = window.main.hostbridge.onCommand((command) => this.executeHostCommand(command))
    void window.main.hostbridge.start(this.opts.entryPath)
    // The mount/proxy command protocol: the AUTHORITY drives secondary surfaces. A
    // surface's mount agent signals ready → drive its window content's mount; the OS window closing →
    // drop its transport. Per-surface events arrive on each transport (created in onSurfaceReady).
    this.disposeSurfaceReady = window.main.surface.onReady((surfaceId) => this.onSurfaceReady(surfaceId))
    this.disposeSurfaceClosed = window.main.surface.onClosed((surfaceId) => this.onSurfaceClosed(surfaceId))
    // A surface's renderer CRASHED / was force-killed: its window-node stays dormant in
    // the pool; OFFER to reopen it. Fires before the `onClosed` the crash teardown triggers.
    this.disposeSurfaceCrashed = window.main.surface.onCrashed((surfaceId) => this.onSurfaceCrashed(surfaceId))
    // The user asked to close a floated window: an EMPTY one closes+reaps directly; a NON-EMPTY one
    // prompts IN the closing window. A DELIBERATE close, so — unlike a crash — it never offers reopen.
    this.disposeSurfaceCloseRequested = window.main.surface.onCloseRequested((surfaceId) => this.onSurfaceCloseRequested(surfaceId))
  }

  /**
   * Execute an agent-host transport command against the live UI, returning the typed
   * result the socket client awaits. The three commands map onto the same live surfaces
   * a mounted projection drives: `fireIntent` → the intent tree (fired from the root, so
   * routing/broadcast reaches every capable handler), `introspect` → a walk of the mounted
   * node tree + focus + each node's declared `handles`, `containerOp` → the container seam.
   */
  async executeHostCommand(command: HostCommand): Promise<HostResult> {
    switch (command.command) {
      case 'fireIntent': {
        // Everything reaching this executor came off a socket that accepts
        // every connection, so the payload is UNTRUSTED. Refusal THROWS rather than returning
        // `claimed: false`: that value already means "no handler wanted it", and conflating a
        // refusal with it would tell a legitimate agent its intent simply fell through while
        // telling an attacker nothing extra. The bridge frames a throw as `{ok:false, error}`.
        // See agent-intent-gate.ts for authorization and payload checks.
        const verdict = checkAgentIntent((command.intent as IntentPayload | undefined)?.type)
        if (!verdict.allowed) {
          throw new Error(`refused to fire intent (${verdict.reason}): ${verdict.message}`)
        }
        // Fire from the root node so the intent enters the tree exactly as a projection's would:
        // a BROADCAST intent (e.g. ui-intent-highlight) fans out to every capable handler; a ROUTED
        // ambient one walks focus-MRU. No local composition mounted → nothing to claim it.
        if (this.mainRoot === null) return { command: 'fireIntent', claimed: false }
        // Routing comes from the discovered type definition. Its declared values override
        // caller-supplied routing fields so callers cannot change dispatch scope.
        const intent = { ...(command.intent as IntentPayload), ...verdict.routing }
        // AWAIT the real dispatch outcome: a cross-window routed intent resolves asynchronously (the gather +
        // remote commit), so the sync boolean would LIE (false for a remote claim). `fireReport` awaits it, so
        // the agent's `claimed` is correct across windows. The response SHAPE is unchanged (the agent already
        // awaits this socket reply).
        const claimed = await this.intentTree.fireReport(this.mainRoot, intent)
        return { command: 'fireIntent', claimed }
      }
      case 'introspect':
        return {
          command: 'introspect',
          snapshot: {
            root: this.mainRoot ? this.snapshotNode(this.mainRoot) : { id: '', projection: null, kinds: [], handles: [], children: [] },
            focus: { activeNodeId: this.focusTree.activeNodeId() ?? undefined },
          },
        }
      case 'containerOp':
        return { command: 'containerOp', outcome: await this.runContainerOp(command.op) }
      default: {
        // An UNKNOWN command must not read as success. Without this the switch fell through
        // returning `undefined`, which the bridge framed as `{ok: true, result: undefined}` —
        // so a client sending a typo'd or newer verb was told it worked. Throwing reaches the
        // socket as `{ok: false, error}` via the preload's rejection path.
        //
        // The `never` binding is load-bearing, not decoration: adding a HostCommand variant
        // without handling it here becomes a COMPILE error rather than a silent runtime no-op.
        const exhaustive: never = command
        throw new Error(`unknown host command: ${String((exhaustive as { command?: unknown }).command)}`)
      }
    }
  }

  /** Build the introspection snapshot for a node + its subtree (depth-first, mount order). The
   *  node's `type` is its projection identity; `kinds`/`handles` resolve LIVE from discovery. */
  private snapshotNode(publisher: PublisherId): SnapshotNode {
    const node = this.nodes.get(publisher)
    const type = node?.type ?? null
    return {
      id: publisher,
      projection: type,
      kinds: type ? (this.opts.kindsOf?.(type) ?? []) : [],
      handles: type ? (this.opts.handlesOf?.(type) ?? []) : [],
      children: node ? [...node.children].map((child) => this.snapshotNode(child)) : [],
    }
  }

  /** Run a containerOp against the live layout via the substrate's pane→container resolver
   *  (`container-core`, keyed by stable pane id — the address-based analogue of the DnD router's
   *  DOM-geometry walk). `activate` reveals/focuses a pane wherever it lives; `close` removes it.
   *  A pane no container holds declines with a reason (not an error), and so does one whose slot
   *  is `fixed` — the same rule the drag seams enforce, since a verb that bypassed it would be a
   *  hole straight through fixity. The move verbs (extract/inject) are deferred. */
  private runContainerOp(op: ContainerOp): ContainerOpOutcome {
    switch (op.op) {
      case 'activate':
        return activatePane(op.paneId)
          ? { done: true }
          : { done: false, reason: `no container holds pane "${op.paneId}"` }
      case 'close':
        return this.requestClosePane(op.paneId)
    }
  }

  /**
   * The close-COMMAND entry — one trigger among many, NOT the guard's home. It resolves the target and
   * requests its removal via the existing `closePane`. The close-guard CONSENSUS does NOT run here: it
   * runs at the REAP, inside the shared commit core (`commitEdit`), so every removal trigger — this
   * command, the tab ✕, a drag-discard, a native window close — is guarded uniformly and no trigger owns
   * the guard. `closePane` proposes the reference removal; the core gathers guards and reaps or holds.
   *
   * Reports the STRUCTURAL outcome only (held / not held / fixed). A guarded removal completes or aborts
   * ASYNCHRONOUSLY at the reap, invisible to this synchronous return, which is fine: the command's job is
   * to initiate the removal, and the guard owns the eventual outcome.
   */
  requestClosePane(paneId: string): ContainerOpOutcome {
    // Two structural declines are worth telling apart: a `fixed` slot refuses, or no container holds it.
    // The fixed-slot case is a rule working, not a failure, so it is not "not found".
    return closePane(paneId)
      ? { done: true }
      : {
          done: false,
          reason: findPlacementByPane(paneId)
            ? `pane "${paneId}" sits in a fixed slot and cannot be closed`
            : `no container holds pane "${paneId}"`,
        }
  }

  /**
   * Build the live intent census for the layout-inspector: the IntentTree's id-level sinks/sources,
   * each publisher id mapped to its projection-type NAME (deduped, sorted). An id that no longer
   * resolves to a mounted node maps to nothing — so a stale source drops out and the host-owned
   * notification node (no single type) is skipped.
   */
  private intentCensus(): IntentCensus {
    const raw = this.intentTree.census()
    // BARE projection-type name. A mounted node's `type` is the config's QUALIFIED claim
    // (`file-tree::file-tree`), but the census keys by bare name — the declared half uses the discovery
    // `typeName` (bare), and the inspector's on-screen match is bare too. Without this the two halves
    // disagree and the capability viz never matches a leaf. Names are workspace-unique, so the strip is safe.
    const bare = (t: string): string => t.split('::')[0] ?? t
    const named = (byId: Map<string, PublisherId[]>): Map<string, string[]> => {
      const out = new Map<string, string[]>()
      for (const [type, ids] of byId) {
        const names = [...new Set(ids.map((id) => this.nodes.get(id)?.type).filter((t): t is string => !!t).map(bare))].sort()
        if (names.length) out.set(type, names)
      }
      return out
    }
    // The single last firer per type, id → bare projection-type name (a stale id maps to nothing, dropped).
    const lastFire = new Map<string, string>()
    for (const [type, id] of raw.lastFire) {
      const name = this.nodes.get(id)?.type
      if (name) lastFire.set(type, bare(name))
    }
    // The DECLARED (type-graph) half, provided by the host from the discovery snapshot.
    const declared = this.opts.declaredIntentCensus?.() ?? { firers: new Map(), handlers: new Map() }
    return {
      sinks: named(raw.sinks),
      sources: named(raw.sources),
      lastFire,
      declaredFirers: declared.firers,
      declaredHandlers: declared.handlers,
    }
  }

  /**
   * Stop serving the host transport + surface listeners, and close every open surface (call when the
   *  runtime is DISCARDED — an entry change / host unmount). Idempotent; start() can re-arm it (StrictMode).
   *  NOTE: a COMPOSITION switch within an entry does NOT reach here (the runtime is reused, memoized on the
   *  entry) — that switch closes its surfaces via `mountRootPortal`'s id-change check.
   */
  dispose(): void {
    setIntentCensusProvider(null) // stop the layout-inspector reading a torn-down runtime
    this.keybindDispatcher?.dispose()
    for (const dispose of this.hostCommandDisposers) dispose()
    this.hostCommandDisposers = []
    // Tear down the agent-host transport: drop the executor + close the socket.
    this.disposeHostBridge?.()
    this.disposeHostBridge = null
    void window.main.hostbridge.stop()
    // Stop the authority's surface listeners and close its open surfaces when this runtime is disposed.
    this.disposeSurfaceReady?.()
    this.disposeSurfaceClosed?.()
    this.disposeSurfaceCrashed?.()
    this.disposeSurfaceCloseRequested?.()
    this.disposeSurfaceReady = null
    this.disposeSurfaceClosed = null
    this.disposeSurfaceCrashed = null
    this.disposeSurfaceCloseRequested = null
    this.disposeSurfaces()
  }

  // The current pool's window-root set as a stable key, for the reachability baseline guard.
  private rootsKey(): string {
    return this.pool?.roots.join(' ') ?? ''
  }

  private mintBlockId(): string {
    // Draw a final id from this surface's granted range (synchronous, never renamed, disjoint per
    // surface). `opts.mintBlockId` stays an override seam (unused today) for a test or a future
    // authority-injected minter.
    return this.opts.mintBlockId?.() ?? this.idRange.draw()
  }

  /**
   * The cross-file nesting structure for the mounted generation, or null when nothing is
   *  mounted. Data only — Dispatch walks `parentScopeId` for nested-scope dispatch precedence; a tool can
   *  read `scopes` to show which composition governs a node. Empty `recordScope` means no nesting.
   */
  scopeTable(): ScopeTable | null {
    return this.scopes
  }

  /**
   * Surface the ghost-ref COLLAPSE and re-baseline the reachable set for the next check. A structural
   * edit that mass-reaps pre-existing records while introducing a dangling ref is a non-local wipe —
   * the parent references a ghost id no record backs, so the real records fall unreachable and are
   * reaped. `detectGhostRefCollapse` catches the fingerprint (mass reap of pre-existing records
   * co-occurring with a dangling ref) as a DELTA against the previous generation, so it is one loud
   * warning, not a scatter of orphan noise. Runs at `applyStructural`, the sole commit seam every
   * structural edit (local or surface-proposed) passes through. The known first-party cause — a
   * container minting a content leaf without its `^:` — is prevented at the source (`createChild` asks
   * the host pool and throws with none); this guard covers the residual sources it cannot: an authority
   * edit bug, a malformed surface-proposed batch, a non-conforming third-party container.
   */
  private checkGhostRefCollapse(schemas: ContainerSchemas): void {
    if (!this.pool) return
    // Compare only WITHIN one composition: a different root is a composition switch (a wholesale record
    // turnover), never a reap. Same-root generations are the self-save / structural-edit transitions
    // the footgun corrupts.
    if (this.prevReachable && this.prevReachableRootsKey === this.rootsKey()) {
      const collapse = detectGhostRefCollapse(this.prevReachable, this.pool, schemas)
      if (collapse) {
        reportHostDiagnostic({
          code: 'composition-mass-reap',
          severity: 'warning',
          subject: 'composition',
          message: `a composition edit orphaned ${collapse.reaped.length} pre-existing panes while introducing a ghost reference — a structural edit committed a ref to an id no pool record backs (an authority edit bug, a malformed surface-proposed batch, or a non-conforming container that named a pool record instead of holding it as a reference unit)`,
          detail: { reaped: collapse.reaped, ghosts: collapse.ghosts },
        })
      }
    }
    this.prevReachable = reachableRecordIds(this.pool, schemas)
    this.prevReachableRootsKey = this.rootsKey()
  }

  /**
   * Re-link the cross-file closure and re-derive the degraded mount pool from the AUTHORITATIVE entry
   * pool. Called at mount and after every structural edit: an entry-only edit leaves the cross-file refs
   * unchanged, so re-linking reproduces the nested scopes — an `analyzePool` over the entry-only pool
   * would instead DROP every nested subtree from the mount pool. Sets `this.mountPool` + `this.scopes`.
   * `report` surfaces the cross-file + graph diagnostics (true at mount, false on a re-derive that would
   * only re-warn the same findings on every edit).
   */
  private rederiveMountPool(schemas: ContainerSchemas, report = false): void {
    if (!this.pool) return
    const linked = linkPool(this.pool, schemas, (t) => this.foreignFiles.get(t), () => this.mintBlockId(), this.entryPath)
    this.scopes = linked.scopes
    const analysis = analyzePool(linked.pool, schemas)
    this.mountPool = analysis.mountPool
    if (report) {
      for (const d of [...linked.diagnostics, ...analysis.diagnostics]) {
        reportHostDiagnostic({ code: d.code, severity: d.severity, message: d.message, subject: d.subject, detail: { ids: d.ids } })
      }
    }
  }

  /** True when `id` names a record in a NESTED (foreign) scope — read-only until cross-file WRITES land. `scopes.recordScope` holds ONLY nested ids (entry records are omitted), so membership IS
   *  foreignness. An entry-only composition has an empty map, so this is always false there. */
  private isForeignScope(id: string): boolean {
    return this.scopes?.recordScope.has(id) ?? false
  }

  /** Warn ONCE per mount generation that a nested-composition edit was refused. A structural drop is
   *  user-initiated and rare (worth the message); a dialect save of a nested pane is frequent, so it is
   *  dropped silently and this only fires from the structural seams. */
  private warnForeignEdit(op: string, ids: string[]): void {
    if (this.foreignEditWarned) return
    this.foreignEditWarned = true
    reportHostDiagnostic({
      code: 'composition-nested-read-only',
      severity: 'warning',
      subject: 'composition',
      message: `a nested composition is read-only for now: ${op} was refused (editing across a file boundary lands with cross-file writes)`,
      detail: { ids },
    })
  }

  /** Write a record into the AUTHORITATIVE entry pool, RESTORING any cross-file ref the linker rewrote to
   *  a local qualified ref (`[[^^__s1-grp]]` → the original `[[nested]]`). An entry container mounted with
   *  a nested child's qualified id re-serializes it here; without this restore the original cross-file
   *  ref is overwritten and the entry file corrupts. A no-op transform when there is no nesting. */
  private writeEntryRecord(id: string, record: PoolRecord): void {
    if (!this.pool) return
    const schemas = this.opts.schemas?.()
    const restored = this.scopes && schemas ? (restoreCrossFileRefs(record, schemas, this.scopes.originRef) as PoolRecord) : record
    this.pool.records.set(id, restored)
  }

  /** Merge one node's OWN record into the pool by `^:` (the single-writer seam) and persist. A record in
   *  a nested (foreign) scope is DROPPED silently: it belongs to another file with no writer yet,
   *  and its qualified id is not in the entry pool — writing it would corrupt the entry file. */
  private mergeRecord(id: string, record: OpaqueConfig): void {
    if (!this.pool || this.isForeignScope(id)) return
    // SERIALIZE: refuse while a guarded reap holds for its close-guard decision (see `applyStructural` / `reapOrHold`).
    if (this.guardPending) {
      reportHostDiagnostic({
        code: 'commit-refused-guard-pending',
        severity: 'warning',
        subject: id,
        message: 'a dialect save was refused while a close-guard decision is open; the pool is held mid-decision. Retry once the dialog resolves.',
      })
      return
    }
    // Capture ONLY this record's prior value before the write, so a save that orphans a GUARDED record can be
    // reverted on veto (the dialect seam holds no snapshot of its own). `writeEntryRecord` mutates exactly
    // `pool.records[id]` and the guarded reap is HELD (never done) on veto, so restoring this one record fully
    // reverts the pool — an O(1) capture on the hot dialect-save path, not a whole-map copy per save.
    const prevRecord = this.pool.records.get(id)
    this.writeEntryRecord(id, record as PoolRecord)
    // Keep the DEGRADED mount pool in sync with a PLAIN save (no prune → no re-derive). `resolveRecord` /
    // `poolRecords` read `mountPool ?? pool`, so without this a container's OWN record change is invisible
    // there — and a container resync (`useContainerModel`) reads `resolveRecord`, sees the stale record,
    // and re-seeds the model back OVER the change (a materialized empty-slot placeholder was reverted this
    // way). A no-op when `mountPool === pool`; a container's own record is never a degrade-duplicate.
    const stored = this.pool.records.get(id)
    if (stored) this.mirrorToMountPool(id, stored)
    // A container saving its OWN record can RE-POINT a reference (a bento swap sets `root` to a fresh
    // child), orphaning the record it pointed at — and its whole subtree — from the pool root. That is
    // NOT a resize: the user discarded it, so PRUNE it. Without this, the orphan stays a mounted node
    // with its capabilities still registered, invisibly claiming intents (an orphaned tabs kept
    // claiming every open-intent, opening files into a group nobody could see). A plain dialect save
    // re-points nothing, so nothing is orphaned and this is a cheap reachable-set diff.
    const schemas = this.opts.schemas?.()
    // SELF-ECHO SUPPRESSION (reflect-in-place): a REGISTERED leaf's own save already reflects the change
    // (it initiated it), so seed its digest now — the next unrelated flush then sees no change and does not
    // re-deliver its own config back to it. An UNREGISTERED leaf is left stale, so the next flush bumps its
    // epoch → remount (the status-quo fallback). `mergeRecord` never `schedulePoolChange`s a plain save, so
    // this is the only place a registered self-save updates its digest.
    if (stored && schemas && this.inboundHandlers.get(id)?.size && !containerSchemaOf(stored, schemas)) {
      this.lastLeaf.set(id, { digest: leafDigest(stored), typeKey: leafTypeKey(stored) })
    }
    // The commit tail: re-baseline the reachable set, re-derive + notify when a
    // record was actually reaped, and persist. Run synchronously for a non-guarded save, or DEFERRED to the
    // async branch when a guarded orphan holds the reap (so the mid-decision pool is never persisted).
    const finish = (didReap: boolean): void => {
      if (schemas && this.pool) {
        this.prevReachable = reachableRecordIds(this.pool, schemas)
        this.prevReachableRootsKey = this.rootsKey()
      }
      if (didReap) {
        if (schemas) this.rederiveMountPool(schemas) // re-LINK nested subtrees + refresh the degraded mount pool
        this.schedulePoolChange() // the portal drops the reaped records' flat hosts
      }
      // Saved child references also change ancestry when no record was reaped.
      this.recomputePoolParents()
      this.persistPool()
    }
    // A save that RE-POINTS a reference orphans the record it pointed at (a bento swap; a tab dropped from
    // its array) — the user discarded it, so reap it (GUARDED, via `reapOrHold`, the same seam the structural
    // path uses). A plain dialect save (a resize) re-points nothing, so the orphaned set is empty and this is
    // a cheap reachable-set diff with no reap. The `prevReachable` baseline distinguishes an edit-orphan
    // (reachable-then-not, discarded) from a load-orphan (never reachable, kept), so a load orphan is never reaped.
    if (schemas && this.prevReachable && this.prevReachableRootsKey === this.rootsKey()) {
      const reachable = reachableRecordIds(this.pool, schemas)
      const orphaned = [...this.prevReachable].filter((rid) => !reachable.has(rid))
      if (orphaned.length > 0) {
        const held = this.reapOrHold(orphaned, () => {
          if (!this.pool) return
          if (prevRecord === undefined) this.pool.records.delete(id)
          else this.pool.records.set(id, prevRecord)
        }, () => finish(true))
        if (held) return // the async branch owns re-derive + persist; never commit the mid-decision pool.
        finish(true)
        return
      }
    }
    finish(false)
  }

  /** The one place `schemas` is threaded into serialize. Drops transient records + their inbound refs
   *  (`serializePoolToComposition`). The empty-schemas fallback is dead-safe: the authority always has
   *  schemas, and serialize only strips when the pool actually holds a transient record. Callers guard
   *  `this.pool` before calling. */
  private serializePool(): OpaqueConfig {
    return serializePoolToComposition(this.pool!, this.opts.schemas?.() ?? { containers: new Map(), nodes: new Map() }) as OpaqueConfig
  }

  /** TEST / DEBUG read: the composition exactly as it would PERSIST right now — the same payload
   *  `persistPool` writes, so a transient (preview / peek) record is already dropped. Exposed via the
   *  gated `window.__auComposition` bridge for e2e (proves the disk-leak is closed). Null before mount. */
  serializeComposition(): OpaqueConfig | null {
    return this.pool ? this.serializePool() : null
  }

  /** Serialize the pool FRESH to the canonical on-disk POOL FORM (a `composition` document: a `root`
   *  reference plus the flat `projections` list) and hand it to the root's persist. The host assembles
   *  from the authoritative pool, so a container's stale view is never re-serialized, and no parent
   *  embeds a child — a re-parent is a reference re-point of two flat records. */
  private persistPool(): void {
    if (!this.pool || !this.poolPersist) return
    this.poolPersist(this.serializePool())
  }

  /** Resolve a child's SUBTREE FRESH from the pool by `^:` (references inlined), so a container mounts
   *  from the current record and never caches a stale copy. Inline so the child's read path is
   *  unchanged; its own children re-resolve at their mount. */
  private resolveRecord(id: string): OpaqueConfig | undefined {
    const schemas = this.opts.schemas?.()
    const pool = this.mountPool ?? this.pool // resolve from the DEGRADED pool: a duplicate site → a placeholder
    if (!pool || !schemas) return undefined
    return resolvePoolToTree(pool, schemas, id) as OpaqueConfig | undefined
  }

  /** Mirror a record into the MOUNT pool when it diverges from the authoritative pool (i.e. under
   *  nesting or a degrade, where `mountPool` is a distinct object built by the linker). `poolRecords()`
   *  and `resolveRecord` read `mountPool`, so a freshly-created pane that only reached `this.pool` would
   *  never render (the empty-pane bug a nested composition exposed). A freshly-created child is canonical
   *  (referenced once) so it needs no degrade; adding it verbatim keeps the two pools consistent until
   *  the next re-derive. No-op when `mountPool === pool` (the common, no-nesting case). */
  private mirrorToMountPool(id: string, record: PoolRecord): void {
    if (this.mountPool && this.mountPool !== this.pool) this.mountPool.records.set(id, record)
  }

  /** BOUNDED new-content mint. Add a NEW record to the pool (a pane a container just created), return
   *  its minted `^:`. Does not persist — the container's own record save (with the new reference)
   *  triggers the persist. This is the saveConfig channel's new-content mint; a STRUCTURAL gesture
   *  uses `stageRecord` (no pool write until the batch applies). */
  private createRecord(record: OpaqueConfig, opts?: { transient?: boolean }): string {
    const id = recordIdOf(record) ?? this.mintBlockId()
    const rec = { ...(record as PoolRecord), ['^']: id }
    this.writeEntryRecord(id, rec)
    this.mirrorToMountPool(id, rec) // so poolRecords()/resolveRecord (which read mountPool) see it under nesting
    if (opts?.transient) {
      this.pool?.transient.add(id) // live-but-unpersisted: routed, but dropped at serialize
      getOpenSurfacesIndex().refresh() // the italic derives from pool.transient — nudge subscribers
    }
    this.schedulePoolChange() // a new record → the portal renders a host for it
    return id
  }

  /** Set / clear a record's TRANSIENT flag on the authority pool. Fed by `openSurfaces.setTransient`
   *  (a container declares its preview / peek child transient) and by the cross-window `set-transient`
   *  event (a floated container's declaration). Add = live-but-unpersisted; delete = promote to permanent
   *  (the record now persists). A `schedulePoolChange` re-derives so a promote's persist takes effect. */
  private setPoolTransient(id: string, transient: boolean): void {
    if (!this.pool) return
    if (transient) this.pool.transient.add(id)
    else this.pool.transient.delete(id)
    getOpenSurfacesIndex().refresh() // the italic derives from pool.transient — nudge subscribers
    this.schedulePoolChange()
  }

  /** STRUCTURAL-channel mint (PURE): DRAW a final `^:` id for a new record and return it plus the
   *  record edit, to fold into the gesture's `propose` batch. Writes NOTHING — the record lands only
   *  when `applyStructural` applies the batch, so a refused proposal leaves no orphan. The structural
   *  twin of `createRecord`. */
  private stageRecord(record: OpaqueConfig): { rootId: string; edits: ReadonlyArray<{ id: string; record: OpaqueConfig }> } {
    const id = recordIdOf(record) ?? this.mintBlockId()
    const rec = { ...(record as PoolRecord), ['^']: id } as OpaqueConfig
    return { rootId: id, edits: [{ id, record: rec }] }
  }

  /** Remove a record from the pool (a closed pane) and persist. A nested (foreign) record is READ-ONLY
   *  (no writer for its file yet): refuse + warn rather than no-op silently on the entry pool (its
   *  qualified id is not in the entry pool, so a delete would do nothing and the re-link resurrects it). */
  private removeRecord(id: string): void {
    if (!this.pool) return
    if (this.isForeignScope(id)) return this.warnForeignEdit('closing a nested pane', [id])
    // SERIALIZE: refuse while a guarded reap holds (see `reapOrHold`).
    if (this.guardPending) {
      reportHostDiagnostic({ code: 'commit-refused-guard-pending', severity: 'warning', subject: id, message: 'a record removal was refused while a close-guard decision is open; retry once the dialog resolves.' })
      return
    }
    const snapshot = new Map(this.pool.records) // for a veto restore, before the delete
    this.pool.records.delete(id)
    const schemas = this.opts.schemas?.()
    // Removing a record orphans it and its whole SUBTREE (its children fall unreachable with it). Reap that
    // cascade GUARDED, through the same `reapOrHold` seam the other two paths use — so a removeRecord that
    // would destroy a projection holding unsaved state holds for its close-guard decision like any close.
    const finish = (): void => {
      // Re-baseline AFTER the reap-or-restore (on a veto the snapshot is back, so the baseline must reflect
      // the restored pool, not the mid-edit one). Re-derive the mount pool first so `recomputePoolParents`
      // does not resurrect the removed record's edges — same order `applyStructural` keeps.
      if (schemas && this.pool) {
        this.prevReachable = reachableRecordIds(this.pool, schemas)
        this.prevReachableRootsKey = this.rootsKey()
      }
      this.persistPool()
      if (schemas) this.rederiveMountPool(schemas)
      this.recomputePoolParents()
      this.schedulePoolChange() // a removed record → the portal drops its host
    }
    if (schemas && this.prevReachable && this.prevReachableRootsKey === this.rootsKey()) {
      const reachable = reachableRecordIds(this.pool, schemas)
      const orphaned = [...this.prevReachable].filter((rid) => !reachable.has(rid))
      const held = this.reapOrHold(orphaned, () => { if (this.pool) this.pool.records = snapshot }, finish)
      if (held) return // the async branch owns re-baseline + re-derive + persist.
    }
    finish()
  }

  /** Reap ONE record a live edit orphaned: unmount its live node — dropping its intent / focus /
   *  selection capabilities so an invisible orphan immediately STOPS handling intents — and remove it
   *  from the pool (authoritative + mount). A record with no live node (already torn down, or never
   *  mounted) just leaves the pool. WINDOW-SAFE by construction: a `window` record is a pool ROOT, so it
   *  is always in the reachable set and can never be an orphan reaped here — a float is never reaped. */
  private reapOrphan(id: string): void {
    const publisher = this.nodeIdToPublisher.get(id)
    if (publisher !== undefined) this.unmount(publisher) // drops its capabilities via the channel trees
    this.releaseRemoteRecord(id) // a floated pane's remote publisher-node + stubs/follows (no-op for a local record)
// Focus + selection key on the `^:`, and this is the ONE place it genuinely leaves the pool, so their
// drops live here (NOT in `unmount`, which also fires on a remount). Keyed by id, so a local record's
// entries are dropped even though `unmount` no longer does them. For a REMOTE record `releaseRemoteRecord`
// above already dropped both — these two lines are its idempotent no-op then (focus `dropNode` guards on
// presence, selection `dropNode` is a plain delete) and the real drop for a LOCAL record.
    this.focusTree.dropNode(id)
    this.selectionTree.dropNode(id, this.poolParents.get(id) ?? null)
    this.pool?.records.delete(id)
    this.mountPool?.records.delete(id)
    this.clearPaneReflectState(id) // the record left the pool; a reused `^:` must not inherit stale epoch/digest
  }

  /**
   * Reap the records a commit made unreachable, GUARDED by the close-guard consensus. THE ONE PLACE the
   * guard runs — both commit seams (`applyStructural`, `mergeRecord`) route their reap through here.
   *
   * FAST PATH: when none of `orphaned` holds a close-guard, reap them synchronously (`reapOrphan` is the
   * sole unmount) and return false; the caller finishes its commit synchronously with non-guarded removal otherwise unchanged, adding only one cheap registry membership check.
   *
   * HELD PATH: when some orphaned record IS guarded, HOLD the reap — do not delete the records, so their
   * nodes stay mounted and a held projection's in-memory unsaved state survives. Gather the consensus
   * (interactive, async), then either COMPLETE the reap (consent) or RESTORE the pre-commit pool via
   * `revert` (veto), and run `finish` (persist + re-derive + notify) at the end of whichever branch.
   * Returns true when held, so the caller SKIPS its synchronous finish (the async branch owns it) and never
   * persists the mid-decision pool. Per-EDIT atomic: if ANY orphan is guarded the WHOLE edit's reap is
   * held, so a cancel keeps the clean siblings too.
   *
   * Serialized by `guardPending`: every commit refuses while a held reap is pending, so no stray write can
   * reap the held record or diverge the pool the decision rests on.
   */
  /**
   * Hold `guardPending` across an interactive close-guard decision, correct-by-construction.
   * - REFUSES (returns false, runs nothing) when a decision is ALREADY open, so a second close never clobbers
   *   the first's serialization (the "one guarded reap in flight" invariant the state-preservation rests on).
   * - ALWAYS clears the flag in a `finally`, so a throw in `body` can NEVER wedge the composition read-only
   *   (a stuck `guardPending` would make every future commit refuse until reload). A thrown body is reported.
   * The single home for the flag toggle: `reapOrHold` and `closeAndReapWindow` both go through here.
   */
  private async withGuardPending(body: () => Promise<void> | void): Promise<boolean> {
    if (this.guardPending) return false
    this.guardPending = true
    try {
      await body()
    } catch (err) {
      reportHostDiagnostic({
        code: 'close-guard-decision-threw',
        severity: 'warning',
        subject: 'composition',
        message: `a close-guard decision threw; the pool is released so the composition stays writable: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      this.guardPending = false
    }
    return true
  }

  private reapOrHold(orphaned: string[], revert: () => void, finish: () => void): boolean {
    const publishers = orphaned
      .map((id) => this.nodeIdToPublisher.get(id))
      .filter((p): p is PublisherId => p !== undefined)
    if (!this.closeGuardTree.hasGuardAmong(publishers)) {
      for (const id of orphaned) this.reapOrphan(id)
      return false
    }
    if (on('placement')) event('placement', 'close-hold', { records: orphaned, guarded: publishers.filter((p) => this.closeGuardTree.hasGuardAmong([p])) })
    // Reached only with `guardPending` false — every commit seam refuses (returns before calling this) while a
    // reap is pending — so `withGuardPending` always RUNS here (never the refuse branch). It sets the flag
    // synchronously (before its first await), so a commit issued before the next tick still refuses; and it
    // clears the flag in a `finally`, so a throw in the reap/revert never wedges. `finish` runs after (once).
    void this.withGuardPending(async () => {
      const consent = await this.closeGuardTree.gatherAmong(publishers)
      if (on('placement')) event('placement', consent ? 'close-reap' : 'close-veto', { records: orphaned })
      if (consent) for (const id of orphaned) this.reapOrphan(id)
      else revert()
    }).then(() => finish())
    return true
  }

  /** Pool a child that mounted INLINE (a freshly created pane, or a legacy inline container), keyed by
   *  `id`, so it becomes addressable + never dangles. Does NOT persist — the container's own next save
   *  (or a re-parent) flushes the pool; this only makes the record exist in the authoritative in-memory
   *  pool so `resolveRecord`/`recordId` see it.
   *
   *  UPSERTS on content-identity change: present with the SAME open-identity (type + `file`) is a reload /
   *  re-anchor whose pooled copy is authoritative (it may carry the child's saved state) → left alone;
   *  present with a DIFFERENT identity means the id was REUSED for other content — a preview tab swapped
   *  files — and since the flat `PaneHost` mounts from the pool, a stale record would keep the OLD file, so
   *  it is overwritten. How the pane then picks up the new file depends on the leaf: a REGISTERED one (with
   *  `onOwnConfigChange`) reflects it IN PLACE (the reflect pass delivers the record, no remount — its
   *  `contentKey` is `type#epoch`, content-free); an UNREGISTERED one is remounted (the reflect pass bumps
   *  its epoch). Absent → registered. */
  private ensureRecord(id: string, config: OpaqueConfig): void {
    if (!this.pool || !id || config == null || typeof config !== 'object') return
    const record = { ...(config as PoolRecord), ['^']: id }
    const existing = this.pool.records.get(id)
    if (existing && openIdentity(existing) === openIdentity(record)) return // same file → keep the pooled (authoritative) copy
    this.writeEntryRecord(id, record)
    // Mirror into the mount pool so the SAME-PASS second resolve (PaneProjection auto-pools, then
    // re-resolves) sees it, and so a freshly-pooled child renders under nesting (mountPool ≠ pool).
    this.mirrorToMountPool(id, record)
    this.schedulePoolChange() // an inline child became a pool record → the portal renders its host
  }

  /** Stage a synthesized GROUP record (a center-wrap) into the pool and return its `^:`. The group
   *  instance embeds its two children carrying their existing ids; `normalizeToPool` FLATTENS it, so
   *  the group record references the children (`[[^^id]]`). Only records NOT already present are
   *  added — an existing child keeps its authoritative pool record (never overwritten by the
   *  embedded snapshot), so no nesting is reintroduced. Does not persist; the following
   *  `applyStructural` does. */
  private createGroup(groupInstance: OpaqueConfig): string {
    const schemas = this.opts.schemas?.()
    if (!this.pool || !schemas || groupInstance == null || typeof groupInstance !== 'object') {
      return recordIdOf(groupInstance) ?? this.mintBlockId()
    }
    const flattened = normalizeToPool(groupInstance as Record<string, unknown>, schemas, () => this.mintBlockId())
    for (const [id, record] of flattened.records) {
      if (!this.pool.records.has(id)) {
        this.writeEntryRecord(id, record)
        this.mirrorToMountPool(id, record)
      }
    }
    this.schedulePoolChange() // a synthesized group record → the portal renders its host
    return flattened.roots[0] // a synthesized group normalizes to a single (non-window) root
  }

  /** STRUCTURAL-channel GROUP mint (PURE): DRAW a final `^:` id for the synthesized group and return
   *  it plus the flattened record edits — only the genuinely NEW records; an already-present child
   *  keeps its authoritative record and is referenced by id (no nesting reintroduced, the same guard
   *  `createGroup` uses). Writes NOTHING; the records land when the host applies the `propose` batch.
   *  The structural twin of `createGroup`. */
  private stageGroup(groupInstance: OpaqueConfig): { rootId: string; edits: ReadonlyArray<{ id: string; record: OpaqueConfig }> } {
    const schemas = this.opts.schemas?.()
    if (!this.pool || !schemas || groupInstance == null || typeof groupInstance !== 'object') {
      // Degenerate (no schemas to flatten): stage nothing, mirroring `createGroup`'s no-write branch.
      return { rootId: recordIdOf(groupInstance) ?? this.mintBlockId(), edits: [] }
    }
    const flattened = normalizeToPool(groupInstance as Record<string, unknown>, schemas, () => this.mintBlockId())
    const edits: { id: string; record: OpaqueConfig }[] = []
    for (const [id, record] of flattened.records) {
      if (!this.pool.records.has(id)) edits.push({ id, record: record as OpaqueConfig })
    }
    return { rootId: flattened.roots[0], edits }
  }

  /**
   * Apply a batch of pool record edits ATOMICALLY (the structural-drop seam): merge every record by
   * its `^:`, REAP any record no longer reachable from `root` (a closed pane's orphan; a moved pane
   * stays reachable via its new parent), persist ONCE, then re-derive + remount ONCE via
   * `onStructuralEdit`. This is the "one commit, one re-render" that makes a re-parent a reference
   * re-point: the host litigates the pool a single time and `KernelRoot` rebuilds the tree, so no
   * container ever mutates its live runtime tree in place or re-serializes a stale child.
   */
  // Returns whether the batch APPLIED: a guard / disconnection revert returns FALSE, so a caller
  // that optimistically pushed a window root before committing (`float` / `openInWindow`, which must push it
  // first for the reachability walk) can undo the push + skip `openSurface`, rather than leaving a dangling
  // root the serializer would re-emit. Most callers ignore the result (a propose / mint / re-point).
  private applyStructural(edits: ReadonlyArray<{ id: string; record: OpaqueConfig }>): boolean {
    if (!this.pool) return false
    // SERIALIZE: refuse while a guarded reap is holding for its close-guard decision (a save/discard/cancel
    // dialog is open). The pool sits mid-decision; a write now could reap the held record or diverge the
    // pool the decision rests on. The state-preservation guarantee, not a nicety. See `reapOrHold`.
    if (this.guardPending) {
      reportHostDiagnostic({
        code: 'commit-refused-guard-pending',
        severity: 'warning',
        subject: 'composition',
        message: 'a structural edit was refused while a close-guard decision is open; the pool is held mid-decision. Retry once the dialog resolves.',
      })
      return false
    }
    // GUARD: never write a record under an empty/missing id. An empty id means a container could not
    // name its own pool record (it is mounted inline, not pooled), so writing here would create a
    // junk `^: ""` record and leave the real one stale — the reaper then deletes the now-unreachable
    // real records and the composition collapses. The router's `readyPoolEdit` gate should already
    // prevent this; this is the backstop, and it ABORTS the whole commit rather than half-applying.
    if (edits.some((e) => !e.id)) return false // an id-less edit means a non-pooled container; abort, never write `^: ""`.
// GUARD: a structural edit that touches a NESTED (foreign) scope is refused — a nested
// composition is read-only. This is the "structural-edit-into-
// nested guarded" case: a drop into/within a nested region, or extracting a nested pane out. A
// foreign id is not in the entry pool, so applying would create a junk entry record and reap the
// real ones; refuse the whole commit instead. The entry-only case (the common one) has no foreign
// ids, so this never fires there.
    const foreign = edits.filter((e) => this.isForeignScope(e.id)).map((e) => e.id)
    if (foreign.length > 0) {
      this.warnForeignEdit('a layout edit crossing a nested composition', foreign)
      return false
    }
    // Snapshot BEFORE applying, so a structural edit that DISCONNECTS a subtree from root (a cycle —
    // dropping a container into its own descendant) can be fully reverted rather than collapsing.
    const snapshot = new Map(this.pool.records)
    for (const { id, record } of edits) {
      this.writeEntryRecord(id, { ...(record as PoolRecord), ['^']: id }) // restore cross-file refs, never store a qualified id
    }
    const schemas = this.opts.schemas?.()
    // THE COMMIT TAIL (persist + re-derive/notify + surface sync), run ONCE — synchronously for a
    // non-guarded reap, or DEFERRED to the async branch when a guarded reap holds (so the mid-decision
    // pool is never persisted, and a veto's restored pool is what reaches disk + the portal).
    const finish = (): void => {
      // When HELD, `finish` runs asynchronously AFTER the interactive gather — the runtime can unmount
      // mid-dialog (`this.pool` nulled on teardown), so bail if the pool is gone (matches mergeRecord /
      // removeRecord's guarded finish; avoids a throw on the legacy `serializePoolToComposition(this.pool)`).
      if (!this.pool) return
      // GHOST-COLLAPSE GUARD at the SOLE commit seam: an edit that mass-reaps pre-existing records while
      // introducing a dangling ref is the catastrophic non-local wipe. Detect it as a DELTA against the
      // pre-edit reachable set (one LOUD warning) and re-baseline. Catches an authority edit bug, a
      // surface's proposed batch, or a third-party container at the one place every structural edit commits.
      if (schemas) this.checkGhostRefCollapse(schemas)
      this.persistPool() // durable: one disk write of the fresh pool form.
      if (this.portalActive) {
        // THE PORTAL PATH: no full remount. RE-DERIVE the mount pool + parent map, then notify the portal —
        // containers whose child set changed remount their thin chrome + re-render anchors; the moved pane's
        // flat host merely re-portals. Without the re-derive, resolves read a stale record.
        if (schemas) this.rederiveMountPool(schemas) // re-LINKS so nested subtrees survive the edit
        this.recomputePoolParents()
        this.schedulePoolChange()
      } else {
        // THE LEGACY PATH: `KernelRoot` tears the whole root down + rebuilds from the fresh pool.
        this.opts.onStructuralEdit?.(this.serializePool()) // one remount.
      }
      // Mirror the fresh subtree to every open surface: a floated container that PROPOSED this edit re-reads
      // its refreshed records; a nested change elsewhere reflects down too.
      this.syncSurfaces()
    }
    if (schemas) {
      const reachable = reachableRecordIds(this.pool, schemas)
      // CYCLE / DISCONNECTION BACKSTOP. If a JUST-EDITED record is no longer reachable from root, the
      // operation disconnected a subtree (dropping a container onto its own descendant). Reaping would
      // collapse the layout, so REVERT the whole commit and REFUSE — the pure containers never mutated
      // their runtime trees on this path, so restoring the pool cleanly refuses with no visible change.
      const orphanedEdit = edits.find((e) => !reachable.has(e.id))
      if (orphanedEdit) {
        this.pool.records = snapshot // restore the pre-edit pool
        reportHostDiagnostic({
          code: 'composition-structural-edit-disconnects',
          severity: 'warning',
          subject: 'composition',
          message: `refused: this move would disconnect ^${orphanedEdit.id} from the composition root — a container cannot be dropped into one of its own descendants (it would create a cycle)`,
          detail: { orphanedId: orphanedEdit.id, editIds: edits.map((e) => e.id) },
        })
        return false
      }
      // REAP the records THIS edit orphaned (a closed pane, a dissolved group), GUARDED (the close-removal
      // seam). SCOPED to `prevReachable` so a never-reachable load orphan is KEPT; the no-baseline fallback
      // reaps every unreachable record. BOTH branches route through `reapOrHold` — so both consult the guard,
      // and a guarded orphan holds the reap for its close-guard decision.
      const orphaned = this.prevReachable && this.prevReachableRootsKey === this.rootsKey()
        ? [...this.prevReachable].filter((id) => !reachable.has(id))
        : [...this.pool.records.keys()].filter((id) => !reachable.has(id))
      const held = this.reapOrHold(orphaned, () => { if (this.pool) this.pool.records = snapshot }, finish)
      if (held) return true // the async branch owns persist/derive/notify; never commit the mid-decision pool.
    }
    finish()
    return true
  }

  // ── The mount/proxy command protocol — the AUTHORITY side ──────────────────────────────
  //
  // Float re-parents a pooled record under a new WINDOW root (identity intact) and REALIZES that window
  // record as an OS surface: the authority opens the window, and on its mount agent's ready signal drives
  // the record's mount command; the surface reports events (config/focus/intent/selection) back, which
  // the authority applies to its one pool + trees. "A record's window is its site": the pool declares
  // windows, the authority realizes them (the portal-for-windows).

  /** Float a pooled record into its own OS window — the `children.pool.float` op. See the SDK doc. */
  private float(occupantId: string, sourceEdit: { id: string; record: OpaqueConfig }, options?: WindowOptions): void {
    if (!this.pool) return
    const windowId = this.mintBlockId()
    // A window record is a SITE: a sealed `mountable` branch, `content` referencing the floated record.
    // Copy the primary window's declared `type` verbatim (its `::repo` qualifier matches THIS
    // composition's owner), so a minted window resolves the same as the authored ones.
    const windowRecord = { type: this.primaryWindowType(), primary: false, content: blockRef(occupantId) } as unknown as OpaqueConfig
    // A window IS a composition ROOT (its content is reachable through it, so a float is never reaped).
    // Add the root, then keep applyStructural's reap SCOPED (roots grew, not switched) so it never
    // blanket-reaps a load orphan on this edit.
    this.pool.roots.push(windowId)
    this.prevReachableRootsKey = this.rootsKey()
    // ORIGIN CAPTURE (for `dock`): the source container's record BEFORE this extract still references the
    // occupant in its original slot, so it is the exact record `dock` restores. Snapshot it now, alongside
    // the post-extract record — `dock` restores the pre-float record iff the origin is UNCHANGED since (a
    // clean inverse); otherwise it re-attaches into the main window. Session-only (a runtime map, like
    // focus-MRU): a reopened composition's floated window docks into the main root, not the lost origin.
    const preFloat = this.pool.records.get(sourceEdit.id)
    if (preFloat !== undefined) {
      this.windowOrigins.set(windowId, { originId: sourceEdit.id, postExtract: sourceEdit.record, preFloat: preFloat as OpaqueConfig, floatedOccupantId: occupantId })
    }
    // ATOMIC: the source container's post-extract record + the new window record. `occupantId` is now
    // reachable only through the window root, so it is re-parented with its identity intact, never reaped.
    if (!this.applyStructural([sourceEdit, { id: windowId, record: windowRecord }])) {
      // the commit was guarded / reverted — undo the optimistic window-root push so no root dangles
      // (and no OS surface opens for a window that never committed).
      this.pool.roots = this.pool.roots.filter((r) => r !== windowId)
      this.prevReachableRootsKey = this.rootsKey()
      this.windowOrigins.delete(windowId)
      return
    }
    // Realize the window record as an OS surface.
    this.openSurface(windowId, options)
  }

  /** Open FRESH content in its own OS window — `float`'s sibling for content that has no SOURCE container
   *  (the open-floor "Open in a new window" escape). Mints a
   *  content record for `config` + a `window` root referencing it, commits ADDITIVELY (both new, nothing
   *  reachable-then-absent), then realizes the surface via the same window-realization `float` uses. There
   *  is no origin to dock back to, so a later dock takes the spatial-chooser fallback. This is how the
   *  open-floor's "Open in a new window" escape opens fresh content on its own surface. */
  private openInWindow(config: OpaqueConfig, options?: WindowOptions): void {
    if (!this.pool) return
    const contentId = this.mintBlockId()
    const windowId = this.mintBlockId()
    const windowRecord = { type: this.primaryWindowType(), primary: false, content: blockRef(contentId) } as unknown as OpaqueConfig
    this.pool.roots.push(windowId)
    this.prevReachableRootsKey = this.rootsKey()
    if (!this.applyStructural([{ id: contentId, record: config }, { id: windowId, record: windowRecord }])) {
      // undo the optimistic window-root push on a guarded / reverted commit, and open no surface.
      this.pool.roots = this.pool.roots.filter((r) => r !== windowId)
      this.prevReachableRootsKey = this.rootsKey()
      return
    }
    this.openSurface(windowId, options)
  }

  /** Origin provenance for a floated window, so `dock` can return the pane whence it came. Session-only
   *  (not persisted): keyed by the window-node id, holding the origin container id + its pre-float record
   *  (the clean-inverse restore target) + its post-extract record (the "unchanged since float?" witness). */
  private windowOrigins = new Map<string, { originId: string; postExtract: OpaqueConfig; preFloat: OpaqueConfig; floatedOccupantId: string }>()

  /**
   * DOCK a floated window back into the main window — the inverse of `float`, requested by the floated
   * surface's own pop-back chrome (a `dock` surface event). Re-parents the surface's content into the
   * layout and closes the OS window; the occupant's own record is never rewritten, so its identity /
   * terminal / view-state survive.
   *
   * TWO PATHS, both id-preserving, both ONE atomic pool edit:
   * - CLEAN INVERSE (origin unchanged since float): restore the origin container's pre-float record — the
   *   occupant lands back in its exact original slot.
   * - FALLBACK (origin changed / gone): ASK which main-window pane to dock into via the host's SPATIAL
   *   chooser (an <au-pane-target> over each receivable pane), then inject the occupant there via that
   *   container's own `poolEdit` seam (a `center` zone wraps-into-a-group if the slot is single-occupant).
   *   A sole candidate auto-picks; none receivable, or a cancel, keeps the window floated.
   *
   * Either way the window record is spliced from the roots so `applyStructural` reaps it, and the edit is
   * only applied once a valid home is found — a dock that cannot place the pane leaves the window floated
   * rather than orphaning (and reaping) the pane.
   */
  private async dock(windowId: string): Promise<void> {
    if (!this.pool) return
    const windowRec = this.pool.records.get(windowId) as { content?: unknown } | undefined
    const occupantId = windowRec ? parseBlockRef(windowRec.content) : undefined
    if (occupantId === undefined) return
    const occupant = this.resolveRecord(occupantId)
    if (occupant === undefined) return

    // Pop-back-in was clicked in the FLOATED window, so OS focus is there. Raise the main window now —
    // before the spatial chooser opens here — so the user can pick immediately (and, on a silent dock,
    // lands back in the main window once the floated one closes).
    window.main.surface.focusMain()
    if (on('dock')) event('dock', 'begin', { window: windowId, occupant: occupantId })

    const targetEdits = await this.dockTargetEdit(windowId, occupantId, occupant)
    if (targetEdits === null) {
      // No home chosen (origin gone AND no candidate picked / none receivable): keep the window floated
      // rather than splice the root and reap the pane. Surface it so the dead-end is observable.
      if (on('dock')) event('dock', 'abandoned', { window: windowId, reason: 'no-target-or-cancelled' })
      reportHostDiagnostic({ code: 'dock-no-target', severity: 'warning', subject: windowId, message: 'pop-back-to-main found no container to dock the pane into; the window stays floated' })
      return
    }
    // REVALIDATE after a possibly-async pick: the pool could have changed during the chooser await (a
    // second dock, a float, the window closed). If the window is no longer a live root, abandon — the
    // stale targetEdit must not apply against a moved pool.
    if (!this.pool.records.has(windowId) || !this.pool.roots.includes(windowId)) {
      if (on('dock')) event('dock', 'abandoned', { window: windowId, reason: 'window-moved-during-pick' })
      return
    }
    // The window is no longer a root; its content moved back into the layout. Splice, then apply — the
    // window record is now unreachable, so applyStructural reaps it; the occupant is reachable via the
    // target, so it survives with its id.
    this.pool.roots = this.pool.roots.filter((r) => r !== windowId)
    this.prevReachableRootsKey = this.rootsKey()
    this.applyStructural(targetEdits)
    this.windowOrigins.delete(windowId)
    if (on('dock')) event('dock', 'applied', { window: windowId, target: targetEdits.at(-1)?.id })
    void window.main.surface.close(windowId)
  }

  /** The main-window LEAF panes that can RECEIVE a docking occupant: a `[data-pane-id]` slot whose subtree
   *  holds NO nested container root (a content pane or an empty slot). A CONTAINER-occupant anchor is
   *  skipped — its own leaves are offered instead, and its rect overlaps theirs and reads as a duplicate container-kind label. Each carries a MEANINGFUL label (the
   *  occupant's own type), and its parent container has a live `poolEdit`. */
  private dockCandidates(): Array<{ paneId: string; label: string }> {
    if (typeof document === 'undefined') return []
    const out: Array<{ paneId: string; label: string }> = []
    const seen = new Set<string>()
    document.querySelectorAll<HTMLElement>('[data-pane-id]:not([data-pane-host])').forEach((el) => {
      const paneId = el.dataset['paneId']
      if (paneId === undefined || seen.has(paneId)) return
      // LEAF only: an anchor whose subtree contains a container root is a CONTAINER occupant — skip it.
      if (el.querySelector('[data-container-kind]')) return
      const placement = placementForPane(paneId)
      const pe = placement?.poolEdit
      if (!pe || !pe.recordId()) return
      seen.add(paneId)
      const type = placement?.findPane(paneId)?.type
      out.push({ paneId, label: type ? projectionLabel(type) : 'Empty slot' })
    })
    return out
  }

  /** Compute the record edit(s) that re-home a docking occupant, or null if no home is chosen. A clean
   *  inverse or an inject yields one; a WRAP onto an occupied slot yields several (the group + the slot
   *  re-point), all of which must be applied together — see `placeIntoMainLeaf`. */
  private async dockTargetEdit(windowId: string, occupantId: string, occupant: OpaqueConfig): Promise<Array<{ id: string; record: OpaqueConfig }> | null> {
    if (!this.pool) return null
    // CLEAN INVERSE (sync): a clean inverse exists ONLY when NOTHING changed since the float — both the
    // origin AND the floated CONTENT. The origin must still be present and match its post-extract witness
    // (ignoring the host-stamped `^`), AND the window's content must still be the ORIGINAL floated occupant.
    // If the content was WRAPPED / swapped in the floated window (its `content` now names a different record,
    // e.g. a tabs group holding the original pane + a newly-opened one), the pre-float record references the
    // OLD occupant, so restoring it would re-home that one pane and ORPHAN the new subtree. That is not a clean inverse; fall through to re-home the CURRENT content.
    const origin = this.windowOrigins.get(windowId)
    if (origin && occupantId === origin.floatedOccupantId) {
      const current = this.pool.records.get(origin.originId)
      if (current !== undefined && recordsEqualIgnoringId(current, origin.postExtract)) {
        if (on('dock')) event('dock', 'clean-inverse', { window: windowId, origin: origin.originId, occupant: occupantId })
        return [{ id: origin.originId, record: origin.preFloat }]
      }
    }
    // FALLBACK: place the occupant into a main-window LEAF via the shared spatial-pick + safe-wrap. ASK the
    // wrap container on an OCCUPIED non-grouping target (a real occupant is preserved, never replaced) — the
    // whole dock interaction (the spatial pane pick) already renders in the main window, so the wrap-kind pick
    // is in the same window, not a wrong-window chooser. An empty / placeholder / grouping slot never asks.
    return this.placeIntoMainLeaf(occupantId, occupant, windowId, 'dock', true)
  }

  /**
   * Place an occupant into a MAIN-window LEAF via the SAFE router rule — the shared body behind dock's
   *  fallback AND a general nested move-to-main. ASK when the choice is genuine (>=2 leaves)
   *  via the host's SPATIAL chooser (an `<au-pane-target>` over each main-window pane), auto-pick a sole
   *  leaf, return null when none is receivable or the pick is cancelled. An occupied NON-grouping slot
   *  WRAPS occupant + the incoming pane into a grouping container (never replaces); an empty or grouping
   *  slot injects. The occupant already lives in the pool, so there is no source to extract — the caller
   *  drops the old reference (a window-root splice, or the source container's post-extract record) and
   *  commits it WITH the returned target edit in one atomic apply. `subject` tags the diagnostic; `traceCat`
   *  names the tracing family ('dock' or 'move'), so the placement outcome reads under the caller's lens.
   *  DOM-based, so the target window must be LOCAL (the main window) — a secondary target has no queryable
   *  DOM here and takes the pool-level root-wrap instead.
   */
  private async placeIntoMainLeaf(occupantId: string, occupant: OpaqueConfig, subject: string, traceCat: 'dock' | 'move', ask: boolean, preChosenKind?: string): Promise<Array<{ id: string; record: OpaqueConfig }> | null> {
    const cands = this.dockCandidates()
    if (cands.length === 0) return null
    let paneId: string
    if (cands.length === 1) {
      paneId = cands[0]!.paneId
    } else {
      const picked = await getChooserSurface().choose({
        title: 'Into which pane?',
        cause: currentCause(),
        options: cands.map((c) => ({ id: c.paneId, label: c.label, anchor: c.paneId })),
      })
      if (picked === null) return null // cancelled → the caller abandons the move
      paneId = picked
    }
    // Resolve the TARGET = the picked pane's PARENT container, FRESH. Called after the pane pick above AND
    // AGAIN after the wrap-kind pick below — the placement can move during EITHER chooser await, so the
    // reparent builds from a post-await read, never a pre-await capture. The secondary-window twin is `injectOccupantIntoSecondaryRoot`.
    const resolveTarget = () => {
      const paneEl = document.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(paneId)}"]`)
      const tgt = paneEl ? findContainerRoot(paneEl) : null
      const pe = tgt?.placement.poolEdit
      const containerKind = tgt && tgt.el instanceof HTMLElement ? tgt.el.dataset['containerKind'] : undefined
      if (!tgt || !pe || !pe.recordId() || containerKind === undefined) return null
      return { pe, containerKind, existing: tgt.placement.getSlotContent(paneId) }
    }
    let resolved = resolveTarget()
    if (!resolved) return null
    // Ask for a wrap target only when an occupied non-grouping slot needs a wrapper.
    // Grouping slots add a child and empty slots accept the pane directly. The authority asks locally
    // for a main-window invocation; a secondary window supplies a choice made in that invoking window.
    let grouping = groupingForNewGroup()
    if (resolved.existing != null && !isGroupingKind(resolved.containerKind)) {
      if (ask) {
        // The wrap-pick suspends, so RE-RESOLVE the target FRESH after it (the re-resolve invariant) —
        // reparentSafeCenter then re-decides (add / wrap / inject) from the post-await occupant + container
        // kind, never a stale capture. The secondary-window twin is `injectOccupantIntoSecondaryRoot`.
        const r = await pickThenResolve(() => this.pickWrapKind('pane'), resolveTarget)
        if (r === 'cancel') return null // user dismissed the container pick → abandon the move
        if (r === 'resolve-miss') {
          if (on(traceCat)) event(traceCat, 'abandoned', { window: subject, target: paneId, reason: 'target-changed-during-pick' })
          return null
        }
        grouping = r.pick.kind ? wrapTargetForKind(r.pick.kind) : null // null → reparentSafeCenter reports no-grouping
        resolved = r.target
      } else if (preChosenKind) {
        // A SECONDARY-invoked move: the wrap-kind was twin-picked in the INVOKING window and sent up, so the
        // ask already happened there — the authority just honours the chosen kind (rendering it here would be
        // the wrong window). Absent it, the default grouping stands.
        grouping = wrapTargetForKind(preChosenKind)
      }
    }
    const target = { shape: 'slot-rect', containerKind: resolved.containerKind, slotId: paneId, zone: 'center' }
    const placed = reparentSafeCenter({
      incoming: { id: occupantId, instance: occupant as unknown as PaneInstance },
      existing: resolved.existing,
      target: { poolEdit: resolved.pe, containerKind: resolved.containerKind, slotId: paneId, descriptor: target as never },
      source: null,
      grouping,
    })
    if (!placed.ok) {
      if (placed.reason === 'no-grouping-declared') {
        reportHostDiagnostic({ code: 'no-grouping-container-declared', severity: 'warning', subject, message: 'the move needs a grouping-container to wrap the pane with the target occupant; none is present, so the move is abandoned' })
      }
      return null
    }
    if (on(traceCat)) event(traceCat, placed.outcome, { window: subject, target: paneId, containerKind: resolved.containerKind, occupant: occupantId })
    // Return ALL edits. An INJECT (empty / grouping slot) yields exactly one — the slot re-point. A WRAP (an
    // occupied non-grouping slot) yields the NEW GROUP record(s) PLUS the slot re-point that references the
    // group; dropping any of them leaves the wrapped subtree unreferenced, so `applyStructural`'s reachability
    // sweep REAPS it. Source is null
    // here (the caller drops the source reference itself), so no source-drop edit is included.
    return placed.edits.map((e) => ({ id: e.id, record: e.record as unknown as OpaqueConfig }))
  }

  /** Re-point a WINDOW's `content` ref — the window-content-root as a re-pointable SLOT. The restructure
   *  seam (unwrap/dissolve at a window root, and root-wrap) writes through here: the window that currently
   *  holds `currentContentId` as its content re-points to `newContentId`, and `applyStructural` reaps the
   *  now-unreachable old root. The new content may be a bare projection OR a container equally — the
   *  window is NOT made a container; its one content position is simply addressable like any slot. */
  repointWindowContent(currentContentId: string, newContentId: string): void {
    if (!this.pool) return
    if (currentContentId === newContentId) return
    const windowId = this.pool.roots.find(
      (r) => parseBlockRef((this.pool!.records.get(r) as { content?: unknown } | undefined)?.content) === currentContentId,
    )
    if (windowId === undefined) return
    const win = this.pool.records.get(windowId)
    if (!win) return
    this.applyStructural([
      { id: windowId, record: { ...(win as Record<string, unknown>), content: blockRef(newContentId) } as OpaqueConfig },
    ])
    // A FLOATED window's content lives on its surface, which `applyStructural` mirrors the pool cache to but
    // never re-mounts — so re-drive it (unmount the old content, mount the new). The MAIN window has no
    // surface transport; its portal re-renders from the re-derived pool, so this correctly skips it. Without
    // this a secondary-window unwrap-to-root re-points the record but leaves the old content on screen.
    if (this.surfaceTransports.has(windowId)) this.reDriveContent(windowId, currentContentId)
  }

  /** The FLOATED (surface-backed) window whose `content` ref is `contentId`, else undefined. Routes a
   *  chooser-floor wrap of a floated window's ROOT content to the authority: the DOM-keyed `wrapPane` cannot
   *  reach a record mounted on a secondary window, but the authority OWNS the window record. Only floated
   *  windows have a surface transport, so the primary (local) window stays on the placement-based path. */
  private floatedWindowOfContent(contentId: string): string | undefined {
    if (!this.pool) return undefined
    for (const windowId of this.surfaceTransports.keys()) {
      const win = this.pool.records.get(windowId) as { content?: unknown } | undefined
      if (win && parseBlockRef(win.content) === contentId) return windowId
    }
    return undefined
  }

  /** Wrap a FLOATED window's root CONTENT in a new group, authority-side (the cross-process root wrap). The
   *  authority owns the window + content records, so it mints the new viewer + a group referencing [existing
   *  content, new viewer], re-points the window's `content` to the group, and applies ATOMICALLY — the same
   *  stage-then-apply the primary root wrap uses (`rootContentPlacement`'s poolEdit), with NO DOM placement.
   *  Then RE-DRIVES the surface so the old content unmounts and the group mounts. The existing content keeps
   *  its `^:` (it becomes a child of the group), so its terminal / view-state survive. */
  private wrapRemoteWindowContent(windowId: string, contentId: string, viewer: string, path: string, kind?: string): WrapOutcome {
    if (!this.pool) return 'no-container'
    const win = this.pool.records.get(windowId)
    const existing = this.resolveRecord(contentId)
    if (!win || existing === undefined) return 'no-container'
    const cap = (kind ? wrapTargetForKind(kind) : null) ?? groupingForNewGroup()
    if (!cap) return 'no-grouping'
    const newChild = { type: viewer, file: path } as OpaqueConfig
    const newChildMint = this.stageRecord(newChild)
    const group = cap.build([
      { id: contentId, instance: existing as unknown as PaneInstance },
      { id: newChildMint.rootId, instance: newChild as unknown as PaneInstance },
    ]) as OpaqueConfig
    const groupMint = this.stageGroup(group)
    this.applyStructural([
      ...newChildMint.edits,
      ...groupMint.edits,
      { id: windowId, record: { ...(win as Record<string, unknown>), content: blockRef(groupMint.rootId) } as OpaqueConfig },
    ])
    this.reDriveContent(windowId, contentId)
    return 'wrapped'
  }

  /** Re-drive a floated window's CONTENT after its `content` ref changed (a root wrap / unwrap / dissolve):
   *  UNMOUNT the old content, then `driveMount` the window's CURRENT content. The window-content slot holds
   *  ONE record and the new content has a different id, so a re-point is unmount-old + mount-new (never a
   *  same-id remount). `applyStructural` mirrors the pool cache down but never re-mounts a window's content,
   *  so this is the missing re-drive for a floated-window root change. */
  private reDriveContent(windowId: string, oldContentId: string): void {
    const transport = this.surfaceTransports.get(windowId)
    if (!transport) return
    transport.sendCommand({ op: 'unmount', id: oldContentId, gen: this.nextGen(oldContentId) })
    this.driveMount(windowId) // mounts the window's current content (the new group) + syncs the surface
  }

  // ── Cross-window MOVE ──────────────────────────────────────────────
  // "Move to other window" generalizes float ("open in a NEW window") to "move into an EXISTING window".
  // `dock` is the special case (a floated window's whole content → main). The op is SYMMETRIC over any
  // (source, target) pair — secondary → secondary never involves the main window. The window LIST is pushed
  // to every surface so the picker renders in the window where it was triggered.

  /** The display title of a window record for the move picker: its own `title`, else "Main window" for the
   *  primary, else the primary content's projection label. */
  private windowTitle(windowId: string): string {
    const rec = this.pool?.records.get(windowId) as { title?: unknown; primary?: unknown; content?: unknown } | undefined
    if (rec && typeof rec.title === 'string' && rec.title.length > 0) return rec.title
    if (rec?.primary === true) return 'Main window'
    const contentId = parseBlockRef(rec?.content)
    const t = contentId !== undefined ? recordMountType(this.pool?.records.get(contentId)) : undefined
    return t ? projectionLabel(t) : 'Window'
  }

  /** The OPEN windows, as the move picker sees them: the primary (the local portal, no surface transport)
   *  plus every secondary with a LIVE surface. A dormant / OS-closed secondary (record lingers, no transport)
   *  is excluded — it is not a valid move target. */
  windowSites(): WindowSite[] {
    if (!this.pool) return []
    const out: WindowSite[] = []
    for (const id of this.pool.roots) {
      const primary = (this.pool.records.get(id) as { primary?: unknown } | undefined)?.primary === true
      if (!primary && !this.surfaceTransports.has(id)) continue
      out.push({ id, title: this.windowTitle(id), primary })
    }
    return out
  }

  /** Push the fresh window list to every surface, so each window's local move picker stays current. */
  private broadcastWindows(): void {
    const windows = this.windowSites()
    for (const t of this.surfaceTransports.values()) t.sendCommand({ op: 'windows-changed', windows })
    // No local re-render is forced: a container's "Move to other window" gate is re-evaluated when its ⋯
    // menu OPENS (a lazy `paneActionsMenu` factory), so the row reflects the current window set without the
    // main containers having to re-render on a foreign window opening/closing.
  }

  /** The window ROOT whose `content` ref is exactly `contentId` (a whole-window subtree), else undefined. */
  private windowOfContent(contentId: string): string | undefined {
    return this.pool?.roots.find(
      (r) => parseBlockRef((this.pool!.records.get(r) as { content?: unknown } | undefined)?.content) === contentId,
    )
  }

  /** The window whose tree CONTAINS `subtreeId` (its content, or anything reachable from it). */
  private windowOfSubtree(subtreeId: string): string | undefined {
    if (!this.pool) return undefined
    const schemas = this.opts.schemas?.()
    for (const r of this.pool.roots) {
      const contentId = parseBlockRef((this.pool.records.get(r) as { content?: unknown } | undefined)?.content)
      if (contentId === undefined) continue
      if (contentId === subtreeId) return r
      if (schemas && reachableFromRoot(this.pool, schemas, contentId).has(subtreeId)) return r
    }
    return undefined
  }

  /** Compute the source container's post-EXTRACT edit for a NESTED subtree, LOCALLY (this renderer owns the
   *  container's `poolEdit`), exactly as `floatPaneRow` does. Null for a whole-window content (no container
   *  parent) — the authority then splices the source window root. */
  private localExtract(subtreeId: string): { id: string; record: OpaqueConfig } | null {
    const placement = placementForPane(subtreeId)
    const pe = placement?.poolEdit
    if (!placement || !pe || !pe.recordId()) return null
    // Resolve the subtree address to the container's canonical POSITION at the boundary — the same
    // resolver the substrate applies, so this authority-side extract cannot fumble the id space.
    const pos = resolveAddress(placement, subtreeId, 'move-extract')
    if (pos == null) return null
    const ex = pe.extractEdit(pos)
    if (!ex) return null
    return { id: pe.recordId(), record: ex.record as OpaqueConfig }
  }

  /** THE HOST ENTRY, invoked in the MAIN window (`children.pool.moveToWindow`). Pick the target window in
   *  THIS window's chooser, extract the subtree locally, then re-parent it. The surface twin lives in the
   *  mount agent (it picks locally, then sends `move-to-window` UP). */
  private async moveToWindow(subtreeId: string): Promise<void> {
    if (!this.pool) return
    const sourceWindow = this.windowOfSubtree(subtreeId) ?? this.primaryWindowId()
    const sites = this.windowSites().filter((w) => w.id !== sourceWindow)
    const targetWindowId = await pickTargetWindow(sites)
    if (targetWindowId === null) return
    // A `null` sourceEdit tells `moveSubtreeToWindow` "whole-window content" (no container parent). That is
    // only legitimate when `subtreeId` IS a window's content; for a NESTED subtree a null extract is a FAILURE
    // (an unpooled source container, or a seam that could not resolve the id) that must abort visibly, not
    // masquerade as a whole-window move and abandon with a misleading `no-source-window`.
    const sourceEdit = this.localExtract(subtreeId)
    if (sourceEdit === null && this.windowOfContent(subtreeId) === undefined) {
      if (on('move')) event('move', 'abandoned', { subtree: subtreeId, reason: 'extract-failed' })
      return
    }
    await this.moveSubtreeToWindow(subtreeId, sourceEdit, targetWindowId)
  }

  /** THE CORE MOVE. Re-parent `subtreeId` into `targetWindowId`: inject (a MAIN target → the dock spatial
   *  placement; a SECONDARY target → a pool-level root safe-wrap), remove from the source (a nested source
   *  applies `sourceEdit`; a whole-window source splices + closes its window), commit ATOMICALLY, then
   *  re-drive the affected secondary surfaces. The subtree keeps its `^:`. */
  async moveSubtreeToWindow(subtreeId: string, sourceEdit: { id: string; record: OpaqueConfig } | null, targetWindowId: string, invokedFromAuthority = true, preChosenWrapKind?: string): Promise<void> {
    if (!this.pool) return
    const occupant = this.resolveRecord(subtreeId)
    if (occupant === undefined) return
    if (on('move')) event('move', 'begin', { subtree: subtreeId, target: targetWindowId, whole: sourceEdit === null })

    // INJECT into the target window.
    let injectEdits: Array<{ id: string; record: OpaqueConfig }>
    let targetOldContentId: string | undefined
    if (targetWindowId === this.primaryWindowId()) {
      window.main.surface.focusMain() // raise main so its spatial pick is visible (the dock precedent)
      const edits = await this.placeIntoMainLeaf(subtreeId, occupant, targetWindowId, 'move', invokedFromAuthority, preChosenWrapKind)
      if (edits === null) {
        if (on('move')) event('move', 'abandoned', { subtree: subtreeId, reason: 'no-target-or-cancelled' })
        return
      }
      injectEdits = edits
    } else {
      const injected = await this.injectOccupantIntoSecondaryRoot(targetWindowId, subtreeId, occupant, invokedFromAuthority, preChosenWrapKind)
      if (injected === 'cancel') {
        if (on('move')) event('move', 'abandoned', { subtree: subtreeId, reason: 'wrap-cancelled' })
        return
      }
      if (injected === null) {
        if (on('move')) event('move', 'abandoned', { subtree: subtreeId, reason: 'no-secondary-root' })
        return
      }
      injectEdits = injected.edits
      targetOldContentId = injected.oldContentId
    }

    // REVALIDATE after the (possibly async) pick, BEFORE any mutation — the pool may have moved during the
    // chooser await. This MUST precede the source splice below: an early return AFTER the splice would leave
    // `pool.roots` mutated with no `applyStructural`, stranding the source window's content unreachable-but-
    // un-reaped (destroyed by the next structural edit's reachability sweep).
    if (this.resolveRecord(subtreeId) === undefined || !this.pool.records.has(targetWindowId)) {
      if (on('move')) event('move', 'abandoned', { subtree: subtreeId, reason: 'moved-during-pick' })
      return
    }

    // REMOVE from the source.
    const sourceSplices: Array<{ id: string; record: OpaqueConfig }> = []
    let sourceWindowToClose: string | undefined
    if (sourceEdit === null) {
      const sourceWindowId = this.windowOfContent(subtreeId)
      if (sourceWindowId === undefined || sourceWindowId === targetWindowId) {
        if (on('move')) event('move', 'abandoned', { subtree: subtreeId, reason: 'no-source-window' })
        return
      }
      // The PRIMARY window is the persistent home — never splice/reap it. A whole-window move of the main
      // content is degenerate (the affordance is not offered on the main root), so refuse defensively.
      if (sourceWindowId === this.primaryWindowId()) {
        if (on('move')) event('move', 'abandoned', { subtree: subtreeId, reason: 'primary-window-not-movable' })
        return
      }
      // Splice the source window root: its content is now reachable through the target, so the window record
      // itself becomes unreachable and `applyStructural` reaps it. A secondary source window closes.
      this.pool.roots = this.pool.roots.filter((r) => r !== sourceWindowId)
      this.prevReachableRootsKey = this.rootsKey()
      if (sourceWindowId !== this.primaryWindowId()) sourceWindowToClose = sourceWindowId
    } else {
      // Nested source: apply its post-extract record. A nested source under a secondary window re-reads via
      // the pool-sync `applyStructural` pushes down, so no explicit re-drive of the source surface is needed.
      sourceSplices.push(sourceEdit)
    }

    this.applyStructural([...sourceSplices, ...injectEdits])
    if (targetOldContentId !== undefined) this.reDriveContent(targetWindowId, targetOldContentId)
    if (sourceWindowToClose !== undefined) {
      this.windowOrigins.delete(sourceWindowToClose)
      void window.main.surface.close(sourceWindowToClose)
    }
    this.broadcastWindows()
    if (on('move')) event('move', 'applied', { subtree: subtreeId, target: targetWindowId })
  }

  /** Inject an existing pooled occupant into a SECONDARY target window's content root — the pool-level analog
   *  of dock's `reparentSafeCenter` wrap branch (the target's DOM is not queryable here). Never destructive:
   *  wraps the target's current content + the occupant into a new grouping container and re-points the
   *  window's `content` to it. Returns the edits + the old content id (for the re-drive), or null. */
  private async injectOccupantIntoSecondaryRoot(targetWindowId: string, occupantId: string, occupant: OpaqueConfig, ask: boolean, preChosenKind?: string): Promise<{ edits: Array<{ id: string; record: OpaqueConfig }>; oldContentId?: string } | null | 'cancel'> {
    if (!this.pool) return null
    // FRESH read of the target window + its current content root. The wrap-kind pick below is an async
    // suspension, and the pool can move during it (a concurrent move re-points this window's content), so
    // the group is built from a read taken AFTER the pick, never a pre-await capture — a stale
    // `currentContentId` would wrap an id the concurrent move has already re-parented, stranding that
    // move's subtree. The main-window twin is `placeIntoMainLeaf`.
    const readTarget = (): { win: Record<string, unknown>; currentContentId: string | undefined } | null => {
      const win = this.pool!.records.get(targetWindowId)
      if (!win) return null
      return { win: win as Record<string, unknown>, currentContentId: parseBlockRef((win as { content?: unknown }).content) }
    }
    const tgt = readTarget()
    if (tgt === null) return null
    if (tgt.currentContentId === undefined) {
      // Empty target window (unusual): set its content directly to the occupant — no wrap, no ask.
      return { edits: [{ id: targetWindowId, record: { ...tgt.win, content: blockRef(occupantId) } as OpaqueConfig }] }
    }
    // A move into a secondary window wraps its current content and the moved subtree.
    // Use a wrap kind already chosen in the invoking window; otherwise ask in main for an authority-local
    // invocation, or use the sole/default target. Adding directly to an existing secondary grouping
    // container is not supported by this path.
    let cap = preChosenKind ? wrapTargetForKind(preChosenKind) : groupingForNewGroup()
    let win = tgt.win
    let currentContentId = tgt.currentContentId
    if (!preChosenKind && ask) {
      // The wrap-pick suspends, so RE-RESOLVE the window content FRESH after it (the re-resolve invariant):
      // the group is built from the post-await content id, never the pre-await capture, so a concurrent
      // move that re-pointed this window during the pick is not clobbered.
      const r = await pickThenResolve(
        () => this.pickWrapKind('pane'),
        () => {
          const t = readTarget()
          return t !== null && t.currentContentId !== undefined ? { win: t.win, currentContentId: t.currentContentId } : null
        },
      )
      if (r === 'cancel') return 'cancel'
      if (r === 'resolve-miss') {
        if (on('move')) event('move', 'abandoned', { window: targetWindowId, reason: 'target-changed-during-pick' })
        return null
      }
      cap = r.pick.kind ? wrapTargetForKind(r.pick.kind) : null
      win = r.target.win
      currentContentId = r.target.currentContentId
    }
    if (!cap) {
      reportHostDiagnostic({ code: 'no-grouping-container-declared', severity: 'warning', subject: targetWindowId, message: 'move needs a wrap-target container to place the pane in the target window; none is present, so the move is abandoned' })
      return null
    }
    const existing = this.resolveRecord(currentContentId)
    if (existing === undefined) return null
    const group = cap.build([
      { id: currentContentId, instance: existing as unknown as PaneInstance },
      { id: occupantId, instance: occupant as unknown as PaneInstance },
    ]) as OpaqueConfig
    const groupMint = this.stageGroup(group)
    return {
      edits: [...groupMint.edits, { id: targetWindowId, record: { ...win, content: blockRef(groupMint.rootId) } as OpaqueConfig }],
      oldContentId: currentContentId,
    }
  }

  /** The window-content-root as a container PLACEMENT the restructure seam finds ABOVE a root container.
   *  `dissolvePane` (unwrap at the window root) and the root wrap walk up past the root container, find
   *  this placement, and re-point the window's content through `setSlotContent` — the SAME path every
   *  container slot uses, so the seam needs no window special-case. `slotFor` returns null (a window
   *  content slot carries no admits/fixed rules), so `restructureRefused` always allows. Registered by
   *  `ProjectionHost`'s root anchor, whose `data-droptarget-id` is the current content id (the slot id). */
  rootContentPlacement(): ContainerPlacement {
    const rt = this
    const contentIds = (): string[] =>
      rt.pool
        ? rt.pool.roots
            .map((r) => parseBlockRef((rt.pool!.records.get(r) as { content?: unknown } | undefined)?.content))
            .filter((x): x is string => x !== undefined)
        : []
    return {
      panes: () => contentIds(),
      findPane: () => null,
      activate: () => {},
      getSlotContent: (slotId): Occupant | null => {
        const rec = rt.pool?.records.get(slotId)
        return rec ? { instance: rec as unknown as PaneInstance, id: slotId } : null
      },
      setSlotContent: (slotId, _instance, occupantId) => {
        if (occupantId) rt.repointWindowContent(slotId, occupantId)
      },
      moveWithin: () => false,
      extract: () => null,
      inject: () => {},
      slotFor: () => null,
      // WRAP AT THE ROOT: the pane-header affordance on a BARE window-root projection wraps it in a
      // container. `wrapPaneSolo` re-points through this seam exactly as it does for any container — it
      // mints the group, then commits the WINDOW record with its `content` re-pointed to the group.
      poolEdit: {
        recordId: () => rt.primaryWindowId() ?? '',
        // A root wrap always synthesizes a group, so BOTH mint seams STAGE via `stageGroup` (structural
        // channel: the group record rides the `propose` batch, no eager pool write).
        createRecord: (record) => rt.stageGroup(record as OpaqueConfig),
        createGroup: (group) => rt.stageGroup(group as OpaqueConfig),
        wrapEdit: (_slotId, _groupInstance, groupId) => {
          const windowId = rt.primaryWindowId()
          const win = windowId ? rt.pool?.records.get(windowId) : undefined
          if (!win) return null
          return { ...(win as Record<string, unknown>), content: blockRef(groupId) } as unknown as PaneInstance
        },
        extractEdit: () => null,
        injectEdit: () => null,
        moveWithinEdit: () => null,
        propose: (edits) => rt.applyStructural(edits as ReadonlyArray<{ id: string; record: OpaqueConfig }>),
      },
    }
  }

  /** The PRIMARY window's pool-record id (the root the app opens into). Falls back to the first root. */
  primaryWindowId(): string | undefined {
    if (!this.pool) return undefined
    return this.pool.roots.find((r) => (this.pool!.records.get(r) as { primary?: unknown } | undefined)?.primary === true) ?? this.pool.roots[0]
  }

  /** The primary window record's declared `type`, so a minted secondary window matches it (incl. the
   *  `::repo` qualifier this composition uses). Falls back to a bare `window`. */
  private primaryWindowType(): string {
    if (!this.pool) return 'window'
    for (const id of this.pool.roots) {
      const rec = this.pool.records.get(id) as { primary?: unknown; type?: unknown } | undefined
      if (rec?.primary === true && typeof rec.type === 'string') return rec.type
    }
    // No primary flagged: reuse any window root's type, else bare.
    for (const id of this.pool.roots) {
      const t = (this.pool.records.get(id) as { type?: unknown } | undefined)?.type
      if (typeof t === 'string') return t
    }
    return 'window'
  }

  /** Open (or focus) the OS surface for a window record. The mount agent boots empty and signals ready
   *  → `onSurfaceReady` creates the transport and drives the record's mount. */
  private openSurface(windowId: string, options?: WindowOptions): void {
    void window.main.surface.open({
      surfaceId: windowId,
      entryPath: this.opts.entryPath,
      compositionId: this.opts.compositionId?.(),
      // Proxy the composition-global viewer/slot defaults so a floated container resolves the SAME default
      // viewer + empty-slot placeholder the main window does (else its open falls to the chooser). Near-static,
      // read once at open — see SurfaceInit.
      viewerDefaults: this.readViewerDefaults(),
      slotDefaults: this.readSlotDefaults(),
      // The open-window set, so this surface's "Move to other window" picker has the list immediately
      // (kept fresh by `windows-changed`).
      windows: this.windowSites(),
      options,
    })
  }

  /** A surface's mount agent signalled ready: create its transport (once) and drive the window's content
   *  mount. Idempotent — a reload re-signals ready and re-drives the mount (a fresh generation). */
  private onSurfaceReady(surfaceId: string): void {
    let transport = this.surfaceTransports.get(surfaceId)
    if (!transport) {
      transport = new IpcSurfaceTransport(surfaceId)
      transport.onEvent((event) => this.onSurfaceEvent(surfaceId, event))
      this.surfaceTransports.set(surfaceId, transport)
      this.broadcastWindows() // a new window is open — refresh every surface's move picker
    }
    this.driveMount(surfaceId)
    this.grantBlocksTo(surfaceId, 2) // the surface's initial id-range: an active block + a reserve
  }

  /**
   * Grant `count` id-BLOCKS to a surface. The authority is the pool's SOLE minter, so a
   *  floated container draws FINAL, globally-unique `^:` ids from a granted block SYNCHRONOUSLY — no
   *  per-mint round-trip. The same `IdAllocator` mints surface-0's own ids, so every id across every window
   *  is disjoint. Sent as an active + reserve pair on ready, and one block per `grant-request` refill.
   */
  private grantBlocksTo(surfaceId: string, count: number): void {
    const transport = this.surfaceTransports.get(surfaceId)
    if (!transport) return
    const blocks = Array.from({ length: count }, () => this.idAllocator.grantBlock(surfaceId))
    transport.sendCommand({ op: 'grant', blocks })
  }

  /** Drive the mount command for a window's content onto its surface (authority decides, surface renders). */
  private driveMount(windowId: string): void {
    const transport = this.surfaceTransports.get(windowId)
    if (!transport || !this.pool) return
    const windowRecord = this.pool.records.get(windowId) as { content?: unknown } | undefined
    const contentId = parseBlockRef(windowRecord?.content)
    if (contentId === undefined) return
    const contentRecord = this.pool.records.get(contentId)
    if (!contentRecord) return
    const typeName = recordMountType(contentRecord)
    if (typeName === undefined) return // no mount type — nothing to resolve to a projection
    const config = this.resolveRecord(contentId) // the resolved subtree (references inlined)
    const gen = this.nextGen(contentId)
    transport.sendCommand({ op: 'mount', id: contentId, gen, typeName, config, slot: { kind: 'window-content' } })
    this.syncSurface(windowId) // seed the surface's proxied-pool cache so a container can re-read on an edit
    this.pushActiveChords() // seed the new surface's bound-chord set for native suppression (keybinds)
    this.scheduleWindowActive() // seed the new surface's active-pane ring (its window-scoped head)
  }

  /**
   * Mirror ONE surface's window-content subtree RECORDS down, so its proxied `children.pool`
   *  can serve `resolveRecord` and fire `subscribe` — the seam a floated container re-reads through after a
   *  structural edit. Sends each record in its RESOLVED (inlined) form, the exact shape the main runtime's
   *  `resolveRecord` returns, so activating the container-resync path reads an identical value (no spurious
   *  re-seed). A full subtree snapshot; the surface replaces its cache and notifies subscribers.
   */
  private syncSurface(windowId: string): void {
    const transport = this.surfaceTransports.get(windowId)
    if (!transport || !this.pool) return
    const schemas = this.opts.schemas?.()
    if (!schemas) return
    const windowRecord = this.pool.records.get(windowId) as { content?: unknown } | undefined
    const contentId = parseBlockRef(windowRecord?.content)
    if (contentId === undefined) return
    const records: { id: string; config: unknown }[] = []
    for (const id of reachableFromRoot(this.pool, schemas, contentId)) {
      const config = this.resolveRecord(id)
      if (config !== undefined) records.push({ id, config })
    }
    transport.sendCommand({ op: 'pool-sync', records })
  }

  /**
   * Mirror every open surface's subtree after a pool change so nested changes reach the surface cache.
   * No work is needed when no secondary surface is open.
   */
  private syncSurfaces(): void {
    for (const windowId of this.surfaceTransports.keys()) this.syncSurface(windowId)
  }

  /**
   * NORMALIZE surface-proposed edits before applying. A surface holds no type schemas, so a
   *  MINTED group edit arrives with its children EMBEDDED; flatten each edit into flat pool records here
   *  (the authority OWNS the schemas). Each edit's `id` is the canonical root (applyStructural stamps `^:`
   *  from it), so STAMP it before `normalizeToPool` — a builder record (a reorder) carries no `^:`. The
   *  edit's own target record is always kept; a genuinely NEW embedded record is added; an embedded record
   *  ALREADY in the pool is a child kept AUTHORITATIVE (never overwritten by the snapshot) — the same guard
   *  `stageGroup` uses locally. A flat referenced edit normalizes to itself, so this is uniform + idempotent.
   */
  private normalizeProposed(edits: ReadonlyArray<{ id: string; record: OpaqueConfig }>): { id: string; record: OpaqueConfig }[] {
    const schemas = this.opts.schemas?.()
    if (!schemas) return [...edits] // no schemas → apply as-is (does not occur with a live type graph)
    const out: { id: string; record: OpaqueConfig }[] = []
    const seen = new Set<string>()
    for (const { id, record } of edits) {
      if (record == null || typeof record !== 'object') { out.push({ id, record }); continue }
      const stamped = { ...(record as Record<string, unknown>), ['^']: id }
      const flattened = normalizeToPool(stamped, schemas, () => this.mintBlockId())
      for (const [rid, rrec] of flattened.records) {
        if (seen.has(rid)) continue
        seen.add(rid)
        if (rid !== id && this.pool?.records.has(rid)) continue // keep an existing child authoritative
        out.push({ id: rid, record: rrec as OpaqueConfig })
      }
    }
    return out
  }

  /**
   * Pool surface-minted new content ADDITIVELY, the cross-process realization of the
   *  BOUNDED `createRecord` / `createGroup` channel. Writes each already-normalized record + mirrors it to
   *  the mount pool, then one `schedulePoolChange`. Does NOT reap and does NOT persist: the record is not yet
   *  referenced, so a reap would drop it before the container's imminent `config-changed` references it; that
   *  merge persists. A record under a SECONDARY window root stays out of the main portal set (`poolRecords`
   *  is scoped to the primary window's subtree), so it renders only on its own surface, never doubly on main.
   */
  private mintFromSurface(edits: ReadonlyArray<{ id: string; record: OpaqueConfig }>, transient?: boolean): void {
    if (!this.pool) return
    for (const { id, record } of edits) {
      this.writeEntryRecord(id, record as PoolRecord)
      this.mirrorToMountPool(id, record as PoolRecord)
      if (transient) this.pool.transient.add(id) // a floated container minted a preview: drop it at serialize too
    }
    if (transient) getOpenSurfacesIndex().refresh() // the italic derives from pool.transient — nudge subscribers
    this.schedulePoolChange()
  }

  /**
   * Ask a REMOTE candidate (record `recordId` on `surfaceId`) whether it would CLAIM this intent — the pure
   *  gather query. Sends `claim` with a correlation id, awaits the surface's `claim-reply`; a
   *  hung/closed surface resolves DECLINE after the timeout, so the parallel gather never stalls on one
   *  window. This is what a remote-stub capability's `claim` returns, so the gather awaits it like any claim.
   *  NO act — the surface only runs its handler's pure predicate.
   */
  private queryRemoteClaim(surfaceId: string, recordId: string, intent: IntentPayload, from: PublisherId): Promise<boolean> {
    const transport = this.surfaceTransports.get(surfaceId)
    if (!transport) return Promise.resolve(false)
    // The cross-window claim query is a routing decision worth a trace (the E2E assertion spine, and the
    // answer to "why did an intent leave this window?"). Gate-before-construct so an off category is free.
    if (on('intent')) event('intent', 'claim-remote', { type: intent.type, surface: surfaceId, record: recordId, from, fromLabel: this.nodes.get(from)?.type })
    // The firer crosses as its stable RECORD id ('s cross-window identity), which the surface maps to
    // its own local publisher — so a firer-relative handler on that surface can resolve the firer.
    const fromRecord = this.nodes.get(from)?.nodeId ?? from
    return this.intentClaims.deliver(
      (cid) => transport.sendCommand({ op: 'claim', id: recordId, cid, from: fromRecord, intent }),
      CompositionRuntime.REMOTE_INTENT_TIMEOUT_MS,
    )
  }

  /**
   * Tell the WINNING remote candidate to ACT — the aimed COMMIT. Sent only to the first claimer,
   *  so exactly one actor and no double-open. `ack` is the routed re-home case: send with a
   *  correlation id and RETURN a promise that resolves whether the surface ACTED (a `commit-reply`), so the
   *  gather-then-commit re-homes when a winner closed between its claim-reply and the commit; a hung/closed
   *  surface declines by the same timeout the claim query uses. Without `ack` (broadcast / wired / aimed, which
   *  never re-home) it is fire-and-forget void, as before — a closed surface is a silent no-op there.
   */
  private commitToSurface(surfaceId: string, recordId: string, intent: IntentPayload, from: PublisherId, ack: boolean): void | Promise<CommitOutcome> {
    const transport = this.surfaceTransports.get(surfaceId)
    if (!transport) return ack ? Promise.resolve<CommitOutcome>('declined') : undefined // surface gone → definitively did not act → re-home.
    if (on('intent')) event('intent', 'commit-remote', { type: intent.type, surface: surfaceId, record: recordId, from, fromLabel: this.nodes.get(from)?.type })
    const fromRecord = this.nodes.get(from)?.nodeId ?? from // cross the firer's stable RECORD id (see queryRemoteClaim).
    // The surface's commit may fire a nested intent back UP. RETAIN the causal pass (keyed by its cause) so
    // that continuation RESUMES it — the cross-window cycle guard — and CARRY the cause on the command so the
    // surface tags the nested fire with it. A ROUTED intent that lands here also surfaces the OS window (a
    // cross-window open the user should see); a BROADCAST fan-out is passive and never steals focus.
    this.intentTree.retainCurrentPass()
    const raise = intent.kind !== 'broadcast'
    if (!ack) { transport.sendCommand({ op: 'commit', id: recordId, from: fromRecord, intent, raise, cause: currentCause() }); return }
    return this.intentCommits.deliver(
      (cid) => transport.sendCommand({ op: 'commit', id: recordId, from: fromRecord, intent, raise, cause: currentCause(), cid }),
      CompositionRuntime.REMOTE_INTENT_TIMEOUT_MS,
    )
  }

  /**
   * Ensure a dispatch-tree publisher exists for a remotely mounted pool record. Register it by pool ID
   * so pool-derived parentage and ambient ordering treat it as an ordinary node. Reuse an existing
   * local publisher when available; the primary portal excludes records mounted on floated surfaces.
   */
  /** Whether a publisher was minted for a REMOTE (floated-window) record — a remote candidate or a remote
   *  firer — vs a locally-mounted MAIN-window node. Lets the delivery observer raise the target window only
   *  for a cross-window routed delivery (a surface→main landing raises main). */
  private isRemotePublisher(pub: PublisherId): boolean {
    const rec = this.nodes.get(pub)?.nodeId
    return rec != null && this.remoteRecordPublishers.get(rec) === pub
  }

  private ensureRemotePublisher(recordId: string): PublisherId {
    const existing = this.remoteRecordPublishers.get(recordId) ?? this.nodeIdToPublisher.get(recordId)
    if (existing) return existing
    const publisher = this.mintId()
    const type = recordMountType(this.pool?.records.get(recordId)) ?? null
    const node: Node = { parentId: null, children: new Set(), unmountSelf: null, type, nodeId: recordId }
    this.nodes.set(publisher, node)
    this.nodeIdToPublisher.set(recordId, publisher) // so `logicalParent` resolves this node + its children.
    this.remoteRecordPublishers.set(recordId, publisher)
    this.nodeSites.set(publisher, { type: type ?? undefined, nodeId: recordId, compositionFile: this.opts.compositionId?.() })
    return publisher
  }

  /** `ensureRemotePublisher`, recording that `recordId` belongs to `surfaceId` so a surface close drops every
   *  publisher-node it minted (focus / selection / intent alike), not just the ones carrying an intent stub. */
  private remotePublisherOnSurface(surfaceId: string, recordId: string): PublisherId {
    const publisher = this.ensureRemotePublisher(recordId)
    let set = this.surfaceRemoteRecords.get(surfaceId)
    if (!set) {
      set = new Set()
      this.surfaceRemoteRecords.set(surfaceId, set)
    }
    set.add(recordId)
    return publisher
  }

  /**
   * Register a REMOTE candidate (a capability the surface reported for one of its records) as a first-class
   *  `{ claim, commit }` handler in this authority's IntentTree. `claim` returns a PROMISE — the
   *  cross-window claim query the gather awaits like any claim; `commit` sends the aimed commit command,
   *  reached only when this candidate is the first claimer in the authority's order. So a remote candidate is
   *  an ordinary gather participant, and exactly one actor commits. Idempotent per (surface, record, intentType).
   */
  private registerRemoteCandidate(surfaceId: string, recordId: string, intentType: string): void {
    const key = `${surfaceId}\0${recordId}\0${intentType}`
    if (this.remoteStubs.has(key)) return
    const publisher = this.remotePublisherOnSurface(surfaceId, recordId)
    const off = this.intentTree.registerCapability(publisher, intentType, {
      claim: (intent, from) => this.queryRemoteClaim(surfaceId, recordId, intent, from),
      commit: (intent, from, ack) => this.commitToSurface(surfaceId, recordId, intent, from, ack ?? false),
    })
    this.remoteStubs.set(key, off)
  }

  /** Drop one remote candidate (the surface reported a capability `drop`, or the record unmounted). */
  private dropRemoteCandidate(surfaceId: string, recordId: string, intentType: string): void {
    const key = `${surfaceId}\0${recordId}\0${intentType}`
    this.remoteStubs.get(key)?.()
    this.remoteStubs.delete(key)
  }

  /** Ask the SURFACE that owns record `recordId` to run its LOCAL close-guard consensus (close-removal
   *  lifecycle) — the body of the authority's proxy guard. Sends `gather-close-guard` with a correlation id and
   *  awaits the surface's `close-guard-reply`. A gone transport resolves WITHHELD (`false`, content-preserving,
   *  matching `queryRemoteClaim`'s decline-on-gone). No wire timeout on human decision time; a surface-death
   *  settles the query `false` in `onSurfaceClosed`. */
  private queryRemoteCloseGuard(surfaceId: string, recordId: string): Promise<boolean> {
    const transport = this.surfaceTransports.get(surfaceId)
    if (!transport) return Promise.resolve(false)
    if (on('placement')) event('placement', 'close-gather-remote', { surface: surfaceId, record: recordId })
    // No timeout: the gather is INTERACTIVE (a dialog). A huge budget is a last-ditch backstop only; the real
    // liveness signal is `onSurfaceClosed` settling this query `false` when the window/renderer dies.
    return this.closeGuardQueries.deliver(
      (cid) => transport.sendCommand({ op: 'gather-close-guard', id: recordId, cid }),
      CompositionRuntime.REMOTE_CLOSE_GUARD_BACKSTOP_MS,
    )
  }

  /** Register a PROXY close-guard for a surface record (`close-guard-capability add`): a guard in this
   *  authority's `closeGuardTree`, on the record's publisher, whose body is the `queryRemoteCloseGuard` wire
   *  round-trip. So the reap seam gathers a floated pane's guard exactly like a local one — `reapOrHold` is
   *  unchanged, and its synchronous `hasGuardAmong` fast-path sees the remote guard's presence. Idempotent per
   *  (surface, record). */
  private registerRemoteCloseGuard(surfaceId: string, recordId: string): void {
    const key = `${surfaceId}\0${recordId}`
    if (this.remoteCloseGuards.has(key)) return
    const publisher = this.remotePublisherOnSurface(surfaceId, recordId)
    const off = this.closeGuardTree.forNode(publisher).register(() => this.queryRemoteCloseGuard(surfaceId, recordId))
    this.remoteCloseGuards.set(key, off)
  }

  /** Drop a surface record's proxy close-guard (`close-guard-capability drop`, record reap, or surface close). */
  private dropRemoteCloseGuard(surfaceId: string, recordId: string): void {
    const key = `${surfaceId}\0${recordId}`
    this.remoteCloseGuards.get(key)?.()
    this.remoteCloseGuards.delete(key)
  }

  /**
   * Release ONE remote record's publisher-node + its stub / follow registrations. Called when the
   *  record LEAVES the pool (`reapOrphan` — a floated pane closed, so its publisher is dead) and per-record
   *  when its whole surface closes (`dropRemoteCandidatesForSurface`). A NO-OP for a record with no remote
   *  publisher (a local record, or one already released), so `reapOrphan` calls it unconditionally. Without
   *  it, a long-lived floated window that CHURNS panes accumulated permanent publisher entries (`nodes`,
   *  `remoteRecordPublishers`, `nodeSites`, `surfaceRemoteRecords`, the three trees) until the OS window
   *  closed. Idempotent (missing keys / already-dropped nodes no-op).
   */
  private releaseRemoteRecord(recordId: string): void {
    const publisher = this.remoteRecordPublishers.get(recordId)
    if (publisher === undefined) return
    // The stub (surfaceId\0recordId\0type) + follow (surfaceId\0recordId) disposers for THIS record — the
    // recordId is the SECOND `\0` segment of each key. Deregisters the intent capability / selection follow.
    for (const key of [...this.remoteStubs.keys()]) if (key.split('\0')[1] === recordId) { this.remoteStubs.get(key)?.(); this.remoteStubs.delete(key) }
    for (const key of [...this.remoteSelectionFollows.keys()]) if (key.split('\0')[1] === recordId) { this.remoteSelectionFollows.get(key)?.(); this.remoteSelectionFollows.delete(key) }
    for (const key of [...this.remoteCloseGuards.keys()]) if (key.split('\0')[1] === recordId) { this.remoteCloseGuards.get(key)?.(); this.remoteCloseGuards.delete(key) }
    // The publisher-node, from all three trees + every remote-specific map. Focus + selection are keyed by
    // `^:` (the recordId), not the publisher; intent + close-guard are publisher-keyed capability sets.
    this.selectionTree.dropNode(recordId, this.poolParents.get(recordId) ?? null)
    this.intentTree.dropNode(publisher)
    this.focusTree.dropNode(recordId) // focus recency is keyed by `^:`, not the publisher
    this.closeGuardTree.dropNode(publisher)
    this.nodes.delete(publisher)
    this.nodeSites.delete(publisher)
    if (this.nodeIdToPublisher.get(recordId) === publisher) this.nodeIdToPublisher.delete(recordId)
    this.remoteRecordPublishers.delete(recordId)
    for (const set of this.surfaceRemoteRecords.values()) set.delete(recordId)
  }

  /**
   * Drop EVERY remote candidate a surface declared, and the publisher-nodes minted for its records (the
   *  surface closed / crashed). Its records stay in the pool (dormant); only the dispatch-tree
   *  registration goes, so a stale remote candidate never lingers to time out. Per-record via
   *  `releaseRemoteRecord`, so the same teardown serves a record-level reap and a whole-surface close.
   */
  private dropRemoteCandidatesForSurface(surfaceId: string): void {
    for (const recordId of [...(this.surfaceRemoteRecords.get(surfaceId) ?? [])]) this.releaseRemoteRecord(recordId)
    this.surfaceRemoteRecords.delete(surfaceId)
  }

  /**
   * Handle a surface event: merge configuration into the authority's pool, register or remove remote
   * capabilities, settle claim replies, and relay focus and selection through the authority's trees.
   */
  private onSurfaceEvent(surfaceId: string, ev: SurfaceEvent): void {
    switch (ev.kind) {
      case 'config-changed':
        this.mergeRecord(ev.id, ev.config as OpaqueConfig)
        return
      case 'propose':
        // A floated container built a structural edit of its OWN panes (reorder / re-parent / wrap) and
        // asked. The authority is the sole committer: apply it here. `applyStructural` re-derives the pool
        // and mirrors every surface's subtree back down, so the proposing surface re-reads its
        // refreshed records and re-renders. The substrate holds no write — this is the cross-process
        // realization of the local `propose` channel.
        if (on('placement')) event('placement', 'surface-propose', { surface: surfaceId, edits: ev.edits.length })
        // A surface has no schemas, so a MINTED group edit arrives with its children EMBEDDED — NORMALIZE
        // each edit (flatten, keep existing children authoritative) before the sole committer applies.
        this.applyStructural(this.normalizeProposed(ev.edits as ReadonlyArray<{ id: string; record: OpaqueConfig }>))
        return
      case 'mint':
        // A floated container created FRESH content (a preview / pinned tab, a group-on-open). Pool it
        // ADDITIVELY — the BOUNDED channel, the cross-process twin of the local `createRecord` / `createGroup`.
        // NOT `applyStructural` (which REAPS unreachable records): the new record is not yet referenced, and
        // the container's `config-changed` — sent right after, FIFO — arrives to reference it. NORMALIZE first
        // (a group carries children embedded; the surface has no schemas) and keep an existing child
        // authoritative, exactly as `normalizeProposed` does for the structural path.
        this.mintFromSurface(this.normalizeProposed(ev.edits as ReadonlyArray<{ id: string; record: OpaqueConfig }>), ev.transient)
        return
      case 'set-transient':
        // A floated container declared a child transient / promoted it. setTransient is per-window
        // local, so the flag reaches the authority's `pool.transient` (which serialize consults) only here.
        this.setPoolTransient(ev.id, ev.transient)
        return
      case 'move-to-window':
        // Re-parent a subtree to the target already chosen in the surface's local window picker.
        // A whole-window move to main, with no `sourceEdit`, uses `dock` and its clean-inverse path.
        // Other cases use the general move. The handler does not await the operation because a main-window
        // target can require an asynchronous spatial choice.
        if (ev.sourceEdit === undefined && ev.targetWindowId === this.primaryWindowId()) {
          void this.dock(surfaceId)
        } else {
          // invokedFromAuthority=false: a secondary window fired this. The container-pick already happened in
          // THAT window's twin (`ev.wrapKind`), so the authority applies it — no ask here (which
          // would render in the wrong window). Absent wrapKind (single wrap target, or a move to main) → the
          // authority resolves it (sole/default, or main's spatial pick).
          void this.moveSubtreeToWindow(ev.subtreeId, ev.sourceEdit as { id: string; record: OpaqueConfig } | undefined ?? null, ev.targetWindowId, false, ev.wrapKind)
        }
        return
      case 'close-window':
        // The user confirmed "Close" in the `confirm-close` dialog rendered IN this window — a
        // deliberate discard. Reap its content + close the OS window. ("Cancel" emits nothing; "move to
        // another window" comes up as `move-to-window`, the whole-window relocate that closes this window.)
        void this.closeAndReapWindow(surfaceId)
        return
      case 'repoint-root':
        // A floated window's UNWRAP-TO-ROOT: its root placement (the surface twin of the main
        // `rootContentPlacement`) proxied the re-point up. The authority owns the window record, so re-point
        // THIS window's `content` from the dissolved container to its lone child — `repointWindowContent`
        // locates the window by `currentContentId` (any root), so a SECONDARY window unwraps exactly like main.
        this.repointWindowContent(ev.currentContentId, ev.newContentId)
        return
      case 'grant-request':
        // The surface's id-range ran low — hand it another block.
        this.grantBlocksTo(surfaceId, 1)
        return
      case 'claim-reply':
        // a remote candidate replied to a `claim` query — resolve the awaiting gather (the walk
        // then commits the first claimer in order; a decline drops this candidate from the running).
        this.intentClaims.settle(ev.cid, ev.claimed)
        return
      case 'commit-reply':
        // The winning remote candidate replied whether its `commit` ACTED. A reply is a
        // DEFINITIVE answer (acted, or declined and left no trace), NEVER a timeout — a timeout is the
        // absence of a reply, resolved authority-side by the correlator. So map the honest boolean to
        // `'acted'` / `'declined'`; a `'declined'` re-homes to the next claimer, an unanswered commit
        // resolves `'timeout'` (no re-home).
        this.intentCommits.settle(ev.cid, ev.acted ? 'acted' : 'declined')
        return
      case 'capability':
        // The surface declared (or dropped) a handler for one of its records — register/deregister a
        // remote candidate so a fired intent can route across the window boundary to it.
        if (ev.op === 'add') this.registerRemoteCandidate(surfaceId, ev.id, ev.intentType)
        else this.dropRemoteCandidate(surfaceId, ev.id, ev.intentType)
        return
      case 'close-guard-capability':
        // Close-removal lifecycle (cross-window): record `id` on this surface registered/dropped a close-guard.
        // Mirror it as a proxy guard in the authority's `closeGuardTree`, so the reap seam guards a floated pane.
        if (ev.op === 'add') this.registerRemoteCloseGuard(surfaceId, ev.id)
        else this.dropRemoteCloseGuard(surfaceId, ev.id)
        return
      case 'close-guard-reply':
        // The surface's reply to a `gather-close-guard` query — resolve the awaiting proxy guard.
        this.closeGuardQueries.settle(ev.cid, ev.consented)
        return
      case 'intent-fired': {
        // A surface FIRED an intent (a floated pane's firer). Route it on the AUTHORITY's tree on behalf of
        // the firer record's publisher, so a FIRER-RELATIVE intent walks the pool-derived ancestor chain
        // (co-located in the floated subtree, so it resolves within that window) and an ambient / wired /
        // broadcast intent reaches every window's candidates. The firer crosses to a target surface as its
        // stable RECORD id (queryRemoteClaim / commitToSurface).
        if (!this.pool) return
        const intent = ev.intent as IntentPayload
        const publisher = this.remotePublisherOnSurface(surfaceId, ev.id)
        if (on('intent')) event('intent', 'fire-from-surface', { type: intent.type, surface: surfaceId, record: ev.id, fromLabel: this.nodes.get(publisher)?.type, cause: ev.cause })
        // Fire as a CONTINUATION of the causal pass `ev.cause` (present when this fire happened inside a commit
        // the authority sent under a pass): it resumes that pass, so the cycle guard spans the window boundary
        // (a commit→fire→commit loop A→B→A is broken). No cause (a fresh user gesture in the surface) → a new pass.
        this.intentTree.fireContinuation(ev.cause, publisher, intent)
        return
      }
      case 'focus':
        // report focus on the record's publisher in the authority's ONE FocusTree, so focus-MRU
        // spans windows — a focus in this surface makes it the active target for an ambient intent fired in
        // any window. The publisher's logicalParent is pool-parent-derived, so it ranks in its real position.
        if (on('focus')) event('focus', 'surface-focus', { surface: surfaceId, record: ev.id })
        this.focusTree.forNode(this.remotePublisherOnSurface(surfaceId, ev.id)).report()
        return
      case 'selection-published':
        // publish on the record's publisher in the authority's ONE SelectionTree; it BUBBLES up the
        // pool-derived tree, notifying each ancestor container's followers (local, or remote via delivery-down).
        if (on('selection')) event('selection', 'surface-published', { surface: surfaceId, record: ev.id })
        this.selectionTree.forNode(this.remotePublisherOnSurface(surfaceId, ev.id)).publish(ev.selection)
        return
      case 'selection-follow':
        this.setSurfaceSelectionFollow(surfaceId, ev.id, ev.op === 'follow')
        return
      case 'keystroke':
        // Keybinds: a floated window's gate forwarded a surviving chord candidate (it canonicalized +
        // arbitrated LOCALLY, so plain typing never crossed). Resolve + fire on the AUTHORITY, against its
        // cross-window focus tree (the surface's focus was applied via the `focus` events above, flushed before
        // this by the surface's `emit`) and the composition's active keymaps — the SAME resolver + fire path the
        // main window uses (`pushKeystroke`). The surface holds no resolver of its own. The ORIGIN (this
        // window + its carried transient focus) makes the when-context + command target resolve against THIS
        // window, not main's DOM.
        this.pushKeystroke(ev.ks, { origin: { windowId: surfaceId, focus: ev.focus } })
        return
      case 'trace': {
        // a surface relayed an event from its own substrate. Re-record it into the AUTHORITY's ONE
        // ring with a `surface` attribution field, so the `trace-inspector` spans windows. The cause is carried
        // as-is (a surface never mints one → absent, or the authority's own resumed during a commit, which
        // threads correctly); the authority reassigns seq/t (its own timeline order). Already gated at the
        // surface, so re-recorded unconditionally — the trace-inspector's category filter handles display.
        const t = ev.event
        record({ category: t.category, name: t.name, kind: t.kind, cause: t.cause, subject: t.subject, severity: t.severity, cleared: t.cleared, fields: { ...t.fields, surface: surfaceId } })
        return
      }
    }
  }

  /**
   * Register (or drop) a surface record's follow of its ENCLOSING container's selection. A follow
   *  registers ONE listener on the record's publisher in the cross-window SelectionTree that delivers
   *  `selection-deliver` DOWN to this surface; the agent fans it out to the record's local followers. So a
   *  follower sees selection published by a container in ANOTHER window, uniformly with a same-window follow.
   */
  private setSurfaceSelectionFollow(surfaceId: string, recordId: string, follow: boolean): void {
    const key = `${surfaceId}\0${recordId}`
    this.remoteSelectionFollows.get(key)?.() // drop any prior follow (idempotent; unfollow reaches here too)
    this.remoteSelectionFollows.delete(key)
    if (!follow) return
    const off = this.selectionTree
      .forNode(this.remotePublisherOnSurface(surfaceId, recordId))
      .follow((value) => this.surfaceTransports.get(surfaceId)?.sendCommand({ op: 'selection-deliver', id: recordId, value }))
    this.remoteSelectionFollows.set(key, off)
  }

  /** Drop a closed surface's transport and generation state; reconcile its window record separately. */
  private onSurfaceClosed(surfaceId: string): void {
    this.dropRemoteCandidatesForSurface(surfaceId) // drop its remote candidates so none lingers to time out
    // Settle any in-flight close-guard gather WITHHELD (content-preserving): a surface that died mid-gather
    // can no longer reply, and its close-guard query has no wire timeout, so this is its liveness signal. Safe
    // to settle ALL (only one guarded reap gathers at a time — `guardPending` serializes them).
    this.closeGuardQueries.settleAll(false)
    this.windowOrigins.delete(surfaceId) // an OS-close leaves no dock/move origin to reclaim later
    this.surfaceTransports.get(surfaceId)?.dispose()
    this.surfaceTransports.delete(surfaceId)
    this.lastWindowActive.delete(surfaceId) // drop its ring change-detect baseline (a reused id starts fresh)
    this.broadcastWindows() // a window closed — refresh every surface's move picker
  }

  /**
   * The user asked to CLOSE a floated window. Main PREVENTED the OS close and asks here — a DELIBERATE
   *  close, so unlike a crash it NEVER offers reopen. An EMPTY window (no content) closes + reaps at once; a
   *  NON-EMPTY one prompts IN the closing window (the `confirm-close` command, rendered there over its own
   *  chooser). The primary never reaches here (it is not a surface window).
   */
  private onSurfaceCloseRequested(surfaceId: string): void {
    if (!this.pool?.records.has(surfaceId) || surfaceId === this.primaryWindowId()) {
      void window.main.surface.close(surfaceId) // already gone / primary → let the OS close finish, nothing to prompt
      return
    }
    const contentId = parseBlockRef((this.pool.records.get(surfaceId) as { content?: unknown } | undefined)?.content)
    if (contentId === undefined) {
      void this.closeAndReapWindow(surfaceId) // empty → close directly, no prompt
      return
    }
    if (on('lifecycle')) event('lifecycle', 'surface-close-requested', { surface: surfaceId })
    this.surfaceTransports.get(surfaceId)?.sendCommand({ op: 'confirm-close' }) // non-empty → prompt IN the window
  }

  /**
   * Close a floated window AND reap its content: the user confirmed "Close", or the window was empty.
   *  Splice the window root so its content subtree goes unreachable, then `applyStructural` reaps it — the
   *  SAME reachability sweep the whole-window MOVE uses to retire its source — and close the OS window
   *  programmatically. The panes leave the composition; the files on disk are untouched. Never the primary.
   *
   *  CLOSE-REMOVAL GATE. A deliberate window close is a REAP (its content leaves the composition), so
   *  gather the content subtree's close-guard consensus FIRST — the floated pane's dirty editor prompts
   *  save/discard/cancel IN its own window. A veto abandons the close entirely: nothing is torn down and the
   *  window stays (main already prevented the OS close). This is the GATE shape — gather then proceed-or-abort
   *  — distinct from the pane reap's hold-then-reap: here the whole window is the unit, so a veto simply stops.
   *  On consent the content proxy guards are dropped so the imminent `applyStructural` reap does not re-ask.
   */
  private async closeAndReapWindow(windowId: string): Promise<void> {
    if (!this.pool || windowId === this.primaryWindowId()) return
    if (!this.pool.roots.includes(windowId)) {
      void window.main.surface.close(windowId) // record already spliced (a race) → just finish the OS close
      return
    }
    const schemas = this.opts.schemas?.()
    const contentId = schemas ? parseBlockRef((this.pool.records.get(windowId) as { content?: unknown } | undefined)?.content) : undefined
    if (schemas && contentId !== undefined) {
      const content = [...reachableFromRoot(this.pool, schemas, contentId)]
      const publishers = content.map((id) => this.nodeIdToPublisher.get(id)).filter((p): p is PublisherId => p !== undefined)
      if (this.closeGuardTree.hasGuardAmong(publishers)) {
        // Gather through `withGuardPending`: it refuses (returns false) if another close decision is already
        // open — so this window close never clobbers a main-window reap's serialization — and it always clears
        // the flag in a `finally`, so a throw never wedges the composition. On refuse, the window stays (the OS
        // close was already prevented); the user retries once the other decision resolves.
        let consent = false
        const ran = await this.withGuardPending(async () => {
          if (on('placement')) event('placement', 'close-window-hold', { surface: windowId, records: content })
          consent = await this.closeGuardTree.gatherAmong(publishers)
        })
        if (!ran) return // another guarded decision is open — do not clobber it; the window stays
        if (on('placement')) event('placement', consent ? 'close-window-reap' : 'close-window-veto', { surface: windowId })
        if (!consent) return // veto → the window stays, nothing torn down
        // Consent obtained — drop the content proxy guards so the imminent reap does not re-ask (no double prompt).
        for (const id of content) this.dropRemoteCloseGuard(windowId, id)
      }
    }
    this.pool.roots = this.pool.roots.filter((r) => r !== windowId)
    this.prevReachableRootsKey = this.rootsKey() // scope the reap to the new roots (mirrors moveSubtreeToWindow)
    this.windowOrigins.delete(windowId)
    this.applyStructural([]) // no edits — just the reachability sweep that reaps the now-orphaned window + content (guards already consulted)
    if (on('lifecycle')) event('lifecycle', 'surface-closed-reaped', { surface: windowId })
    void window.main.surface.close(windowId) // programmatic close (no re-prompt)
    this.broadcastWindows()
  }

  /**
   * A secondary renderer crash keeps its window record dormant and retains its main-backed view-state.
   * Offer to reopen it after normal transport and publisher teardown. A deliberate close does not use
   * this path; only an unexpected `render-process-gone` event does.
   */
  private onSurfaceCrashed(surfaceId: string): void {
    // The surface id IS its window-node pool id. If it is already gone (a race with a dock/move that removed
    // the window, or a composition switch), there is nothing to reopen.
    if (!this.pool?.records.has(surfaceId)) return
    if (on('lifecycle')) event('lifecycle', 'surface-crashed', { surface: surfaceId })
    getNotificationSurface().show(
      {
        type: 'ui-notification',
        kind: 'broadcast',
        severity: 'warn',
        message: `${this.windowTitle(surfaceId)} stopped responding.`,
        // The action carries a marker `intent` (a truthy object) so the toast renderer's click path fires it;
        // the `fireAction` below ignores the payload and reopens directly (no global reopen-intent needed).
        actions: [{ label: 'Reopen', intent: { type: 'host:reopen-surface', surface: surfaceId } }],
      } as IntentPayload & { severity: 'warn'; message: string; actions: { label: string; intent: unknown }[] },
      () => this.reopenSurface(surfaceId), // the sole action is Reopen → re-realize the dormant window.
    )
  }

  /**
   * Re-realize a dormant window's OS surface. The window record persisted through the
   *  crash, so `openSurface` re-opens it + its mount agent's ready re-drives the content from the pool. A
   *  no-op if the window was removed since (docked / moved / a composition switch).
   */
  private reopenSurface(windowId: string): void {
    if (!this.pool?.records.has(windowId)) return
    if (on('lifecycle')) event('lifecycle', 'surface-reopened', { surface: windowId })
    this.openSurface(windowId)
  }

  /** The next per-record generation the authority assigns for a mount/remount/unmount command. */
  private nextGen(id: string): number {
    const g = (this.surfaceGen.get(id) ?? 0) + 1
    this.surfaceGen.set(id, g)
    return g
  }

  /**
   * Close every open surface (a composition switch — — or a runtime dispose). Self-contained: it
   *  drops each surface's remote candidates + publisher-nodes SYNCHRONOUSLY rather than relying on the async
   *  `onSurfaceClosed` (whose listener may already be torn down on a dispose), then disposes the transports
   *  (closing the OS windows) and settles the correlators + clears the window-origin bookkeeping.
   */
  private disposeSurfaces(): void {
    for (const surfaceId of [...this.surfaceTransports.keys()]) this.dropRemoteCandidatesForSurface(surfaceId)
    for (const transport of this.surfaceTransports.values()) transport.dispose()
    this.surfaceTransports.clear()
    this.surfaceGen.clear()
    this.windowOrigins.clear() // the float/dock origin bookkeeping is per open window — none survive here
    this.intentClaims.settleAll() // decline any in-flight remote claim queries (no surface can reply now)
    this.intentCommits.settleAll('declined') // the surfaces are gone → their commits definitively did not act; resolve as DECLINE so a pending re-home resolves at once (never 'timeout', which would strand it)
    this.closeGuardQueries.settleAll(false) // withhold any in-flight close-guard gather (no surface can reply now); content-preserving
  }

  /**
   * THE MOUNTED-NODE PARENT, derived from the POOL topology rather than the mount call. The routing channels (intent/focus/selection) walk this. The flat portal mounts every pane as a
   * top-level host, so the mount-call `parentId` would put every pane under the kernel root; the pool's
   * reference graph is the true tree, so parentage comes from there. Falls back to the mount-call
   * `parentId` for a node with no `^:` (an id-less mount) or when no pool is wired. The composition
   * root maps to the authority's root publisher.
   */
  private logicalParent(publisher: PublisherId): PublisherId | null {
    const node = this.nodes.get(publisher)
    if (!node) return null // the runtime owns the node lookup; the pure resolver takes it from here.
    return resolveLogicalParent({
      nodeId: node.nodeId,
      mountParentId: node.parentId,
      hasPool: this.pool != null,
      poolRoots: this.pool?.roots ?? [],
      poolParents: this.poolParents,
      nodeIdToPublisher: this.nodeIdToPublisher,
      rootPublisher: this.mainRoot,
    })
  }

  /** Recompute the pool's child → parent map for the current generation. Called at mountRoot and after
   *  every structural edit, so `logicalParent` reads the live topology. Cheap (one pass over the pool).
   *  Derived from the MOUNT pool (the degraded view panes actually mount from), NOT the canonical pool:
   *  a duplicate site mounts a PLACEHOLDER record that exists only in `mountPool`, so building the parent
   *  map from `this.pool` would leave that placeholder parentless and route it (and any focus/intent it
   *  raises) to the top instead of its real container. `mountPool` is refreshed before every call site
   *  that can change the graph (mountRoot, applyStructural, removeRecord), so it is never stale here. */
  private recomputePoolParents(): void {
    const schemas = this.opts.schemas?.()
    const pool = this.mountPool ?? this.pool
    this.poolParents = pool && schemas ? parentMap(pool, schemas) : new Map()
  }

  /** Turn the PORTAL path on/off (the kernel sets it when it mounts `PanePortalLayer`). When on, a
   *  structural edit re-derives via `onPoolChange` (the portal relocates panes, no full remount); when
   *  off, via the `onStructuralEdit` remount. Default off, so the legacy path is unchanged until wired. */
  setPortalActive(active: boolean): void {
    this.portalActive = active
  }

  /** Tear down the portal generation (a composition switch / kernel unmount). The flat panes unmount
   *  via React (PanePortalLayer); this drops the synthetic owner + the pool state + resets the flag, so
   *  a fresh `mountRootPortal` starts clean. Non-cascading — a lingering pane node cleans up on its own
   *  React unmount. */
  disposePortal(): void {
    this.portalActive = false
    this.poolChangeListeners.clear()
    this.poolChangeScheduled = false
    // Reflect-in-place state is per-record and a composition switch is a wholesale record turnover, so drop
    // it all — a reused `^:` in the next composition must start clean (no stale epoch/digest/handler).
    this.inboundHandlers.clear()
    this.contentEpoch.clear()
    this.lastLeaf.clear()
    if (this.mainRoot) {
      this.nodes.delete(this.mainRoot)
      this.mainRoot = null
    }
    // Stop persisting, but DO NOT null `this.pool` / `this.mountPool` / `this.poolParents`.
    // `mountRootPortal` overwrites them wholesale on the next setup, so nulling here only opens a window
    // (a StrictMode cleanup→setup gap) where a `resolveRecord` returns undefined for no upside. This
    // stands on that modest rule alone: don't tear down state you unconditionally repopulate.
    // Retaining the pool does not guarantee a nonblank shell: dock anchor registration and reconcile
    // DOM self-healing handle the anchor-registration race.
    // The lingering pool is inert: `poolPersist` is null (no disk write), `portalActive` is false.
    this.poolPersist = null
  }

  /** The flat set of pool records the portal layer mounts — each record's `^:` id + a `contentKey` (a
   *  full-record digest) used for selective remount: a container whose child set changed gets a new key
   *  (remount → new anchors), an untouched leaf keeps its key (its flat host is never torn down, so a
   *  running terminal / cursor survives a move). Empty when no pool is wired. */
  poolRecords(): Array<{ id: string; contentKey: string }> {
    if (!this.pool) return []
    const out: Array<{ id: string; contentKey: string }> = []
    // Mount the DEGRADED pool: a duplicate edge already resolves to a placeholder record in mountPool,
    // so the flat set carries the placeholder ids too (the portal renders their diagnostic pane).
    const pool = this.mountPool ?? this.pool
    const schemas = this.opts.schemas?.() // so a container's key excludes its child refs (no remount on a child edit)
    // EXCLUDE the SECONDARY windows' subtrees: this portal renders surface 0, so a record floated under a
    // secondary window (reachable via THAT window's content) is mounted by its surface agent, never here —
    // else the primary portal + the surface double-mount it (two consumers collide on one per-pane pty).
    // Everything else mounts, and that is deliberate: a record reachable from the PRIMARY window mounts,
    // and so does a RUNTIME-ONLY record reachable from NO window — a tabs transient-PREVIEW child, live in
    // the pool but intentionally stripped from the persisted config (`persistableConfig`), belongs to this
    // surface and must render. Scoping to the primary root instead would drop it (the empty-preview bug).
    // Single-window / a legacy pool with no window layer → the set is empty, so every record mounts.
    const secondaryReachable = new Set<string>()
    if (schemas) {
      const primaryWindowId = pool.roots.find((r) => (pool.records.get(r) as { primary?: unknown } | undefined)?.primary === true) ?? pool.roots[0]
      for (const rootId of pool.roots) {
        if (rootId === primaryWindowId) continue
        const contentId = parseBlockRef((pool.records.get(rootId) as { content?: unknown } | undefined)?.content)
        if (contentId !== undefined) for (const r of reachableFromRoot(pool, schemas, contentId)) secondaryReachable.add(r)
      }
    }
    for (const [id, record] of pool.records) {
      // A WINDOW is a SITE, not content: it has no loadable module, so the flat portal never mounts it.
      // The host opens an OS surface per window and mounts the window's `content` instead; the window
      // record stays a reap-safe pool node (reachable from the composition) that draws nothing itself.
      if (isWindowRecord(record)) continue
      if (secondaryReachable.has(id)) continue // under a secondary window — the surface mounts it
      out.push({ id, contentKey: contentKeyOf(record, schemas, this.contentEpoch.get(id) ?? 0) })
    }
    // The `portal` trace: the derived record set each re-derive produces its contentKey from. A pane
    // remounts iff its contentKey moved between two of these — so this pinpoints WHICH record changed and to
    // what `file`, catching the "a sibling edit flipped my editor's key off a stale pool record" class.
    if (on('portal')) {
      const rec = (id: string): Record<string, unknown> | undefined => pool.records.get(id) as Record<string, unknown> | undefined
      event('portal', 'records', {
        n: out.length,
        records: out.map((r) => ({ id: r.id, key: r.contentKey, type: rec(r.id)?.['type'], file: rec(r.id)?.['file'] })),
      })
    }
    return out
  }

  /** Subscribe to structural/set changes to the pool (the portal layer re-renders on these). Returns an
   *  unsubscribe. Not fired for a plain dialect `mergeRecord` (a resize), so a container never remounts
   *  on resize; fired COALESCED (one microtask per burst) so a multi-write gesture re-renders once. */
  onPoolChange(listener: () => void): () => void {
    this.poolChangeListeners.add(listener)
    return () => this.poolChangeListeners.delete(listener)
  }

  /** Coalesce a burst of pool writes into ONE listener notification on the next microtask, so a gesture
   *  that does createRecord + a ref-save (or a batched applyStructural) re-renders the portal once,
   *  after the pool has settled — never at an intermediate state (a new host with no anchor yet). */
  private schedulePoolChange(): void {
    // A pool change may touch `pool.meta.keymaps` (a keymap add/remove/reorder), so re-mirror the bound-chord
    // set to floated windows. Coalesced + no-op without surfaces, so this pays nothing in the common case.
    this.scheduleActiveChordsPush()
    // A structural change can move a pane between windows (a float / dock / re-parent), re-scoping which
    // window a `^:` belongs to — so re-derive every window's active-pane head (the ring).
    this.scheduleWindowActive()
    if (this.poolChangeScheduled || this.poolChangeListeners.size === 0) return
    this.poolChangeScheduled = true
    queueMicrotask(() => {
      this.poolChangeScheduled = false
      // Reflect leaf content changes BEFORE the listeners re-derive: deliver to registered leaves (no
      // remount) and bump the epoch of unregistered ones (remount on the derive below). Ordering matters —
      // `poolRecords()` runs inside the listeners, so the epoch must be settled first.
      this.reflectRecordChanges()
      // Refresh routing parentage from the SETTLED pool before the portal re-renders. A coalesced burst can
      // ADD an edge (a `createRecord` mint + the container's ref-save that names it — a preview tab is exactly
      // this), which grows the parent graph. The scattered recomputes fire only on a REAP (a removed edge) or
      // a structural apply, so an added-edge-via-plain-save left `poolParents` stale: a newly-mounted child
      // (the preview editor) would then publish selection/intent against a parent map that does not yet know
      // its edge, routing it to the top past the scope a sibling (Backlinks) follows. Recomputing here, before
      // the listeners mount the new child, makes `poolParents` a pure function of the current pool on EVERY
      // pool change — the invariant routing reads depend on.
      this.recomputePoolParents()
      for (const listener of [...this.poolChangeListeners]) listener()
    })
  }

  /** Register a leaf's inbound `onOwnConfigChange` handler, keyed by its `^:` nodeId. Returns a disposer the
   *  projection calls on unmount; registering is the OPT-IN to reflect-in-place (see `contentKeyOf`). */
  private registerInboundHandler(nodeId: string, cb: (config: OpaqueConfig) => void): () => void {
    let set = this.inboundHandlers.get(nodeId)
    if (!set) {
      set = new Set()
      this.inboundHandlers.set(nodeId, set)
    }
    set.add(cb)
    return () => {
      const s = this.inboundHandlers.get(nodeId)
      if (!s) return
      s.delete(cb)
      if (s.size === 0) this.inboundHandlers.delete(nodeId)
    }
  }

  /** Drop all reflect-in-place state for a record leaving the pool. The runtime is stable across composition
   *  switches, so a reused `^:` id would otherwise inherit a stale epoch / digest (→ silent stale content)
   *  or a dangling handler. Called from every removal choke (reapOrphan, the reachability sweep). */
  private clearPaneReflectState(id: string): void {
    this.inboundHandlers.delete(id)
    this.contentEpoch.delete(id)
    this.lastLeaf.delete(id)
    // reclaim the per-record surface generation. Safe to reset: a pool id is never reused WITHIN a
    // composition (the id-allocator is monotonic, authored `^:` ids are unique per file), and a switch
    // closes every surface, so no in-flight command survives to be wrongly dropped/admitted against a reset.
    this.surfaceGen.delete(id)
  }

  /** The REFLECT pass. For each LEAF record (the shared `containerSchemaOf` predicate — never a container,
   *  or a child-set change would remount its whole subtree), detect a real content change against `lastLeaf`
   *  and either DELIVER it to a registered handler (reflect in place, no remount) or BUMP the epoch (remount
   *  the unregistered fallback). A TYPE change is left to `contentKeyOf` (the type is IN the key), never
   *  delivered — a doomed handler must not receive a foreign-typed config. Runs once per coalesced flush,
   *  BEFORE listeners re-derive. Reads the SAME pool `poolRecords`/`resolveRecord` read (`mountPool ?? pool`). */
  private reflectRecordChanges(): void {
    const schemas = this.opts.schemas?.()
    const pool = this.mountPool ?? this.pool
    if (!schemas || !pool) return // no schema graph → leaf/container undecidable; contentKeyOf falls back to full-record
    for (const [id, record] of pool.records) {
      if (containerSchemaOf(record, schemas)) continue // containers reflect via useContainerModel, never epoch
      const digest = leafDigest(record)
      const typeKey = leafTypeKey(record)
      const handlers = this.inboundHandlers.get(id)
      const action = reflectDecision(this.lastLeaf.get(id), digest, typeKey, !!handlers?.size)
      if (action === 'none') continue // record unchanged; lastLeaf already matches
      if (action === 'deliver') {
        const fresh = this.resolveRecord(id)
        if (fresh !== undefined) for (const cb of [...(handlers ?? [])]) cb(fresh) // deliver — the handler is idempotent
        // Re-read AFTER delivery: a handler that re-saves (open() → saveConfig → mergeRecord) must not
        // re-trigger next flush. Seed the digest to the post-delivery record.
        const after = (this.mountPool ?? this.pool)?.records.get(id)
        this.lastLeaf.set(id, { digest: after ? leafDigest(after) : digest, typeKey })
        continue
      }
      if (action === 'bump') this.contentEpoch.set(id, (this.contentEpoch.get(id) ?? 0) + 1) // no handler → remount
      // 'seed' (first sight), 'type-change' (left to contentKeyOf), and 'bump' all record the new state.
      this.lastLeaf.set(id, { digest, typeKey })
    }
  }

  /** Read the composition DOCUMENT's declared routing (defaults / initial-focus / wires / reach) off its
   *  `intent-routing` FIELD + arm it (reset per mountRoot). Routing rides the composition's `intent-routing`
   *  field (a `composition-config` aspect record), captured generically into `pool.meta['intent-routing']`.
   *  A composition with no routing carries no field, so `routingOf` yields undefined and every kind is empty. */
  private installRouting(meta: Record<string, unknown> | undefined): void {
    const routing = routingOf(meta)
    this.routingRules = this.parseRoutingRules(routing)
    this.pendingInitialFocus = refBareName(routing?.['initial-focus']) ?? null
    this.wires = this.parseWires(routing)
    this.reach = this.parseReach(routing)
    // PER-SCOPE table. ENTRY = the three fields above (bare ids). Each NESTED scope parses
    // its OWN composition's `intent-routing` field (from the scope table) and QUALIFIES its wire/reach ids to
    // the scope's prefix, so they match the mounted nodes' qualified ids. `defaults` are kind-based (role
    // closures), scope-independent, so they need no qualification — only WHICH candidates they apply to
    // (the scope's own) changes, and the scope-aware walk handles that.
    this.rulesByScope = new Map([[ENTRY_SCOPE, { routingRules: this.routingRules, wires: this.wires, reach: this.reach }]])
    if (this.scopes) {
      for (const [sid, info] of this.scopes.scopes) {
        if (sid === ENTRY_SCOPE) continue
        const r = routingOf(info.meta)
        this.rulesByScope.set(sid, {
          routingRules: this.parseRoutingRules(r),
          wires: this.parseWires(r).map((w) => ({ ...w, source: qualifyScopedId(sid, w.source), targets: w.targets.map((t) => qualifyScopedId(sid, t)) })),
          reach: this.parseReach(r).map((r) => ({ ...r, node: qualifyScopedId(sid, r.node) })),
        })
      }
    }
    // VALIDATE the wire table against the pool at load (warn-degrade, like the reference-graph
    // diagnostics): one wire per (source, intent), and every endpoint names an existing pool record.
    // A dangling wire is inert by construction (dispatch keys by a live pool-id); this surfaces it.
    if (this.pool && this.wires.length > 0) {
      const poolIds = new Set(this.pool.records.keys())
      for (const f of validateWires(this.wires, poolIds)) {
        reportHostDiagnostic({
          code: f.code,
          severity: 'warning',
          message: f.message,
          subject: f.intent,
          detail: { source: f.source, ...(f.target !== undefined ? { target: f.target } : {}) },
        })
      }
    }
  }

  /** Scope the ambient candidates for `intentType` per the composition's declared routing. null (no
   *  applicable rule) → the plain focus-MRU walk. priority → declared owners + the rest; whitelist →
   *  declared only; block → the rest (declared EXCLUDED). A rule with a `source` applies only when the
   *  FIRER plays that role-kind; the FIRST applicable rule for the intent wins (a source-conditioned
   *  rule that does not apply falls through to a later general rule). Composing MULTIPLE applicable
   *  rules is not supported. */
  /** The routing rule that applies to `intentType` fired from `from` in `scopeId` (a nested scope's own
   *  `intent-defaults` govern its subtree; unknown scopes fall back to the entry). A `source`-conditioned
   *  rule applies only when the firer plays that role-kind; the first applicable rule wins. */
  private applicableRule(intentType: string, from: PublisherId, scopeId: string): RoutingRule | undefined {
    const rules = (this.rulesByScope.get(scopeId) ?? this.rulesByScope.get(ENTRY_SCOPE))?.routingRules ?? this.routingRules
    return rules.find(
      (r) => r.intent === intentType && (r.source === undefined || this.nodePlaysAnyRole(from, [r.source])),
    )
  }

  private scopeAmbient(
    intentType: string,
    from: PublisherId,
    owners: PublisherId[],
    scopeId: string,
  ): { preferred: PublisherId[]; rest: PublisherId[]; mode: 'priority' | 'whitelist' | 'block' } | null {
    const rule = this.applicableRule(intentType, from, scopeId)
    if (!rule) return null
    const preferred: PublisherId[] = []
    const rest: PublisherId[] = []
    for (const o of owners) (this.nodePlaysAnyRole(o, rule.roles) ? preferred : rest).push(o)
    return { preferred, rest, mode: rule.mode }
  }

  /** Why an intent went unhandled, as a sentence for the warning. When capable handlers EXIST but a
   *  declared `whitelist` / `block` routing rule excluded ALL of them, NAME that rule — the common
   *  "swapped the whitelisted container out and open dead-ends" footgun. Otherwise the generic hint. */
  private unhandledReason(type: string, from: PublisherId): string {
    const owners = this.intentTree.ownersHandling(type)
    if (owners.length > 0) {
      const rule = this.applicableRule(type, from, this.scopeOfNode(from))
      if (rule && (rule.mode === 'whitelist' || rule.mode === 'block')) {
        const plays = (o: PublisherId): boolean => this.nodePlaysAnyRole(o, rule.roles)
        // The candidates the rule actually keeps: whitelist keeps only the named roles; block keeps the rest.
        const kept = rule.mode === 'whitelist' ? owners.filter(plays) : owners.filter((o) => !plays(o))
        if (kept.length === 0) {
          const roleList = rule.roles.join(', ')
          const n = owners.length
          const panes = `${n} open ${n === 1 ? 'pane' : 'panes'} that could take it`
          return rule.mode === 'whitelist'
            ? `This composition's intent-routing restricts it to ${roleList} (mode: whitelist), and none is present — the ${panes} ${n === 1 ? 'was' : 'were'} excluded. Loosen the rule (mode: priority), or open one of those.`
            : `This composition's intent-routing blocks ${roleList} (mode: block), which excludes the ${panes}. Loosen the rule.`
        }
      }
    }
    return 'The pane that would normally take it may be closed.'
  }

  /** Surface an unclaimed intent as an advisory warning. The host cannot know which surface should
   *  have taken it; reporting turns "the app ignored me" into something someone can act on. */
  private showUnhandledWarning(type: string, from: PublisherId): void {
    getNotificationSurface().show(
      {
        type: 'ui-notification',
        kind: 'broadcast',
        severity: 'warn',
        message: `Nothing handled "${type}". ${this.unhandledReason(type, from)}`,
      } as IntentPayload & { severity: 'warn'; message: string },
      () => {},
    )
  }

  /** THE UNHANDLED-INTENT FLOOR (generic): an ambient intent no present handler claimed. Discover the
   *  projection TYPES that DECLARE handling it (`handlersFor`), ask the user to ADD one, wrap a picked pane
   *  in that container, and re-dispatch the intent when the container's handler binds (`onHandlerRegistered`).
   *  The passive notification is the fallback — nothing is even capable, or the user cancels. The open-intent
   *  file case keeps its richer `openFloor`; this is the floor for every OTHER ambient intent.
   *   */
  private async addHandlerFloor(intent: IntentPayload, from: PublisherId, type: string): Promise<void> {
    const cause = currentCause() // the originating dispatch pass, so the ASK + re-dispatch thread back to one gesture.
    const descriptors = this.opts.describeProjections?.()
    const bare = (t: string): string => t.split('::')[0] ?? t
    const label = (t: string): string => descriptorLabel(descriptors?.find((d) => bare(d.type) === t), t)

    // Capable handler TYPES for this intent (handles-intent-meta), whether or not any instance is present.
    const wrappable = new Set(wrapTargets().map(target => bare(target.typeName)))
    const capable = handlersFor(type, descriptors).filter(candidate => wrappable.has(bare(candidate)))
    if (capable.length === 0) { this.showUnhandledWarning(type, from); return } // nothing COULD handle it → the advisory floor.

    // STEP 1 — add which capable handler.
    const pickedType = await getChooserSurface().choose({
      title: `Nothing here can handle "${type}" — add a capable handler`,
      options: capable.map((t) => ({ id: t, label: label(t) })),
      cause,
    })
    if (!pickedType) return // declined.

    // STEP 2 — the target: which pane to wrap in the new container (its content becomes the container's
    // child; the re-dispatched intent then fills the container). Every leaf pane is a target, the firer's
    // own among them (the "wrap the launcher in a bento" a user would otherwise do by hand).
    const panes = this.dockCandidates()
    if (panes.length === 0) { this.showUnhandledWarning(type, from); return } // no pane to wrap → advisory.
    const pickedPane = panes.length === 1
      ? panes[0]!.paneId
      : await getChooserSurface().choose({
          // `anchor` per option → the chooser renders SPATIALLY (point-and-click over each pane's live rect,
          // keyboard hints), the same picker the move-to-window / merge-back flow uses, not a second list dialog.
          title: `Wrap which pane in ${label(pickedType)}?`,
          options: panes.map((p) => ({ id: p.paneId, label: p.label, anchor: p.paneId })),
          cause,
        })
    if (!pickedPane) return // cancelled the target pick.

    // Wrap the picked pane's content SOLO in the chosen container. Fall back to the ROOT-content placement
    // when the pane is the bare root (no holding container), the case `wrapPaneSolo`'s override addresses.
    let outcome = wrapPaneSolo(pickedPane, pickedType)
    if (outcome === 'no-container') outcome = wrapPaneSolo(pickedPane, pickedType, this.rootContentPlacement())
    if (on('placement')) event('placement', 'add-handler-wrap', { target: pickedPane, kind: pickedType, intent: type, outcome })
    if (outcome !== 'wrapped') {
      const why = outcome === 'refused' ? 'the slot is fixed or does not admit a container'
        : outcome === 'no-grouping' ? `${label(pickedType)} cannot wrap a pane`
        : 'it could not be wrapped here'
      getNotificationSurface().show(
        { type: 'ui-notification', kind: 'broadcast', severity: 'warn', message: `Couldn't add ${label(pickedType)} — ${why}.` } as IntentPayload & { severity: 'warn'; message: string },
        () => {},
      )
      return
    }
    // The new container mounts and binds its handler → `onHandlerRegistered` re-dispatches this intent at
    // it. Swept after a bounded window so a container that never registered cannot re-fire a later add.
    this.pendingRedispatch.set(type, { intent, from, cause })
    window.setTimeout(() => this.pendingRedispatch.delete(type), 10_000)
  }

  /** Resolve eligible viewers and offer destinations for a container-less open: an existing
   * viewer, a pane or a new window. Deliberate composition routing restrictions remain authoritative;
   * an emptied whitelist/block set is reported by the named-rule warning rather than bypassed here.
   */
  private async openFloor(intent: IntentPayload, from: PublisherId): Promise<void> {
    // The ORIGINATING cause (the unclaimed open's dispatch pass), captured BEFORE any await, so the chooser
    // and the eventual aimed delivery thread back to ONE gesture instead of minting fresh causes. Trace-only.
    const cause = currentCause()
    const path = (intent as { target?: { path?: unknown } }).target?.path
    if (typeof path !== 'string' || path.length === 0) {
      // No concrete file on the payload (e.g. a link-selection needing async engine resolution ). The generic warning is the honest fallback.
      this.showUnhandledWarning('open-intent', from)
      return
    }
    const name = path.split('/').pop() ?? path
    const descriptors = this.opts.describeProjections?.()
    const bare = (t: string): string => t.split('::')[0] ?? t

    // OPEN section — opens-eligible MOUNTED viewers become two rows each: REPLACE (swap this viewer's
    // file in place) and WRAP (give the bare viewer a home — wrap its slot in a new container holding
    // it + a new viewer for the file). A viewer is a target because it CAN render this file (`opens-meta`
    // eligibility), NOT because it is an ambient candidate — so REPLACE never resurrects, and WRAP
    // is the in-place cure for the dead-end (a plain new-window is the universal NEW-section escape).
    const REPLACE = 'replace:'
    const WRAP = 'wrap:'
    const NEW_WINDOW = '__aup_open_new_window__'
    const INTO_PANE = '__aup_open_into_pane__'
    const eligible = viewersFor(path, descriptors)
    const rows = [...this.nodes.entries()]
      .filter(([, node]) => node.type !== null && eligible.includes(bare(node.type)))
      .flatMap(([pub, node]) => {
        const label = descriptorLabel(descriptors?.find((d) => bare(d.type) === bare(node.type as string)), node.type as string)
        const current = (this.pool?.records.get(node.nodeId) as Record<string, unknown> | undefined)?.['file']
        const hint = typeof current === 'string' ? (current.split('/').pop() ?? current) : undefined
        return [
          { id: `${REPLACE}${pub}`, label: `Open in ${label}`, hint: hint ? `Replaces ${hint} in this pane` : undefined },
          { id: `${WRAP}${node.nodeId}`, label: `Keep ${label} and add this file`, hint: hint ? `Preserves ${hint} in a shared layout` : undefined },
        ]
      })

    // Offer the pane picker whenever a main-window pane can receive content, including when no mounted
    // viewer is eligible for replacement or wrapping. Fill an empty or placeholder slot; wrap an occupied
    // slot after asking for a container. This complements the viewer-specific destination rows.
    const intoPaneRow = this.dockCandidates().length > 0 ? [{ id: INTO_PANE, label: 'Choose a pane…' }] : []

    const viewerResolution = resolveViewer(path, descriptors, { viewerDefaults: this.readViewerDefaults() })
    const viewers = 'mustPick' in viewerResolution
      ? { options: viewerPickOptions(viewerResolution.mustPick, descriptors ?? []) }
      : { chosen: viewerResolution.viewer, options: [] }
    const canCreateViewer = !!viewers.chosen || viewers.options.length > 0
    const destinations = canCreateViewer
      ? [...rows, ...intoPaneRow, { id: NEW_WINDOW, label: 'Open in a new window' }]
      : rows.filter(row => row.id.startsWith(REPLACE))
    if (destinations.length === 0) {
      this.showUnhandledWarning('open-intent', from)
      return
    }
    const layout = wrapTargetOutcome()
    const chosenLayout = layout && (layout.reason === 'requested' || layout.reason === 'only') ? layout.chosen?.typeName : undefined
    const plan = await chooseOpeningPlan({
      name,
      destinations,
      viewers,
      layouts: { chosen: chosenLayout, options: [...wrapTargets()]
        .sort((a, b) => a.family === b.family ? 0 : a.family === 'grouping' ? -1 : 1)
        .map(t => ({ id: t.typeName, label: descriptorLabel(descriptors?.find(d => bare(d.type) === bare(t.typeName)), t.typeName), section: t.family === 'grouping' ? 'Stack' : 'Arrange' })) },
      panes: this.dockCandidates().map(candidate => {
        const placement = placementForPane(candidate.paneId)
        const position = placement ? resolveAddress(placement, candidate.paneId, 'place') : null
        const content = placement && position ? placement.getSlotContent(position) : null
        const type = (content?.instance as { type?: string } | undefined)?.type
        const placeholder = type != null && (this.opts.kindsOf?.(type) ?? []).some(kind => bare(kind) === 'placeholder-projection')
        const occupied = content != null && !placeholder
        return { id: candidate.paneId, anchor: candidate.paneId, label: candidate.label, occupied,
          hint: occupied ? 'Keep current content and add this file in a shared layout' : 'Open here without changing other panes' }
      }),
    }, request => getChooserSurface().step({ ...request, cause }))
    if (!plan) return
    const picked = plan.destination
    if (picked === INTO_PANE) {
      if (!plan.viewer || !plan.pane) return
      await this.openIntoPickedPane(plan.viewer, path, name, plan.pane, plan.kind)
      return
    }

    if (picked.startsWith(REPLACE)) {
      // A REPLACE pick: aim the original open at the chosen viewer node (self-delivery swaps its file).
      // Resume the originating cause so the aimed delivery reads as the SAME gesture as the fire that
      // started it (the async-cause bridge). `deliverAimed` is synchronous, so `resumeCause` spans it.
      resumeCause(cause, () => this.intentTree.deliverAimed(picked.slice(REPLACE.length), intent, from))
      return
    }

    if (picked.startsWith(WRAP)) {
      // Which container to wrap into: the composition's grouping-choice when it names one, else a
      // sub-pick over EVERY discovered grouping container — never a hardcoded kind (the same resolution
      // a center-drop wrap uses, so the wrap default follows the composition, not a host constant).
      const kind = { kind: plan.kind }
      const viewer = plan.viewer
      if (!viewer) return
      // WRAP the bare viewer's slot in a new group holding [existing viewer, new viewer for the file].
      // TARGET ON A FLOATED SURFACE: `wrapPane` resolves the holder via `placementForPane` (DOM-keyed), which
      // cannot reach a record whose container DOM lives on a secondary window. The authority OWNS that
      // window's record, so it wraps the window's content directly (a pool re-point + a surface re-drive),
      // never a DOM lookup. Local targets keep the placement-based `wrapPane`.
      const targetId = picked.slice(WRAP.length)
      const remoteWindow = this.floatedWindowOfContent(targetId)
      const outcome = remoteWindow
        ? this.wrapRemoteWindowContent(remoteWindow, targetId, viewer, path, kind.kind)
        : wrapPane(targetId, { type: viewer, file: path } as never, kind.kind)
      // Trace the wrap outcome so a placement refusal is observable. Check the category before constructing fields.
      if (on('placement')) event('placement', 'wrap', { target: targetId, kind: kind.kind, remote: remoteWindow !== undefined, outcome })
      if (outcome !== 'wrapped') {
        const why =
          outcome === 'refused'
            ? `the slot is fixed or does not admit a container`
            : outcome === 'no-grouping'
              ? `no container type is available to wrap into`
              : `it could not be wrapped here`
        getNotificationSurface().show(
          { type: 'ui-notification', kind: 'broadcast', severity: 'warn', message: `Couldn't wrap ${name} in place — ${why}. Try "Open in a new window".` } as IntentPayload & { severity: 'warn'; message: string },
          () => {},
        )
      }
      return
    }

    // NEW WINDOW — the universal escape. Open the fresh viewer as its OWN `window` pool record (the
    // authority realizes it as a surface), the one-authority sibling of `float`.
    const viewer = plan.viewer
    if (!viewer) return
    this.openInWindow({ type: viewer, file: path } as unknown as OpaqueConfig)
  }

  /**
   * THE PANE PICKER for the open floor: place a NEW viewer for `path` into a main-window pane the user
   *  picks spatially (the same `<au-pane-target>` chooser the dock uses). An EMPTY / placeholder slot is
   *  FILLED (the placeholder is empty-slot filler, so this replaces it — `setPaneContent`); a REAL occupant
   *  is WRAPPED (never replaced), asking which container (`wrapPane` + `pickWrapKind`). Both
   *  primitives pool the new viewer and commit themselves. A refusal surfaces a toast, never a silent dead
   *  end.
   */
  private async openIntoPickedPane(viewer: string, path: string, name: string, paneId: string, kind?: string): Promise<void> {
    const instance = { type: viewer, file: path } as unknown as PaneInstance
    // FRESH after the async pick: resolve the target and its current occupant. A PLACEHOLDER occupant is
    // empty-slot FILLER (the moldable empty-slot resolves + materializes it), so it is REPLACED, not wrapped
    // — a real occupant is preserved by a wrap. Distinguish by the occupant's KIND.
    const placement = placementForPane(paneId)
    const pos = placement ? resolveAddress(placement, paneId, 'place') : null
    const existing = placement != null && pos != null ? placement.getSlotContent(pos) : null
    const existingType = (existing?.instance as { type?: string } | undefined)?.type
    const bare = (t: string): string => t.split('::')[0] ?? t
    const isPlaceholder = existingType != null && (this.opts.kindsOf?.(existingType) ?? []).some((k) => bare(k) === 'placeholder-projection')
    const occupied = existing != null && !isPlaceholder
    let outcome: string
    if (occupied) {
      outcome = wrapPane(paneId, instance as never, kind)
      if (on('placement')) event('placement', 'open-into-pane', { target: paneId, mode: 'wrap', kind: kind, outcome })
      if (outcome === 'wrapped') return
    } else {
      const ok = setPaneContent(paneId, instance) // fill / replace the empty (placeholder) slot in place
      outcome = ok ? 'filled' : 'refused'
      if (on('placement')) event('placement', 'open-into-pane', { target: paneId, mode: 'fill', outcome })
      if (ok) return
    }
    // A refusal (a fixed / non-admitting slot, or no grouping to wrap with): surface it, never a silent drop.
    getNotificationSurface().show(
      { type: 'ui-notification', kind: 'broadcast', severity: 'warn', message: `Couldn't open ${name} into that pane — ${outcome}. Try "Open in a new window".` } as IntentPayload & { severity: 'warn'; message: string },
      () => {},
    )
  }

  /** Pick which grouping container the floor's WRAP builds. The composition's grouping-choice decides
   *  when it names one (`requested`) or only one container declares grouping (`only`) — used silently.
   *  Otherwise EVERY discovered grouping container is offered as a sub-pick (the substrate knows no
   *  container by name; the wrap default is the composition's or the user's, never a host literal).
   *  Returns `{ kind }` (or `{}` when nothing declares grouping — `wrapPane` then reports no-grouping),
   *  or `'cancel'` when the user dismissed the sub-pick. */
  private async pickWrapKind(name: string): Promise<{ kind?: string } | 'cancel'> {
    // The WRAP-TARGET registry (grouping ∪ spatial), NOT the drop's grouping-only provider — so bento
    // (spatial) is offered here without touching center-drop semantics. The composition's `group-into` is
    // honoured (reason `requested` / `only` → use it silently); otherwise the family-SECTIONED picker
    // (Stack: grouping / Arrange: spatial). Never a hardcoded kind, never alphabetical.
    const outcome = wrapTargetOutcome()
    if (!outcome || outcome.available.length === 0) return {} // none declared → wrapPane reports it.
    if ((outcome.reason === 'requested' || outcome.reason === 'only') && outcome.chosen) {
      return { kind: outcome.chosen.typeName } // the composition said, or there is only one.
    }
    const descriptors = this.opts.describeProjections?.()
    const bare = (t: string): string => t.split('::')[0] ?? t
    const SECTION = { grouping: 'Stack', spatial: 'Arrange' } as const
    const options = [...wrapTargets()]
      .sort((a, b) => (a.family === b.family ? 0 : a.family === 'grouping' ? -1 : 1)) // Stack first, then Arrange.
      .map((t) => ({
        id: t.typeName,
        label: descriptorLabel(descriptors?.find((d) => bare(d.type) === bare(t.typeName)), t.typeName),
        section: SECTION[t.family],
      }))
    const picked = await getChooserSurface().choose({ title: `Wrap ${name} in which container?`, options })
    return picked ? { kind: picked } : 'cancel'
  }

  /** A node's enclosing composition scope: its qualified pool id → scope, else the entry scope. */
  private scopeOfNode(publisher: PublisherId): string {
    const nodeId = this.nodes.get(publisher)?.nodeId
    return (nodeId && this.scopes?.recordScope.get(nodeId)) || ENTRY_SCOPE
  }

  /**
   * The firer's scope chain, innermost first, out to the entry. Drives the inner-first-bubble
   *  ambient walk. Always ends at ENTRY_SCOPE; a node with no nesting yields `[s0]`.
   */
  private scopeChainOf(from: PublisherId): string[] {
    const chain: string[] = []
    let sid: string | undefined = this.scopeOfNode(from)
    const seen = new Set<string>()
    while (sid !== undefined && !seen.has(sid)) {
      seen.add(sid)
      chain.push(sid)
      sid = sid === ENTRY_SCOPE ? undefined : this.scopes?.scopes.get(sid)?.parentScopeId ?? ENTRY_SCOPE
    }
    return chain
  }

  /** Parse the `intent-routing.defaults` records to routing rules (bare names). */
  private parseRoutingRules(routing: Record<string, unknown> | undefined): RoutingRule[] {
    const raw = routing?.['defaults']
    if (!Array.isArray(raw)) return []
    const rules: RoutingRule[] = []
    for (const r of raw) {
      if (typeof r !== 'object' || r === null) continue
      const rec = r as Record<string, unknown>
      const intent = refBareName(rec['intent'])
      const roles = Array.isArray(rec['roles'])
        ? (rec['roles'] as unknown[]).map(refBareName).filter((x): x is string => x !== undefined)
        : []
      if (intent === undefined || roles.length === 0) continue // a rule needs an intent + ≥1 target.
      const mode = rec['mode'] === 'whitelist' ? 'whitelist' : rec['mode'] === 'block' ? 'block' : 'priority'
      const source = refBareName(rec['source']) // optional firer condition; undefined = any firer.
      rules.push({ intent, roles, mode, source })
    }
    return rules
  }

  /** Parse the `intent-routing.wires` records to the explicit wire table (pool block-ids). A wire
   *  needs a `source` (a pool `[[^^id]]`), an `intent` (a def-ref, bare-named here), and ≥1 `target`
   *  (pool `[[^^id]]`s). `mode` defaults to `strict` when absent. Consumed by the wire-override in
   *  dispatch. One-per-(source,intent) is a validator concern (see validateWires), not enforced here. */
  private parseWires(routing: Record<string, unknown> | undefined): Wire[] {
    const raw = routing?.['wires']
    if (!Array.isArray(raw)) return []
    const wires: Wire[] = []
    for (const w of raw) {
      if (typeof w !== 'object' || w === null) continue
      const rec = w as Record<string, unknown>
      const source = parseBlockRef(rec['source'])
      const intent = refBareName(rec['intent'])
      const targets = Array.isArray(rec['targets'])
        ? (rec['targets'] as unknown[]).map(parseBlockRef).filter((x): x is string => x !== undefined)
        : []
      if (source === undefined || intent === undefined || targets.length === 0) continue // needs source + intent + ≥1 target.
      wires.push({ source, intent, targets, mode: rec['mode'] === 'fallback' ? 'fallback' : 'strict' })
    }
    return wires
  }

  /** Parse the `intent-routing.reach` records (rung 2) to reachability rules. `node` is a pool `[[^^id]]`,
   *  `intent` a def-ref (bare-named here); `reachability: wire-only` closes the node to ambient delivery. An
   *  `ambient` (or absent) reachability is the default and carries no rule. */
  private parseReach(routing: Record<string, unknown> | undefined): ReachRule[] {
    const raw = routing?.['reach']
    if (!Array.isArray(raw)) return []
    const rules: ReachRule[] = []
    for (const r of raw) {
      if (typeof r !== 'object' || r === null) continue
      const rec = r as Record<string, unknown>
      const node = parseBlockRef(rec['node'])
      const intent = refBareName(rec['intent'])
      if (node === undefined || intent === undefined) continue // needs a node + an intent.
      if (rec['reachability'] !== 'wire-only') continue // only a wire-only rule constrains; `ambient` is the default.
      rules.push({ node, intent, wireOnly: true })
    }
    return rules
  }

  /** RUNG 2: is `publisher` ambient-reachable for `intentType`? False when a `wire-only` reach rule closes
   *  its pool (node, intent). A host-owned node (no pool id) is always reachable. Consulted only on the
   *  AMBIENT path (IntentTree filters ambient + broadcast); a wire reaches a closed node regardless. */
  private isAmbientReachable(publisher: PublisherId, intentType: string): boolean {
    return this.ambientExclusionReason(publisher, intentType) === undefined
  }

  /** WHY a capable handler is excluded from the AMBIENT candidate set (or `undefined` = reachable). Feeds
   *  `isAmbientReachable` (reachable === no reason) AND the trace, so "the editor is here, why didn't it
   *  open?" reads as a NAMED reason. */
  private ambientExclusionReason(publisher: PublisherId, intentType: string): string | undefined {
    // TARGETED-ONLY (handlesTargeted): a node whose TYPE declares this intent as aimed-only — and NOT
    // as an ambient `handles` — is never an ambient candidate. This is how the editor can be an open
    // TARGET (replace its own content via an aimed open) without hijacking ambient opens. An aimed
    // delivery (an explicit wire / the open chooser) never consults this, so it still reaches the node.
    const type = this.nodes.get(publisher)?.type
    if (type) {
      const targeted = this.opts.handlesTargetedOf?.(type) ?? []
      if (targeted.includes(intentType) && !(this.opts.handlesOf?.(type) ?? []).includes(intentType)) return 'aimed-only'
    }
    const poolId = this.nodes.get(publisher)?.nodeId
    if (!poolId) return undefined
    // Resolve reach from the NODE's OWN scope: a nested composition's `intent-reach` closes its own
    // node. A qualified poolId already matches the scope's qualified reach ids.
    const reach = this.rulesByScope.get(this.scopeOfNode(publisher))?.reach ?? this.reach
    if (reach.some((r) => r.wireOnly && r.node === poolId && r.intent === intentType)) return 'reach-closed'
    return undefined
  }

  /**
   * The handlers of `intentType` that are AMBIENT-eligible — `ownersHandling` minus the aimed-only
   *  (`handlesTargeted`) and `intent-reach` wire-only nodes. The open floor triggers when this is empty
   *  (no place an ambient open can land). A `whitelist`/`block` rule leaves it NON-empty (those owners
   *  are excluded at the scoper, not here), so the floor stays off and the named-rule warning shows.
   */
  private ambientOwnersOf(intentType: string): PublisherId[] {
    return this.intentTree.ownersHandling(intentType).filter((o) => this.isAmbientReachable(o, intentType))
  }

  /**
   * The switchboard wire-override resolver: map the firer's publisher → its pool id (the portal
   *  bridge), find the wire for (sourcePoolId, intentType), and classify its delivery against the live
   *  runtime + the type graph. null when no wire governs this (firer, intent), OR when the wire is
   *  BROKEN (the source's type dropped the `fires` port — route as if unwired). Broken/unavailable
   *  RECIPIENTS are excluded from the returned set; strict then fails closed on an empty set, fallback
   *  continues (see `deliverWired`). Capability drift vs mount liveness are distinguished in the pure
   *  `classifyWireDelivery`; the overlay reads the same classification to draw broken cables.
   */
  private resolveWire(from: PublisherId, intentType: string): { recipients: PublisherId[]; mode: 'strict' | 'fallback' } | null {
    const sourceId = this.nodes.get(from)?.nodeId
    if (!sourceId) return null // the firer carries no pool id (a host-owned node); never wired.
// A wire lives in the FIRER's OWN scope: a nested composition's wires are pool-addressed within
// itself, qualified to match the mounted nodes. Falls back to the entry wires for the no-nesting path.
    const wires = this.rulesByScope.get(this.scopeOfNode(from))?.wires ?? this.wires
    if (wires.length === 0) return null
    const wire = wires.find((w) => w.source === sourceId && w.intent === intentType)
    if (!wire) return null
    const firesOf = (type: string): string[] | undefined => this.opts.firesOf?.(type)
    const handlesOf = (type: string): string[] | undefined => this.opts.handlesOf?.(type)
    const source: WireEndpoint = { poolId: sourceId, type: this.nodes.get(from)?.type ?? undefined, publisher: from }
    const targets: WireEndpoint[] = wire.targets.map((poolId) => {
      const publisher = this.nodeIdToPublisher.get(poolId)
      // Type from the live node when mounted, else from the pool record (an unmounted recipient).
      const type = (publisher !== undefined ? this.nodes.get(publisher)?.type : (this.mountPool ?? this.pool)?.records.get(poolId)?.type) ?? undefined
      return { poolId, type, publisher }
    })
    const c = classifyWireDelivery(intentType, source, targets, firesOf, handlesOf)
    if (c.broken) return null // BROKEN source (capability drift): route as if unwired.
    return { recipients: c.recipients, mode: wire.mode }
  }

  /**
   * The intent-switchboard editing capability handed to every mounted projection. Reads the pool
   * (nodes) + the live wire table, and sets / removes a wire. The overlay projection is its consumer.
   * The WRITE routes through the ONE guarded composition writer (`commitComposition`), so the pool is
   * never a second writer — a wire edit round-trips the whole document, qualified. `CompositionWire`
   * is structurally the runtime `Wire` minus a defaulted `mode`, so the maps are trivial.
   */
  compositionEdit(owner: PublisherId): CompositionEditControl {
    // Writing a wire OR a reachability rule edits the ONE `intent-routing` composition-config ASPECT (the
    // consolidated bundle), so every mutator passes through the aspect-edit gate keyed to THIS capability's
    // owner node. WARN rung (a projection is user-chosen code; the refuse boundary is the agent bridge) —
    // the edit still applies.
    return {
      nodes: () => this.compositionNodes(),
      wires: () => this.wires.map((w) => ({ source: w.source, intent: w.intent, targets: [...w.targets], mode: w.mode })),
      subscribe: (listener) => this.onPoolChange(listener),
      setWire: (wire) => {
        this.checkAspectEdit(owner, 'intent-routing')
        this.applyWireEdit(upsertWire(this.wires, toWire(wire)))
      },
      removeWire: (source, intent) => {
        this.checkAspectEdit(owner, 'intent-routing')
        this.applyWireEdit(removeWire(this.wires, source, intent))
      },
      setReachability: (node, intent, reachability) => {
        this.checkAspectEdit(owner, 'intent-routing') // editing the reach kind of the intent-routing aspect (rung 2).
        const without = this.reach.filter((r) => !(r.node === node && r.intent === intent))
        this.applyReachEdit(reachability === 'wire-only' ? [...without, { node, intent, wireOnly: true }] : without)
      },
      onDispatch: (listener) => {
        this.dispatchListeners.add(listener)
        return () => this.dispatchListeners.delete(listener)
      },
    }
  }

  /**
   * The KEYMAPS editing capability (app-owned — the composition's active keymap list). Reads / edits the
   * composition's `keymaps` field (a top-level composition-document field carried on `pool.meta`), mirroring
   * `applyWireEdit`: the edit is IN-MEMORY (mutates `pool.meta.keymaps` and marks the composition dirty) and
   * the normal save flow persists it — no disk write per edit. The pool is the resolver's single source of
   * truth for the active list (`resolvedActiveKeymaps`), so an add/remove/reorder takes effect at once with no
   * remount. Operates on keymap NAMES; existing refs keep their original form (so a `::repo` keymap survives a
   * reorder), a newly added name synthesizes `[[name]]`.
   */
  keymapsControl(_owner: PublisherId): KeymapsControl {
    const nameOf = (ref: string): string => {
      const inner = ref.replace(/^\s*\[\[|\]\]\s*$/g, '')
      const noRepo = bareTypeName(inner).trim()
      return (noRepo.split('/').pop() ?? noRepo).replace(/[#^].*$/, '').trim()
    }
    const rawRefs = (): string[] => {
      const r = this.pool?.meta?.['keymaps']
      return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []
    }
    const applyRefs = (refs: string[]): void => {
      if (!this.pool || !this.poolPersist) return
      const meta = { ...(this.pool.meta ?? {}) }
      if (refs.length > 0) meta['keymaps'] = refs
      else delete meta['keymaps']
      this.pool.meta = meta
      this.schedulePoolChange()
      this.poolPersist(this.serializePool())
    }
    return {
      list: () => rawRefs().map(nameOf),
      sequenceTimeout: () => {
        const value = this.pool?.meta?.['key-sequence-timeout-ms']
        return typeof value === 'number' ? value : 600
      },
      setSequenceTimeout: milliseconds => {
        if (!Number.isFinite(milliseconds) || milliseconds < 0 || !this.pool || !this.poolPersist || this.guardPending) return
        this.pool.meta = { ...this.pool.meta, 'key-sequence-timeout-ms': Math.round(milliseconds) }
        this.schedulePoolChange()
        this.poolPersist(this.serializePool())
      },
      subscribe: (listener) => this.onPoolChange(listener),
      add: (name) => {
        const refs = rawRefs()
        if (!refs.some((r) => nameOf(r) === name)) applyRefs([...refs, `[[${name}]]`])
      },
      remove: (name) => applyRefs(rawRefs().filter((r) => nameOf(r) !== name)),
      reorder: (names) => {
        const refs = rawRefs()
        applyRefs(names.map((n) => refs.find((r) => nameOf(r) === n) ?? `[[${n}]]`))
      },
    }
  }

  /** The composition's pool projection records as switchboard nodes: {id, BARE type, output ports
   *  (`fires`), input ports (`handles`)}. Ports come from the SAME `firesOf`/`handlesOf` discovery the
   *  dispatch gate + `resolveWire` consult (keyed by the record's qualified type, which
   *  `matchesTypeIdentity` resolves), so the overlay's ports never disagree with what routing enforces. */
  private compositionNodes(): CompositionNode[] {
    if (!this.pool) return []
    const out: CompositionNode[] = []
    for (const [id, record] of this.pool.records) {
      const type = recordMountType(record)
      if (!type) continue
      out.push({
        id,
        type: type.split('::')[0] ?? type,
        fires: this.opts.firesOf?.(type) ?? [],
        handles: this.opts.handlesOf?.(type) ?? [],
        closed: this.reach.filter((r) => r.wireOnly && r.node === id).map((r) => r.intent), // rung 2: wire-only input ports.
      })
    }
    return out
  }

  /**
   * RMW one routing kind on the composition's `intent-routing` FIELD: spread the sibling kinds (and
   * `initial-focus`) so no clobber, set (or clear) `key`, and DROP the whole `intent-routing` field when it
   * empties (unset = absence, per the composition contract). Routing is a first-class field now, never a
   * mixin claim, so there is no `type:` to maintain — the composition stays `type: composition`.
   */
  private setRoutingField(meta: Record<string, unknown>, key: 'wires' | 'reach' | 'defaults', value: unknown[]): void {
    const routing = { ...(routingOf(meta) ?? {}) }
    if (value.length > 0) routing[key] = value
    else delete routing[key]
    if (Object.keys(routing).length > 0) meta['intent-routing'] = routing
    else delete meta['intent-routing']
  }

  /**
   * Apply a next wire table: update the LIVE dispatch table (so a fire right now already routes by it),
   * carry it onto the composition's `intent-routing.wires` field (in AUTHORED form), then write it into the
   * root's WORKING BUFFER — IN MEMORY, marking the composition dirty. A wire edit is "unsaved changes"
   * exactly like a layout drag; the normal save flow persists it (NOT a disk commit per keystroke). No-op
   * when there is no working writer / pool (a non-composition mount).
   */
  private applyWireEdit(next: Wire[]): void {
    if (!this.pool || !this.poolPersist) return
    this.wires = next // immediate dispatch: a wire works LIVE while still unsaved.
    const meta = { ...(this.pool.meta ?? {}) }
    this.setRoutingField(meta, 'wires', toAuthoredWires(next))
    this.pool.meta = meta
    this.schedulePoolChange() // refresh the overlay's cables.
    this.poolPersist(this.serializePool()) // → workingRef + dirty, no disk write.
  }

  /** Apply a next reach table (rung 2), mirroring `applyWireEdit`: update the LIVE reachability (so the
   *  ambient path already excludes a just-closed node), carry it onto the composition's `intent-routing.reach`
   *  field in AUTHORED form (`node` a pool ref, `intent` bare — qualified by the serialize chokepoint), then
   *  write into the working buffer (in-memory, marks dirty). No-op with no working writer / pool. */
  private applyReachEdit(next: ReachRule[]): void {
    if (!this.pool || !this.poolPersist) return
    this.reach = next // immediate: the ambient path excludes a closed node LIVE while still unsaved.
    const meta = { ...(this.pool.meta ?? {}) }
    this.setRoutingField(meta, 'reach', next.map((r) => ({ node: `[[^^${r.node}]]`, intent: `[[${r.intent}]]`, reachability: 'wire-only' })))
    this.pool.meta = meta
    this.schedulePoolChange() // refresh the overlay's closed-port rendering.
    this.poolPersist(this.serializePool())
  }

  /**
   * THE COMPOSITION-ASPECT EDIT GATE. A projection editing a composition-config aspect (today: the
   * `intent-routing` aspect via `compositionEdit`) must declare it in `edits-composition-config-meta`
   * (`edits: type<composition-config>*[]`). An undeclared edit WARNS (the projection surface is
   * user-chosen code; the refuse boundary is the agent bridge), the edit still applies. Mirrors the
   * `fire`/`handle` gates: a host-owned / typeless owner is EXEMPT; a KNOWN projection declaring no aspect
   * trips it (its `edits` set is empty). Structural editing (the pool) and a projection's own `saveConfig`
   * are NOT gated here.
   */
  private checkAspectEdit(owner: PublisherId, aspect: string): void {
    const type = this.nodes.get(owner)?.type
    if (!type) return // host-owned / unknown node: exempt, like the fire/handle gates.
    const declared = this.opts.editsOf?.(type)
    if (declared && !declared.includes(aspect)) {
      reportHostDiagnostic({
        code: 'composition-aspect-edit-undeclared',
        severity: 'warning',
        subject: aspect,
        message: `a projection edited the composition aspect "${aspect}", which its type-def does not declare in edits-composition-config-meta; add it to \`edits\` to make the edit an enforced capability`,
        detail: { node: owner, declared },
      })
    }
  }

  /** Role-as-kind membership: a node of type `type` plays role `role` iff role ∈ its kind-closure. */
  private playsRole(type: string, role: string): boolean {
    return (this.opts.kindsOf?.(type) ?? [type]).includes(role)
  }

  private nodePlaysAnyRole(owner: PublisherId, roles: string[]): boolean {
    const t = this.nodes.get(owner)?.type
    return t != null && roles.some((r) => this.playsRole(t, r))
  }

  /** The `children` surface a mounted projection receives, bound to its own node. */
  private childrenSurface(ownerId: PublisherId): MountHost['children'] {
    return {
      // STAND-IN: `config` + `onChildConfigChange` are the host-composition superset; the v2 type is {id}.
      // `nodeId` (STAND-IN superset) is the child's STABLE id (its `^:` block-id) — a
      // container (bento) passes its pane's id so the host can key per-instance view-state.
      mount: (
        slot,
        child: {
          id: string
          config?: OpaqueConfig
          onChildConfigChange?: (next: OpaqueConfig) => void
          nodeId?: string
        },
      ) => this.mountChild(ownerId, slot, child),
      // THE PORTAL BRIDGE: a mounted node's publisher ↔ its stable `^:`. A container maps an intent's
      // firer / a focused pane back to a pane id now that the portal mounts panes flat, not under it.
      nodeIdOf: (publisher: PublisherId) => this.nodes.get(publisher)?.nodeId || undefined,
      publisherOf: (nodeId: string) => this.nodeIdToPublisher.get(nodeId),
      // WHERE a node is defined (the definition-site registry). Retained past unmount, so a since-closed
      // actor stays locatable; `mounted` is the live flag layered on top. Undefined = never mounted here.
      locate: (publisher: PublisherId) => {
        const site = this.nodeSites.get(publisher)
        return site ? { ...site, mounted: this.nodes.has(publisher) } : undefined
      },
      // Whether the PORTAL path is active: a container renders empty ANCHORS for its children (the flat
      // PaneHost mounts each pane and portals it in) instead of mounting them itself. Set once by the
      // kernel before the root mounts, so it is stable for the container's lifetime.
      portalActive: () => this.portalActive,
      // THE COMPOSITION POOL surface — present once the runtime owns a pool (after `mountRootPortal`
      // normalized one; absent only on a freshly-constructed runtime before it mounts a composition). A
      // container manages the flat-pool records it references through here; the runtime is the single writer.
      ...(this.pool
        ? {
            pool: {
              resolveRecord: (id: string) => this.resolveRecord(id),
              createRecord: (record: OpaqueConfig, opts?: { transient?: boolean }) => this.createRecord(record, opts),
              stageRecord: (record: OpaqueConfig) => this.stageRecord(record),
              removeRecord: (id: string) => this.removeRecord(id),
              ensureRecord: (id: string, record: OpaqueConfig) => this.ensureRecord(id, record),
              createGroup: (record: OpaqueConfig) => this.createGroup(record),
              stageGroup: (record: OpaqueConfig) => this.stageGroup(record),
              applyStructural: (edits) => this.applyStructural(edits),
              // THE ASK: a container proposes edits, the host applies them. `propose` delegates to the host's
              // `applyStructural` write; the host is the decision point.
              propose: (edits) => this.applyStructural(edits),
              float: (occupantId, sourceEdit, options) => this.float(occupantId, sourceEdit, options),
              moveToWindow: (subtreeId) => void this.moveToWindow(subtreeId),
              // Count OPEN windows (the picker's actual candidates), not raw roots — a dormant/closed
              // secondary lingers in `roots` but is not a move target, so it must not light the affordance.
              otherWindowsExist: () => this.windowSites().length >= 2,
              // A container RE-SEEDS its local model from its authoritative record here: subscribe to
              // structural/set pool changes (coalesced), then re-read `resolveRecord(instanceId)`. This is
              // what keeps a container's rendered anchors in sync with a change the SUBSTRATE applied to
              // its record (a drag re-parent / `closePane` / `wrapPane` write the record without touching
              // the container's own local model). A re-render, never a remount — see `useContainerModel`.
              subscribe: (listener: () => void) => this.onPoolChange(listener),
            },
          }
        : {}),
    }
  }

  private async mountChild(
    parentId: PublisherId,
    slot: HTMLElement,
    child: { id: string; config?: OpaqueConfig; onChildConfigChange?: (next: OpaqueConfig) => void; nodeId?: string },
  ): Promise<ChildHandle> {
    const registration = this.opts.resolve(child.id)
    if (!registration) {
      throw new Error(`no projection type "${child.id}" in the workspace — its type-def must be discoverable`)
    }
    let livePublisher: PublisherId | undefined
    return mountReloadableProjection({
      id: child.nodeId ?? '', registration,
      consent: () => {
        const affected: PublisherId[] = []
        const visit = (id: PublisherId): void => {
          affected.push(id)
          for (const child of this.nodes.get(id)?.children ?? []) visit(child)
        }
        if (livePublisher) visit(livePublisher)
        return this.closeGuardTree.gatherAmong(affected)
      },
      mount: (module, onUnmount) => {
        if (!this.nodes.has(parentId)) throw new Error(`Parent unmounted before projection could load`)
        const config = child.nodeId ? this.resolveRecord(child.nodeId) ?? child.config : child.config
        const handle = this.mountModule(parentId, slot, module, registration.export, config, child.onChildConfigChange, child.nodeId, child.id)
        livePublisher = handle.publisher
        this.nodes.get(handle.publisher)!.onUnmount = onUnmount
        return handle
      },
    })
  }

  /** Build the `MountHost` for one node (its channels, capabilities, per-instance stores). Shared by
   *  `mountModule` (a mounted projection) and `mountRootPortal` (the synthetic portal owner). */
  private makeHost(
    publisher: PublisherId,
    config: OpaqueConfig | undefined,
    sink: ((next: OpaqueConfig) => void) | undefined,
    nodeId: string | undefined,
  ): MountHost {
    // THE DIRECT BINDING. The co-located main window: channels wire STRAIGHT into the
    // authority's own trees (sync claim into `intentTree`, `focusTree`, `selectionTree`, the direct
    // `mergeRecord` sink), so a same-window dispatch never crosses an event path and single-window pays
    // nothing. Capabilities are the real ones. The proxied twin is the mount agent's `buildHost`.
    return createInProcessMountHost({
      // Common / per-window.
      entryPath: this.opts.entryPath,
      engineReady: this.opts.engineReady,
      members: this.opts.members(),
      viewState: this.viewState.forPublisher(publisher),
      // The host's shared per-window preview overlay surface (a singleton; same instance for every node).
      preview: getPreviewSurface(),
      // The host-discovered mountable projection names (LIVE), for a container's mount picker.
      listProjections: this.opts.listProjections,
      // The described set — same discovery pass, with kinds.
      describeProjections: this.opts.describeProjections,
      // The composition's viewer-defaults (per file kind → viewer) + slot-defaults (the default empty-slot
      // placeholder), read LIVE off the composition config, for the viewer / empty-slot resolution ladders.
      viewerDefaults: () => this.readViewerDefaults(),
      slotDefaults: () => this.readSlotDefaults(),
      // Per-record.
      config,
      // The stable instance id (the pane's `^:`), so a projection caches state that survives its OWN
      // remount (the terminal keeps its live xterm by this).
      instanceId: nodeId,
      // The authority's local mount is not a window root; a floated surface marks its root in the mount agent.
      windowRoot: false,
      // Per-instance restorable view-state + terminal, keyed by composition + this node's STABLE id; the
      // session survives remounts. No-op slot for the root / an id-less mount (empty nodeId).
      viewStore: createViewStore(this.opts.compositionId ?? (() => ''), nodeId ?? ''),
      terminal: createTerminalChannel(this.opts.compositionId ?? (() => ''), nodeId ?? ''),
      // OPEN SURFACES — `setContent` bound to this publisher; the reads are host-wide off the per-window
      // index. Existence is registered/dropped at mount/unmount, not here.
      openSurfaces: makeOpenSurfaces(publisher, (id, transient) => this.setPoolTransient(id, transient)),
      // CO-LOCATION channels — DIRECT into the authority's trees.
      children: this.childrenSurface(publisher),
      intent: this.intentTree.forNode(publisher),
      // FOCUS: `report` feeds the ONE aggregate recency (the seed / legacy container path); `activePane` /
      // `watchActive` (the RING) deliver the MAIN window's SCOPED head, gated by main's OS-focus — the
      // window-scoped, OS-gated replacement for the raw aggregate head, so a container rings its OWN window's
      // active pane.
      focus: {
        report: this.focusTree.forNode(publisher).report,
        activePane: () => this.mainActiveHead(),
        watchActive: (listener) => this.watchMainActive(listener),
      },
      closeGuard: this.closeGuardTree.forNode(publisher),
      selection: this.selectionTree.forNode(publisher),
      saveConfig: sink,
      // INBOUND config subscription — the leaf's reflect-in-place opt-in, keyed by its `^:`. Present only for
      // a pooled pane WITH a stable id; a root / id-less mount / no-pool runtime omits it (→ remount fallback).
      onOwnConfigChange: nodeId !== undefined && this.pool ? (cb: (config: OpaqueConfig) => void) => this.registerInboundHandler(nodeId, cb) : undefined,
      // CO-LOCATION capabilities — REAL.
      daemon: this.opts.daemon,
      mcp: this.opts.mcp,
      commitComposition: this.opts.commitComposition,
      // The switchboard editing capability — reads THIS runtime's pool + wires, writes through the one
      // guarded composition writer. Only meaningful with a commitComposition writer (a root mount).
      compositionEdit: this.opts.commitComposition ? this.compositionEdit(publisher) : undefined,
      // The keymap-list editing capability — edits the composition's active keymaps, live + dirty, through
      // the same working-buffer path. Only meaningful with a commitComposition writer (a root mount).
      keymaps: this.opts.commitComposition ? this.keymapsControl(publisher) : undefined,
      // The host-discovered chrome contributions by role (LIVE) + a discovery-change subscription, for a
      // bar's candidate query + re-query.
      listContributions: this.opts.listContributions,
      subscribeContributions: this.opts.subscribeContributions,
    })
  }

  /** The composition's viewer-defaults, read off `pool.meta['viewer-defaults'].defaults` and
   *  bare-normalized (the `viewer` def-ref value → a bare type name), for the viewer resolution ladder
   *  (`resolveViewer`). Empty when the composition declares no defaults. */
  private readViewerDefaults(): { opens: string; viewer: string }[] {
    const vd = this.pool?.meta?.['viewer-defaults'] as Record<string, unknown> | undefined
    const raw = vd?.['defaults']
    if (!Array.isArray(raw)) return []
    const out: { opens: string; viewer: string }[] = []
    for (const d of raw) {
      if (typeof d !== 'object' || d === null) continue
      const rec = d as Record<string, unknown>
      const opens = typeof rec['opens'] === 'string' ? rec['opens'] : undefined
      const viewer = refBareName(rec['viewer'])
      if (opens && viewer) out.push({ opens, viewer })
    }
    return out
  }

  /** The composition's slot-default placeholder, read off `pool.meta['slot-defaults'].placeholder` and
   *  bare-normalized (the def-ref value → a bare type name), for the empty-slot ladder's `configured`
   *  rung. `undefined` when the composition declares no `slot-defaults`. */
  private readSlotDefaults(): string | undefined {
    const sd = this.pool?.meta?.['slot-defaults'] as Record<string, unknown> | undefined
    return refBareName(sd?.['placeholder'])
  }

  /** The TYPE of the pane focused RIGHT NOW (the transient current focus), or undefined when focus is outside
   *  any pane. Keybind arbitration wants "what am I in at this keystroke", NOT the retained head (which can
   *  point at a pane focus has since left). For a SURFACE keystroke, this is the focus that WINDOW carried
   *  (`keystrokeOrigin.focus`); otherwise main's own DOM. So a floated `when`-contextual binding resolves
   *  against the floated pane, not main's. */
  private focusedPaneType(): string | undefined {
    const paneId = this.keystrokeOrigin ? this.keystrokeOrigin.focus : paneIdOfActiveElement()
    const publisher = paneId ? this.nodeIdToPublisher.get(paneId) : undefined
    return publisher ? (this.nodes.get(publisher)?.type ?? undefined) : undefined
  }

  /** Whether the pane focused RIGHT NOW is a RAW-TEXT SURFACE — its type-def declares `raw-text-surface-meta`.
   *  The keybind gate reads it during arbitration: while such a projection holds focus, a bare (typing)
   *  keystroke passes through as input rather than resolving as a keybind. Reads the TRANSIENT current
   *  focus (not the retained head), so it is true only while the text surface actually holds focus. The
   *  focus→type→meta join the gate cannot do itself (the pool + descriptors are authority-owned). */
  isFocusedRawTextSurface(): boolean {
    const type = this.focusedPaneType()
    if (!type) return false
    const descriptors = this.opts.describeProjections?.() ?? []
    const desc = descriptors.find((d) => bareTypeName(d.type) === bareTypeName(type))
    return !!desc?.meta?.['raw-text-surface-meta']
  }

  // ── Keybind dispatch (the authority half) ────────────────────────────────────────────────────────
  // The window-local gate feeds a canonicalized chord candidate here; the authority owns the buffer, the
  // active-set + focus resolution, the fire, and the chooser. The pure decision lives in the SDK.
  private keybindDispatcher: KeybindDispatcher | null = null
  private keySequenceObserver?: (pending: PendingKeySequence | null) => void

  hasPendingKeySequence(observer: (pending: PendingKeySequence | null) => void): boolean {
    return this.keySequenceObserver === observer && !!this.keybindDispatcher?.pending
  }

  inspectKeySequence(observer: (pending: PendingKeySequence | null) => void, paused: boolean): void {
    if (this.keySequenceObserver === observer) this.keybindDispatcher?.inspect(paused)
  }

  cancelKeySequence(observer: (pending: PendingKeySequence | null) => void): void {
    if (this.keySequenceObserver === observer) this.keybindDispatcher?.cancel()
  }

  chooseKeySequence(observer: (pending: PendingKeySequence | null) => void, binding: ActiveKeybind): void {
    if (this.keySequenceObserver === observer) this.keybindDispatcher?.choose(binding)
  }

  /** The ACTIVE keymaps: the LIVE pool's `keymaps` list resolved against the available keymap files, in
   *  list order. The pool is the single source of truth — a `host.keymaps` add/remove/reorder mutates
   *  `pool.meta.keymaps` — so this reflects an edit with no remount, and a keymap-file rebind lands as soon
   *  as `keymapFiles` re-reads (the host subscribes keymap files to the engine `changes` channel). */
  private resolvedActiveKeymaps(): RawKeymap[] {
    return activeKeymapsFor({ keymaps: this.pool?.meta?.['keymaps'] }, this.opts.keymapFiles?.() ?? new Map())
  }

  private keybindDispatcherFor(): KeybindDispatcher {
    return (this.keybindDispatcher ??= new KeybindDispatcher({
      activeKeybinds: () => buildActiveKeybinds(this.resolvedActiveKeymaps(), this.focusedTypes()),
      onPendingChange: pending => this.keySequenceObserver?.(pending),
      sequenceTimeoutMs: () => {
        const value = this.pool?.meta?.['key-sequence-timeout-ms']
        return typeof value === 'number' ? value : undefined
      },
      fire: (intent) => this.fireKeybindIntent(intent),
      ask: (intents) => void this.askKeybindChooser(intents),
    }))
  }

  // THE KEYSTROKE ORIGIN. Set for the DURATION of a
  // `pushKeystroke` from a SURFACE window: its window id + the transient focused pane `^:` that window
  // carried. `focusedPaneType` (the when-context) and `closeFocusedView` (the command target) read it so a
  // surface keystroke resolves against the ORIGINATING window, not main's DOM / the aggregate head. Undefined
  // for a MAIN-window keystroke (the default — main resolves from its own DOM). Dispatch is synchronous, so
  // this ambient is set/cleared around the one `push` call.
  private keystrokeOrigin: { windowId: string; focus: string | undefined } | undefined

  /** Feed a canonicalized chord candidate (from a window's gate). Returns whether it was CONSUMED — the
   *  gate suppresses default handling for a consumed key. The `opts` carry the two orthogonal per-push
   *  concerns, each from a DIFFERENT caller, with different lifetimes:
   *  - `origin` — TRANSIENT (set around this one synchronous push, restored after). A SURFACE window forwards
   *    its id + carried transient focus so the when-context + command target resolve against THAT window;
   *    absent for a main-window keystroke (which resolves from its own DOM).
   *  - `observer` — STICKY (held until a DIFFERENT observer arrives). The main window's pending-key-sequence
   *    hint callback. A push from a different input surface (a surface keystroke passes no observer) does not
   *    match the held one, so the old prefix is cancelled — hints never migrate to another window. */
  pushKeystroke(
    ks: CanonicalKeystroke,
    opts?: { origin?: { windowId: string; focus: string | undefined }; observer?: (pending: PendingKeySequence | null) => void },
  ): boolean {
    // observer (sticky): a change of input surface cancels the old surface's prefix before adopting the new.
    const observer = opts?.observer
    if (this.keySequenceObserver !== observer) this.keybindDispatcher?.cancel()
    this.keySequenceObserver = observer
    // origin (transient): set for the duration of this one synchronous push, restored in finally.
    const prev = this.keystrokeOrigin
    this.keystrokeOrigin = opts?.origin
    try {
      return this.keybindDispatcherFor().push(ks)
    } finally {
      this.keystrokeOrigin = prev
    }
  }

  // ── Active-chords mirror (keybinds, cross-window native suppression) ────────────────────────────────
  // A floated window holds no resolver, so it cannot know synchronously whether a keydown is bound. The
  // authority mirrors DOWN the set of keydowns that BEGIN a bound chord in the current (focus-scoped)
  // context; the surface's gate `preventDefault`s a native default only for a membership hit. Re-pushed on
  // focus + keymap change (via `schedulePoolChange` for a `pool.meta.keymaps` edit), coalesced to a microtask.

  private activeChordsPushScheduled = false

  /** Coalesce a re-mirror of the bound-chord set to every open surface. No-op when no floated window is
   *  open (the common single-window case), so the focus/pool hot paths pay nothing then. */
  private scheduleActiveChordsPush(): void {
    if (this.surfaceTransports.size === 0 || this.activeChordsPushScheduled) return
    this.activeChordsPushScheduled = true
    queueMicrotask(() => {
      this.activeChordsPushScheduled = false
      this.pushActiveChords()
    })
  }

  /** Push the current focus-scoped bound-chord STARTS (the first keystroke of each active keybind, deduped)
   *  to every surface. The first keystroke is what a keydown must match to suppress its native default; a
   *  multi-key sequence's interior keystrokes are not mirrored (rare, and never a destructive native key). */
  private pushActiveChords(): void {
    if (this.surfaceTransports.size === 0) return
    const active = buildActiveKeybinds(this.resolvedActiveKeymaps(), this.focusedTypes())
    const seen = new Set<string>()
    const chords: CanonicalKeystroke[] = []
    for (const kb of active) {
      const first = kb.chord[0]
      if (!first) continue
      const key = `${first.key}\0${[...first.mods].sort().join('+')}`
      if (seen.has(key)) continue
      seen.add(key)
      chords.push(first)
    }
    for (const t of this.surfaceTransports.values()) t.sendCommand({ op: 'active-chords', chords })
  }

  /** The DISPLAY shortcut for a command (an intent type), reverse-looked-up over the composition's active
   *  keymaps — so the palette shows what is ACTUALLY bound now (the "no hidden layer" legibility).
   *  Focus-independent (a binding's label shows regardless of
   *  current focus); list-order-later wins, matching resolution. `undefined` when nothing binds it. */
  /** Stable palette curation follows the authored order of active composition keymaps. */
  commandPaletteOrder(): string[] {
    return [...new Set(this.resolvedActiveKeymaps().flatMap(map => map.keybinds.map(binding => bareTypeName(binding.intent))))]
  }

  shortcutForIntent(intent: string): string | undefined {
    let last: string | undefined
    for (const km of this.resolvedActiveKeymaps()) {
      for (const kb of km.keybinds) {
        if (bareTypeName(kb.intent) === bareTypeName(intent)) last = formatChord(kb.chord)
      }
    }
    return last
  }

  /** The projection types currently in focus, for keybind `when` matching. The pane focused RIGHT NOW
   *  (transient) — a contextual keybind applies while you are IN that pane, not while the retained head
   *  points at a pane focus has left. */
  private focusedTypes(): Set<string> {
    const type = this.focusedPaneType()
    return new Set(type ? [bareTypeName(type)] : [])
  }

  private fireKeybindIntent(intent: string): void {
    const routing = this.opts.commandRouting?.(intent)
    if (on('keybind')) event('keybind', 'fire', { intent, kind: routing?.kind, dispatch: routing?.dispatch })
    this.fireCommand({ type: intent, kind: routing?.kind, dispatch: routing?.dispatch } as IntentPayload)
  }

  private async askKeybindChooser(intents: string[]): Promise<void> {
    if (on('keybind')) event('keybind', 'ask', { intents })
    const descriptors = this.opts.describeProjections?.()
    const options = intents.map((intent) => ({
      id: intent,
      label: descriptorLabel(descriptors?.find((d) => bareTypeName(d.type) === bareTypeName(intent)), intent),
    }))
    const picked = await getChooserSurface().choose({ title: 'Run which command?', options })
    if (picked) this.fireKeybindIntent(picked)
  }

  /**
   * THE PORTAL MOUNT ENTRY. Instead of mounting the resolved root TREE recursively
   * (`mountRoot`), the kernel drives the FLAT portal: this normalizes the composition into the pool,
   * arms routing, and returns a top-level host + the root id. The kernel renders `<PanePortalLayer host
   * records>` (one flat `PaneHost` per pool record) and registers the KernelRoot container as the ROOT
   * record's anchor. Every pane mounts ONCE and portals into its slot, so a re-parent never unmounts it.
   *
   * The returned host owns a synthetic top node (parentId null → it is `mainRoot`, the transport /
   * routing top). Each flat pane mounts UNDER it in the node map, but `logicalParent` derives real
   * nesting from the pool topology, so intent/focus/selection route by the true tree.
   */
  /**
   * Pre-load the cross-file closure before a composition mount. ProjectionHost walks the
   * `[[file]]` / `[[file^^id]]` references async (the reads are async), then hands the loaded files here,
   * keyed by wikilink target; the linker resolves them SYNCHRONOUSLY at `mountRootPortal`. Kept across
   * structural remounts (which reuse the same cross-file refs); refreshed on a load/switch.
   */
  primeForeign(files: Map<string, ForeignFile>, entryPath?: string): void {
    this.foreignFiles = files
    this.entryPath = entryPath
  }

  mountRootPortal(config: OpaqueConfig, persist: (next: OpaqueConfig) => void): { host: MountHost; rootId: string } | null {
    const schemas = this.opts.schemas?.()
    if (!schemas || config == null || typeof config !== 'object') return null // portal needs the pool
// the runtime is reused across composition switches (memoized on the ENTRY). A real SWITCH (the
// serving composition id CHANGED) must close the PRIOR composition's floated OS windows + settle its
// in-flight remote claims/commits — else they orphan, disconnected from the wholesale-replaced pool. A
// same-id re-mount (a structural edit re-deriving the tree) must NOT, so this keys on the id, not the
// portal-effect re-run. First mount (`servingCompositionId` undefined) closes nothing.
    const incomingCompositionId = this.opts.compositionId?.()
    // A FRESH LOAD = a new/changed composition id (a first mount or a switch); a same-id re-mount is a
    // structural edit re-deriving the tree. Distinguishes surface teardown + window
    // realization (both LOAD-time) from a per-edit re-mount (which must touch neither).
    const isFreshLoad = incomingCompositionId !== this.servingCompositionId
    if (this.servingCompositionId !== undefined && isFreshLoad) this.disposeSurfaces()
    this.servingCompositionId = incomingCompositionId
    // HYDRATE the main-owned view-state cache for this composition BEFORE any pane mounts, so the editor /
    // file-tree restore their cursor / scroll / expansion on their first sync `get`. Keyed by AUTHORITY
    // identity, so a floated pane reads the same store; idempotent per composition. (A surface hydrates the
    // same way in its mount agent.)
    hydrateViewState(this.opts.compositionId?.() ?? '')
    // The AUTHORITATIVE entry pool — original cross-file refs intact, this is what persists.
    this.pool = normalizeToPool(config as Record<string, unknown>, schemas, () => this.mintBlockId())
    this.poolPersist = persist
    this.foreignEditWarned = false
    // CROSS-FILE LINK + degrade: fold every nested file in, then degrade the duplicate case,
    // producing `this.mountPool` (nested subtrees included) + `this.scopes`. Reported here at mount.
    this.rederiveMountPool(schemas, true)
    this.recomputePoolParents()
    // BASELINE the reachable set for the edit-orphan reap (`reapOrHold`): a later edit that cuts a
    // record off from the root is measured against THIS loaded set. A record NOT reachable now (a load
    // orphan) is absent from the baseline, so it is never pruned — kept + warned per the on-load policy.
    this.prevReachable = reachableRecordIds(this.pool, schemas)
    this.prevReachableRootsKey = this.rootsKey()
    // Arm routing off the composition metadata bag (`pool.meta`: intent-defaults / initial-focus /
    // wires), the mixin home — same source as the recursive path. Children mount async and
    // seed initial-focus as they arrive.
    this.installRouting(this.pool.meta)
    this.portalActive = true
    // The synthetic top owner: a node with no projection, whose host the portal layer mounts panes
    // through. parentId null → it becomes `mainRoot`. It never renders; its saveConfig is unused.
    const owner = this.mintId()
    this.nodes.set(owner, { parentId: null, children: new Set(), unmountSelf: null, type: null, nodeId: '' })
    this.mainRoot = owner
    // — RESTORE persisted windows: a composition holds its `window` records, so on a FRESH
    // LOAD (not a per-edit re-mount) re-realize every NON-primary window as its own OS surface. Without this
    // a persisted floated window round-trips as pool DATA but never re-opens. Gated to a fresh load so a
    // structural edit never re-focuses open windows, and a crashed window stays dormant until its Reopen
    // offer (action 1) — both are same-id re-mounts.
    if (isFreshLoad) this.realizePersistedWindows()
    // The portal anchors at the PRIMARY WINDOW's CONTENT (the mounted view), not the window record — a
    // window is a SITE with no module, mounted by opening its OS surface, never as a flat pool projection.
    return { host: this.makeHost(owner, undefined, undefined, undefined), rootId: this.currentRootId() }
  }

  /**
   * Realize every PERSISTED non-primary window as an OS surface. The primary window is
   *  the main window (the portal mounts its content); each OTHER window root is a floated window the
   *  composition persisted, re-opened via the same `openSurface` path a live float uses (the agent boots,
   *  signals ready, the authority drives its content mount). `openSurface` is idempotent (an already-open
   *  surface focuses), so this is safe even if a root is somehow already live.
   */
  private realizePersistedWindows(): void {
    if (!this.pool) return
    const primaryRoot = this.pool.roots.find((id) => (this.pool!.records.get(id) as { primary?: unknown } | undefined)?.primary === true) ?? this.pool.roots[0]
    for (const windowId of this.pool.roots) {
      if (windowId === primaryRoot) continue // the primary window IS the main window (the portal), not an OS surface.
      if (on('lifecycle')) event('lifecycle', 'window-restored', { surface: windowId })
      this.openSurface(windowId)
    }
  }

  /** The PRIMARY window's current CONTENT id — the id the root portal anchors. Recomputed after every
   *  structural edit, because a restructure at the window root CHANGES it (dissolving the root container
   *  re-points `window.content` to its lone child, so the root id moves from the container to the child). */
  currentRootId(): string {
    return this.pool ? (primaryContentId(this.pool) ?? this.pool.roots[0] ?? '') : ''
  }

  /** A short display label for the ROOT content's type, shown at the left of the window root header
   *  ("editor" for an editor-pane, "bento" for a bento, …). The bare type name with a trailing `-pane`
   *  dropped, so a viewer reads as its subject rather than its slot role. */
  rootTypeLabel(): string {
    const rec = this.pool?.records.get(this.currentRootId())
    if (!rec) return ''
    return bareTypeName(recordMountType(rec)).replace(/-pane$/, '')
  }

  private mountModule(
    parentId: PublisherId | null,
    slot: HTMLElement,
    module: LoadedModule,
    exportName?: string,
    config?: OpaqueConfig,
    persist?: (next: OpaqueConfig) => void,
    nodeId?: string,
    type?: string,
  ): ChildHandle {
    // Resolve the NAMED export (default `mount`) BEFORE minting/registering, so a missing export
    // throws cleanly (the caller — children.mount's promise, or the root mount — surfaces it) with
    // no leaked node. The host loads a module once per entry (the ESM import cache dedupes), so
    // sibling surfaces sharing one entry resolve to the same module + different exports.
    // A projection MUST register through `defineProjection`: its DEFAULT export is the branded module,
    // and the host resolves each surface off it. An unbranded module is REJECTED here — the load-time
    // failure that closes the class where a module satisfied the meta but not the code and crashed at
    // mount.
    const exp = exportName ?? 'mount'
    const registered = (module as { default?: unknown }).default
    if (!isDefinedProjection(registered)) {
      throw new Error(
        `projection module is not registered through \`defineProjection\`: its default export must be ` +
          `\`defineProjection({ ${exp} })\`. See the projection module-contract spec.`,
      )
    }
    const surfaces = registered as LoadedModule
    const mountFn = surfaces[exp]
    if (typeof mountFn !== 'function') {
      const available = Object.keys(surfaces).filter((k) => typeof surfaces[k] === 'function').join(', ') || '(none)'
      throw new Error(`registered projection module has no "${exp}" surface (has: ${available})`)
    }
    const publisher = this.mintId()
    const node: Node = { parentId, children: new Set(), unmountSelf: null, type: type ?? null, nodeId: nodeId ?? '' }
    this.nodes.set(publisher, node)
    if (parentId) this.nodes.get(parentId)?.children.add(publisher)
    // Index this mount by its stable `^:` so a container can map a firer/focused publisher back to the
    // pane (the portal bridge), and so `logicalParent` can resolve a child's parent publisher.
    if (node.nodeId) this.nodeIdToPublisher.set(node.nodeId, publisher)
    // OPEN SURFACES: register this mount's EXISTENCE (host-known), keyed by publisher. Content is
    // projection-declared later via `host.openSurfaces.setContent`; the transient flag is
    // container-declared. Dropped in `unmount`. See open-surfaces.ts.
    getOpenSurfacesIndex().registerSurface(publisher, {
      ...(node.nodeId ? { surfaceId: node.nodeId } : {}),
      projection: (type ?? '').split('::')[0] ?? '',
      windowId: LOCAL_WINDOW,
    })
    // Record the definition SITE for `host.children.locate`. Retained past unmount (never deleted), so a
    // since-closed pane stays locatable to its source. The composition file is frozen at mount time.
    this.nodeSites.set(publisher, { type: type ?? undefined, nodeId: node.nodeId, compositionFile: this.opts.compositionId?.() })

    // THE POOL SINK: when the host owns the pool, this node's `saveConfig` merges its OWN record into
    // the pool by its `^:` id — the host is the single writer, so no parent ever holds or
    // re-serializes a child's config (the re-parent duplication class dies). The merge id is the
    // node's stable `^:`: its `nodeId` (a child), or the root record's own `^` carried on `config`
    // (the root). Falls back to the passed `persist` for an id-less mount, or before the pool is wired.
    const mergeId = nodeId ?? recordIdOf(config)
    const sink = mergeId !== undefined && this.pool
      ? (record: OpaqueConfig): void => this.mergeRecord(mergeId, record)
      : persist

    const host = this.makeHost(publisher, config, sink, nodeId)
    // Mount-site STACKING CONTAINMENT: every
    // mount slot gets its own stacking context, so a projection's internal z-index cannot escape
    // to collide with siblings or the host's fixed preview overlay — important once chrome nests
    // deeply (a dock holding bars holding item projections). Only `isolation` (stacking); NOT
    // `contain`, which would make the slot the containing block for `position: fixed` descendants
    // and trap a projection's escape-to-viewport (e.g. the editor's fallback hover-card). The
    // stacking context only scopes PAINT order (a fixed descendant still escapes layout to the
    // viewport, just composited within the slot) — benign vs the window-level preview singleton.
    slot.style.isolation = 'isolate'
    // A throwing mount BODY must not leave the node registered: it would leak (permanently for a
    // root mount). Unwind via the normal teardown, then surface the error to the caller
    // (children.mount's promise / root mount).
    try {
      node.unmountSelf = mountFn(slot, host)
    } catch (err) {
      this.unmount(publisher)
      throw err
    }
    // The authority's root node: the transport's fire/introspect entry point. A composition switch
    // remounts the root, so this tracks the LATEST (the prior root unmounts + clears it).
    if (parentId === null) this.mainRoot = publisher

    // Seed the composition's declared initial focus on the FIRST mounted node that plays the role,
    // so the first ambient open lands there before any user focus (children mount async, hence here).
    if (this.pendingInitialFocus !== null && type != null && this.playsRole(type, this.pendingInitialFocus)) {
      this.focusTree.forNode(publisher).report()
      this.pendingInitialFocus = null
    }

    return { publisher, unmount: () => this.unmount(publisher) }
  }

  /** Tear down a node and its whole subtree, depth-first (children first). Idempotent. */
  private unmount(publisher: PublisherId): void {
    const node = this.nodes.get(publisher)
    if (!node) return // already gone; idempotent.
    this.nodes.delete(publisher)
    node.onUnmount?.()
    // Drop the reverse index, but ONLY if it still points at THIS publisher — a remount of the same
    // record can register the new publisher before the old one tears down (portal selective remount).
    if (node.nodeId && this.nodeIdToPublisher.get(node.nodeId) === publisher) this.nodeIdToPublisher.delete(node.nodeId)
    for (const childId of [...node.children]) this.unmount(childId)
    if (node.parentId) this.nodes.get(node.parentId)?.children.delete(publisher)
    try {
      node.unmountSelf?.()
    } catch {
      // a failing unmount must not break the cascade
    }
    // Drop this publisher's view-state and end follows targeting it.
    this.viewState.dropPublisher(publisher)
    // NOT the selection tree: like focus, it is keyed by the stable `^:`, so a remount (which unmounts the
    // old publisher) must NOT drop it — a follower would be stranded. Dropped at the record REAP instead.
    // Drop any intent capabilities it declared.
    this.intentTree.dropNode(publisher)
    // NOT the focus recency: it is keyed by the stable `^:`, not the publisher, so a remount (which
    // unmounts the old publisher) must NOT evict it. The recency entry is dropped at the record REAP
    // (`reapOrphan`), the one place the `^:` genuinely leaves the pool.
    // Drop any close-guards it registered.
    this.closeGuardTree.dropNode(publisher)
    // Drop it from the open-surfaces index (existence off). A no-op for a portal owner never registered.
    getOpenSurfacesIndex().dropSurface(publisher)
    // If the root itself unmounted (teardown / root remount), clear the backstop pointer.
    if (publisher === this.mainRoot) this.mainRoot = null
  }

  private mintId(): PublisherId {
    return `pub-${++this.seq}`
  }

  /**
   * The `^:` node ids of every pane CURRENTLY MOUNTED in this runtime. The ground truth for which
   * panes are live on screen, independent of whether a container has echoed its (load-)minted ids
   * into the serialized composition yet.
   *
   * Terminal-session reaping unions this with the persisted config's ids: a pty is killed only when
   * its pane is BOTH gone from the config AND not mounted. Diffing against the
   * config alone would treat a live pane whose container mints its id at load but only echoes on a user
   * action (every list container + tabs) as "not live", killing its pty on the first save after spawn.
   */
  liveNodeIds(): string[] {
    const out: string[] = []
    for (const node of this.nodes.values()) if (node.nodeId) out.push(node.nodeId)
    return out
  }
}
