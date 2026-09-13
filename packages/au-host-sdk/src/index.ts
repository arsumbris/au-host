export { displayFilePath } from './file-label'
// Projection mount contract.
//
// A projection is a separately-built repo (or local package) the host mounts
// at runtime. TS types evaporate at the dynamic-import boundary, so the host
// validates the manifest at load time and checks the contract version at the
// handshake. Pure types and pure functions only — no node imports, ever.
//
// This package is the renderer-side SDK: it carries the projection entry's
// `HTMLElement` at its root by design. The DOM-free engine edge types come
// from au-engine-sdk (`@arsumbris/au-engine-sdk/wire`); the dependency is one-way.

import type { EngineReadResult, ReadRequest, SubscribeRequest, SubscriptionEvent } from '@arsumbris/au-engine-sdk/wire'

// Host mount-contract vocabulary, generated from au-host-sdk's own type-defs
// (`type/*.type.yaml`) by @arsumbris/type-codegen. Re-exported as the SDK surface.
// `Projection` is the open BASE type; real views are subtypes whose instances ARE
// configs. `ProjectionRuntimeMeta` is the type-level meta
// (entry/contractVersion) each subtype carries to declare its loadable code.
// Projections form a KIND hierarchy: `PaneProjection` (a full content surface),
// `ContainerProjection` (holds child projections), `BarProjection` (a compact bar item,
// carrying placement hints) and its role subtype `StatusProjection` (`status-projection`),
// and `PlaceholderProjection` (what an empty slot shows — a picker, a recents launcher, a blank).
// Every mountable surface is its own kind-typed `projection` subtype; the ROLE is the kind;
// a bar aggregates a role via `readSubtypes(kind)` and names it with a `type<projection>*`
// def-ref.

// `ContainerSlot` is the POSITION a child occupies in a container — a `ContainerNode`, so
// disjoint from `Projection`, which is what makes each container's `<Projection | slot>`
// union discriminable. Each container extends it with what IT honours; `tabs` and `dock`
// use it directly.

// Container substrate CONTRACT: the `ContainerPlacement` seam a container-projection
// implements + the re-parenting/drop vocabulary the substrate drives it with.
// Framework-agnostic; the React implementation lives in @arsumbris/container-kit.

export type {
  ContainerPlacement,
  ContainerDialect,
  ContainerKind,
  DragSource,
  DragSourceRole,
  DragPoint,
  DropTarget,
  DropZone,
  BandFrac,
  Occupant,
  Pane,
  PaneId,
  PaneInstance,
  PoolEditSeam,
  StagedMint,
} from './container'
// The reorder no-op sentinel is a runtime value (a symbol), not a type — a container's `reorder`
// returns it to signal "dropped on its own position, nothing to commit" without a refusal diagnostic.
export { POOL_EDIT_NOOP } from './container'

// WHICH FIELDS HOLD CHILDREN — derived from the type graph, declared nowhere. Every container
// names its child-bearing fields differently (`left`/`center`/`right` vs `items` vs `tabs`), and
// bento's sit several levels deep inside a structural node, so the answer is a TRAVERSAL: collect
// at a field whose union names a `container-slot` subtype, descend the `container-node` subtypes it
// also names, stop at `projection`. Here because this package owns that vocabulary; the HOST does
// the reads and hands the defs in, so nothing here talks to a daemon. See ./slot-schema.ts

export { deriveContainerSchemas, bareTypeName } from './slot-schema.ts'
import { bareTypeName } from './slot-schema.ts' // also bound locally: viewersFor uses it
export type { ContainerSchemas, SlotField, SlotSchema, SlotTypeView } from './slot-schema.ts'

// THE COMPOSITION POOL — normalize an authored composition into a flat pool, resolve the pool into
// a mount tree, and validate the reference graph. Pure data → data over the type graph and the
// parsed value, the natural extension of the slot traversal above. See ./composition-pool.ts

export { normalizeToPool, resolvePoolToTree, serializePoolToComposition, poolRootType, recordMountType, validatePool, analyzePool, detectGhostRefCollapse, isPlaceholderRecord, COMPOSITION_PLACEHOLDER_TYPE, reachableRecordIds, reachableFromRoot, primaryContentId, parentMap, childRefIds, resolveLogicalParent, parseBlockRef, parseRef, isBlockRef, blockRef, recordId, linkPool, crossFileTargets, restoreCrossFileRefs, ENTRY_SCOPE, qualifyScopedId } from './composition-pool.ts'
export type { CompositionPool, PoolRecord, PoolDiagnostic, PoolAnalysis, LogicalParentInput, ParsedRef, ScopeInfo, ScopeTable, LinkedPool, ForeignFile } from './composition-pool.ts'

// PRESERVE WHAT YOU DO NOT OWN — a config serializer must not destroy composition-level
// fields (`intent-defaults` / `initial-focus` / `locks`) merely because it does not
// understand them. A fact about the CONFIG CONTRACT, so it lives here and not in
// container-kit: the non-React writers (`dock`, `bar`) depend on this package alone.
export { preserveUnowned } from './preserve-config.ts'

// The host DIAGNOSTIC seam. A report is a standing framework problem; `installDiagnosticConditionBridge`
// routes each one into the event substrate's condition SET (with a console floor), so diagnostics are a
// derived view of the one substrate. Deliberately a plain export, NOT a `MountHost` member: whether
// reporting becomes a blessed capability is still open, and publishing it on the contract would pre-empt that.
export { reportHostDiagnostic, setHostDiagnosticSink, installDiagnosticConditionBridge } from './diagnostics.ts'
export type { HostDiagnostic, HostDiagnosticSeverity, HostDiagnosticSink } from './diagnostics.ts'

// The keybinds canonicalizer — the shared, pure `KeyboardEvent` -> `{ mods, key }` seam.
export { canonicalizeKeystroke, canonicalKey, canonicalMods, isCommandChord, KEY_NAMES, formatChord, formatKeystroke, formatKeyName } from './keybinds.ts'
export type { CanonicalKeystroke } from './keybinds.ts'
// The keybind resolver — the pure focus-first / list-order / chooser decision + the buffer/sequence driver.
export { resolveChord, keystrokeEquals, buildActiveKeybinds, KeybindDispatcher } from './keybind-resolve.ts'
export type { ActiveKeybind, ChordResolution, PendingKeySequence, KeybindDispatcherDeps, RawKeymap, RawKeybind } from './keybind-resolve.ts'
// The codegen'd keybind enum types — the canonicalizer's checked codomain and the keymap-registry's parse
// target (`event.code` -> KeyName). Part of the SDK's public surface, so a consumer types against ONE source.
export type { KeyName, KeyModifier, Keystroke, Keybind, Keymap } from './generated'

// THE EVENT SUBSTRATE — one gated producer over a trace ring + a condition map, two derived views. A plain
// host-SDK export any projection may call to EMIT (mirroring reportHostDiagnostic); the VIEWS (read /
// readConditions / subscribe) are read the same way.

export {
  record,
  on,
  setCategory,
  setAllCategories,
  mirrorToConsole,
  event,
  condition,
  clearCondition,
  beginPass,
  endPass,
  withPass,
  currentCause,
  resumeCause,
  read,
  readSince,
  readConditions,
  conditionKey,
  stats,
  clear,
  subscribe,
  configureEvents,
} from './events.ts'
export type { HostEvent, HostEventKind, HostEventSeverity, EventFilter, EventStats } from './events.ts'
export { toChromeTrace } from './events-export.ts'
export type { ChromeTraceEvent } from './events-export.ts'

// TOKEN REGISTRATION. The RULE for "declared but the browser refused it" lives here so the host and
// any reporting surface share ONE implementation — two copies of a rule is how a shared rule becomes
// two rules that disagree. `TokenDiagnostics` is the read-only view the host publishes on
// `MountHost.tokens`, so a projection RENDERS the result and never re-derives it: detection has one
// owner, and it is the host, which is the side that loads the sheets. See ./tokens.ts.
export { declaredPropertyNames, rejectedTokenNames } from './tokens.ts'
export type { RejectedToken, TokenDiagnostics } from './tokens.ts'
import type { TokenDiagnostics } from './tokens.ts'
import type { BarProjection, ContainerNode, ContainerProjection, ContainerSlot, Grouping, GroupingContainer, Intent, OpensMeta, PaneProjection, PlaceholderProjection, Projection, ProjectionPresentationMeta, ProjectionRuntimeMeta, Ref, SpatialContainer, StatusProjection } from './generated'
export type { BarProjection, ContainerNode, ContainerProjection, ContainerSlot, Grouping, GroupingContainer, Intent, OpensMeta, PaneProjection, PlaceholderProjection, Projection, ProjectionPresentationMeta, ProjectionRuntimeMeta, Ref, SpatialContainer, StatusProjection }

// Agent-host transport CONTRACT: the framed command protocol au-host serves over
// its socket and au-mcp's host-relay tools speak as clients. Value-vocab-free,
// live/ephemeral only; the byte framing is engine-sdk's `frame.ts`, wired by the
// node-side server/client.

export { HOST_TRANSPORT_PROTOCOL_VERSION } from './transport.ts'
export type {
  HostCommand,
  HostResult,
  HostRequestFrame,
  HostResponseFrame,
  HostSnapshot,
  SnapshotNode,
  SnapshotFocus,
  ContainerOp,
  ContainerOpOutcome,
  HostRelayClient,
} from './transport'

/**
 * The mount-contract version spoken by the host. The handshake requires strict equality.
 * Increment it only for changes that break an existing projection, such as removing or renaming
 * a required member. Additive optional capabilities do not require a version change; consumers
 * guard their use when a host may omit them.
 */
export const MOUNT_CONTRACT_VERSION = 7

/** How the host reaches a registered projection. */
export type ProjectionSource =
  | { mode: 'dev-server'; url: string }
  | { mode: 'esm'; path: string }

/**
 * The host's carry-but-never-read config pass-through. The host stores and
 * forwards a projection's config opaquely; only the projection reads its shape.
 * A projection's config IS its instance (a typed `projection`
 * subtype instance); the host still forwards it without parsing.
 */
export type OpaqueConfig = unknown

/** Result of a host file read. `ok: false` carries the reason; it never throws. */
export interface FileReadResult {
  ok: boolean
  content?: string
  error?: string
  /**
   * The content hash at read time: the read-before-write guard baseline. Carry it
   * on the next `write`/`delete` as `expectedHash` to reject a stale write instead
   * of clobbering. Absent when the engine cannot supply a hash (the write then
   * degrades to blind). Supplied by the engine `resolve_target` read.
   */
  hash?: string
}

/** Result of a host file write/delete. `ok: false` carries the reason; it never throws. */
export interface FileWriteResult {
  ok: boolean
  error?: string
  /**
   * The post-mutation entry version: the echo-suppression key. A change-event
   * consumer drops events carrying its own write `version` to avoid reacting to
   * its own mutation. Suppression is designed per consumer.
   */
  version?: number
  /** The post-write content hash: seeds the next guarded write's `expectedHash`. */
  hash?: string
  /**
   * Present on a guard rejection (`ok: false`) when the file changed under the
   * writer: the consumer surfaces a conflict instead of clobbering. `currentHash`
   * is the on-disk hash the stale `expectedHash` failed to match.
   */
  conflict?: { currentHash: string }
}

/**
 * File read/write over the entry, bound by the host. Paths are in the same
 * address space as engine reads (entry-relative or absolute). Fully engine-backed:
 * read/exists via the engine `content` read, write/delete via the governed
 * member-aware mutation channel. No raw fs — a projection never opens its own.
 *
 * `write`/`delete` carry the optional read-before-write guard: pass the last-read
 * `hash` (from `FileReadResult.hash` or a prior write's `FileWriteResult.hash`) as
 * `expectedHash`, and a mismatch is REJECTED without writing (`ok: false` with a
 * `conflict`), not clobbered. Omitting it is a blind write.
 */
export interface FilesControl {
  /** Read a path. `ok: false` carries the reason; it never throws. */
  read(path: string): Promise<FileReadResult>
  /**
   * Write a path (creating parent dirs). The engine re-derives. Pass the last-read
   * `expectedHash` to guard against a stale overwrite (rejected with a `conflict`).
   */
  write(path: string, content: string, expectedHash?: string): Promise<FileWriteResult>
  /** Whether a path exists. */
  exists(path: string): Promise<boolean>
  /**
   * Delete a path. `ok: false` carries the reason; it never throws. Pass the
   * last-read `expectedHash` to guard against deleting a file changed under you.
   */
  delete(path: string, expectedHash?: string): Promise<FileWriteResult>
  /**
   * Move `from` to `to`, rewriting every inbound reference to follow the new name
   * (engine `rename`). One saga across every repo a referrer lives in, so inbound
   * `[[wikilink]]`s in OTHER workspace members are rewritten too; each referrer keeps
   * its spelling mode and fragments, only the name changes. The MOVE itself is
   * same-repo only (a `to` in a different member rejects) and a type-def file rejects
   * (that is `renameType`'s job). `ok: false` carries the reason; it never throws.
   */
  rename(from: string, to: string): Promise<FileWriteResult>
}

/**
 * A workspace member: a content root the host serves. The host is multi-root —
 * content is spread across members, each addressed by its absolute `root`. Backed
 * by the engine `members` read. `entry.path` is the host's binding; `workspace.members`
 * is the content topology beneath it.
 */
export interface WorkspaceMember {
  /** The member's declared name. */
  name: string
  /** The member's absolute content root. */
  root: string
  /** True when the member root sits outside the workspace root (absolute-addressed). */
  scattered: boolean
  /**
   * The ROLE axis: is this an authoring surface (`true`, the entry or an `edit`
   * member) vs a consumed `dep` / `discover` (`false`)? Engine schema 16.
   *
   * ROLE-DERIVED, never inferred from where the member resolved on disk: a
   * consumed member served from a live local tree is still NOT editable. To
   * author a member, declare it in the workspace's `edit:` list.
   */
  editable: boolean
  /**
   * The LOCATION axis: a live local working tree (`true`) vs a read-only cache
   * snapshot (`false`). Orthogonal to `editable` — the two axes cross, which is
   * exactly why `isWritableMember` needs both.
   */
  local: boolean
  /** The raw four-way role `editable` derives from. */
  role: WorkspaceMemberRole
}

