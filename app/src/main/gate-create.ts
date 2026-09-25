// Create an engine-valid SCHEMA-16 FOLDER-REPO workspace for a first-run user, gathering the host's
// dependency projections so the created workspace can actually run the host UI.
//
// Writes:
//   F/.arsumbris/repo.yaml — F's identity (au.engine.repo: `name`). Framework-FREE.
//   F/.arsumbris/workspace.yaml — the composition: `edit: [F]`, `discover: [bundles]`.
//   <dep>/.arsumbris/repo.yaml — each located dep's identity, if absent (idempotent).
//   ~/.arsumbris/au-engine/config/repos.yaml — DEVICE-GLOBAL location registry: F + each dep (merged).
//
// The FOLDER F is the daemon entry — there is no manifest file. Entry == root == home.
//
// Raw fs, daemon-free — the gate runs BEFORE any daemon is up (same as gate-inspect.ts). A created
// workspace registers each located member in the device repos.yaml, one of the tiers the engine
// resolves a member name through.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { AuMembersError, runAuMembers } from '@arsumbris/au-engine-sdk'

import { validateBinary } from './daemon'
import { engineConfigDir } from './device-paths'
import { readLocalFile } from './local-file-read'
import { resolveDaemonBinary } from './tool-paths'
import type { ClosureMember, ClosureResult, CreateWorkspaceResult, FoundDep, MissingMembers } from '../shared/daemon-api'

// The two hardwired ENTRY-POINT aggregator bundles a full host workspace needs. Their `deps` ARE the
// closure (host-bundle → the UI projection/vocab set; mcp-bundle → the agent/mcp set), so the member
// SET is discovered by reading their repo.yaml — NOT a hardcoded list here. A workspace that only runs the UI (no agent) would name host-bundle alone;
// the create flow names both. Adding a projection means editing
// the located host-bundle's repo.yaml; its dependency closure determines the member set.
const BUNDLES = ['host-bundle', 'mcp-bundle']

/** The `deps` member names declared in a located repo's `.arsumbris/repo.yaml` (raw, pre-daemon). */
export function readRepoDeps(repoPath: string): string[] {
  try {
    const doc = parseYaml(readFileSync(path.join(repoPath, '.arsumbris', 'repo.yaml'), 'utf8'))
    const deps = Array.isArray(doc?.deps) ? doc.deps : []
    return deps.map((d: { name?: string }) => d?.name).filter((n: unknown): n is string => typeof n === 'string')
  } catch {
    return []
  }
}

/**
 * Discover the full setup closure from the two entry-point bundles, given what the user has located so
 * far (`located`: name → absolute path). BFS: seed with BUNDLES; a member's `deps` become needed only
 * once that member is LOCATED (so its repo.yaml is readable). The nested checklist renders this — each
 * bundle expands its deps as sub-items, recursively — and drives which names the next scan looks for.
 * Pre-daemon + raw fs (the create flow runs before any daemon).
 */
