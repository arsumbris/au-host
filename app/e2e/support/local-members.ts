import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import { REPO_ROOT } from './paths'

/** Every `customTokenEntry` path the type-defs under `typeDir` declare, relative to the package root. */
function tokenEntries(typeDir: string): string[] {
  const out: string[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!value || typeof value !== 'object') return
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'customTokenEntry') out.push(...([] as unknown[]).concat(inner).filter((p): p is string => typeof p === 'string'))
      else walk(inner)
    }
  }
  if (!existsSync(typeDir)) return out
  for (const file of readdirSync(typeDir, { recursive: true, encoding: 'utf8' })) {
    if (/\.ya?ml$/.test(file)) walk(parse(readFileSync(join(typeDir, file), 'utf8')))
  }
  return out
}

/** Copy each package/projection of this checkout (its repo.yaml + type/ + dist/, plus the token sheets
 *  its type-defs declare) into `root` as a co-present sibling of the per-test vaults, so the vault's deps
 *  resolve to this checkout without touching the device registry. The e2e fixture members (`e2e/members/*`) are copied WHOLE: they exist
 *  to ship content a consumed repo carries (a keymap, say), which a type/dist copy would drop. */
export function installLocalMembers(root: string): void {
  const fixtures = join(REPO_ROOT, 'app', 'e2e', 'members')
  for (const entry of existsSync(fixtures) ? readdirSync(fixtures, { withFileTypes: true }) : []) {
    if (entry.isDirectory()) cpSync(join(fixtures, entry.name), join(root, entry.name), { recursive: true })
  }
  for (const group of ['packages', 'projections']) {
    for (const entry of readdirSync(join(REPO_ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const source = join(REPO_ROOT, group, entry.name)
      const manifest = join(source, '.arsumbris', 'repo.yaml')
      if (!existsSync(manifest)) continue
      const name = parse(readFileSync(manifest, 'utf8')).name
      if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) continue
      const target = join(root, name)
      mkdirSync(join(target, '.arsumbris'), { recursive: true })
      cpSync(manifest, join(target, '.arsumbris', 'repo.yaml'))
      for (const directory of ['type', 'dist']) {
        const from = join(source, directory)
        if (existsSync(from)) cpSync(from, join(target, directory), { recursive: true })
      }
      for (const rel of tokenEntries(join(source, 'type'))) {
        const from = join(source, rel)
        // A declared sheet that is not on disk would surface only as a missing theme at runtime: fail here.
        if (!existsSync(from)) throw new Error(`${source}: a type-def declares customTokenEntry '${rel}', but ${from} does not exist (build the package?)`)
        mkdirSync(dirname(join(target, rel)), { recursive: true })
        cpSync(from, join(target, rel))
      }
    }
  }
}