/**
 * A member's role within the workspace. Closed set, but tolerate unknown values
 * per additive evolution — a newer engine may add one.
 * - `entry` — the folder-repo the daemon entered on (self-homing root).
 * - `edit` — an editable authoring member declared in `workspace.yaml`.
 * - `discover` — a pinned member mounted for discovery, not a type-dependency.
 * - `dep` — a declared type-dependency, from a sibling, registry, or cache.
 */
export type WorkspaceMemberRole = 'entry' | 'edit' | 'discover' | 'dep'

/**
 * Is this member an AUTHORING SURFACE — something the user is working on rather
 * than consuming? Use for the project-vs-dependency view: ranking, tagging,
 * hide-dependencies filters.
 *
 * Structural, so it accepts either a `WorkspaceMember` or a raw `WireMember`.
 */
export function isAuthoringMember(m: { editable: boolean }): boolean {
  return m.editable
}

/**
 * Is this member WRITABLE IN PLACE — the policy for SAVE TARGETING.
 *
 * Deliberately stricter than `isAuthoringMember`. The two axes cross: an `edit`
 * member that resolved only from the read-only package cache is YOURS
 * (`editable: true`) but is NOT a place you can write (`local: false`). Offering
 * it as a save target would produce a write into an immutable snapshot.
 *
 * Rule of thumb: filtering a LIST for display → `isAuthoringMember`; choosing a
 * destination for a WRITE → `isWritableMember`.
 */
export function isWritableMember(m: { editable: boolean; local: boolean }): boolean {
  return m.editable && m.local
}

/**
 * A tree-scoped selection channel, bound to this projection's node in the mount
 * tree. Payload-OPAQUE: the host carries `unknown` and never reads a selection.
 * A view publishes its own selection; it bubbles up the tree; a consumer follows
 * its ENCLOSING container's. The payload vocabulary (`selection` / `range` base
 * types) lives in first-party packages, never this SDK — the channel is a conduit.
 *
 * This is the higher-level surface layered ABOVE the per-publisher `viewState`
 * bus: `viewState` mirrors one explicitly-named viewport by id; `selection`
 * resolves "my container's selection" through the tree, naming no id. Both stay.
 * `focus` is its sibling tree-scoped channel; see `FocusChannel`.

 */
export interface SelectionChannel {
  /** Publish this view's own selection (opaque to the host). Bubbles up the tree. */
  publish(value: unknown): void
  /**
   * Follow the enclosing container's selection: the current value if present,
   * then each update. A view never gets its own echoed back. Returns unsubscribe.
   */
  follow(onValue: (value: unknown) => void): () => void
}

/**
 * The minimal shape the host reads off an intent: its `type` discriminant. The full
 * payload is OPAQUE to the host — it routes by `type` only. The vocabulary lives in a
 * first-party package (`@arsumbris/intent`), never this SDK; a consumer casts to its
 * own subtype. Mirrors how `SelectionChannel` carries `unknown`.
 */
/**
 * How the host DISPATCHES a routed intent (routing metadata, not semantic payload):
 * - `ambient` — target the ACTIVE container: most-recently-focused capable handler first,
 *   tree-proximity tie-break, the root container as backstop. For "act on what's focused /
 *   wherever the pane lives" intents (`open-intent`, `show-pane-intent`).
 * - `firer-relative` — target the firer's OWN container: the firer's-ancestors walk, never a
 *   more-recently-focused sibling. For "act on ME" intents (`promote-intent`, a future split).
 * Absent = `ambient` (the common case).

 */
export type IntentDispatch = 'ambient' | 'firer-relative'

/**
 * Whether the host ROUTES the intent to one claiming handler (a command, consumed once) or
 * BROADCASTS it to every capable handler (an event, fanned out). Absent = `routed` (the common
 * case, back-compatible). Sourced from the intent type-def's `intent-routing-meta`, threaded onto
 * the fired payload by the authored constructor. See the intent-dispatch + typed-UI-capabilities specs.
 */
export type IntentKind = 'routed' | 'broadcast'

export interface IntentPayload {
  type: string
  /** routed (claim-once) or broadcast (fan-out to all capable handlers). Absent = routed. */
  kind?: IntentKind
  /** Routing metadata the host reads to pick the dispatch strategy. Payload stays opaque. */
  dispatch?: IntentDispatch
}

/**
 * A tree-scoped COMMAND channel bound to this projection's node, the command sibling
 * of the state channels (`selection` / `focus`). A projection FIRES a typed intent; a
 * container DECLARES which `type`s it handles; the host ROUTES each fired intent to a
 * capable handler, once. The host reads only the `type` + `dispatch` metadata; the
 * payload is opaque.

 */
/**
 * A handler for one intent type, SPLIT into a pure CLAIM and an atomic COMMIT.
 *
 * `claim` — "would you take this intent?" — is a PURE, SIDE-EFFECT-FREE predicate. It reads state
 * and returns a boolean; it changes NOTHING. The host may call it for candidates that will not win,
 * in any order, in parallel, and across a window boundary — so it MUST NOT act. Return `true` to
 * claim, `false` to decline (the host then continues to the next candidate).
 *
 * `commit` — the ACT — runs ONLY for the winner (a routed intent's first claimer; for a broadcast
 * intent, every capable handler). It must be ATOMIC: fully take effect, or leave no observable trace.
 * If it CANNOT act — its state changed since the claim (the pane unmounted while a parallel remote claim
 * was still pending) — it THROWS *before* any observable effect. The host treats that throw as "did not
 * act": a ROUTED dispatch RE-HOMES to the next claimer in its order; a broadcast / wired-widen actor
 * simply did not act. Because the failed commit left no trace, the fallback can never double-act.
 *
 * Why the split: the host resolves WHO handles an intent by gathering claims (cheap, pure, safe to
 * over-ask and to parallelize), then commits exactly the winner. This is what lets cross-window
 * dispatch route without a double-act, and it makes `resolve()` (who WOULD take this) sound.

 */
export interface IntentHandler {
  /** PURE predicate — "would you take this?" No side effect; may be called for non-winners, in parallel. */
  claim: (intent: IntentPayload, from: string) => boolean
  /** ATOMIC act — runs only for the winner (routed) or every capable handler (broadcast). Fully takes
   *  effect, or THROWS before any observable act to signal "could not act" (state changed) — the host
   *  then re-homes a routed intent to the next claimer. */
  commit: (intent: IntentPayload, from: string) => void
}

export interface IntentChannel {
  /**
   * Fire an intent from this node; the host routes it to a capable handler. FIRE-AND-FORGET: a routed
   * intent may resolve ASYNCHRONOUSLY (a cross-window gather), so "was it claimed" is not a value the firer
   * reads — an intent nothing claims becomes the host's `unhandled` signal, not a return here. To act on a
   * reveal / open outcome, fire the fallback intent (the host's claim/decline chain resolves it), never a
   * boolean read.
   */
  fire(intent: IntentPayload): void
  /**
   * Declare this node handles intents of `type`, as a `{ claim, commit }` pair. `claim` is the
   * pure predicate the host gathers to resolve the winner; `commit` is the atomic act it runs on
   * the winner. Returns a disposer. See {@link IntentHandler}.
   *
   * An always-handler (a broadcast observer, or a container that never declines) writes
   * `{ claim: () => true, commit }`.
   */
  handle(type: string, handler: IntentHandler): () => void
}

/**
 * A tree-scoped focus channel bound to this projection's node, the state sibling that feeds intent
 * routing and the active-pane ring. The host owns the active-pane truth: it tracks REAL DOM focus per
 * window (a per-window tracker), retains the most-recently-focused pane, and derives each window's active
 * pane as the one aggregate FILTERED to that window (gated by the window's OS-focus). Routing then reaches
 * the most-recently-focused CAPABLE handler — retention is emergent, no command-source exclusion. A
 * container READS `activePane` / `watchActive` to draw its own ring, and only REPORTS when it activates a
 * child WITHOUT DOM focus (a tab switch).


 */
export interface FocusChannel {
  /**
   * Declare this container's active CHILD (a NON-DOM active-child notion) — `activeView` is the activated
   * child's node id, or omit it to report the container itself. The host retains it into the focus recency.
   * REAL DOM focus is the host's single ongoing source (a per-window tracker reports it); use `report` ONLY
   * where a container activates a child that receives no DOM focus — e.g. a `tabs` group switching to a tab
   * whose button, not its content, holds focus. A pane that gets real DOM focus never needs to call this.
   */
  report(activeView?: string): void
  /**
   * The `^:` of the currently ACTIVE pane (the most-recently-focused, retained across focus moves), or
   * null when nothing has focus. The host owns this truth; a CONTAINER reads it to render its OWN
   * active-pane chrome (the ring) for the pane whose `^:` matches — the host never draws pane chrome.
   * Optional (additive): a host that predates it omits it.
   */
  activePane?(): string | null
  /**
   * Subscribe to active-pane changes. Fires IMMEDIATELY with the current active `^:`, then on every
   * change. Returns a disposer. A container drives its active-pane ring from this instead of tracking
   * focus itself, so the ring follows real DOM focus. Optional (additive).
   */
  watchActive?(listener: (activePane: string | null) => void): () => void
}

/**
 * A guard consulted before this node is closed. Returns consent (`true`) or refusal (`false`),
 * synchronously or as a promise. It is the projection's decision point: the guard is where a
 * projection runs its own save flow or shows a confirmation, then answers. It is INTERACTIVE
 * (unlike the pure intent `claim`), so the host gathers guards SEQUENTIALLY and stops at the
 * first refusal. A refusal ABORTS the close: the projection is not removed and nothing is
 * handed to another actor. A node with no guard consents by default.
 */
export type CloseGuard = () => boolean | Promise<boolean>

/**
 * A tree-scoped CLOSE-GUARD channel bound to this projection's node. A projection REGISTERS a
 * guard the host consults before removing this node (or any container that encloses it). Every
 * guard in a closing subtree must consent, or the close aborts and the placement is untouched.
 * The channel is the projection-side participation in the host's removal lifecycle: the projection
 * owns the veto decision (save / discard / cancel), the host owns the removal itself. Distinct from
 * the standing dirty state a projection publishes on `viewState` (that drives the visual dirty
 * indicator; this drives the interactive close decision).

 */
export interface CloseGuardChannel {
  /** Register a guard consulted before this node is closed. Returns a disposer. */
  register(guard: CloseGuard): () => void
}

/**
 * A per-instance RESTORABLE view-state slot. A projection persists its cursor / scroll /
 * folds / expansion here instead of in its config, so high-frequency changes never churn
 * the git-tracked composition (the settings-vs-state split). The host keys it by
 * composition + this node's stable id (see `MountHost.instanceId`) + an optional projection
 * sub-key. Distinct from the live `viewState` bus, which is never persisted.

 */
export interface ViewStore {
  /** Read the stored value for an optional sub-key (e.g. the open file), or `undefined`. */
  get(subKey?: string): unknown | undefined
  /** Persist `value` under an optional sub-key. */
  set(value: unknown, subKey?: string): void
}

/** A named theme. Discovery callers supply a stable source identity, independent of its label. */
export interface ThemeSelection {
  /** Omit only for inline themes, whose identity follows their name and CSS contents. */
  id?: string
  name: string
  css: string
}

/** Shared theme editor draft: per-theme appearance and device-wide density/terminal font size. */
export interface ThemeDraftSession {
  snapshot(): {
    overrides: Record<string, string>
    saved: Record<string, string>
    /** The currently rendered theme, including a named preview. */
    activeTheme: ThemeSelection | null
    savedTheme?: ThemeSelection | null
    previewing?: boolean
  }
  subscribe(listener: () => void): () => void
  setToken(name: string, value: string | null): void
  /** Reset the active appearance and shared device draft to token defaults. */
  reset(): void
  discard(): void
  /** Save current token edits and any named candidate in one atomic operation. */
  save(): void
  /** Preview a named candidate (null means Base) without writing storage. Shared across editors. */
  previewTheme?(theme: ThemeSelection | null): void
  /** Save the candidate selection only; token edits remain unsaved until save(). */
  applyThemePreview?(): void
  /** Return to the saved selection; retain each theme's token draft. */
  cancelThemePreview?(): void
  /** Restore saved appearance when the last editor closes; cancel named preview, retain token drafts. */
  dispose(): void
}

/** Device-local theme selection and edits, applied to chrome and all projections. */
export interface ThemeControl {
  /** Projections use the host-owned draft instead of writing app root styles. */
  openDraft?(): ThemeDraftSession
  /** Active theme's saved appearance merged with shared device preferences. Returns a copy. */
  getOverrides(): Record<string, string>
  /**
   * Replace the active theme's appearance edits and shared device preferences atomically.
   * Other themes' edits remain intact. Missing keys fall back to the theme or token defaults.
   * Cancels any named preview on success. For saving a candidate and its edits, use the draft session.
   * Throws on persistence failure, retaining saved state and the unsaved draft.
   */
  save(overrides: Record<string, string>): void
  /** Clear active appearance edits and device preferences, retaining other themes' edits. */
  clear(): void
  /** Persisted selection; a draft snapshot separately exposes the preview candidate. */
  getActiveTheme(): ThemeSelection | null
  /**
   * Persist selection and apply that theme's own edits. Open editors preview its retained draft.
   * Device density and terminal font size are independent of named theme CSS.
   */
  setActiveTheme(theme: ThemeSelection | null): void
}

/**
 * The app-global, per-machine COMPONENT-SET selection — the sibling of `ThemeControl` for the
 * swappable component layer. A "look" set overrides some component TAGS; selecting one is a
 * BOOT-SWAP: the host persists the choice and applies it on the next RELOAD (a custom-element tag
 * can be defined only once per registry, so a live app-wide swap is not expressible — the gallery
 * previews sets live in scoped registries instead). The components picker (chips in the gallery)
 * reads + drives this. OPTIONAL on `MountHost`, so a consumer guards (`host.components?.…`).
 *
 */
