/**
 * THE HOST EVENT SUBSTRATE — one gated producer for every runtime decision the host makes, fanning by
 * `kind` into a bounded TRACE ring (the temporal timeline) and an unbounded CONDITION map (the standing
 * diagnostics), surfaced as two derived views. "Why did the UI do that" becomes a read, not a
 * reconstruction from behaviour.
 *
 *
 *
 * THE SHAPE, in one place:
 *   - `record(evt)` is the primitive; `event` / `condition` / `clearCondition` are the ergonomic helpers.
 *   - a `trace` event is a point in time (a fire, a decline, a rejection, a resync) → the RING.
 *   - a `condition` is a standing fact keyed by `name+subject`, held until cleared → the MAP (and also the
 *     ring, so the timeline shows when it rose).
 *   - recording is gated PER CATEGORY; gate BEFORE construct (`if (on('placement')) event(...)`) so an off
 *     category is one branch that allocates nothing.
 *   - a trace event carries a CAUSE-ID — the intent dispatch pass, carried ambiently — so a routing, a
 *     rejection, and a resolution nest under the fire that caused them.
 *   - SINKS PULL: a subscriber is notified (next microtask) that something changed, then reads. The emit
 *     path never calls a sink, so a slow or throwing surface can neither slow nor abort a dispatch.
 *
 *
 */

export type HostEventKind = 'trace' | 'condition'
export type HostEventSeverity = 'error' | 'warning' | 'hint'

/** One structured event. Never a pre-formatted string — prose is derived at a surface, on demand. */
export interface HostEvent {
  /** Monotonic, assigned at `record()` — the timeline order WITHIN ONE WINDOW. */
  seq: number
  /** `performance.now()` at record, for durations WITHIN ONE WINDOW. */
  t: number
  /** OPEN set: 'intent' | 'placement' | 'viewer' | 'resync' | 'lifecycle' | a plugin's own. */
  category: string
  /** OPEN set. A condition's kebab code; a trace's verb ('fire'|'decline'|'claim'|…). Carries identity —
   *  a surfacer matches on this, never on prose. */
  name: string
  kind: HostEventKind
  /** trace only: the dispatch pass id. Absent = top-level or outside any pass. */
  cause?: number
  /** node id / type / package root — part of a condition's key. */
  subject?: string
  /** conditions only. */
  severity?: HostEventSeverity
  /** condition only: clears (name, subject) from the set instead of raising it. */
  cleared?: true
  /** structured extras; never a pre-formatted string. */
  fields?: Record<string, unknown>
}

/** A read filter over the timeline. Every field is an exact match; absent = unconstrained. */
export interface EventFilter {
  category?: string
  cause?: number
  subject?: string
}

/** Runtime stats over the ring, for detecting a truncated trace. */
export interface EventStats {
  /** Events currently retained in the ring. */
  size: number
  /** Ring capacity. */
  capacity: number
  /** Total events overwritten (lost off the tail). A non-zero value means the timeline is truncated. */
  dropped: number
  /** The next `seq` that will be assigned. */
  seq: number
}

const DEFAULT_RING_SIZE = 2048
/** Categories ON at startup — the instrumented LOW-VOLUME decision points, so the out-of-box trace of an
 *  open is complete (a file-tree click reads its whole pass without flipping a category). A HIGH-VOLUME
 *  category (drag, when added) ships off. Every category is flippable via `setCategory`. */
const DEFAULT_ON: readonly string[] = ['intent', 'placement', 'viewer', 'resync', 'chooser']

/**
 * The one shared home for the ring, the map, the `seq` counter, the ambient cause, the gate, and the
 * subscribers. Every renderer bundle resolves ONE served copy of this SDK (the shared-dep platform), so
 * this is a plain module singleton (`local`). The exception is `pnpm dev`: vite serves the shell live on
 * its own copy, so the shell and the projections are split instances — then, and only then, they bridge
 * through the `__AU_HOST_EVENTS__` window-global. Same shape in `diagnostics.ts` + `container-core/singletons.ts`.
 */
const KEY = '__AU_HOST_EVENTS__'

// Whether the shell + this bundle are split copies (the vite-served dev shell). Set at renderer boot.
const bridging = (): boolean => (globalThis as Record<string, unknown>).__AU_DEV__ === true

interface EventState {
  ring: (HostEvent | undefined)[]
  capacity: number
  head: number // next write index
  size: number // events currently stored (≤ capacity)
  dropped: number // total overwritten
  conditions: Map<string, HostEvent>
  seq: number
  cause: number | undefined // the ambient dispatch-pass id
  passDepth: number
  passSeq: number // monotonic source for pass ids
  gate: Map<string, boolean>
  allOn: boolean // a zero-code toggle set every category ON (the `*` startup toggle)
  subscribers: Set<() => void>
  notifyScheduled: boolean
  mirrorListener: (() => void) | null // the pull-safe console mirror subscriber, when installed
}

