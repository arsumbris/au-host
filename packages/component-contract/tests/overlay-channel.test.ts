import { afterEach, describe, expect, it, vi } from 'vitest'

import { claimHostOverlay, publishHostOverlay, type OverlayLayer } from '../src/index.ts'

// The channel lives on a window-global (`__AU_HOST_OVERLAY__`); reset it between cases so one test's
// publish never leaks into the next.
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)['__AU_HOST_OVERLAY__']
})

function fakeLayer(): OverlayLayer {
  return { el: {} as HTMLElement, release: vi.fn() }
}

describe('component-overlay channel', () => {
  it('returns null when no host has published (render-resilience)', () => {
    expect(claimHostOverlay('overlay')).toBeNull()
  })

  it('routes a claim to the published host claim, passing the level through', () => {
    const layer = fakeLayer()
    const claim = vi.fn((_level: string) => layer)
    publishHostOverlay(claim)

    const got = claimHostOverlay('dropdown')

    expect(got).toBe(layer)
    expect(claim).toHaveBeenCalledWith('dropdown', undefined)
  })

  it('forwards the trigger so the host can nest the overlay above its parent surface', () => {
    const layer = fakeLayer()
    const trigger = {} as Element
    const claim = vi.fn((_level: string, _from?: Element | null) => layer)
    publishHostOverlay(claim)
    expect(claimHostOverlay('dropdown', trigger)).toBe(layer)
    expect(claim).toHaveBeenCalledWith('dropdown', trigger)
  })

  it('last publish wins (a re-published window keeps working)', () => {
    const first = fakeLayer()
    const second = fakeLayer()
    publishHostOverlay(() => first)
    publishHostOverlay(() => second)

    expect(claimHostOverlay('popover')).toBe(second)
  })
})