export interface ComponentSetControl {
  /** The active "look" set's type name, or null for the default floor only. */
  getActiveSet(): string | null
  /**
   * Persist the chosen look set (or clear it with null). Per-machine, like the active theme. The
   * app-wide swap is BOOT-SWAP, so a caller PERSISTS here then prompts a RELOAD to apply — this
   * never re-registers elements mid-session.
   */
  setActiveSet(id: string | null): void
  /**
   * Build a LIVE preview factory for a set (`null` == the default floor), for a picker that shows a
   * set WITHOUT the app-wide reload. The host renders the set's overriding elements off to the side
   * (a scoped registry where the platform supports it, else mangled global names) so the live global
   * registry — and every other pane — is untouched: two sets coexist in one document. OPTIONAL:
   * returns null only when the set has no resolvable stack, so the caller keeps its live render. See
   * `ComponentPreview`.
   */
  buildPreview?(setId: string | null): Promise<ComponentPreview | null>
}

/**
 * A live preview factory over one component set's resolution, minted by `ComponentSetControl.buildPreview`.
 * Used by the gallery to render a set's look with NO app reload (each set previewed through its own
 * scoped registry). The elements are for DISPLAY only — they are not the app's live elements.
 */
export interface ComponentPreview {
  /** Create a preview element of `tag` under this set's resolution (scoped where it overrides the
   *  live app, the global element otherwise). Always returns an element (bare for an unknown tag). */
  create(tag: string): HTMLElement
}

/**
 * A live pty session handle, host-owned. The pty backend lives in the host's main
 * process — a renderer projection cannot spawn one. The session SURVIVES the
 * projection's remount: `detach` stops rendering without killing it, a later `attach`
 * reattaches to the same live session. `close` is the only terminate.

 */
export interface TerminalSession {
  /** Receive output — buffered scrollback replayed first, then the live stream. Returns unsubscribe. */
  onData(listener: (chunk: string) => void): () => void
  /** Fires when the pty ends (process exit, or an explicit close elsewhere). Returns unsubscribe. */
  onExit(listener: () => void): () => void
  /** Forward keystrokes to the pty stdin. */
  write(data: string): void
  /** Resize the pty (driven by the renderer's fit). */
  resize(cols: number, rows: number): void
  /** Inject text into the session (the agent-driver seam; today the same as `write`). */
  send(text: string): void
  /** The shell's current working directory (queried from its pid), or `undefined`. */
  cwd(): Promise<string | undefined>
  /** Stop rendering (the view is unmounting). Does NOT kill the session. */
  detach(): void
  /** Explicit user kill: terminate the pty. */
  close(): void
}

/**
 * A host-owned pty capability scoped to this projection's instance. The host keys the
 * session per pane (composition + `instanceId`), so a remount detaches + reattaches to
 * the SAME live session and never kills it (a hard invariant). See `TerminalSession`.
 */
export type TerminalPromptPreset = 'inherit' | 'raw' | 'minimal' | 'compact-git' | 'clean' | 'context'
export interface TerminalAttachOptions {
  cwd?: string
  shell?: string
  cols?: number
  rows?: number
  /** Applied only when creating a shell. Existing sessions retain their launch configuration. */
  prompt?: TerminalPromptPreset
  /** Executed once per new PTY, never on reattach. */
  command?: string
}

export interface TerminalChannel {
  /** Attach to this instance's session (creating it on first attach). Returns the live handle. */
  attach(opts?: TerminalAttachOptions): TerminalSession
}

/** The per-machine terminal presentation config — the settings for the host's `terminal` capability. */
export interface TerminalPreferences {
  shell: string
  prompt: 'inherit' | 'raw' | 'minimal' | 'compact-git' | 'clean' | 'context'
  scrollback: number
  cursorStyle: 'bar' | 'block' | 'underline'
  cursorBlink: boolean
}

/** Read / write / observe the device-local `TerminalPreferences`, the sibling of `terminal` a terminal
 *  projection renders against. Framework-agnostic (no app vocabulary), so it rides the contract. */
export interface TerminalPreferencesControl {
  get(): Promise<TerminalPreferences>
  save(value: TerminalPreferences): Promise<TerminalPreferences>
  subscribe(listener: (value: TerminalPreferences) => void): () => void
}

/**
 * A discovered projection subtype with its kind closure and raw declared metadata.
 * Choosers use the closure to group or filter candidates. Consumers read metadata blocks they
 * understand, such as projection-presentation-meta, without making their own engine requests.
 * A host may omit this optional descriptor surface; callers can fall back to listProjections().
 */
export interface ProjectionDescriptor {
  /** The projection subtype name — the identity `children.mount` takes. */
  type: string
  /** The OWNER repo of this subtype. Disambiguates same-named surfaces from different packages. */
  repo: string
  /**
   * The full KIND closure, e.g. `['pane-projection', 'projection']`. Membership is by CLOSURE, never
   * by exact match, so a third-party subtype of a kind is recognised without the reader knowing it.
   */
  kinds: readonly string[]
  /**
   * The projection type-def's declared META BLOCKS, keyed by bare meta-type name, each block
   * assembled into a plain record. Raw and generic: a reader keys by the meta type it understands
   * (`meta['projection-presentation-meta']?.title`) via the helpers below. Absent when the host
   * predates this field; an individual key is absent when the projection declares no such block.
   */
  meta?: Record<string, Record<string, unknown>>
}

/** The bare name of the presentation meta-type — the key a title reader uses on `ProjectionDescriptor.meta`. */
export const PRESENTATION_META_TYPE = 'projection-presentation-meta'

/**
 * The human display title a projection DECLARED, or `undefined` if it declared none. Reads the
 * `projection-presentation-meta` block off the descriptor's generic `meta` map, so the meta-type name
 * lives in ONE place (here, the owner) rather than in every consumer. A masthead pairs this with a
 * name-derivation fallback (`container-core`'s `descriptorLabel`).
 */
export function descriptorTitle(
  descriptor: { meta?: Record<string, Record<string, unknown>> } | undefined,
): string | undefined {
  const title = descriptor?.meta?.[PRESENTATION_META_TYPE]?.title
  return typeof title === 'string' && title.length > 0 ? title : undefined
}

/** The shared icon identifier declared by a projection for container chrome. */
export function descriptorIcon(
  descriptor: { meta?: Record<string, Record<string, unknown>> } | undefined,
): string | undefined {
  const icon = descriptor?.meta?.[PRESENTATION_META_TYPE]?.icon
  return typeof icon === 'string' && icon.trim().length > 0 ? icon.trim() : undefined
}

/** The bare name of the opens meta-type — the key viewer resolution reads on `ProjectionDescriptor.meta`. */
export const OPENS_META_TYPE = 'opens-meta'

/**
 * The file extensions a viewer DECLARED it opens (`opens-meta`), or `undefined` if it declared none.
 * `*` means any file. Read off the descriptor's generic `meta` map, so the meta-type name lives in
 * ONE place. `container-core`'s `viewersFor` pairs this with a per-extension match to build the
 * ELIGIBLE set; `resolveViewer` runs the ladder over it (opens-meta is eligibility, not the decision).
 */
export function descriptorOpens(
  descriptor: { meta?: Record<string, Record<string, unknown>> } | undefined,
): string[] | undefined {
  const opens = descriptor?.meta?.[OPENS_META_TYPE]?.opens
  if (!Array.isArray(opens)) return undefined
  const exts = opens.filter((e): e is string => typeof e === 'string' && e.length > 0)
  return exts.length > 0 ? exts : undefined
}

/** The bare name of the breakpoints meta-type — the key a container reads on `ProjectionDescriptor.meta`. */
export const BREAKPOINTS_META_TYPE = 'breakpoints-meta'

/** One compact render size a projection declared, in px. No label — a container matches on its axis. */
export interface Breakpoint {
  width?: number
  height?: number
}

/**
 * The compact render sizes a projection DECLARED (`breakpoints-meta`), or `undefined` if it declared
 * none. Read off the descriptor's generic `meta` map, so the meta-type name lives in ONE place. A
 * container reads the AXIS it governs (a width-collapsing container filters to entries with a `width`);
 * WHICH one it picks, and any state enum over them, is the container's own dialect, never encoded here.
 */
export function descriptorBreakpoints(
  descriptor: { meta?: Record<string, Record<string, unknown>> } | undefined,
): Breakpoint[] | undefined {
  const raw = descriptor?.meta?.[BREAKPOINTS_META_TYPE]?.breakpoints
  if (!Array.isArray(raw)) return undefined
  const out: Breakpoint[] = []
  for (const b of raw) {
    if (b == null || typeof b !== 'object') continue
    const width = (b as { width?: unknown }).width
    const height = (b as { height?: unknown }).height
    const bp: Breakpoint = {}
    if (typeof width === 'number') bp.width = width
    if (typeof height === 'number') bp.height = height
    if (bp.width !== undefined || bp.height !== undefined) out.push(bp)
  }
  return out.length > 0 ? out : undefined
}

/** The extension of a file path, lowercased, no dot. `notes/x.MD` -> `md`. Empty for none. */
export function extensionOf(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

type ViewerDescriptor = { type: string; meta?: Record<string, Record<string, unknown>> }

/**
 * The ELIGIBLE viewer projection types that open `filePath`, most-specific FIRST (for DISPLAY): viewers
 * naming the file's exact extension (in descriptor order) precede universal (`*`) viewers. Resolved from
 * `opens-meta` over the host's `describeProjections()` set — never a hardcoded projection name.
 *
 * This is ELIGIBILITY, not the decision. `container-core`'s `resolveViewer` runs the ladder over this
 * set (the firer's `open-intent.with`, then a composition `viewer-defaults`, then the sole eligible
 * viewer, else a picker); file-tree's "Open with ›" menu + the picker use the WHOLE list. The ranking
 * here only orders the display — nothing auto-selects `[0]`. Empty when nothing declares it opens the file.
 */
export function viewersFor(
  filePath: string,
  descriptors: readonly ViewerDescriptor[] | undefined,
): string[] {
  const ext = extensionOf(filePath)
  const specific: string[] = []
  const universal: string[] = []
  for (const d of descriptors ?? []) {
    const opens = descriptorOpens(d)
    if (!opens) continue
    if (ext && opens.includes(ext)) specific.push(bareTypeName(d.type))
    else if (opens.includes('*')) universal.push(bareTypeName(d.type))
  }
  return [...specific, ...universal]
}

/** The bare name of the handles-intent meta-type — the key the file-consumer read uses on `meta`. */
export const HANDLES_INTENT_META_TYPE = 'handles-intent-meta'

/** Bare a def-ref value as authored in a meta block: strip the `[[ ]]` frame, any `#anchor` / `|alias`,
 *  and the `::repo` scope, leaving the type name. Mirrors discovery's `refBareName`, so a descriptor's
 *  raw `handles` (`[[open-intent::intent]]`) and an already-bared name both reduce to `open-intent`. */
function bareDefRef(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined
  const inner = ref.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0]?.trim() ?? ''
  const name = inner.split('::')[0]?.trim() ?? ''
  return name || undefined
}

/**
 * The intent type names a projection DECLARED it handles (`handles-intent-meta`), bared. Read off the
 * descriptor's generic `meta` map, so the meta-type name lives in ONE place (mirrors `descriptorOpens`).
 * Empty when it declares no such block.
 */
export function descriptorHandles(
  descriptor: { meta?: Record<string, Record<string, unknown>> } | undefined,
): string[] {
  const handles = descriptor?.meta?.[HANDLES_INTENT_META_TYPE]?.handles
  if (!Array.isArray(handles)) return []
  return handles.map(bareDefRef).filter((n): n is string => n !== undefined)
}

/**
 * The projection types that can be HANDED a file but are NOT file-type viewers: a `pane-projection`
 * content surface that handles `open-intent` (an open fired at it re-seeds it) yet declares no `opens-meta`
 * (radial-tree, focal-tree). The switch affordance's SECONDARY group — "other things you can do with this
 * file" — distinct from `viewersFor`'s primary group of viewers that RENDER the file. The gate is by KIND
 * and meta, never by name:
 * - must be a `pane-projection` (a content surface). This EXCLUDES a `container-projection` (bento, tabs,
 *   dock — they handle opens by routing to CHILDREN, they are not a thing a file is shown IN), a
 *   `bar-projection`, and a `placeholder-projection` (the empty-slot picker handles open-intent to be an
 *   open target, but it is chrome, not a way to view a file).
 * - a projection declaring `opens-meta` is a viewer, so it is in `viewersFor`'s group, not here.
 * - a projection that only FIRES opens (backlinks, force-graph) declares no `handles`, so it never appears.
 * Resolved from folded meta + kind — never a hardcoded name.
 */
export function fileConsumersFor(
  descriptors: readonly (ViewerDescriptor & { kinds?: readonly string[] })[] | undefined,
): string[] {
  const out: string[] = []
  for (const d of descriptors ?? []) {
    if (descriptorOpens(d)) continue // it IS a viewer → viewersFor's primary group, not here
    if (!(d.kinds ?? []).some((k) => bareTypeName(k) === 'pane-projection')) continue // content surface only
    if (descriptorHandles(d).includes('open-intent')) out.push(bareTypeName(d.type))
  }
  return out
}

/**
 * The projection types that DECLARE they handle `intentType` (`handles-intent-meta`), folded from the type
 * graph — bare type names. Independent of whether any INSTANCE is present: the unhandled-intent floor asks
 * "what COULD handle this" when nothing present claimed it, to offer adding one. Distinct from a
 * composition's PRESENT handlers (an owners query over live nodes). Never a hardcoded name.
 */
export function handlersFor(
  intentType: string,
  descriptors: readonly ViewerDescriptor[] | undefined,
): string[] {
  const out: string[] = []
  for (const d of descriptors ?? []) {
    if (descriptorHandles(d).includes(intentType)) out.push(bareTypeName(d.type))
  }
  return out
}

export interface ChromeContribution {
  /** The candidate projection's TYPE NAME — what a container mounts via `children.mount`. */
  projection: string
  /** The role KIND this targets (the queried kind). */
  role: string
  /** Placement hints a container may honor or ignore. Set on a placed instance; absent for an unplaced candidate. */
  order?: number
  minSize?: number
  overflowEligible?: boolean
}

/**
 * Builds a preview card's content into `card`. `isCurrent` reports whether this card is
 * still the live one (the content may resolve async and should bail if superseded). The
 * host owns the card chrome; this owns what goes inside it.
 */
export type FillFn = (card: HTMLElement, isCurrent: () => boolean) => void | Promise<void>

/** Builds a nested preview's content from a wikilink's resolved target path (the nesting hook). */
export type LinkResolver = (path: string) => FillFn

