// The host launcher's LOCAL recents store: `~/.arsumbris/au-host/config/recents.yaml`.

// Two levels: recent WORKSPACES (with last-open timestamps) and, nested per workspace, recent
// COMPOSITIONS. The gate pre-fills + lists recent workspaces; the post-daemon init chooser orders
// discovered compositions by this recency overlay. Per-machine, NON-git, disposable — a missing or
// corrupt file behaves as first-run and NEVER errors. Sibling to tool-paths.ts (paths.yaml); both
// sit in the host's `~/.arsumbris/au-host/config` tenant via `hostConfigDir()`. Main-process file IO only.



import * as fs from 'node:fs'
import * as path from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { hostConfigDir } from './device-paths'
import { isFolderRepo } from './gate-inspect'
import { moveAside, readLocalFile } from './local-file-read'
import type { RecentComposition, RecentWorkspace, TouchWorkspace } from '../shared/daemon-api'

/** The recents file: `~/.arsumbris/au-host/config/recents.yaml`. */
export function recentsFile(): string {
  return path.join(hostConfigDir(), 'recents.yaml')
}

function now(): number {
  return Date.now()
}

/** Set when an unreadable recents file could not be moved aside: writing would destroy it, so nothing is. */
let blocked = false

/** Read + normalize the store. Never throws. Missing → []; unreadable or not a recents document → moved
 *  aside, then []; one that will not move blocks writes for this session. */
function readRaw(): RecentWorkspace[] {
  const read = readLocalFile(recentsFile(), (text): unknown[] => {
    const parsed: unknown = parseYaml(text)
    if (parsed === null || parsed === undefined) return [] // an empty file holds no recents
    const list = typeof parsed === 'object' ? (parsed as { workspaces?: unknown }).workspaces : undefined
    if (!Array.isArray(list)) throw new Error('it has no `workspaces` list')
    return list
  })
  if (read.state === 'absent') return [] // no file = first run
  if (read.state === 'failed') {
    const aside = moveAside(recentsFile())
    if (!aside) blocked = true
    console.error(`[recents] ${recentsFile()} was unusable (${read.cause}); ${aside ? `moved aside to ${aside}` : 'could not move it aside, not writing it this session'}`)
    return []
  }
  const list = read.value
  const out: RecentWorkspace[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const w = item as Record<string, unknown>
    // Only `root` is required. Ignore additional fields and retain each valid root as the workspace entry.
    if (typeof w.root !== 'string') continue
    const comps: RecentComposition[] = Array.isArray(w.compositions)
      ? w.compositions
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as Record<string, unknown>).path === 'string')
          .map((c) => ({ path: c.path as string, lastOpened: typeof c.lastOpened === 'number' ? c.lastOpened : 0 }))
      : []
    out.push({
      root: w.root,
      lastOpened: typeof w.lastOpened === 'number' ? w.lastOpened : 0,
      compositions: comps,
    })
  }
  return out
}

function write(list: RecentWorkspace[]): void {
  if (blocked) return
  try {
    fs.mkdirSync(path.dirname(recentsFile()), { recursive: true })
    fs.writeFileSync(recentsFile(), '# au-host launcher recents (local, per-machine; safe to delete).\n' + stringifyYaml({ workspaces: list }))
  } catch {
    // A write failure must not break the host; recents are best-effort.
  }
}

const byRecent = (a: { lastOpened: number }, b: { lastOpened: number }): number => b.lastOpened - a.lastOpened

/**
 * Return recent workspaces, newest first. Remove missing roots and persist that pruning lazily.
 * Keep existing directories that are not folder-repos, flagging them stale so the gate can offer scaffolding.
 */
export function listWorkspaces(): RecentWorkspace[] {
  const list = readRaw()
  const live = list.filter((w) => {
    try {
      return fs.existsSync(w.root)
    } catch {
      return false
    }
  })
  if (live.length !== list.length) write(live) // persist the prune
  return [...live]
    .sort(byRecent)
    .map((w) => ({
      ...w,
      stale: !isFolderRepo(w.root),
      compositions: [...(w.compositions ?? [])].sort(byRecent),
    }))
}

/** Record a workspace open: upsert by `root`, refresh its timestamp, keep its compositions. */
export function touchWorkspace(ws: TouchWorkspace): void {
  const list = readRaw()
  const existing = list.find((w) => w.root === ws.root)
  if (existing) {
    existing.lastOpened = now()
  } else {
    list.push({ root: ws.root, lastOpened: now(), compositions: [] })
  }
  write(list)
}

/** A workspace's recent compositions, most-recent first ([] when unknown). */
export function listCompositions(root: string): RecentComposition[] {
  const ws = readRaw().find((w) => w.root === root)
  return ws ? [...(ws.compositions ?? [])].sort(byRecent) : []
}

/** Record a composition open within a workspace: upsert by path, refresh its timestamp. */
export function touchComposition(root: string, compositionPath: string): void {
  const list = readRaw()
  const ws = list.find((w) => w.root === root)
  if (!ws) return // the workspace is touched first (on open); no orphan composition entries
  ws.compositions ??= []
  const comp = ws.compositions.find((c) => c.path === compositionPath)
  if (comp) comp.lastOpened = now()
  else ws.compositions.push({ path: compositionPath, lastOpened: now() })
  write(list)
}