export function discoverClosure(located: Record<string, string>): ClosureResult {
  const needed = new Set<string>(BUNDLES)
  const queue = [...BUNDLES]
  while (queue.length > 0) {
    const name = queue.shift() as string
    const at = located[name]
    if (!at) continue // not located yet → its deps are not yet discoverable
    for (const dep of readRepoDeps(at)) {
      if (!needed.has(dep)) {
        needed.add(dep)
        queue.push(dep)
      }
    }
  }
  const members: ClosureMember[] = [...needed].sort().map((name) => ({
    name,
    path: located[name] ?? null,
    deps: located[name] ? readRepoDeps(located[name]) : [],
  }))
  const missing = members.filter((m) => m.path === null).map((m) => m.name)
  return { roots: [...BUNDLES], members, missing, allLocated: missing.length === 0 }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', '.cache', 'out'])

/** A directory looks like a repo we can mount: it carries a package.json, a type/ dir, or .arsumbris/. */
function looksLikeRepo(dir: string): boolean {
  return (
    existsSync(path.join(dir, 'package.json')) ||
    existsSync(path.join(dir, 'type')) ||
    existsSync(path.join(dir, '.arsumbris'))
  )
}

/**
 * Scan `folder` (bounded depth) for repos whose DIRECTORY NAME matches one of `names` (plus a repo
 * sanity check). Returns every match (a name can match several dirs — a stale slice, a worktree —
 * so the caller disambiguates). Drives the create + open-time "locate missing members" flows.
 *
 * INVARIANT: a repo's FOLDER NAME must equal its `.arsumbris/repo.yaml` `name` (the identity the graph
 * references). This scan locates members by folder basename, so a mismatch makes a member unfindable in
 * the setup UI. Keep first-party folder names aligned with their repo identity.
 */
export function scanFor(folder: string, names: string[]): FoundDep[] {
  const dir = (folder ?? '').trim()
  const wanted = new Set(names)
  // ALL matches per name, not first-wins: a name can match several dirs (a stale slice, a worktree,
  // a vendored copy). The gate surfaces duplicates and makes the user pick, instead of silently
  // choosing one — a wrong pick (e.g. a stale bento defining `bento-layout`) breaks the workspace.
  const found = new Map<string, string[]>()

  const walk = (at: string, depth: number): void => {
    if (depth > 6) return // walk fully within the depth bound so duplicates are all seen
    let entries
    try {
      entries = readdirSync(at, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
      const child = path.join(at, e.name)
      if (wanted.has(e.name) && looksLikeRepo(child)) {
        const arr = found.get(e.name) ?? []
        if (!arr.includes(child)) arr.push(child)
        found.set(e.name, arr)
      }
      walk(child, depth + 1)
    }
  }
  if (dir) walk(dir, 0)
  // One FoundDep per (name, path); a duplicate name surfaces as multiple entries.
  return [...found].flatMap(([name, paths]) => paths.map((p) => ({ name, path: p })))
}

/**
 * The per-user device-global `repos.yaml` path: `~/.arsumbris/au-engine/config/repos.yaml`. This
 * is the ENGINE's registry, so it lives under the engine's owner tenant (derived through the SDK
 * primitive), and this pre-daemon writer must resolve exactly where the daemon reads it.
 */
export function deviceReposPath(): string {
  return path.join(engineConfigDir(), 'repos.yaml')
}

/**
 * STANDIN [[message - 260925104814 - composition verbs author the wrong member without a root, a disabled-overlay verb, and daemonless setup commands::au-engine]]:
 * a daemonless engine command should register locations, the offline twin of `register`.
 *
 * Merge `{ name, path }` location entries into the device-global `repos.yaml` (`au.engine.repos`),
 * upserting by name and preserving any existing entries (it is shared across every workspace). The
 * pre-daemon writer for member locations — once a daemon is up, `engine.register` is the live path.
 */
function registerLocations(entries: { name: string; path: string }[]): void {
  const reposPath = deviceReposPath()
  type Registry = { repos?: { name: string; path: string; remote?: string }[]; [key: string]: unknown }
  const read = readLocalFile(reposPath, (text): Registry => {
    const doc: unknown = parseYaml(text) ?? {}
    if (typeof doc !== 'object' || Array.isArray(doc)) throw new Error('it is not a YAML mapping')
    if ((doc as Registry).repos !== undefined && !Array.isArray((doc as Registry).repos)) throw new Error('its `repos` is not a list')
    return doc as Registry
  })
  // The registry is shared by every workspace on this machine: one this process cannot read is never
  // rewritten from nothing.
  if (read.state === 'failed') throw new Error(`the device registry ${reposPath} could not be read (${read.cause}), so it was left untouched; fix or remove it, then retry`)
  const doc: Registry = read.state === 'found' ? read.value : {}
  const byName = new Map((doc.repos ?? []).map((r) => [r.name, r]))
  for (const e of entries) byName.set(e.name, { ...byName.get(e.name), name: e.name, path: e.path })
  const merged = {
    ...doc,
    repos: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
  mkdirSync(path.dirname(reposPath), { recursive: true })
  writeFileSync(
    reposPath,
    '# Per-user device-global location registry (au.engine.repos): repo name -> local path on this\n' +
      '# machine. Written by au-host create-workspace + the engine `register` mutation. Not committed.\n' +
      stringifyYaml(merged),
  )
}

/**
 * The engine-schema floor types, written EXPLICITLY into the files we scaffold.
 *
 * The engine assigns these by file KIND regardless, so an unwritten one still resolves — but it
 * emits `engine-schema-type-unwritten` (`drift`) because the file does not self-describe on disk.
 * A repo.yaml that says what it IS can be read by anything, not only by something that already
 * knows the kind-to-type mapping.
 *
 * QUALIFIED with `::au-engine`: these are IN-VAULT files crossing to the builtin peer. (The
 * device-global files — `repos.yaml` / `workspaces.yaml` — validate in the builtin's own scope and
 * take the BARE form instead; we do not write those here.)
 */
const REPO_TYPE = 'au.engine.repo::au-engine'
const WORKSPACE_TYPE = 'au.engine.workspace::au-engine'

/**
 * STANDIN [[message - 260925104814 - composition verbs author the wrong member without a root, a disabled-overlay verb, and daemonless setup commands::au-engine]]:
 * a daemonless engine command should make a folder a repo, in the engine's own `repo.yaml` format.
 *
 * Seed a member's `.arsumbris/repo.yaml` identity if absent (idempotent).
 */
function scaffoldRepoYaml(memberRoot: string, name: string, description?: string): void {
  const regPath = path.join(memberRoot, '.arsumbris', 'repo.yaml')
  if (existsSync(regPath)) return
  mkdirSync(path.dirname(regPath), { recursive: true })
  // `type` first, so the file leads with what it is.
  writeFileSync(
    regPath,
    stringifyYaml(description ? { type: REPO_TYPE, name, description } : { type: REPO_TYPE, name }),
  )
}

/** Filename-safe repo name (it becomes the folder-repo's declared `name`). */
function validName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name)
}

/**
 * Turn a freshly-scaffolded ENTRY into a git working tree, with one initial commit so the tree is clean.
 *
 * The engine treats git as a semi-hard requirement: its reference-rewriting refactors (rename / promote /
 * inline / rename_block_id) are REFUSED on a non-git member, and its clean-at-HEAD read-before-write guard
 * only runs where a HEAD exists. Ordinary writes (write_file / edit_file) fall back to write-without-commit,
 * so a non-git workspace still functions — this just unlocks the refactors and the guard from the start.
 * Initialization applies only to the newly created entry, never to a located member.
 *
 * The initial commit stages everything (`add -A`) so `git status` is clean after creation — a proper HEAD
 * for the engine's per-mutation commits to build on. It uses an explicit tool identity, so it never depends
 * on the user's global git config being set.
 *
 * Best-effort by design: if git is missing or the commit fails, the workspace is still valid, so we log and
 * continue rather than fail creation. Never touches a folder that is ALREADY a git repo — we neither re-init
 * nor commit into someone's existing history (their scaffold stays theirs to commit).
 */
export function initGitRepo(folder: string, name: string): void {
  if (existsSync(path.join(folder, '.git'))) return
  try {
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
    }
    git(['init'])
    git(['add', '-A'])
    git([
      '-c', 'user.name=au-host',
      '-c', 'user.email=au-host@arsumbris.ai',
      'commit', '-m', `Initialize ${name} workspace`,
    ])
  } catch (e) {
    // Non-fatal: the workspace is valid without git (ordinary writes work; only refactors are gated).
    // The engine surfaces the non-git state downstream (refactor refusal), so this stays a log, not a throw.
    console.warn(
      `[create-workspace] git init failed for ${folder}; created without version control ` +
        `(refactors will be unavailable until it is a git repo):`,
      e instanceof Error ? e.message : e,
    )
  }
}