/**
 * The host's ephemeral PREVIEW overlay surface, a per-window singleton mount site. A
 * projection INVOKES it to render content in a clamped, sticky, dismissable floating card;
 * the host owns the chrome (positioning, viewport-clamp, theming, dismissal), the caller's
 * `fill` owns the content. Shared across consumers (hover peeks, overflow popovers, the
 * bar's right-click menu). Not the intent channel — a singleton with no focus routing. A
 * preview is a projection in an overlay site.

 */
export interface PreviewSurface {
  /**
   * Show `key`'s content (built by `fill`) anchored to `rect`, as the ROOT of a fresh stack.
   * `linkResolver` enables NESTING: a `data-preview-path` link cmd-hovered inside a card
   * spawns a child built from it. `onOpen` enables OPENING: a `data-preview-path` link
   * cmd-CLICKED inside any card of this stack calls `onOpen(path)` (the consumer routes it
   * to an open-intent), then the stack collapses. Without `onOpen` the link is hover-only.
   */
  show(
    key: string,
    rect: DOMRect,
    fill: FillFn,
    linkResolver?: LinkResolver,
    onOpen?: (path: string) => void,
  ): void
  /** Dismiss the whole stack. */
  hide(): void
  /** True when the point is inside ANY live card in the stack (consumers use it for sticky behavior). */
  isOver(x: number, y: number): boolean
  /** True when the ROOT card is currently showing `key` (dedup: don't re-show the same target). */
  isShowing(key: string): boolean
}

/**
 * Named overlay stacking levels, ordered by the host within each window.
 * The names correspond to @arsumbris/style --au-z-* tokens, so themes can change the ladder
 * without consumers choosing their own z-index values.
 */
export type OverlayLevel = 'raised' | 'sticky' | 'dropdown' | 'overlay' | 'popover' | 'toast' | 'tooltip'

/** How a claimed layer behaves. The one field has a safe default, so `claim()` takes no argument in
 *  the common case. */
export interface OverlayOptions {
  /** Where in the ladder. Default `overlay`, the general-purpose band. */
  level?: OverlayLevel
  /**
   * The element the overlay is summoned FROM (the trigger). When it sits inside another claimed layer
   * — a select opened inside a modal palette — the site NESTS the new layer under that one, so the
   * popup stacks ABOVE its host surface. The fixed band ladder cannot express "above my container"
   * (a `dropdown` is globally below an `overlay`), so a control popup inside an `overlay` modal would
   * otherwise be occluded. Absent → a top-level layer placed purely by the band ladder, as before.
   * A shadow-piercing walk finds the containing layer, so a component nested in shadow roots resolves.
   */
  from?: HTMLElement
  /**
   * Whether an open layer at a blocking band (dropdown / overlay / popover) SUPPRESSES keybind dispatch
   * while it is up. Default `true`: a chord does not fire underneath a chooser, confirm dialog, or menu —
   * a pending DECISION owns the keyboard. A keyboard-driven LAUNCHER that manages its own keys sets this
   * `false` (the command palette, so `⌘K` still toggles it closed and typing reaches its search) — its
   * shortcuts run through the keymap, not a hidden layer. Keybind-blocking is thus a per-LAYER property,
   * independent of the z-stacking band. Ignored for a non-blocking band (toast / tooltip / raised / sticky),
   * which never suppresses a chord regardless.
   */
  keyguard?: boolean
}

/**
 * Overlay layers span the viewport and remain pointer-transparent. Interactive content re-enables
 * pointer events on its own elements, for example .my-card { pointer-events: auto; }.
 * A modal backdrop captures clicks only while the dialog is open; the containing layer never does.
 */

/**
 * A claimed overlay layer: an element to draw into, and the release that takes it away.
 *
 * Each layer is ITS OWN STACKING CONTEXT (`isolation: isolate`), which is the property that makes
 * this safe rather than merely tidy: a claimant's internal `z-index` values are contained and can
 * never escape to fight another claimant's. The preview surface's interleaved card/cone ordering
 * keeps working unchanged inside its own layer, and stops being comparable to a toast's.
 *
 * The same guarantee the mount tree already gives a pane, applied to the overlay tier.
 */
export interface OverlayLayer {
  /** Draw here. Owned by the claimant until `release`; the host owns everything around it. */
  readonly el: HTMLElement
  /** Give the layer back. Idempotent. The element and its contents are removed. */
  release(): void
}

/**
 * THE HOST'S OVERLAY SITE — a place to draw ABOVE the composition, for the things a pane cannot
 * contain.
 *
 * A SITE KIND, not a utility. The mount contract is site-agnostic and the site kinds are open: a
 * pane, a detached window, an ephemeral overlay, a spatial node. This is the ephemeral overlay site.
 *
 * **A projection reaching for `document.body` is the tell that a site kind is MISSING, not that the
 * projection is misbehaving.** That is the rule this exists to satisfy. A cross-pane drawing layer
 * is a legitimate thing to want — the layout inspector draws frames over separately-mounted
 * projection roots, which no pane can contain — and the framework's answer is a sanctioned route,
 * not a prohibition. (It could not be a prohibition anyway: same-realm code can always reach the
 * document, and only an iframe is a real boundary.)
 *
 * WHAT THE HOST OWNS: creating the layer, its place in the stacking ladder, its per-window
 * lifecycle, and tearing it down when the window closes. WHAT THE CLAIMANT OWNS: the content.
 * The same frame-vs-content seam as the notification toast and `preview.show`'s `fill`.
 *
 * OPTIONAL, so `MOUNT_CONTRACT_VERSION` is UNCHANGED: a host predating it omits the member and a
 * caller guards (`host.overlay?.claim()`).
 */
/** Where a menu is summoned: a cursor point, or a box to sit beside (a toolbar button). */
export type MenuAnchor = { x: number; y: number } | DOMRect

/** Fields every actionable row carries, whether it runs something or opens a submenu. */
interface MenuRowBase {
  /** Stable dotted id, e.g. `file.open`. Identity for tests and for a future contribution seam. */
  id: string
  /** Imperative verb+object, rendered verbatim. */
  label: string
  /** OPTIONAL leading glyph — an `au-icon` name (e.g. `swap`), so a menu row can carry the same icon its
   *  originating toolbar button shows. Absent renders a text-only row. */
  icon?: string
  /**
   * `false` renders the row disabled and unactivatable.
   *
   * REQUIRED, not optional-defaulting-true, so a caller building rows conditionally has to answer
   * the question rather than omit it — and `reason` below makes a disabled row explain itself. A
   * silent dead row is the thing this shape exists to prevent.
   */
  enabled: boolean
  /** REQUIRED in practice when `!enabled`: WHY, surfaced to the human. Never a silent refusal. */
  reason?: string
}

/** A row that DOES something. */
export interface ActionDescriptor extends MenuRowBase {
  /** `true` renders the row in the danger tone. */
  destructive?: boolean
  /** Arm a highlight over the target while the row is focused or hovered; returns its teardown. */
  preview?(): () => void
  /** Perform it. The clicked target is baked in by the caller. Activating a row closes the menu. */
  run(): void
}

/**
 * A menu row that opens a submenu. It is a distinct variant from an action row: a submenu has
 * children and no action to run, so the union prevents ambiguous activation behavior.
 */
export interface SubmenuDescriptor extends MenuRowBase {
  /** The child menu. RECURSIVE, so submenus nest arbitrarily. */
  items: ContextMenuItem[]
}

/** One row, a divider, or a non-interactive heading. */
export type ContextMenuItem =
  | ActionDescriptor
  | SubmenuDescriptor
  | { separator: true }
  | { section: string }

/**
 * A handle to ONE opened menu, so a caller closes what it opened and nothing else.
 *
 * NOT a bare `close()` on the surface. The surface is a per-window singleton, so a surface-level
 * `close()` would let one projection tear down another's menu. A scoped handle keeps
 * ownership with its caller, like `OverlayLayer`'s `release`.
 */
export interface MenuHandle {
  /** Dismiss this menu and any submenu under it. Idempotent, and a no-op once superseded. */
  close(): void
  /** When supplied, resolves on every dismissal path, including replacement by another menu. */
  closed?: Promise<void>
}

/**
 * The host context-menu surface owns placement, viewport-edge flipping, roving focus, submenu
 * traversal, dismissal and teardown. Callers supply rows in display order and insert separator rows
 * between groups. The host overlay lets the menu escape clipped container content.
 *
 * Each caller owns its complete row list; the surface has no cross-plugin contribution mechanism.
 * This capability is optional: guard host.contextMenu before opening a menu.
 */
export interface ContextMenuSurface {
  /**
   * Show `items` at `anchor`. Returns a handle that closes THIS menu.
   *
   * Opening supersedes any live menu in the window — a fresh right-click replaces the old one,
   * which is what every menu everywhere does. The superseded menu's handle goes inert rather than
   * gaining the power to close its replacement.
   */
  open(anchor: MenuAnchor, items: ContextMenuItem[]): MenuHandle
}

export interface OverlaySite {
  /**
   * Claim a layer. Returns it immediately; there is nothing to await.
   *
   * Claim ONE layer per surface and keep it, rather than claiming per drawing: a layer is cheap but
   * it is a position in the ladder, and churning it makes the order depend on timing.
   */
  claim(options?: OverlayOptions): OverlayLayer
}

/**
 * A handle to ONE opened popover, so a caller closes what it opened and nothing else.
 *
 * NOT a bare `close()` on the surface: the surface is a per-window singleton, so a surface-level
 * `close()` would let one caller tear down another's popover — the same hazard `MenuHandle` avoids
 * for the context menu, and `OverlayLayer`'s `release`.
 */
export interface PopoverHandle {
  /** Close this popover. Idempotent, and a no-op once a newer popover has superseded it. */
  close(): void
}

/**
 * THE HOST'S POPOVER SURFACE — an INTERACTIVE floating panel anchored to a trigger. The click-opened,
 * focus-holding sibling of `preview` (a hover peek) and `contextMenu` (action rows only).
 *
 * The host owns the CHROME: claiming the overlay layer, anchoring to the trigger rect with viewport
 * edge-flip, and dismissal (Escape, an outside pointerdown, window blur/resize, or `handle.close()`).
 * The caller supplies the CONTENT via `fill` — the same frame-vs-content seam as `preview.show`'s
 * `fill` and the confirm modal. It holds arbitrary interactive controls (an input, a select), which is
 * what the rows-only `contextMenu` cannot host and the proximity-dismissed `preview` would fight (its
 * pointer-move keep-alive would dismiss the panel the moment you moved to a field).
 *
 * Reach for it instead of hand-rolling an anchored popup: an inline `position:absolute` one is clipped
 * by an ancestor's `overflow` / stacking context, and escaping that means `document.body` — the
 * missing-site-kind tell. This is the site kind.
 *
 * OPTIONAL + additive, so `MOUNT_CONTRACT_VERSION` is UNCHANGED. Guard it — `host.popover?.open(...)`.
 */
export interface PopoverSurface {
  /**
   * Open a popover anchored to `anchor`, its content built by `fill`. Returns a handle that closes
   * THIS popover. `onDismiss` fires ONCE when it closes for ANY reason (Escape / outside pointerdown /
   * blur / resize / `handle.close()`), so a caller can sync its own trigger state — a pressed or
   * `aria-expanded` icon that must un-press when the panel is dismissed out from under it.
   *
   * Opening supersedes any live popover in the window; the superseded handle goes inert rather than
   * gaining the power to close its replacement.
   */
  open(anchor: DOMRect, fill: FillFn, onDismiss?: () => void): PopoverHandle
}

/**
 * OPEN SURFACES — the host-owned live index of the many-to-many relation between CONTENT and mounted
 * projection instances (a "surface" is one mounted projection instance at a site). A file-tree
 * "open editors" section, a switcher, and a command palette all read one index.
 *
 * The declaring half (`setContent`) is bound to the CALLING projection's node; the reading half
 * (`list` / `find` / `subscribe`) is HOST-WIDE. The host stores content but interprets no payload — it
 * dedupes and answers `find` by the caller-supplied IDENTITY STRING alone (payload-opacity, the same
 * stance as `SelectionChannel`). Existence is host-known (mount/unmount), so a projection never
 * declares that it exists — only WHAT it currently addresses.
 *
 * REPORTS ONLY. Acting on a surface (focus / reveal / close) rides the intent channel or a mutation,
 * never a method here. OPTIONAL + additive, so `MOUNT_CONTRACT_VERSION` is UNCHANGED. Guard it —
 * `host.openSurfaces?.setContent(...)`.

 */
export interface OpenSurfaces {
  /**
   * DECLARE this surface's content (the calling projection's own). `[]` is content-less (a terminal).
   * Each item is an OPAQUE payload + a caller-computed identity string; the host stores both and reads
   * neither. The host DEDUPES by the identity set, so a re-declaration with an unchanged set fires no
   * subscriber (an intra-content cursor hop never churns the index). Content auto-clears on unmount.
   */
  setContent(items: OpenContent[]): void
  /**
   * CONTAINER-declared: mark a CHILD surface transient (a preview / peek / transient tab) or not, by its
   * `surfaceId`. The host cannot see transient-ness (it is container-private tab state), so the container
   * that owns the tab annotates it. Addressed by the child's `surfaceId`, since a container declares this
   * for its children, not for itself. A no-op for a `surfaceId` the index does not hold.
   */
  setTransient(surfaceId: string, transient: boolean): void
  /** A snapshot of every open surface, host-wide. */
  list(): OpenSurface[]
  /** The surfaces addressing `identity`. Matches a surface if ANY of its contents' identity equals it. */
  find(identity: string): OpenSurface[]
  /** The current set, then each change. Returns unsubscribe. */
  subscribe(onChange: (surfaces: OpenSurface[]) => void): () => void
}

/**
 * One thing a surface addresses: an opaque payload plus a caller-computed identity string. The host
 * matches by `identity` (string equality) and never reads `payload`; a consumer casts the payload to
 * its own vocabulary (e.g. `@arsumbris/selection`'s `Selection`). See `OpenSurfaces`.
 */
export interface OpenContent {
  /** The dedupe / find key, computed by the declarer from its content (e.g. a file path). */
  identity: string
  /** OPAQUE to the host; a consumer casts it to the vocabulary it understands. */
  payload: unknown
}

