// Daemon supervision IPC adapter. The process mechanics — spawn, socket
// shutdown, status probe, log splitting — live in the SDK's
// `DaemonSupervisor`; this wrapper only adapts the frame's config-per-call
// IPC shape onto it.
//
// Lifecycle is user-driven: nothing here runs without an explicit UI action.

import * as fs from 'node:fs'

import { DaemonClient, DaemonSupervisor as SdkDaemonSupervisor, WireSchemaMismatchError } from '@arsumbris/au-engine-sdk'
import { WIRE_SCHEMA_VERSION } from '@arsumbris/au-engine-sdk/wire'

import { resolveDaemonBinary } from './tool-paths'
import type { ActionResult, DaemonConfig, DaemonStatus } from '../shared/daemon-api'

/**
 * Distinguish a WIRE-INCOMPATIBLE daemon from a down/starting one. The SDK's
 * readiness probe (`probeReady`) collapses a schema mismatch to `null` — the daemon
 * IS serving and answers the `ready` read, but the client rejects the reply frame
 * because its `schema_version` differs, and returns `null` like an unreachable
 * socket. That is exactly the case that reads as "engine started but has not begun
 * serving" while the engine is fine and only the wire versions are skewed.
 *
 * So when the daemon is not confirmed running, do ONE targeted probe: connect + issue
 * the `lifecycle` read; the client throws `WireSchemaMismatchError` (carrying the daemon's
 * reported version + a ready-made message) iff the socket is reachable but skewed.
 * Any other outcome (no socket, other error, or a clean answer) is `null` — leave it
 * to the generic path.
 */
async function probeSchemaMismatch(entryPath: string): Promise<DaemonStatus['schemaMismatch']> {
  let client: DaemonClient
  try {
    client = await DaemonClient.connect(entryPath)
  } catch {
    return undefined // no reachable socket — a down/starting daemon, not a skew
  }
  try {
    await client.read({ read: 'lifecycle' })
    return undefined // answered without a mismatch (matched, or no version to compare)
  } catch (err) {
    if (err instanceof WireSchemaMismatchError) {
      return { daemonSchema: err.actual, hostSchema: err.expected, message: err.message }
    }
    return undefined // some other read failure — the generic path owns it
  } finally {
    client.close()
  }
}

/**
 * Trust-boundary validation: the effective binary is either renderer-supplied
 * (the user configures it in the gate UI) or main-resolved (`resolveDaemonBinary`), and we are about
 * to SPAWN it. Validate it points at a real, executable file before the spawn. Validated, not
 * hard-pinned — the user legitimately chooses where their `au` binary lives. Returns an error
 * message, or null if it checks out.
 */
function validateBinary(binaryPath: string): string | null {
  if (!binaryPath || !binaryPath.trim()) {
    return 'au engine binary not found. Install au onto PATH, set `au:` in paths.yaml, or choose its location.'
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(binaryPath)
  } catch {
    return `daemon binary not found: ${binaryPath}`
  }
  if (!stat.isFile()) return `daemon binary is not a file: ${binaryPath}`
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK)
  } catch {
    return `daemon binary is not executable: ${binaryPath}`
  }
  return null
}

export class DaemonSupervisor {
  private readonly inner = new SdkDaemonSupervisor()
  // The entry of the daemon child we currently own. The SDK tracks this internally but does not
  // expose WHICH entry, and its `stop(entry)` only reaches the owned child when `entry` matches.
  // We mirror it here so a workspace SWITCH can stop the previous workspace's daemon (below).
  private ownedEntry: string | null = null
  private exitListener: (code: number | null, entryPath: string | null) => void = () => {}

  constructor() {
    // Mirror the SDK's child-exit cleanup in owned-entry tracking, then forward the exit.
    // The event carries its entry so a workspace switch can distinguish the old daemon's deliberate stop
    // from a crash of the newly started daemon, even when both exits occur during one start call.
    this.inner.onExit = (code) => {
      const exited = this.ownedEntry
      this.ownedEntry = null
      this.exitListener(code, exited)
    }
  }

  set onLog(listener: (line: string) => void) {
    this.inner.onLog = listener
  }

  /** `entryPath` is the entry the exited child was serving (null if unknown), so a listener can
   *  tell whose death this was. See the constructor note. */
  set onExit(listener: (code: number | null, entryPath: string | null) => void) {
    this.exitListener = listener
  }

