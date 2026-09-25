// Select the test composition explicitly, independent of other discovered content.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/**
 * A throwaway dir for a relocated au-host device dir, under a SHORT root. The host binds unix sockets in
 * `<dir>/run/`, and macOS caps a socket path at 104 bytes; `os.tmpdir()` there is a long `/var/folders/…`
 * path that overruns it, so `/tmp` is preferred where it exists.
 */
export function shortTempDir(prefix: string): string {
  return mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), prefix))
}

/** The recents file inside a RELOCATED au-host device dir (the app's `AU_HOST_DEVICE_DIR`), mirroring
 *  `hostConfigDir()`: `<hostDir>/config/recents.yaml`. The harness never touches the user's real one. */
function recentsFile(hostDir: string): string {
  return join(hostDir, 'config', 'recents.yaml')
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

/** Seed the launcher recents (in the run's relocated au-host dir) so the app auto-mounts
 *  `<vault>/compositions/<name>.yaml` at boot. */
export function seedComposition(name: string, hostDir: string, vault: string): void {
  const compositionPath = resolve(vault, 'compositions', `${name}.yaml`)
  const now = Date.now()
  let workspaces: RecentWorkspace[] = []
  try {
    const doc = parseYaml(readFileSync(recentsFile(hostDir), 'utf8')) as { workspaces?: RecentWorkspace[] }
    if (Array.isArray(doc?.workspaces)) workspaces = doc.workspaces
  } catch {
    /* missing / corrupt → first-run */
  }
  const others = workspaces.filter((w) => resolve(w.root) !== resolve(vault))
  const entry: RecentWorkspace = { root: vault, lastOpened: now, compositions: [{ path: compositionPath, lastOpened: now }] }
  const next = [entry, ...others]
  mkdirSync(dirname(recentsFile(hostDir)), { recursive: true })
  writeFileSync(recentsFile(hostDir), '# au-host launcher recents (local; safe to delete).\n' + stringifyYaml({ workspaces: next }))
}
