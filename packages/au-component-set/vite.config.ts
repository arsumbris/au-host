import { defineConfig } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

// `register(api)` is the named export the host calls; the set never self-registers.
export default defineConfig({
  plugins: [{
    name: 'au-vendored-notices',
    generateBundle() {
      const directory = new URL('./third-party/', import.meta.url)
      for (const name of readdirSync(directory)) {
        this.emitFile({ type: 'asset', fileName: `third-party/${name}`, source: readFileSync(fileURLToPath(new URL(name, directory)), 'utf8') })
      }
    },
  }],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    // Externalize the host's shared deps — here `component-contract`, whose overlay channel this set's
    // ClaimOverlay mixin consumes, so it resolves to the ONE served instance (the overlay global's
    // collapse depends on it). Lit stays BUNDLED (not in the shared set), so the runtime entry the
    // projection loader imports still stands alone.
    rollupOptions: { external: sharedDepExternal },
  },
})
