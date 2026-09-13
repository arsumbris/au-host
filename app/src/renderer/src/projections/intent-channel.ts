// The host-side intent channel: the implementation behind `host.intent`.

// The COMMAND sibling of the (state) focus + selection channels. A projection FIRES
// a typed intent; a container DECLARES a capability (which intent types it handles);
// the host ROUTES the intent to a capable handler — with the firer's id, so the
// handler can act on who fired it (e.g. promote that tab).

// Payload-OPAQUE: the host reads only the `type` discriminant (to match capabilities)
// and the `dispatch` routing tag. It never interprets the payload. The `intent`
// vocabulary lives in a first-party package (`@arsumbris/intent`).

// ROUTING (the responder-chain model).

// A routed intent's `dispatch` picks the strategy:
// - AMBIENT (open / reveal): candidates = every capable handler tree-wide, ORDERED
//   most-recently-focused first (tree-proximity tie-break). Delivered in order until one CLAIMS.
//   A composition's declared routing (`intent-defaults`, injected via `setCandidateScoper`)
//   may SCOPE this set per intent type — priority (declared first, then the rest) or whitelist
//   (only the declared).
// - FIRER-RELATIVE (promote / split): the firer's-ancestors walk (its OWN container).
// A handler CLAIMS by returning `true`/nothing, or DECLINES by returning `false` (the
// walk then continues). None claiming → the `unhandled` hook (the open floor / warning, or no-op).

// "Reveal a pane, or open one" is FIRER-ORCHESTRATED, not an in-routing backstop: the firer
// fires an ambient reveal (each container reveals its own pane or declines); if `fire` returns
// unclaimed (no container held it), the firer fires `open-pane`. A router-forced "root last"
// was rejected — it would fight MRU when the root is legitimately the most-recently-focused.

import { reportHostDiagnostic, beginPass, endPass, currentCause, resumeCause, event, on } from '@arsumbris/au-host-sdk'
import type { PublisherId } from '@arsumbris/au-host-sdk'

import type { IntentChannel, IntentPayload } from './host-config'
import type { CommitOutcome } from './surface-protocol'

// A handler is a `{ claim, commit }` pair (gather-then-commit). `claim` is a PURE side-effect-free
// predicate — "would you take this?" — the host GATHERS it (safe to over-ask, in parallel, across a
// window). `commit` is the ATOMIC act, run ONLY on the winner (routed) or every capable handler
// (broadcast). A LOCAL handler's claim is a sync boolean; a REMOTE-candidate stub's claim returns a
// PROMISE (it asks the surface over the wire) — the walk gathers claims and goes async only
// when one is a promise, so a same-window dispatch stays fully synchronous.
//
// `commit`'s return mirrors `claim`'s async axis. A LOCAL handler acts synchronously and returns
// void (or THROWS to signal "could not act"). A REMOTE stub, when the caller passes `ack` (only the routed
// re-home site, `commitFirstClaimer`, does), returns a PROMISE that resolves whether the surface ACTED —
// so a remote winner that closed between its claim-reply and the commit resolves `false` and the loop
// RE-HOMES, rather than being silently lost. `ack` is opt-in per call site: a broadcast / wired / aimed
// commit never re-homes, so it never asks, and a remote commit there stays fire-and-forget (void). Only
// the internal `Handler` carries `ack` and the promise return; the SDK `IntentHandler` a projection writes
// is the plain 2-arg `(intent, from) => void`, assignable here (a local handler ignores `ack`).
//  + the gather-then-commit design's commit-failure fallback.
interface Handler {
  claim: (intent: IntentPayload, from: PublisherId) => boolean | Promise<boolean>
  // A LOCAL handler acts synchronously (void). A REMOTE stub, when `ack`, returns the cross-window commit
  // OUTCOME promise (acted / declined / timeout) the re-home reads; without `ack` it is fire-and-forget void.
  commit: (intent: IntentPayload, from: PublisherId, ack?: boolean) => void | Promise<CommitOutcome>
}

const isPromise = (v: unknown): v is Promise<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'

interface Capability {
  owner: PublisherId
  handler: Handler
}

/** A STRUCTURAL, deterministic key for an opaque value (sorted keys, so field order never matters).
 *  The kernel stays value-vocab-free: this is blob-EQUALITY for cycle-dedup, never interpretation. */
function stableKey(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`).join(',')}}`
}

/** The payload identity of an intent — everything the FIRER supplied, minus the framework-owned routing
 *  metadata (`type` keys the cycle set separately; `kind`/`dispatch` are stamped from the type-def). Two
 *  intents with the same payload share a key, so `open(F)` returning to its firer is a detectable cycle,
 *  while `open(G)` (a different file) is a legitimate onward hop. */
function payloadKey(intent: IntentPayload): string {
  const { type: _t, kind: _k, dispatch: _d, ...rest } = intent as unknown as Record<string, unknown>
  return stableKey(rest)
}

/** The ONE canonical cycle-guard key for a `(node, intentType, payload)` triple. Used by every guard site
 *  (re-fire refusal, delivery skip, the `cyclesBack` read), so the fired/handled sets can never disagree on
 *  a delimiter. (Before this there were two spellings — a `\0` key and a space key — so `cyclesBack` never
 *  matched a `deliver` entry and the delivery-side loop-breaker was dead.) `\0` cannot appear in a
 *  publisher id or a bare intent type, so it is an unambiguous separator; `payloadKey` is already escaped. */
function guardKey(node: PublisherId, type: string, key: string): string {
  return `${node}\0${type}\0${key}`
}

/**
 * A DISPATCH PASS — the async-scoped guard context for one top-level fire and everything it causes.
 *
 * The cycle-guard state lives HERE, on a per-pass object, not on the `IntentTree` instance — so two passes
 * that interleave on an `await` (window A's walk suspended while window B fires) never share or clobber each
 * other's guard, and a pass's sets are reclaimed when the pass ends (no global depth counter to leak). The
 * pass is found by nested fires through the tree's ambient `currentPass` pointer, which is RELEASED around
 * each suspension (so a fire arriving during a suspended await is correctly seen as a new top-level pass,
 * not a nested one) and restored for the synchronous continuation.
 *  - `fired`:   `guardKey` of each `(node, type, payload)` a node FIRED — refuses an exact self re-fire.
 *  - `handled`: `guardKey` of each a node HANDLED (received) — the delivery skip (`cyclesBack`) reads this,
 *               so the ORIGIN (fired, not yet handled) claims its own fire once while a real loop still breaks.
 * `cause` is the event-substrate dispatch-pass id, captured so an async continuation re-threads its traces.
 */
class DispatchPass {
  readonly fired = new Set<string>()
  readonly handled = new Set<string>()
  constructor(readonly cause: number | undefined) {}
}

/**
 * Scope + partition the ambient candidate set for one intent, per the composition's
 * declared routing (`intent-defaults`). Given the intent type, the FIRER, and the capable
 * owners, returns the declared PREFERRED owners (targets whose kind a rule names) and the
 * REST (the remaining capable owners), plus the scope MODE — `priority` (declared first,
 * then the rest), `whitelist` (only the declared), or `block` (EXCLUDE the declared, the
 * rest routes as usual). The FIRER is passed so a rule may CONDITION on the firer's kind
 * (`intent-default.source`): a rule whose `source` the firer does not play is inert. null →
 * no rule for this intent (unscoped: today's global focus-MRU). Injected by the runtime,
 * which owns the role→owner resolution by type-closure; the tree stays a pure orderer.
 *
 */
type CandidateScoper = (
  intentType: string,
  from: PublisherId,
  owners: PublisherId[],
  scopeId: string,
) => { preferred: PublisherId[]; rest: PublisherId[]; mode: 'priority' | 'whitelist' | 'block' } | null

