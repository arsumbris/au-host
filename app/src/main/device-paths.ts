// The host's device-tenant directories, derived from the engine's
// `~/.arsumbris/<owner>/<category>/` convention through the SDK primitive. `au-host` is the
// WRITING tenant, so it is the literal owner segment; the SDK owns the `.arsumbris` literal, the
// category vocabulary, and the raw-`$HOME` rule, so no path segment is re-encoded here.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { auDeviceDir, socketFileName } from '@arsumbris/au-engine-sdk'

/**
 * RELOCATION: when set, the WHOLE au-host device dir (its `config`, `data` and `run` categories) lives under
 * this directory instead of `~/.arsumbris/au-host`. The e2e harness points it at a throwaway dir per run,
 * so a test never reads or writes the user's real stores, recents or instance claims. The ENGINE tenant is
 * never relocated: its registry must stay where the daemon reads it.
 */
export const HOST_DEVICE_DIR_ENV = 'AU_HOST_DEVICE_DIR'

function hostDeviceDir(category: 'run' | 'config' | 'data'): string {
  const relocated = process.env[HOST_DEVICE_DIR_ENV]
  return relocated ? path.join(relocated, category) : auDeviceDir('au-host', category)
}

/** The host's run dir: `~/.arsumbris/au-host/run` — ephemeral runtime sockets (host + instance). */
export function hostRunDir(): string {
  return hostDeviceDir('run')
}

/** The host's config dir: `~/.arsumbris/au-host/config` — `paths.yaml`, `recents.yaml`. */
export function hostConfigDir(): string {
  return hostDeviceDir('config')
}

/** The host's data dir: `~/.arsumbris/au-host/data` — persisted, non-substrate per-machine state that is
 *  NOT config (the local stores: composition drafts, view-state). */
export function hostDataDir(): string {
  return hostDeviceDir('data')
}

/**
 * A workspace's identity as a file-name stem: the same canonicalize-then-hash the engine, agent-host and
 * instance sockets use (`socketFileName` of the realpath'd entry), without the suffix. One folder is one
 * identity, so two paths to the same folder share a stem.
 */
export function workspaceKey(entry: string): string {
  return socketFileName(fs.realpathSync(entry)).replace(/\.sock$/, '')
}

/** A local store's file for one workspace: `<data>/<store>/<workspaceKey>.json`. */
export function workspaceStoreFile(store: string, entry: string): string {
  return path.join(hostDataDir(), store, `${workspaceKey(entry)}.json`)
}

/**
 * The ENGINE's device config dir: `~/.arsumbris/au-engine/config`. The host writes the engine's
 * device registry (`repos.yaml`) here before any daemon is up, so it must resolve exactly where the
 * daemon reads it — deriving through the same SDK primitive makes a mismatch structurally impossible.
 */
export function engineConfigDir(): string {
  return auDeviceDir('au-engine', 'config')
}

