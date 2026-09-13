// The keybind RESOLVER — the pure decision at the authority. Given the current keystroke buffer and the
// active keybinds (already filtered to the active keymaps and tagged with focus specificity + list order),
// it decides: fire one intent, ask the chooser, hold for a longer sequence, or nothing. No DOM, no engine,
// no state — the runtime owns the buffer, the reads, the fire, and the chooser.

// Precedence: focus specificity first, then list order breaks a tie among equals, then the chooser
// when no single winner remains.


import type { CanonicalKeystroke } from './keybinds.ts'

/** One active keybind, prepared by the runtime: its chord, the intent it fires, its list-order rank
 *  (later keymap = higher), and whether its effective `when` matches the current focus. */
export interface ActiveKeybind {
  chord: CanonicalKeystroke[]
  intent: string
  order: number
  focusScoped: boolean
}

/** A keybind as read from a keymap file: its chord, the intent it fires, and its own focus narrowing. */
export interface RawKeybind {
  chord: CanonicalKeystroke[]
  intent: string
  when?: string[]
}

/** A keymap as read from a keymap file: its activation scope and its keybinds. */
export interface RawKeymap {
  when?: string[]
  keybinds: RawKeybind[]
}

/**
 * Flatten the ordered active keymaps into resolver-ready keybinds against the current focus.
 * - a focus-scoped keymap (a non-empty `when`) contributes only while a `when` type is focused.
 * - each keybind's list-order rank is its keymap's index (later keymap = higher precedence).
 * - a keybind is focus-scoped when its effective `when` (its own, else its keymap's) matches the focus.
 */
export function buildActiveKeybinds(
  keymaps: readonly RawKeymap[],
  focusedTypes: ReadonlySet<string>,
): ActiveKeybind[] {
  const out: ActiveKeybind[] = []
  keymaps.forEach((km, order) => {
    const kmScoped = !!(km.when && km.when.length)
    if (kmScoped && !km.when!.some((t) => focusedTypes.has(t))) return
    for (const b of km.keybinds) {
      const eff = b.when && b.when.length ? b.when : km.when
      const focusScoped = !!(eff && eff.length && eff.some((t) => focusedTypes.has(t)))
      out.push({ chord: b.chord, intent: b.intent, order, focusScoped })
    }
  })
  return out
}

export type ChordResolution =
  | { kind: 'fire'; intent: string }
  | { kind: 'ask'; intents: string[] }
  | { kind: 'prefix' }
  | { kind: 'none' }

/** Two keystrokes are equal when their keys match and their modifier SETS are equal (order-independent). */
export function keystrokeEquals(a: CanonicalKeystroke, b: CanonicalKeystroke): boolean {
  if (a.key !== b.key || a.mods.length !== b.mods.length) return false
  const bs = new Set<string>(b.mods)
  return a.mods.every((m) => bs.has(m))
}

/** The buffer is a strict prefix of the chord (a longer sequence could still form). */
function isPrefix(buffer: readonly CanonicalKeystroke[], chord: readonly CanonicalKeystroke[]): boolean {
  if (buffer.length >= chord.length) return false
  return buffer.every((k, i) => keystrokeEquals(k, chord[i]))
}

/** The buffer matches the chord exactly. */
function isFull(buffer: readonly CanonicalKeystroke[], chord: readonly CanonicalKeystroke[]): boolean {
  if (buffer.length !== chord.length) return false
  return buffer.every((k, i) => keystrokeEquals(k, chord[i]))
}

/**
 * Resolve the current buffer against the active keybinds.
 * - `final` is set when the sequence timeout has fired, so a full match resolves even though a longer
 *   keybind still extends it as a prefix (the user did not continue the sequence).
 */
export function resolveChord(
  buffer: readonly CanonicalKeystroke[],
  active: readonly ActiveKeybind[],
  final = false,
): ChordResolution {
  const fulls = active.filter((kb) => isFull(buffer, kb.chord))
  const hasLongerPrefix = active.some((kb) => isPrefix(buffer, kb.chord))

  if (fulls.length === 0) return hasLongerPrefix ? { kind: 'prefix' } : { kind: 'none' }
  // A full match exists, but a longer sequence could still form — hold until the timeout says final.
  if (hasLongerPrefix && !final) return { kind: 'prefix' }

  // Focus specificity first: a focus-scoped match wins over a global one.
  const focusScoped = fulls.filter((kb) => kb.focusScoped)
  const tier = focusScoped.length > 0 ? focusScoped : fulls

  // List order breaks the tie among equally-specific candidates — the latest keymap wins.
  const maxOrder = Math.max(...tier.map((kb) => kb.order))
  const top = tier.filter((kb) => kb.order === maxOrder)
  const intents = [...new Set(top.map((kb) => kb.intent))]

  // A single winner fires; a genuine tie (same specificity and list position, distinct intents — a
  // within-file duplicate) asks the chooser.
  return intents.length === 1 ? { kind: 'fire', intent: intents[0] } : { kind: 'ask', intents }
}