/**
 * Resolve the EXPLICIT wire for one fired intent (the switchboard override). Given the firer + the
 * intent type, return the wired RECIPIENTS (already mapped to LIVE publishers) plus the wire's mode,
 * or null when no `intent-wire` governs this (source, intent). The runtime owns the pool-id↔publisher
 * mapping (the portal bridge); the tree stays a pure deliverer.
 *
 */
type WireResolver = (
  from: PublisherId,
  intentType: string,
) => { recipients: PublisherId[]; mode: 'strict' | 'fallback' } | null

export class IntentTree {
  // intent type -> the nodes that handle it (each with its handler).
  private readonly capabilities = new Map<string, Set<Capability>>()
  // intent type -> the nodes that have FIRED it this session (for the layout-inspector census). A
  // distinct SET, accumulated: the live candidate set, orthogonal to routing order.
  private readonly firedTypes = new Map<string, Set<PublisherId>>()
  // intent type -> the id of the LAST node that fired it (overwritten each fire), for the census's
  // "actual (last)" view — distinct from the accumulated `firedTypes` set above.
  private readonly lastFiredBy = new Map<string, PublisherId>()
  // Focus ranker: given candidate owner ids, return them MOST-RECENTLY-FOCUSED first.
  // null → fall back to tree-proximity order alone.
  private focusRank: ((candidates: PublisherId[]) => PublisherId[]) | null = null
  // Ambient candidate scoper: the composition's declared `intent-defaults` partition the
  // capable owners into declared-preferred + the rest (priority), admit only the declared
  // (whitelist), or EXCLUDE the declared (block). A rule may condition on the firer's kind
  // (`source`). null (no rule for this intent) → the plain focus-MRU walk over all owners.
  // Injected by the runtime.
  private scopeCandidates: CandidateScoper | null = null
  // RUNG 2 — per-(node, intent) ambient reachability (`intent-reach` / wire-only opt-out). Returns FALSE for a
  // node the composition closed to AMBIENT delivery of this intent; such a node is excluded from the ambient
  // candidate set (routed-ambient walk + broadcast fan-out) but STILL reached by an explicit wire
  // (`deliverWired` never consults this). Injected by the runtime (it owns the pool-id↔publisher map). null
  // (never injected) → everything is ambient-reachable, today's behaviour. Runs BEFORE the scoper (rung 3).
  private ambientReachable: ((node: PublisherId, intentType: string) => boolean) | null = null
  // WHY a capable handler was skipped from the ambient walk (aimed-only / reach-closed / …), for the TRACE
  // only — so "the editor is here, why didn't it open?" reads as a named reason. Never affects routing.
  private ambientExclusionReason: ((node: PublisherId, intentType: string) => string | undefined) | null = null
  // Fallback for a fired intent that no candidate CLAIMS. The authority sets this to surface the miss
  // (the open floor, or the unhandled-warning). null = no-op.
  private unhandled: ((intent: IntentPayload, from: PublisherId) => void) | null = null
  // A node's DECLARED handled-intent set (its type-def's `handles-intent-meta`), resolved by the runtime
  // from the node's projection type. `undefined` = not a discovered projection (a host-owned node,
  // or an unknown type), which is EXEMPT — the rule is about projections declaring what they handle.
  // Injected; null (never injected) leaves the gate off. See `handle` for the rung-3 warning.
  private declaredHandlesOf: ((node: PublisherId) => string[] | undefined) | null = null
  // A node's DECLARED fired-intent set (its type-def's `fires-intent-meta`), resolved by the runtime
  // from the node's projection type. The MIRROR of `declaredHandlesOf`. `undefined` = not a discovered
  // projection (a host-owned node, or an unknown type), which is EXEMPT. Injected; null leaves the gate
  // off. See `fire` for the rung-3 warning.
  private declaredFiresOf: ((node: PublisherId) => string[] | undefined) | null = null
  // A node's PROJECTION-TYPE name, for naming the subject in a diagnostic message — the tree knows only
  // opaque publisher ids, so the runtime injects the id→type map it owns. `undefined` = a host-owned /
  // unknown node. Diagnostics only: it never affects routing. Injected; null leaves messages un-named.
  private describeNode: ((node: PublisherId) => string | undefined) | null = null
  // A payload-aware SUBJECT describer for the trace ONLY (the file an open targets, a pane, …). The tree
  // stays payload-opaque for ROUTING; this is a debug-surface describer the runtime injects (it owns the
  // intent vocab). `undefined` for an intent with no meaningful subject. Never affects dispatch.
  private describeIntent: ((intent: IntentPayload) => string | undefined) | null = null
  // The switchboard wire resolver: the composition's explicit `intent-wires` override for a fired
  // intent. Returns the wired recipients (live publishers) + mode, or null (no wire → default routing).
  // Injected by the runtime, which owns the pool-id↔publisher mapping. See `dispatch` for the override.
  private resolveWire: WireResolver | null = null
  // THE CYCLE GUARD, payload-keyed + causal
  // ASYNC-SCOPED per DISPATCH PASS (see `DispatchPass`). The guard state lives on the pass object, found by
  // nested fires through this ambient pointer:
  //  - `currentPass` is the pass a synchronous fire is running inside, or `null` at the top level. A fire
  //    with `currentPass === null` is a NEW top-level pass (fresh guard); a fire with it set is NESTED and
  //    joins that pass. The async walk RELEASES this to `null` around each suspension and restores it on
  //    resume, so an interleaving fire during a suspended remote hop is correctly a new top-level pass —
  //    it never inherits the suspended pass's cause or guard sets.

  private currentPass: DispatchPass | null = null
  // CROSS-WINDOW CAUSAL PASSES. A pass that commits to a REMOTE surface is RETAINED here by its cause id
  // (`retainCurrentPass`, called by the authority's cross-window commit), so a nested fire coming back UP
  // over the wire (`fireContinuation`, carrying that cause) RESUMES the same pass — its guard sets then span
  // the window boundary and a commit→fire→commit cycle A→B→A is broken, not just warned. A same-window pass
  // is never retained (its cause never crosses the wire). Bounded by a TTL sweep: a retained pass whose chain
  // never continues (the surface commit fired nothing) is dropped after the round-trip window.
  private readonly passesByCause = new Map<number, { pass: DispatchPass; expires: number }>()
  private static readonly CAUSAL_PASS_TTL_MS = 10_000
  // ASYNC-ECHO SURFACE: the last (intent → payloadKey + time) each node HANDLED. A top-level fire that
  // echoes a recent handle is a probable ASYNC relay cycle the synchronous guard cannot see (the fire is
  // outside the causal pass), so the host WARNS — a footgun surfaced for an external author, never
  // suppressed.
  private readonly lastHandled = new Map<PublisherId, Map<string, { key: string; t: number }>>()
  private static readonly ASYNC_ECHO_WINDOW_MS = 2000
  // The delivery observer (the switchboard's live flow viz + the cross-window window-raise). Notified on
  // every actual delivery, with the intent's `kind` so the authority can raise a routed target's window
  // without raising on a passive broadcast fan-out.
  private onDeliver: ((from: PublisherId, to: PublisherId, type: string, viaWire: boolean, kind: string) => void) | null = null
  // NESTED-SCOPE DISPATCH. A node's enclosing composition scope, and the firer's scope
  // CHAIN (innermost first, out to the entry). Injected by the runtime from the cross-file scope table.
  // Null (no nesting / never injected) → the flat global ambient walk, today's behaviour. When present,
  // the ambient walk is scope-partitioned: the firer's scope claims first, an unclaimed intent BUBBLES
  // to the parent scope, and a SIBLING nested scope is never a candidate (a nested composition governs
  // its own subtree).
  private scopeOf: ((node: PublisherId) => string) | null = null
  private scopeChainOf: ((from: PublisherId) => string[]) | null = null
  constructor(private readonly parentOf: (id: PublisherId) => PublisherId | null) {}

