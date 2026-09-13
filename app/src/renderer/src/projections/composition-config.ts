// The host's saved compositions are `composition` DOCUMENTS that live WHEREVER
// the user keeps them across the workspace's members — there is no fixed location.
// So the host DISCOVERS them via the engine instance query, and writes by path.

// Discovery is `instances_of('composition')` (file-origin): it returns exactly the
// openable composition documents across the workspace, by path, with their value —
// NOT every projection instance (which would include nested sub-layouts). The host
// never reads a fixed `compositions/` dir. Saving writes to a path (absolute,
// addressing a member directly) through the contract `host.files` capability.




import { stringify } from 'yaml'

import { readFrontmatter, readInstancesOf, readResolveTarget, readTypes, type WireInstanceMatch, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import { crossFileTargets, normalizeToPool } from '@arsumbris/au-host-sdk'
import type { ContainerSchemas, ForeignFile } from '@arsumbris/au-host-sdk'

import type { FilesControl, FileWriteResult } from './host-config'

/**
 * A saved composition: a `composition` DOCUMENT. `type` is `composition`; `root` is a `[[^^id]]`
 * reference into the flat `projections` POOL, and each pool record is one projection (opaque to the
 * host beyond its own `type`). The host mounts the record `root` names; the composition itself does
 * not render. A legacy bare root-projection instance is tolerated on READ (normalizeToPool wraps it),
 * but discovery below finds only `composition`-typed files.
 */
export type RootComposition = { type: string } & Record<string, unknown>

/** The composition document type; `instances_of(composition)` returns exactly the openable entries. */
const COMPOSITION_BASE = 'composition'

/** The write surface the store needs (a subset of the guard-aware contract `host.files`). */
export type CompositionFiles = Pick<FilesControl, 'write' | 'delete'>

/** A composition discovered in the workspace, with where it lives and its value. */
export interface DiscoveredComposition {
  /** Absolute path of the composition file (from the instance query). */
  path: string
  /** Display name — the file's basename, extension stripped. */
  name: string
  /** The root projection instance value, assembled from the query. */
  composition: RootComposition
}

// Compositions are authored data. The host discovers saved composition instances and does not
// synthesize another projection's default configuration when none is selected.




/** Deep clone so a snapshot and the working buffer never share mutable substructure. */
export function cloneComposition(composition: RootComposition): RootComposition {
  return JSON.parse(JSON.stringify(composition)) as RootComposition
}

/** A composition file's display name: its basename, `.yaml`/`.md` stripped. */
function compositionName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.replace(/\.(ya?ml|md)$/i, '')
}

/**
 * Discover every saved composition across the workspace. A composition is a `composition`-typed FILE,
 * so the engine's instance query finds them all — wherever they live — by path, with their value
 * (`root` + the `projections` pool). Read THROUGH the engine.
 */