  async status(config: DaemonConfig): Promise<DaemonStatus> {
    const status = await this.inner.status(config.entryPath)
    const base: DaemonStatus = {
      running: status.running,
      booting: status.booting,
      ownedByFrame: status.owned,
      probe: status.probe,
      schemaVersion: WIRE_SCHEMA_VERSION,
    }
    // Serving + compatible: nothing more to diagnose. Otherwise check whether the
    // reason we can't confirm it is a wire-schema skew (reachable but rejected), so
    // the gate can say "update the SDK/binary" instead of "stuck / still initializing".
    if (status.running) return base
    const schemaMismatch = await probeSchemaMismatch(config.entryPath)
    return schemaMismatch ? { ...base, schemaMismatch } : base
  }

  async start(config: DaemonConfig): Promise<ActionResult> {
    const binaryPath = this.effectiveBinary(config.binaryPath)
    const problem = validateBinary(binaryPath)
    if (problem) return { ok: false, error: problem }
    // WORKSPACE SWITCH: if we still own a daemon for a DIFFERENT entry, stop it first. Otherwise the
    // SDK refuses with "this supervisor already owns a running daemon child", and the gate — now
    // pointed at the new entry — has no way to reach the old child to stop it (the user gets stuck
    // on the start screen). The supervisor owns one daemon at a time, so leaving a workspace means
    // its daemon should go.
    if (this.ownedEntry && this.ownedEntry !== config.entryPath) {
      this.inner.onLog(`switching workspace — stopping the daemon for ${this.ownedEntry}`)
      // Pass the binary so a stale-handle case (we mirror ownership but the SDK's child is gone)
      // still reclaims the old workspace's wedged daemon rather than stranding it. On the normal
      // owned path the SDK ignores `auBinaryPath` and uses its socket + SIGKILL sequence.
      await this.inner.stop(this.ownedEntry, this.reclaimOptions(binaryPath))
      this.ownedEntry = null
    }
    // Translate the host's dev FLAG into the one env var it authorises. The renderer never supplies
    // an environment; main decides what a `trace: true` is allowed to mean. See `DaemonConfig.trace`.
    const r = await this.inner.start({
      binaryPath,
      entryPath: config.entryPath,
      ...(config.trace ? { env: { AU_TRACE: '1' } } : {}),
    })
    if (r.ok) this.ownedEntry = config.entryPath
    return r
  }

  async stop(config: DaemonConfig): Promise<ActionResult> {
    // Stop a non-owned daemon that still holds the entry with a live PID but an unresponsive socket.
    // With its binary path, the SDK invokes `au daemon stop --force`, which owns the graceful-stop,
    // SIGTERM, and SIGKILL sequence. Owned daemons use the socket-plus-SIGKILL path instead.
    // This runs only after the user presses Stop; the host does not automatically stop the daemon.
    const r = await this.inner.stop(config.entryPath, this.reclaimOptions(this.effectiveBinary(config.binaryPath)))
    if (r.ok && this.ownedEntry === config.entryPath) this.ownedEntry = null
    return r
  }

  /**
   * The binary to spawn: the renderer's explicit `binaryPath` (the user's gate-UI / paths.yaml `au:`
   * choice) when set, else main-resolved from PATH (`resolveDaemonBinary`). So a fresh install with
   * `au` on PATH — or an install-seeded `paths.yaml au:` — starts with no manual step, while an
   * explicit configured path still wins. Empty string when nothing resolves (validated at the spawn).
   */
  private effectiveBinary(configured: string): string {
    const explicit = configured?.trim()
    if (explicit) return explicit
    return resolveDaemonBinary() ?? ''
  }

  /** Non-owned reclaim needs a real `au` binary to shell `stop --force`. Only hand one over when the
   *  effective path is non-empty; an empty string would spawn nothing and mask the informative
   *  "no daemon reachable" with a spawn error. The path is validated at `start`, not here. */
  private reclaimOptions(binaryPath: string): { auBinaryPath: string } | undefined {
    return binaryPath && binaryPath.trim() ? { auBinaryPath: binaryPath } : undefined
  }

  /** Best-effort graceful shutdown of an owned child, for app quit. */
  dispose(): void {
    this.inner.dispose()
  }
}
