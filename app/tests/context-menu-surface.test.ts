// @vitest-environment happy-dom
//
// The per-window context menu scopes each returned handle to its own opening, supports submenu
// traversal, and prevents disabled rows from executing. These tests cover behavior and DOM structure;
// visual placement and browser focus behavior require native verification.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContextMenuSurface } from '../src/renderer/src/projections/context-menu-surface.ts'
import { createOverlaySite } from '../src/renderer/src/projections/overlay-site.ts'
import type { ContextMenuItem, ContextMenuSurface } from '@arsumbris/au-host-sdk'

let surface: ContextMenuSurface

beforeEach(() => {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  surface = createContextMenuSurface(createOverlaySite(host))
})

// The surface renders the component elements: the menu is an `<au-menu>` (carrying the
// `.au-ctxmenu` position/size class), each row an `<au-menu-item>` whose `label` / `disabled` /
// `submenu` are ELEMENT PROPERTIES the surface sets (not text / dataset), and a row activates on the
// `au-activate` event the `<au-menu-item>` emits (not a raw click). The element is unregistered in
// happy-dom, so those properties read back as the plain expandos the surface wrote — which is exactly
// the surface behaviour this suite asserts, independent of the component set's own rendering.
type Row = HTMLElement & { label?: string; disabled?: boolean; submenu?: boolean }
const AT = { x: 10, y: 10 }
const menus = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.au-ctxmenu')]
const rowsOf = (menu: HTMLElement): Row[] => [...menu.querySelectorAll<Row>('au-menu-item')]
const labels = (menu: HTMLElement): string[] => rowsOf(menu).map((r) => r.label ?? r.textContent ?? '')
/** Fire a row the way `<au-menu-item>` does — the surface listens for `au-activate`, not `click`. */
const activate = (row: HTMLElement): void => {
  row.dispatchEvent(new CustomEvent('au-activate', { bubbles: true }))
}
const key = (k: string): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}

