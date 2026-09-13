import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

// A REACT pane-projection rendering the workspace file tree over `<au-*>` custom elements, fed live
// engine data. It externalizes the host's shared deps (React + the SDKs) so the dist emits bare imports
// that resolve at runtime to the one served au-shared:// instance via the host's injected import map.
export default defineConfig({
  plugins: [
    react(),
    // Drop the orphan CSS sidecar a Vite lib build re-emits (the host loader has no CSS handling; the
    // <au-*> components self-style in shadow and this projection's own CSS ships via host.styles.inject).
    {
      name: 'drop-orphan-css',
      enforce: 'post',
      generateBundle(_options, bundle) {
        for (const file of Object.keys(bundle)) {
          if (bundle[file].type === 'asset' && file.endsWith('.css')) delete bundle[file]
        }
      },
    },
  ],
  // Lib builds don't replace process.env.NODE_ENV, so bundled React would hit an undefined `process`.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: { port: 5181, strictPort: true, cors: true },
  build: {
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: { external: sharedDepExternal, output: { inlineDynamicImports: true } },
  },
  resolve: { dedupe: ['react', 'react-dom'] },
})
