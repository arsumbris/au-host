import { mountReloadableProjection } from './projection-reload'
// The MOUNT AGENT — a surface's thin executor for the mount/proxy command protocol.
//
// A SURFACE (a secondary window) owns only its DOM. It is NOT a second CompositionRuntime: it holds no
// pool, no dispatch trees, no wire table. The AUTHORITY owns all of that and drives the surface with
// SurfaceCommands (mount / reflect / remount / unmount); the agent executes them into its window's DOM
// and reports SurfaceEvents (config-changed / focus / intent-fired / selection-published) back up.
//
// THE LAYERED HOST (folded in here — the agent's host IS the layered proxied host):
//   - DIRECT to main: engine reads/subscribes (`window.main.engine`), terminal (`window.main.terminal`).
//   - LOCAL to the surface: overlay / preview / context-menu / confirm / chooser / styles — the
//                            per-window module singletons `createInProcessMountHost` wires internally.
//   - PROXIED to the authority via events: intent (`fire`), focus (`report`), selection (`publish`/`follow`),
//                                           config (`saveConfig`).
// Cross-window intent ROUTING is the authority-side gather-then-commit dispatch: the agent runs a
// record's pure `claim` (reply) and its `commit` (act) on the authority's command. FOCUS / SELECTION are
// coalesced per frame and cross to the authority's trees: focus.report / selection.publish are
// held latest-wins and flushed once per frame (or synchronously before any other event, so ordering holds);
// selection.follow tells the authority to deliver its enclosing container's selection DOWN
// (`selection-deliver`), so a follower sees selection from a container in another window. The main-backed
// viewStore keys per pool id, so a floated pane's cursor/scroll follows the float.

import { isDefinedProjection, currentCause, resumeCause, bareTypeName, keystrokeEquals } from '@arsumbris/au-host-sdk'
import type { LoadedModule, MountHost, OpaqueConfig, IntentChannel, IntentHandler, FocusChannel, SelectionChannel, PublisherId, IntentPayload, ProjectionSource, ContainerPlacement, Occupant, PaneInstance, CanonicalKeystroke, CloseGuard, CloseGuardChannel } from '@arsumbris/au-host-sdk'
import { CloseGuardTree } from './close-guard-channel'

import type { SurfaceCommand, SurfaceEvent, SurfaceInit, SlotDescriptor, WindowSite } from '../../../shared/daemon-api'
import { placementForPane, resolveAddress, registerContainer, deregisterContainer, wrapTargets, wrapTargetOutcome, closePane } from '@arsumbris/container-core'
import { paneIdOfActiveElement } from './pane-focus'
import { pickTargetWindow } from './window-picker'
import { getChooserSurface } from './chooser-surface'
import { GenerationGuard } from './surface-protocol'
import { IdRange, DEFAULT_WATERMARK, type IdBlock } from './id-allocator'
import { createInProcessMountHost, createDaemonControl, createMcpControl } from './mount-host'
import { createEngineReadiness } from './engine-readiness'
import { createViewStore, hydrate as hydrateViewState } from './view-store'
import { createTerminalChannel } from './terminal-channel'
import { ViewStateBus } from './view-state'
import { getPreviewSurface } from './preview-surface'
import { makeOpenSurfaces } from './open-surfaces'
import { sourceKey, sourceLocation } from './loader'
import type { ProjectionRegistration } from './loader'
import type { DiscoveredProjection } from './discovery'
import type { WorkspaceMember } from './host-config'
import { refName } from '@arsumbris/type-query'

/** Resolve a projection TYPE NAME to a loadable registration from a discovery snapshot. */
function registrationFor(discovered: DiscoveredProjection[], typeName: string): ProjectionRegistration | undefined {
  const match = discovered.find((d) => refName(d.typeName) === refName(typeName))
  if (!match) return undefined
  const source: ProjectionSource = { mode: 'esm', path: match.packageRoot }
  return { key: sourceKey(sourceLocation(source)), source, entry: match.entry, export: match.export }
}

/** One record the agent has mounted into its window. */
interface MountedRecord {
  slot?: HTMLElement
  onUnmount?: () => void
  /** The projection TYPE NAME this record mounts — for the keybind gate's raw-text-surface arbitration
   *  (the focused record's type → its `raw-text-surface-meta`), mirroring the authority's focus→type join. */
  typeName: string
  /** The projection's own unmount (from its `mount(slot, host)` return). */
  dispose: () => void
  /** The reflect-in-place inbound handler the leaf registered via `host.onOwnConfigChange`, or null. */
  inbound: ((config: OpaqueConfig) => void) | null
  /**
   * Intent handlers the record declared (`host.intent.handle`), kept for cross-window delivery.
   *  A `{ claim, commit }` pair: the authority ASKS `claim` (the cross-window claim query) and, on winning,
   *  drives `commit`.
   */
  intentHandlers: Map<string, IntentHandler>
  /** Selection followers the record declared (`host.selection.follow`), kept for delivery-down. */
  selectionFollowers: Set<(value: unknown) => void>
}

/**
 * The mount agent for one surface window. Constructed once the surface's init arrives; `execute` is
 * called for each SurfaceCommand the authority sends. It resolves the window-content slot to the mount
 * element handed in at construction.
 */
