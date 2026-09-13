import { afterEach, describe, expect, it } from 'vitest'

import {
  chooseGrouping,
  groupingForKind,
  groupingForNewGroup,
  isGroupingKind,
  setGroupingProvider,
  type GroupingCapability,
} from '../src/grouping.ts'

// The substrate resolves declared grouping capabilities without knowing container names or schemas.
// These tests use a fake provider to check lookup behavior: absent providers return null, and absent
// minChildren stays undefined so containers without a floor do not dissolve.
// Provider installation, module loading and cross-repo identity matching are outside this fixture.

const cap = (typeName: string, minChildren?: number): GroupingCapability => ({
  typeName,
  build: (children) => ({ type: typeName, children }),
  ...(minChildren === undefined ? {} : { minChildren }),
})

afterEach(() => setGroupingProvider(null))

describe('the grouping lookup', () => {
  it('returns null everywhere when no host has installed a provider', () => {
    expect(groupingForNewGroup()).toBeNull()
    expect(groupingForKind('tabs')).toBeNull()
    expect(isGroupingKind('tabs')).toBe(false)
  })

  it('resolves a declared container, and only a declared one', () => {
    const tabs = cap('tabs', 2)
    setGroupingProvider({ forNewGroup: () => tabs, forKind: (k) => (k === 'tabs' ? tabs : null) })

    expect(groupingForKind('tabs')).toBe(tabs)
    expect(isGroupingKind('tabs')).toBe(true)
    // bento declares no grouping, so a center drop on it must WRAP rather than add.
    expect(isGroupingKind('bento')).toBe(false)
    expect(groupingForKind(undefined)).toBeNull()
  })

  it('lets a THIRD-PARTY container be the group, with no substrate change', () => {
    // The bar: a user's own container must work exactly as tabs does.
    const carousel = cap('carousel')
    setGroupingProvider({ forNewGroup: () => carousel, forKind: (k) => (k === 'carousel' ? carousel : null) })

    const built = groupingForNewGroup()?.build([
      { id: 'a', instance: { type: 'editor-pane' } },
      { id: 'b', instance: { type: 'terminal' } },
    ]) as { type: string }
    expect(built.type).toBe('carousel')
    // and nothing in the substrate ever mentioned tabs to get here
    expect(isGroupingKind('tabs')).toBe(false)
  })

  it('carries minChildren through as the container-declared floor', () => {
    const tabs = cap('tabs', 2)
    const carousel = cap('carousel') // happy holding one child: declares nothing
    setGroupingProvider({
      forNewGroup: () => tabs,
      forKind: (k) => (k === 'tabs' ? tabs : k === 'carousel' ? carousel : null),
    })

    expect(groupingForKind('tabs')?.minChildren).toBe(2)
    // undefined, NOT 0 or 1 — the router reads undefined as "never dissolves".
    expect(groupingForKind('carousel')?.minChildren).toBeUndefined()
  })

  it('clears cleanly, so a teardown cannot leave a stale capability behind', () => {
    setGroupingProvider({ forNewGroup: () => cap('tabs', 2), forKind: () => cap('tabs', 2) })
    expect(groupingForNewGroup()).not.toBeNull()

    setGroupingProvider(null)
    expect(groupingForNewGroup()).toBeNull()
    expect(groupingForKind('tabs')).toBeNull()
  })
})

// The composition can select a grouping container. When the provider chooses among unconfigured
// candidates, its alphabetical choice must be announced and independent of discovery order.
describe('chooseGrouping', () => {
  const tabs = cap('tabs', 2)
  const column = cap('column')
  const carousel = cap('carousel')

  it('honours the composition request', () => {
    const out = chooseGrouping([column, tabs], 'tabs')
    expect(out.chosen).toBe(tabs)
    expect(out.reason).toBe('requested')
  })

  it('matches a request across the repo qualifier', () => {
    // A composition's def-ref may arrive qualified; the capability is discovered bare.
    expect(chooseGrouping([column, tabs], 'tabs::tabs').chosen).toBe(tabs)
  })

  it('takes the only declarer without calling it a default', () => {
    const out = chooseGrouping([tabs])
    expect(out.chosen).toBe(tabs)
    // `only`, not `defaulted` — there was nothing to choose, so nothing to announce.
    expect(out.reason).toBe('only')
  })

  it('falls back ALPHABETICALLY, never to array order', () => {
    // tabs is listed first, so an implementation taking `capabilities[0]` would pick it and pass a
    // laxer test. Alphabetically `column` wins.
    const out = chooseGrouping([tabs, column])
    expect(out.chosen).toBe(column)
    expect(out.reason).toBe('defaulted')
    expect(out.available).toEqual(['column', 'tabs'])
  })

  it('reports rather than refuses when the request names a non-grouping container', () => {
    // The engine's def-ref bound checks the target IS a container-projection, not that it declares
    // grouping — so this typo reaches runtime, and must not break grouping entirely.
    const out = chooseGrouping([tabs, column], 'bento')
    expect(out.chosen).toBe(column)
    expect(out.reason).toBe('request-unresolved')
    expect(out.requested).toBe('bento')
  })

  it('reports nothing to group into when no container declares', () => {
    const out = chooseGrouping([])
    expect(out.chosen).toBeNull()
    expect(out.reason).toBe('none')
    expect(out.available).toEqual([])
  })

  it('lets a third party outrank us by name, with no framework change', () => {
    expect(chooseGrouping([tabs, carousel]).chosen).toBe(carousel)
  })
})