/** One mounted projection instance in the open-surfaces index. See `OpenSurfaces`. */
export interface OpenSurface {
  /** The mounted node's stable id, when it has one (id-less root / window mounts omit it). */
  surfaceId?: string
  /** The projection subtype the surface mounts. */
  projection: string
  /** What the surface addresses (empty = content-less). */
  contents: OpenContent[]
  /** CONTAINER-declared: a preview / peek / transient tab. */
  transient?: boolean
  /** Which window the surface lives in (per-composition aggregation). */
  windowId: string
}

// `EngineReadResult` and `SubscriptionEvent` are the host-served engine edges.
// They are DOM-free and live in au-engine-sdk's `./wire` (imported above) — this
// module carries the projection entry's `HTMLElement`, which au-engine-sdk keeps out
// of its node-reachable surface.

/**
 * Engine readiness — notifies on the not-ready→ready edge (and ready→not-ready). A projection that
 * fetched at mount re-fetches when the daemon becomes ready later. Backed by the engine's `ready`
 * lifecycle channel; a contract member so a projection never mirrors a host-local readiness standin.
 */
export interface EngineReadiness {
  /** Notify on readiness CHANGE. Returns unsubscribe. */
  subscribe(listener: (ready: boolean) => void): () => void
}

/**
 * A wide-effect-operation confirmation, shown by the host `ConfirmSurface` before a caller commits.
 *
 */
export interface ConfirmRequest {
  /** Heading, e.g. "Rename file" / "Delete file" / "Move file". */
  title: string
  /** The blast-radius sentence, e.g. "Renaming X will update 3 references." */
  message: string
  /** Danger tone (delete): the affected references will BREAK, not move. */
  danger?: boolean
  /**
   * Absolute paths of the affected files (inbound referrers). Rendered as a cmd+hover-able list.
   *
   * THREE STATES, each meaning exactly one thing — the dialog must never assert a blast radius it
   * did not measure:
   * - a non-empty array: these files reference the target.
   * - an EMPTY array: the caller LOOKED and found none. Only then does the dialog say so.
   * - `undefined`: the caller could not determine them, or the question does not apply. Pass
   *   `unavailable` to say which.
   */
  affected?: string[]
  /**
   * Why `affected` could not be determined, in the CALLER's words (e.g. "the engine is not ready").
   * Rendered in place of the blast radius, so an unmeasurable radius is stated rather than silently
   * read as an empty one. The reason belongs to the caller because only it knows what it asked;
   * the surface is generic and must not name the engine.
   *
   * Only meaningful with `affected: undefined`. Leaving BOTH unset is the "this dialog is a plain
   * gate, there is no blast radius to report" case, and renders nothing.
   */
  unavailable?: string
  /** Peek content for an affected row (the caller's `makeHoverContent(...).previewPath`). */
  previewContent?: LinkResolver
  /** An input field (rename's new name). `value` pre-fills it; the basename is pre-selected. */
  input?: { value: string }
  /** The confirm button label, e.g. "Rename" / "Delete" / "Move". */
  confirmLabel: string
}

/** The user's decision from a `ConfirmSurface.confirm`. `value` is the input on confirm. */
export interface ConfirmOutcome {
  confirmed: boolean
  value?: string
}

/**
 * The host CONFIRM SURFACE: a per-window modal that previews a wide-effect file operation's blast
 * radius before the caller commits. Resolves the user's decision; performs no mutation itself.
 */
export interface ConfirmSurface {
  confirm(request: ConfirmRequest): Promise<ConfirmOutcome>
}

/** One option in a `ChooserSurface.choose` menu. `id` is caller-defined and opaque to the host. */
export interface ChooseOption {
  /** Returned to the caller when this option is picked; the caller maps it to an action. */
  id: string
  /** The row's primary text. */
  label: string
  /** An optional muted second line (e.g. what the option resolves to). */
  hint?: string
  /** An optional SECTION this option belongs to. Consecutive options sharing a section render under one
   *  header (e.g. the wrap picker's "Stack" / "Arrange" families); a header is drawn each time the section
   *  changes down the list. Purely presentational — headers are never selectable, so keyboard nav skips
   *  them. Absent on every option → a flat list, unchanged. Order options so a section is contiguous. */
  section?: string
  /** An optional on-screen ANCHOR: a `data-pane-id` naming the pane this option corresponds to. When ANY
   *  option carries one, the chooser renders SPATIALLY — a selectable target drawn over each anchored
   *  pane's live rect (hover-border + click, a letter-hint, arrow-key spatial nav) — instead of the
   *  list. An option WITHOUT an anchor still appears (as a list row in the spatial mode's fallback panel),
   *  so an off-screen candidate is never dropped. The pane id resolves to a rect at open time via
   *  `getBoundingClientRect`; no rect is ever stored. Absent on every option → the plain list, unchanged.
   *   */
  anchor?: string
}

/** A request to resolve an ambiguous decision by asking. See `ChooserSurface`. */
export interface ChooseRequest {
  /** Optional heading, e.g. "Open report.yaml with". */
  title?: string
  /** The options to choose between. A caller invokes the chooser only for a GENUINE choice (>=2). */
  options: ChooseOption[]
  /** Optional TRACE cause — the dispatch pass that opened this chooser (`currentCause()` before the await).
   *  When given, the chooser records its open/pick events under it, so the ask + the choice thread back to
   *  the gesture that started them (the async-cause bridge). Trace-only; never affects the decision. */
  cause?: number
}

/**
 * The host CHOOSER SURFACE: a per-window modal that resolves an ambiguous decision by asking,
 * instead of a silent default. When two or more options could resolve one decision and nothing
 * resolved it explicitly, the caller hands the options here; the user picks one (arrow-keys + Enter,
 * or a click; Escape cancels). Resolves the picked option's `id`, or `null` on cancel. Performs no
 * action — the host owns the MENU, the caller owns the ACTION.
 *
 */
export interface ChooserSurface {
  choose(request: ChooseRequest): Promise<string | null>
}

/**
 * Host → OS shell capability. App-global: absolute paths, no per-entry binding. A projection
 * reveals/opens a path in the OS (e.g. the file-tree's "open in Finder") or opens an external URL.
 */
export interface ShellControl {
  /** Reveal + select the path in the OS file manager. */
  showItemInFolder(path: string): Promise<void>
  /** Open the path with its default handler (a folder opens in the file manager). */
  openPath(path: string): Promise<string>
  /** Open an external URL in the default browser (guarded to http/https in main). */
  openExternal(url: string): Promise<void>
}

/** One recently-opened composition within a workspace (recency overlay for the launcher). */
export interface RecentComposition {
  /** The composition instance's file path. */
  path: string
  /** Epoch ms of the last open. */
  lastOpened: number
}

/** One recently-opened workspace in the host's local, per-machine recents store. */
export interface RecentWorkspace {
  /** The folder-repo ENTRY — the key, the engine root, the compositions' scope (entry == root == home). */
  root: string
  /** Epoch ms of the last open. */
  lastOpened: number
  /** True when `root` no longer carries `.arsumbris/repo.yaml` — surfaced as stale, not hidden, so a
   *  workspace that stopped being a repo is visible rather than silently gone. */
  stale?: boolean
  /** This workspace's recent compositions (recency overlay for the launcher). */
  compositions?: RecentComposition[]
}

/** The host's local launcher RECENTS — the recently-opened workspaces (per-machine, non-git). A READ,
 *  so it rides `MountHost` (the contract tier). The rail's workspace switcher is its consumer. */
export interface RecentsControl {
  /** Recent workspaces, most-recent first, stale entries pruned. */
  listWorkspaces(): Promise<RecentWorkspace[]>
}

/**
 * The host's ENGINE-ASSET URL surface. Turns a `file*` reference to a binary asset stored in the engine
 * file tree (an image, a PDF, a font) into a URL a browser can load — an `<img>` src, a `THREE.TextureLoader`
 * source. A READ (reference → loadable URL, no mutation), so it rides `MountHost`, the contract tier.
 *
 * Reach for it whenever a projection must render the BYTES of an engine asset: `files.read` returns TEXT and
 * `engine.read` returns JSON, so neither serves a PNG. The host resolves the reference over its engine
 * connection (within-workspace only, so a `..`-escape or unknown name returns null) and serves the bytes on
 * a privileged origin. A URL, not bytes, so the browser caches and streams and nothing is base64'd across the
 * bridge.
 */
export interface AssetsControl {
  /**
   * Resolve a `file*` asset reference to a loadable URL. `fileRef` is a `file*` value: a `[[wikilink]]`
   * (e.g. `[[wall-stone::textures]]`) or a repo-relative path. Resolves to `null` — never throws — when the
   * reference does not resolve, is ambiguous, or the engine is not ready.
   */
  url(fileRef: string): Promise<string | null>
}

/**
 * The host's SCOPED COMPONENT-CSS injection. A projection using a shared component library (e.g. the
 * design-kit) hands the host that library's CSS rules plus its own mount root; the host injects them
 * wrapped in `@scope (root)`, so the rules apply only inside that projection and never leak onto sibling
 * panes. Distinct from a token-DECLARATION sheet (`--au-*` values), which is document-level by design.
 */
export interface HostStyles {
  /**
   * Inject `css` scoped to `root` (a managed `<style>` the host owns). Returns a disposer that removes
   * it — call it on unmount. The css applies only inside `root`; a raw global `<style>` would leak.
   */
  inject(css: string, root: HTMLElement): () => void
}

/** The capability surface a projection receives at mount. */
export interface ProjectionReloadStatus {
  watching: boolean
  busy: boolean
  error?: string
}

export interface ProjectionReload {
  status(paneId: string): ProjectionReloadStatus | undefined
  reload(paneId: string): Promise<void>
  setWatching(paneId: string, enabled: boolean): void
}

