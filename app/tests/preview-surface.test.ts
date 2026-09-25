// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPreviewSurface } from '../src/renderer/src/projections/preview-surface'

const rect = (x: number, y: number): DOMRect => new DOMRect(x, y, 100, 20)
const fill = (el: HTMLElement): void => { el.textContent = 'preview' }

describe('preview surface dismissal', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { getPreviewSurface().hide(); vi.useRealTimers() })

  it('a card shown after the pointer left the previous one is not closed by the stale dismissal', () => {
    const surface = getPreviewSurface()
    surface.show('a', rect(0, 0), fill)
    expect(surface.isShowing('a')).toBe(true)

    // The pointer leaves every cone: a whole-stack dismissal is armed for the grace period.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5000, clientY: 5000 }))
    // Before it fires, the pointer reaches another source and its card opens.
    surface.show('b', rect(0, 400), fill)
    vi.advanceTimersByTime(1000)

    expect(surface.isShowing('b')).toBe(true)
  })

  it('leaving every cone still dismisses the stack after the grace period', () => {
    const surface = getPreviewSurface()
    surface.show('a', rect(0, 0), fill)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5000, clientY: 5000 }))
    vi.advanceTimersByTime(1000)
    expect(surface.isShowing('a')).toBe(false)
  })
})
