// Serves registered built-ESM projection directories to the renderer.
//
// A renderer on an http(s) origin cannot dynamic-import file: URLs, so disk
// projections are served through the au-projection:// scheme instead:
// `au-projection://<registration-key>/<file>` maps into the registered
// directory. Dev-server projections never come through here.

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { protocol } from 'electron'

const SCHEME = 'au-projection'

// Registration keys arrive as URL hostnames, which Chromium lowercases.
const sources = new Map<string, string>()

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
}

/** Collected with every host scheme in one pre-ready registration call. */
export const projectionScheme = {
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

export async function registerSource(key: string, directory: string): Promise<void> {
  // Resolve to a REAL path (no symlinks) and require an existing directory, then store the
  // realpath so the protocol handler's containment check is symlink-safe.
  // NOTE: this hardens existence + symlink-escape. A TIGHT confinement of WHICH directories may
  // be registered is still open: the host's cross-repo members are scattered (no single root),
  // so bounding to entry/projections needs the member topology main lacks at registration time.
  let real: string
  try {
    real = await fs.realpath(directory)
  } catch {
    throw new Error(`projection source directory does not exist: ${directory}`)
  }
  const stat = await fs.stat(real)
  if (!stat.isDirectory()) throw new Error(`projection source is not a directory: ${directory}`)
  sources.set(key.toLowerCase(), real)
}

export function unregisterSource(key: string): void {
  sources.delete(key.toLowerCase())
}

/** Must run after app ready. */
export function installProjectionProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const directory = sources.get(url.hostname)
    if (!directory) {
      return new Response(`no projection source registered as '${url.hostname}'`, { status: 404 })
    }

    // `directory` is already a realpath (registerSource resolved it). Reject a lexical escape,
    // then realpath the resolved file too, so a symlink INSIDE the dir can't point outside it.
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '')
    const requested = path.normalize(path.join(directory, relative))
    if (requested !== directory && !requested.startsWith(directory + path.sep)) {
      return new Response('path escapes the registered directory', { status: 403 })
    }

    try {
      const real = await fs.realpath(requested)
      if (real !== directory && !real.startsWith(directory + path.sep)) {
        return new Response('path escapes the registered directory', { status: 403 })
      }
      const data = await fs.readFile(real)
      const mime = MIME[path.extname(real).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(data), { headers: { 'content-type': mime } })
    } catch {
      return new Response(`not found: ${relative}`, { status: 404 })
    }
  })
}
