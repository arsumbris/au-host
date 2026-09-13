import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'

export default defineConfig({
  plugins: [react()],
  // Lib builds don't replace process.env.NODE_ENV, so bundled React would reference an undefined
  // `process` at runtime. (Same note as the other React projections.)
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: {
    port: 5203,
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
    // at runtime to the one served au-shared:// instance, via the host's injected import map.
    rollupOptions: { external: sharedDepExternal },
  },
})
