// The re-resolve-after-await invariant. A placement routine that suspends on a chooser MUST
// read its mutation target AFTER the suspension, never before — the pool can move during the await (a
// concurrent move re-points a window's content), and building edits from a pre-await capture strands the
// concurrent move's subtree. `pickThenResolve` makes that structural: `resolve` runs strictly after `pick`.
//
// THE TEETH: the first test mutates a shared cell INSIDE `pick`, then asserts `resolve` sees the mutated
// value. Reorder the combinator to resolve-before-pick and this test reads the stale value and fails.


import { describe, expect, it } from 'vitest'

import { pickThenResolve } from '../src/renderer/src/projections/placement-reresolve.ts'

describe('pickThenResolve — the re-resolve-after-await invariant', () => {
  it('resolves the target AFTER the pick, so a mutation during the pick is seen (never a stale read)', async () => {
    let content = 'C0' // the target's content, as the pool holds it
    const result = await pickThenResolve(
      async () => {
        content = 'C1' // a concurrent move re-points the window DURING the pick's suspension
        return { kind: 'column' }
      },
      () => content, // the FRESH read
    )
    // The fresh read wins: C1, not the pre-await C0. Reordering resolve-before-pick would read C0 here.
    expect(result).toEqual({ pick: { kind: 'column' }, target: 'C1' })
  })

  it('propagates a cancelled pick without resolving', async () => {
    let resolved = false
    const result = await pickThenResolve(
      async () => 'cancel' as const,
      () => {
        resolved = true
        return 'x'
      },
    )
    expect(result).toBe('cancel')
    expect(resolved).toBe(false) // a cancelled pick never re-resolves — the caller abandons before any read
  })

  it('reports a resolve-miss when the target vanished during the pick', async () => {
    const result = await pickThenResolve<{ kind?: string }, string>(
      async () => ({}),
      () => null, // the target is gone / changed to an unusable state
    )
    expect(result).toBe('resolve-miss')
  })

  it('resolve runs strictly after pick settles (ordering, not just value)', async () => {
    const order: string[] = []
    await pickThenResolve(
      async () => {
        order.push('pick')
        return {}
      },
      () => {
        order.push('resolve')
        return 1
      },
    )
    expect(order).toEqual(['pick', 'resolve'])
  })
})
