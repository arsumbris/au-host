// Serves the host's shared-dep bundle to the renderer over the privileged `au-shared://` scheme, a
// sibling to `au-projection://`. Every renderer bundle (projections + the shell) externals the shared
// deps and resolves them through a generated import map to ONE served instance per dep, so the whole app
// shares one React and one SDK.
//
// URL grammar: `au-shared://<owner>/v<version>/<name>.js`.
//   - `<owner>` routes by tenant; `dep` is the reserved first-party owner (the host's own build). A
//     third-party shared-dep provider gets its own owner segment (the extensibility seam).
//   - `v<version>` is a CACHE-SAFETY segment: baked into the URL so a version bump moves the URL and an
//     app update cannot serve a stale cached instance. It is stripped before the on-disk lookup (files are
//     stable-named). DORMANT today: the version is a constant `0.0.0`, so the segment never changes yet —
//     the mechanism is in place, the guarantee is real only once the app carries a real, bumped version.

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { protocol } from 'electron'

const SCHEME = 'au-shared'

// The reserved first-party owner. Its files are the host's built shared-dep bundle (app/shared-deps/dist).
export const FIRST_PARTY_OWNER = 'dep'

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.map': 'application/json',
}

let firstPartyDir = ''

/** Collected with every host scheme in one pre-ready registration call. */
export const sharedScheme = {
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

/** Must run after app ready. `distDir` is the host's built shared-dep bundle. */
export function installSharedProtocol(distDir: string): void {
  firstPartyDir = distDir
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    // Chromium lowercases the hostname; the owner segment is ASCII-lower by construction.
    if (url.hostname !== FIRST_PARTY_OWNER) {
      return new Response(`unknown shared-dep owner '${url.hostname}'`, { status: 404 })
    }

    // Strip the leading `v<version>/` cache-safety segment; files are stable-named on disk.
    const rel = decodeURIComponent(url.pathname).replace(/^\//, '').replace(/^v[^/]+\//, '')
    const requested = path.normalize(path.join(firstPartyDir, rel))
    if (requested !== firstPartyDir && !requested.startsWith(firstPartyDir + path.sep)) {
      return new Response('path escapes the shared-dep directory', { status: 403 })
    }

    try {
      const data = await fs.readFile(requested)
      const mime = MIME[path.extname(requested).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(data), { headers: { 'content-type': mime } })
    } catch {
      return new Response(`not found: ${rel}`, { status: 404 })
    }
  })
}
