import { describe, expect, it } from 'vitest'

import { createModelCell } from '../src/model-cell.ts'

// A placement seam may commit several times in one synchronous tick. A commit triggered by a
// notification must build on the value already written by the notifying commit. Otherwise a nested
// save can resurrect a pane removed by the first mutation. Exercise that re-entrant commit path.

describe('ModelCell — the live read', () => {
  it('read() sees a commit immediately, before any listener runs', () => {
    const cell = createModelCell({ n: 0 })
    const seen: number[] = []
    cell.subscribe(() => seen.push(cell.read().n))
    cell.commit({ n: 1 })
    // The listener already observed the NEW value: `commit` advances before it notifies.
    expect(seen).toEqual([1])
    expect(cell.read().n).toBe(1)
  })

  it('a RE-ENTRANT commit builds on the value that triggered it, not the one it replaced (B-44 regression)', () => {
    // The exact shape of the bug: a listener (the child-config writeback) commits again, and its
    // new value is derived from what it reads. If `read()` returned the pre-commit value, the
    // re-entrant commit would undo the first one.
    const cell = createModelCell<{ panes: string[] }>({ panes: ['a', 'b'] })
    let reentered = false
    cell.subscribe(() => {
      if (reentered) return
      reentered = true
      // Stands in for "the nested container saved, so rebuild my config from my current model".
      cell.commit({ panes: [...cell.read().panes, 'c'] })
    })

    // Stands in for the extract: 'b' leaves.
    cell.commit({ panes: ['a'] })

    // 'b' must NOT come back. It would if the re-entrant commit had read the pre-extract model.
    expect(cell.read().panes).toEqual(['a', 'c'])
  })

  it('a listener added during a notification does not receive that same notification', () => {
    // The listener set is copied before iterating, so a subscribe mid-notify is not a surprise
    // re-entrancy of its own. Pinned because the copy looks removable.
    const cell = createModelCell({ n: 0 })
    const late: number[] = []
    cell.subscribe(() => cell.subscribe((v) => late.push(v.n)))
    cell.commit({ n: 1 })
    expect(late).toEqual([])
    cell.commit({ n: 2 })
    expect(late).toEqual([2])
  })

  it('unsubscribe stops delivery and is safe to call twice', () => {
    const cell = createModelCell({ n: 0 })
    const seen: number[] = []
    const off = cell.subscribe((v) => seen.push(v.n))
    cell.commit({ n: 1 })
    off()
    off()
    cell.commit({ n: 2 })
    expect(seen).toEqual([1])
  })

  it('an unsubscribe DURING a notification still lets that notification finish', () => {
    // Iteration is over a copy, so removing a listener mid-notify must not skip the next one —
    // the classic set-mutated-while-iterating bug.
    const cell = createModelCell({ n: 0 })
    const seen: string[] = []
    const off = cell.subscribe(() => {
      seen.push('first')
      off()
    })
    cell.subscribe(() => seen.push('second'))
    cell.commit({ n: 1 })
    expect(seen).toEqual(['first', 'second'])
  })
})