export interface MountHost {
  /** Targeted projection development, scoped to this window's mounted panes. */
  projections?: ProjectionReload
  /** The contract version the host speaks. */
  contractVersion: number
  /**
 * The folder-repo entry this host and daemon are bound to. Matches the engine SDK's
 * entryPath and probeReady(entry). workspace.members describes the content topology beneath it.
 */
  entry: { path: string }
  /**
   * The config the host mounted this projection with, if any. Under model B a
   * projection's config IS its instance (a typed `projection` subtype instance);
   * the host forwards it opaquely. Absent when the host mounts with no config.
   */
  config?: OpaqueConfig
  /**
   * Persist this projection's own config up to wherever the host placed it. The
   * root writes the active composition; a nested node routes through its parent's
   * `onChildConfigChange` (see `children.mount`), so a save bubbles to the composition
   * at any depth. This is the model-B config round-trip.
   */
  saveConfig(next: OpaqueConfig): void
  /**
   * Register to hear this projection's OWN config (its pool record) change — the INBOUND
   * mirror of `saveConfig` (which pushes a change OUT). The host delivers the fresh config
   * whenever this pane's record changes, whether from this projection's own `saveConfig` or
   * an EXTERNAL write (a container swapping the pane's content — a preview-swap opening a new
   * file). Returns a disposer; the host also disposes it on unmount.
   *
   * REGISTERING IS THE OPT-IN to reflect-in-place. A projection that registers reflects a
   * content change WITHOUT a remount (the host keys its remount digest to identity only, so a
   * content change no longer tears it down); one that does NOT register is remounted on a
   * content change (the safe fallback — no silent staleness). Remount then means one thing for
   * everyone: the record became a different projection TYPE.
   *
   * The handler MUST be IDEMPOTENT — it may receive its own echo (a self-`saveConfig`), so it no-ops
   * when nothing it cares about actually changed. It is ALL-OR-NOTHING over content: once a projection
   * registers, the host NEVER remounts it on a content change (only on a type change), so the handler
   * must reflect EVERY content field it cares about, including its `file` / identity fields — a handler
   * that reflects one field but ignores `file` would silently show the stale file. It owns any
   * per-content view-state on an in-place change (an editor saves the old file's cursor/scroll and
   * restores the new one's).
   *
   * OPTIONAL: a host that predates it, or one with no pool (a detached window), omits it — so a
   * projection GUARDS the call (`host.onOwnConfigChange?.(cb)`), and an absent capability is
   * simply the remount fallback. Additive + optional → no `MOUNT_CONTRACT_VERSION` bump. NOT to
   * be confused with `children.mount`'s `onChildConfigChange` (a mounted CHILD's config bubbling
   * UP to its parent) — opposite direction, whose config the name says.
   */
  onOwnConfigChange?(cb: (config: OpaqueConfig) => void): () => void
  /**
   * File read/write over the entry, bound by the host. Fully engine-backed; a
   * projection never opens its own fs. See `FilesControl`.
   */
  files: FilesControl
  /**
   * The workspace's members, so a projection can be multi-root: each member is a
   * content root. The host is not one entry — content is spread across members.
   * Backed by the engine `members` read.
   *
   * READ-ONLY, deliberately. Mutating membership is `workspaceEdit` on the app-owned
   * `HostApp` tier (`@arsumbris/au-host-app`) — the read/mutate split this contract keeps
   * throughout, its sibling being `engine.readIgnores` (here) versus `scope` (there).
   */
  workspace: {
    members: WorkspaceMember[]
    /**
     * Ask the user to choose a directory; resolves to its absolute path, or `null` if
     * they cancel. OPTIONAL — a host without a native shell omits it, so always guard.
     *
     * ON THE CONTRACT, not the app tier, because it REPORTS rather than acts: it opens a
     * dialog and returns a string, changing nothing by itself. Any projection may
     * legitimately need "let the user point at a folder" — an exporter choosing a
     * destination, an importer choosing a source — and a capability a first-party
     * projection needs that a third party cannot reach is a framework gap, not a licence.
     *
     * Additive + optional, so `MOUNT_CONTRACT_VERSION` is unchanged.
     */
    pickFolder?: () => Promise<string | null>
  }
  /**
   * A tree-scoped, payload-opaque selection channel bound to this projection's
   * node. The higher-level surface above `viewState`; see `SelectionChannel`.
   */
  selection: SelectionChannel
  /**
   * A tree-scoped COMMAND channel: fire typed intents, declare capabilities, the
   * host routes to the focused capable handler. Payload-opaque; see `IntentChannel`.
   */
  intent: IntentChannel
  /**
   * A tree-scoped focus channel: report the active view, the host tracks the active
   * container per scope and feeds intent routing. See `FocusChannel`.
   */
  focus: FocusChannel
  /**
   * A tree-scoped CLOSE-GUARD channel: register a guard the host consults before removing
   * this node. The projection owns the veto decision (save / discard / cancel); the host owns
   * the removal. Optional, so a host that does not run the removal lifecycle omits it; a
   * projection guards `host.closeGuard?.register(...)`. See `CloseGuardChannel`.
   */
  closeGuard?: CloseGuardChannel
  /**
   * A per-instance restorable view-state slot, persisted locally outside the
   * git-tracked config. Keyed by composition + `instanceId` + sub-key. See `ViewStore`.
   */
  viewStore: ViewStore
  /**
   * This instance's STABLE id (its pane's `^:` node id) — the key the host uses for
   * `viewStore` and the terminal session. A projection that must survive its own remount
   * (e.g. a terminal keeping its live session across a layout reshuffle) caches by this.
   * Stable across remounts, distinct per pane. Absent for an id-less mount.
   */
  instanceId?: string
  /**
   * A host-owned pty capability scoped to this instance. The session survives a remount
   * (detach + reattach), keyed per-pane like `viewStore`. See `TerminalChannel`.
   */
  terminal: TerminalChannel
  /**
   * The device-local terminal presentation config, the settings sibling of `terminal`. OPTIONAL +
   * additive (no contract bump); guard it (`host.terminalPreferences?.get()`). A terminal projection
   * renders against it, so it rides the contract, not the app-owned tier. See `TerminalPreferencesControl`.
   */
  terminalPreferences?: TerminalPreferencesControl
  /**
   * The chrome contributions targeting a `role` (a projection KIND), discovered by the host
   * from projection meta and read LIVE — reflects projections discovered after this mounted.
   * The host only ANSWERS the query (candidates); it never places them. A container surfaces
   * not-yet-added candidates and writes config on accept. See `ChromeContribution`.
   */
  listContributions(role: string): ChromeContribution[]
  /**
   * The mountable projection TYPE NAMES the host has discovered, read LIVE — a container's
   * mount-picker options, reflecting projections discovered after it mounted.
   */
  listProjections(): string[]
  /**
   * The discovered projections WITH their kind closure and owning repo — the same live set
   * `listProjections()` names, described rather than merely listed. See `ProjectionDescriptor`.
   *
   * OPTIONAL because it is additive to an already-shipped contract, so it costs no
   * `MOUNT_CONTRACT_VERSION` bump: a host that predates it does not offer it, and a caller falls
   * back to `listProjections()`. Guard it — `host.describeProjections?.()`.
   *
   * Reach for this over `listProjections()` whenever the answer depends on WHAT a projection is
   * rather than only on its name: grouping a picker into containers and panes, filtering to what can
   * fill a slot, or resolving a kind without a second query per kind.
   */
  describeProjections?(): ProjectionDescriptor[]
  /**
   * The composition's VIEWER-DEFAULTS: per file kind, which viewer opens it by default. Each entry is
   * `{ opens, viewer }` — a bare extension (no dot) or `*`, mapped to a BARE viewer type name (the host
   * bares the def-ref value). A container realizing a file open resolves the viewer through the ladder
   * (`resolveViewer`, container-core): the firer's `open-intent.with`, then THIS default, then the sole
   * eligible viewer, else a must-pick the host surfaces as a picker. `opens-meta` declares only
   * ELIGIBILITY; this field is the composition-scoped DECISION.

   *
   * OPTIONAL, additive — no `MOUNT_CONTRACT_VERSION` bump. A composition with no `viewer-defaults` field
   * yields an empty list, so an ambiguous open falls to the picker. Guard it — `host.viewerDefaults?.()`.
   */
  viewerDefaults?(): { opens: string; viewer: string }[]
  /**
   * The composition's SLOT-DEFAULTS: the composition-wide default PLACEHOLDER type an EMPTY slot resolves
   * to, as a BARE type name (the host bares the def-ref value), or `undefined` when the composition
   * declares no `slot-defaults`. It is the composition-GLOBAL floor; a per-slot override rides the slot
   * itself (`ContainerSlot.placeholder`). The empty-slot driver reads `(slot.placeholder ?? this)` as the
   * `configured` rung of the ladder (configured > sole > ask).

   *
   * OPTIONAL, additive — no `MOUNT_CONTRACT_VERSION` bump. Guard it — `host.slotDefaults?.()`.
   */
  slotDefaults?(): string | undefined
  /**
   * Subscribe to DISCOVERY changes: the listener fires whenever the discovered projection /
   * contribution set changes (a projection package added or removed while mounted). A container
   * re-queries `listContributions` / `listProjections` and re-renders. Returns an unsubscribe.
   * This is what makes those queries genuinely LIVE rather than a mount-time snapshot.
   */
  subscribeContributions(listener: () => void): () => void
  /**
   * The host's ephemeral preview overlay surface, a per-window singleton. See `PreviewSurface`.
   */
  preview: PreviewSurface
  /**
   * The host's OVERLAY SITE: a place to draw above the composition, for what a pane cannot contain.
   *
   * Reach for it when your content must escape your own mount container — a layer drawn ACROSS
   * separately-mounted projection roots, or a popup an ancestor's `overflow` would clip. Do NOT
   * reach for `document.body`; that is the missing-site-kind tell, and this is the site.
   *
   * OPTIONAL + additive, so no contract bump. Guard it — `host.overlay?.claim()`.
   * See `OverlaySite`.
   */
  overlay?: OverlaySite
  /**
   * OPEN SURFACES — the host-owned live index of what is mounted and what each surface addresses. A
   * projection DECLARES its content via `setContent`; any consumer READS `list` / `find` / `subscribe`.
   * The host interprets no payload; it matches by the caller-supplied identity string.
   *
   * OPTIONAL + additive, so no contract bump. Guard it — `host.openSurfaces?.setContent(...)`.
   * See `OpenSurfaces`.
   */
  openSurfaces?: OpenSurfaces
  /**
   * The host's right-click MENU. Hand it rows; it owns placement, keyboard, dismissal and nesting.
   *
   * Reach for it instead of building a popup: a hand-rolled one has to escape its pane to avoid
   * being clipped, which means `document.body`, which is the missing-site-kind tell.
   *
   * OPTIONAL + additive, so no contract bump. Guard it — `host.contextMenu?.open(...)`.
   * See `ContextMenuSurface`.
   */
  contextMenu?: ContextMenuSurface
  /**
   * The host's INTERACTIVE anchored POPOVER — a floating panel you FILL with content, anchored to a
   * trigger rect. It holds focusable controls (an input, a select), unlike `contextMenu`'s rows, and
   * stays put until dismissed, unlike `preview`'s hover peek. The host owns anchoring + dismissal;
   * you supply `fill`.
   *
   * Reach for it instead of an inline `position:absolute` popup: an inline one is clipped by an
   * ancestor's `overflow` / stacking context, which is the missing-site-kind tell.
   *
   * OPTIONAL + additive, so no contract bump. Guard it — `host.popover?.open(...)`. See `PopoverSurface`.
   */
  popover?: PopoverSurface
  /**
   * The app-global, per-machine theme override layer. OPTIONAL: a host that predates
   * this surface omits it, so a consumer guards (`host.theme?.save(...)`). See `ThemeControl`.
   */
  theme?: ThemeControl
  /**
   * The host's TOKEN REGISTRATION report — which declared `--au-*` tokens the browser refused.
   *
   * ADDITIVE + OPTIONAL, so no contract bump. Published because a rejected token is INVISIBLE to a
   * projection by construction: the rule is dropped at parse time, so it never appears in the CSSOM
   * and a token surface lists it as neither broken nor present, just absent. Only the host, which
   * loads the sheets and holds their source text, can see the difference — so it detects, and a
   * projection RENDERS. See `TokenDiagnostics`.
   */
  tokens?: TokenDiagnostics
  /**
   * The app-global, per-machine component-set selection layer. OPTIONAL (like `theme`): a host that
   * predates it omits it, so a consumer guards (`host.components?.setActiveSet(...)`). See
   * `ComponentSetControl`.
   */
  components?: ComponentSetControl
  /**
   * The host's local launcher RECENTS — the recently-opened workspaces. OPTIONAL + additive, so no
   * contract bump. Guard it — `host.recents?.listWorkspaces()`. See `RecentsControl`.
   */
  recents?: RecentsControl
  /**
   * Engine FILE ASSETS as loadable URLs — a `file*` reference to a binary asset (image, PDF) turned into a
   * browser-loadable URL. OPTIONAL + additive, so no contract bump. Guard it — `host.assets?.url(ref)`. See
   * `AssetsControl`.
   */
  assets?: AssetsControl
  /**
   * Inject a projection's COMPONENT CSS — the styling rules for a shared component library (e.g. the
   * design-kit), distinct from its `--au-*` token VALUES — scoped to the projection's own mount root, so
   * the rules apply only inside it and never leak onto sibling panes. The host wraps the CSS in
   * `@scope (root)` and owns the `<style>` lifecycle; the returned disposer removes it. A projection uses
   * this instead of a raw global `<style>`. OPTIONAL + additive, no contract bump. Guard it —
   * `host.styles?.inject(css, root)`. See `HostStyles`.
   */
  styles?: HostStyles
  engine: {
    read(request: ReadRequest): Promise<EngineReadResult>
    /**
     * Open a subscription. Returns an unsubscribe function.
     * Change events carry no state; re-issue the paired read.
     */
    subscribe(request: SubscribeRequest, onEvent: (event: SubscriptionEvent) => void): () => void
  }
  /**
   * Mount child projections inside this one. Composition is brokered: a
   * projection never loads another itself, it asks the host here.

   */
  children: {
    /**
     * Mount a child projection into a slot this projection owns.
     * The host resolves `id` via discovery, runs the loader, mints the child's
     * `MountHost`, and mounts the surface named by the child type's locator
     * (`projection-runtime-meta.export`, default `mount`).
     * Resolves to a handle. The host cascades: when this projection unmounts, its
     * children unmount too. Rejects with a readable error if `id` does not
     * resolve. The slot is a DOM sub-container in-renderer; a cross-window
     * slot type is reserved for the detach verb.
     *
     * `config` is the sub-config the child reads as its own `host.config`.
     * `onChildConfigChange` receives the child's own `saveConfig` writes, so this
     * parent can place them back in its config and re-save up the tree. (The inbound
     * mirror on the OTHER side — a projection hearing its OWN record change — is
     * `host.onOwnConfigChange`; the names say whose config, opposite directions.)
     * There is no `view` param: which surface a child mounts is intrinsic to the
     * child's TYPE (resolved from its locator's `export`), not chosen by the parent.
     */
    mount(
      slot: HTMLElement,
      child: { id: string; config?: OpaqueConfig; onChildConfigChange?: (next: OpaqueConfig) => void },
    ): Promise<ChildHandle>
    /**
     * THE COMPOSITION POOL (additive; a host that predates it omits these — guard).
     *
     * A composition is a flat POOL of projection records; a container names its children by
     * REFERENCE (a record id), never by embedding. These let a container manage the pool records for
     * the children it references, so the HOST stays the single writer and no parent ever holds or
     * re-serializes a child's config.

     */
    pool?: {
      /**
       * Resolve a child's record FRESH from the authoritative pool by its `^:` id. A container reads
       * this at MOUNT time rather than caching the child's config, so a restructure re-mounts from the
       * current record and can never resurrect a stale copy (the re-parent duplication class). Returns
       * `undefined` for an id the pool does not hold (a dangling reference).
       */
      resolveRecord(id: string): OpaqueConfig | undefined
      /**
       * BOUNDED new-content mint. Add a NEW record to the pool (a pane a container just created for
       * FRESH content) and return its host-assigned `^:` id. The container references the child by
       * that id and saves the reference through its OWN `saveConfig` (own-record, host-pruned) — the
       * bounded channel, the new-content twin of `setSlotContent`. The id is host-assigned and the
       * record fresh, so this cannot clobber an existing record. For a STRUCTURAL gesture (a drop /
       * wrap that proposes a batch), use `stageRecord` instead — it writes nothing until the host
       * applies the batch.

       *
       * `{ transient: true }` mints a LIVE-BUT-UNPERSISTED record (a preview / peek tab): pooled + routed
       * like any other (its edge links it, so intent / focus / selection reach it), but `serializePoolToComposition`
       * drops it AND strips inbound refs, so it never reaches disk. Site-agnostic. See `CompositionPool.transient`.
       */
      createRecord(record: OpaqueConfig, opts?: { transient?: boolean }): string
      /**
       * STRUCTURAL-channel mint: DRAW a final `^:` id for a new record and return it plus the record
       * edit to fold into a `propose` batch. Writes NOTHING — the record lands only when the host
       * applies the batch, so a refused proposal leaves no orphan. The structural twin of
       * `createRecord`.
       */
      stageRecord(record: OpaqueConfig): { rootId: string; edits: ReadonlyArray<{ id: string; record: OpaqueConfig }> }
      /** Remove a record from the pool (a closed pane). A move is a re-point (drop the reference), not
       *  a remove; only a close deletes the record. */
      removeRecord(id: string): void
      /**
       * Ensure a child mounted INLINE becomes a first-class pool record, keyed by `id`. A no-op if the
       * pool already holds `id`. This is how a freshly-CREATED pane (a container's picker mints a local
       * id and inline content, not a pool record) — and a legacy container embedded inline by a
       * pre-pool wrap — get pooled: called at every child mount, so the whole tree pools itself on the
       * mount pass. Refs stay consistent by construction, because the child pools under the SAME id its
       * parent already references. Without pooling, such a child has no `^:`, so it cannot be re-parented
       * (its container's `recordId()` is empty) and its reference dangles on reload.
       */
      ensureRecord(id: string, config: OpaqueConfig): void
      /**
       * BOUNDED new-content GROUP mint. Mint a synthesized GROUP record (a container built around
       * fresh content) and return its host-assigned `^:` id — the container then references it and
       * saves through its own `saveConfig`. The group instance embeds its children carrying their
       * existing `^:` ids; the host FLATTENS it into the pool — the group record REFERENCES the
       * children (`[[^^id]]`), an already-present child is NOT overwritten by the embedded snapshot,
       * so no nesting is reintroduced. For a STRUCTURAL gesture use `stageGroup` instead.
       */
      createGroup(groupInstance: OpaqueConfig): string
      /**
       * STRUCTURAL-channel GROUP mint: DRAW a final `^:` id for the synthesized group and return it
       * plus the flattened record edits (only the genuinely NEW records — an already-present child
       * keeps its authoritative record and is referenced by id). Writes NOTHING; the records land when
       * the host applies the `propose` batch. The structural twin of `createGroup`.
       */
      stageGroup(groupInstance: OpaqueConfig): { rootId: string; edits: ReadonlyArray<{ id: string; record: OpaqueConfig }> }
      /**
       * Apply a batch of pool record edits ATOMICALLY: merge each record by its `^:` id, then persist
       * ONCE and re-derive the mount tree ONCE ("one commit, one re-render"). A structural gesture
       * (re-parent / wrap / close) hands the host the affected containers' OWN new records; the host
       * litigates over the flat pool and the tree re-derives, so a move is a single reference re-point
       * — never an in-place mutation of a container's live runtime tree (the re-parent duplication +
       * `removeChild` crash class). After applying, any record no longer reachable from `root` is
       * REAPED: a CLOSE is an extract whose reference nobody re-adds, so its record is orphaned and
       * dropped; a MOVE keeps the record, because the target now references it.

       */
      applyStructural(edits: ReadonlyArray<{ id: string; record: OpaqueConfig }>): void
      /**
       * PROPOSE a batch of pool edits to the host — the substrate's write channel.
       * A container BUILDS the edits (pure) and ASKS; the HOST validates and applies (or refuses). The
       * container does not write the pool itself — the write (`applyStructural`) is the host's. Additive;
       * a host that predates it omits it (guard: fall back to `applyStructural` when absent).

       */
      propose?(edits: ReadonlyArray<{ id: string; record: OpaqueConfig }>): void
      /**
 * Float a pooled occupant into its own OS window. The source container passes its post-extraction
 * record as sourceEdit. The host creates a window record referencing the occupant and commits both
 * edits atomically. The occupant keeps its id, terminal and view-state as the host mounts it on the
 * new OS surface. Guard this optional capability before use.
 */
      float?(occupantId: string, sourceEdit: { id: string; record: OpaqueConfig }, options?: WindowOptions): void
      /**
       * MOVE a pooled subtree to ANOTHER open window — the unified cross-window MOVE, generalizing `float`
       * ("open in a NEW window") to "move into an EXISTING window". The host shows the target-window picker
       * IN THIS window (the invoking one), then re-parents the subtree: extract it from its source (a nested
       * container via `poolEdit.extractEdit`, computed here; a window's whole content via a root splice) and
       * inject it into the picked window (a MAIN target takes the dock placement — clean-inverse or a spatial
       * leaf pick; a SECONDARY target root-wraps), committed as ONE atomic edit, then both surfaces re-drive.
       * The subtree keeps its `^:` (terminal / view-state / identity follow). A secondary source emptied by
       * the move auto-closes. Symmetric over any (source, target) pair — secondary→secondary never involves
       * the main window. `dock` is the special case (move a floated window's content to main). Additive; a
       * host that predates it omits it (guard).

       */
      moveToWindow?(subtreeId: string): void
      /** Whether ANOTHER window exists to move a subtree into — gates the "Move to other window" affordance,
       *  so it is hidden when there is nowhere to move to. The main window reports `roots.length >= 2`; a
       *  secondary window always reports true (main + itself). Additive (guard). */
      otherWindowsExist?(): boolean
      /**
       * SUBSCRIBE to structural/set pool changes (additive; a host that predates it omits this — guard).
       * Fired COALESCED (once per gesture), NOT for a plain dialect save (a resize). A container uses this
       * to RE-SEED its local model from its authoritative record when the SUBSTRATE changed it — a drag
       * re-parent, a `closePane`, a `wrapPane` write the container's record via `applyStructural` WITHOUT
       * going through the container's own commit, so its rendered anchors would otherwise go stale. The
       * container re-reads `resolveRecord(host.instanceId)` on each event and re-renders (never remounts);
       * `useContainerModel` does this for a container that uses it. Returns an unsubscribe.
       */
      subscribe?(listener: () => void): () => void
    }
    /**
     * THE PUBLISHER ↔ NODE-ID BRIDGE (additive; a host that predates the portal omits these — guard).
     *
     * Maps a mounted node's `PublisherId` (minted per mount, the identity the intent/focus/selection
     * channels speak) to its STABLE `^:` pool id, and back. Under the PORTAL layer a container no
     * longer mounts its own children (each pane is a flat top-level `PaneHost`), so it can no longer
     * learn a child's publisher from a mount callback. These give it back the mapping it needs:
     * `nodeIdOf(from)` turns an intent's firer publisher into the pane's `^:` (to decide where to open),
     * and `publisherOf(childId)` turns a pane's `^:` into the publisher to report as focused. Both are
     * direct lookups over the runtime's live node set; `undefined` for an id not currently mounted.
     *
     */
    nodeIdOf?(publisher: PublisherId): string | undefined
    publisherOf?(nodeId: string): PublisherId | undefined
    /**
     * WHERE a node is DEFINED (additive; a host that predates it omits this — guard). Maps a publisher
     * to its `NodeLocation` — projection type, authored `^:` id, and composition source file. Backed by a
     * runtime registry populated at mount and RETAINED past unmount, so an actor that mounted earlier this
     * session stays locatable even after it unmounts or its composition is switched away (`mounted:false`).
     * `undefined` only for a publisher this runtime never mounted (e.g. a node from another window — a
     * cross-window merge is a separate effort). An introspection surface uses this to show "what is this
     * chip and where does it come from", and to navigate to the composition source. See `NodeLocation`.
     */
    locate?(publisher: PublisherId): NodeLocation | undefined
    /**
     * Whether the host is running the PORTAL layer (additive; absent → false). When true, a container
     * renders an empty ANCHOR (a `usePaneAnchor(childId)` div) at each child position instead of
     * mounting the child itself: every pane is mounted ONCE as a flat top-level host and portaled into
     * its current anchor, so a re-parent never unmounts the pane (a running terminal / cursor survives,
     * and React can never `removeChild` the pane's live DOM). Set once before the root mounts, stable
     * for a container's lifetime. The shared `PaneProjection` / `mountChild` read it — a container using
     * them needs no change; one that hand-mounts children honours it itself.
     */
    portalActive?(): boolean
  }
  /**
   * Ephemeral view-state, host-brokered. Linked viewports live here. A
   * per-publisher awareness model: publish slices under your own identity,
   * follow one publisher's slice. Never persisted, never sent to the engine.
   *
   */
  viewState: {
    /**
     * Publish a slice of this projection's view-state under its own identity.
     * Retained last-value, schema-agnostic. Dropped when this projection unmounts.
     */
    publish(slice: string, value: unknown): void
    /**
     * Follow one publisher's slice: the current value if present, then each
     * update. The host ends the follow when the publisher unmounts. Returns
     * unsubscribe.
     */
    follow(publisher: PublisherId, slice: string, onValue: (value: unknown) => void): () => void
    /**
     * Watch a slice across ALL publishers (the follow-all complement to follow-one): the current
     * value of every publisher that has the slice, then each publish to it from any publisher. A
     * publisher's value arrives as `undefined` when it DROPS the slice (unmounts) so a watcher can
     * forget it. Use when you don't know the publisher id up front — e.g. a status item showing the
     * most-recently-active editor's cursor.
     */
    watchAll(slice: string, onValue: (publisher: PublisherId, value: unknown) => void): () => void
  }
  /**
   * Engine-readiness edge: notifies on the not-ready→ready transition, so a projection that
   * fetched at mount re-fetches when the daemon starts later. OPTIONAL (like `theme`): a host that
   * predates this surface omits it, so a consumer guards (`host.engineReady?.subscribe(...)`).
   * See `EngineReadiness`.
   */
  engineReady?: EngineReadiness
  /**
   * The host's wide-effect-operation confirm surface (a per-window modal). A caller previews a file
   * op's blast radius before committing; the host resolves the user's decision. OPTIONAL; guard.
   * See `ConfirmSurface`.
   */
  confirm?: ConfirmSurface
  /**
   * The host's CHOOSER surface (a per-window modal). When two or more options could resolve one
   * decision and nothing resolved it explicitly, a caller surfaces a menu instead of picking a
   * silent default; the host resolves the user's pick, the caller acts on it. OPTIONAL; guard.
   * See `ChooserSurface`.
   */
  chooser?: ChooserSurface
  /**
   * Host → OS shell: reveal/open a path or open an external URL. App-global (absolute paths).
   * OPTIONAL; guard. See `ShellControl`.
   */
  shell?: ShellControl
  /**
   * True when this projection is the ROOT of a detached window. A window-root relays its FULL live
   * layout (incl. ephemeral state like preview tabs) on dock-back; an in-window root relays only the
   * persistable layout. Absent (falsy) for a non-detached-root mount.
   */
  windowRoot?: boolean
}