  /** Inject the ordered focus ranker (most-recently-focused first). */
  setFocusRanker(rank: (candidates: PublisherId[]) => PublisherId[]): void {
    this.focusRank = rank
  }

  // A FALLBACK node is a host-global handler (e.g. the host command node saving the composition) that must
  // be the LAST resort in an ambient walk: any real mount-tree handler claims ahead of it, and it runs only
  // if none did. Without this, a synthetic host node fired-from-nearby (a keybind → `host:palette`) wins
  // proximity over a focused pane, so ⌘S in a focused editor would save the COMPOSITION, not the file.
  private isFallbackNode: ((node: PublisherId) => boolean) | null = null

  /** Inject the fallback-node predicate — a host-global handler ordered last in every ambient walk. */
  setFallbackNode(fn: (node: PublisherId) => boolean): void {
    this.isFallbackNode = fn
  }

  /** Inject the ambient candidate scoper (the composition's declared intent routing). */
  setCandidateScoper(scoper: CandidateScoper): void {
    this.scopeCandidates = scoper
  }

  /** Inject the per-(node, intent) ambient-reachability predicate (rung 2 / `intent-reach` wire-only). */
  setAmbientReachable(fn: (node: PublisherId, intentType: string) => boolean): void {
    this.ambientReachable = fn
  }

  /** Inject the ambient-exclusion REASON describer (trace only; the mirror of `setAmbientReachable`). */
  setAmbientExclusionReason(fn: (node: PublisherId, intentType: string) => string | undefined): void {
    this.ambientExclusionReason = fn
  }

  /** Inject a fallback for intents no candidate claims (cross-window relay). */
  setUnhandled(handle: (intent: IntentPayload, from: PublisherId) => void): void {
    this.unhandled = handle
  }

  /** Inject the resolver from a node to its type-def's declared `handles` set. The gate in `handle`
   *  uses it to flag a registration the type-def does not declare. */
  setDeclaredHandles(resolve: (node: PublisherId) => string[] | undefined): void {
    this.declaredHandlesOf = resolve
  }

  /** Inject the resolver from a node to its type-def's declared `fires` set. The gate in `fire`
   *  uses it to flag a fire the type-def does not declare. The mirror of `setDeclaredHandles`. */
  setDeclaredFires(resolve: (node: PublisherId) => string[] | undefined): void {
    this.declaredFiresOf = resolve
  }

  /** Inject the node→projection-type-name map, so a declaration-gate warning can NAME which projection
   *  tripped it (the tree itself only holds opaque publisher ids). Diagnostics only; never affects routing. */
  setNodeDescriber(describe: (node: PublisherId) => string | undefined): void {
    this.describeNode = describe
  }

  /** Inject the trace SUBJECT describer (the file an open targets, …). Debug-surface only; the tree stays
   *  payload-opaque for routing. See `describeIntent`. */
  setIntentDescriber(describe: (intent: IntentPayload) => string | undefined): void {
    this.describeIntent = describe
  }

  /** Inject the switchboard wire resolver (the composition's explicit `intent-wires` override). */
  setWireResolver(resolve: WireResolver): void {
    this.resolveWire = resolve
  }

  /**
   * Inject the nested-scope maps: a node's enclosing scope, and the firer's scope chain
   *  (innermost first, out to the entry). Turns the ambient walk scope-partitioned + inner-first.
   */
  setScopes(scopeOf: (node: PublisherId) => string, scopeChainOf: (from: PublisherId) => string[]): void {
    this.scopeOf = scopeOf
    this.scopeChainOf = scopeChainOf
  }

  /** Inject a DELIVERY OBSERVER: notified `(from, to, type, viaWire)` each time an intent reaches a
   *  handler. The runtime translates it to pool-ids for the switchboard's live flow animation — a pulse
   *  travels the cable an intent is actually routed over. Payload-opaque (only the `type` is passed). */
  setDeliveryObserver(fn: (from: PublisherId, to: PublisherId, type: string, viaWire: boolean, kind: string) => void): void {
    this.onDeliver = fn
  }

  /**
   * AIMED delivery — deliver an intent to ONE named recipient, bypassing the ambient walk AND the
   * routing rules (wires / defaults / MRU). The HOST calls this when it has ALREADY resolved the
   * target: the open chooser's "replace this viewer" pick reaches a `handlesTargeted` handler that is
   * deliberately NOT an ambient candidate (`isAmbientReachable` excludes it). Returns whether the
   * target HANDLED it (a non-decline); false if the target registered no handler for this intent type.
   * The cycle machinery still applies, so an aimed delivery cannot re-enter a node mid-pass.
   *
   */
  deliverAimed(target: PublisherId, intent: IntentPayload, from: PublisherId): boolean {
    const caps = this.capabilities.get(intent.type)
    const handler = caps ? [...caps].find((c) => c.owner === target)?.handler : undefined
    if (!handler) return false
    const key = payloadKey(intent)
    // AIMED delivery is a dispatch pass entry point too — a top-level aimed delivery opens its own pass, a
    // nested one (aimed from inside a handler) joins the current pass, so a viewer/placement decision the
    // target makes threads to this cause. Synchronous: the aimed target is a locally-resolved handler (the
    // chooser's "replace this viewer"); a REMOTE aimed target lands with remote candidates.
    const outer = this.currentPass
    const pass = outer ?? this.newPass()
    return this.runInPass(pass, () => {
      if (on('intent')) event('intent', 'aimed', { type: intent.type, subject: this.describeIntent?.(intent), from, fromLabel: this.describeNode?.(from), to: target, toLabel: this.describeNode?.(target) })
      if (this.cyclesBack(pass, target, intent.type, key)) return false
      // CLAIM the aimed target, then COMMIT if it takes it. A remote aimed target returns a
      // promise — commit fire-and-forget on the resolved claim; `deliverAimed`'s sync boolean reports false.
      const claimed = handler.claim(intent, from)
      if (isPromise(claimed)) {
        // A remote stub `claim` can REJECT (its surface went away between resolve and delivery). Decline on
        // reject rather than surfacing an unhandled rejection off this fire-and-forget path — the same floor
        // `gatherClaims` applies with its `.catch(() => false)`.
        void claimed.catch(() => false).then((c) => { if (c) this.runInPass(pass, () => this.commitOne(pass, target, handler, intent, from, key, true, false)) })
        return false
      }
      if (!claimed) return false
      return this.commitOne(pass, target, handler, intent, from, key, true, false) // aimed: no fallback (one specific target), so fire-and-forget.
    })
  }

  /**
   * RESOLVE-SEPARABLE-FROM-FIRE — the ordered recipients a fired intent WOULD reach, WITHOUT invoking
   * any handler. Mirrors `dispatch`'s rung ladder: an explicit WIRE's recipients (rung 1), else a
   * BROADCAST's full ambient-reachable capable set, else the ROUTED ordered candidate walk (the same
   * MRU-focus / scope / firer-relative ordering `orderedHandlers` produces for dispatch). Claim/decline
   * cannot be evaluated without invoking, so a routed intent reports the ORDERED CANDIDATES — any
   * prefix may DECLINE at fire time, so the eventual single claimer is not knowable here. Read-only: it
   * touches no pass state and calls no handler, so a projection can ask "who would take this?" for a
   * pre-show affordance. The open chooser reads this for its pre-fire OPEN section + container
   * highlight; the switchboard's predictive default-routing view is a second consumer.
   *  § Resolution is separable from firing.
   */
  resolve(from: PublisherId, intent: IntentPayload): PublisherId[] {
    const caps = this.capabilities.get(intent.type)
    const wire = this.resolveWire?.(from, intent.type) ?? null
    if (wire) {
      // Rung 1: the wire's recipients, kept to those with a LIVE capability for this type (a wire to a
      // node that dropped the port has no handler). A `fallback` wire's MRU tail is claim/decline-
      // dependent, so resolution reports the explicit targets — the wire's own first-order answer.
      const owners = new Set(caps ? [...caps].map((c) => c.owner) : [])
      return wire.recipients.filter((r) => owners.has(r))
    }
    if (!caps || caps.size === 0) return []
    if (intent.kind === 'broadcast') {
      // Broadcast fans out to every capable owner, minus those closed to ambient (rung 2); no ordering.
      const owners = [...new Set([...caps].map((c) => c.owner))]
      return this.ambientReachable ? owners.filter((o) => this.ambientReachable!(o, intent.type)) : owners
    }
    // Routed: the ordered candidate walk, owners only (nothing invoked).
    return this.orderedHandlers(from, intent, caps).map(([owner]) => owner)
  }

