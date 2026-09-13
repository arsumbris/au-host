import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { collectDependencyNotices } from '../scripts/dependency-notices'

const fixtures: string[] = []
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }) })
function put(root: string, file: string, value: string) { const p = join(root, file); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, value) }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'au-notices-')); fixtures.push(root)
  mkdirSync(join(root, 'packages')); mkdirSync(join(root, 'projections'))
  put(root, 'app/package.json', JSON.stringify({ name: 'app', version: '1', dependencies: { example: '1' } }))
  put(root, 'app/node_modules/electron/package.json', JSON.stringify({ name: 'electron', version: '1' }))
  put(root, 'app/node_modules/electron/LICENSE', 'Electron notice')
  put(root, 'app/node_modules/electron/dist/LICENSES.chromium.html', '<html>Chromium notice</html>')
  put(root, 'app/node_modules/example/package.json', JSON.stringify({ name: 'example', version: '1', license: 'MIT' }))
  return root
}

describe('dependency notices', () => {
  it('fails rather than substituting a license label for missing license text', () => {
    expect(() => collectDependencyNotices(fixture())).toThrow('no license/notice files found for example@1')
  })
  it('preserves nested notices byte-for-byte and records hashes without local paths', () => {
    const root = fixture()
    const original = 'Copyright example\r\nPermission text\r\n'
    put(root, 'app/node_modules/example/LICENSE', original)
    put(root, 'app/node_modules/example/codecs/NOTICE', 'Nested codec notice')
    const assets = collectDependencyNotices(root)
    const licence = assets.find(asset => asset.fileName.endsWith('/example%401/LICENSE'))!
    expect(licence.source).toEqual(Buffer.from(original))
    expect(assets.some(asset => asset.fileName.endsWith('/codecs/NOTICE'))).toBe(true)
    const manifest = assets.find(asset => asset.fileName.endsWith('dependency-manifest.json'))!.source.toString()
    expect(manifest).not.toContain(root)
    expect(manifest).toContain(createHash('sha256').update(original).digest('hex'))
  })
  it('requires Electron Chromium notices', () => {
    const root = fixture(); put(root, 'app/node_modules/example/LICENSE', 'Example notice')
    rmSync(join(root, 'app/node_modules/electron/dist/LICENSES.chromium.html'))
    expect(() => collectDependencyNotices(root)).toThrow('Electron Chromium notices missing')
  })
  it('covers actual runtime packages and PDF nested licenses', () => {
    const root = resolve(import.meta.dirname, '../..')
    const assets = collectDependencyNotices(root)
    const manifest = JSON.parse(assets.find(asset => asset.fileName.endsWith('dependency-manifest.json'))!.source.toString())
    for (const name of ['react', 'three', 'zustand', '@codemirror/view', '@lezer/lr', 'react-markdown', 'remark-gfm', 'lit', 'd3-force', '@xterm/xterm', 'pdfjs-dist', 'electron']) {
      expect(manifest.packages.some((p: {name: string}) => p.name === name), name).toBe(true)
    }
    for (const suffix of ['/cmaps/LICENSE', '/wasm/LICENSE_OPENJPEG', '/standard_fonts/LICENSE_LIBERATION', '/dist/LICENSES.chromium.html']) expect(assets.some(asset => asset.fileName.endsWith(suffix)), suffix).toBe(true)
    const react = manifest.packages.find((p: {name: string}) => p.name === 'react')
    const asset = assets.find(asset => asset.fileName === react.notices.find((n: {file: string}) => n.file.endsWith('/LICENSE')).file)!
    expect(asset.source).toEqual(readFileSync(join(root, 'app/node_modules/react/LICENSE')))
  })
})
