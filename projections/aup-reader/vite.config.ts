import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

// A REACT pane-projection that consumes @arsumbris/design-kit (+ react-markdown / remark-gfm) — a
// markdown READER. It externalizes the host's shared deps so the dist emits bare imports that resolve
// at runtime to the one served au-shared:// instance via the host's injected import map, instead of
// bundling its own copy of them.
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
  // Lib builds don't replace process.env.NODE_ENV, so bundled React would hit an
  // undefined `process` at runtime.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: { port: 5199, strictPort: true, cors: true },
  build: {
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    // Externalize the host's shared deps (React + the SDKs) so this dist emits bare imports that resolve
    // at runtime to the one served au-shared:// instance, via the host's injected import map.
    // inlineDynamicImports keeps this projection's own remaining code in a single chunk.
    rollupOptions: { external: sharedDepExternal, output: { inlineDynamicImports: true } },
  },
  resolve: { dedupe: ['react', 'react-dom'] },
})