  /**
   * Register a `{ claim, commit }` handler DIRECTLY (bypassing the projection-facing `IntentChannel`). The
   *  authority uses this to register a REMOTE-candidate STUB whose `claim` returns a PROMISE (it
   *  asks the surface over the wire), which the gather awaits like any claim; `commit` sends the aimed commit
   *  command. A local projection stays on `forNode().handle` (sync claim). See composition.ts.
   */
  registerCapability(node: PublisherId, type: string, handler: Handler): () => void {
    return this.handle(node, type, handler)
  }

  /** The intent surface bound to one view's node. `fire` is FIRE-AND-FORGET (void): a routed intent may
   *  resolve asynchronously (a cross-window gather), so "was it claimed" is not a value the firer reads — it
   *  becomes the host's `unhandled` signal. A HOST caller that genuinely needs the claim outcome uses
   *  `fireReport` (which awaits the real async result), never this. */
  forNode(node: PublisherId): IntentChannel {
    return {
      fire: (intent) => { void this.fire(node, intent) },
      handle: (type, handler) => this.handle(node, type, handler),
    }
  }

  /** Fire from a host-owned node and REPORT the claim outcome — the HONEST shape: a sync boolean for a
   *  same-window dispatch, a PROMISE for a cross-window one (the gather + remote commit resolve later). AWAIT
   *  it (await of a boolean is the boolean), so "claimed" is correct across windows — never a sync false that
   *  LIES for a remote claim. A host caller that must know whether an intent was claimed (the agent bridge's
   *  `fireIntent`) uses this; the projection-facing `forNode().fire` is void (fire-and-forget). */
  fireReport(node: PublisherId, intent: IntentPayload): boolean | Promise<boolean> {
    return this.fire(node, intent)
  }

  /**
   * Deliver a fired intent. Routed commands visit ordered candidates until one claims and return whether
   * one claimed. Broadcast events reach every capable owner without claim ordering or an unhandled relay,
   * and return whether any handler received the event. The type declaration supplies payload `kind`;
   * when absent, delivery defaults to routed.
   */
  private fire(from: PublisherId, intent: IntentPayload, seedPass?: DispatchPass): boolean | Promise<boolean> {
    // Record the SOURCE for the census, regardless of whether anything handles it (a fire with no
    // live handler is still a source — that a type is fired but unhandled is worth SEEING).
    let firers = this.firedTypes.get(intent.type)
    if (!firers) this.firedTypes.set(intent.type, (firers = new Set()))
    firers.add(from)
    this.lastFiredBy.set(intent.type, from) // the single LAST firer, for the "actual (last)" view.

    // THE DECLARED-FIRE GATE — the mirror of the `handle()` gate. A projection should
    // only fire an intent its type-def DECLARES (`fires-intent-meta`), so "who fires X" is a static
    // type-graph fact and the declaration cannot drift silently from the code. An honest author trips this by forgetting the declaration, and
    // nothing is destroyed, so the framework WARNS and proceeds; every in-tree firer declares its set,
    // so the baseline is zero and only GROWTH is surfaced. `undefined` = a host-owned node / unknown
    // type: not a projection subject to the rule, so silent.

    const declaredFires = this.declaredFiresOf?.(from)
    if (declaredFires && !declaredFires.includes(intent.type)) {
      const who = this.describeNode?.(from)
      reportHostDiagnostic({
        code: 'intent-fired-undeclared',
        severity: 'warning',
        message: `${who ? `projection "${who}"` : 'a projection'} fired intent "${intent.type}", which its type-def does not declare in fires-intent-meta; add "${intent.type}" to ${who ?? 'its'} fires-intent-meta so which projection fires which intent is a type-graph fact`,
        subject: intent.type,
        detail: { node: from, projectionType: who, declared: declaredFires },
      })
    }

    const key = payloadKey(intent)
    const outer = this.currentPass
    const topLevel = outer === null

    // ASYNC-ECHO WARNING (footgun surface): a TOP-LEVEL fire that echoes a recent HANDLE of the same
    // intent+payload is a probable ASYNC relay cycle the pass guard cannot see (the fire is outside any
    // pass). Advisory: the author should fire synchronously (so the guard applies) or continue the chain.
    // A SEEDED fire (a cross-window causal continuation, `seedPass`) is exempt: it JOINS the original pass,
    // so the precise cycle guard breaks any loop — the echo heuristic would only cry wolf.
    if (topLevel && !seedPass) {
      const last = this.lastHandled.get(from)?.get(intent.type)
      if (last && last.key === key && performance.now() - last.t < IntentTree.ASYNC_ECHO_WINDOW_MS) {
        reportHostDiagnostic({
          code: 'intent-async-echo',
          severity: 'warning',
          message: `a projection fired intent "${intent.type}" it handled moments ago (an async echo); the cycle guard is synchronous, so fire it SYNCHRONOUSLY (in the handler) or the loop cannot be broken`,
          subject: intent.type,
          detail: { node: from },
        })
      }
    }

    // Determine the pass: a nested fire (inside a handler running in a pass) JOINS the current one; a
    // cross-window causal continuation JOINS the retained `seedPass` (so its guard sets span the window
    // boundary — a commit→fire→commit cycle A→B→A is broken); otherwise a top-level fire MINTS a fresh pass.
    // `runInPass` establishes the pass context (the ambient `currentPass` + the cause) for this synchronous
    // segment and releases it on return.
    const pass = outer ?? seedPass ?? this.newPass()
    const result = this.runInPass(pass, (): boolean | Promise<boolean> => {
      const passKey = guardKey(from, intent.type, key)
      // CYCLE GUARD (re-fire): the same (node, intent, payload) already fired in this pass → refuse (fail
      // closed). The DELIVERY-side skip (`cyclesBack`, keyed on already-HANDLED) breaks the A→…→A cycle.
      if (pass.fired.has(passKey)) {
        reportHostDiagnostic({
          code: 'intent-dispatch-cycle',
          severity: 'warning',
          message: `intent "${intent.type}" was re-fired with the same payload already dispatching in this pass (a wiring cycle); the re-entry was refused`,
          subject: intent.type,
          detail: { node: from },
        })
        return false
      }
      pass.fired.add(passKey)
      if (on('intent')) event('intent', 'fire', { type: intent.type, subject: this.describeIntent?.(intent), from, fromLabel: this.describeNode?.(from), kind: intent.kind ?? 'routed', dispatch: intent.dispatch ?? 'ambient' })
      return this.dispatch(pass, from, intent, key)
    })
    // Return the REAL outcome: a sync boolean for a same-window pass, or the PROMISE for an async cross-window
    // walk. The projection-facing `forNode().fire` discards it (fire-and-forget void); a host caller that
    // must know the outcome awaits it via `fireReport` — so "claimed" is CORRECT across windows, never a
    // sync false that lies for a remote claim.
    return result
  }

