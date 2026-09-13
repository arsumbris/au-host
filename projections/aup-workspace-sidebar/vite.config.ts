import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

export default defineConfig({
  plugins: [
    react(),
    // Drop the redundant CSS sidecar emitted by the library build. Component CSS is
    // provided through the shared runtime styling contract.
    {
      name: 'drop-orphan-css',
      // `post` so we run AFTER Vite's `vite:css-post` has emitted the extracted stylesheet asset
      // into the bundle; deleting it here (still before Rollup writes to disk) keeps it off disk.
      enforce: 'post',
      generateBundle(_options, bundle) {
        for (const file of Object.keys(bundle)) {
          if (bundle[file].type === 'asset' && file.endsWith('.css')) delete bundle[file]
        }
      },
    },
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: {
    port: 5201,
    strictPort: true,
    cors: true,
  },
  build: {
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    // Externalize the host's shared deps (React + the SDKs) so this dist emits bare imports that resolve
    // at runtime to the one served au-shared:// instance, via the host's injected import map — never a
    // bundled second React/SDK. Uses the shared contract from @arsumbris/au-host-sdk/shared-deps.
    rollupOptions: {
      external: sharedDepExternal,
    },
  },
})