/** An enabled action row. */
const action = (id: string, run = (): void => {}): ContextMenuItem => ({ id, label: id, enabled: true, run })
/** Let the deferred pointerdown listener arm. Only that one listener is deferred; keys are live. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r))

describe('it draws into the overlay site, never document.body', () => {
  it('puts the menu inside a claimed layer at the dropdown band', () => {
    surface.open(AT, [action('a')])
    const layer = menus()[0]?.closest('.au-overlay-layer') as HTMLElement | null
    expect(layer).not.toBeNull()
    expect(layer?.dataset.level).toBe('dropdown')
  })

  it('is never a direct child of the body', () => {
    surface.open(AT, [action('a')])
    expect([...document.body.children].some((c) => c.classList.contains('au-ctxmenu'))).toBe(false)
  })
})

describe('the handle is scoped — the reason open() returns one', () => {
  it('closes the menu it opened', () => {
    const h = surface.open(AT, [action('a')])
    expect(menus()).toHaveLength(1)
    h.close()
    expect(menus()).toHaveLength(0)
  })

  it('goes INERT once superseded, so a stale handle cannot close its replacement', () => {
    // THE HAZARD. Two projections, each opening a menu. The first one's cleanup must not dismiss
    // the second one's menu. Each handle must close only the menu it created.
    const first = surface.open(AT, [action('a')])
    surface.open(AT, [action('b')])
    expect(labels(menus()[0]!)).toEqual(['b'])
    first.close()
    expect(menus()).toHaveLength(1)
    expect(labels(menus()[0]!)).toEqual(['b'])
  })

  it('is idempotent', () => {
    const h = surface.open(AT, [action('a')])
    h.close()
    expect(() => h.close()).not.toThrow()
    expect(menus()).toHaveLength(0)
  })

  it('opening supersedes the live menu rather than stacking a second root', () => {
    surface.open(AT, [action('a')])
    surface.open(AT, [action('b')])
    expect(menus()).toHaveLength(1)
  })
})

describe('rows', () => {
  it('renders in the caller’s array order — there is no group or order field', () => {
    // A thing does not declare where it sits relative to other things.
    surface.open(AT, [action('z'), action('m'), action('a')])
    expect(labels(menus()[0]!)).toEqual(['z', 'm', 'a'])
  })

  it('runs an enabled row and closes first', () => {
    // Closing BEFORE running matters: `run` may open a dialog, move focus, or unmount the
    // projection that opened the menu, and none of that should have to reason about a live menu.
    let openWhenRun: number | null = null
    surface.open(AT, [{ id: 'a', label: 'a', enabled: true, run: () => (openWhenRun = menus().length) }])
    activate(rowsOf(menus()[0]!)[0]!)
    expect(openWhenRun).toBe(0)
  })

  it('a DISABLED row cannot run, and carries its reason', () => {
    const run = vi.fn()
    surface.open(AT, [{ id: 'a', label: 'a', enabled: false, reason: 'nothing to open', run }])
    const row = rowsOf(menus()[0]!)[0]!
    activate(row)
    expect(run).not.toHaveBeenCalled()
    expect(row.disabled).toBe(true)
    expect(row.title).toBe('nothing to open')
  })

  it('renders separators and sections without making them activatable', () => {
    surface.open(AT, [{ section: 'Authoring' }, action('a'), { separator: true }, action('b')])
    const menu = menus()[0]!
    expect(menu.querySelectorAll('[data-section]')).toHaveLength(1)
    expect(menu.querySelectorAll('.au-ctxmenu__sep')).toHaveLength(1)
    expect(rowsOf(menu)).toHaveLength(2)
  })
})

describe('nesting — expressible from the first cut, and nothing in-tree consumes it yet', () => {
  const NESTED: ContextMenuItem[] = [
    action('open'),
    { id: 'new', label: 'New', enabled: true, items: [action('new.file'), action('new.folder')] },
  ]

  it('marks a submenu row and does not treat it as an action', () => {
    surface.open(AT, NESTED)
    const rows = rowsOf(menus()[0]!)
    expect(rows[1]!.submenu).toBe(true)
  })

  it('opens the child on ArrowRight and focuses its first row', () => {
    surface.open(AT, NESTED)
    key('ArrowDown')
    key('ArrowDown') // onto the submenu row
    key('ArrowRight')
    expect(menus()).toHaveLength(2)
    expect(labels(menus()[1]!)).toEqual(['new.file', 'new.folder'])
    expect((document.activeElement as HTMLElement).dataset.id).toBe('new.file')
  })

  it('ArrowLeft closes the child and returns focus to the parent row', () => {
    surface.open(AT, NESTED)
    key('ArrowDown')
    key('ArrowDown')
    key('ArrowRight')
    key('ArrowLeft')
    expect(menus()).toHaveLength(1)
    expect((document.activeElement as HTMLElement).dataset.id).toBe('new')
  })

  it('Escape closes ONE level, not the whole menu', () => {
    // The convention everywhere, and it means a deep traversal is recoverable without starting over.
    surface.open(AT, NESTED)
    key('ArrowDown')
    key('ArrowDown')
    key('ArrowRight')
    key('Escape')
    expect(menus()).toHaveLength(1)
    key('Escape')
    expect(menus()).toHaveLength(0)
  })

  it('running a nested action closes the WHOLE chain', () => {
    const run = vi.fn()
    surface.open(AT, [{ id: 'new', label: 'New', enabled: true, items: [{ id: 'f', label: 'f', enabled: true, run }] }])
    key('ArrowDown')
    key('ArrowRight')
    key('Enter')
    expect(run).toHaveBeenCalledOnce()
    expect(menus()).toHaveLength(0)
  })

  it('nests arbitrarily deep', () => {
    surface.open(AT, [
      { id: 'l1', label: 'l1', enabled: true, items: [{ id: 'l2', label: 'l2', enabled: true, items: [action('l3')] }] },
    ])
    key('ArrowDown')
    key('ArrowRight')
    key('ArrowRight')
    expect(menus()).toHaveLength(3)
    expect(labels(menus()[2]!)).toEqual(['l3'])
  })

  it('a DISABLED submenu does not open', () => {
    surface.open(AT, [{ id: 'new', label: 'New', enabled: false, reason: 'read-only', items: [action('f')] }])
    key('ArrowDown')
    key('ArrowRight')
    expect(menus()).toHaveLength(1)
  })
})

describe('the roving keyboard model', () => {
  it('wraps at both ends and skips disabled rows', () => {
    surface.open(AT, [action('a'), { id: 'x', label: 'x', enabled: false, reason: 'no', run: () => {} }, action('b')])
    key('ArrowDown')
    expect((document.activeElement as HTMLElement).dataset.id).toBe('a')
    key('ArrowDown')
    expect((document.activeElement as HTMLElement).dataset.id).toBe('b')
    key('ArrowDown')
    expect((document.activeElement as HTMLElement).dataset.id).toBe('a')
    key('ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.id).toBe('b')
  })
})

describe('dismissal', () => {
  it('survives the opening right-click’s OWN pointerdown', async () => {
    // The one-tick guard. Without it a right-click opens the menu and the same gesture's pointerdown
    // dismisses it, so the menu never appears.
    surface.open(AT, [action('a')])
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(menus()).toHaveLength(1)
    await tick()
  })

  it('closes on a pointerdown outside once armed, but not on one inside', async () => {
    surface.open(AT, [action('a')])
    await tick()
    menus()[0]!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(menus()).toHaveLength(1)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(menus()).toHaveLength(0)
  })

  it('closes on window blur', () => {
    surface.open(AT, [action('a')])
    window.dispatchEvent(new Event('blur'))
    expect(menus()).toHaveLength(0)
  })
})

describe('dismissal notification', () => {
  it('settles a replaced handle without letting its cleanup close the new menu', async () => {
    const first = surface.open(AT, [action('first')])
    let firstClosed = false
    void first.closed?.then(() => { firstClosed = true })
    await Promise.resolve()
    expect(firstClosed).toBe(false)
    const second = surface.open(AT, [action('second')])
    expect(first.closed).toBeInstanceOf(Promise)
    await first.closed
    expect(firstClosed).toBe(true)
    first.close()
    expect(labels(menus()[0]!)).toEqual(['second'])
    second.close()
    await second.closed
    expect(menus()).toHaveLength(0)
  })

  it.each(['escape', 'outside', 'selection', 'blur', 'resize'] as const)('notifies after %s dismissal', async (way) => {
    const handle = surface.open(AT, [action('run')])
    expect(handle.closed).toBeInstanceOf(Promise)
    if (way === 'escape') key('Escape')
    if (way === 'outside') {
      await tick()
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    }
    if (way === 'selection') activate(rowsOf(menus()[0]!)[0]!)
    if (way === 'blur') window.dispatchEvent(new Event('blur'))
    if (way === 'resize') window.dispatchEvent(new Event('resize'))
    await handle.closed
    expect(menus()).toHaveLength(0)
  })
})

it('refits after asynchronous row sizing and disconnects the observer on close', () => {
  let resized: (() => void) | undefined
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe() {}
    disconnect = disconnect
  })
  const handle = surface.open({x: 20, y: window.innerHeight - 10}, [action('a')])
  try {
    const menu = menus()[0]!
    Object.defineProperty(menu, 'offsetHeight', {configurable: true, value: 240})
    resized?.()
    expect(parseFloat(menu.style.top) + menu.offsetHeight).toBeLessThanOrEqual(window.innerHeight - 4)
    handle.close()
    expect(disconnect).toHaveBeenCalledOnce()
  } finally {
    handle.close()
    vi.unstubAllGlobals()
  }
})
