// Select the test composition explicitly, independent of other discovered content.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { VAULT } from './paths'

function recentsFile(): string {
  return join(homedir(), '.arsumbris', 'au-host', 'config', 'recents.yaml')
}

interface RecentComposition {
  path: string
  lastOpened: number
}
interface RecentWorkspace {
  root: string
  lastOpened: number
  compositions?: RecentComposition[]
}

/** Seed the launcher recents so the app auto-mounts `<vault>/compositions/<name>.yaml` at boot. */
export function seedComposition(name: string, vault = VAULT): void {
  const compositionPath = resolve(vault, 'compositions', `${name}.yaml`)
  const now = Date.now()
  let workspaces: RecentWorkspace[] = []
  try {
    const doc = parseYaml(readFileSync(recentsFile(), 'utf8')) as { workspaces?: RecentWorkspace[] }
    if (Array.isArray(doc?.workspaces)) workspaces = doc.workspaces
  } catch {
    /* missing / corrupt → first-run */
  }
  const others = workspaces.filter((w) => resolve(w.root) !== resolve(vault))
  const entry: RecentWorkspace = { root: vault, lastOpened: now, compositions: [{ path: compositionPath, lastOpened: now }] }
  const next = [entry, ...others]
  mkdirSync(dirname(recentsFile()), { recursive: true })
  writeFileSync(recentsFile(), '# au-host launcher recents (local; safe to delete).\n' + stringifyYaml({ workspaces: next }))
}
