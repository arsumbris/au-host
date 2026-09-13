// The boot gate: the host's screen for selecting and opening a workspace.

import { useCallback, useEffect, useRef, useState } from 'react'

import {DisclosureChevron} from './DisclosureChevron'
import { McpSetup } from './McpSetup'
import { Launcher as LauncherView } from './design/Launcher/Launcher'
import { LauncherStage } from './LauncherStage'
import {Welcome} from './Welcome'
import {WorkspaceCreate} from './WorkspaceCreate'
import { transitionLauncher } from './presentation-transition'
import { BootProgress, type BootState } from './design/BootProgress/BootProgress'
import './design/tokens/tokens.css'
import './launcher.css'
import './gate.css'
import './setup.css'
import { gateRoot } from './gate'
import type { GateSelection } from './gate'
import type { LauncherHost } from './launcher-host'
import type { RecentWorkspace } from '@arsumbris/au-host-sdk'

/** Reconstruct a gate selection from a recents entry. Entry == root, so `root` IS the selection. */
function selectionFromRecent(w: RecentWorkspace): GateSelection {
  return { entry: w.root }
}
import type { DaemonConfig, DaemonStatus, GateInspection, McpStatus } from '@arsumbris/au-host-app'

const POLL_INTERVAL_MS = 1500
const MAX_LOG_LINES = 300
// Readiness watchdog: after the daemon child SPAWNS, it binds its socket (starts
// SERVING) only once it has assembled the entry. A hung daemon (e.g. a huge entry /
// oversized session logs pegging 100% CPU) never binds, and without this would read
// as a silent "not running". Poll until it serves, or surface a stuck message.
const START_SERVING_TIMEOUT_MS = 15_000
const START_POLL_MS = 800

interface LauncherProps {
  /** The app-provided capability surface (the app passes `window.main`). */
  host: LauncherHost
  config: DaemonConfig
  onConfigChange: (patch: Partial<DaemonConfig>) => void
  /** Mount the composition in-process — the single-process handoff into the host. */
  onEnter: () => void
  /** The in-code default entry to preselect (a dev convenience the app supplies). */
  defaultEntry?: string
}