  /** Mint a fresh dispatch pass with its own event-substrate cause (a top-level fire). `beginPass`/`endPass`
   *  mint then release a cause id; `runInPass` re-establishes it on the shared cause slot for each sync
   *  segment, so a suspended pass's traces resume under it without an instance-global depth counter. */
  private newPass(): DispatchPass {
    beginPass()
    const cause = currentCause()
    endPass()
    return new DispatchPass(cause)
  }

  /** RETAIN the pass currently dispatching, keyed by its cause id, so a cross-window nested fire can RESUME
   *  it (`fireContinuation`). Called by the authority when a commit crosses to a REMOTE surface (that commit
   *  may fire a nested intent back UP, which must join THIS pass's guard). A no-op with no current pass or
   *  cause. Refreshes the TTL and sweeps expired entries, so the map stays bounded without a timer. */
  retainCurrentPass(): void {
    const pass = this.currentPass
    if (!pass || pass.cause == null) return
    const now = performance.now()
    for (const [c, e] of this.passesByCause) if (e.expires <= now) this.passesByCause.delete(c)
    this.passesByCause.set(pass.cause, { pass, expires: now + IntentTree.CAUSAL_PASS_TTL_MS })
  }

  /** Fire a cross-window nested intent as a CONTINUATION of the causal pass `cause` (threaded over the commit
   *  command and returned on the surface's `intent-fired`). If that pass is still retained, the fire JOINS it
   *  — its guard sets span the window boundary, so a commit→fire→commit cycle A→B→A is broken and the causal
   *  trace tree stays under the one cause. An unknown / expired cause → a fresh top-level fire (the chain had
   *  already settled). The authority calls this for every surface-reported `intent-fired`. */
  fireContinuation(cause: number | undefined, from: PublisherId, intent: IntentPayload): boolean | Promise<boolean> {
    const retained = cause != null ? this.passesByCause.get(cause) : undefined
    // An EXPIRED retained pass must not be resumed: its `handled` set is stale, so resuming it could
    // drop a legitimately-new intent as `cyclesBack`. `retainCurrentPass` sweeps on each retain, but a window
    // that did ONE cross-window commit and no more lingers its pass past the TTL — so check here too, and a
    // continuation after the TTL falls to a fresh top-level fire (the chain had already settled).
    if (!retained || retained.expires <= performance.now()) {
      if (retained) this.passesByCause.delete(cause as number)
      return this.fire(from, intent)
    }
    retained.expires = performance.now() + IntentTree.CAUSAL_PASS_TTL_MS // the chain is live; keep it retained.
    return this.fire(from, intent, retained.pass)
  }

  /** Run one SYNCHRONOUS segment of a dispatch in a pass's context: publish `pass` as the ambient
   *  `currentPass` (a nested fire joins it) and thread the pass's cause onto emitted traces, then RESTORE
   *  both on return. The restore is the release boundary — between sync segments (across a remote `await`)
   *  `currentPass` is back to its outer value (null at the top level), so an interleaving fire during a
   *  suspended remote hop is a new top-level pass, never a nested one. */
  private runInPass<T>(pass: DispatchPass, fn: () => T): T {
    const prev = this.currentPass
    this.currentPass = pass
    try {
      return resumeCause(pass.cause, fn)
    } finally {
      this.currentPass = prev
    }
  }

  /** A recipient is skipped once it has already HANDLED this exact (intent, payload) in the pass, so a
   *  re-fire cannot re-enter a node that already received it (the loop breaker), while the ORIGIN (fired
   *  but not yet handled) is a normal candidate and claims its own fire once. See the self-delivery design. */
  private cyclesBack(pass: DispatchPass, node: PublisherId, type: string, key: string): boolean {
    return pass.handled.has(guardKey(node, type, key))
  }

  /** Record that `node` HANDLED (received) this intent, for the async-echo surface. */
  private recordHandled(node: PublisherId, type: string, key: string): void {
    let m = this.lastHandled.get(node)
    if (!m) this.lastHandled.set(node, (m = new Map()))
    m.set(type, { key, t: performance.now() })
  }

  /**
   * COMMIT one intent to one handler: mark it HANDLED (the pass-scoped causal set + the time-windowed
   *  async-echo record), notify the delivery observer (the switchboard's live flow viz), then run the
   *  handler's `commit`. The causal mark is set BEFORE `commit` runs, so a synchronous re-fire inside the
   *  act cannot re-enter this node (`cyclesBack` sees it as handled). Only a CLAIMED candidate is committed;
   *  `claim` (the pure predicate) never reaches here. Must run inside a `runInPass` (a nested fire joins the
   *  pass; traces thread the cause).
   *
   *  Returns whether the commit ACTED. A `commit` is ATOMIC — it fully takes effect, or it THROWS before any
   *  observable act (a framework rule alongside "claim is pure"). A throw means "I could not act", its state
   *  having changed since the gather (the pane unmounted while a parallel remote claim was still pending): it
   *  is caught, reported (`commit-failed`), and `false` returned, so a ROUTED dispatch RE-HOMES to the next
   *  claimer and a broadcast / wired-widen actor simply did not act — never a double-act, because the atomic
   *  rule guarantees the failed commit left no trace. Catching here also keeps one handler's failure from
   *  tearing down the whole dispatch.
   *
   *  `wantAck` closes the cross-window hole: a REMOTE commit is sent over the wire, so its throw does
   *  not reach here — a remote winner that closed between claim-reply and commit would look like it acted.
   *  When `wantAck` (only `commitFirstClaimer`, the routed re-home site), the remote stub returns a PROMISE
   *  of whether the surface acted; this returns that promise (floored to a decline on reject, and traced),
   *  so `commitFirstClaimer` awaits it and RE-HOMES on `false`. A LOCAL commit stays synchronous regardless
   *  (void → acted); a broadcast / wired / aimed caller passes `wantAck: false` and a remote commit there is
   *  fire-and-forget void (those never re-home). See the gather-then-commit design's commit-failure fallback.
   */
  // Overloads express the invariant: with NO ack requested a commit is fire-and-forget and cannot suspend
  // (a local commit is void, a remote one is void fire-and-forget), so the caller gets a plain `boolean`; only
  // the ack-requesting re-home site can receive a promise.
  private commitOne(pass: DispatchPass, owner: PublisherId, handler: Handler, intent: IntentPayload, from: PublisherId, key: string, viaWire: boolean, wantAck: false): boolean
  private commitOne(pass: DispatchPass, owner: PublisherId, handler: Handler, intent: IntentPayload, from: PublisherId, key: string, viaWire: boolean, wantAck: true): boolean | Promise<CommitOutcome>
  private commitOne(pass: DispatchPass, owner: PublisherId, handler: Handler, intent: IntentPayload, from: PublisherId, key: string, viaWire: boolean, wantAck: boolean): boolean | Promise<CommitOutcome> {
    pass.handled.add(guardKey(owner, intent.type, key))
    this.recordHandled(owner, intent.type, key)
    this.onDeliver?.(from, owner, intent.type, viaWire, intent.kind ?? 'routed')
    const failed = (error: string): false => {
      if (on('intent')) event('intent', 'commit-failed', { type: intent.type, from, owner, ownerLabel: this.describeNode?.(owner), error })
      return false
    }
    try {
      const outcome = handler.commit(intent, from, wantAck)
      // A remote ack is a PROMISE of the cross-window commit outcome (acted / declined / timeout). Return it
      // for `commitFirstClaimer` to decide the re-home (it distinguishes a declined winner, which re-homes,
      // from a timed-out one, which does NOT). A reject (the stub should never reject; it resolves the
      // outcome) is floored to `'declined'`, the safe re-home.
      if (isPromise(outcome)) return (outcome as Promise<CommitOutcome>).catch((): CommitOutcome => 'declined')
      return true // a LOCAL (or fire-and-forget remote) commit that did not throw: it acted.
    } catch (err) {
      return failed(err instanceof Error ? err.message : String(err))
    }
  }

