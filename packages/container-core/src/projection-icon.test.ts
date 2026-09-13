import { describe, expect, it } from 'vitest'
import { projectionIconLookup, tabContentIcon } from './projection-icon'

const descriptor = (repo: string, icon?: unknown) => ({ type: 'viewer', repo, kinds: ['pane-projection'], meta: { 'projection-presentation-meta': { icon } } })
describe('tab content icons', () => {
  it('uses declared presentation without projection-name tables', () => {
    expect(projectionIconLookup([descriptor('one', ' globe ')])('viewer::one')).toBe('globe')
  })
  it('keeps qualified peers distinct and does not guess ambiguous bare names', () => {
    const lookup = projectionIconLookup([descriptor('one', 'globe'), descriptor('two', 'terminal')])
    expect(lookup('viewer::two')).toBe('terminal')
    expect(lookup('viewer')).toBe('panel-top')
    expect(lookup('viewer::missing')).toBe('panel-top')
  })
  it('falls back for absent or malformed presentation', () => {
    for (const icon of [undefined, '', ' ', 2]) expect(projectionIconLookup([descriptor('one', icon)])('viewer')).toBe('panel-top')
    expect(projectionIconLookup([])(undefined)).toBe('panel-top')
  })
  it('retains the file identity across different projections', () => {
    expect(tabContentIcon('/notes/reader.md', 'eye')).toBe('file')
    expect(tabContentIcon('/notes/reader.md', 'edit')).toBe('file')
    expect(tabContentIcon('', 'globe')).toBe('globe')
    expect(tabContentIcon(undefined, 'globe')).toBe('globe')
  })
})
