import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectDependencyNotices } from './dependency-notices.ts'

const app = fileURLToPath(new URL('..', import.meta.url))
const root = resolve(app, '..')
const targets = process.argv.slice(2)
if (!targets.length) targets.push(resolve(app, 'out/renderer'), resolve(app, 'shared-deps/dist'))
const expected = collectDependencyNotices(root)
for (const target of targets) {
  for (const asset of expected) {
    const actual = readFileSync(resolve(target, asset.fileName))
    if (!actual.equals(asset.source)) throw new Error(`Dependency notice differs: ${asset.fileName}`)
  }
  console.log(`Verified ${expected.length} dependency notice assets in ${target}`)
}
