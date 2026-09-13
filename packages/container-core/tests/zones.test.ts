// Test drop-zone geometry directly. Edge bands are capped on large panes and protect a usable
// center on small panes. Corners resolve to the nearest edge, keeping every direction reachable.
// The highlight band and hit-test zone share the same edgeBandPx calculation.

import { describe, expect, it } from 'vitest'
import { edgeBandPx, computeRectZone, bandFracFor } from '../src/index.ts'

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y }) as DOMRect

describe('edgeBandPx', () => {
  it('is 0.25 of the dimension while small', () => {
    expect(edgeBandPx(400)).toBe(100) // 0.25 * 400
  })
  it('CAPS past the reference dimension (a large pane does not get a giant edge)', () => {
    expect(edgeBandPx(1200)).toBe(125) // 0.25 * min(1200, 500)
    expect(edgeBandPx(4000)).toBe(125) // still capped
  })
  it('protects a minimum centre on a tiny pane (both bands cannot eat the middle)', () => {
    // dim 60: (60 - 48)/2 = 6 is the max band, below the 24 floor — centre wins.
    expect(edgeBandPx(60)).toBe(6)
  })
})

describe('computeRectZone', () => {
  it('is center in the middle', () => {
    expect(computeRectZone(rect(0, 0, 800, 600), 400, 300)).toBe('center')
  })
  it('resolves a corner to the NEAREST edge, not a fixed axis precedence', () => {
    // On a 1200x800 surface, the cursor is closer to the left edge than the top edge; choose left.
    expect(computeRectZone(rect(0, 0, 1200, 800), 10, 100)).toBe('left')
  })
  it('still picks the true nearest edge when the cursor is nearer the top', () => {
    expect(computeRectZone(rect(0, 0, 1200, 800), 100, 8)).toBe('top')
  })
})

describe('bandFracFor agrees with the zone geometry', () => {
  it('a large pane band is CAPPED below 0.25 (matches the capped edgeBandPx)', () => {
    const b = bandFracFor(rect(0, 0, 1200, 800), 'left')
    expect(b.w).toBeCloseTo(125 / 1200, 5) // ~0.104, not 0.25
    expect(b.h).toBe(1)
  })
  it('a small pane band is the raw 0.25 fraction', () => {
    const b = bandFracFor(rect(0, 0, 400, 400), 'top')
    expect(b.h).toBeCloseTo(0.25, 5)
  })
  it('center is the protected inner box (rect minus both edge bands)', () => {
    const b = bandFracFor(rect(0, 0, 1200, 800), 'center')
    const fx = 125 / 1200
    const fy = 125 / 800
    expect(b.x).toBeCloseTo(fx, 5)
    expect(b.w).toBeCloseTo(1 - 2 * fx, 5)
    expect(b.y).toBeCloseTo(fy, 5)
    expect(b.h).toBeCloseTo(1 - 2 * fy, 5)
  })
})