export async function discoverCompositions(reader: WireReader): Promise<DiscoveredComposition[]> {
  // A composition is a `composition` FILE — file-origin only (a nested inline record or a type-def
  // meta block could also carry the type, but those are not openable entries).
  const result = await readInstancesOf(reader, COMPOSITION_BASE, { origins: ['file'] })
  if (!('ready' in result) || !result.ready) return []
  const out: DiscoveredComposition[] = []
  const seen = new Set<string>() // schema-6 match records can repeat an instance under several identities
  for (const inst of result.result as WireInstanceMatch[]) {
    if (seen.has(inst.path)) continue
    seen.add(inst.path)
    const claim = inst.claim?.[0]
    if (!claim) continue // a composition instance always claims the type; skip the malformed
    out.push({
      path: inst.path,
      name: compositionName(inst.path),
      composition: { type: claim, ...inst.fields } as RootComposition,
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * THE CROSS-FILE LOAD PRE-PASS. Walk a composition's `[[file]]` / `[[file^^id]]` nested
 * references, resolve + read each referenced file's frontmatter, and return the closure keyed by
 * wikilink target — the map the runtime's `primeForeign` feeds the SYNC linker (`linkPool`). The reads
 * are async and happen here, once, before mount; the fold is synchronous.
 *
 * BFS over the reference graph, cached by RESOLVED PATH so a file referenced twice loads once (and two
 * spellings of one file share its `ForeignFile`). A target that does not resolve or does not read is
 * left OUT of the map — the linker's `loadForeign` then returns undefined and warns + empties the
 * position, rather than crashing. Cross-file CYCLES are terminated by the linker (by path); this walk's
 * own path cache also stops it re-reading a file, so the closure is finite.
 *
 * `origin` scopes relative resolution to the referencing file, so a `[[../shared/x]]` resolves the same
 * as it would from that file. The root's refs resolve from `entryPath`.
 */
export async function loadCrossFileClosure(
  reader: WireReader,
  rootRaw: Record<string, unknown>,
  schemas: ContainerSchemas,
  entryPath: string | undefined,
): Promise<Map<string, ForeignFile>> {
  const loaded = new Map<string, ForeignFile>()
  const byPath = new Map<string, ForeignFile>() // resolved path → the file, so a second spelling reuses it
  const queued = new Set<string>() // targets already enqueued (dedupe the frontier)
  const queue: Array<{ target: string; origin?: string }> = []

  // A throwaway minter — the pre-pass only NORMALIZES to discover cross-file targets; the ids it mints
  // are never persisted (the runtime re-normalizes with the real minter at mount).
  const mint = (): string => `scan-${queue.length}-${loaded.size}`
  const enqueueTargetsOf = (raw: Record<string, unknown>, origin?: string): void => {
    for (const t of crossFileTargets(normalizeToPool(raw, schemas, mint), schemas)) {
      if (!queued.has(t)) {
        queued.add(t)
        queue.push({ target: t, origin })
      }
    }
  }

  enqueueTargetsOf(rootRaw, entryPath)
  while (queue.length > 0) {
    const { target, origin } = queue.shift()!
    const resolved = await readResolveTarget(reader, target, origin).catch(() => null)
    const path = resolved && 'ready' in resolved && resolved.ready && resolved.result ? resolved.result.path : undefined
    if (path === undefined) continue // unresolved → linker warns + empties the position
    const cached = byPath.get(path)
    if (cached) {
      loaded.set(target, cached) // a different spelling of an already-loaded file
      continue
    }
    const fm = await readFrontmatter(reader, path).catch(() => null)
    const raw = fm && 'ready' in fm && fm.ready && fm.result ? fm.result : undefined
    if (raw === undefined) continue // unreadable → linker warns
    const ff: ForeignFile = { raw, path }
    loaded.set(target, ff)
    byPath.set(path, ff)
    enqueueTargetsOf(raw, path) // recurse into this file's own cross-file references
  }
  return loaded
}

/**
 * A `type name → owner repo` map for the whole workspace vocabulary — the key to qualifying a
 * composition's `type:` claims. Built from the summarized `types` read (workspace-wide, name-sorted).
 * Names are workspace-unique, so a plain map is unambiguous.
 */
export async function readTypeOwners(reader: WireReader): Promise<Map<string, string>> {
  const r = await readTypes(reader, { summary: true })
  if (!('ready' in r) || !r.ready) return new Map()
  const map = new Map<string, string>()
  for (const t of r.result) if (!map.has(t.name)) map.set(t.name, t.repo)
  return map
}

/** The result of qualifying a composition: the rewritten tree, plus the bare type names no
 *  workspace member owns (left bare — a save with these likely won't be discoverable; surface a
 *  warning rather than degrade silently). */
export interface QualifyResult {
  composition: RootComposition
  /** Bare `type:` names with no known owner — flagged for a user-facing warning. */
  unresolved: string[]
}

/**
 * Qualify every BARE `type:` in a composition tree to its `name::repo` form, so it resolves WHEREVER
 * the composition file lives. A bare name resolves repo-LOCAL only; a composition sits in the content
 * entry, but its projection types (`dock`, `bento`, `bento-node.*`, `file-tree`, …) are owned by OTHER
 * members, so an unqualified claim never types the file → the engine never sees it as a composition
 * and it vanishes from discovery. Already-qualified (`::`) and unknown-owner types are left untouched.
 * This is the single serialization chokepoint (the picker/runtime name projections by bare identity).
 *
 * ALSO qualifies def-ref FIELD VALUES: a `[[name]]` wikilink to a KIND def (a bar's `role:
 * [[status-projection]]`) resolves repo-local too, so a bare one warns `reference-target-missing` and
 * the bar won't aggregate. Qualified ONLY when the inner name is a KNOWN TYPE — else the `[[...]]` is a
 * value-level node/file reference (a bento `[[sub-layout]]` ref) that must stay bare.
 *
 * Returns the unresolved (unknown-owner) bare type names alongside the tree, so a caller can WARN
 * instead of letting a save quietly become undiscoverable.
 */
export function qualifyComposition(composition: RootComposition, owners: Map<string, string>): QualifyResult {
  const unresolved = new Set<string>()
  // A `[[name]]` def-ref → `[[name::repo]]`, but ONLY for a known TYPE name (a file/node ref stays bare).
  const qualifyDefRef = (v: string): string => {
    const m = /^\[\[([^\]]+)\]\]$/.exec(v)
    if (!m) return v
    const inner = m[1]
    if (inner.includes('::')) return v // already qualified
    const repo = owners.get(inner)
    return repo ? `[[${inner}::${repo}]]` : v // unknown name → likely a value-level ref, leave bare
  }
  // A bare `type:` claim NAME → `name::repo`. Unknown owner is left bare (never throw) but flagged, so
  // the caller can warn a save may not be discoverable. Applies to a single claim AND each element of a
  // MIXIN array (`type: [sandwich, grouping-choice]`, a record-level mixin) — a bare mixin element must
  // qualify like a single claim, else it dangles. (The `intent-routing` field's inner def-refs qualify via
  // the generic `qualifyDefRef` walk below, no `type:` claim of their own.)
  const qualifyTypeName = (v: string): string => {
    if (v.includes('::')) return v
    const repo = owners.get(v)
    if (repo) return `${v}::${repo}`
    unresolved.add(v)
    return v
  }
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return qualifyDefRef(node)
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'type' && typeof v === 'string') out[k] = qualifyTypeName(v)
        else if (k === 'type' && Array.isArray(v)) out[k] = v.map((e) => (typeof e === 'string' ? qualifyTypeName(e) : walk(e)))
        else out[k] = walk(v)
      }
      return out
    }
    return node
  }
  return { composition: walk(composition) as RootComposition, unresolved: [...unresolved] }
}

/** Serialize a composition to authorable YAML (the on-disk substrate form). */
function serialize(composition: RootComposition): string {
  return stringify(composition)
}

// Compositions are guard-blind by nature TODAY: they are DISCOVERED via the
// instance query (not `files.read`), so no read-time hash is captured, and the
// only save path is `save as` to a NEW file (no in-place overwrite). The
// `expectedHash` param threads the guard surface through uniformly for when an
// in-place composition overwrite lands; callers pass `undefined` until then.

/** Write a composition to a path (absolute — addressing a member directly). */
export function writeComposition(
  files: CompositionFiles,
  path: string,
  composition: RootComposition,
  expectedHash?: string,
): Promise<FileWriteResult> {
  return files.write(path, serialize(composition), expectedHash)
}

/** Delete a composition by its path (contract write surface; no engine delete). */
export function deleteComposition(
  files: CompositionFiles,
  path: string,
  expectedHash?: string,
): Promise<FileWriteResult> {
  return files.delete(path, expectedHash)
}
