// The renderer view-store is a synchronous cache over main's state. A pane moved into an already-open
// window can carry newer state than that window's hydration snapshot. The slot's first get refreshes
// the node from main. Write a value after hydration, then create a slot and assert it reads that value.
//
// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createViewStore, hydrate, getView } from '../src/renderer/src/projections/view-store.ts'

// A stand-in for the MAIN-owned store (`window.main.viewState`): comp -> node -> sub -> value, with the
// same synchronous read/write semantics main has (a `set` updates its memory at once; `load`/`loadNode`
// return that live memory).
type Store = Record<string, Record<string, Record<string, unknown>>>
let main: Store
let loadNodeCalls: number

beforeEach(() => {
  main = {}
  loadNodeCalls = 0
  ;(window as unknown as { main: unknown }).main = {
    viewState: {
      load: (comp: string) => structuredClone(main[comp] ?? {}),
      loadNode: (comp: string, node: string) => {
        loadNodeCalls++
        return structuredClone(main[comp]?.[node] ?? {})
      },
      set: (comp: string, node: string, sub: string, value: unknown) => {
        ;(((main[comp] ??= {})[node] ??= {}))[sub] = value
      },
      prune: vi.fn(),
      drop: vi.fn(),
    },
  }
})

describe('a slot refreshes its node from main on first get (defeats a stale boot cache)', () => {
  it('reads a value that reached main AFTER this renderer hydrated the composition', () => {
    // A UNIQUE comp per test — the module cache is a singleton across the file.
    const comp = 'c-move'
    hydrate(comp) // boot warm: the renderer snapshots an EMPTY composition.
    // Another window then writes the pane's state to main (a fold made over there). The local cache is stale.
    main[comp] = { pane1: { 'file.md': { cursor: 42 } } }
    // The pane moves in; its slot is created and restored. First get must pull main's truth, not the stale cache.
    const slot = createViewStore(() => comp, 'pane1')
    expect(slot.get('file.md')).toEqual({ cursor: 42 })
  })

  it('refreshes the node exactly once, then serves subsequent reads from the (now-fresh) cache', () => {
    const comp = 'c-once'
    hydrate(comp)
    main[comp] = { pane1: { a: 1, b: 2 } }
    const slot = createViewStore(() => comp, 'pane1')
    expect(slot.get('a')).toBe(1)
    expect(slot.get('b')).toBe(2) // same slot, second subkey — no second main round-trip.
    expect(loadNodeCalls).toBe(1)
  })

  it('a set writes through to main AND the local cache (a subsequent get is current)', () => {
    const comp = 'c-set'
    hydrate(comp)
    const slot = createViewStore(() => comp, 'pane1')
    slot.get() // arm the slot (first-get refresh)
    slot.set({ cursor: 7 }, 'file.md')
    expect(main[comp]?.pane1?.['file.md']).toEqual({ cursor: 7 }) // reached main
    expect(getView(comp, 'pane1', 'file.md')).toEqual({ cursor: 7 }) // and the cache
  })

  it('an id-less slot (the composition root) is an inert no-op', () => {
    const slot = createViewStore(() => 'c-root', '')
    expect(slot.get()).toBeUndefined()
    slot.set({ x: 1 })
    expect(loadNodeCalls).toBe(0)
  })
})