export class MountAgent {
  private readonly guard = new GenerationGuard()
  private readonly mounted = new Map<string, MountedRecord>()
  // One ephemeral view-state bus for this surface (the per-window bubble; cross-window viewState is not
  // in scope — selection/focus/intent are the channels that cross, and those are proxied per record).
  private readonly viewStateBus = new ViewStateBus()
  // THE SURFACE-LOCAL CLOSE-GUARD TREE (close-removal lifecycle, cross-window). A floated pane registers its
  // close-guard HERE (keyed by its publisher), so the guard + its save/discard/cancel dialog run LOCALLY in
  // this window, where the content is. The authority owns the reap; it gathers this window's guards over the
  // wire (`gather-close-guard` → `gatherAmong`) via a PROXY guard it registered on the record's publisher when
  // this surface reported the `close-guard-capability`. Net-presence per record is tracked in `guardCounts`
  // (report `add` on 0→1, `drop` on 1→0), mirroring the intent `capability` reporting.
  private readonly closeGuardTree = new CloseGuardTree()
  private readonly guardCounts = new Map<string, number>()
  // THE MIRRORED BOUND-CHORD SET (keybinds, cross-window native suppression). The authority pushes DOWN the
  // keydowns that begin a bound chord in the current (focus-scoped) context; the gate `preventDefault`s a
  // native default IFF the keydown is in this set (membership only — resolution stays authority-side). Empty
  // until the first `active-chords`, so before it arrives the gate suppresses nothing (native defaults act).
  private activeChords: readonly CanonicalKeystroke[] = []
  // Publisher minting + the nodeId <-> publisher maps a container reads to map an intent's firer / a
  // focused pane back to a pane id (a floated CONTAINER mounts its child panes here).
  private publisherSeq = 0
  private readonly nodeIdToPublisher = new Map<string, PublisherId>()
  private readonly publisherToNodeId = new Map<PublisherId, string>()
  // THE PROXIED POOL. One per surface: a CACHE of this window's subtree records (the RESOLVED
  // form the authority mirrors down via `pool-sync`), plus the subscribers a container re-reads through.
  // The surface holds NO write — `propose` sends the edit batch UP; the authority is the sole committer.
  private readonly poolCache = new Map<string, OpaqueConfig>()
  private readonly poolListeners = new Set<() => void>()
  private poolObj: NonNullable<MountHost['children']['pool']> | undefined
  // THE GRANTED ID-RANGE. The authority is the pool's sole minter; it GRANTS this surface
  // blocks of ids, so a floated container draws a FINAL, globally-unique `^:` SYNCHRONOUSLY. Constructed on
  // the first `grant` command (its active + reserve blocks); refills resolve `pendingGrant`.
  private idRange: IdRange | undefined
  private pendingGrant: ((block: IdBlock) => void) | null = null
  // FOCUS / SELECTION COALESCING. A drag-select fires selection.publish (and focus.report) many
  // times a frame; sending each over IPC would storm the wire. We hold the LATEST of each and flush once per
  // frame. ORDERING: every OTHER event goes through `emit`, which FLUSHES the pending view
  // channels FIRST — so a focus issued before an intent-fire is applied before it at the authority, without a
  // per-event sequence number (one ordered IPC channel already preserves send order).
  // Focus is single-latest (it means "the active one"); selection is PER-RECORD (each record's selection is
  // independent, so the drag-select storm on ONE record collapses to its latest without clobbering another
  // record's distinct selection).
  private pendingFocus: string | undefined
  private readonly pendingSelection = new Map<string, unknown>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  // The last record to report focus in THIS window — the keybind gate's local focus→type join (the surface
  // twin of the authority's transient focus). Persists across flushes, unlike `pendingFocus`.
  private lastFocusedId: string | null = null

  // THE ACTIVE-PANE RING (per-window). The authority pushes THIS window's scoped active
  // pane (`^:`) — the ONE aggregate FILTERED to this window; a container renders its own ring from it. GATED
  // locally by this window's OS-focus (a blurred window shows no ring). `surfaceOsFocused` inits
  // optimistic TRUE (a floated window is focused when created; a real `blur` corrects it), mirroring main.
  private windowActivePane: string | null = null
  private surfaceOsFocused = true
  private readonly activePaneListeners = new Set<(activePane: string | null) => void>()

  // The open-window set, seeded from the init and kept fresh by `windows-changed`, so this
  // surface's "Move to other window" picker renders locally without a round-trip for the list.
  private windowSet: readonly WindowSite[] = []

  // THE ROOT CONTENT id: the `^:` of the record mounted as THIS window's content — the address a
  // root re-point (unwrap-to-window-root) names. Updated on every root mount/remount so the root anchor's
  // `data-droptarget-id` tracks the current content. `null` until the first mount / registration done once.
  private rootContentId: string | null = null
  private rootPlacementRegistered = false

  constructor(
    private readonly init: SurfaceInit,
    private discovery: DiscoveredProjection[],
    private readonly members: WorkspaceMember[],
    private readonly sendEvent: (event: SurfaceEvent) => void,
    /** The window-content mount element — the sole slot in (a window mounts its `content`). */
    private readonly contentEl: HTMLElement,
    /**
     * Reports the ROOT content's host + type-label up to the surface shell, so the subwindow
     *  renders the SAME `<au-pane-header>` chrome as the main window. Fired each time the root content mounts
     *  (a remount reports the fresh host). The host's `contextMenu` is a per-window singleton, so the
     *  shell's root ⋯ opens correctly through it.
     */
    private readonly onRoot?: (info: { host: MountHost; label: string; id: string }) => void,
  ) {
    this.windowSet = init.windows ?? []
  }

  private readonly discoveryListeners = new Set<() => void>()

  updateDiscovery(discovery: DiscoveredProjection[]): void {
    this.discovery = discovery
    for (const listener of this.discoveryListeners) listener()
  }

  private mountCommand(id: string, gen: number, typeName: string, config: unknown, slot: SlotDescriptor): void {
    void this.mount(id, gen, typeName, config, slot).catch(error => {
      if (this.guard.applied(id) !== gen) return
      console.error('Surface projection mount failed:', error)
      const message = document.createElement('p')
      message.setAttribute('role', 'alert')
      message.textContent = `Could not mount ${typeName}: ${error instanceof Error ? error.message : String(error)}`
      this.slotElement(slot).replaceChildren(message)
    })
  }

  /** Send a non-coalesced event, FLUSHING any pending focus/selection FIRST. Everything
   *  except focus.report / selection.publish routes through here, so the ordered IPC channel carries events in
   *  issue order and the authority never needs a per-surface sequence number. */
  private emit(event: SurfaceEvent): void {
    this.flushViewChannels()
    this.sendEvent(event)
  }

  /** Coalesce a focus report (latest-wins per frame). */
  private reportFocus(id: string): void {
    this.pendingFocus = id
    this.lastFocusedId = id
    this.scheduleFlush()
  }

  /** THE surface's DOM-focus feed (the surface twin of the authority's `installFocusTracker`). The window's
   *  `focusin` tracker resolves the focused pane `^:` and calls this; it reports UP (feeding the ONE aggregate
   *  recency) AND updates `lastFocusedId`. DOM focus is the host's single focus source, per window. Focus
   *  landing outside any pane resolves to nothing → no call, so the report is only ever a real pane. */
  reportFocusFromDom(paneId: string): void {
    this.reportFocus(paneId)
  }

  /**
   * This window's active-pane ring, GATED by its OS-focus: the pushed head when this window is
   *  OS-focused, else null (hide the ring while another window is focused; re-ring on refocus).
   */
  private gatedActivePane(): string | null {
    return this.surfaceOsFocused ? this.windowActivePane : null
  }

  /** The authority pushed this window's scoped active pane (`active-pane` command). Store + re-notify the ring. */
  private setActivePane(head: string | null): void {
    if (this.windowActivePane === head) return
    this.windowActivePane = head
    this.notifyActivePane()
  }