/** A host-minted, opaque, per-mount-instance identity. Do not construct or parse. */
export type PublisherId = string

/** A handle to a mounted child projection. */
export interface ChildHandle {
  /** The mounted child's publisher identity, for wiring view-state links. */
  readonly publisher: PublisherId
  /** Tear this child out. Idempotent. The host also runs this on parent unmount. */
  unmount(): void
}

/**
 * WHERE a mounted node is DEFINED — its projection type, its authored `^:` pool id, and the composition
 * source file it lives in — resolved from a publisher id by `children.locate`. The definition-site an
 * introspection surface (the trace inspector) shows on an actor chip: "what is this and where does it
 * come from". Distinct from `nodeIdOf`, which returns only the live pool id and only while mounted.
 */
export interface NodeLocation {
  /** The projection TYPE name (may carry a `::repo` qualifier). Undefined for a host-owned / typeless node. */
  type: string | undefined
  /** The node's authored `^:` pool id. `''` for the root or an id-less mount. */
  nodeId: string
  /** The composition source file the node was authored in (absolute path), captured at mount. Undefined
   *  when the runtime owns no composition path (a detached-window runtime, an id-less mount). */
  compositionFile: string | undefined
  /** Whether the node is CURRENTLY mounted. `false` = it mounted earlier this session and has since
   *  unmounted — the site is still known (retained), so it stays locatable-to-source. */
  mounted: boolean
}

/**
 * How a windowed child's OS window opens. Kept minimal in the contract; the
 * host may interpret more, but this should not balloon into a full window API.
 */
export interface WindowOptions {
  /** Window title for the host UI. */
  title?: string
  /** Initial window bounds; the host decides defaults for omitted fields. */
  bounds?: { x?: number; y?: number; width?: number; height?: number }
}

/** A single surface's mount function: render into `container`, return the unmount function. */
export type MountFn = (container: HTMLElement, host: MountHost) => () => void

/**
 * The loose LOADED-module shape: a bag of exports the host indexes by the locator's `export` name. A
 * projection's mountable surfaces are NAMED EXPORTS, each a `MountFn`; a single-surface projection exports
 * one `mount`, a multi-surface component several (e.g. `pane`, `status`) sharing the module and its
 * module-level state. A surface's type-def locator (`projection-runtime-meta.export`, default `mount`)
 * names which export to mount. No surface is privileged. Distinct from the AUTHOR CONTRACT below
 * (`ProjectionModule` / `GroupingContainerModule`), which types what a SPECIFIC module must export.
 *
 */
export type LoadedModule = Record<string, unknown>

/** A child handed to a grouping container's `buildGroup`: its stable pool id + its instance config. */
export interface GroupChild { id: string; instance: unknown }

/**
 * A grouping container's `buildGroup` export: mint an instance of the container's OWN config (`Self`)
 * holding the children, each child's `id` landing as its `^:`. Parametrized over the config type codegen
 * emits, so `buildGroup` cannot return a malformed instance of its own container.
 */
export type GroupBuildFn<Self> = (children: GroupChild[]) => Self

/**
 * The author-facing CODE CONTRACT for a projection module: it exports `mount`. A concrete projection types
 * its module against a subtype of this through `defineProjection`, so a missing / wrong-signature export is
 * a COMPILE error rather than a mount-time crash. This code contract is owned by au-host-sdk.
 */
export interface ProjectionModule { mount: MountFn }

/** The code contract for a `grouping-container` module: `mount` plus `buildGroup` returning its own config. */
export interface GroupingContainerModule<Self> extends ProjectionModule {
  buildGroup: GroupBuildFn<Self>
}

/** Brand marking a module object REGISTERED through `defineProjection`. Non-enumerable, so it is never
 *  seen as an export the loader would try to mount. */
const DEFINED_PROJECTION = Symbol.for('au.host.definedProjection')

/**
 * The mandatory typed registration seam. A projection's entry is `export default defineProjection<M>({...})`;
 * typing `M` (e.g. `GroupingContainerModule<Tabs>`) makes a missing / wrong-signature export a COMPILE error
 * at a call the module cannot skip and still be loadable. The loader accepts only branded results, so the
 * contract check rides a required step — this (not the passive interface) is what closes the class where a
 * module satisfied the meta but not the code and crashed at mount. Returns `m` unchanged (plus the brand).
 */
export function defineProjection<M extends object>(m: M): M {
  Object.defineProperty(m, DEFINED_PROJECTION, { value: true, enumerable: false })
  return m
}

/** Whether `x` was registered through `defineProjection` (the loader's registration gate). */
export function isDefinedProjection(x: unknown): boolean {
  return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[DEFINED_PROJECTION] === true
}

// --- RPC-shaped MountHost ---------------------------------------------------

// MountHost survives a window / process boundary. Function references do not
// cross it, so the engine surface is a protocol, not a bag of closures. One
// projection-side adapter (`createMountHost`) re-presents a transport as a
// `MountHost` whose `engine` API is unchanged. The transport varies by where
// the projection runs (a direct in-process channel in the host's renderer, an
// Electron bridge for a detached window); the adapter does not. There is no
// by-reference fast path.

/** A message from a projection to the host's broker. */
export type ProjectionToHost =
  | { kind: 'read'; id: number; request: ReadRequest }
  | { kind: 'subscribe'; channel: number; request: SubscribeRequest }
  | { kind: 'unsubscribe'; channel: number }

/** A message from the host's broker back to a projection. */
export type HostToProjection =
  | { kind: 'read-result'; id: number; result: EngineReadResult }
  | { kind: 'event'; channel: number; event: SubscriptionEvent }

