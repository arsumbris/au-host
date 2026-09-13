// The production renderer CSP excludes unsafe-eval. Inline styles remain permitted for
// runtime styling, including terminal/editor styles and the static boot splash.
// Removing unsafe-inline requires checking all style producers and providing supported
// nonces, hashes or stylesheet handling. This policy does not enforce that stricter boundary.
//
// Delivered as a real response header via `onHeadersReceived`, so it governs the document AND covers the
// au-shared:// + au-projection:// scheme responses. Applies to both html entries (index + surface) and
// both dev (vite over http) and prod (file:/) — the session-wide hook sees every renderer response.

import { session } from 'electron'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'

export function installRendererCsp(opts: { dev: boolean; rendererDir: string }): void {
  const { dev, rendererDir } = opts

  // PROD: allow the generated (static) import map by the sha256 of its EXACT served bytes — read from the
  // built html so the hash can never drift from what is injected. A hash lets `script-src` drop
  // `unsafe-inline`. index.html and surface.html carry the SAME map, so one hash covers both.
  let importmapHash = ''
  if (!dev) {
    try {
      const html = readFileSync(path.join(rendererDir, 'index.html'), 'utf8')
      const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)
      if (m) importmapHash = ` 'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`
    } catch {
      // No built html (shouldn't happen in prod); fall through to a map-less script-src.
    }
  }

  // DEV must carry `'unsafe-inline'` (vite injects an inline react-refresh preamble) and must NOT carry the
  // importmap hash — a hash/nonce present in a directive makes the browser IGNORE `'unsafe-inline'`, which
  // would block the preamble (white screen). vite also needs `'unsafe-eval'` (HMR) and `ws:` (the HMR socket).
  // Trusted projection codecs may compile WebAssembly; JavaScript eval remains blocked in production.
  const scriptSrc = dev
    ? `script-src 'self' au-shared: au-projection: 'unsafe-inline' 'unsafe-eval'`
    : `script-src 'self' au-shared: au-projection: 'wasm-unsafe-eval'${importmapHash}`

  // The three first-party host schemes (all privileged, all host-served trusted content): au-shared:
  // (shared-dep code), au-projection: (projection code + bundled assets), au-asset: (engine-resolved image
  // / PDF bytes). Assets load as <img> (img-src) and, for WebGL textures, sometimes via fetch (connect-src);
  // they are never scripts, so au-asset: stays out of script-src.
  const csp = [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`, // remains for xterm's runtime <style> + the boot-splash + the gallery pages (see header)
    `connect-src 'self' au-shared: au-projection: au-asset:${dev ? ' ws:' : ''}`,
    `img-src 'self' au-asset: au-projection: data:`,
    `font-src 'self' au-projection: data:`,
    `media-src 'self' au-asset:`,
    `frame-src 'self' au-asset: au-artifact:`,
    `object-src au-asset:`,
    // NO worker-src: deliberate — nothing spawns a blob/Worker today; `default-src 'self'` backstops it.
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const contentType = Object.entries(details.responseHeaders ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.join(';') ?? ''
    // Chromium's built-in PDF viewer owns its internal resource policy.
    if ((details.url.startsWith('au-asset:') && contentType.includes('application/pdf')) || details.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/') || details.url.startsWith('chrome://')) {
      callback({ responseHeaders: details.responseHeaders }); return
    }
    const responseHeaders = { ...details.responseHeaders }
    // Drop any existing CSP header (whatever its case) so ours is authoritative.
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase() === 'content-security-policy') delete responseHeaders[key]
    }
    responseHeaders['Content-Security-Policy'] = [details.url.startsWith('au-artifact:')
      ? "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'none'"
      : csp]
    callback({ responseHeaders })
  })
}
