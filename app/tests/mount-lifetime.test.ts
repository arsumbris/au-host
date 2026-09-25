// @vitest-environment happy-dom
//
// What a view opens through its own host is closed by the host when the view's mount ends: a context
// menu, a popover (owner-close path: no dismiss, teardown runs), a claimed layer, a pending confirm or
// chooser (answered as a cancel), and a preview card it left up. Opening after the end opens nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContextMenuSurface } from '../src/renderer/src/projections/context-menu-surface.ts'
import { createOverlaySite } from '../src/renderer/src/projections/overlay-site.ts'
import { createPopoverSurface } from '../src/renderer/src/projections/popover-surface.ts'
import { getConfirmSurface } from '../src/renderer/src/projections/confirm-surface.ts'
import {
  createMountLifetime,
  scopeChooser,
  scopeConfirm,
  scopeContextMenu,
  scopeOverlaySite,
  scopePopover,
  scopePreview,
  type MountLifetime,
} from '../src/renderer/src/projections/mount-lifetime.ts'
import type { ChooseRequest, ChooserSurface, FillTeardown, OverlaySite, PreviewSurface } from '@arsumbris/au-host-sdk'

let site: OverlaySite
let life: MountLifetime

beforeEach(() => {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  document.body.appendChild(root)
  site = createOverlaySite(root)
  life = createMountLifetime()
})

const menus = (): number => document.querySelectorAll('.au-ctxmenu').length

describe('mount-scoped overlays', () => {
  it('closes a context menu the view left open', () => {
    const menu = scopeContextMenu(life, createContextMenuSurface(site))
    menu.open({ x: 5, y: 5 }, [{ id: 'a', label: 'A', run: () => {} }])
    expect(menus()).toBe(1)
    life.end()
    expect(menus()).toBe(0)
  })

  it('closes a popover by the owner path: no dismiss, the fill teardown runs', () => {
    const popover = scopePopover(life, createPopoverSurface(site))
    const onDismiss = vi.fn()
    const teardown = vi.fn<FillTeardown>()
    popover.open(new DOMRect(0, 0, 10, 10), () => teardown, onDismiss)
    life.end()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('releases a claimed layer', () => {
    const layer = scopeOverlaySite(life, site).claim({ level: 'dropdown' })
    expect(layer.el.isConnected).toBe(true)
    life.end()
    expect(layer.el.isConnected).toBe(false)
  })

  it('withdraws a pending confirm as a cancel and removes the dialog', async () => {
    const confirm = scopeConfirm(life, getConfirmSurface())
    const pending = confirm.confirm({ title: 'Delete', message: 'Sure?', confirmLabel: 'Delete' })
    expect(document.querySelectorAll('.au-confirm-backdrop').length).toBe(1)
    life.end()
    await expect(pending).resolves.toEqual({ confirmed: false })
    expect(document.querySelectorAll('.au-confirm-backdrop').length).toBe(0)
  })

  it('withdraws a pending chooser as a cancel', async () => {
    const inner: ChooserSurface = {
      choose: (req: ChooseRequest) =>
        new Promise((resolve) => req.signal?.addEventListener('abort', () => resolve(null))),
    }
    const pending = scopeChooser(life, inner).choose({ options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })
    life.end()
    await expect(pending).resolves.toBeNull()
  })

  it("hides the view's own preview card, never another view's", () => {
    let showing: string | null = null
    const inner: PreviewSurface = {
      show: (key) => void (showing = key),
      hide: vi.fn(() => void (showing = null)),
      isOver: () => false,
      isShowing: (key) => showing === key,
    }
    const mine = scopePreview(life, inner)
    mine.show('mine', new DOMRect(), () => {})
    inner.show('theirs', new DOMRect(), () => {}) // another view took the stack over
    life.end()
    expect(inner.hide).not.toHaveBeenCalled()

    const life2 = createMountLifetime()
    scopePreview(life2, inner).show('mine-2', new DOMRect(), () => {})
    life2.end()
    expect(inner.hide).toHaveBeenCalledTimes(1)
  })

  it('opens nothing after the mount ended', async () => {
    life.end()
    scopeContextMenu(life, createContextMenuSurface(site)).open({ x: 5, y: 5 }, [{ id: 'a', label: 'A', run: () => {} }])
    expect(menus()).toBe(0)
    const fill = vi.fn()
    scopePopover(life, createPopoverSurface(site)).open(new DOMRect(), fill)
    expect(fill).not.toHaveBeenCalled()
    expect(scopeOverlaySite(life, site).claim().el.isConnected).toBe(false)
    await expect(scopeConfirm(life, getConfirmSurface()).confirm({ title: 't', message: 'm', confirmLabel: 'ok' })).resolves.toEqual({ confirmed: false })
  })

  it('a handle the owner closed is not closed again at the end', () => {
    const inner = createContextMenuSurface(site)
    const close = vi.fn()
    const spy = { open: (...a: Parameters<typeof inner.open>) => ({ ...inner.open(...a), close }) }
    const handle = scopeContextMenu(life, spy).open({ x: 1, y: 1 }, [{ id: 'a', label: 'A', run: () => {} }])
    handle.close()
    life.end()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
