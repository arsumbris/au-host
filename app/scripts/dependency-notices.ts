import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

interface PackageMeta {
  name: string
  version: string
  license?: unknown
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}
interface PackageRecord { root: string; meta: PackageMeta; firstParty: boolean }
export interface NoticeAsset { fileName: string; source: Buffer }
const NOTICE = /^(?:licen[cs]es?|copying|notices?|copyright|ofl)(?:$|[._-])/i

function resolvePackage(name: string, from: string): string | undefined {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(directory) === directory) return undefined
  }
}

function noticeFiles(root: string, directory = root): string[] {
  const files: string[] = []
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name === '.git' || item.isSymbolicLink()) continue
    const path = join(directory, item.name)
    if (item.isDirectory()) files.push(...noticeFiles(root, path))
    else if (item.isFile() && NOTICE.test(item.name)) files.push(relative(root, path))
  }
  return files.sort()
}

/** Conservative runtime dependency inventory, including installed optional packages and Electron. */
export function collectDependencyNotices(hostRoot: string): NoticeAsset[] {
  const roots = [join(hostRoot, 'app')]
  for (const group of ['packages', 'projections']) {
    for (const name of readdirSync(join(hostRoot, group))) {
      const root = join(hostRoot, group, name)
      if (existsSync(join(root, 'package.json'))) roots.push(root)
    }
  }
  const firstPartyRoots = new Set(roots.map(root => realpathSync(root)))
  const electron = resolvePackage('electron', roots[0])
  if (!electron) throw new Error('Dependency notices: Electron is not installed')
  const queue = [...firstPartyRoots, electron]
  const records = new Map<string, PackageRecord>()
  while (queue.length) {
    const root = queue.pop()!
    if (records.has(root)) continue
    const meta = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageMeta
    records.set(root, { root, meta, firstParty: firstPartyRoots.has(root) || meta.name.startsWith('@arsumbris/') })
    for (const name of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies })) {
      const dependency = resolvePackage(name, root)
      if (dependency) queue.push(dependency)
      else if (!(name in (meta.optionalDependencies ?? {}))) {
        throw new Error(`Dependency notices: missing ${name}, required by ${meta.name}`)
      }
    }
  }
  const assets: NoticeAsset[] = []
  const manifest: Array<{ name: string; version: string; license: unknown; notices: Array<{ file: string; sha256: string }> }> = []
  const seen = new Set<string>()
  for (const { root, meta, firstParty } of [...records.values()].sort((a, b) => `${a.meta.name}@${a.meta.version}`.localeCompare(`${b.meta.name}@${b.meta.version}`))) {
    if (firstParty) continue
    const key = `${meta.name}@${meta.version}`
    if (seen.has(key)) continue
    seen.add(key)
    const entries = noticeFiles(root).map(file => ({ file, source: readFileSync(join(root, file)) }))
    // Platform packages share the parent canvas package's upstream license.
    if (!entries.length && meta.name.startsWith('@napi-rs/canvas-') && meta.version === '1.0.8') {
      const parent = [...records.values()].find(record => record.meta.name === '@napi-rs/canvas' && record.meta.version === meta.version)
      if (!parent) throw new Error(`Dependency notices: no matching parent license for ${key}`)
      entries.push({ file: 'LICENSE', source: readFileSync(join(parent.root, 'LICENSE')) })
    }
    if (!entries.length && meta.name === '@lit-labs/ssr-dom-shim' && meta.version === '1.6.0') {
      for (const file of ['LICENSE']) entries.push({ file, source: readFileSync(join(hostRoot, 'app/third-party/ssr-dom-shim', file)) })
      const header = readFileSync(join(root, 'index.js'), 'utf8').match(/^\/\*\*[\s\S]*?\*\//)?.[0]
      if (!header?.includes('SPDX-License-Identifier: BSD-3-Clause')) throw new Error('SSR DOM shim license header changed')
      entries.push({ file: 'COPYRIGHT-source-header.txt', source: Buffer.from(header + '\n') })
    }
    if (!entries.length) throw new Error(`Dependency notices: no license/notice files found for ${key}`)
    if (meta.name === 'electron' && !entries.some(entry => entry.file === 'dist/LICENSES.chromium.html')) {
      throw new Error('Dependency notices: Electron Chromium notices missing')
    }
    const folder = encodeURIComponent(key)
    manifest.push({ name: meta.name, version: meta.version, license: meta.license ?? null, notices: entries.map(({ file, source }) => {
      const fileName = `third-party/dependencies/${folder}/${file.split('\\').join('/')}`
      assets.push({ fileName, source })
      return { file: fileName, sha256: createHash('sha256').update(source).digest('hex') }
    }) })
  }
  assets.push({ fileName: 'third-party/dependency-manifest.json', source: Buffer.from(JSON.stringify({ scope: 'Installed runtime dependencies of Host packages and projections, plus Electron. Includes installed optional dependencies.', packages: manifest }, null, 2) + '\n') })
  return assets
}

export function writeDependencyNotices(hostRoot: string, output: string): void {
  for (const asset of collectDependencyNotices(hostRoot)) {
    const path = resolve(output, asset.fileName)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, asset.source)
  }
}
