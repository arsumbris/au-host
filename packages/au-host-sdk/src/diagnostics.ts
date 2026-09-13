/**
 * The host DIAGNOSTIC report seam: a framework-level problem the code detected and must not swallow.
 *
 * The shape mirrors the ENGINE's diagnostics, which is proven: stable kebab-case codes a consumer matches
 * on rather than message text, severity tiers, advisory by default. The code set is OPEN (the engine's
 * `{read: string}` precedent), so a plugin author emits their own codes rather than a closed enum.
 *
 * SURFACING. A report is a STANDING framework fact, so it belongs in the event substrate's condition SET.
 * `installDiagnosticConditionBridge` installs a sink that turns each report into a `condition` (collected in
 * the substrate's condition map, surfaced by the trace inspector), while keeping a console FLOOR until an
 * always-on conditions surfacer exists. So diagnostics are a DERIVED VIEW of the one substrate, not a
 * separate channel. The seam itself stays substrate-agnostic: `setHostDiagnosticSink` is the one seam, the
 * bridge is one sink, and every emission site is unchanged.
 *
 * NOT a `STANDIN`. That token means a shape owned by a DEPENDENCY repo we are formally requesting; this is
 * ours. Emitting is a plain export any projection may call, deliberately NOT a `MountHost` member — whether
 * reporting becomes a blessed capability on the contract is still open, and publishing it would pre-empt that.
 *
 * The three verified standing UIs (the handshake-rejection strip, the unclaimed-intent toast, the theming
 * pane's refused-style note) are their OWN surfaces and do not report through here, so they are untouched.
 */

import { condition } from './events.ts'

/** Advisory tiers. The engine's `drift` is omitted: it means an upstream copy diverged, which
 *  has no host-side analogue. Add it only if one appears. */
export type HostDiagnosticSeverity = 'error' | 'warning' | 'hint'

/** One host-level diagnostic: a framework problem the code detected and must not swallow. */
export interface HostDiagnostic {
  /** Stable kebab-case identifier. The CONTRACT — a surfacer matches on this, never on
   *  `message`, which is user-facing prose that may change. The set is OPEN by design. */
  code: string
  severity: HostDiagnosticSeverity
  /** Human-readable prose. May evolve; never matched on. */
  message: string
  /** What the diagnostic is ABOUT: a type name, package root, or node id. */
  subject?: string
  /** Structured extras for a future renderer. Never parsed for meaning by the seam itself. */
  detail?: Record<string, unknown>
}

export type HostDiagnosticSink = (diagnostic: HostDiagnostic) => void

/**
 * The one shared sink. Every renderer bundle resolves ONE served copy of this SDK (the shared-dep
 * platform), so this is a plain module singleton (`local`). Under `pnpm dev` vite serves the shell live
 * on its own copy, so the shell (producer) and the projections (consumers) are split instances — then, and
 * only then, they bridge through the `__AU_HOST_DIAGNOSTICS__` window-global. Same shape as `events.ts`.
 */
const KEY = '__AU_HOST_DIAGNOSTICS__'

// Whether the shell + this bundle are split copies (the vite-served dev shell). Set at renderer boot.
const bridging = (): boolean => (globalThis as Record<string, unknown>).__AU_DEV__ === true

interface Shared {
  sink: HostDiagnosticSink | null
}

let local: Shared | null = null

function shared(): Shared {
  // DEV split: the sink lives on the window-global so a projection's report reaches the shell's sink.
  if (bridging()) {
    const g = globalThis as unknown as Record<string, Shared | undefined>
    return (g[KEY] ??= { sink: null })
  }
  // PROD: one served instance → a module singleton.
  return (local ??= { sink: null })
}

/**
 * Install the process-wide sink. The HOST calls this once; until it does, every report goes to
 * the console floor. Passing `null` restores the floor.
 *
 * This is the seam the real channel lands on: the sink starts collecting into a published set,
 * and no emission site changes.
 */
export function setHostDiagnosticSink(sink: HostDiagnosticSink | null): void {
  shared().sink = sink
}

/**
 * Report a host diagnostic. Never throws: a failing sink must not take down the caller, which
 * is by definition already on an error path.
 */
export function reportHostDiagnostic(diagnostic: HostDiagnostic): void {
  const { sink } = shared()
  if (sink) {
    try {
      sink(diagnostic)
      return
    } catch {
      // fall through to the floor — a broken surfacer must not swallow the diagnostic itself
    }
  }
  consoleFloor(diagnostic)
}

/** Console fallback keeps diagnostics observable when no reporting surface handles them. */
function consoleFloor({ code, severity, message, subject }: HostDiagnostic): void {
  const line = `[au:${code}]${subject ? ` ${subject}:` : ''} ${message}`
  if (severity === 'error') console.error(line)
  else if (severity === 'warning') console.warn(line)
  else console.info(line)
}

/**
 * Install a diagnostic sink on the event substrate that turns every host
 * diagnostic into a standing CONDITION (collected in the substrate's condition map, surfaced by the
 * trace inspector's conditions view), while also writing the console floor. The host calls this ONCE at boot. This is what makes
 * diagnostics a derived view of the ONE substrate.
 *
 * The mapping is 1:1: the diagnostic `code` is the condition NAME (the stable match key), `subject`
 * keys it alongside (so a re-raise for the same code+subject updates in place, latest-wins), and the
 * prose `message` plus any `detail` ride as the condition's fields.
 */
export function installDiagnosticConditionBridge(): void {
  setHostDiagnosticSink((d) => {
    condition(d.code, d.severity, d.subject, { message: d.message, ...(d.detail ?? {}) })
    consoleFloor(d) // keep the floor until a SET surfacer exists (a diagnostic must never be silent)
  })
}
