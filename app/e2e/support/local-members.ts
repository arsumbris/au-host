import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import { REPO_ROOT, VAULT } from './paths'

/** Co-present package fixtures exercise this checkout without changing the device registry. */
export function localMembers(enabled: boolean): void {
  for (const group of ['packages', 'projections']) {
    for (const entry of readdirSync(join(REPO_ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const root = join(REPO_ROOT, group, entry.name)
      const manifest = join(root, '.arsumbris', 'repo.yaml')
      if (!existsSync(manifest)) continue
      const name = parse(readFileSync(manifest, 'utf8')).name
      if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) continue
      const target = join(dirname(VAULT), name)
      const marker = join(target, '.au-e2e-member')
      if (existsSync(target) && !existsSync(marker)) {
        if (enabled) throw new Error(`Test member location is already occupied: ${target}`)
        continue
      }
      if (!enabled) { if (existsSync(marker)) rmSync(target, { recursive: true }); continue }
      mkdirSync(join(target, '.arsumbris'), { recursive: true })
      writeFileSync(marker, root)
      cpSync(manifest, join(target, '.arsumbris', 'repo.yaml'))
      for (const directory of ['type', 'dist']) {
        const source = join(root, directory)
        if (existsSync(source)) cpSync(source, join(target, directory), { recursive: true })
      }
    }
  }
}