function freshState(capacity: number): EventState {
  const gate = new Map<string, boolean>()
  for (const c of DEFAULT_ON) gate.set(c, true)
  return {
    ring: new Array<HostEvent | undefined>(capacity),
    capacity,
    head: 0,
    size: 0,
    dropped: 0,
    conditions: new Map(),
    seq: 0,
    cause: undefined,
    passDepth: 0,
    passSeq: 0,
    gate,
    allOn: false,
    subscribers: new Set(),
    notifyScheduled: false,
    mirrorListener: null,
  }
}

let local: EventState | null = null

function shared(): EventState {
  // DEV split: the ONE state lives on the window-global, shared across the shell's + projections' copies.
  if (bridging()) {
    const g = globalThis as unknown as Record<string, EventState | undefined>
    const existing = g[KEY]
    if (existing) return existing
    const fresh = freshState(DEFAULT_RING_SIZE)
    g[KEY] = fresh // cache BEFORE applying toggles, so a re-entrant shared() (subscribe) sees it
    applyStartupToggles(fresh)
    return fresh
  }
  // PROD: one served instance → a module singleton.
  if (local) return local
  local = freshState(DEFAULT_RING_SIZE)
  applyStartupToggles(local)
  return local
}

/**
 * ZERO-CODE ENABLEMENT, read once when the shared state is first created — flip a category on WITHOUT
 * editing `DEFAULT_ON` or rebuilding. This is the "turn logging on with a toggle" ergonomic: instrument a
 * decision point as a gated `event()` (permanent, off by default), then enable its category here to debug.
 *  - `localStorage.__au_events` = comma-separated category names, or `*` for all.
 *  - URL `?au-events=cat1,cat2` (or `*`) — overrides localStorage, per-window.
 *  - either source's `__au_events_mirror` / `?au-events-mirror=1` also installs the console mirror.
 * Guarded (no localStorage / no location → no-op), so it is safe in any host context.
 */
function applyStartupToggles(s: EventState): void {
  let raw = ''
  let mirror = false
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (ls) {
      raw = ls.getItem('__au_events') ?? ''
      mirror = ls.getItem('__au_events_mirror') != null
    }
  } catch {
    // no localStorage (a non-renderer context) — fall through
  }
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search
    if (search) {
      const q = new URLSearchParams(search)
      const e = q.get('au-events')
      if (e) raw = e
      if (q.get('au-events-mirror') != null) mirror = true
    }
  } catch {
    // no location — fall through
  }
  if (raw.trim() === '*') s.allOn = true
  else for (const c of raw.split(',').map((x) => x.trim()).filter(Boolean)) s.gate.set(c, true)
  if (mirror) installConsoleMirror(s)
}

/**
 * The console mirror — a pull-safe dev sink that `console.debug`s each new event. It is a SUBSCRIBER (reads
 * on the coalesced notify), NEVER a call inside the emit path, so the substrate's pull-only guarantee holds
 * (a slow console cannot slow a dispatch). Idempotent per shared state (dedup across bundles). Off by default.
 */
