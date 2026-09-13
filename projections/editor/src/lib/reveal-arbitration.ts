// Resolve a reveal command against the editor's current path and mount state.
// One-shot reveal ranges travel through the command channel and are not saved as config.
export interface RevealSpan {
  from: number
  to: number
}

/** The parts of a `ui-intent-highlight` payload this decision reads. Host-opaque otherwise. */
export interface HighlightSignal {
  mode?: string
  path?: string
  range?: { from?: number; to?: number }
}

/** What the editor knows about itself when the signal arrives. */
export interface RevealState {
  /** The file currently loaded, or null before the first load resolves. */
  currentPath: string | null
  /** The file a load is IN FLIGHT for, or null when nothing is loading. */
  awaitingRevealFor: string | null
}

export type RevealDecision =
  /** Not about us, or about us but unactionable. Do nothing. */
  | { kind: 'ignore' }
  /** Our file, no usable span: flash the pane only. */
  | { kind: 'flash' }
  /** Our file with a span: flash AND scroll to it. */
  | { kind: 'reveal'; span: RevealSpan }
  /** Not our file YET, but it is the one we are loading: hold the span for the load to apply. */
  | { kind: 'park'; span: RevealSpan }

/**
 * Match two file paths one of which may be repo-relative and the other absolute.
 *
 * Deliberately a SUFFIX match, not equality: the engine hands back absolute paths while a
 * composition or an intent may carry a repo-relative one. Anchored on `/` so `notes/a.md` does not
 * match `other-notes/a.md`.
 */
export function sameFile(a: string, b: string): boolean {
  return a === b || a.endsWith('/' + b) || b.endsWith('/' + a)
}

/** A span is usable only on `reveal-if-exists` and only when BOTH ends are present. */
function spanOf(signal: HighlightSignal): RevealSpan | null {
  const r = signal.range
  if (signal.mode !== 'reveal-if-exists') return null
  if (typeof r?.from !== 'number' || typeof r.to !== 'number') return null
  return { from: r.from, to: r.to }
}

/**
 * Decide what an incoming highlight means for this editor.
 *
 * Order matters: the "is it mine" test runs against `currentPath`, and only a MISS falls through to
 * parking. Parking is scoped to `awaitingRevealFor` so a highlight naming some other file can never
 * occupy the slot waiting for a load that will never come.
 */
export function decideReveal(signal: HighlightSignal, state: RevealState): RevealDecision {
  if (!signal.path) return { kind: 'ignore' }
  const span = spanOf(signal)
  if (state.currentPath != null && sameFile(signal.path, state.currentPath)) {
    return span ? { kind: 'reveal', span } : { kind: 'flash' }
  }
  if (span && state.awaitingRevealFor != null && sameFile(signal.path, state.awaitingRevealFor)) {
    return { kind: 'park', span }
  }
  return { kind: 'ignore' }
}