export function Launcher({ host, config, onConfigChange, onEnter, defaultEntry }: LauncherProps): React.JSX.Element {
  // The main-process recents store supplies the workspace form and persists recent entries.
  const [gate, setGate] = useState<GateSelection>(() => ({ entry: defaultEntry ?? '' }))
  const [recentQuery,setRecentQuery]=useState('')
  const [recents, setRecents] = useState<RecentWorkspace[]>([])
  // The workspace entry this instance was spawned to open (`windows.open` → `AU_ENTRY`), or null for
  // a plain launch. When set, it wins over the recents pre-fill and the instance opens it directly
  // once the selection is valid. See the host-instances spec.
  const [autoEntry, setAutoEntry] = useState<string | null>(null)
  const didAutoOpen = useRef(false)
  // While a spawned instance auto-opens its workspace, show a compact loading view instead of the
  // full setup form. `showSetup` is the manual escape to the full gate; auto-open ALSO falls back to
  // it on its own the moment the selection turns out invalid / unlocated or the daemon fails.
  const [showSetup, setShowSetup] = useState(false)
  // True while a manual launch is starting the engine + mcp, so the launcher shows
  // the boot progress instead of a frozen CTA. On success `enter()` unmounts us; on failure it clears.
  const [launching, setLaunching] = useState(false)
  // False until the mount effect has resolved the launch entry + recents. Until then we do NOT know
  // whether this is an auto-opening instance or a plain launch, so we show the loader rather than
  // flashing the full setup form for a frame before the launch entry lands.
  const [bootChecked, setBootChecked] = useState(false)
  const [status, setStatus] = useState<DaemonStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Seconds elapsed while waiting for a just-spawned daemon to begin serving; null when not waiting.
  const [startingSecs, setStartingSecs] = useState<number | null>(null)
  // Track the daemon-child exit stream so the watchdog can distinguish a crash from a slow startup.
  // Reset this state for each launch attempt so an exit from a superseded child cannot describe the
  // current daemon.
  const childExitRef = useRef<{ code: number | null; entryPath: string | null } | null>(null)
  // Set by `stop()` to CANCEL an in-flight readiness watchdog (the user stopping a
  // slow/stuck startup). The watchdog bails without showing a crash/stuck error.
  const startAbortRef = useRef(false)
  const [log, setLog] = useState<string[]>([])
  const [inspection, setInspection] = useState<GateInspection | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null)
  const [mcpConfigured, setMcpConfigured] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createStarter,setCreateStarter]=useState<{source:string;path:string}|undefined>(undefined)
  // First-run / freshly-cloned detection: the entry's declared members (workspace.yaml edit:/discover:
  // plus repo.yaml deps) not yet located
  // in the device `repos.yaml` (they would not mount). Guided locate flow below.
  const [missing, setMissing] = useState<string[]>([])
  const [locating, setLocating] = useState(false)
  const [locateMsg, setLocateMsg] = useState('')
  const logRef = useRef<HTMLPreElement>(null)

  const root = gateRoot(gate)
  const target = gate.entry

  // Validate the selection with raw fs (daemon-free) so a wrong entry is caught
  // BEFORE start, with a message — not as an empty picker after entering.
  useEffect(() => {
    let cancelled = false
    void host.gate.inspect(target).then((r) => {
      if (!cancelled) setInspection(r)
    })
    return () => {
      cancelled = true
    }
  }, [target])
  // Three outcomes, and only ONE of them is a real error. `notARepo` is a directory that simply
  // has no `.arsumbris/repo.yaml` yet — recoverable in place, so it gets a scaffold offer rather
  // than a red dead-end. Everything else invalid (missing, or a file) is a genuine problem.
  const notARepo = inspection?.notARepo ?? false
  const invalid = inspection !== null && !inspection.ok
  const [scaffolding, setScaffolding] = useState(false)

  // Detect unlocated members of the selected workspace (pre-daemon, raw). Re-checked when the
  // selection changes and after a locate pass.
  const refreshMissing = useCallback(async (): Promise<void> => {
    if (!gate.entry.trim()) {
      setMissing([])
      return
    }
    setMissing(await host.gate.missingLocations(gate.entry.trim()))
  }, [gate.entry])
  useEffect(() => {
    void refreshMissing()
  }, [refreshMissing])

  // Turn the picked directory into a folder-repo, then re-inspect so `enter` unlocks. The engine
  // refuses a non-repo entry outright and names this as the consumer's job, so the gate owns it.
  const scaffoldEntry = async (): Promise<void> => {
    setScaffolding(true)
    setError('')
    const r = await host.gate.scaffoldEntry(target)
    setScaffolding(false)
    if (!r.ok) {
      setError(r.error ?? 'could not scaffold the workspace')
      return
    }
    setInspection(await host.gate.inspect(target))
    await refreshMissing()
  }

  // Guided locate: pick a folder, scan it for the missing members, register what it finds into the
  // device repos.yaml, then re-check. Iterative — scan another folder if some are still missing.
  const locateMissing = async (): Promise<void> => {
    const dir = await host.dialog.pickPath('directory')
    if (!dir) return
    setLocating(true)
    setLocateMsg('')
    const found = await host.gate.scanFor(dir, missing)
    // One path per name (first match wins if a name appears twice under the folder).
    const seen = new Set<string>()
    const entries = found.filter((f) => (seen.has(f.name) ? false : seen.add(f.name)))
    if (entries.length > 0) {
      const res = await host.gate.locateMembers(entries)
      if (!res.ok) {
        setLocateMsg(res.error ?? 'could not register located members')
        setLocating(false)
        return
      }
    }
    await refreshMissing()
    setLocateMsg(entries.length > 0 ? `located ${entries.length} under ${dir}` : `no missing members found under ${dir}`)
    setLocating(false)
  }

  const updateGate = (patch: Partial<GateSelection>): void => {
    setGate((prev) => ({ ...prev, ...patch }))
  }

  // On mount: resolve the launch entry FIRST, then load recents. A spawned instance
  // (`AU_ENTRY` set) preselects its own workspace and skips the recents pre-fill; a plain launch
  // pre-fills the most-recent (or the in-code default if there are none). Ordered so the launch
  // entry always wins the race with the recents list.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const launched = await host.app.initialEntry()
      if (cancelled) return
      if (launched) {
        setAutoEntry(launched)
        setGate({ entry: launched })
        onConfigChange({ entryPath: launched })
      }
      const list = await host.recents.listWorkspaces()
      if (cancelled) return
      setRecents(list)
      if (!launched && list[0]) setGate(selectionFromRecent(list[0]))
      setBootChecked(true)
    })()
    return () => {
      cancelled = true
    }
    // Mount-once: the launch entry and the initial recents pre-fill are read a single time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const appendLog = useCallback((line: string): void => {
    setLog((prev) => {
      const next = [...prev, line]
      return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next
    })
  }, [])

  // The daemon's child stdout/stderr + exit, so a failed start shows its cause.
  useEffect(() => {
    const offLog = host.daemon.onLog(appendLog)
    const offExit = host.daemon.onExit((code, entryPath) => {
      childExitRef.current = { code, entryPath }
      // Name the entry in the log too — during a switch two daemons die and start in quick
      // succession, and an unlabelled line cannot be told apart.
      appendLog(`[host] daemon child exited (code ${code ?? '?'})${entryPath ? ` — ${entryPath}` : ''}`)
    })
    const offMcpLog = host.mcp.onLog((line) => appendLog(`[mcp] ${line}`))
    const offMcpExit = host.mcp.onExit((code) => appendLog(`[mcp] daemon exited (code ${code ?? '?'})`))
    return () => {
      offLog()
      offExit()
      offMcpLog()
      offMcpExit()
    }
  }, [appendLog])

  // Poll the engine daemon + the mcp daemon over the currently-selected root,
  // plus whether the mcp CLI is configured (so its controls enable + reflect a
  // save from the setup section below without a manual refresh).
  const refresh = useCallback(async (): Promise<void> => {
    if (!root) {
      setStatus(null)
      setMcpStatus(null)
      return
    }
    const [engine, mcp, tools] = await Promise.all([
      host.daemon.status({ ...config, entryPath: root }),
      host.mcp.status(root),
      host.mcp.toolPaths(),
    ])
    setStatus(engine)
    setMcpStatus(mcp)
    setMcpConfigured(Boolean(tools.paths.auMcp))
  }, [root, config])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const browse = async (): Promise<void> => {
    const picked = await host.dialog.select()
    if (!picked) return
    updateGate({ entry: picked })
  }

  // Poll the daemon status until it is SERVING (socket bound), the child EXITS, or a
  // timeout — updating the "starting… (Ns)" indicator while it waits. The spawn
  // resolving only means the OS created the process; this is the real readiness edge.
  const waitForServing = useCallback(
    async (
      cfg: DaemonConfig,
    ): Promise<
      | { kind: 'serving' }
      | { kind: 'exited'; code: number | null }
      | { kind: 'timeout' }
      | { kind: 'cancelled' }
      | { kind: 'schema-mismatch'; message: string }
    > => {
      const startedAt = Date.now()
      for (;;) {
        if (startAbortRef.current) return { kind: 'cancelled' }
        const exit = childExitRef.current
        // Only OUR child's death counts. An exit for a different entry is the previous workspace's
        // daemon being stopped by the switch inside `start()` — not a failure of this start.
        // `entryPath === null` means the supervisor could not attribute it; treat that as ours,
        // since a swallowed real crash is worse than a spurious one.
        if (exit && (exit.entryPath === null || exit.entryPath === cfg.entryPath)) {
          return { kind: 'exited', code: exit.code }
        }
        const s = await host.daemon.status(cfg)
        if (s.running) return { kind: 'serving' }
        // A reachable daemon with a different wire schema cannot become ready for this client.
        // Report the mismatch immediately so the user can resolve it.
        if (s.schemaMismatch) return { kind: 'schema-mismatch', message: s.schemaMismatch.message }
        const elapsed = Date.now() - startedAt
        if (elapsed >= START_SERVING_TIMEOUT_MS) return { kind: 'timeout' }
        setStartingSecs(Math.floor(elapsed / 1000))
        await new Promise((r) => setTimeout(r, START_POLL_MS))
      }
    },
    [],
  )

  const stuckMessage = (): string =>
    `engine started but has not begun serving after ${Math.round(START_SERVING_TIMEOUT_MS / 1000)}s — ` +
    `it may still be initializing, or stuck. check the log below, or Stop and retry.`

  // An existing daemon with a live pid and silent socket may still be starting.
  // Surface its state and let the user choose how to proceed; do not silently start a competing daemon.
  const WEDGED_RECLAIM_MSG =
    'a daemon is already present on this entry but not serving (starting or wedged) — press Stop to reclaim it, then Start again'

  // A pre-spawn probe: true when a foreign booting/wedged daemon holds the entry, so the caller must
  // NOT spawn over it. Fetched fresh (not the polled `status`) so the guard is authoritative at the
  // moment of the click.
  const foreignBootingDaemon = async (cfg: DaemonConfig): Promise<boolean> => {
    const s = await host.daemon.status(cfg)
    return s.booting && !s.running && !s.ownedByFrame
  }

  const start = async (): Promise<void> => {
    if (!root) {
      setError('select a workspace file or a location first')
      return
    }
    setBusy(true)
    setError('')
    onConfigChange({ entryPath: root })
    const cfg = { ...config, entryPath: root }
    if (await foreignBootingDaemon(cfg)) {
      setError(WEDGED_RECLAIM_MSG)
      await refresh()
      setBusy(false)
      return
    }
    childExitRef.current = null
    startAbortRef.current = false
    const result = await host.daemon.start(cfg)
    if (!result.ok) {
      setError(result.error ?? 'start failed')
      await refresh()
      setBusy(false)
      return
    }
    // The spawn succeeded; wait until the daemon actually SERVES (or surface why not).
    // 'cancelled' (the user hit Stop mid-wait) surfaces nothing — Stop handles it.
    const outcome = await waitForServing(cfg)
    setStartingSecs(null)
    // 'cancelled' = the user hit Stop mid-wait; stop() owns the rest of the
    // lifecycle (killing the child + clearing busy once it is actually gone), so
    // bail WITHOUT clearing busy — else Start re-enables before the kill lands.
    if (outcome.kind === 'cancelled') return
    if (outcome.kind === 'exited') {
      setError(`engine exited during startup (code ${outcome.code ?? '?'}) — see the log below`)
    } else if (outcome.kind === 'schema-mismatch') {
      setError(outcome.message)
    } else if (outcome.kind === 'timeout') {
      setError(stuckMessage())
    }
    await refresh()
    setBusy(false)
  }

  const stop = async (): Promise<void> => {
    if (!root) return
    // Cancel any in-flight start watchdog (the user stopping a slow/stuck startup).
    // `daemon.stop` force-kills the OWNED child after a graceful window, so a daemon
    // that spawned but never began serving can still be stopped mid-startup.
    startAbortRef.current = true
    setStartingSecs(null)
    setBusy(true)
    setError('')
    const cfg = { ...config, entryPath: root }
    const result = await host.daemon.stop(cfg)
    if (!result.ok) setError(result.error ?? 'stop failed')
    // The SIGKILL + the child's exit are async, so `daemon.stop` can resolve while the daemon is
    // still going down. Wait until the entry is actually CLEAR before re-enabling Start — else a
    // quick re-start hits "already owns a running daemon child" (owned path), or races a
    // still-dying non-owned daemon over its reclaim window (`booting`, the graceful→SIGKILL window
    // the engine's `stop --force` owns). Clear = no owned child, no live pid, no socket answer.
    const deadline = Date.now() + 6000
    for (;;) {
      const s = await host.daemon.status(cfg)
      if ((!s.ownedByFrame && !s.booting && !s.running) || Date.now() >= deadline) break
      await new Promise((r) => setTimeout(r, 250))
    }
    await refresh()
    setBusy(false)
  }

  const startMcp = async (): Promise<void> => {
    if (!root) return
    setBusy(true)
    setError('')
    const result = await host.mcp.start(root)
    if (!result.ok) setError(result.error ?? 'mcp start failed')
    await refresh()
    setBusy(false)
  }

  const stopMcp = async (): Promise<void> => {
    if (!root) return
    setBusy(true)
    setError('')
    const result = await host.mcp.stop(root)
    if (!result.ok) setError(result.error ?? 'mcp stop failed')
    await refresh()
    setBusy(false)
  }

  // The one-click: engine up, wait until it is READY (so the mcp daemon brokers a
  // live graph, not a still-deriving one), then the mcp daemon. Skips whichever is
  // already running.
  const startWorkspace = async (): Promise<boolean> => {
    if (!root) {
      setError('select a workspace file or a location first')
      return false
    }
    setBusy(true)
    setError('')
    onConfigChange({ entryPath: root })

    const cfg = { ...config, entryPath: root }
    if (!(status?.running)) {
      if (await foreignBootingDaemon(cfg)) {
        setError(WEDGED_RECLAIM_MSG)
        await refresh()
        setBusy(false)
        return false
      }
      childExitRef.current = null
      startAbortRef.current = false
      const r = await host.daemon.start(cfg)
      if (!r.ok) {
        setError(r.error ?? 'engine start failed')
        await refresh()
        setBusy(false)
        return false
      }
      // Wait until the daemon actually SERVES before waiting for it to derive.
      const outcome = await waitForServing(cfg)
      setStartingSecs(null)
      if (outcome.kind === 'cancelled') return false // stop() owns busy + the kill
      if (outcome.kind !== 'serving') {
        if (outcome.kind === 'exited')
          setError(`engine exited during startup (code ${outcome.code ?? '?'}) — mcp not started; see the log below`)
        else if (outcome.kind === 'timeout') setError(`${stuckMessage()} (mcp not started)`)
        await refresh()
        setBusy(false)
        return false
      }
    }

    // Wait (bounded) for the engine to finish deriving.
    let engineReady = status?.probe?.ready ?? false
    const deadline = Date.now() + 20_000
    while (!engineReady && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500))
      const s = await host.daemon.status(cfg)
      engineReady = s.probe?.ready ?? false
    }
    if (!engineReady) {
      setError('engine did not finish deriving in time — mcp not started')
      await refresh()
      setBusy(false)
      return false
    }

    if (mcpConfigured && !(mcpStatus?.running)) {
      const r = await host.mcp.start(root)
      if (!r.ok) setError(r.error ?? 'mcp start failed')
    }
    await refresh()
    setBusy(false)
    return true
  }

  const enter = (): void => {
    onConfigChange({ entryPath: root })
    // Record the open in the recents store (the composition open is recorded post-daemon-ready).
    void host.recents.touchWorkspace({ root })
    onEnter()
  }

  // A spawned instance (`AU_ENTRY`) opens its workspace on its own once the preselected entry is a
  // valid, fully-located repo — reusing the same one-click start + enter the button drives. If the
  // selection is not valid (not a repo, invalid, or members unlocated) it stays on the gate so the
  // user resolves it, exactly as a manual selection would. Fires at most once.
  useEffect(() => {
    if (!autoEntry || didAutoOpen.current) return
    if (gate.entry !== autoEntry) return // wait until the preselect has applied
    if (inspection === null) return // wait for the validity probe to land
    if (invalid || notARepo || missing.length > 0) return // leave the gate up to resolve
    didAutoOpen.current = true
    void (async () => {
      const ok = await startWorkspace()
      if (ok) enter()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEntry, gate.entry, inspection, invalid, notARepo, missing])

  const running = status?.running ?? false
  const ready = status?.probe?.ready ?? false
  const owned = status?.ownedByFrame ?? false
  // A daemon that is up + reachable but on a different wire schema than this host —
  // it answers, but the client rejects every frame, so it never reads as "running".
  const schemaMismatch = status?.schemaMismatch
  // A daemon has a live pid on this entry but its socket is silent: cold-building or wedged. This
  // reads as "starting" (not the false "stopped"), whether or not we spawned it — a daemon started
  // externally, or a prior host session's that outlived us, is booting-and-foreign but still occupies
  // the entry. Its reclaim is offered through Stop (below + `canStop`).
  const daemonBooting = (status?.booting ?? false) && !running
  // While waiting for a just-spawned daemon to begin serving, show "starting… (Ns)"
  // instead of a misleading "stopped".
  const starting = startingSecs !== null && !running
  const pillClass = starting || daemonBooting ? 'starting' : running ? (ready ? 'ready' : 'starting') : 'stopped'
  const pillText = starting
    ? `starting… ${startingSecs}s`
    : running
      ? ready
        ? 'ready'
        : 'deriving'
      : daemonBooting
        ? 'starting'
        : schemaMismatch
          ? 'schema mismatch'
          : 'stopped'
  // Stop is available whenever there's something to stop — serving, an owned child, an in-flight
  // startup wait (so a slow/stuck start can be cancelled), or a booting/wedged daemon on the entry
  // (so a non-owned one can be reclaimed). NOT gated on `busy`, since the start watchdog holds
  // `busy` for the whole wait.
  const canStop = running || owned || startingSecs !== null || daemonBooting

  const mcpRunning = mcpStatus?.running ?? false
  const mcpListening = mcpStatus?.listening ?? false
  const mcpPillClass = mcpRunning ? (mcpListening ? 'ready' : 'starting') : 'stopped'
  const mcpPillText = mcpRunning ? (mcpListening ? 'mcp ready' : 'mcp starting') : 'mcp stopped'

  // A spawned instance (`AU_ENTRY`) opens its workspace on its own, so the full setup form would just
  // flash by. While that auto-open is in flight AND healthy, show a compact loading view instead. It
  // falls back to the full gate the moment the selection is invalid / unlocated, the daemon errors,
  // or the user asks for setup — exactly the cases where the form is actually needed.
  const autoOpening =
    autoEntry !== null && !showSetup && error === '' && inspection?.notARepo !== true && !invalid && missing.length === 0
  // Also loader while the launch entry is still resolving (`!bootChecked`), so the full form never
  // flashes for a frame before we know this is an auto-opening instance.
  const booting = !bootChecked && !showSetup
  // The boot phase mapped from the live engine state — the lifecycle BootProgress mirrors. ONE source
  // for both the auto-open loader here and the manual-launch boot below. Every branch returns the same
  // `.au-launcher-stage` + `<Mist>` shell, so React reuses the mist canvas across them (no re-init).
  // While a launch is in flight, hold at least 'starting' — `startingSecs` briefly clears before
  // `running` flips, which otherwise bounced the bar back to 'selected' for a frame.
  const bootState: BootState =
    !bootChecked
      ? 'idle'
      : running
        ? ready
          ? 'ready'
          : 'deriving'
        : launching || startingSecs !== null
          ? 'starting'
          : 'selected'
  if (booting || autoOpening) {
    return (
      <LauncherStage view={booting ? 'home' : 'boot'}>
        <div className="au-launcher-boot">
          {booting ? <div className="au-launcher-skeleton" role="status" aria-label="Loading workspaces" aria-busy="true">
            {[0,1,2].map(row=><div className="au-launcher-skeleton__row" key={row} aria-hidden="true"><i /><span><b /><b /></span></div>)}
          </div> : <BootProgress state={bootState} className="au-launcher-boot__progress" />}
          {bootChecked && (
            <button className="au-launcher-boot__escape" onClick={() => setShowSetup(true)}>
              open setup instead
            </button>
          )}
        </div>
      </LauncherStage>
    )
  }

  // The workspace launcher shows recents, Launch, Open folder and New workspace. The full
  // setup FORM is shown only when setup is actually needed — a problem to resolve (invalid / not a
  // repo / unlocated members), a launch error, or an explicit setup/create request. So a clean pick
  // stays in the launcher; unresolved cases use the setup form below.
  // An empty selection shows the launcher's empty/select state. Only a
  // non-empty selection with a real problem (or an explicit setup/create/error) falls to the form.
  const needsSetup =
    showSetup || createOpen || error !== '' || (Boolean(root) && (invalid || notARepo || missing.length > 0))

  // Back leaves recovery without selecting another workspace. A recent's stale flag
  // is cached metadata, not validation; choosing it here can reopen the same error.
  const backToLauncher = (): void => {
    setCreateOpen(false)
    setCreateStarter(undefined)
    setError('')
    setShowSetup(false)
    setAutoEntry(null)
    didAutoOpen.current = true
    if (invalid || notARepo || missing.length > 0) {
      setGate({ entry: '' })
      setInspection(null)
      setMissing([])
    }
  }

  if (createOpen) return <WorkspaceCreate host={host} initialTemplate={createStarter} config={config} onConfigChange={onConfigChange} onExit={backToLauncher}
    onCreated={entry => {
      setInspection(null)
      updateGate({entry})
      setCreateOpen(false)
      setShowSetup(false)
      didAutoOpen.current = false
      setAutoEntry(entry)
    }} />

  if (!needsSetup) {
    const recentsForView = recents.map((w) => ({
      name: w.root.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || w.root,
      path: w.root,
      // "serving" is the daemon actually up for THIS entry — only the current one in a single process.
      live: running && w.root === root,
      needsSetup: w.stale,
      layoutLabel: w.compositions?.[0]?.path.split(/[/\\]/).pop()?.replace(/\.(yaml|yml|md)$/, ''),
    }))
    // One-click launch: start the engine (+ mcp), wait until ready, then enter — reusing the existing
    // single-process flow. `onOpen` fires only for the selected path, which is already `gate`/`root`.
    const launchSelected = async (): Promise<void> => {
      setLaunching(true)
      const ok = await startWorkspace()
      if (ok) enter()
      else setLaunching(false)
    }
    // TWO daemons, shown distinctly: the ENGINE (`au`, what
    // the workspace runs on) always, and MCP (`au-mcp`, the agent-tools broker) only when it is
    // configured. Neither is running before Launch, so the resting word is "off", never "idle".
    const statusNode = (
      <span className="au-launcher-status">
        <span className="status-pill" data-tone={running ? (ready ? 'ok' : 'warn') : 'neutral'} data-pulse={running || starting || daemonBooting} data-muted={!running && !starting && !daemonBooting}>
          <span className="au-launcher-status__label">engine</span>
          <span className="au-launcher-status__detail">{running ? (ready ? 'ready' : 'deriving') : 'off'}</span>
        </span>
        {mcpConfigured ? (
          <span className="status-pill" data-tone={mcpRunning ? (mcpListening ? 'ok' : 'warn') : 'neutral'} data-pulse={mcpRunning} data-muted={!mcpRunning}>
            <span className="au-launcher-status__label">mcp</span>
            <span className="au-launcher-status__detail">{mcpRunning ? (mcpListening ? 'ready' : 'starting') : 'off'}</span>
          </span>
        ) : null}
      </span>
    )
    return (
      <LauncherStage view={launching ? 'boot' : 'home'} title={!launching && !root && !recents.length ? 'Welcome' : undefined}>
        {launching ? (
          <div className="au-launcher-boot">
            <BootProgress state={bootState} className="au-launcher-boot__progress" />
          </div>
        ) : !root && !recents.length ? (
          <Welcome host={host} onCreate={template => transitionLauncher(() => {setCreateStarter(template);setCreateOpen(true)})} onOpen={() => void browse()} />
        ) : (
          <LauncherView
            className="au-launcher--host"
            showIdentity={false}
            recents={recentsForView}
            selectedPath={root || undefined}
            onSelect={(path) => setGate({ entry: path })}
            onOpen={() => void launchSelected()}
            onOpenFolder={() => void browse()}
            onNew={() => transitionLauncher(() => setCreateOpen(true))}
            canLaunch={Boolean(root) && !busy}
            launchReason={!root ? 'Select a workspace' : undefined}
            status={statusNode}
          />
        )}
      </LauncherStage>
    )
  }

  return (
    <LauncherStage view="setup">
      <div className="au-launcher-setup">
        <div className="gate">
          <div className="gate-card panel">
          <button className="au-launcher-setup__back" onClick={() => transitionLauncher(backToLauncher)}>
            ← Back to launcher
          </button>
        <div className="gate-head">
          <h2>Open a workspace</h2>
          <span className="app-subtitle">Resolve the details below, then open your workspace.</span>
        </div>

        {!createOpen && recents.length > 0 && (
          <details className="gate-recents gate-disclosure">
            <summary><span>Recent workspaces</span><DisclosureChevron /></summary>
            <div className="gate-recents-body"><input aria-label="Find a recent workspace" type="search" placeholder="Find a workspace…" value={recentQuery} onChange={e=>setRecentQuery(e.target.value)}/>
            <div className="gate-recents-list" onKeyDown={event=>{
              if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
              const rows=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
              const index=rows.indexOf(document.activeElement as HTMLButtonElement)
              if(index<0)return
              event.preventDefault()
              const next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)))
              rows[next]?.focus()
            }}>
              {recents.filter(w=>w.root.toLowerCase().includes(recentQuery.toLowerCase())).map((w) => {
                const name = w.root.split('/').pop() ?? w.root
                const active = gateRoot(gate) === w.root
                // Keep an existing folder visible in recents even when it is not a repository, with its status shown.
                return (
                  <button
                    key={w.root}
                    aria-pressed={active}
                    className={`gate-recent${active ? ' active' : ''}${w.stale ? ' stale' : ''}`}
                    title={w.stale ? `${w.root} — not a repo yet; pick it to set it up` : w.root}
                    onClick={() => setGate(selectionFromRecent(w))}
                  >
                    <span className="gate-recent-label"><span className="gate-recent-name">{name}</span><small>{w.root}</small></span><span className="gate-recent-state">{w.stale ? 'Needs setup' : active ? 'Selected' : ''}</span>{active && <span aria-hidden="true">✓</span>}
                  </button>
                )
              })}
              {!recents.some(w=>w.root.toLowerCase().includes(recentQuery.toLowerCase())) && <p className="projection-hint">No matching workspaces. Try another name or browse for a folder.</p>}
            </div></div>
          </details>
        )}

        <details className="gate-disclosure gate-info">
          <summary><span>About workspace folders</span><DisclosureChevron /></summary>
          <div className="gate-info-body">
            <p>A workspace is a folder containing your files and its configuration. Open an existing workspace here, or choose New workspace to start from a template.</p>
            <p>If your folder is not a workspace yet, you can add workspace configuration without replacing its existing files.</p>
            <dl><dt>Workspace identity</dt><dd><code>.arsumbris/repo.yaml</code></dd><dt>Content and tools</dt><dd><code>.arsumbris/workspace.yaml</code> lists editable and referenced sources. Their locations come from this device’s registry.</dd></dl>
          </div>
        </details>

        <div className="config">
          {!createOpen && (
          <label>
            <span>Workspace</span>
            <input
              value={target}
              onChange={(e) => updateGate({ entry: e.target.value })}
              placeholder="/path/to/workspace-folder"
              spellCheck={false}
            />
            <button onClick={() => void browse()}>Browse…</button>
          </label>
          )}
          {!createOpen && invalid &&
            inspection.problems.map((p, i) => (
              <div className="error" role="alert" key={i}>
                ⚠ {p}
              </div>
            ))}

          {/* Not an error: a real folder that simply is not a repo yet. The engine refuses such an
              entry, but the fix is one click, so this is an OFFER rather than a dead end. */}
          {!createOpen && notARepo && (
            <div className="gate-missing">
              <div className="gate-missing-head">
                ⚠ not an arsumbris workspace yet — no <code>.arsumbris/repo.yaml</code> in this folder.
              </div>
              <div className="gate-missing-names">
                Setting it up writes <code>.arsumbris/repo.yaml</code> (naming it{' '}
                <code>{target.split('/').filter(Boolean).pop() ?? 'workspace'}</code>) and{' '}
                <code>.arsumbris/workspace.yaml</code>. Your existing files are untouched.
              </div>
              <div className="gate-missing-actions">
                <button onClick={() => void scaffoldEntry()} disabled={scaffolding}>
                  {scaffolding ? 'Preparing folder…' : 'Use this folder as a workspace'}
                </button>
              </div>
            </div>
          )}

          {!createOpen && !invalid && !notARepo && missing.length > 0 && (
            <div className="gate-missing">
              <div className="gate-missing-head">
                ⚠ {missing.length} member{missing.length === 1 ? '' : 's'} not located on this machine — {' '}
                {missing.length === 1 ? 'it' : 'they'} won’t mount until you point the host at where the repo
                {missing.length === 1 ? ' lives' : 's live'}:
              </div>
              <div className="gate-missing-names">{missing.join(', ')}</div>
              <div className="gate-missing-actions">
                <button onClick={() => void locateMissing()} disabled={locating}>
                  {locating ? 'scanning…' : 'Scan a folder to locate them…'}
                </button>
                {locateMsg && <span className="gate-missing-msg">{locateMsg}</span>}
              </div>
            </div>
          )}

          <button className="gate-info-toggle" onClick={() => transitionLauncher(() => setCreateOpen(true))}>Create a new workspace</button>
        </div>

        <button className="gate-start-workspace" onClick={async()=>{if(running)enter();else if(await startWorkspace())enter()}} disabled={busy || !root || invalid || notARepo || missing.length>0}>
          {busy?'Starting workspace…':running?'Open workspace →':'Start and open workspace →'}
        </button>

        {error && <div className="error" role="alert">{error}</div>}

        {/* An already-running daemon on a skewed wire schema (adopted on gate load, no
            Start pressed) — surface it ambiently. Suppressed while the same message is
            already shown as an action error, to avoid a duplicate. */}
        {schemaMismatch && error !== schemaMismatch.message && (
          <div className="error">
            {schemaMismatch.message} (daemon schema {schemaMismatch.daemonSchema}, host {schemaMismatch.hostSchema})
          </div>
        )}



        <details className="gate-disclosure gate-advanced">
          <summary><span>Engine and agent tools</span><DisclosureChevron /></summary>
          <div className="gate-disclosure-body">
            <div className="config">
          <label>
            <span>Engine executable · required to open</span>
            <input
              value={config.binaryPath}
              onChange={(e) => onConfigChange({ binaryPath: e.target.value })}
              spellCheck={false}
            />
          </label>
          <div className="gate-root">
            engine root <code>{root || '—'}</code>
          </div>
            </div>
        <div className="status-row">
          <span className={`status-pill ${pillClass}`} data-tone={pillClass==='ready'?'ok':pillClass==='starting'?'warn':'neutral'} data-pulse={pillClass!=='stopped'}>{pillText}</span>
          {status?.probe && (
            <span className="status-detail">
              engine={status.probe.engine ?? '?'} ref={status.probe.refState ?? '?'} schema={status.schemaVersion}
              {status.ownedByFrame ? ' · owned by frame' : ''}
            </span>
          )}
          <span className="spacer" />
          <button onClick={() => void start()} disabled={busy || running || !root || invalid}>
            Start engine
          </button>
          <button onClick={() => void stop()} disabled={!root || !canStop}>
            {starting ? 'Cancel startup' : 'Stop engine'}
          </button>
        </div>

        <div className="status-row">
          <span className={`status-pill ${mcpPillClass}`} data-tone={mcpPillClass==='ready'?'ok':mcpPillClass==='starting'?'warn':'neutral'} data-pulse={mcpPillClass!=='stopped'}>{mcpPillText}</span>
          {!mcpConfigured && (
            <span className="status-detail">Configure the MCP executable in Agent tools below.</span>
          )}
          <span className="spacer" />
          <button onClick={() => void startMcp()} disabled={busy || !root || !mcpConfigured || mcpRunning}>
            Start tools
          </button>
          <button onClick={() => void stopMcp()} disabled={busy || !mcpRunning}>
            Stop tools
          </button>
        </div>

            <McpSetup host={host} />
          </div>
        </details>
        <details className="gate-disclosure">
          <summary><span>Startup log {log.length > 0 && <span>({log.length})</span>}</span><DisclosureChevron /></summary>
          <pre className="log" ref={logRef}>
            {log.length ? log.join('\n') : 'No startup messages yet.'}
          </pre>
        </details>
          </div>
        </div>
      </div>
    </LauncherStage>
  )
}