  /**
   * This surface window gained / lost OS-focus (from `surface.tsx`'s window focus/blur). Re-gate the ring
   * a blur clears it, a refocus re-shows the pushed head.
   */
  setOsFocused(focused: boolean): void {
    if (this.surfaceOsFocused === focused) return
    this.surfaceOsFocused = focused
    this.notifyActivePane()
  }

  private notifyActivePane(): void {
    const head = this.gatedActivePane()
    for (const l of [...this.activePaneListeners]) l(head)
  }

  // ── Keybind gate (the surface's window-local half) ─────────────────────────────────────────────────
  // The floated window's gate canonicalizes + arbitrates a keydown LOCALLY (so plain typing never leaves
  // the window), then forwards a surviving chord candidate UP; the authority resolves + fires.


  /** Whether the focused PROJECTION on this surface declares `raw-text-surface-meta` — the projection half
   *  of the gate's text-editing-context check, the surface twin of the authority's `isFocusedRawTextSurface`.
   *  (The chrome half — a focused `<input>`/`contenteditable`, e.g. CodeMirror — is a pure DOM check in the
   *  gate, so it needs no state here.) */
  isFocusedRawTextSurface(): boolean {
    if (!this.lastFocusedId) return false
    const typeName = this.mounted.get(this.lastFocusedId)?.typeName
    if (!typeName) return false
    const desc = this.discovery.find((d) => bareTypeName(d.typeName) === bareTypeName(typeName))
    return !!desc?.meta?.['raw-text-surface-meta']
  }

  /** Whether a keydown BEGINS a bound chord in the current context — a MEMBERSHIP check against the authority's
   *  mirrored `active-chords` set. The gate uses it to `preventDefault` a native default precisely (⌘W's window
   *  close) while letting an unbound chord (⌘C / copy) fall through to its native default. Resolution stays
   *  authority-side; this is a boolean only. Stale by at most a frame across a focus change (best-effort). */
  isBoundChord(ks: CanonicalKeystroke): boolean {
    return this.activeChords.some((c) => keystrokeEquals(c, ks))
  }

  /** Forward a surviving chord candidate UP to the authority to resolve + fire. `emit` flushes any pending
   *  focus first, so the authority's focus tree is current before it resolves. The gate
   *  itself decides the native `preventDefault` from the mirrored `active-chords` set (`isBoundChord`) — never
   *  a blanket suppression, so ⌘C / copy keeps its native default in a floated editor; resolution is still the
   *  authority's (the surface holds no resolver). */
  forwardKeystroke(ks: CanonicalKeystroke): void {
    // Carry THIS window's transient focused pane `^:` (resolved locally, from the surface's own DOM), so the
    // authority resolves the command's TARGET + when-context against THIS window — not main's DOM / the
    // aggregate head. `emit` flushes pending focus first.
    this.emit({ kind: 'keystroke', ks, focus: paneIdOfActiveElement() })
  }

  /** Coalesce a selection publish (latest-wins per frame, PER record). */
  private publishSelection(id: string, value: unknown): void {
    this.pendingSelection.set(id, value)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return
    // A timer (not rAF): rAF is throttled/absent for a hidden (`show:false`) window, so a background surface's
    // publish would never flush. ~one frame; the flush-before-dependent-op makes this latency irrelevant to
    // routing correctness (an intent-fire flushes synchronously), so the timer only bounds the idle storm.
    this.flushTimer = setTimeout(() => this.flushViewChannels(), 16)
  }

  /** Flush the coalesced focus then per-record selections (focus first; latest-wins within each). */
  private flushViewChannels(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const focus = this.pendingFocus
    this.pendingFocus = undefined
    if (focus !== undefined) this.sendEvent({ kind: 'focus', id: focus })
    if (this.pendingSelection.size > 0) {
      const selections = [...this.pendingSelection]
      this.pendingSelection.clear()
      for (const [id, value] of selections) this.sendEvent({ kind: 'selection-published', id, selection: value })
    }
  }

  /**
   * Deliver a followed enclosing-container selection DOWN to record `id`'s followers. The authority
   *  registered ONE follow per record publisher in its cross-window SelectionTree; this fans it out to every
   *  callback `host.selection.follow` registered on this surface for that record.
   */
  private deliverSelection(id: string, value: unknown): void {
    const followers = this.mounted.get(id)?.selectionFollowers
    if (!followers) return
    for (const cb of [...followers]) cb(value)
  }

  /** Execute one authority command, gated by the generation guard (a stale command is dropped). */
  execute(command: SurfaceCommand): void {
    // POOL-SYNC is pool state, not a per-record lifecycle transition — it carries no generation, so it is
    // handled BEFORE the generation guard (which keys on id/gen). It only refreshes the read cache.
    if (command.op === 'pool-sync') {
      this.poolSync(command.records)
      return
    }
    if (command.op === 'grant') {
      this.handleGrant(command.blocks)
      return
    }
    // CLAIM / COMMIT (gather-then-commit): the authority ASKS a remote candidate's pure claim
    // (reply, no act), then COMMITS only the winner (act, no reply). Gen-independent (not a lifecycle
    // transition), so handled before the generation guard, like pool-sync / grant.
    if (command.op === 'claim') {
      this.claimIntent(command.id, command.cid, command.from, command.intent)
      return
    }
    if (command.op === 'commit') {
      this.commitIntent(command.id, command.cid, command.from, command.intent, command.cause)
      return
    }
    // SELECTION-DELIVER: the followed enclosing-container selection changed at the authority.
    // Channel state, not a per-record lifecycle transition — handled before the generation guard.
    if (command.op === 'selection-deliver') {
      this.deliverSelection(command.id, command.value)
      return
    }
    // WINDOWS-CHANGED: the window set changed at the authority — refresh the local list the move
    // picker reads. Window-set state, not a per-record lifecycle, so handled before the generation guard.
    if (command.op === 'windows-changed') {
      this.windowSet = command.windows
      return
    }
    // CONFIRM-CLOSE: the user asked to close THIS non-empty floated window; prompt IN it. Not a
    // per-record lifecycle, so handled before the generation guard (like claim / commit / windows-changed).
    if (command.op === 'confirm-close') {
      void this.confirmClose()
      return
    }
    // GATHER-CLOSE-GUARD (close-removal lifecycle): the authority is about to reap record `id` on this surface;
    // run this window's local close-guard consensus and reply. Not a record lifecycle, so before the guard.
    if (command.op === 'gather-close-guard') {
      void this.gatherCloseGuard(command.id, command.cid)
      return
    }
    // ACTIVE-CHORDS (keybinds): refresh the mirrored bound-chord set the gate checks for native suppression.
    // Window-wide input state, not a record lifecycle, so handled before the generation guard.
    if (command.op === 'active-chords') {
      this.activeChords = command.chords
      return
    }
    // ACTIVE-PANE (the ring): the authority pushed THIS window's scoped active pane.
    // Window-wide state, not a record lifecycle, so handled before the generation guard (like active-chords).
    if (command.op === 'active-pane') {
      this.setActivePane(command.activePane)
      return
    }
    // CLOSE-PANE: the authority resolved a close-view whose
    // target is a pane in THIS window and DELEGATED the close here (it cannot reach this renderer's placement).
    // `closePane` runs against the surface's own container registry — its container proposes the reference-
    // removal UP, and the authority reaps + gathers the close-guard. Not a record lifecycle, so before the guard.
    if (command.op === 'close-pane') {
      closePane(command.id)
      return
    }
    if (!this.guard.admit(command)) return // stale — max-gen-wins dropped it
    switch (command.op) {
      case 'mount':
        this.mountCommand(command.id, command.gen, command.typeName, command.config, command.slot)
        return
      case 'remount':
        this.unmountRecord(command.id)
        this.mountCommand(command.id, command.gen, command.typeName, command.config, command.slot)
        return
      case 'reflect':
        this.reflect(command.id, command.config)
        return
      case 'unmount':
        this.unmountRecord(command.id)
        return
    }
  }

