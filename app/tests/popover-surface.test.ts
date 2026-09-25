// @vitest-environment happy-dom
//
// The popover surface tells its owner about a DISMISSAL (the surface closing the popover out from
// under it) and never about the owner's own close. The fill's teardown runs on every path, once the
// panel is removed, including a teardown an async fill resolves after the panel is already gone.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPopoverSurface } from '../src/renderer/src/projections/popover-surface.ts'
import { createOverlaySite } from '../src/renderer/src/projections/overlay-site.ts'
import type { FillTeardown, PopoverSurface } from '@arsumbris/au-host-sdk'

let surface: PopoverSurface
const AT = new DOMRect(10, 10, 20, 20)

beforeEach(() => {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  surface = createPopoverSurface(createOverlaySite(host))
})

const key = (k: string): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}
const panels = (): number => document.querySelectorAll('[style*="position:fixed"], [style*="position: fixed"]').length

describe('popover dismissal', () => {
  it('does not notify the owner of its own close', () => {
    const onDismiss = vi.fn()
    const handle = surface.open(AT, () => {}, onDismiss)
    handle.close()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(panels()).toBe(0)
  })

  it('notifies the owner when Escape dismisses it', () => {
    const onDismiss = vi.fn()
    surface.open(AT, () => {}, onDismiss)
    key('Escape')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('notifies the superseded owner when a newer popover replaces it', () => {
    const first = vi.fn()
    const second = vi.fn()
    surface.open(AT, () => {}, first)
    surface.open(AT, () => {}, second)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('an owner close from inside its own state reset never re-enters the dismiss', () => {
    const onDismiss = vi.fn()
    const handle = surface.open(AT, () => {}, onDismiss)
    handle.close()
    handle.close()
    key('Escape')
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('fill teardown', () => {
  it('runs on the owner close', () => {
    const teardown = vi.fn<FillTeardown>()
    surface.open(AT, () => teardown).close()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('runs on a dismissal', () => {
    const teardown = vi.fn<FillTeardown>()
    surface.open(AT, () => teardown)
    key('Escape')
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('runs once even when both paths fire', () => {
    const teardown = vi.fn<FillTeardown>()
    const handle = surface.open(AT, () => teardown)
    key('Escape')
    handle.close()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('runs at once when an async fill resolves its teardown after the panel is gone', async () => {
    const teardown = vi.fn<FillTeardown>()
    let resolve!: (t: FillTeardown) => void
    const pending = new Promise<FillTeardown>((r) => (resolve = r))
    surface.open(AT, () => pending).close()
    expect(teardown).not.toHaveBeenCalled()
    resolve(teardown)
    await pending
    await Promise.resolve()
    expect(teardown).toHaveBeenCalledTimes(1)
  })
})