function installConsoleMirror(s: EventState): void {
  if (s.mirrorListener) return
  let cursor = s.seq
  const listener = (): void => {
    for (const e of ringInOrder(s)) {
      if (e.seq <= cursor) continue
      cursor = e.seq
      const tag = e.cause !== undefined ? `#${e.cause}` : '·'
      // `console.log`, not `console.debug`: devtools hides Verbose by default, which would make an
      // explicitly-enabled debug mirror look silent. The `[au-event]` prefix keeps it greppable.
      // eslint-disable-next-line no-console
      console.log(`[au-event ${e.category}:${e.name}] ${tag}`, e.fields ?? {})
    }
  }
  s.mirrorListener = listener
  s.subscribers.add(listener)
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function conditionKey(name: string, subject?: string): string {
  return `${name}\u0000${subject ?? ''}`
}

// --- the ring ---

function appendRing(s: EventState, evt: HostEvent): void {
  if (s.size >= s.capacity) s.dropped++ // overwriting a live event
  s.ring[s.head] = evt
  s.head = (s.head + 1) % s.capacity
  if (s.size < s.capacity) s.size++
}

/** Retained events, oldest→newest (newest-last). */
function ringInOrder(s: EventState): HostEvent[] {
  const out: HostEvent[] = []
  const start = (s.head - s.size + s.capacity) % s.capacity
  for (let i = 0; i < s.size; i++) {
    const e = s.ring[(start + i) % s.capacity]
    if (e !== undefined) out.push(e)
  }
  return out
}

// --- pull-notify (coalesced, isolated) ---

function scheduleNotify(s: EventState): void {
  if (s.notifyScheduled) return
  s.notifyScheduled = true
  queueMicrotask(() => {
    s.notifyScheduled = false
    for (const l of [...s.subscribers]) {
      try {
        l()
      } catch {
        // a throwing listener is isolated — the emit path is already decoupled, and one bad surface
        // must not starve the others.
      }
    }
  })
}

// --- the producer ---

/**
 * The primitive. Assigns `seq` + `t`, appends to the ring, upserts/deletes the condition map, and
 * schedules a coalesced notify. Prefer the helpers below; call this directly only for a fully-shaped event.
 */
export function record(evt: Omit<HostEvent, 'seq' | 't'>): HostEvent {
  const s = shared()
  const full: HostEvent = { ...evt, seq: ++s.seq, t: now() }
  appendRing(s, full)
  if (full.kind === 'condition') {
    const key = conditionKey(full.name, full.subject)
    if (full.cleared) s.conditions.delete(key)
    else s.conditions.set(key, full)
  }
  scheduleNotify(s)
  return full
}

/** The gate check — one map read (plus the `*`-all flag). Gate BEFORE construct: `if (on('placement')) event(...)`. */
export function on(category: string): boolean {
  const s = shared()
  return s.allOn || (s.gate.get(category) ?? false)
}

/** Turn a category's recording on or off. */
export function setCategory(category: string, enabled: boolean): void {
  shared().gate.set(category, enabled)
}

/** Turn ON (or off) recording for EVERY category at once — the `*` toggle, for a debug session. */
export function setAllCategories(enabled: boolean): void {
  shared().allOn = enabled
}

/**
 * Install (default) or remove the pull-safe CONSOLE MIRROR — `console.debug` each new event, for
 * paste-friendly debugging. A subscriber, never on the emit path, so the pull-only guarantee holds. Off by
 * default; also installable via the `__au_events_mirror` / `?au-events-mirror=1` startup toggle.
 */
export function mirrorToConsole(enabled = true): void {
  const s = shared()
  if (enabled) {
    installConsoleMirror(s)
  } else if (s.mirrorListener) {
    s.subscribers.delete(s.mirrorListener)
    s.mirrorListener = null
  }
}

/** A TRACE event — a point in time. Reads the ambient cause so a decision deep in a pass threads to it. */
export function event(category: string, name: string, fields?: Record<string, unknown>): void {
  const s = shared()
  record({ category, name, kind: 'trace', cause: s.cause, fields })
}

/** Raise a standing CONDITION, keyed by `name+subject`, held until cleared. A condition carries no cause. */
export function condition(
  name: string,
  severity: HostEventSeverity,
  subject?: string,
  fields?: Record<string, unknown>,
): void {
  record({ category: 'diagnostic', name, kind: 'condition', severity, subject, fields })
}

/** Clear a standing condition by its key. Removes it from the set; also lands in the ring (the timeline
 *  shows when it fell). */
export function clearCondition(name: string, subject?: string): void {
  record({ category: 'diagnostic', name, kind: 'condition', subject, cleared: true })
}

// --- the ambient cause: the dispatch pass, carried without threading an id down the call stack ---

/**
 * Enter a dispatch pass. Mints a new pass id at depth 0→1 and writes it to the shared global; nested
 * entries keep the same id. UNCONDITIONAL (never gated) — toggling recording mid-pass would otherwise
 * sever the causal thread. Pair every `beginPass()` with an `endPass()`, or use `withPass`.
 */
export function beginPass(): void {
  const s = shared()
  if (s.passDepth === 0) s.cause = ++s.passSeq
  s.passDepth++
}

/** Leave a dispatch pass. Restores no-cause at depth 1→0. */
export function endPass(): void {
  const s = shared()
  s.passDepth--
  if (s.passDepth <= 0) {
    s.passDepth = 0
    s.cause = undefined
  }
}

/** Run `fn` inside a dispatch pass, so every trace event it records threads to one cause. Restores on throw. */
export function withPass<T>(fn: () => T): T {
  beginPass()
  try {
    return fn()
  } finally {
    endPass()
  }
}

/** The ambient cause id, or `undefined` outside any pass. Exposed so an instrumentation site can stamp a
 *  cause onto an ASYNC continuation it schedules itself. */
export function currentCause(): number | undefined {
  return shared().cause
}

/**
 * RESUME an earlier cause for a SYNCHRONOUS block, so an async continuation (a chooser pick → an aimed
 * delivery) threads back to the gesture that STARTED it instead of minting a new cause. Capture the cause
 * with `currentCause()` BEFORE the await, then run the continuation inside `resumeCause(cause, fn)`. A
 * nested `beginPass` inside keeps the resumed cause (it only mints at depth 0→1, and this holds depth ≥1).
 * `undefined` → a plain call (nothing to resume). Restores on return/throw. Synchronous only — it cannot
 * span an `await` (the restore runs at the first suspension), which is why the caller resumes around the
 * synchronous delivery, not the whole async block.
 */
export function resumeCause<T>(cause: number | undefined, fn: () => T): T {
  if (cause === undefined) return fn()
  const s = shared()
  const prevCause = s.cause
  const prevDepth = s.passDepth
  s.cause = cause
  s.passDepth = Math.max(1, prevDepth)
  try {
    return fn()
  } finally {
    s.cause = prevCause
    s.passDepth = prevDepth
  }
}

// --- the two views ---

/** THE TIMELINE — retained trace + condition events, newest-last, filtered by category / cause / subject. */
export function read(filter?: EventFilter): HostEvent[] {
  const s = shared()
  let out = ringInOrder(s)
  if (filter?.category !== undefined) out = out.filter((e) => e.category === filter.category)
  if (filter?.cause !== undefined) out = out.filter((e) => e.cause === filter.cause)
  if (filter?.subject !== undefined) out = out.filter((e) => e.subject === filter.subject)
  return out
}

/** Events appended SINCE `sinceSeq` (exclusive), oldest→newest. Walks the ring from the tail backward and
 *  stops at the first already-seen seq, so a since-cursor subscriber forwards only NEW events in O(new)
 *  instead of re-scanning the whole ring per notify (avoiding O(n²) work over a fill in the surface trace relay).
 *  `seq` is monotonic and events append in seq order, so a descending tail walk that breaks at `<= sinceSeq`
 *  has seen every newer event. Returns [] when nothing is newer. */
export function readSince(sinceSeq: number): HostEvent[] {
  const s = shared()
  const out: HostEvent[] = []
  for (let i = 0; i < s.size; i++) {
    const e = s.ring[(s.head - 1 - i + s.capacity) % s.capacity] // newest → oldest
    if (e === undefined || e.seq <= sinceSeq) break
    out.push(e)
  }
  return out.reverse() // oldest → newest, so a forwarder preserves append order
}

/** THE STANDING SET — the live conditions (name+subject → the latest raise), held until cleared. A copy,
 *  so a reader cannot mutate the store. */
export function readConditions(): Map<string, HostEvent> {
  return new Map(shared().conditions)
}

/** Ring stats — `dropped > 0` means the timeline was truncated (a view renders that as a marker). */
export function stats(): EventStats {
  const s = shared()
  return { size: s.size, capacity: s.capacity, dropped: s.dropped, seq: s.seq }
}

/**
 * Empty the TIMELINE — drop every retained trace and reset the `dropped` marker, then notify. A viewer's
 * "clear" affordance. Standing CONDITIONS are left intact (they are live facts, not timeline noise; clear
 * one via `clearCondition`), and `seq` stays monotonic so a retained condition still orders before new
 * traces. The ambient cause and the gate are untouched.
 */
export function clear(): void {
  const s = shared()
  s.ring = new Array<HostEvent | undefined>(s.capacity)
  s.head = 0
  s.size = 0
  s.dropped = 0
  scheduleNotify(s)
}

/**
 * Subscribe to changes. Coalesced PULL-NOTIFY: the listener is told (next microtask) that state changed,
 * then reads a view itself. The emit path never calls it synchronously. Returns an unsubscribe.
 */
export function subscribe(listener: () => void): () => void {
  const s = shared()
  s.subscribers.add(listener)
  return () => {
    s.subscribers.delete(listener)
  }
}

/**
 * Reconfigure the substrate — the ring capacity and/or the on-by-default category set. Resets the ring
 * (events are dropped), so it is a startup / test control, not a hot-path call. Absent options keep the
 * current value.
 */
export function configureEvents(opts: { ringSize?: number; categoriesOn?: readonly string[] }): void {
  const s = shared()
  if (opts.ringSize !== undefined && opts.ringSize !== s.capacity) {
    s.ring = new Array<HostEvent | undefined>(opts.ringSize)
    s.capacity = opts.ringSize
    s.head = 0
    s.size = 0
    s.dropped = 0
  }
  if (opts.categoriesOn !== undefined) {
    s.gate.clear()
    for (const c of opts.categoriesOn) s.gate.set(c, true)
  }
}
