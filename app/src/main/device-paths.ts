// The host's device-tenant directories, derived from the engine's
// `~/.arsumbris/<owner>/<category>/` convention through the SDK primitive. `au-host` is the
// WRITING tenant, so it is the literal owner segment; the SDK owns the `.arsumbris` literal, the
// category vocabulary, and the raw-`$HOME` rule, so no path segment is re-encoded here.

import { auDeviceDir } from '@arsumbris/au-engine-sdk'

/** The host's run dir: `~/.arsumbris/au-host/run` — ephemeral runtime sockets (host + instance). */
export function hostRunDir(): string {
  return auDeviceDir('au-host', 'run')
}

/** The host's config dir: `~/.arsumbris/au-host/config` — `paths.yaml`, `recents.yaml`. */
export function hostConfigDir(): string {
  return auDeviceDir('au-host', 'config')
}

/** The host's data dir: `~/.arsumbris/au-host/data` — persisted, non-substrate per-machine state that is
 *  NOT config (the restorable view-state auto-store lives here, keyed by composition + pool id). */
export function hostDataDir(): string {
  return auDeviceDir('au-host', 'data')
}

/**
 * The ENGINE's device config dir: `~/.arsumbris/au-engine/config`. The host writes the engine's
 * device registry (`repos.yaml`) here before any daemon is up, so it must resolve exactly where the
 * daemon reads it — deriving through the same SDK primitive makes a mismatch structurally impossible.
 */
export function engineConfigDir(): string {
  return auDeviceDir('au-engine', 'config')
}
