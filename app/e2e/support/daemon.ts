// Daemon lifecycle for the E2E harness. We do NOT pre-start the daemon: the app spawns its own over
// AU_ENTRY, exactly like a normal launch, so `startWorkspace` never hits the SDK's "a daemon is already
// serving this entry" refusal (which a pre-started daemon would trigger and surface as a setup-screen
// error). We only clean up a stale vault daemon before, and stop the app-spawned one after.
import { spawnSync } from 'node:child_process'
import { AU_BINARY, VAULT } from './paths'

/** Stop any daemon currently serving the vault, so the app spawns a fresh one. */
export function stopDaemon(entry = VAULT): void {
  spawnSync(AU_BINARY, ['daemon', 'stop', entry], { encoding: 'utf8' })
}
