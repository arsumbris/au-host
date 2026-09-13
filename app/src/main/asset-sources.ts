// Serves engine FILE ASSETS (images, PDFs, binaries) to the renderer as loadable URLs.
//
// A projection with a `file*` reference to a binary asset (a material's PNG texture,
// an embedded image) cannot get the bytes through `files.read` (text-only) or the
// engine `content` read (UTF-8-gated). The host resolves the reference to an absolute
// path over its main-process engine connection, then serves the bytes here so a
// browser `<img>` / `TextureLoader` can load `au-asset://<token>`.
//
// The token is the whole address: `assets:url` mints one per resolved path and only
// tokens minted here serve anything, so a fabricated token reaches nothing. The served
// au-asset serves only that exact path. HTML artifacts additionally serve relative resources
// under the entry's real directory, with traversal and symlink containment checked per request.

import * as fs from 'node:fs/promises'

import { protocol } from 'electron'
import { artifactPath, serveAssetFile } from './asset-response'

const SCHEME = 'au-asset'

// token (the URL hostname) -> realpath on disk. The token is LETTER-PREFIXED (`a0`, `a1`, ...) on
// purpose: `au-asset` is a STANDARD scheme, so Chromium canonicalizes its host, and an all-numeric
// host is parsed as an IPv4 address (`"12"` -> `"0.0.0.12"`), which would miss every lookup. A host
// with a leading letter is not IP-shaped and is already lowercase, so it round-trips unchanged.
const assets = new Map<string, string>()
// realpath -> token, so a repeated resolve of the same asset reuses its URL (browser cache).
const tokens = new Map<string, string>()
let seq = 0

/** Collected with every host scheme in one pre-ready registration call. */
export const assetScheme = {
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

export const artifactScheme = {
  scheme: 'au-artifact',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

/**
 * Register an absolute asset path for serving and return its token, or null when the
 * path is not a readable file. Realpath-resolved (symlink-safe) and idempotent per
 * path within the session. Caller passes a path the engine already resolved, so this
 * only hardens; it is never given a user-typed fragment.
 */
export async function registerAsset(absPath: string): Promise<string | null> {
  let real: string
  try {
    real = await fs.realpath(absPath)
    const stat = await fs.stat(real)
    if (!stat.isFile()) return null
  } catch {
    return null
  }
  const existing = tokens.get(real)
  if (existing) return existing
  const token = `a${seq++}` // leading letter: a numeric host is IPv4-canonicalized on a standard scheme.
  assets.set(token, real)
  tokens.set(real, token)
  return token
}

/** Must run after app ready. */
export function installAssetProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const real = assets.get(url.hostname)
    if (!real) return new Response('unknown asset', { status: 404 })
    return serveAssetFile(real, request)
  })
  protocol.handle(artifactScheme.scheme, async (request) => {
    const url = new URL(request.url)
    const entry = assets.get(url.hostname)
    if (!entry || !/\.html?$/i.test(entry)) return new Response('Not found', { status: 404 })
    const target = await artifactPath(entry, url.pathname)
    if (!target) return new Response('Not found', { status: 404 })
    const response = await serveAssetFile(target, request)
    // Retain the artifact serving policy for sandboxed documents and their local resources.
    response.headers.set('cache-control', 'no-cache')
    response.headers.set('access-control-allow-origin', '*')
    response.headers.set('x-content-type-options', 'nosniff')
    return response
  })
}
