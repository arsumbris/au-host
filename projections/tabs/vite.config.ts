import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

export default defineConfig({
  plugins: [react()],
  // Lib builds don't replace process.env.NODE_ENV (unlike app builds), so the
  // bundled React/zustand would reference an undefined `process` at runtime.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: {
    port: 5199,
    strictPort: true,
    cors: true,
  },
  build: {
    // The container-kit drag-core singletons dedupe across projection bundles at runtime via a
    // window global.
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    // Externalize the host's shared deps (React + the SDKs) so this dist emits bare imports that resolve
    // at runtime to the one served au-shared:// instance, via the host's injected import map.
    rollupOptions: { external: sharedDepExternal },
  },
})
