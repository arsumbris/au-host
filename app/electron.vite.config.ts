import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

import { SHARED_DEP_SPECIFIERS } from '@arsumbris/au-host-sdk/shared-deps'

import { importmapPlugin } from './scripts/importmap-plugin.ts'
import { vendoredNoticesPlugin } from './scripts/vendored-notices.ts'

// The shared-dep cache-safety version threads into the au-shared:// URLs. `__dirname` is app/ here.
const appVersion = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version as string) || '0'

export default defineConfig({
  // The sdks are consumed as TS source (workspace packages), so they must be
  // bundled, not externalized — Node cannot load .ts at runtime.
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@arsumbris/au-engine-sdk', '@arsumbris/au-host-sdk'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@arsumbris/au-engine-sdk', '@arsumbris/au-host-sdk'] })],
  },
  renderer: {
    // `importmapPlugin` injects the shared-dep import map at the top of <head> (before any module) so
    // externalized bare imports resolve to the served au-shared:// instances.
    plugins: [react(), importmapPlugin(appVersion), vendoredNoticesPlugin(resolve(__dirname, '..'))],
    build: {
      // Two HTML entries: the main host window (surface-0) and the surface renderer (the
      // mount-agent boot the authority drives for every secondary window in the one-authority
      // cross-window model). Both share the preload + the projections machinery.
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          surface: resolve(__dirname, 'src/renderer/surface.html'),
        },
        // Externalize the shared deps from the SHELL too, so shell + projections
        // share ONE served instance in production and the window-globals can collapse. Exact
        // match on the served set (= the import map), so no unresolved specifier. BUILD-ONLY: `pnpm dev`
        // serves the shell live through vite, which rewrites its bare imports to vite's own React before
        // any import map acts — so the dev shell stays split from projections, bridged by the
        // window-globals; both `index.html` + `surface.html` are covered by this one build config.
        external: [...SHARED_DEP_SPECIFIERS],
      },
    },
  },
})
