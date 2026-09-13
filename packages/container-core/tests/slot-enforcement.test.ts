// Exercise slot enforcement through routeDrop, including the mutating seams it dispatches.
// A refused gesture must never extract an occupant or call another mutating method. Assert call
// counts as well as the final model so a refused drop cannot silently destroy state.
//
// Fixtures implement ContainerPlacement with plain objects and stub querySelector to find the
// registered target. They test router decisions, not browser geometry, hit testing or gestures.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deregisterContainer, registerContainer, routeDrop } from '../src/registry.ts'
import { dragStartRefused, setSlotTypeProvider } from '../src/slots.ts'
import { setGroupingProvider } from '../src/grouping.ts'
import { setHostDiagnosticSink } from '@arsumbris/au-host-sdk'
import type { ContainerPlacement, ContainerSlot, DragSource, DropTarget } from '@arsumbris/au-host-sdk'

// --------------------------------------------------------------------- harness

type FakeContainer = ContainerPlacement & {
  el: Element
  calls: { extract: string[]; inject: string[]; moveWithin: string[]; setSlotContent: string[] }
}

/** A container holding `panes`, whose slots answer from `slots` (by id). */
function container(panes: string[], slots: Record<string, ContainerSlot> = {}): FakeContainer {
  const held = [...panes]
  const calls = { extract: [] as string[], inject: [] as string[], moveWithin: [] as string[], setSlotContent: [] as string[] }
  // `contains` defaults to FALSE (no nesting) — the self-referential-wrap guard reads it. A test that
  // needs the nested case overrides `c.el.contains` to report a descendant.
  const el = { parentElement: null, contains: () => false } as unknown as Element
  const c = {
    el,
    calls,
    panes: () => [...held],
    findPane: (id: string) => (held.includes(id) ? { id, type: 'x' } : null),
    activate: () => {},
    getSlotContent: () => null,
    setSlotContent: (slotId: string) => { calls.setSlotContent.push(slotId) },
    moveWithin: (localId: string) => { calls.moveWithin.push(localId); return true },
    extract: (localId: string) => {
      const at = held.indexOf(localId)
      if (at < 0) return null
      held.splice(at, 1)
      calls.extract.push(localId)
      return { instance: { type: 'editor-pane' }, id: localId }
    },
    inject: (_i: unknown, id: string) => { calls.inject.push(id) },
    slotFor: (id: string) => slots[id] ?? null,
  } as unknown as FakeContainer
  return c
}

const registered: Element[] = []
function mount(c: FakeContainer): FakeContainer {
  registerContainer(c.el, c)
  registered.push(c.el)
  return c
}

/** Resolve a drop target to a registered element, standing in for the DOM lookup the router does. */
let targetElement: Element | null = null

const source = (localId: string, type?: string): DragSource =>
  ({ containerKind: 'k', localId, role: 'pane', label: localId, ...(type ? { type } : {}) }) as DragSource

const slotRect = (slotId: string, zone: DropTarget extends { zone: infer Z } ? Z : never, kind = 'k'): DropTarget =>
  ({ shape: 'slot-rect', containerKind: kind, slotId, zone }) as DropTarget

const gap = (slotId: string, index = 0, kind = 'k'): DropTarget =>
  ({ shape: 'gap', containerKind: kind, slotId, index }) as DropTarget

beforeEach(() => {
  vi.stubGlobal('document', { querySelector: () => targetElement })
  // `admits` is answered BY CLOSURE through the host-installed predicate. Installing a real one
  // rather than leaving it absent matters: absent means "unevaluable", which deliberately ALLOWS.
  setSlotTypeProvider({ isA: (c, a) => c === a || (c === 'editor-pane' && a === 'pane-projection') })
})

