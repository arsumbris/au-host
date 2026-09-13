// @vitest-environment happy-dom
// The native selection-drop bridge. A dropped wikilink uses native HTML5 drag data;
// verify selection decoding, target highlighting and delivery to the host opener.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dragStore } from '@arsumbris/container-core'
import { installSelectionDrop, SELECTION_DRAG_MIME } from '../src/selection-drop'

/** A synthetic drag event carrying (optionally) the selection MIME. `MouseEvent` gives real
 *  `clientX/clientY` + `preventDefault`; `dataTransfer` is a faithful-enough stand-in for what the
 *  bridge reads (`types`, `getData`, `dropEffect`). */
function dragEvent(type: string, opts: { mime?: string; json?: string; clientX?: number; clientY?: number } = {}): Event {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: opts.clientX ?? 0, clientY: opts.clientY ?? 0 })
  const dt = {
    types: opts.mime ? [opts.mime] : [],
    getData: (m: string) => (opts.mime && m === opts.mime ? (opts.json ?? '') : ''),
    dropEffect: 'none',
  }
  Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true })
  return ev
}

const LINK = JSON.stringify({ type: 'link-selection', target: 'SomeNote' })

let root: HTMLElement
let detach: () => void
let dropped: { selection: unknown; point: { clientX: number; clientY: number } }[]

beforeEach(() => {
  // `resolveTargetsAll` (called in dragover) walks from `elementFromPoint`; with no registered
  // dialects it returns [] regardless, so a null point keeps it a no-op in the fake DOM.
  document.elementFromPoint = () => null
  document.body.innerHTML = ''
  root = document.createElement('div')
  document.body.appendChild(root)
  dropped = []
  detach = installSelectionDrop(root, (selection, point) => dropped.push({ selection, point }))
})

afterEach(() => {
  detach()
  dragStore.getState().cancel() // clear any affordance a test left mid-drag
  vi.restoreAllMocks()
})

describe('installSelectionDrop — drop', () => {
  it('parses the MIME and hands the selection + point to the opener', () => {
    const ev = dragEvent('drop', { mime: SELECTION_DRAG_MIME, json: LINK, clientX: 12, clientY: 34 })
    root.dispatchEvent(ev)
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.selection).toEqual({ type: 'link-selection', target: 'SomeNote' })
    expect(dropped[0]!.point).toEqual({ clientX: 12, clientY: 34 })
    expect(ev.defaultPrevented).toBe(true) // the drop was accepted
  })

  it('IGNORES a drag that does not carry the selection MIME', () => {
    const ev = dragEvent('drop', { clientX: 5, clientY: 5 }) // e.g. a plain text/file drag
    root.dispatchEvent(ev)
    expect(dropped).toHaveLength(0)
    expect(ev.defaultPrevented).toBe(false) // never claimed
  })

  it('drops a MALFORMED payload silently — no throw, no opener call', () => {
    const ev = dragEvent('drop', { mime: SELECTION_DRAG_MIME, json: '{not json' })
    expect(() => root.dispatchEvent(ev)).not.toThrow()
    expect(dropped).toHaveLength(0)
  })
})

describe('installSelectionDrop — the drop-zone affordance', () => {
  it('dragover enables the drop and STARTS the shared drag store', () => {
    const ev = dragEvent('dragover', { mime: SELECTION_DRAG_MIME, clientX: 8, clientY: 8 })
    root.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect((ev as unknown as DragEvent).dataTransfer!.dropEffect).toBe('copy')
    expect(dragStore.getState().drag).not.toBeNull() // the band is being driven
  })

  it('a non-MIME dragover does NOT start the store or preventDefault', () => {
    const ev = dragEvent('dragover', { clientX: 8, clientY: 8 })
    root.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(dragStore.getState().drag).toBeNull()
  })

  it('CLEARS the affordance on drop, so the band never sticks', () => {
    root.dispatchEvent(dragEvent('dragover', { mime: SELECTION_DRAG_MIME }))
    expect(dragStore.getState().drag).not.toBeNull()
    root.dispatchEvent(dragEvent('drop', { mime: SELECTION_DRAG_MIME, json: LINK }))
    expect(dragStore.getState().drag).toBeNull()
  })

  it('CLEARS the affordance on dragend (a drag that ends without dropping on us)', () => {
    root.dispatchEvent(dragEvent('dragover', { mime: SELECTION_DRAG_MIME }))
    expect(dragStore.getState().drag).not.toBeNull()
    root.dispatchEvent(dragEvent('dragend', {}))
    expect(dragStore.getState().drag).toBeNull()
  })
})

describe('installSelectionDrop — detach', () => {
  it('stops listening after detach', () => {
    detach()
    root.dispatchEvent(dragEvent('drop', { mime: SELECTION_DRAG_MIME, json: LINK }))
    expect(dropped).toHaveLength(0)
  })
})
