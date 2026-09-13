// Bento's serializer tests. A leaf's occupant
// is emitted as a `[[^^childId]]` REFERENCE into the flat pool, never inline — so bento's record
// embeds only its own structure + child ref-ids, and no parent ever re-serializes a stale child (the
// re-parent duplication class). The referenced record lives in the pool (the host is its single
// writer). These tests pin the ref-emitting round trip.
//
// The occupant's `^:` still survives — it just rides in the reference rather than on an inline child.
// These tests preserve round-trip coverage for serializer changes.

import { describe, expect, it } from 'vitest'

import { fromSubstrate, toSubstrate } from '../src/config-binding.ts'
import type { Bento } from '../src/generated.ts'

const noRefs = async (): Promise<never> => {
  throw new Error('this fixture has no reference arms')
}

/** Every occupant/position id under a value: a `^:` key (a position or a structural node) AND a
 *  `[[^^id]]` block-referent (a leaf's occupant, now emitted as a pool reference). */
function ids(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    const m = /^\[\[\^\^([^\]|#]+)\]\]$/.exec(v.trim())
    if (m) out.push(m[1])
    return out
  }
  if (v == null || typeof v !== 'object') return out
  if (Array.isArray(v)) {
    for (const x of v) ids(x, out)
    return out
  }
  const rec = v as Record<string, unknown>
  if (typeof rec['^'] === 'string') out.push(rec['^'])
  for (const k of Object.keys(rec)) ids(rec[k], out)
  return out
}

/** The block-id a `[[^^id]]` reference names, for asserting a bare leaf's ref. */
const refId = (v: unknown): string | undefined =>
  typeof v === 'string' ? /^\[\[\^\^([^\]|#]+)\]\]$/.exec(v.trim())?.[1] : undefined

const roundTrip = async (cfg: Bento): Promise<Bento> => {
  const bound = await fromSubstrate(cfg, noRefs)
  return toSubstrate(bound.root)
}

describe('a bare leaf with no authored id', () => {
  const cfg = {
    type: 'bento',
    root: {
      '^': 'branch-1',
      type: 'bento-node.branch',
      direction: 'row',
      ratio: 0.5,
      children: [{ type: 'editor-pane', file: 'a.md' }, { type: 'terminal' }],
    },
  } as unknown as Bento

  it('GAINS an id, which is the point of the change', async () => {
    // Without one, a reload gives the pane a fresh runtime id and the host-owned terminal session
    // plus the stored cursor are keyed to something that no longer exists. The id now rides in the
    // occupant's pool REFERENCE rather than on an inline `^:`.
    const children = ((await roundTrip(cfg)).root as Record<string, unknown>)['children'] as unknown[]
    expect(typeof refId(children[0])).toBe('string')
    expect(typeof refId(children[1])).toBe('string')
  })

  it('keeps the child BARE — an unruled position is a bare REFERENCE, not a slot record', async () => {
    // The byte-identical guarantee is about SLOT RECORDS: a position that says nothing must not gain
    // a wrapper. Under the pool it is a bare `[[^^id]]` reference (a string), not an inline record —
    // the occupant's own config (`type` / `file`) lives in the pool, keyed by that id.
    const children = ((await roundTrip(cfg)).root as Record<string, unknown>)['children'] as unknown[]
    expect(typeof children[0]).toBe('string')
    expect(refId(children[0])).toBeTruthy()
  })

  it('mints its ids ONCE — re-serializing the same tree never re-mints them', async () => {
    // Under the pool the round trip spans the HOST: a save emits `[[^^id]]` refs, and the host
    // resolves them back to inline records BEFORE bento reads again (bento's fromSubstrate reads only
    // resolved trees — feeding it refs is not the real flow). So id stability is bento's not re-minting
    // when it re-serializes the same bound tree: the ids in the ref are fixed at the first bind.
    const bound = await fromSubstrate(cfg, noRefs)
    const once = toSubstrate(bound.root)
    const twice = toSubstrate(bound.root)
    expect(ids(once).length).toBe(3) // branch-1 (^) + two leaf refs
    expect(ids(twice)).toEqual(ids(once))
  })
})

describe('what must NOT change', () => {
  it('preserves every authored id verbatim', async () => {
    const cfg = {
      type: 'bento',
      root: {
        '^': 'branch-1',
        type: 'bento-node.branch',
        direction: 'column',
        ratio: 0.3,
        children: [
          { '^': 'kid-a', type: 'editor-pane', file: 'a.md' },
          { '^': 'kid-b', type: 'file-tree' },
        ],
      },
    } as unknown as Bento
    expect(ids(await roundTrip(cfg))).toEqual(['branch-1', 'kid-a', 'kid-b'])
  })

  it('round-trips a ruled position unchanged, rules and occupant alike', async () => {
    const cfg = {
      type: 'bento',
      root: {
        '^': 'branch-1',
        type: 'bento-node.branch',
        direction: 'row',
        ratio: 0.5,
        children: [
          {
            '^': 'pos-1',
            type: 'bento-slot',
            admits: ['[[terminal::terminal]]'],
            fixed: true,
            label: 'Console',
            child: { '^': 'kid', type: 'terminal' },
          },
          { '^': 'kid-b', type: 'editor-pane', file: 'b.md' },
        ],
      },
    } as unknown as Bento
    const children = ((await roundTrip(cfg)).root as Record<string, unknown>)['children'] as unknown[]
    // The POSITION's rules round-trip verbatim; its OCCUPANT is now a pool reference (the terminal's
    // config lives in the pool, keyed by `kid`), not an inline record.
    expect(children[0]).toEqual({
      type: 'bento-slot',
      '^': 'pos-1',
      admits: ['[[terminal::terminal]]'],
      fixed: true,
      label: 'Console',
      child: '[[^^kid]]',
    })
  })

  it('keeps an EMPTY unruled position as a placeholder, not as nothing', async () => {
    // A branch has an arity of two, so an empty position cannot collapse away — it is the one case
    // where a position with nothing to say still needs a record.
    const cfg = {
      type: 'bento',
      root: {
        '^': 'branch-1',
        type: 'bento-node.branch',
        direction: 'row',
        ratio: 0.5,
        children: [{ type: 'bento-slot' }, { '^': 'kid', type: 'editor-pane', file: 'a.md' }],
      },
    } as unknown as Bento
    const children = ((await roundTrip(cfg)).root as Record<string, unknown>)['children'] as unknown[]
    expect(children[0]).toEqual({ type: 'bento-slot' })
    expect(children).toHaveLength(2)
  })

  it('re-applies the cross-repo qualifier on every node type it writes', async () => {
    const cfg = {
      type: 'bento::bento',
      root: {
        '^': 'b',
        type: 'bento-node.branch::bento',
        direction: 'row',
        ratio: 0.5,
        children: [{ '^': 'p', type: 'bento-slot::bento', fixed: true }, { '^': 'k', type: 'editor-pane::editor' }],
      },
    } as unknown as Bento
    const bound = await fromSubstrate(cfg, noRefs)
    const out = toSubstrate(bound.root, '::bento')
    const children = (out.root as Record<string, unknown>)['children'] as Record<string, unknown>[]
    expect((out.root as Record<string, unknown>)['type']).toBe('bento-node.branch::bento')
    expect(children[0]!['type']).toBe('bento-slot::bento')
  })
})
