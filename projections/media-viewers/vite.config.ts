import { defineConfig } from 'vite'
import { sharedDepExternal } from '@arsumbris/au-host-sdk/shared-deps'
export default defineConfig({ build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' }, rollupOptions: { external: sharedDepExternal } } })
