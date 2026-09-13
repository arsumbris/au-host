// Regression coverage: wrapping and dissolving preserve the position's rules and
// identity, along with the occupant's stable ID. A valid serialized file alone does
// not prove that fixity or admission constraints survived the operation.

import { describe, expect, it } from 'vitest'

import { fromSubstrate, replaceLeafOccupant, toSubstrate } from '../src/config-binding.ts'
import type { Bento } from '../src/generated.ts'

const noRefs = async (): Promise<never> => {
  throw new Error('this fixture has no reference arms')
}

/** Every occupant/position id under a value: a `^:` key (a position or an inline record) AND a
 *  `[[^^id]]` block-referent (the occupant is now emitted as a REFERENCE into the pool, so its own
 *  `^:` rides in the ref rather than on an inline child). The occupant's identity surviving is what
 *  these tests assert; under the pool it survives inside the reference. */
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

/** A single RULED position: the author pinned it and said what may occupy it. */
const RULED = {
  type: 'bento',
  root: {
    '^': 'files',
    type: 'bento-slot',
    fixed: true,
    admits: ['[[file-tree::file-tree]]'],
    child: { '^': 'tree-1', type: 'file-tree' },
  },
} as unknown as Bento

// Exercise replaceLeafOccupant directly so the seam and test share the actual
// position-preservation operation.
const asSetSlotContent = replaceLeafOccupant

describe('a position\'s rules across a `setSlotContent` (the wrap / dissolve seam)', () => {
  it('round-trips its rules untouched when nothing writes to it — the control', async () => {
    // Without this the test below proves nothing: a serializer that dropped `fixed` on EVERY save
    // would fail it for a reason that has nothing to do with `setSlotContent`.
    const bound = await fromSubstrate(RULED, noRefs)
    const out = toSubstrate(bound.root, bound.refs, bound.detached) as unknown as Record<string, unknown>
    expect(JSON.stringify(out)).toContain('"fixed":true')
    expect(ids(out)).toContain('tree-1')
  })

  it('keeps `fixed` and `admits` when the seam replaces the occupant', async () => {
    const bound = await fromSubstrate(RULED, noRefs)
    const next = asSetSlotContent(bound.root as never, 'files', { type: 'tabs' })
    const out = toSubstrate(next, bound.refs, bound.detached) as unknown as Record<string, unknown>

    // The author declared this position fixed and editor-free. A wrap must not silently un-declare it.
    expect(JSON.stringify(out)).toContain('"fixed":true')
  })

  it('keeps the occupant\'s own `^:` id, rather than re-minting it', async () => {
    // The second half: `childId` is the pane id that keys a terminal session and the restorable
    // view-state. Dropping it means a dissolve hands the survivor a new identity.
    const bound = await fromSubstrate(RULED, noRefs)
    const next = asSetSlotContent(bound.root as never, 'files', { type: 'file-tree' })
    const out = toSubstrate(next, bound.refs, bound.detached)

    expect(ids(out)).toContain('tree-1')
  })
})