  /** Tear down every mounted record (the surface is closing). */
  dispose(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pendingFocus = undefined
    this.pendingSelection.clear()
    for (const id of [...this.mounted.keys()]) this.unmountRecord(id)
    if (this.rootPlacementRegistered) {
      deregisterContainer(this.contentEl)
      this.contentEl.removeAttribute('data-droptarget-shape')
      this.contentEl.removeAttribute('data-droptarget-id')
      this.rootPlacementRegistered = false
    }
  }

  /** Replace the subtree cache from a `pool-sync` and notify subscribers. A floated container's
   *  `useContainerModel` resync re-reads `resolveRecord` here, so an external structural edit (its own
   *  proposed re-parent, or a change elsewhere the authority mirrors down) re-renders in place. */
  private poolSync(records: ReadonlyArray<{ id: string; config: unknown }>): void {
    this.poolCache.clear()
    for (const { id, config } of records) if (config != null) this.poolCache.set(id, config as OpaqueConfig)
    for (const listener of [...this.poolListeners]) listener()
  }

  /**
   * The pure CLAIM query: run the addressed record's handler `claim` predicate and report it UP — NO act.
   *  No such record / handler for this type → DECLINE. `from` is the firer's RECORD id ('s stable
   *  cross-window identity); translate it to THIS surface's local publisher so a firer-relative handler
   *  (e.g. tabs mapping the firer to its tab) resolves — a firer on ANOTHER window is not in this map and
   *  falls back to the opaque record id, which such a handler ignores.
   */
  private claimIntent(id: string, cid: number, from: string, intentRaw: unknown): void {
    const intent = intentRaw as IntentPayload
    const handler = this.mounted.get(id)?.intentHandlers.get(intent.type)
    const claimed = handler ? handler.claim(intent, this.localFrom(from)) : false
    this.emit({ kind: 'claim-reply', cid, claimed })
  }

  /**
   * Commit an intent to the addressed handler under the authority's causal pass, so nested fires retain
   * cross-window cycle protection. With `cid`, reply whether the handler acted: a missing handler or a
   * throw declines, allowing the authority to select another claimer. Without `cid`, delivery is
   * fire-and-forget and a missing handler is a no-op.
   */
  private commitIntent(id: string, cid: number | undefined, from: string, intentRaw: unknown, cause?: number): void {
    const intent = intentRaw as IntentPayload
    const handler = this.mounted.get(id)?.intentHandlers.get(intent.type)
    let acted = false
    if (handler) {
      try {
        resumeCause(cause, () => handler.commit(intent, this.localFrom(from)))
        acted = true
      } catch {
        acted = false // the atomic-commit rule: a throw left no observable trace, so the authority re-homes.
      }
    }
    if (cid !== undefined) this.emit({ kind: 'commit-reply', cid, acted })
  }

  /** Map an incoming firer RECORD id to THIS surface's local publisher, so `from` is meaningful to a
   *  firer-relative handler on this surface (a co-located firer resolves; a foreign-window firer falls back
   *  to the opaque record id). The mirror of the authority translating its publisher → the record id. */
  private localFrom(fromRecord: string): PublisherId {
    return this.nodeIdToPublisher.get(fromRecord) ?? fromRecord
  }

  /** The `host.closeGuard` channel for one mounted record (close-removal lifecycle, cross-window). Registers
   *  the guard in this surface's local `closeGuardTree` (keyed by the record's publisher) AND reports NET
   *  presence UP: `add` on the first guard for the record, `drop` when the last unregisters — so the authority
   *  keeps a matching proxy guard and its synchronous fast-path stays sound. The guard itself (and its
   *  save/discard/cancel dialog) run LOCALLY when the authority later gathers via `gather-close-guard`. */
  private closeGuardFor(recordId: string, publisher: PublisherId): CloseGuardChannel {
    return {
      register: (guard: CloseGuard) => {
        const unregister = this.closeGuardTree.forNode(publisher).register(guard)
        const n = (this.guardCounts.get(recordId) ?? 0) + 1
        this.guardCounts.set(recordId, n)
        if (n === 1) this.emit({ kind: 'close-guard-capability', id: recordId, op: 'add' })
        return () => {
          unregister()
          const left = (this.guardCounts.get(recordId) ?? 1) - 1
          if (left <= 0) {
            this.guardCounts.delete(recordId)
            this.emit({ kind: 'close-guard-capability', id: recordId, op: 'drop' })
          } else this.guardCounts.set(recordId, left)
        }
      },
    }
  }

  /** Run this window's local close-guard consensus for record `recordId` (the body the authority's proxy guard
   *  awaits) and reply. Interactive — a guard may show a dialog — so the authority's wire query does not time
   *  out on human decision time; a surface-death settles it withheld. No guard for the record → consent. */
  private async gatherCloseGuard(recordId: string, cid: number): Promise<void> {
    const publisher = this.nodeIdToPublisher.get(recordId)
    const consented = publisher ? await this.closeGuardTree.gatherAmong([publisher]) : true
    this.emit({ kind: 'close-guard-reply', cid, consented })
  }