  /** Route a fired intent: the switchboard WIRE-OVERRIDE first (an explicit `intent-wire` replaces the
   *  default recipient selection), else default routing — a BROADCAST fan-out (commit every capable
   *  handler), or the routed GATHER-THEN-COMMIT (order the candidates, gather their pure claims, commit the
   *  FIRST claimer in the authority's order). Wrapped by `fire`'s census + gate + cycle guard. */
  private dispatch(pass: DispatchPass, from: PublisherId, intent: IntentPayload, key: string): boolean | Promise<boolean> {
    const caps = this.capabilities.get(intent.type)
    // THE SWITCHBOARD WIRE-OVERRIDE: an explicit wire for (firer, intent) replaces the default
    // recipient selection — its targets ARE the recipients. A `once` (routed) intent WIDENS to the
    // whole set (all receive), an `all` (broadcast) intent NARROWS to it. No wire → default routing,
    // untouched.
    const wire = this.resolveWire?.(from, intent.type) ?? null
    if (wire) return this.deliverWired(pass, from, intent, wire, caps, key)

    if (!caps || caps.size === 0) {
      // No capable handler mounted. A BROADCAST simply no-ops (an event with no observer);
      // a ROUTED intent falls to the unhandled hook (the open floor / warning, or no-op).
      if (on('intent')) event('intent', 'unhandled', { type: intent.type, from, fromLabel: this.describeNode?.(from), reason: 'no-capable-handler' })
      if (intent.kind !== 'broadcast') this.unhandled?.(intent, from)
      return false
    }
    if (intent.kind === 'broadcast') return this.broadcast(pass, from, intent, caps, key)

    const ordered = this.orderedHandlers(from, intent, caps)
    if (on('intent')) {
      // The capable handlers that were NOT ambient candidates, and WHY (aimed-only / reach-closed / …) — so
      // "an editor is right here, why didn't it take the open?" is answered in the trace.
      const cand = new Set(ordered.map(([o]) => o))
      const excluded = [...new Set([...caps].map((c) => c.owner))]
        .filter((o) => !cand.has(o))
        .map((o) => ({ label: this.describeNode?.(o) ?? o, reason: this.ambientExclusionReason?.(o, intent.type) ?? 'filtered' }))
      event('intent', 'candidates', { type: intent.type, from, owners: ordered.map(([o]) => o), ownerLabels: ordered.map(([o]) => this.describeNode?.(o) ?? o), excluded })
    }
    return this.resolveAndCommit(pass, from, intent, key, ordered)
  }

  /**
   * GATHER the pure claims of a live candidate set, IN the pass. Returns booleans SYNCHRONOUSLY when every
   *  claim is a sync boolean (a same-window dispatch), or a Promise when ANY candidate is remote (its stub's
   *  claim is a promise). The single suspension primitive both the routed walk (`resolveAndCommit`)
   *  and the wired widen (`deliverWired`) share, so the promise-detect / `Promise.all` logic lives in ONE
   *  place. The pass context is RELEASED across the await (an interleaving fire is a new top-level pass); the
   *  synchronous commit that follows re-establishes it via `runInPass`. Because `claim` is side-effect-free,
   *  gathering every candidate (even ones after the winner) is harmless — this is the parallel gather.
   */
  private gatherClaims(pass: DispatchPass, from: PublisherId, intent: IntentPayload, live: Array<[PublisherId, Handler]>): boolean[] | Promise<boolean[]> {
    const claims = live.map(([, h]) => this.runInPass(pass, () => h.claim(intent, from)))
    // A rejected claim (an async claim that threw — a hung/closed remote surface, a buggy predicate) counts
    // as a DECLINE, so one candidate never rejects the whole gather (which would surface as an unhandled
    // rejection off the fire-and-forget void `fire`). Claim is meant to be pure + total; this is the floor.
    if (claims.some(isPromise)) return Promise.all(claims.map((c) => Promise.resolve(c).catch(() => false)))
    return claims as boolean[]
  }

  /** GATHER-THEN-COMMIT for a routed intent. The AUTHORITY keeps the order (`ordered`); it gathers every
   *  live candidate's pure `claim` (sync same-window, remote in parallel), then walks its OWN order and
   *  commits the FIRST claimer. Fully synchronous when every claim is sync; async only when one is a promise. */
  private resolveAndCommit(pass: DispatchPass, from: PublisherId, intent: IntentPayload, key: string, ordered: Array<[PublisherId, Handler]>): boolean | Promise<boolean> {
    const live = ordered.filter(([o]) => !this.cyclesBack(pass, o, intent.type, key)) // skip nodes that already handled (loop breaker).
    const claims = this.gatherClaims(pass, from, intent, live)
    if (Array.isArray(claims)) return this.commitFirstClaimer(pass, from, intent, key, live, claims)
    return claims.then((c) => this.commitFirstClaimer(pass, from, intent, key, live, c))
  }

  /**
   * Walk the authority's order against the gathered claim booleans; commit the FIRST claimer (routed →
   *  exactly one actor), trace the declines, and fall to the `unhandled` hook when none claimed.
   *
   *  The re-home site, so it is the ONE caller that passes `wantAck`: a REMOTE winner's commit
   *  returns a PROMISE of whether the surface acted, so a winner that closed between its claim-reply and the
   *  commit resolves `false` and this RE-HOMES to the rest — the cross-window half of the commit-failure
   *  fallback. A LOCAL winner's commit is synchronous, so a same-window dispatch never suspends; the walk goes
   *  async only once it awaits a remote commit ack, then continues the re-home over the tail (`live.slice`).
   */
  private commitFirstClaimer(pass: DispatchPass, from: PublisherId, intent: IntentPayload, key: string, live: Array<[PublisherId, Handler]>, claims: boolean[]): boolean | Promise<boolean> {
    const claimed = (owner: PublisherId): true => {
      this.runInPass(pass, () => { if (on('intent')) event('intent', 'claim', { type: intent.type, from, owner, ownerLabel: this.describeNode?.(owner) }) })
      return true // CLAIMED and ACTED; stop (one actor for a routed intent).
    }
    for (let i = 0; i < live.length; i++) {
      const [owner, handler] = live[i]
      if (!claims[i]) {
        this.runInPass(pass, () => { if (on('intent')) event('intent', 'decline', { type: intent.type, from, owner, ownerLabel: this.describeNode?.(owner) }) })
        continue
      }
      const committed = this.runInPass(pass, () => this.commitOne(pass, owner, handler, intent, from, key, false, true))
      if (isPromise(committed)) {
        // A REMOTE winner: await its commit OUTCOME. The three cases are distinct:
        //  - ACTED    → done, one actor.
        //  - DECLINED → the winner left NO trace (closed, or its state changed since the gather), so RE-HOME
        //               over the remaining claimers — safe, per the atomic rule.
        //  - TIMEOUT  → the winner is alive-but-SILENT, so whether it acted is UNKNOWN. Re-homing would risk a
        //               DOUBLE-act (a slow-but-alive winner acts AND a second actor is committed), so do NOT
        //               re-home and do NOT open the floor (that too would be a second actor). Surface the miss
        //               as a `commit-timeout` trace and stop (at-most-once).
        const rest = live.slice(i + 1)
        const restClaims = claims.slice(i + 1)
        return (committed as Promise<CommitOutcome>).then((outcome) => {
          if (outcome === 'acted') return claimed(owner)
          if (outcome === 'timeout') {
            this.runInPass(pass, () => { if (on('intent')) event('intent', 'commit-timeout', { type: intent.type, from, owner, ownerLabel: this.describeNode?.(owner) }) })
            return false // the miss is surfaced (a trace); never a second actor, never the open floor.
          }
          // DECLINED: re-home. `commitOne` did not trace this (only a local throw does); trace it here.
          this.runInPass(pass, () => { if (on('intent')) event('intent', 'commit-failed', { type: intent.type, from, owner, ownerLabel: this.describeNode?.(owner) }) })
          return this.commitFirstClaimer(pass, from, intent, key, rest, restClaims)
        })
      }
      if (committed) return claimed(owner)
      // A LOCAL winner's ATOMIC commit FAILED (its state changed since the gather) — it left no trace, so
      // RE-HOME to the next claimer in the authority's order (bounded by the finite claimer list, no
      // double-act). `commitOne` already emitted `commit-failed`.
    }
    this.runInPass(pass, () => { if (on('intent')) event('intent', 'unhandled', { type: intent.type, from, fromLabel: this.describeNode?.(from), reason: 'all-declined-or-failed' }) })
    this.unhandled?.(intent, from) // every candidate declined, or every claimer's commit failed: relay up (or a host signal).
    return false
  }