afterEach(() => {
  for (const el of registered.splice(0)) deregisterContainer(el)
  setSlotTypeProvider(null)
  setGroupingProvider(null)
  targetElement = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const FIXED: ContainerSlot = { type: 'container-slot', fixed: true }
const EDITORS_ONLY: ContainerSlot = { type: 'container-slot', admits: ['[[editor-pane::editor]]'] as ContainerSlot['admits'] }

// --------------------------------------------------------------------- the five seams

describe('SEAM 1 — drag start', () => {
  it('refuses a drag out of a fixed slot', () => {
    const c = mount(container(['a'], { a: FIXED }))
    expect(dragStartRefused(c.el, 'a')).toBe(true)
  })

  it('permits a drag out of a free slot, and out of one with no slot at all', () => {
    // Both halves matter: a check that refused everything would pass the test above.
    const c = mount(container(['a', 'b'], { a: EDITORS_ONLY }))
    expect(dragStartRefused(c.el, 'a')).toBe(false)
    expect(dragStartRefused(c.el, 'b')).toBe(false)
  })

  it('leaves a container with no `slotFor` entirely unenforced, which is correct', () => {
    const bare = { panes: () => ['a'], findPane: () => null, activate: () => {}, getSlotContent: () => null,
      setSlotContent: () => {}, moveWithin: () => true, extract: () => null, inject: () => {} } as unknown as ContainerPlacement
    const el = { parentElement: null } as unknown as Element
    registerContainer(el, bare); registered.push(el)
    expect(dragStartRefused(el, 'a')).toBe(false)
  })
})

describe('SEAM 2 — reorder in place', () => {
  // This path calls `moveWithin` and NEVER extracts, so a check placed only before the extract
  // would miss reordering entirely. A fixed occupant does not move inside its own container either.
  it('refuses a reorder of a fixed occupant', () => {
    const c = mount(container(['a', 'b'], { a: FIXED }))
    targetElement = c.el
    routeDrop(source('a'), gap('g', 1), { sourceEl: c.el })
    expect(c.calls.moveWithin).toEqual([])
  })

  it('permits a reorder of a free occupant', () => {
    const c = mount(container(['a', 'b'], { a: FIXED }))
    targetElement = c.el
    routeDrop(source('b'), gap('g', 0), { sourceEl: c.el })
    expect(c.calls.moveWithin).toEqual(['b'])
  })

  it('reports container-reorder-refused when moveWithin returns false, and stays silent when it returns true', () => {
    // The container's OWN structural refusal (not slot fixity, which is gated before moveWithin and
    // tested above). A `false` return is otherwise invisible: the router just returns. This report
    // is what makes it observable for every container, incl. a third-party one.
    const codes: string[] = []
    setHostDiagnosticSink((d) => codes.push(d.code))
    try {
      const reordering = (move: () => boolean): FakeContainer => {
        const el = { parentElement: null } as unknown as Element
        // slotFor → null, so displacementRefused passes and moveWithin is actually reached.
        const c = { el, panes: () => ['a', 'b'], findPane: () => null, activate: () => {},
          getSlotContent: () => null, setSlotContent: () => {}, moveWithin: move,
          extract: () => null, inject: () => {}, slotFor: () => null } as unknown as FakeContainer
        return mount(c)
      }

      const refusing = reordering(() => false)
      targetElement = refusing.el
      routeDrop(source('b'), gap('g', 0), { sourceEl: refusing.el })
      expect(codes).toEqual(['container-reorder-refused'])

      // CONTROL: an accepted move is silent. Without it, a report fired unconditionally would pass above.
      codes.length = 0
      const accepting = reordering(() => true)
      targetElement = accepting.el
      routeDrop(source('b'), gap('g', 0), { sourceEl: accepting.el })
      expect(codes).toEqual([])
    } finally {
      setHostDiagnosticSink(null)
    }
  })
})

describe('SEAM 3 — cross-container move', () => {
  it('refuses to extract from a fixed SOURCE slot, and never calls extract', () => {
    const src = mount(container(['a'], { a: FIXED }))
    const tgt = mount(container([]))
    targetElement = tgt.el
    routeDrop(source('a', 'editor-pane'), gap('g'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual([])
    expect(tgt.calls.inject).toEqual([])
  })

  it('refuses when the TARGET slot does not admit the type — BEFORE the extract', () => {
    // The rule that costs a subtree when it is wrong. A refusal after the extract is a lost pane,
    // so the assertion is the extract COUNT, not the end state.
    const src = mount(container(['a']))
    const tgt = mount(container([], { s: EDITORS_ONLY }))
    targetElement = tgt.el
    routeDrop(source('a', 'terminal'), slotRect('s', 'left'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual([])
    expect(tgt.calls.inject).toEqual([])
  })

  it('permits the same move when the target admits the type', () => {
    const src = mount(container(['a']))
    const tgt = mount(container([], { s: EDITORS_ONLY }))
    targetElement = tgt.el
    routeDrop(source('a', 'editor-pane'), slotRect('s', 'left'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual(['a'])
    expect(tgt.calls.inject).toEqual(['a'])
  })

  it('admits BY CLOSURE — a subtype of an admitted base is accepted', () => {
    // A slot admitting a base type must accept its subtypes.
    const src = mount(container(['a']))
    const tgt = mount(container([], { s: { type: 'container-slot', admits: ['[[pane-projection::au-host-sdk]]'] } as ContainerSlot }))
    targetElement = tgt.el
    routeDrop(source('a', 'editor-pane'), slotRect('s', 'left'), { sourceEl: src.el })
    expect(tgt.calls.inject).toEqual(['a'])
  })

  it('refuses an occupant whose type is UNKNOWN at a slot that declares `admits`', () => {
    // A rule that cannot be evaluated must not silently pass. `DragSource.type` is
    // additive-optional, so an un-updated container omits it — and that must not become a bypass.
    const src = mount(container(['a']))
    const tgt = mount(container([], { s: EDITORS_ONLY }))
    targetElement = tgt.el
    routeDrop(source('a'), slotRect('s', 'left'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual([])
  })
})

describe('SEAM 4 — centre-wrap', () => {
  // A centre drop on a container that does not itself group writes a CONTAINER into the target
  // slot, so the target's `admits` answers the WRAPPER's type, not the dragged pane's.
  beforeEach(() => {
    setGroupingProvider({
      forKind: () => null,
      forNewGroup: () => ({ typeName: 'tabs', kind: 'tabs', build: () => ({ type: 'tabs' }) }),
      isGroupingKind: (k) => k === 'tabs',
      choose: () => ({ outcome: 'ok', capability: { typeName: 'tabs', kind: 'tabs', build: () => ({ type: 'tabs' }) } }),
    } as never)
  })

  it('refuses a wrap into a FIXED target, and never calls extract', () => {
    const src = mount(container(['a']))
    const tgt = mount(container(['t'], { s: FIXED }))
    tgt.getSlotContent = () => ({ type: 'editor-pane' })
    targetElement = tgt.el
    routeDrop(source('a', 'editor-pane'), slotRect('s', 'center'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual([])
    expect(tgt.calls.setSlotContent).toEqual([])
  })

  it('refuses a wrap the target does not ADMIT, even though it admits the dragged pane', () => {
    // The subtle one, and the reason the target check is not a single line: an occupied slot
    // receives a CONTAINER wrapping both, so a slot admitting only editors refuses the wrap while
    // happily admitting the editor being dropped.
    const src = mount(container(['a']))
    const tgt = mount(container(['t'], { s: EDITORS_ONLY }))
    tgt.getSlotContent = () => ({ type: 'editor-pane' })
    targetElement = tgt.el
    routeDrop(source('a', 'editor-pane'), slotRect('s', 'center'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual([])
  })

  it('an EMPTY target receives the dropped subtree, so it answers for the PANE type', () => {
    const src = mount(container(['a']))
    const tgt = mount(container([], { s: EDITORS_ONLY }))
    tgt.getSlotContent = () => null
    targetElement = tgt.el
    routeDrop(source('a', 'editor-pane'), slotRect('s', 'center'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual(['a'])
  })

  it('refuses a SELF-REFERENTIAL wrap: the drag source is nested INSIDE the target occupant, never extracting', () => {
    // The tab-into-its-own-ancestor bug. Dropping a pane on the CENTRE of a container that
    // (transitively) HOLDS that pane would wrap the occupant with a piece extracted from inside it —
    // a duplicate, or a whole-subtree re-mount that can crash a child. Refused, name-free, by DOM
    // containment (the general form of the guard `tabs` hand-rolls for its own body).
    const src = mount(container(['a'])) // the inner container holding the dragged pane
    const tgt = mount(container(['t']))
    tgt.getSlotContent = () => ({ type: 'tabs' }) // occupied → the wrap path
    // The source container sits INSIDE the target's occupant subtree.
    ;(tgt.el as unknown as { contains: (n: Element) => boolean }).contains = (n) => n === src.el
    targetElement = tgt.el
    const codes: string[] = []
    setHostDiagnosticSink((d) => codes.push(d.code))
    try {
      routeDrop(source('a', 'editor-pane'), slotRect('s', 'center'), { sourceEl: src.el })
    } finally {
      setHostDiagnosticSink(null)
    }
    expect(src.calls.extract).toEqual([]) // never destroyed
    expect(tgt.calls.setSlotContent).toEqual([]) // nothing wrapped
    expect(codes).toContain('wrap-source-nested-in-target')
  })

  it('CONTROL: a non-nested occupied wrap still proceeds — the guard is specific to the nested case', () => {
    const src = mount(container(['a']))
    const tgt = mount(container(['t']))
    tgt.getSlotContent = () => ({ type: 'editor-pane' }) // occupied, NON-nested (contains → false)
    targetElement = tgt.el
    routeDrop(source('a', 'editor-pane'), slotRect('s', 'center'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual(['a']) // extracted
    expect(tgt.calls.setSlotContent).toEqual(['s']) // wrapped into the slot
  })
})

describe('the guarantee, stated as one property', () => {
  it('NO refused gesture ever reaches a mutating call', () => {
    // The whole seam in one assertion. Every refusal path above, run together, must leave the
    // source untouched — because the cost of getting this wrong is not a failed gesture, it is a
    // pane that no longer exists.
    const src = mount(container(['fixedPane', 'freePane'], { fixedPane: FIXED }))
    const tgt = mount(container([], { picky: EDITORS_ONLY }))
    targetElement = tgt.el
    routeDrop(source('fixedPane', 'editor-pane'), slotRect('picky', 'left'), { sourceEl: src.el })
    routeDrop(source('freePane', 'terminal'), slotRect('picky', 'left'), { sourceEl: src.el })
    routeDrop(source('freePane'), slotRect('picky', 'left'), { sourceEl: src.el })
    expect(src.calls.extract).toEqual([])
    expect(src.panes()).toEqual(['fixedPane', 'freePane'])
    expect(tgt.calls.inject).toEqual([])
  })
})