  /**
   * Take a GRANT of id-blocks from the authority. The first grant (active + reserve) builds
   *  the range; a later grant refills a low range by resolving the pending `grant-request`. The range's
   *  refill request goes UP as a `grant-request` event, so a draw never blocks (the reserve covers the gap).
   */
  private handleGrant(blocks: ReadonlyArray<IdBlock>): void {
    if (!this.idRange) {
      this.idRange = new IdRange(
        () => {
          this.emit({ kind: 'grant-request' })
          return new Promise<IdBlock>((resolve) => {
            this.pendingGrant = resolve
          })
        },
        DEFAULT_WATERMARK,
        ...blocks,
      )
      return
    }
    const resolve = this.pendingGrant
    this.pendingGrant = null
    if (resolve && blocks[0]) resolve(blocks[0])
  }

  /**
   * Draw a FINAL, granted `^:` id. Throws if the range has not arrived — impossible in
   *  practice: the authority grants on ready, before any structural gesture can mint.
   */
  private drawId(): string {
    if (!this.idRange) throw new Error('mount agent: id-range not granted yet — a mint arrived before the authority granted a block')
    return this.idRange.draw()
  }

  /**
   * The surface's PROXIED pool (memoized; one per surface, shared by every mounted record). READ is the
   * mirrored cache (`resolveRecord`); WRITE is a `propose` sent UP to the authority (the sole committer).
   * New records draw IDs from authority-granted ranges. Moving a pane to another window uses
   * `moveToWindow`; the surface does not expose a separate `float` operation.
   */
  private surfacePool(): NonNullable<MountHost['children']['pool']> {
    if (this.poolObj) return this.poolObj
    const propose = (edits: ReadonlyArray<{ id: string; record: OpaqueConfig }>): void =>
      this.emit({ kind: 'propose', edits })
    // The BOUNDED mint: draw a final granted id, stamp `^:`, send it UP as a `mint`, return the id
    // synchronously. A leaf and an embedded group share this — the authority normalizes.
    const mintRecord = (record: unknown, opts?: { transient?: boolean }): string => {
      const id = this.drawId()
      const rec = { ...(record as Record<string, unknown>), ['^']: id } as OpaqueConfig
      // Wire 1: a floated container's transient mint (a preview) rides the `mint` event UP, so the
      // authority marks its `pool.transient` and drops the record at serialize like a same-window one.
      this.emit({ kind: 'mint', edits: [{ id, record: rec }], ...(opts?.transient ? { transient: true } : {}) })
      return id
    }
    this.poolObj = {
      resolveRecord: (id: string) => this.poolCache.get(id),
      // The authority owns pooling; the cache is mirrored down. A child mounted inline is already an
      // authority record, so ensuring it here is a no-op (never a second write).
      ensureRecord: () => {},
      subscribe: (listener: () => void) => {
        this.poolListeners.add(listener)
        return () => this.poolListeners.delete(listener)
      },
      // THE ASK: a structural edit a floated container built goes UP; the authority applies it.
      propose,
      // The substrate holds no write; `applyStructural` is never the channel here — delegate to `propose`
      // so the transition guard (`propose ?? applyStructural`) is correct whichever a caller reaches for.
      applyStructural: propose,
      // STRUCTURAL mint: DRAW a final granted id, stamp `^:`, and stage the record into the
      // propose batch — no pool write until the authority applies. A GROUP is staged with its children
      // EMBEDDED (the surface has no schemas to flatten); the authority NORMALIZES each edit before
      // applying, so the surface stays thin. This supports content-drop / center-wrap on a floated
      // container.
      stageRecord: (record) => {
        const id = this.drawId()
        return { rootId: id, edits: [{ id, record: { ...(record as Record<string, unknown>), ['^']: id } as OpaqueConfig }] }
      },
      stageGroup: (groupInstance) => {
        const id = this.drawId()
        return { rootId: id, edits: [{ id, record: { ...(groupInstance as Record<string, unknown>), ['^']: id } as OpaqueConfig }] }
      },
      // Create bounded new content by drawing a granted ID, stamping `^:`, and sending `mint` to the authority.
      // The authority pools it additively without reaping, before the following `config-changed` can reference
      // it. Both `createRecord` and `createGroup` return synchronously; groups carry embedded children that the
      // authority normalizes while preserving existing authoritative records.
      // Rendering stays local through inline `children.mount`; this message supplies identity and reachability.
      createRecord: (record, opts) => mintRecord(record, opts),
      createGroup: (groupInstance) => mintRecord(groupInstance), // a group is never transient
      // BOUNDED remove has no caller: a container closes a pane by committing a model without it, and the
      // authority's `mergeRecord` reaps the now-unreachable record (orphan pruning). So `removeRecord` is an
      // unreached branch of the pool interface here; a throw keeps it honest rather than a silent no-op.
      removeRecord: () => {
        throw new Error('a surface does not call pool.removeRecord — a close commits a model without the pane and the authority reaps the orphan')
      },
      // MOVE TO OTHER WINDOW: pick the target in THIS surface's chooser, then send the pick UP —
      // the authority (the sole pool owner) re-parents. A subwindow always has >=1 other window (the main),
      // so the affordance is always live here. Picking the MAIN window is the dock-back path.
      moveToWindow: (subtreeId) => void this.moveToWindow(subtreeId),
      otherWindowsExist: () => this.windowSet.some((w) => w.id !== this.init.surfaceId),
    }
    return this.poolObj
  }

  /** The surface twin of the authority's `moveToWindow`: pick the target window LOCALLY (in this surface's
   *  chooser), compute the source extract LOCALLY (this renderer owns the container's `poolEdit`), then send
   *  the pick UP. A whole-window content (the surface's root — no container parent) yields no extract, so the
   *  authority splices this window root and auto-closes it. */
  private async moveToWindow(subtreeId: string): Promise<void> {
    const sites = this.windowSet.filter((w) => w.id !== this.init.surfaceId)
    const targetWindowId = await pickTargetWindow(sites)
    if (targetWindowId === null) return
    // TWIN-PICK: a move into an OCCUPIED SECONDARY window WRAPS [content, moved] into a
    // container. Pick WHICH here, in the INVOKING window, so the chooser renders where the user acted — the
    // authority-invoked path asks in main, this is its secondary-window twin. A move to MAIN uses main's own
    // spatial pick, so no wrapKind is chosen here. Cancel aborts before any extract.
    const targetIsMain = sites.find((w) => w.id === targetWindowId)?.primary === true
    let wrapKind: string | undefined
    if (!targetIsMain) {
      const picked = await this.pickWrapKind()
      if (picked === 'cancel') return
      wrapKind = picked.kind
    }
    const placement = placementForPane(subtreeId)
    const pe = placement?.poolEdit
    // Resolve the occupant `^:` to the container's canonical POSITION at the boundary, like the authority's
    // `localExtract` — so `extractEdit` is position-native (a ruled slot's position id ≠ its occupant id).
    const pos = placement ? resolveAddress(placement, subtreeId, 'move-extract') : null
    const ex = pe && pe.recordId() && pos != null ? pe.extractEdit(pos) : undefined
    const sourceEdit = pe && ex ? { id: pe.recordId(), record: ex.record } : undefined
    this.emit({ kind: 'move-to-window', subtreeId, sourceEdit, targetWindowId, wrapKind })
  }

