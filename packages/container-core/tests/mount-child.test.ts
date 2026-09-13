// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { mountChild } from '../src/mount-child.ts'
import { COMPOSITION_PLACEHOLDER_TYPE, type MountHost } from '@arsumbris/au-host-sdk'

// PUTTING A CHILD IN A SLOT, WITHOUT REACT.
//
// The property that matters and fails invisibly is the ASYNC RACE. `host.children.mount` is a
// promise, so a slot can be torn down before it resolves. If `unmount()` then fails to unmount the
// child that is about to arrive, the projection stays LIVE with no slot: a leaked pane, and for a
// terminal a leaked pty that nothing can reap. Nothing surfaces that — the UI just looks fine.

const slot = (): HTMLElement => document.createElement('div')

/** A host whose mount resolves only when the test says so. */
function deferredHost(): { host: MountHost; resolve: () => void; unmounted: () => number } {
  let release!: (h: unknown) => void
  let unmountCalls = 0
  const promise = new Promise<unknown>((r) => { release = r })
  const host = {
    children: { mount: () => promise },
  } as unknown as MountHost
  return {
    host,
    resolve: () => release({ unmount: () => { unmountCalls++ }, publisher: 'pub-1' }),
    unmounted: () => unmountCalls,
  }
}

describe('mountChild', () => {
  it('mounts and reports the publisher', async () => {
    const { host, resolve } = deferredHost()
    const onMounted = vi.fn()
    mountChild(host, slot(), { id: 'editor-pane', onMounted })
    resolve()
    await Promise.resolve()
    expect(onMounted).toHaveBeenCalledWith('pub-1')
  })

  it('unmounts a child that arrives AFTER teardown', async () => {
    // The leak. Tear down first, let the mount resolve second.
    const { host, resolve, unmounted } = deferredHost()
    const m = mountChild(host, slot(), { id: 'terminal' })
    m.unmount()
    resolve()
    await Promise.resolve()
    expect(unmounted()).toBe(1)
  })

  it('does not report a publisher for a child torn down before it resolved', async () => {
    const { host, resolve } = deferredHost()
    const onMounted = vi.fn()
    const m = mountChild(host, slot(), { id: 'terminal', onMounted })
    m.unmount()
    resolve()
    await Promise.resolve()
    expect(onMounted).not.toHaveBeenCalled()
  })

  it('renders a placeholder on failure rather than leaving a dead layout', async () => {
    const host = { children: { mount: () => Promise.reject(new Error('no such projection')) } } as unknown as MountHost
    const s = slot()
    mountChild(host, s, { id: 'ghost' })
    await Promise.resolve(); await Promise.resolve()
    expect(s.children.length).toBe(1)
  })

  it('lets the caller render its own failure', async () => {
    const host = { children: { mount: () => Promise.reject(new Error('boom')) } } as unknown as MountHost
    const renderError = vi.fn()
    mountChild(host, slot(), { id: 'ghost', renderError })
    await Promise.resolve(); await Promise.resolve()
    expect(renderError).toHaveBeenCalledWith(expect.anything(), 'boom')
  })

  it('clears the slot and is idempotent', async () => {
    const { host, resolve } = deferredHost()
    const s = slot()
    const m = mountChild(host, s, { id: 'x' })
    resolve()
    await Promise.resolve()
    s.firstElementChild!.appendChild(document.createElement('span'))
    m.unmount()
    expect(s.children.length).toBe(0)
    expect(() => m.unmount()).not.toThrow()
  })

  it('passes the stable paneId through as `nodeId` for per-pane view-state', () => {
    const mount = vi.fn(() => new Promise(() => {}))
    const host = { children: { mount } } as unknown as MountHost
    mountChild(host, slot(), { id: 'editor-pane', paneId: 'leaf-7' })
    expect(mount).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nodeId: 'leaf-7' }))
  })

  it('renders the diagnostic pane for a DUPLICATE placeholder and mounts NOTHING', () => {
    const mount = vi.fn(() => new Promise(() => {}))
    const host = { children: { mount } } as unknown as MountHost
    const s = slot()
    const config = { type: COMPOSITION_PLACEHOLDER_TYPE, kind: 'duplicate', collidedId: 'dup' }
    const m = mountChild(host, s, { id: COMPOSITION_PLACEHOLDER_TYPE, config })
    expect(mount).not.toHaveBeenCalled() // a placeholder is not a projection: it never mounts
    expect(s.children.length).toBe(1) // the diagnostic pane is appended
    expect(() => m.unmount()).not.toThrow()
  })
})
