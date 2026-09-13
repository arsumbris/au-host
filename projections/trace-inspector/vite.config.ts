import { defineConfig } from 'vite'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

export default defineConfig({
  plugins: [],
  server: {
    port: 5183,
    strictPort: true,
    cors: true,
  },
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
