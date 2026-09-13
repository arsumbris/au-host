import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { collectDependencyNotices } from './dependency-notices'

/** Preserve notices for the font and inline glyph assets bundled into the renderer. */
export function vendoredNoticesPlugin(hostRoot: string): Plugin {
  const sources = {
    'geist-OFL.txt': 'packages/style/assets/fonts/OFL.txt',
    'lucide-LICENSE': 'packages/au-host-launcher/third-party/lucide-LICENSE',
    'feather-LICENSE': 'packages/au-host-launcher/third-party/feather-LICENSE',
    'octicons-LICENSE': 'packages/au-component-set/third-party/octicons-LICENSE',
  }
  return {
    name: 'au-vendored-notices',
    generateBundle() {
      for (const [name, relative] of Object.entries(sources)) {
        const source = readFileSync(resolve(hostRoot, relative), 'utf8')
        this.emitFile({ type: 'asset', fileName: `third-party/${name}`, source })
      }
      for (const asset of collectDependencyNotices(hostRoot)) this.emitFile({ type: 'asset', ...asset })
    },
  }
}
