// The mutation fold: the substrate-native heart of the view. One engine mutation fans out into N
// commits across the working trees it touched, each carrying the same `Mutation-Id` trailer. This
// collapses those N commits into ONE activity entry, so the feed's unit is the logical mutation,
// not the raw commit. A commit with no `Mutation-Id` is an out-of-band write (it bypassed the
// engine); it stays its own singleton entry, marked out-of-band.
//
// Pure and daemon-free: the only import is a TYPE, so this folds a plain array and is unit-tested
// without a running engine.

import type { WireRecentCommit } from '@arsumbris/au-host-sdk/engine-reads'

/** The trailer key every commit of one engine mutation shares. */
const MUTATION_ID = 'Mutation-Id'

/**
 * One entry in the activity feed. Either a folded engine MUTATION (`commits.length` may be > 1,
 * spanning trees) or an out-of-band singleton (`outOfBand`, one commit, no `Mutation-Id`).
 */
export interface ActivityEntry {
  /** The `Mutation-Id` for a mutation entry, else the commit oid for a singleton. Stable, dedup-safe. */
  id: string
  /** True when this is a commit with no `Mutation-Id` (a write that bypassed the engine). */
  outOfBand: boolean
  /** The constituent commits. One for a singleton, N for a folded mutation. */
  commits: WireRecentCommit[]
  /** The distinct au-repo members the entry touched, for the label. */
  members: string[]
  /** The distinct working trees the entry touched. */
  trees: string[]
  /** The headline, the newest constituent commit's subject. */
  subject: string
  /** The newest constituent commit's committer timestamp, the entry's sort key. */
  timestamp: number
  /** The total changed-file count across the constituent commits. */
  changedFileCount: number
}

function trailerValue(commit: WireRecentCommit, key: string): string | undefined {
  for (const t of commit.trailers) if (t.key === key) return t.value
  return undefined
}

/**
 * Fold commits (expected newest-first) into activity entries.
 * - commits sharing a `Mutation-Id` collapse into one entry.
 * - a commit with no `Mutation-Id` is an out-of-band singleton.
 * - an entry sorts by its newest constituent commit, so a newest-first input yields newest-first
 *   entries (a mutation entry takes the position of its newest commit, first-seen).
 */
export function groupActivity(commits: WireRecentCommit[]): ActivityEntry[] {
  const entries: ActivityEntry[] = []
  const byMutation = new Map<string, ActivityEntry>()

  for (const c of commits) {
    const mid = trailerValue(c, MUTATION_ID)
    if (mid === undefined) {
      entries.push(blankEntry(c.commit, true, [c]))
      continue
    }
    let entry = byMutation.get(mid)
    if (!entry) {
      entry = blankEntry(mid, false, [])
      byMutation.set(mid, entry)
      entries.push(entry)
    }
    entry.commits.push(c)
  }

  for (const e of entries) finalize(e)
  return entries
}

function blankEntry(id: string, outOfBand: boolean, commits: WireRecentCommit[]): ActivityEntry {
  return { id, outOfBand, commits, members: [], trees: [], subject: '', timestamp: 0, changedFileCount: 0 }
}

/** Derive an entry's aggregate fields from its constituent commits. */
function finalize(entry: ActivityEntry): void {
  const memberSet = new Set<string>()
  const treeSet = new Set<string>()
  let files = 0
  let newest = entry.commits[0]
  for (const c of entry.commits) {
    for (const m of c.members) memberSet.add(m)
    treeSet.add(c.tree)
    files += c.changed_files.length
    if (c.timestamp > newest.timestamp) newest = c
  }
  entry.members = [...memberSet]
  entry.trees = [...treeSet]
  entry.changedFileCount = files
  entry.timestamp = newest.timestamp
  entry.subject = newest.subject
}
