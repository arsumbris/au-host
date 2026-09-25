import { afterEach, describe, expect, it } from 'vitest'

import { admitsChildren, setWrapTargets, wrapBuildFor, wrapChoice, type WrapTarget } from '../src/grouping.ts'
import { wrapOutcomeReason } from '../src/registry.ts'
import { reparentSafeCenter } from '../src/reparent.ts'

// Every wrap flow resolves its container through `wrapChoice(n)`: only targets admitting `n` children are
// candidates, a `group-into` that does not admit `n` is inapplicable (not an error), and the options are
// sectioned Stack → Arrange → Frame.

const target = (typeName: string, family: WrapTarget['family'], arity: { min?: number; max?: number } = {}): WrapTarget => ({
  typeName,
  family,
  build: (children) => ({ type: typeName, children }),
  ...(arity.min === undefined ? {} : { minChildren: arity.min }),
  ...(arity.max === undefined ? {} : { maxChildren: arity.max }),
})

const ALL = [
  target('sandwich', 'frame', { max: 1 }),
  target('bento', 'spatial'),
  target('tabs', 'grouping'),
  target('column', 'grouping'),
]

afterEach(() => setWrapTargets([]))

describe('admitsChildren', () => {
  it('reads (min ?? 1) <= n <= (max ?? unbounded)', () => {
    expect(admitsChildren({}, 1)).toBe(true)
    expect(admitsChildren({}, 5)).toBe(true)
    expect(admitsChildren({ maxChildren: 1 }, 2)).toBe(false)
    expect(admitsChildren({ minChildren: 2 }, 1)).toBe(false)
    expect(admitsChildren({ minChildren: 2, maxChildren: 3 }, 3)).toBe(true)
  })
})

describe('wrapChoice', () => {
  it('offers every family for a solo wrap, sectioned Stack → Arrange → Frame', () => {
    setWrapTargets(ALL)
    const c = wrapChoice(1)
    expect(c.use).toBeUndefined()
    expect(c.options.map((o) => `${o.section}:${o.id}`)).toEqual(['Stack:tabs', 'Stack:column', 'Arrange:bento', 'Frame:sandwich'])
  })

  it('never offers a frame for two children', () => {
    setWrapTargets(ALL)
    expect(wrapChoice(2).options.map((o) => o.id)).toEqual(['tabs', 'column', 'bento'])
  })

  it('honours group-into when it admits n, and treats it as unset when it does not', () => {
    setWrapTargets(ALL, 'sandwich::sandwich')
    expect(wrapChoice(1).use).toBe('sandwich')
    const two = wrapChoice(2)
    expect(two.use).toBeUndefined()
    expect(two.options).toHaveLength(3)
  })

  it('uses a sole candidate silently', () => {
    setWrapTargets([target('sandwich', 'frame', { max: 1 }), target('tabs', 'grouping')])
    expect(wrapChoice(2).use).toBe('tabs')
  })

  it('asks when group-into names a container that is not installed at all', () => {
    setWrapTargets(ALL, 'carousel')
    expect(wrapChoice(1).use).toBeUndefined()
  })

  it('returns no options when nothing admits n', () => {
    setWrapTargets([target('sandwich', 'frame', { max: 1 })])
    expect(wrapChoice(2)).toEqual({ options: [] })
  })

  it('labels each option with its target\'s own label, else one derived from the type name', () => {
    setWrapTargets([{ ...target('tabs', 'grouping'), label: 'Tab group' }, target('column::column', 'grouping')])
    expect(wrapChoice(2).options.map((o) => o.label)).toEqual(['Tab group', 'Column'])
  })
})

describe('wrapBuildFor — every wrap names its own refusal', () => {
  it('builds with a kind that admits the count', () => {
    setWrapTargets(ALL)
    const b = wrapBuildFor('sandwich', 1)
    expect('cap' in b && b.cap.typeName).toBe('sandwich')
  })

  it('refuses a kind whose arity does not admit the count as arity-refused, never no-grouping', () => {
    setWrapTargets(ALL)
    expect(wrapBuildFor('sandwich', 2)).toEqual({ refused: 'arity-refused', typeName: 'sandwich', n: 2 })
  })

  it('reports no-grouping only when there is nothing to build with', () => {
    setWrapTargets([])
    expect(wrapBuildFor(undefined, 2)).toEqual({ refused: 'no-grouping' })
  })

  it('says why in words, naming the kind and the count', () => {
    expect(wrapOutcomeReason('arity-refused', { kind: 'Sandwich', n: 2 })).toBe('Sandwich cannot hold 2 panes')
    expect(wrapOutcomeReason('no-grouping')).toBe('no container type is available to wrap into')
  })
})

describe('reparentSafeCenter — the last gate before a two-child group', () => {
  it('never builds a group whose kind refuses two children', () => {
    let built = false
    const frame = { ...target('sandwich', 'frame', { max: 1 }), build: () => { built = true; return { type: 'sandwich' } } }
    const out = reparentSafeCenter({
      incoming: { id: 'b', instance: { type: 'editor-pane' } as never },
      existing: { id: 'a', instance: { type: 'editor-pane' } as never },
      target: { poolEdit: { recordId: () => 'grid' } as never, containerKind: 'bento', slotId: 's', descriptor: {} as never },
      source: null,
      grouping: frame,
    })
    expect(out).toEqual({ ok: false, reason: 'arity-refused' })
    expect(built).toBe(false)
  })
})
