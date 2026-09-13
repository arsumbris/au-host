// Per-machine tool locations, read from `~/.arsumbris/au-host/config/paths.yaml`.
//
// Where the arsumbris CLI tools live on THIS machine — the tool-location analog
// of the engine's per-machine member-location files. Node and agent executables default to
// PATH; the au-mcp CLI and its CC adapter have no clean PATH form (the adapter is
// a directory, the CLI is a TS entry run under node --experimental-strip-types),
// so they are configured here.
//
// A missing file is normal — executables fall back to PATH and the mcp paths come
// back undefined, which the UI surfaces as "set these in paths.yaml".
//
// Main-process only (reads the filesystem). The `au` engine-binary lives here too
// (an optional `au:` override), resolved PATH-first by `resolveDaemonBinary` — so a
// fresh install works with `au` on PATH, or by seeding `au:` from an install script.

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { hostConfigDir } from './device-paths'
import type { ToolPaths, ToolPathsInfo, ToolPathsPatch } from '../shared/daemon-api'

/** The raw `paths.yaml` shape (kebab-case keys, all optional). */
interface RawPathsFile {
  au?: unknown
  'au-mcp'?: unknown
  binaries?: unknown
  node?: unknown
  'node-args'?: unknown
}

const DEFAULT_NODE = 'node'
// The family runs its TS-source tools under node type-stripping (Node 22.6+; native
// on 23.6+, where this flag is accepted but unnecessary). Override with `node-args: []`
// on a node that strips by default and rejects the flag.
const DEFAULT_NODE_ARGS = ['--experimental-strip-types']

/** The paths file: `~/.arsumbris/au-host/config/paths.yaml`. */
export function pathsFile(): string {
  return path.join(hostConfigDir(), 'paths.yaml')
}

/** Home-relative dev-default guess for the au-mcp CLI path (a sibling of au-host). Adapter dirs are
 *  DISCOVERED (from the `mcp.adapter` type graph), so no adapter guess belongs here. */
function suggestedPaths(): { auMcp: string } {
  const arsumbris = path.join(os.homedir(), 'arsumbris')
  return {
    auMcp: path.join(arsumbris, 'au-mcp', 'src', 'cli.ts'),
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string')
  return out.length === v.length ? out : undefined
}

/** A `{ name: path }` map of non-empty string entries; anything else drops to {}. */
function asStringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const s = asString(val)
    if (s) out[k] = s
  }
  return out
}

/**
 * Load and resolve the tool paths. Never throws: a missing or malformed file
 * degrades to defaults (with `problem` set so the UI can surface it), so a
 * broken config can never block host startup.
 */
export function loadToolPaths(): ToolPathsInfo {
  const file = pathsFile()
  const defaults: ToolPaths = {
    node: DEFAULT_NODE,
    nodeArgs: DEFAULT_NODE_ARGS,
    binaries: {},
  }

  const suggested = suggestedPaths()

  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    // No file is the normal first-run state, not an error.
    return { paths: defaults, file, suggested }
  }

  let raw: RawPathsFile
  try {
    const parsed = parseYaml(text)
    if (parsed && typeof parsed === 'object') raw = parsed as RawPathsFile
    else return { paths: defaults, file, suggested, problem: 'paths.yaml is not a mapping' }
  } catch (err) {
    return { paths: defaults, file, suggested, problem: `paths.yaml is not valid YAML: ${err instanceof Error ? err.message : String(err)}` }
  }

  return {
    file,
    suggested,
    paths: {
      au: asString(raw.au),
      auMcp: asString(raw['au-mcp']),
      binaries: asStringMap(raw.binaries),
      node: asString(raw.node) ?? DEFAULT_NODE,
      nodeArgs: asStringArray(raw['node-args']) ?? DEFAULT_NODE_ARGS,
    },
  }
}

/** Whether `p` is an existing executable file. */
function fileIsExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the agent-executable NAME an adapter declares (`adapter-runtime-meta.agentBinary`, e.g.
 * `claude` / `codex`) to the value passed as the adapter's `--binary`. PATH-FIRST: if `name` is on
 * `PATH` (including GUI login-shell and standard install-directory fallbacks), return its absolute
 * executable path (adapters may persist it); otherwise fall back to the per-machine
 * `binaries[name]` override from paths.yaml; else `undefined` (not found — the caller surfaces it).
 */
export function resolveAgentBinary(name: string): string | undefined {
  const found = resolveOnPath(name)
  if (found) return found
  const override = loadToolPaths().paths.binaries[name]
  return override && override.trim().length > 0 ? override : undefined
}

/** Well-known install locations a GUI launch may miss on `process.env.PATH`: cargo, and the two
 *  Homebrew prefixes (Apple-silicon and Intel). Searched after PATH and the login-shell PATH. */
