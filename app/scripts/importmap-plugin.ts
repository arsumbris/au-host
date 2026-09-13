// A vite plugin that injects the shared-dep import map into every renderer HTML entry (index.html +
// detached.html), so a bundle's bare `import 'react'` resolves to the ONE served au-shared:// instance.
//
// It MUST sit before any module script (Chromium rejects an import map once a module script has been
// seen). `injectTo: 'head-prepend'` + `order: 'post'` wins the absolute top of <head> above vite's own
// head-injected scripts — verified in dev (react-refresh preamble + @vite/client) AND a prod build
// (hashed entry + modulepreload), for both HTML entries.

import type { Plugin } from 'vite'

import { sharedDepImports } from './shared-deps-manifest.ts'

/**
 * @param version threads into the au-shared:// URLs as a cache-safety segment so a version bump moves
 *   the URL past a stale cache. DORMANT today (the version is a constant `0.0.0`); the mechanism is wired, the
 *   guarantee holds only once the app carries a real, bumped version. Static per build → the map is CSP-hashable.
 */
export function importmapPlugin(version: string): Plugin {
  const json = JSON.stringify({ imports: sharedDepImports(version) })
  return {
    name: 'au-shared-importmap',
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [{ tag: 'script', attrs: { type: 'importmap' }, children: json, injectTo: 'head-prepend' }]
      },
    },
  }
}
