import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { vendoredNoticesPlugin } from '../scripts/vendored-notices'

describe('renderer vendored notices', () => {
  it('emits the complete source notices alongside the bundled assets', () => {
    const root = resolve(import.meta.dirname, '../..')
    const plugin = vendoredNoticesPlugin(root)
    const emitted: Array<{ fileName: string; source: string }> = []
    const hook = plugin.generateBundle
    if (typeof hook !== 'function') throw new Error('Expected a build hook')
    hook.call({ emitFile: (asset: { fileName: string; source: string }) => { emitted.push(asset); return asset.fileName } } as never, {} as never, {}, false)
    const assets = new Map(emitted.map(asset => [asset.fileName, asset.source]))
    expect(assets.size).toBeGreaterThan(6)
    expect(assets.has('third-party/dependency-manifest.json')).toBe(true)
    expect(assets.get('third-party/octicons-LICENSE')).toBe(readFileSync(resolve(root, 'packages/au-component-set/third-party/octicons-LICENSE'), 'utf8'))
    expect(assets.get('third-party/geist-OFL.txt')).toBe(readFileSync(resolve(root, 'packages/style/assets/fonts/OFL.txt'), 'utf8'))
    for (const name of ['lucide-LICENSE', 'feather-LICENSE']) {
      expect(assets.get(`third-party/${name}`)).toBe(readFileSync(resolve(root, 'packages/au-host-launcher/third-party', name), 'utf8'))
    }
  })

  it('fails the build if a required notice is absent', () => {
    const hook = vendoredNoticesPlugin('/nonexistent-au-notice-test').generateBundle
    if (typeof hook !== 'function') throw new Error('Expected a build hook')
    expect(() => hook.call({ emitFile() {} } as never, {} as never, {}, false)).toThrow()
  })
})