  /** The user asked to close THIS floated window and it is non-empty (the authority found content + prevented
   *  the OS close). Prompt IN this window over the local chooser (the choice
   *  renders where the user acted, never the authority/main window): Close, "move its panes to another
   *  window", or Cancel.
   *  - Close → `close-window` UP: the authority reaps this window's content + closes the OS window.
   *  - relocate → the existing whole-content `moveToWindow` (it picks a target IN this window, then the
   *    authority relocates and auto-closes this window).
   *  - Cancel / dismissed → nothing: the window stays (the authority already prevented the OS close). */
  private async confirmClose(): Promise<void> {
    const picked = await getChooserSurface().choose({
      title: 'Close this window?',
      options: [
        { id: 'close', label: 'Close' },
        { id: 'relocate', label: 'Move its panes to another window' },
        { id: 'cancel', label: 'Cancel' },
      ],
    })
    if (picked === 'close') {
      this.emit({ kind: 'close-window' })
    } else if (picked === 'relocate' && this.rootContentId) {
      await this.moveToWindow(this.rootContentId)
    }
    // 'cancel' or dismissed (null) → the window stays open.
  }

  /** The surface twin of the authority's `pickWrapKind`: choose which container a move-into-an-occupied
   *  window wraps [content, moved] into, in THIS window's chooser. Mirrors the authority's ladder — a
   *  composition-`group-into` or a sole wrap target is used silently; otherwise the family-SECTIONED picker
   *  (Stack: grouping / Arrange: spatial). `{}` when nothing declares a wrap target (the authority falls back);
   *  `'cancel'` when the user dismisses the picker. */
  private async pickWrapKind(): Promise<{ kind?: string } | 'cancel'> {
    const outcome = wrapTargetOutcome()
    if (!outcome || outcome.available.length === 0) return {}
    if ((outcome.reason === 'requested' || outcome.reason === 'only') && outcome.chosen) return { kind: outcome.chosen.typeName }
    const bare = (t: string): string => t.split('::')[0] ?? t
    const SECTION = { grouping: 'Stack', spatial: 'Arrange' } as const
    const options = [...wrapTargets()]
      .sort((a, b) => (a.family === b.family ? 0 : a.family === 'grouping' ? -1 : 1))
      .map((t) => ({ id: t.typeName, label: bare(t.typeName), section: SECTION[t.family] }))
    const picked = await getChooserSurface().choose({ title: 'Wrap pane in which container?', options })
    return picked ? { kind: picked } : 'cancel'
  }

  /**
   * Resolve a window-content slot descriptor to this surface's content element.
   * Nested containers mount their own children through the local children capability.
   */
  private slotElement(_slot: SlotDescriptor): HTMLElement {
    return this.contentEl
  }

  private async mount(id: string, gen: number, typeName: string, config: unknown, slot: SlotDescriptor): Promise<void> {
    // HYDRATE the main-owned view-state cache for this surface's composition BEFORE mounting (a sync load,
    // idempotent per composition). Because the store is keyed by identity and every window reads the ONE
    // main-owned store, a floated pane restores the same cursor / scroll / folds it had in its old window.
    hydrateViewState(this.init.compositionId ?? '')
    this.unmountRecord(id)
    await this.mountAt(this.slotElement(slot), { id: typeName, config: config as OpaqueConfig, nodeId: id }, true,
      () => this.guard.applied(id) === gen)
  }

  /** Register the SURFACE ROOT placement + anchor once — the symmetric twin of the main window's
   *  `rootContentPlacement` (ProjectionHost's `PortalRootAnchor`). It makes THIS floated window's root a
   *  re-pointable slot, so `dissolvePane`'s unwrap-to-window-root finds a parent HERE and lifts a
   *  single-child container's occupant up to the window content — exactly as it does in the main window.
   *  The surface holds no pool, so `setSlotContent` PROXIES the re-point up (`repoint-root`); the authority
   *  owns the window record. `data-droptarget-id` tracks the current root content so `dissolvePane` resolves
   *  the parent slot from the DOM. Idempotent: registers once, updates the anchor id on every root mount. */
  private ensureRootPlacement(rootId: string): void {
    this.rootContentId = rootId
    this.contentEl.setAttribute('data-droptarget-shape', 'slot-rect')
    this.contentEl.setAttribute('data-droptarget-id', rootId)
    if (this.rootPlacementRegistered) return
    this.rootPlacementRegistered = true
    const agent = this
    const placement: ContainerPlacement = {
      panes: () => (agent.rootContentId ? [agent.rootContentId] : []),
      findPane: () => null,
      activate: () => {},
      getSlotContent: (slotId): Occupant | null => {
        const rec = agent.poolCache.get(slotId)
        return rec ? { instance: rec as unknown as PaneInstance, id: slotId } : null
      },
      // PROXY the root re-point to the authority (it owns the window record). `newContentId` is the lone
      // child lifted to window content; a bare fill (absent id) never happens at a window root.
      setSlotContent: (currentContentId, _instance, newContentId): void => {
        if (newContentId) agent.emit({ kind: 'repoint-root', currentContentId, newContentId })
      },
      moveWithin: () => false,
      extract: () => null,
      inject: () => {},
      slotFor: () => null,
    }
    registerContainer(this.contentEl, placement)
  }

  /** Reflect a config change IN PLACE (the authority decided reflect, not remount). Requires the record
   *  to have registered an inbound handler; the authority's reflect-vs-remount decision guarantees it. */
  private reflect(id: string, config: unknown): void {
    const record = this.mounted.get(id)
    if (record?.inbound) record.inbound(config as OpaqueConfig)
    // A reflect with no inbound handler means the authority's decision and the surface diverged; the
    // authority only sends reflect for a registered leaf, so this is a no-op rather than a remount here.
  }