  /** BROADCAST: commit EVERY capable handler (deduped one-per-owner), ignoring claim and order (a fan-out
   *  event, not a claim/decline command). No unhandled relay. */
  private broadcast(pass: DispatchPass, from: PublisherId, intent: IntentPayload, caps: Set<Capability>, key: string): boolean {
    const byOwner = new Map<PublisherId, Handler>()
    for (const c of caps) byOwner.set(c.owner, c.handler)
    let delivered = 0
    for (const [owner, handler] of byOwner) {
      if (this.cyclesBack(pass, owner, intent.type, key)) continue // origin of this intent — skip the echo.
      if (this.ambientReachable && !this.ambientReachable(owner, intent.type)) continue // rung 2: wire-only, skip ambient.
      if (this.runInPass(pass, () => this.commitOne(pass, owner, handler, intent, from, key, false, false))) delivered++ // count commits that did not throw (a remote broadcast is fire-and-forget, no re-home).
    }
    if (on('intent')) event('intent', 'broadcast', { type: intent.type, from, delivered })
    return true
  }

  /**
   * Deliver a fired intent to its WIRED recipients (the switchboard override).
   * - `all` (broadcast) wire → NARROW: commit only the wired recipients (ignore claim, like broadcast).
   * - `once` (routed) wire → WIDEN: every wired recipient that CLAIMS commits ("linked views all open").
   *   If NONE claim, `mode` disposes:
   *     - strict   → the `unhandled` report; fail CLOSED, never widened to global.
   *     - fallback → the ambient GATHER, EXCLUDING the recipients already tried (commit its first claimer).
   * A REMOTE wired recipient (a floated window) claims over the wire — its stub's `claim` is a promise the
   * gather awaits, so the widen goes async and commits every remote claimer via the aimed commit; a
   * same-window wire stays fully synchronous.
   *
   */
  private deliverWired(
    pass: DispatchPass,
    from: PublisherId,
    intent: IntentPayload,
    wire: { recipients: PublisherId[]; mode: 'strict' | 'fallback' },
    caps: Set<Capability> | undefined,
    key: string,
  ): boolean | Promise<boolean> {
    const byOwner = new Map<PublisherId, Handler>()
    for (const c of caps ?? []) byOwner.set(c.owner, c.handler)
    if (intent.kind === 'broadcast') {
      let delivered = false
      for (const r of wire.recipients) {
        if (this.cyclesBack(pass, r, intent.type, key)) continue // origin of this intent — skip the echo.
        const h = byOwner.get(r)
        if (h) {
          const ok = this.runInPass(pass, () => this.commitOne(pass, r, h, intent, from, key, true, false))
          delivered = delivered || ok
        }
      }
      return delivered // NARROW: only the wired recipients, nothing else.
    }
    // routed (once): WIDEN — every wired recipient that CLAIMS commits. A remote recipient's claim is a
    // promise, so GATHER (parallel) then commit every claimer; the fallback runs on an empty widen.
    const recipients = wire.recipients.filter((r) => !this.cyclesBack(pass, r, intent.type, key)) // skip a wire back to the origin.
    const tried = new Set(recipients) // every wired recipient attempted (handler or not) — excluded from the fallback.
    const live = recipients
      .map((r) => [r, byOwner.get(r)] as [PublisherId, Handler | undefined])
      .filter((p): p is [PublisherId, Handler] => p[1] !== undefined)
    const commitWidenThenFallback = (claims: boolean[]): boolean | Promise<boolean> => {
      let claimed = false
      for (let i = 0; i < live.length; i++) {
        if (!claims[i]) continue
        const [r, h] = live[i]
        const ok = this.runInPass(pass, () => this.commitOne(pass, r, h, intent, from, key, true, false))
        claimed = claimed || ok // a recipient whose atomic commit failed did not act; fall back if NONE did.
      }
      if (claimed) return true
      // None of the wired recipients claimed. FALLBACK → the ambient gather-then-commit-first, excluding
      // those tried (it commits the first claimer of the rest — remote candidates included — and reports
      // `unhandled` when the rest all decline). Strict → fail CLOSED here.
      if (wire.mode === 'fallback' && caps) {
        const rest = this.orderedHandlers(from, intent, caps).filter(([o]) => !tried.has(o))
        return this.resolveAndCommit(pass, from, intent, key, rest)
      }
      this.unhandled?.(intent, from) // strict: fail CLOSED; no capable recipients: the same report.
      return false
    }
    const claims = this.gatherClaims(pass, from, intent, live)
    return Array.isArray(claims) ? commitWidenThenFallback(claims) : claims.then(commitWidenThenFallback)
  }

  /** The candidate (owner, handler) pairs in dispatch order (ambient MRU-walk, or firer-relative). */
  private orderedHandlers(from: PublisherId, intent: IntentPayload, caps: Set<Capability>): Array<[PublisherId, Handler]> {
    const byOwner = new Map<PublisherId, Handler>()
    for (const c of caps) byOwner.set(c.owner, c.handler) // one handler per owner (last wins on dup).
    const owners = new Set(byOwner.keys())
    const dispatch = intent.dispatch ?? 'ambient'
    // RUNG 2: a node the composition closed to ambient (`intent-reach` wire-only) is excluded from the
    // AMBIENT candidate set; firer-relative is unaffected (wire-only is about ambient reach). A wire still
    // reaches it — `deliverWired` never runs this path.
    const ambientOwners =
      dispatch === 'ambient' && this.ambientReachable
        ? new Set([...owners].filter((o) => this.ambientReachable!(o, intent.type)))
        : owners
    const ordered =
      dispatch === 'firer-relative'
        ? this.firerRelativeOrder(from, owners)
        : this.ambientOrder(from, ambientOwners, intent.type)
    return ordered
      .map((o) => [o, byOwner.get(o)] as [PublisherId, Handler | undefined])
      .filter((p): p is [PublisherId, Handler] => p[1] !== undefined)
  }

  /** Firer-relative: the firer's OWN container — its ancestors, nearest first; lone fallback. */
  private firerRelativeOrder(from: PublisherId, owners: Set<PublisherId>): PublisherId[] {
    const ordered: PublisherId[] = []
    let cur: PublisherId | null = from
    while (cur) {
      if (owners.has(cur)) ordered.push(cur)
      cur = this.parentOf(cur)
    }
    if (ordered.length > 0) return ordered
    return owners.size === 1 ? [...owners] : [] // unambiguous lone handler as a fallback.
  }