/**
 * STANDIN [[message - 260925104814 - composition verbs author the wrong member without a root, a disabled-overlay verb, and daemonless setup commands::au-engine]]:
 * a daemonless engine command should make a folder a workspace entry, applying its own self-listing rule.
 *
 * Write the entry's `.arsumbris/workspace.yaml` — the per-workspace composition.
 *
 * Two lists, two lifetimes:
 *  - `edit:` authoring surfaces, mounted live. MUST include the containing repo, else the
 *                engine hard-errors `workspace-omits-containing-repo`.
 *  - `discover:` mounted so type-discovery composes their parts, pinned. The FRAMEWORK belongs
 *                here, never in `repo.yaml deps` — `deps` folds into the closure-hash (= identity),
 *                so a workspace's framework choice must not change what a repo IS.
 */
function scaffoldWorkspaceYaml(entryRoot: string, name: string, discover: string[] = BUNDLES): void {
  const wsPath = path.join(entryRoot, '.arsumbris', 'workspace.yaml')
  if (existsSync(wsPath)) return
  mkdirSync(path.dirname(wsPath), { recursive: true })
  writeFileSync(
    wsPath,
    `# ${name} workspace composition (au.engine.workspace).\n` +
      `# edit:     what you AUTHOR (mounted live). Must list this repo itself.\n` +
      `# discover: mounted for type-discovery, pinned. The framework lives here, NOT in repo.yaml deps.\n` +
      stringifyYaml({ type: WORKSPACE_TYPE, edit: [name], discover }),
  )
}

/**
 * Turn an existing plain directory into a folder-repo entry, so the daemon can open it.
 *
 * This is the gate's scaffold offer: the engine REFUSES a non-repo entry (`entry-not-a-repo`) and
 * names the fix as the consumer's job — "a consumer turns 'open this folder' into 'scaffold a
 * repo.yaml', the host owns that flow." Idempotent: both writers no-op if the file exists.
 */