  /** THE registration seam. Every mounted record — the window-root content (`mount`) AND a nested child
   *  (`mountChild`) — enters `this.mounted` HERE, keyed by its record id. `buildHost` wires the record's
   *  proxied channels keyed by that SAME id and emits its capabilities to the authority, so a record NOT
   *  registered here is one the authority believes handles intents / follows selection but the surface can
   *  never dispatch to (every command lookup is `this.mounted.get(recordId)`). Paired with `unmountRecord`,
   *  the sole teardown — so root and child share one register + one unregister, never a per-path divergence. */
  private registerMounted(recordId: string, record: MountedRecord): void {
    this.mounted.set(recordId, record)
  }

  private unmountRecord(id: string): void {
    const record = this.mounted.get(id)
    if (!record) return
    this.mounted.delete(id)
    record.onUnmount?.()
    if (this.lastFocusedId === id) this.lastFocusedId = null
    // Clear the publisher maps too — a record populates both (nodeIdOf / publisherOf), so leaving them behind
    // orphans one map on a remount. Benign (a dead publisher is never re-queried), but a per-remount leak.
    const publisher = this.nodeIdToPublisher.get(id)
    if (publisher !== undefined) {
      this.nodeIdToPublisher.delete(id)
      this.publisherToNodeId.delete(publisher)
    }
    try {
      record.dispose()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`mount agent: unmounting "${id}" threw`, err)
    }
    // Close-guard hygiene: `dispose()` normally unregisters the projection's guard (emitting `drop`). If a
    // guard outlived its projection, drop it from the tree + tell the authority, so no stale proxy lingers.
    if (this.guardCounts.has(id)) {
      this.guardCounts.delete(id)
      if (publisher !== undefined) this.closeGuardTree.dropNode(publisher)
      this.emit({ kind: 'close-guard-capability', id, op: 'drop' })
    }
  }

  /**
   * Build the layered proxied MountHost for one record. Reuses `createInProcessMountHost` (which wires
   * engine-direct + the local per-window singletons) and substitutes PROXIED channels for
   * intent / focus / selection / config, so those cross to the authority via events.
   */
  private buildHost(id: string, config: OpaqueConfig | undefined, record: MountedRecord, windowRoot: boolean, publisher: PublisherId): MountHost {
    const compositionId = (): string => this.init.compositionId ?? ''

    // PROXIED intent: fire reports up (routing is the authority's job); handle keeps the
    // declared handler so the authority delivers cross-window.
    const intent: IntentChannel = {
      fire: (payload) => {
        // Tag the CURRENT causal pass — set by `commitIntent` when this fire is nested inside a commit the
        // authority sent under a pass — so the authority resumes that pass (the cross-window cycle guard).
        // `emit` flushes pending focus/selection first, so a focus reported before this fire is applied first.
        this.emit({ kind: 'intent-fired', id, intent: payload, cause: currentCause() })
        return false // fire-and-forget across the boundary; "nothing claimed" becomes a host signal
      },
      handle: (type, handler) => {
        record.intentHandlers.set(type, handler)
        // Report the capability UP so the authority registers a REMOTE-candidate stub for this record — the
        // seam that makes a fired intent route across the window boundary to this handler.
        this.emit({ kind: 'capability', id, intentType: type, op: 'add' })
        return () => {
          record.intentHandlers.delete(type)
          this.emit({ kind: 'capability', id, intentType: type, op: 'drop' })
        }
      },
    }
    // PROXIED focus: `report` reports the record focused UP (the authority feeds its ONE cross-window FocusTree,
    // so focus-MRU spans windows; COALESCED latest-wins per frame). `activePane` / `watchActive` (the RING)
    // deliver THIS window's scoped active pane the authority pushed, gated by this window's OS-focus —
    // so a floated container renders its own ring and only the OS-focused window shows one.

    const focus: FocusChannel = {
      report: () => this.reportFocus(id),
      activePane: () => this.gatedActivePane(),
      watchActive: (listener) => {
        this.activePaneListeners.add(listener)
        listener(this.gatedActivePane())
        return () => this.activePaneListeners.delete(listener)
      },
    }
    // PROXIED selection: publish up (bubbles the authority's cross-window SelectionTree, COALESCED); follow
    // registers the callback AND (on the first follower for this record) tells the authority to deliver its
    // enclosing container's selection DOWN via `selection-deliver`, so a follower sees selection from a
    // container in ANOTHER window.
    const selection: SelectionChannel = {
      publish: (value) => this.publishSelection(id, value),
      follow: (onValue) => {
        const first = record.selectionFollowers.size === 0
        record.selectionFollowers.add(onValue)
        if (first) this.emit({ kind: 'selection-follow', id, op: 'follow' })
        return () => {
          record.selectionFollowers.delete(onValue)
          if (record.selectionFollowers.size === 0) this.emit({ kind: 'selection-follow', id, op: 'unfollow' })
        }
      },
    }
    // saveConfig round-trips to the authority (the single writer applies it to the pool record).
    const saveConfig = (next: OpaqueConfig): void => this.emit({ kind: 'config-changed', id, config: next })

    // THE PROXIED BINDING. A floated surface is in another process, so its channels EMIT
    // `SurfaceEvent`s (intent/focus/selection/config cross to the authority) and its handlers register as
    // async remote candidates; capabilities the surface does not own are stubbed/absent. The direct twin is
    // the authority's `makeHost`. Same assembly (`createInProcessMountHost`), the other binding.
    return createInProcessMountHost({
      // Common / per-window.
      entryPath: this.init.entryPath,
      engineReady: createEngineReadiness(this.init.entryPath),
      members: this.members,
      viewState: this.viewStateBus.forPublisher(publisher),
      preview: getPreviewSurface(),
      listProjections: () => this.discovery.map((d) => d.typeName),
      // describeProjections: the DESCRIBED set (type + kinds + meta), mirroring the main window's builder. A
      // container reads it for placeholder candidates (empty-slot picker) + swap targets — without it a
      // floated container's empty pane reads "no placeholder projection installed".
      describeProjections: () => this.discovery.map((d) => ({ type: d.typeName, repo: d.repo, kinds: d.kinds, meta: d.meta })),
      // viewerDefaults / slotDefaults: composition-GLOBAL near-static values, PROXIED from the authority via
      // SurfaceInit — so a floated container resolves the SAME default viewer + placeholder the main window
      // does. A composition with no defaults yields an empty list / undefined, exactly like the main host.
      viewerDefaults: this.init.viewerDefaults ? () => this.init.viewerDefaults ?? [] : undefined,
      slotDefaults: this.init.slotDefaults !== undefined ? () => this.init.slotDefaults : undefined,
      // Per-record.
      config,
      instanceId: id, // the pane's stable id — the terminal keeps its xterm by this
      windowRoot, // true only for the surface's root content; a nested child is not a window root
      // Main-backed view-state is keyed by composition and record id, so it follows a pane across windows.
      viewStore: createViewStore(compositionId, id),
      terminal: createTerminalChannel(compositionId, id),
      // setTransient's local display index is per-window; the pool side lives at the authority, so
      // forward the declaration UP as a `set-transient` event (a floated preview is dropped at serialize too).
      openSurfaces: makeOpenSurfaces(publisher, (surfaceId, transient) => this.emit({ kind: 'set-transient', id: surfaceId, transient })),
      // CO-LOCATION channels — PROXIED over the wire.
      // children: a floated CONTAINER mounts its child panes through here — recursively, so
      // arbitrary nesting (bento -> tabs -> panes) assembles on the surface.
      children: this.childrenSurface(publisher),
      intent,
      focus,
      selection,
      // CLOSE-GUARD (close-removal lifecycle, cross-window): registers locally + reports presence UP, so the
      // authority (the sole committer / reaper) gathers this floated pane's guard over the wire before reaping.
      closeGuard: this.closeGuardFor(id, publisher),
      saveConfig,
      // onOwnConfigChange: register the reflect-in-place inbound handler for this record.
      onOwnConfigChange: (cb: (config: OpaqueConfig) => void) => {
        record.inbound = cb
        return () => {
          if (record.inbound === cb) record.inbound = null
        }
      },
      // CO-LOCATION capabilities — a surface never drives the daemon (the authority's main window does) nor
      // owns the composition write path nor a bar's chrome aggregation: inert stubs / absent.
      daemon: createDaemonControl(() => ({ binaryPath: '', entryPath: this.init.entryPath }), () => {}),
      mcp: createMcpControl(() => ({ binaryPath: '', entryPath: this.init.entryPath })),
      commitComposition: undefined,
      compositionEdit: undefined,
      listContributions: () => [],
      subscribeContributions: listener => {
        this.discoveryListeners.add(listener)
        return () => { this.discoveryListeners.delete(listener) }
      },
    })
  }

  /** Mint a publisher for a mounted node, indexed by its stable `^:` so a container can map a firer /
   *  focused publisher back to a pane. */
  private mintPublisher(nodeId: string): PublisherId {
    const publisher = `surface-${++this.publisherSeq}` as PublisherId
    if (nodeId) {
      this.nodeIdToPublisher.set(nodeId, publisher)
      this.publisherToNodeId.set(publisher, nodeId)
    }
    return publisher
  }

  /**
   * The `children` surface for a mounted node. `portalActive` is FALSE, so a container mounts its child
   * panes THROUGH `mount` (the non-portal path in `PaneProjection`) with the child's inline config — the
   * authority sends the fully-resolved subtree, so every child config arrives inline and no surface pool
   * is needed to RENDER (a structural EDIT from the surface is the proxied-pool concern of ).
   * Recursive: a mounted child's own host carries this same surface, so a bento -> tabs -> panes tree
   * assembles to arbitrary depth.
   */
  private childrenSurface(_ownerPublisher: PublisherId): MountHost['children'] {
    return {
      mount: (slot, child) => this.mountChild(slot, child),
      nodeIdOf: (publisher) => this.publisherToNodeId.get(publisher),
      publisherOf: (nodeId) => this.nodeIdToPublisher.get(nodeId),
      locate: () => undefined,
      portalActive: () => false,
      // THE PROXIED POOL: a floated container reads its subtree from the mirrored cache and
      // PROPOSES structural edits UP. Without this a container's `makePoolEdit` returned undefined and its
      // drops fell to the mutating fallback.
      pool: this.surfacePool(),
    }
  }

  /** Mount a nested child pane on this surface (a floated container's child). Mirrors the runtime's
   *  `mountChild`, but the child's host is the layered proxied one, so its config / intents / focus /
   *  selection cross to the authority exactly as the root content's do. */
  private async mountChild(
    slot: HTMLElement,
    child: { id: string; config?: OpaqueConfig; onChildConfigChange?: (next: OpaqueConfig) => void; nodeId?: string },
  ): Promise<{ publisher: PublisherId; unmount: () => void }> {
    return this.mountAt(slot, child, false)
  }

  private async mountAt(
    slot: HTMLElement,
    child: { id: string; config?: OpaqueConfig; nodeId?: string },
    windowRoot: boolean,
    isAlive: () => boolean = () => slot.isConnected,
  ): Promise<{ publisher: PublisherId; unmount: () => void }> {
    const registration = registrationFor(this.discovery, child.id)
    if (!registration) throw new Error(`No projection type "${child.id}" in the workspace`)
    const id = child.nodeId ?? child.id
    return mountReloadableProjection({
      id, registration,
      consent: () => this.closeGuardTree.gatherAmong([...this.mounted.entries()]
        .filter(([, record]) => record.slot && slot.contains(record.slot))
        .flatMap(([recordId]) => this.nodeIdToPublisher.get(recordId) ?? [])),
      mount: (module, onUnmount) => {
        if (!isAlive()) throw new Error('The projection mount site is no longer available')
        const registered = module.default
        const exp = registration.export ?? 'mount'
        if (!isDefinedProjection(registered)) throw new Error(`Projection "${child.id}" is not registered through defineProjection`)
        const mountFn = (registered as LoadedModule)[exp]
        if (typeof mountFn !== 'function') throw new Error(`Projection "${child.id}" has no "${exp}" surface`)
        const record: MountedRecord = { typeName: child.id, slot, onUnmount, dispose: () => {}, inbound: null, intentHandlers: new Map(), selectionFollowers: new Set() }
        const publisher = this.mintPublisher(id)
        const host = this.buildHost(id, this.poolCache.get(id) ?? child.config, record, windowRoot, publisher)
        this.registerMounted(id, record)
        slot.style.isolation = 'isolate'
        try {
          const dispose = (mountFn as (slot: HTMLElement, host: MountHost) => (() => void) | void)(slot, host)
          record.dispose = typeof dispose === 'function' ? dispose : () => {}
        } catch (error) { this.unmountRecord(id); throw error }
        if (windowRoot) {
          this.onRoot?.({ host, label: bareTypeName(child.id).replace(/-pane$/, '') || 'root', id })
          this.ensureRootPlacement(id)
        }
        return { publisher, unmount: () => { if (this.mounted.get(id) === record) this.unmountRecord(id) } }
      },
    })
  }
}
