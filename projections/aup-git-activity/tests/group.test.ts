// Unit tests for the mutation fold. No daemon: `groupActivity` folds a plain array, and its only
// SDK import is a type, erased under node's type-stripping. Run: `pnpm --filter
// @au-projections/aup-git-activity test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { groupActivity } from '../src/lib/group.ts'
import type { WireRecentCommit } from '@arsumbris/au-host-sdk/engine-reads'

/** Build a fake commit; `mid` adds a Mutation-Id trailer, absence means out-of-band. */
function commit(
  oid: string,
  tree: string,
  timestamp: number,
  opts: { mid?: string; members?: string[]; files?: number; subject?: string } = {},
): WireRecentCommit {
  return {
    commit: oid,
    tree,
    members: opts.members ?? [tree],
    author: { name: 'au-engine', email: 'engine@arsumbris.local' },
    timestamp,
    subject: opts.subject ?? `edit ${tree}/x`,
    changed_files: Array.from({ length: opts.files ?? 1 }, (_, i) => ({ path: `${tree}/f${i}`, status: 'modified' as const })),
    trailers: opts.mid ? [{ key: 'Mutation-Id', value: opts.mid }] : [],
  }
}

test('N commits sharing a Mutation-Id fold into one entry naming all trees', () => {
  const rows = [
    commit('a1', 'notes', 300, { mid: 'M1', members: ['notes'], files: 1 }),
    commit('a2', 'library', 300, { mid: 'M1', members: ['library'], files: 2 }),
  ]
  const entries = groupActivity(rows)
  assert.equal(entries.length, 1)
  const e = entries[0]
  assert.equal(e.id, 'M1')
  assert.equal(e.outOfBand, false)
  assert.equal(e.commits.length, 2)
  assert.deepEqual([...e.trees].sort(), ['library', 'notes'])
  assert.deepEqual([...e.members].sort(), ['library', 'notes'])
  assert.equal(e.changedFileCount, 3)
})

test('a commit with no Mutation-Id stays an out-of-band singleton', () => {
  const entries = groupActivity([commit('b1', 'au-host', 200, { subject: 'hotfix build.sh' })])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].outOfBand, true)
  assert.equal(entries[0].id, 'b1')
  assert.equal(entries[0].subject, 'hotfix build.sh')
})

test('entries stay newest-first; a mutation takes its newest commit position', () => {
  const rows = [
    commit('c3', 'notes', 500, { subject: 'terminal note' }), // out-of-band, newest
    commit('c2', 'notes', 400, { mid: 'M2' }), // mutation, newer half
    commit('c1', 'library', 350, { mid: 'M2' }), // same mutation, older half
    commit('c0', 'au-host', 100, { subject: 'old terminal' }), // out-of-band, oldest
  ]
  const entries = groupActivity(rows)
  assert.equal(entries.length, 3)
  assert.deepEqual(entries.map((e) => e.id), ['c3', 'M2', 'c0'])
  assert.equal(entries[1].timestamp, 400) // the mutation's newest constituent
  assert.equal(entries[1].commits.length, 2)
})

test('an empty input yields no entries', () => {
  assert.deepEqual(groupActivity([]), [])
})