export function scaffoldEntry(dir: string, rawName?: string): CreateWorkspaceResult {
  const folder = (dir ?? '').trim()
  if (!folder) return { ok: false, error: 'pick a folder' }

  let st
  try {
    st = statSync(folder)
  } catch {
    return { ok: false, error: `folder not found: ${folder}` }
  }
  if (!st.isDirectory()) return { ok: false, error: 'that is a file — pick a folder' }

  // Default the repo name to the folder's own name, which is what the user already thinks of it as.
  const name = (rawName ?? path.basename(folder)).trim()
  if (!validName(name)) {
    return { ok: false, error: `'${name}' is not a usable repo name — letters, numbers, and . _ - only` }
  }

  try {
    scaffoldRepoYaml(folder, name)
    scaffoldWorkspaceYaml(folder, name)
    // Make the entry a git working tree (best-effort) so the engine's refactors + clean-at-HEAD guard work.
    initGitRepo(folder, name)
    // Locate it by name too, so a member declaring it as a dep can resolve it.
    registerLocations([{ name, path: folder }])
    return { ok: true, entryPath: folder }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function createWorkspace(dir: string, rawName: string, located: FoundDep[] = []): CreateWorkspaceResult {
  const folder = (dir ?? '').trim()
  const name = (rawName ?? '').trim()
  if (!folder) return { ok: false, error: 'pick a folder' }
  if (!name) return { ok: false, error: 'name the workspace' }
  if (!validName(name)) return { ok: false, error: 'name may contain only letters, numbers, and . _ -' }

  let st
  try {
    st = statSync(folder)
  } catch {
    return { ok: false, error: `folder not found: ${folder}` }
  }
  if (!st.isDirectory()) return { ok: false, error: 'that is a file — pick a folder' }

  // The created folder is the workspace entry and supplies its identity.
  // Refuse an existing repo so creation cannot overwrite its identity.
  if (existsSync(path.join(folder, '.arsumbris', 'repo.yaml'))) {
    return { ok: false, error: 'that folder is already an arsumbris repo — open it instead of creating over it.' }
  }

  try {
    // The entry is its own member and the workspace home (entry == root == home).
    // Its `repo.yaml` stays framework-FREE: the bundles are a composition concern, so they go into
    // `workspace.yaml discover:`. `located` are the closure repos the user pointed at.
    scaffoldRepoYaml(folder, name)
    scaffoldWorkspaceYaml(folder, name)
    // Make the entry a git working tree (best-effort, ENTRY only) with one clean initial commit, so the
    // engine's reference-rewriting refactors and clean-at-HEAD guard are available from the start.
    initGitRepo(folder, name)
    // Device-global locations: the entry + every located closure member (bundles + their deps), so each
    // resolves by name and mounts. The located members already carry their own repo.yaml (that is how
    // the closure was discovered), so only the entry needs scaffolding.
    registerLocations([{ name, path: folder }, ...located.map((d) => ({ name: d.name, path: d.path }))])
    return { ok: true, entryPath: folder }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** How long the launcher waits for `au members` before reporting that the engine did not answer. */
const MEMBERS_CHECK_TIMEOUT_MS = 15_000

/**
 * The declared members of a workspace entry that would not mount, so the launcher can offer a guided
 * locate and hold Start. The engine answers it (`au members`), in the order `au daemon start` resolves
 * members, with no daemon running. `binaryPath` is the launcher's configured `au`, else the resolved one,
 * checked the same way a daemon start checks it before anything is spawned. The wait is bounded, and
 * `signal` kills a check a newer one superseded. A folder that is not a repo declares nothing, so nothing
 * is missing. Any other failure is reported, never read as "nothing missing".
 */
export async function missingLocations(entry: string, binaryPath: string, signal?: AbortSignal): Promise<MissingMembers> {
  const binary = binaryPath.trim() || resolveDaemonBinary() || ''
  const problem = validateBinary(binary)
  if (problem) return { ok: false, error: `the members cannot be checked: ${problem}` }
  try {
    const out = await runAuMembers(binary, entry, { timeoutMs: MEMBERS_CHECK_TIMEOUT_MS, signal })
    return { ok: true, missing: out.members.filter((m) => m.tier === 'unmounted').map((m) => m.name), complete: out.complete }
  } catch (error) {
    if (error instanceof AuMembersError) {
      if (error.kind === 'not-a-repo') return { ok: true, missing: [], complete: true }
      if (error.kind === 'timeout') return { ok: false, error: `the engine did not answer the member check within ${MEMBERS_CHECK_TIMEOUT_MS / 1000}s` }
      if (error.kind === 'aborted') return { ok: false, error: 'the member check was superseded by a newer one' }
    }
    return { ok: false, error: `could not check the members: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Register located members into the device `repos.yaml` (pre-daemon, raw). The open-time locate
 *  writer, mirroring `engine.register` for when no daemon is up yet. */
export function locateMembers(entries: FoundDep[]): { ok: boolean; error?: string } {
  try {
    registerLocations(entries.map((e) => ({ name: e.name, path: e.path })))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
