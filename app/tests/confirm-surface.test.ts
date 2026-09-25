// @vitest-environment happy-dom
//
// The confirm dialog's blast-radius rows are set elements. When any row has context, every row is an
// expanding <au-accordion-item> (one rhythm; a row whose line was unreadable says so); with no context,
// plain <au-list-row>s. Enter on a row belongs to the row, never to the destructive confirm.

import { beforeEach, describe, expect, it } from 'vitest'

import { createConfirmSurface } from '../src/renderer/src/projections/confirm-surface.ts'
import type { ConfirmOutcome, ConfirmSurface } from '@arsumbris/au-host-sdk'

let surface: ConfirmSurface

beforeEach(() => {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  document.body.appendChild(root)
  surface = createConfirmSurface(root)
})

const enter = (from: Element): void => {
  from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }))
}
const settled = async <T>(p: Promise<T>): Promise<T | 'pending'> => Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), 20))])

describe('blast-radius rows', () => {
  it('makes every row an expanding item when any row has context', () => {
    void surface.confirm({
      title: 'Move file', message: 'm', confirmLabel: 'Move',
      affectedDetail: [
        { path: '/v/a.md', form: 'path', line: 12, contextStart: 11, context: ['before', 'the [[ref]] line'] },
        { path: '/v/b.md' },
      ],
    })
    const list = document.querySelector('.au-confirm-list')!
    expect(list.tagName).toBe('AU-ACCORDION')
    const items = list.querySelectorAll(':scope > au-accordion-item')
    expect(items).toHaveLength(2)

    const code = items[0]!.querySelector('au-code-block') as HTMLElement & { code: string; lineStart: number; markLine: number; copy: boolean }
    expect(code.code).toBe('before\nthe [[ref]] line')
    expect(code.lineStart).toBe(11)
    expect(code.markLine).toBe(12)
    expect(code.copy).toBe(false)
    expect(items[0]!.querySelector('au-badge[slot="meta"]')?.textContent).toBe('by path')

    expect(items[1]!.textContent).toContain('could not be read')
    expect(document.querySelector('.au-confirm-hint')?.textContent).toBe('Open a file to see the referencing line')
    expect(document.querySelector('.au-confirm-card')!.hasAttribute('data-wide')).toBe(true)
  })

  it('lists plain rows when no row has context', () => {
    void surface.confirm({ title: 'Rename file', message: 'm', confirmLabel: 'Rename', affected: ['/v/a.md', '/v/b.md'] })
    const list = document.querySelector('.au-confirm-list')!
    expect(list.tagName).toBe('DIV')
    expect(list.querySelectorAll('au-list-row')).toHaveLength(2)
    expect(document.querySelector('au-accordion')).toBeNull()
    expect(document.querySelector('.au-confirm-hint')).toBeNull()
    expect(document.querySelector('.au-confirm-card')!.hasAttribute('data-wide')).toBe(false)
  })
})

describe('Enter', () => {
  it('on a row belongs to the row and never confirms', async () => {
    const out = surface.confirm({
      title: 'Move file', message: 'm', confirmLabel: 'Move', danger: true,
      affectedDetail: [{ path: '/v/a.md', line: 1, contextStart: 1, context: ['x'] }],
    })
    enter(document.querySelector('au-accordion-item')!)
    expect(await settled(out)).toBe('pending')
  })

  it('anywhere else confirms', async () => {
    const out = surface.confirm({ title: 'Delete', message: 'm', confirmLabel: 'Delete', affected: ['/v/a.md'] })
    enter(document.querySelector('.au-confirm-msg')!)
    expect(await settled(out)).toEqual({ confirmed: true, value: undefined } satisfies ConfirmOutcome)
  })
})
