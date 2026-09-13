import { afterEach, describe, expect, it } from 'vitest'

import type { ContainerPlacement, DragSource } from '@arsumbris/au-host-sdk'
import { deregisterContainer, registerContainer } from '../src/registry.ts'
import { dragSourceIsFrom, dragStore } from '../src/singletons.ts'

// dragSourceIsFrom uses container identity to distinguish an in-place reorder from a cross-container
// drop. Verify that nested containers of the same kind remain distinct, matching router behavior.

// A fake element with a `parentElement` chain — the only DOM `findContainerRoot` walks. No document.
const el = (parent: Element | null = null): Element => ({ parentElement: parent }) as unknown as Element

const placement = (): ContainerPlacement =>
  ({
    panes: () => [],
    findPane: () => null,
    activate: () => {},
    getSlotContent: () => null,
    setSlotContent: () => {},
    moveWithin: () => true,
    extract: () => null,
    inject: () => {},
  }) as unknown as ContainerPlacement

const source = (): DragSource => ({ containerKind: 'k', localId: 'p', role: 'pane', label: 'p' })

const roots: Element[] = []
const register = (r: Element): Element => {
  registerContainer(r, placement())
  roots.push(r)
  return r
}

afterEach(() => {
  dragStore.getState().cancel()
  for (const r of roots.splice(0)) deregisterContainer(r)
})

describe('dragSourceIsFrom', () => {
  it('is false with no drag in flight', () => {
    const root = register(el())
    expect(dragSourceIsFrom(root)).toBe(false)
  })

  it('is true for the container the drag started in, false for a sibling', () => {
    const rootA = register(el())
    const rootB = register(el())
    const child = el(rootA) // a leaf whose nearest registered ancestor is rootA
    dragStore.getState().start(source(), { x: 0, y: 0 }, child)

    expect(dragSourceIsFrom(rootA)).toBe(true)
    expect(dragSourceIsFrom(rootB)).toBe(false)
  })

  it('distinguishes NESTED same-kind containers (the bento-in-bento case path equality could not)', () => {
    const outer = register(el())
    const inner = register(el(outer)) // inner nested INSIDE outer, both registered containers
    const leaf = el(inner) // a pane whose nearest registered ancestor is inner
    dragStore.getState().start(source(), { x: 0, y: 0 }, leaf)

    // findContainerRoot stops at the NEAREST registered ancestor, so a drag from inside `inner`
    // belongs to `inner` alone.
    expect(dragSourceIsFrom(inner)).toBe(true)
    expect(dragSourceIsFrom(outer)).toBe(false)
  })

  it('is false when the source element has no registered ancestor (detached mid-drag)', () => {
    const root = register(el())
    dragStore.getState().start(source(), { x: 0, y: 0 }, el()) // orphan, parentElement null

    expect(dragSourceIsFrom(root)).toBe(false)
  })
})
