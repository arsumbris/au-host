/**
 * Chrome-trace export for the host event substrate — map the timeline ring to the Trace Event Format so a
 * causal timeline opens in Perfetto (ui.perfetto.dev) or chrome://tracing with NO bespoke viewer.
 *
 * Each event becomes an INSTANT event on a lane keyed by its CAUSE, so one dispatch pass reads as one lane
 * of nested decisions. Events with no cause land on lane 0.
 *
 */

import type { HostEvent } from './events.ts'

/** One Trace Event Format record (the subset Perfetto / chrome://tracing needs for instant events). */
export interface ChromeTraceEvent {
  /** Phase: 'i' = instant. */
  ph: 'i'
  /** Instant scope: 't' = thread. */
  s: 't'
  /** Timestamp in microseconds. */
  ts: number
  /** Display name — `category:name`. */
  name: string
  /** Category, for Perfetto's category filter. */
  cat: string
  /** Process id — one process per window (single-window today). */
  pid: number
  /** Thread id — the CAUSE, so a pass is one lane; 0 for no cause. */
  tid: number
  /** The event's structured fields, shown in Perfetto's args panel. */
  args?: Record<string, unknown>
}

/**
 * Map a slice of the timeline (e.g. `read()` or `read({cause})`) to a Chrome/Perfetto trace document.
 * `pid` defaults to 1 (one window); pass a window id when a cross-window merge exists (not yet).
 */
export function toChromeTrace(events: readonly HostEvent[], pid = 1): { traceEvents: ChromeTraceEvent[] } {
  return {
    traceEvents: events.map((e) => ({
      ph: 'i',
      s: 't',
      ts: Math.round(e.t * 1000),
      name: `${e.category}:${e.name}`,
      cat: e.category,
      pid,
      tid: e.cause ?? 0,
      ...(e.fields ? { args: e.fields } : {}),
    })),
  }
}
