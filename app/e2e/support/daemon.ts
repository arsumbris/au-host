// Daemon lifecycle for the E2E harness. We do NOT pre-start the daemon: the app spawns its own over
// AU_ENTRY, exactly like a normal launch, so `startWorkspace` never hits the SDK's "a daemon is already
// serving this entry" refusal. Each test's vault is its own entry, so the harness stops that vault's
// app-spawned daemon when the test ends.
import { spawnSync } from 'node:child_process'
import { AU_BINARY } from './paths'

/** A wedged daemon must not hang the harness: each call is bounded. */
const DAEMON_CALL_TIMEOUT_MS = 10_000

/** Stop the daemon serving `entry`, if any. */
export function stopDaemon(entry: string): void {
  spawnSync(AU_BINARY, ['daemon', 'stop', entry], { encoding: 'utf8', timeout: DAEMON_CALL_TIMEOUT_MS })
}

/** What `au daemon status` reports for `entry`, stdout and stderr together, for a failure dump. */
export function daemonStatus(entry: string): string {
  const r = spawnSync(AU_BINARY, ['daemon', 'status', entry], { encoding: 'utf8', timeout: DAEMON_CALL_TIMEOUT_MS })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() || `(exit ${r.status ?? r.signal})`
}
