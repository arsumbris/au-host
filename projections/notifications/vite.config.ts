import { defineConfig } from 'vite'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

// Two surfaces, one module (like the editor): the built ESM exports `mount` (the toast
// overlay) + `status` (the status-bar indicator); the two type-defs' locators select
// which export mounts. See notification-toast.type.yaml / notification-status.type.yaml.

export default defineConfig({
  plugins: [],
  server: {
    port: 5181,
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
