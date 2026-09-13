// Loads a discovered projection: resolve its base URL, dynamic-import the entry,
// verify the module shape.
//
// discovery already resolved the `entry` from the projection type's meta
// and ran the contract handshake (`checkProjectionMeta`). There is no manifest.json
// to fetch — the loader just serves the code and imports the entry.
//
// Failures throw Errors whose messages are written for the host UI.

import type { LoadedModule, ProjectionSource } from '@arsumbris/au-host-sdk'

/** A projection to load: where its code lives, and the entry to import. */
export interface ProjectionRegistration {
  /** Local registration key. Doubles as the au-projection:// hostname, so lowercase. */
  key: string
  source: ProjectionSource
  /** ESM entry relative to the source, from the projection type's meta. */
  entry: string
  /** The named module export to mount (the locator's `export`), default `mount`.
   *  Lets several kind-typed surfaces share one entry — the host mounts `module[export]`. */
  export?: string
}

/** The location string identifying a source: its dev-server URL or its ESM path. */
export function sourceLocation(source: ProjectionSource): string {
  return source.mode === 'dev-server' ? source.url : source.path
}

/** Stable, hostname-safe key for a source location. */
export function sourceKey(location: string): string {
  let hash = 5381
  for (let i = 0; i < location.length; i++) {
    hash = ((hash << 5) + hash + location.charCodeAt(i)) >>> 0
  }
  return `p-${hash.toString(36)}`
}

export interface LoadedProjection {
  module: LoadedModule
  baseUrl: string
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function loadProjection(registration: ProjectionRegistration, fromDisk = false): Promise<LoadedProjection> {
  const { source, entry } = registration
  let baseUrl: string
  if (source.mode === 'dev-server') {
    baseUrl = source.url.replace(/\/+$/, '')
  } else {
    baseUrl = await window.main.projections.resolveSource(registration.key, source.path, entry, fromDisk)
  }

  const entryUrl = new URL(entry, `${baseUrl}/`).toString()
  let module: unknown
  try {
    module = await import(/* @vite-ignore */ entryUrl)
  } catch (err) {
    throw new Error(`could not import entry ${entryUrl}: ${message(err)}`)
  }

  if (!module || typeof module !== 'object') {
    throw new Error(`entry did not resolve to a module (${entryUrl})`)
  }
  // A projection module exposes NAMED mount exports. The specific export to mount
  // (the locator's `export`, default `mount`) is per-TYPE and known at mount time,
  // so the loader validates only that a module resolved; `mountModule` checks that
  // `module[export]` is a function, with a clear error listing the available exports.
  return { module: module as LoadedModule, baseUrl }
}