export interface PendingKeySequence {
  /** The authority's timer, shared by presentation. Zero duration means no automatic expiry. */
  durationMs: number
  deadline: number | null
  paused: boolean
  prefix: readonly CanonicalKeystroke[]
  /** Effective full chords, including a standalone match that fires on timeout. */
  bindings: readonly ActiveKeybind[]
}

export interface KeybindDispatcherDeps {
  /** Presentation only; the dispatcher remains the sole owner of matching and timing. */
  onPendingChange?: (pending: PendingKeySequence | null) => void
  /** The active keybinds right now — focus-tagged and list-ordered by the caller. Re-read per keystroke. */
  activeKeybinds: () => readonly ActiveKeybind[]
  /** Fire a resolved intent (fire-and-forget). */
  fire: (intent: string) => void
  /** Ask the chooser among a genuine tie; the implementation fires the pick. */
  ask: (intents: string[]) => void
  /** How long a partial chord waits for a continuation before its standalone match fires. */
  sequenceTimeoutMs?: number | (() => number | undefined)
}

const DEFAULT_SEQUENCE_TIMEOUT_MS = 600

/**
 * Holds the keystroke buffer and drives the sequence timeout. Pure orchestration over `resolveChord`:
 * the caller injects the active keybinds, the fire, and the chooser. Owned by the authority runtime.
 */
export class KeybindDispatcher {
  private buffer: CanonicalKeystroke[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  private paused = false
  private durationMs = DEFAULT_SEQUENCE_TIMEOUT_MS
  private deadline: number | null = null

  constructor(private readonly deps: KeybindDispatcherDeps) {}

  /** Feed a candidate keystroke. Returns whether the key was CONSUMED (fired, asked, or held for a
   *  possible sequence) — the caller suppresses default handling for a consumed key. */
  push(ks: CanonicalKeystroke): boolean {
    this.clearTimer()
    this.buffer.push(ks)
    const r = resolveChord(this.buffer, this.deps.activeKeybinds(), false)
    switch (r.kind) {
      // No match. If a prefix was armed (buffer `[⌘K]`) and the next key does not extend it, the whole
      // buffer (`[⌘K, X]`) resolves to none and is discarded — X is NOT retried as a fresh chord. This
      // An abandoned chord prefix consumes the following key.
      case 'none': this.reset(); return false
      case 'fire': this.reset(); this.deps.fire(r.intent); return true
      case 'ask': this.reset(); this.deps.ask(r.intents); return true
      case 'prefix': this.arm(); this.publishPending(); return true
    }
  }

  get pending(): boolean { return this.buffer.length > 0 }

  cancel(): void { this.reset() }

  /** Activate an explicitly chosen, still-effective continuation and consume its pending sequence. */
  choose(binding: ActiveKeybind): boolean {
    if (!this.pending || (!isPrefix(this.buffer, binding.chord) && !isFull(this.buffer, binding.chord))) return false
    const resolved = resolveChord(binding.chord, this.deps.activeKeybinds(), true)
    if (!(resolved.kind === 'fire' && resolved.intent === binding.intent)
      && !(resolved.kind === 'ask' && resolved.intents.includes(binding.intent))) return false
    this.reset()
    this.deps.fire(binding.intent)
    return true
  }

  /** Inspection refills the sequence window and pauses actual resolution, not merely its indicator. */
  inspect(paused: boolean): void {
    if (!this.pending || this.paused === paused) return
    this.paused = paused
    this.clearTimer()
    if (!paused) this.arm()
    else this.deadline = null
    this.publishPending()
  }

  private publishPending(): void {
    const active = this.deps.activeKeybinds()
    const bindings = active.filter(kb => {
      if (!isPrefix(this.buffer, kb.chord) && !isFull(this.buffer, kb.chord)) return false
      const resolved = resolveChord(kb.chord, active, true)
      return resolved.kind === 'fire' ? resolved.intent === kb.intent
        : resolved.kind === 'ask' && resolved.intents.includes(kb.intent)
    })
    this.deps.onPendingChange?.({
      durationMs: this.durationMs, deadline: this.deadline, paused: this.paused,
      prefix: this.buffer.map(k => ({ ...k, mods: [...k.mods] })),
      bindings: bindings.map(kb => ({ ...kb, chord: kb.chord.map(k => ({ ...k, mods: [...k.mods] })) })),
    })
  }

  private arm(): void {
    const configured = typeof this.deps.sequenceTimeoutMs === 'function' ? this.deps.sequenceTimeoutMs() : this.deps.sequenceTimeoutMs
    this.durationMs = typeof configured === 'number' && Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_SEQUENCE_TIMEOUT_MS
    this.deadline = !this.paused && this.durationMs > 0 ? Date.now() + this.durationMs : null
    if (this.deadline === null) return
    this.timer = setTimeout(() => {
      this.timer = null
      const r = resolveChord(this.buffer, this.deps.activeKeybinds(), true)
      this.reset()
      if (r.kind === 'fire') this.deps.fire(r.intent)
      else if (r.kind === 'ask') this.deps.ask(r.intents)
    }, this.durationMs)
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  private reset(): void {
    this.buffer = []
    this.paused = false
    this.deadline = null
    this.clearTimer()
    this.deps.onPendingChange?.(null)
  }

  dispose(): void {
    this.reset()
  }
}
