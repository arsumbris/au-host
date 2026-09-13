/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'

import {
  offerHeaderRegion,
  withdrawHeaderRegion,
  isHeaderRegionClaimed,
  offeredHeaderRegion,
  setHeaderRegionClaimed,
  subscribeHeaderRegions,
  paneIdForElement,
} from '../src/pane-header.ts'

// THE PANE-HEADER CONTRIBUTION seam. The container OFFERS a region node; the occupant reads it
// (`offeredHeaderRegion`), draws into it, and marks it CLAIMED so the container drops its title. The
// record is keyed by a stable paneId so a re-parent (which never changes the occupant's own id) keeps
// pointing at the right region. Both sides subscribe to one per-pane notify list.

const el = (): HTMLElement => document.createElement('div')

describe('pane-header contribution registry', () => {
  it('offers a region node and withdraws it', () => {
    const region = el()
    expect(offeredHeaderRegion('p1', 'center')).toBeNull() // nothing offered yet
    offerHeaderRegion('p1', 'center', region)
    expect(offeredHeaderRegion('p1', 'center')).toBe(region) // the SAME node, stable
    withdrawHeaderRegion('p1', 'center')
    expect(offeredHeaderRegion('p1', 'center')).toBeNull()
  })

  it('claim toggles the container-visible flag', () => {
    offerHeaderRegion('p2', 'center', el())
    expect(isHeaderRegionClaimed('p2', 'center')).toBe(false) // title shows
    setHeaderRegionClaimed('p2', 'center', true)
    expect(isHeaderRegionClaimed('p2', 'center')).toBe(true) // occupant drew in, title yields
    setHeaderRegionClaimed('p2', 'center', false)
    expect(isHeaderRegionClaimed('p2', 'center')).toBe(false)
    withdrawHeaderRegion('p2', 'center')
  })

  it('notifies both sides on offer, claim, and release', () => {
    let fires = 0
    const off = subscribeHeaderRegions('p3', () => {
      fires++
    })
    offerHeaderRegion('p3', 'center', el()) // +1
    setHeaderRegionClaimed('p3', 'center', true) // +1
    setHeaderRegionClaimed('p3', 'center', true) // no-op (already claimed) → no fire
    setHeaderRegionClaimed('p3', 'center', false) // +1
    withdrawHeaderRegion('p3', 'center') // +1
    expect(fires).toBe(4)
    off()
  })

  it('gc drops a pane record once it holds nothing', () => {
    const off = subscribeHeaderRegions('p4', () => {})
    offerHeaderRegion('p4', 'center', el())
    setHeaderRegionClaimed('p4', 'center', true)
    // Tear everything down; only when regions + claims + subs are all empty does the record vanish.
    setHeaderRegionClaimed('p4', 'center', false)
    withdrawHeaderRegion('p4', 'center')
    off()
    // A fresh read allocates nothing and reports empty — the record was collected.
    expect(offeredHeaderRegion('p4', 'center')).toBeNull()
    expect(isHeaderRegionClaimed('p4', 'center')).toBe(false)
  })

  it('an unoffered region marks nothing (occupant is render-resilient)', () => {
    setHeaderRegionClaimed('p5', 'center', true) // no record yet → no-op, no throw
    expect(isHeaderRegionClaimed('p5', 'center')).toBe(false)
  })

  it('paneIdForElement resolves the nearest enclosing data-pane-id', () => {
    const outer = document.createElement('div')
    outer.setAttribute('data-pane-id', 'outer-pane')
    const inner = document.createElement('div')
    inner.setAttribute('data-pane-id', 'inner-pane')
    const leaf = document.createElement('span')
    outer.appendChild(inner)
    inner.appendChild(leaf)
    // From an occupant deep inside, the NEAREST enclosing pane wins (walks up, not down).
    expect(paneIdForElement(leaf)).toBe('inner-pane')
    // From the outer box, its own id.
    expect(paneIdForElement(outer)).toBe('outer-pane')
    // No enclosing pane → null (the composition root case).
    expect(paneIdForElement(document.createElement('div'))).toBeNull()
    expect(paneIdForElement(null)).toBeNull()
  })
})