  /**
   * Ambient dispatch order. NESTED-SCOPE aware: when the runtime injected the scope
   *  maps, candidates are PARTITIONED by their enclosing composition and ordered INNER-SCOPE-FIRST along
   *  the firer's scope chain, an unclaimed intent BUBBLING outward to the parent; a sibling nested scope
   *  is never a candidate (a nested composition governs its own subtree). Within each scope, that scope's
   *  own `intent-defaults` (via `scopeCandidates`, keyed by scope) and reach apply, then focus-MRU. With
   *  no scope maps (no nesting), it is the flat global walk — one scope, today's behaviour exactly.
   */
  private ambientOrder(from: PublisherId, owners: Set<PublisherId>, intentType: string): PublisherId[] {
    if (!this.scopeOf || !this.scopeChainOf) return this.ambientOrderInScope(from, owners, intentType, 'default')
    const scopeOf = this.scopeOf
    const result: PublisherId[] = []
    const placed = new Set<PublisherId>()
    for (const sid of this.scopeChainOf(from)) {
      const scopeOwners = new Set([...owners].filter((o) => !placed.has(o) && scopeOf(o) === sid))
      if (scopeOwners.size === 0) continue
      for (const o of this.ambientOrderInScope(from, scopeOwners, intentType, sid)) {
        result.push(o)
        placed.add(o)
      }
    }
    return result // a sibling/cousin scope's owner never enters `placed` → excluded (scope containment).
  }

  /** The ambient order WITHIN one scope: that scope's declared routing (`intent-defaults`, via the
   *  scope-keyed `scopeCandidates`) partitions the candidates — priority (declared first, then the rest),
   *  whitelist (only the declared), or block (exclude the declared) — and focus-MRU orders within each
   *  partition. Absent a rule, the plain focus-MRU walk over the scope's owners. */
  private ambientOrderInScope(from: PublisherId, owners: Set<PublisherId>, intentType: string, scopeId: string): PublisherId[] {
    const scoped = this.scopeCandidates?.(intentType, from, [...owners], scopeId) ?? null
    if (!scoped) return this.rankAmbient(from, owners)
    if (scoped.mode === 'block') return this.rankAmbient(from, new Set(scoped.rest)) // EXCLUDE the declared targets; the rest routes as usual.
    const preferred = this.rankAmbient(from, new Set(scoped.preferred))
    if (scoped.mode === 'whitelist') return preferred // only the declared targets.
    return [...preferred, ...this.rankAmbient(from, new Set(scoped.rest))] // priority: declared first, then the scope fallback.
  }

  /** Focus-MRU order over a candidate set: most-recently-focused first, tree-proximity tie-break, then any
   *  FALLBACK node (the host command layer) sunk to the very end — a real mount-tree handler always claims
   *  ahead of the host-global fallback, which runs only if none did. */
  private rankAmbient(from: PublisherId, owners: Set<PublisherId>): PublisherId[] {
    const byProximity = this.proximityOrder(from, owners) // seeds the unfocused tie-break.
    const ranked = this.focusRank ? this.focusRank(byProximity) : byProximity
    if (!this.isFallbackNode) return ranked
    const isFallback = this.isFallbackNode
    return [...ranked.filter((o) => !isFallback(o)), ...ranked.filter((o) => isFallback(o))]
  }

  /** Owners ordered by tree proximity to the firer: ancestors nearest-first, then the rest. */
  private proximityOrder(from: PublisherId, owners: Set<PublisherId>): PublisherId[] {
    const out: PublisherId[] = []
    const added = new Set<PublisherId>()
    let cur: PublisherId | null = from
    while (cur) {
      if (owners.has(cur) && !added.has(cur)) {
        out.push(cur)
        added.add(cur)
      }
      cur = this.parentOf(cur)
    }
    for (const o of owners) if (!added.has(o)) out.push(o)
    return out
  }

  private handle(node: PublisherId, type: string, handler: Handler): () => void {
    // THE DECLARED-CAPABILITY GATE, rung 3 — warn, do NOT refuse. A projection
    // should only handle an intent its type-def DECLARES (`handles-intent-meta`), so routing is a pre-mount
    // type-graph fact. An honest third-party author trips this by forgetting the declaration, and
    // nothing is destroyed — it is a declaration gap, not an attack — so the framework WARNS through
    // the diagnostic seam and lets the registration proceed. The count may not GROW (the ratchet):
    // every caller in-tree declares its set today, so the baseline is zero.

    const declared = this.declaredHandlesOf?.(node)
    // `undefined` = a host-owned node or an unknown type: not a projection subject to the rule, so
    // silent. Only a KNOWN declared set that OMITS this type is a gap.
    if (declared && !declared.includes(type)) {
      const who = this.describeNode?.(node)
      reportHostDiagnostic({
        code: 'intent-handled-undeclared',
        severity: 'warning',
        message: `${who ? `projection "${who}"` : 'a projection'} registered a handler for intent "${type}", which its type-def does not declare in handles-intent-meta; add "${type}" to ${who ?? 'its'} handles-intent-meta so which projection handles which intent is a type-graph fact`,
        subject: type,
        detail: { node, projectionType: who, declared },
      })
    }
    let set = this.capabilities.get(type)
    if (!set) {
      set = new Set()
      this.capabilities.set(type, set)
    }
    const cap: Capability = { owner: node, handler }
    set.add(cap)
    // A handler for `type` just registered. This is the precise moment a NEWLY-ADDED container (e.g. a
    // bento the unhandled-intent floor wrapped in) becomes able to take the intent — the container's
    // handler binds in a mount effect, AFTER its node-mount. The runtime's re-dispatch of a floored
    // intent hooks here (not node-mount, which is too early), so no timer guesses the readiness.
    this.onHandlerRegistered?.(type, node)
    return () => set.delete(cap)
  }

  /** Notified when any node registers a handler for an intent `type`. The runtime uses it to re-dispatch a
   *  floored intent the moment a container capable of it becomes live (the unhandled-intent floor). */
  private onHandlerRegistered: ((type: string, node: PublisherId) => void) | null = null
  setOnHandlerRegistered(cb: (type: string, node: PublisherId) => void): void {
    this.onHandlerRegistered = cb
  }

  /** The capable handler owners currently registered for `type` (deduped), or empty when none. Lets the
   *  runtime's unhandled reporter distinguish "a routing rule EXCLUDED the capable handlers" from "there
   *  were none at all", so the warning can name the whitelist/block rule as the reason. */
  ownersHandling(type: string): PublisherId[] {
    const caps = this.capabilities.get(type)
    return caps ? [...new Set([...caps].map((c) => c.owner))] : []
  }

  /** A node unmounted: drop every capability it declared. */
  dropNode(node: PublisherId): void {
    for (const set of this.capabilities.values()) {
      for (const c of [...set]) if (c.owner === node) set.delete(c)
    }
  }

  /**
   * The live census as PUBLISHER-ID sets: which owners currently HANDLE each type (sinks, skipping a
   * now-empty capability whose key survives an unmount), and which nodes have FIRED each type this
   * session (sources), plus the single LAST firer per type (lastFire). The runtime maps these ids →
   * projection-type names for the layout-inspector; this stays id-level because the tree does not know
   * types. Orthogonal to routing order.
   */
  census(): {
    sinks: Map<string, PublisherId[]>
    sources: Map<string, PublisherId[]>
    lastFire: Map<string, PublisherId>
  } {
    const sinks = new Map<string, PublisherId[]>()
    for (const [type, caps] of this.capabilities) {
      const owners = [...new Set([...caps].map((c) => c.owner))]
      if (owners.length) sinks.set(type, owners)
    }
    const sources = new Map<string, PublisherId[]>()
    for (const [type, firers] of this.firedTypes) {
      if (firers.size) sources.set(type, [...firers])
    }
    return { sinks, sources, lastFire: new Map(this.lastFiredBy) }
  }
}
