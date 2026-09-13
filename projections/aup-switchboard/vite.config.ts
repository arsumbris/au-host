import { defineConfig } from 'vite'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

// A VANILLA pane-projection (no framework) — the intent switchboard, a visual patch-bay over the
// composition's intent wires. Deliberately framework-free: the node-graph is direct DOM + inline SVG
// cables, so it also demonstrates the mount contract needs no React. Self-contained ESM to dist/.
export default defineConfig({
  plugins: [],
  server: { port: 5201, strictPort: true, cors: true },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    // Externalize the host's shared deps (React + the SDKs) so this dist emits bare imports that resolve
    // at runtime to the one served au-shared:// instance, via the host's injected import map.
    rollupOptions: { external: sharedDepExternal },
  },
})
