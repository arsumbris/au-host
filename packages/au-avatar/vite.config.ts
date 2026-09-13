import { defineConfig } from 'vite'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

// Builds the PROJECTION entry to dist/index.js (what `type/aup-avatar.type.yaml` points at).
// The element + WebGL renderer are bundled in; only the host's shared deps (the SDK) are
// externalized to resolve to the one served au-shared:// instance at runtime.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/projection.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: { external: sharedDepExternal },
  },
})
