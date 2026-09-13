import { describe, expect, it } from 'vitest'
import { newFileTabIndex } from '../src/lib/new-tab-position'

describe('new file tab placement', () => {
  it('keeps before-source behavior when unset, even when another tab is active', () => {
    expect(newFileTabIndex(4, 3, 1)).toBe(1)
    expect(newFileTabIndex(4, 3, 1, 'before-source')).toBe(1)
  })

  it('uses the actual source rather than the active tab when configured after-source', () => {
    expect(newFileTabIndex(4, 3, 0, 'after-source')).toBe(1)
    expect(newFileTabIndex(4, 0, 3, 'after-source')).toBe(4)
  })

  it('anchors external or stale sources to the active tab in the receiving group', () => {
    expect(newFileTabIndex(4, 1, -1, 'after-source')).toBe(2)
    expect(newFileTabIndex(4, 1, 5, 'after-source')).toBe(2)
    expect(newFileTabIndex(4, 1, -1)).toBe(1)
  })

  it('inserts into empty groups and bounds stale active indices', () => {
    expect(newFileTabIndex(0, 0, -1, 'after-source')).toBe(0)
    expect(newFileTabIndex(3, 8, -1, 'after-source')).toBe(3)
    expect(newFileTabIndex(3, -1, -1)).toBe(0)
  })
})