/**
 * A bidirectional message channel between a projection and the host's broker.
 * The host implements one per location; the adapter below never knows which.
 * `send` is fire-and-forget; replies arrive through the `receive` handler.
 */
export interface HostTransport {
  /** Send one protocol message to the broker. */
  send(message: ProjectionToHost): void
  /** Register the handler for messages the broker streams back. Returns a disposer. */
  receive(onMessage: (message: HostToProjection) => void): () => void
}

/** The host-supplied facts a `MountHost` carries beyond the engine surface. */
export interface MountHostInfo {
  contractVersion: number
  /** The entry this host is bound to. See `MountHost.entry`. */
  entry: { path: string }
  /** The config the host mounted this projection with, if any. Forwarded untouched. */
  config?: OpaqueConfig
  /** The config write-back, implemented by the host. Forwarded by the adapter. See `MountHost.saveConfig`. */
  saveConfig: MountHost['saveConfig']
  /** The inbound config subscription, implemented by the host (the per-pane handler registry). Forwarded
   *  untouched. OPTIONAL — a host with no pool omits it. See `MountHost.onOwnConfigChange`. */
  onOwnConfigChange?: MountHost['onOwnConfigChange']
  /** The file capability, implemented by the host (engine-backed). Forwarded by the adapter. See `MountHost.files`. */
  files: MountHost['files']
  /** The workspace member topology, supplied by the host (engine `members` read). See `MountHost.workspace`. */
  workspace: MountHost['workspace']
  /**
   * The composition surface, implemented by the host (the loader + the
   * registry-as-tree). The adapter forwards it untouched; this SDK owns the
   * type, not the logic. See `MountHost.children`.
   */
  children: MountHost['children']
  /**
   * The view-state bus, implemented by the host (the in-memory store + the
   * cross-window relay). Forwarded by the adapter. See `MountHost.viewState`.
   */
  viewState: MountHost['viewState']
  /**
   * The tree-scoped selection channel, implemented by the host (tree resolution
   * + bubbling). Forwarded by the adapter. See `MountHost.selection`.
   */
  selection: MountHost['selection']
  /**
   * The tree-scoped intent channel, implemented by the host (capability routing to
   * the focused handler). Forwarded by the adapter. See `MountHost.intent`.
   */
  intent: MountHost['intent']
  /**
   * The tree-scoped focus channel, implemented by the host (active-container
   * tracking). Forwarded by the adapter. See `MountHost.focus`.
   */
  focus: MountHost['focus']
  /**
   * The tree-scoped close-guard channel, implemented by the host (the removal lifecycle's
   * guard registry). OPTIONAL, forwarded by the adapter. See `MountHost.closeGuard`.
   */
  projections?: ProjectionReload
  closeGuard?: MountHost['closeGuard']
  /**
   * The per-instance restorable view-state slot, implemented by the host (the
   * keyed local store). Forwarded by the adapter. See `MountHost.viewStore`.
   */
  viewStore: MountHost['viewStore']
  /** This instance's stable id, supplied by the host. Forwarded untouched. See `MountHost.instanceId`. */
  instanceId?: MountHost['instanceId']
  /**
   * The host-owned pty terminal capability, scoped per instance by the host.
   * Forwarded by the adapter. See `MountHost.terminal`.
   */
  terminal: MountHost['terminal']
  /**
   * The chrome-contributions query, implemented by the host (meta discovery).
   * Forwarded by the adapter. See `MountHost.listContributions`.
   */
  listContributions: MountHost['listContributions']
  /**
   * The discovered-projections query, implemented by the host (type-system
   * discovery). Forwarded by the adapter. See `MountHost.listProjections`.
   */
  listProjections: MountHost['listProjections']
  /**
   * The described-projections query, implemented by the host. OPTIONAL, forwarded by the adapter.
   * See `MountHost.describeProjections`.
   */
  describeProjections?: MountHost['describeProjections']
  /**
   * The composition's viewer-defaults, implemented by the host. OPTIONAL, forwarded by the adapter.
   * See `MountHost.viewerDefaults`.
   */
  viewerDefaults?: MountHost['viewerDefaults']
  /**
   * The composition's slot-defaults (the default empty-slot placeholder), implemented by the host.
   * OPTIONAL, forwarded by the adapter. See `MountHost.slotDefaults`.
   */
  slotDefaults?: MountHost['slotDefaults']
  /** The launcher recents, implemented by the host (the local per-machine store). Forwarded by the
   *  adapter. See `MountHost.recents`. */
  recents?: MountHost['recents']
  /** Engine-asset URL surface, implemented by the host (engine resolve + `au-asset://` serving). OPTIONAL.
   *  Forwarded by the adapter. See `MountHost.assets`. */
  assets?: MountHost['assets']
  /**
   * Discovery-change subscription, implemented by the host. Forwarded by the adapter.
   * See `MountHost.subscribeContributions`.
   */
  subscribeContributions: MountHost['subscribeContributions']
  /**
   * The ephemeral preview overlay surface, implemented by the host (the per-window
   * card stack). Forwarded by the adapter. See `MountHost.preview`.
   */
  preview: MountHost['preview']
  /**
   * The overlay SITE, implemented by the host (the per-window layer root + the stacking ladder).
   * Forwarded by the adapter. OPTIONAL, matching the contract member. See `MountHost.overlay`.
   */
  overlay?: MountHost['overlay']
  /**
   * The open-surfaces index, implemented by the host (the per-window surface store + the cross-window
   * merge). Forwarded by the adapter. OPTIONAL, matching the contract member. See `MountHost.openSurfaces`.
   */
  openSurfaces?: MountHost['openSurfaces']
  /**
   * The context-menu surface, implemented by the host (the per-window menu + its keyboard model).
   * Forwarded by the adapter. OPTIONAL, matching the contract member. See `MountHost.contextMenu`.
   */
  contextMenu?: MountHost['contextMenu']
  /**
   * The interactive popover surface, implemented by the host (the per-window layer + anchoring +
   * dismissal). Forwarded by the adapter. OPTIONAL, matching the contract member. See `MountHost.popover`.
   */
  popover?: MountHost['popover']
  /**
   * The app-global per-machine theme layer, implemented by the host (a localStorage-backed
   * singleton applied on boot). OPTIONAL. Forwarded by the adapter. See `MountHost.theme`.
   */
  theme?: MountHost['theme']
  /** The host's token-registration report. OPTIONAL. Forwarded by the adapter. See `MountHost.tokens`. */
  tokens?: MountHost['tokens']
  /** The app-global per-machine component-set selection, implemented by the host. OPTIONAL. Forwarded by the adapter. See `MountHost.components`. */
  components?: MountHost['components']
  /** Engine-readiness edge, implemented by the host. OPTIONAL. Forwarded by the adapter. See `MountHost.engineReady`. */
  engineReady?: MountHost['engineReady']
  /** Wide-effect confirm surface, implemented by the host. OPTIONAL. Forwarded by the adapter. See `MountHost.confirm`. */
  confirm?: MountHost['confirm']
  /** Host → OS shell, implemented by the host. OPTIONAL. Forwarded by the adapter. See `MountHost.shell`. */
  shell?: MountHost['shell']
  /** Detached-window-root flag, set by the host. OPTIONAL. See `MountHost.windowRoot`. */
  windowRoot?: MountHost['windowRoot']
}

/**
 * Build the projection-side `MountHost` over a transport.
 *
 * The projection-facing API is identical to the by-reference host: a
 * projection still calls `host.engine.read(...)` and `host.engine.subscribe(...)`.
 * Underneath, every call is a protocol message.
 *
 * Request and channel ids are minted here, monotonically, so `subscribe`
 * returns its unsubscribe synchronously — no wait for a broker ack. The broker
 * must therefore tolerate an `unsubscribe` for a channel whose `subscribe` it
 * has not yet processed (treat it as a dead channel, no-op the subscribe).
 *
 * The broker answers every read with a `read-result`, carrying an `ok: false`
 * result when it cannot serve. A read never rejects; that mirrors the contract.
 */
// A process-global counter for `styles.inject` scope markers — unique across every host + injection in
// the window, so two projections' scoped sheets never collide on the same `data-au-scope` value.
let scopeSeq = 0

export function createMountHost(transport: HostTransport, info: MountHostInfo): MountHost {
  let nextId = 1
  const pendingReads = new Map<number, (result: EngineReadResult) => void>()
  const channels = new Map<number, (event: SubscriptionEvent) => void>()

  transport.receive((message) => {
    if (message.kind === 'read-result') {
      const resolve = pendingReads.get(message.id)
      if (!resolve) return // a reply for an id we already settled; drop it.
      pendingReads.delete(message.id)
      resolve(message.result)
      return
    }
    const onEvent = channels.get(message.channel)
    if (!onEvent) return // an event for a torn-down channel; drop it.
    onEvent(message.event)
    if (message.event.kind === 'closed') channels.delete(message.channel)
  })

  // Spread every forwardable MountHostInfo member so optional capabilities reach projections.
  // Compute engine over the transport. Return ordinary own properties because the in-process
  // adapter spreads this result; an accessor proxy must not hide the computed engine.
  return {
    ...info,
    styles: {
      inject(css: string, root: HTMLElement): () => void {
        // Scope by a per-injection MARKER, not by the mount root's ancestry. `@scope ([data-au-scope=N])`
        // matches this projection's subtree AND anything it PORTALS OUT that carries the same marker — a
        // dropdown / tooltip the kit renders to `document.body` to escape clipping + stacking. The kit
        // copies the marker onto its portals (reading the nearest `[data-au-scope]` ancestor), so the
        // scoped CSS follows content that leaves the pane while still never touching a sibling. The host
        // owns the wrap, so a projection cannot opt out. Chromium is host-controlled, so `@scope` is safe.
        //
        // Delivered as a DOCUMENT-LEVEL constructable stylesheet (`adoptedStyleSheets`), NOT a `<style>`
        // element: a constructable sheet is EXEMPT from the CSP `style-src`, so the renderer's strict policy
        // needs no `'unsafe-inline'` and no per-injection nonce. Document-level is what reaches the portaled
        // surfaces (a subtree- or shadow-scoped sheet would miss a `document.body` portal); the `@scope`
        // marker still confines the rules to this projection. The token-declaration sheets ride the same
        // `adoptedStyleSheets` path.
        const scope = `au-scope-${scopeSeq++}`
        root.setAttribute('data-au-scope', scope)
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(`@scope ([data-au-scope="${scope}"]) {\n${css}\n}`)
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
        return () => {
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet)
          if (root.getAttribute('data-au-scope') === scope) root.removeAttribute('data-au-scope')
        }
      },
    },
    engine: {
      read(request) {
        const id = nextId++
        return new Promise<EngineReadResult>((resolve) => {
          pendingReads.set(id, resolve)
          transport.send({ kind: 'read', id, request })
        })
      },
      subscribe(request, onEvent) {
        const channel = nextId++
        channels.set(channel, onEvent)
        transport.send({ kind: 'subscribe', channel, request })
        return () => {
          if (!channels.delete(channel)) return // already torn down; idempotent.
          transport.send({ kind: 'unsubscribe', channel })
        }
      },
    },
  }
}

export type ProjectionMetaCheck = { ok: true; meta: ProjectionRuntimeMeta } | { ok: false; errors: string[] }

/**
 * Validate an untrusted projection-runtime-meta value and perform the contract
 * handshake. The value is the `projection-runtime-meta` block read off a
 * projection subtype's type-def (`readType` -> `meta_blocks`, the body assembled
 * into a record), NOT a manifest.json — code resolves through the type
 * owner (`type_sites` owner + source path) plus this meta's `entry`, never a
 * disk manifest. Rejection messages are written for the host UI, not just logs.
 */
export function checkProjectionMeta(value: unknown): ProjectionMetaCheck {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, errors: ['projection runtime meta is not an object'] }
  }
  const record = value as Record<string, unknown>
  const errors: string[] = []
  if (typeof record['entry'] !== 'string' || record['entry'].length === 0) {
    errors.push("'entry' must be a non-empty string")
  }
  if (typeof record['contractVersion'] !== 'number') {
    errors.push("'contractVersion' must be a number")
  }
  // Optional token-declaration locator(s), paths relative to the package root.
  // `String[+]` — a single value is legal in bare (scalar) form per the type
  // list-form, so accept a string OR an array and normalize to string[].
  const rawTokenEntry = record['customTokenEntry']
  let tokenEntry: [string, ...string[]] | undefined // non-empty (validated below), matching the generated `String[+]` tuple
  if (rawTokenEntry !== undefined) {
    const arr = Array.isArray(rawTokenEntry) ? rawTokenEntry : [rawTokenEntry]
    if (arr.length === 0 || !arr.every((p) => typeof p === 'string' && p.length > 0)) {
      errors.push("'customTokenEntry' must be a non-empty string or array of non-empty strings")
    } else {
      tokenEntry = arr as [string, ...string[]]
    }
  }
  if (errors.length > 0) return { ok: false, errors }

  const contractVersion = record['contractVersion'] as number
  if (contractVersion !== MOUNT_CONTRACT_VERSION) {
    return {
      ok: false,
      errors: [
        `contract version mismatch: projection built against v${contractVersion}, host speaks v${MOUNT_CONTRACT_VERSION}`,
      ],
    }
  }

  return {
    ok: true,
    meta: {
      // A runtime-meta block claims the `projection-runtime-meta` type; the
      // engine's meta_blocks body omits the claim, so stamp it for the typed shape.
      type: 'projection-runtime-meta',
      entry: record['entry'] as string,
      contractVersion,
      // Optional named export (default `mount`); carried through when present so
      // the host can mount one of several surfaces sharing this entry.
      ...(typeof record['export'] === 'string' && record['export'].length > 0
        ? { export: record['export'] as string }
        : {}),
      // Optional token-declaration stylesheet(s) the host eager-loads at document
      // level for token discovery. Normalized to string[]; carried through when present.
      ...(tokenEntry ? { customTokenEntry: tokenEntry } : {}),
    },
  }
}

export { splitThemeOverrides } from './theme-token-scope'
export type { WorkspaceTemplatePreview, WorkspaceTemplate, WorkspaceTemplateManifest, LocatedWorkspaceTemplate, WorkspaceTemplateCatalog, MaterializeWorkspaceRequest } from './workspace-templates'