const WELL_KNOWN_BIN_DIRS = [
  path.join(os.homedir(), '.cargo', 'bin'),
  path.join(os.homedir(), '.local', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

// The login-shell PATH, computed once. `undefined` = not yet computed; `null` = computed-unavailable.
let cachedLoginPath: string[] | null | undefined

/**
 * The user's LOGIN-SHELL PATH, for macOS launches from Finder/Dock. There the process inherits
 * launchd's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), NOT the shell's, so an `au` in
 * `/opt/homebrew/bin` or `~/.cargo/bin` is invisible to a plain `process.env.PATH` scan. Spawns
 * `$SHELL -ilc 'echo $PATH'` ONCE (cached), with a short timeout; any failure degrades to none.
 * darwin-only — other platforms' GUI launches inherit a usable PATH.
 */
function loginShellPath(): string[] {
  if (cachedLoginPath !== undefined) return cachedLoginPath ?? []
  cachedLoginPath = null
  if (process.platform !== 'darwin') return []
  const shell = process.env.SHELL
  if (!shell) return []
  try {
    const out = spawnSync(shell, ['-ilc', 'command -v echo >/dev/null; printf %s "$PATH"'], {
      encoding: 'utf8',
      timeout: 2000,
    })
    if (out.status === 0 && typeof out.stdout === 'string' && out.stdout.trim().length > 0) {
      cachedLoginPath = out.stdout.trim().split(path.delimiter).filter(Boolean)
    }
  } catch {
    // A misconfigured or slow shell degrades to PATH + well-known dirs only.
  }
  return cachedLoginPath ?? []
}

/**
 * Find an executable NAMED `name`, PATH-first: `process.env.PATH`, then the macOS login-shell PATH
 * (Finder gap), then the well-known install dirs. A `name` that already contains a `/` is treated as
 * a path and checked directly. Returns an absolute executable path, or undefined.
 */
export function resolveOnPath(name: string): string | undefined {
  if (name.includes('/')) return fileIsExecutable(name) ? path.resolve(name) : undefined
  const search = (dirs: string[]): string | undefined =>
    dirs.map(dir => path.resolve(dir, name)).find(fileIsExecutable)
  // LAZY, left to right: the login-shell probe (a `$SHELL` spawn) runs only when `process.env.PATH`
  // misses — the common case (au on PATH) never pays for it.
  const envPath = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  return search(envPath) ?? search(loginShellPath()) ?? search(WELL_KNOWN_BIN_DIRS)
}

/**
 * Resolve the `au` engine daemon binary. An explicit `paths.yaml` `au:` override wins (the
 * file-based, install-seedable source) — returned verbatim so a broken override surfaces a precise
 * error at the spawn rather than being silently ignored. Otherwise discover `au` on PATH (incl. the
 * macOS login-shell PATH + well-known dirs). Returns undefined when nothing is found; the caller
 * surfaces the picker. Main-resolved, so the value is trusted (unlike a renderer-supplied path).
 */
export function resolveDaemonBinary(): string | undefined {
  const override = loadToolPaths().paths.au
  if (override && override.trim().length > 0) return override.trim()
  return resolveOnPath('au')
}

/**
 * Merge a patch into paths.yaml and write it. Reads the current file (preserving
 * unknown keys), applies the patch (an empty string CLEARS a key, back to its
 * default), and writes. Comments are not preserved through a UI save; the raw
 * file (with template comments) is the alternative editing surface.
 */
export function saveToolPaths(patch: ToolPathsPatch): void {
  const file = pathsFile()
  let current: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') current = parsed as Record<string, unknown>
  } catch {
    // No file, or unreadable — start fresh.
  }

  const set = (key: string, val: string | string[] | undefined): void => {
    if (val === undefined) return
    if (typeof val === 'string' && val.trim() === '') delete current[key]
    else current[key] = val
  }
  set('au', patch.au)
  set('au-mcp', patch.auMcp)
  set('node', patch.node)
  set('node-args', patch.nodeArgs)
  // `binaries` is sent WHOLESALE by the settings UI: keep only the non-empty overrides (an empty
  // entry clears that binary's override → back to PATH-first), and drop the key entirely if none remain.
  if (patch.binaries !== undefined) {
    const kept = Object.fromEntries(
      Object.entries(patch.binaries).filter(([, v]) => typeof v === 'string' && v.trim().length > 0),
    )
    if (Object.keys(kept).length > 0) current.binaries = kept
    else delete current.binaries
  }

  fs.mkdirSync(hostConfigDir(), { recursive: true })
  fs.writeFileSync(file, '# Per-machine arsumbris tool locations, read by au-host.\n' + stringifyYaml(current))
}

/** Create the paths file from the template if it does not exist yet; returns its path. */
export function ensurePathsFile(): string {
  const file = pathsFile()
  try {
    fs.accessSync(file)
  } catch {
    fs.mkdirSync(hostConfigDir(), { recursive: true })
    fs.writeFileSync(file, pathsTemplate())
  }
  return file
}

/** A commented template written on demand, so the user (or an agent) can fill it in. */
export function pathsTemplate(): string {
  const s = suggestedPaths()
  return `# Per-machine arsumbris tool locations, read by au-host.
# node defaults to PATH; set it only to override.
#
# au:       the au engine daemon binary. Resolved from PATH by default; set only to override
#           (an install script may seed it, e.g.  au: /usr/local/bin/au)
# au-mcp:   the au-mcp CLI entry (a .ts file, run under node)
# binaries: per-machine agent-binary overrides, keyed by name, ONLY when not on PATH
#           e.g.  binaries: { claude: /opt/claude/bin/claude }
# (adapters are DISCOVERED — their folders come from the mcp.adapter type graph, not this file)
au-mcp: ${s.auMcp}
# node: node
# node-args: ['--experimental-strip-types']   # clear to [] on a node that strips by default
# binaries: {}
`
}
