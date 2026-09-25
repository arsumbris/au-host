import { afterEach, describe, expect, it } from 'vitest'

import type { DragSource } from '@arsumbris/au-host-sdk'
import { resolveTargetsAll } from '../src/hit-test.ts'
import { registerDropTarget } from '../src/registry.ts'
import { dragStore } from '../src/singletons.ts'
import type { ContentDropVerdict } from '../src/types.ts'

// A content destination's verdict drives the deepest-first walk: `accept` is offered, `pass` lets the walk
// go on outward, `refuse` ends it, offering nothing further out. Nested folder rows are the case: a folder dragged
// over its own subtree must not fall through to an ancestor that would accept the move.

// Fake elements with only the `parentElement` chain the walk follows, and a fake document for the point.
const el = (parent: Element | null = null): Element => ({ parentElement: parent }) as unknown as Element
const doc = (under: Element): Document => ({ elementFromPoint: () => under, querySelector: () => null }) as unknown as Document
const source: DragSource = { containerKind: 'content', localId: 'row', role: 'pane', label: 'src' }

const detach: (() => void)[] = []
const target = (element: Element, verdict: ContentDropVerdict): Element => {
  detach.push(registerDropTarget(element, { consider: () => verdict, onDrop: () => {} }))
  return element
}

afterEach(() => {
  dragStore.getState().cancel()
  for (const d of detach.splice(0)) d()
})

describe('content-drop verdicts', () => {
  const walk = (under: Element) => {
    dragStore.getState().start(source, { x: 0, y: 0 }, null, { type: 'folder-selection', path: '/ws/src' })
    return resolveTargetsAll(0, 0, source, doc(under)).map((hit) => ('el' in hit ? hit.el : null))
  }

  it('offers the deepest accepting destination', () => {
    const outer = target(el(), 'accept')
    const inner = target(el(outer), 'accept')
    expect(walk(inner)[0]).toBe(inner)
  })

  it('walks past a destination that passes', () => {
    const outer = target(el(), 'accept')
    const inner = target(el(outer), 'pass')
    expect(walk(inner)).toEqual([outer])
  })

  it('offers nothing once a destination refuses, not even an accepting ancestor', () => {
    const outer = target(el(), 'accept')
    const inner = target(el(outer), 'refuse')
    expect(walk(el(inner))).toEqual([])
  })

  it('keeps what a deeper destination accepted when an ancestor refuses', () => {
    // A file in a member's root, dragged onto a subfolder: the folder row accepts, the member group
    // around it refuses (the file is already there). The folder's accept must stand.
    const outer = target(el(), 'refuse')
    const inner = target(el(outer), 'accept')
    expect(walk(inner)).toEqual([inner])
  })
})
