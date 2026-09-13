import { afterEach, describe, expect, it, vi } from 'vitest'

import { closePane, deregisterContainer, registerContainer } from '../src/registry.ts'
import { setSlotTypeProvider } from '../src/slots.ts'
import type { ContainerPlacement, ContainerSlot } from '@arsumbris/au-host-sdk'

// THE FLOOR UNDER EVERY CONTAINER'S OWN CLOSE AFFORDANCE.
//
// Rendering an ✕ is chrome, chrome belongs to the container, and containers are written in
// different frameworks — so the substrate can never draw the control. What it must guarantee is
// that a child is always removable by SOME means, so that a container which renders no close
// leaves things merely less convenient rather than permanently stuck.
//
// The properties worth pinning are the two that would fail QUIETLY: a close that silently does
// nothing, and a close that quietly bypasses fixity.

const el = (): Element => ({ parentElement: null }) as unknown as Element

function placementHolding(panes: string[], slot?: ContainerSlot): ContainerPlacement & { extracted: string[] } {
  const held = [...panes]
  const extracted: string[] = []
  return {
    extracted,
    panes: () => [...held],
    findPane: (id) => (held.includes(id) ? { id, type: 'x' } : null),
    activate: () => {},
    getSlotContent: () => null,
    setSlotContent: () => {},
    moveWithin: () => true,
    extract: (localId) => {
      const at = held.indexOf(localId)
      if (at < 0) return null
      held.splice(at, 1)
      extracted.push(localId)
      return { instance: {}, id: localId }
    },
    inject: () => {},
    ...(slot === undefined ? {} : { slotFor: () => slot }),
  } as ContainerPlacement & { extracted: string[] }
}

afterEach(() => {
  setSlotTypeProvider(null)
  vi.restoreAllMocks()
})

describe('closePane — the removability floor', () => {
  it('removes the pane from whatever holds it, with no cooperation from the container', () => {
    // The container declares nothing beyond the required seam: no `slotFor`, no close, no opt-in.
    // That is the whole point — a third-party container gets this without knowing it exists.
    const root = el()
    const p = placementHolding(['a', 'b'])
    registerContainer(root, p)
    try {
      expect(closePane('a')).toBe(true)
      expect(p.extracted).toEqual(['a'])
      expect(p.panes()).toEqual(['b'])
    } finally {
      deregisterContainer(root)
    }
  })

  it('the extracted subtree is DISCARDED — closing is not a move', () => {
    const root = el()
    const p = placementHolding(['a'])
    const inject = vi.spyOn(p, 'inject')
    registerContainer(root, p)
    try {
      closePane('a')
      expect(inject).not.toHaveBeenCalled()
    } finally {
      deregisterContainer(root)
    }
  })

  it('REFUSES a pane in a fixed slot, and does not extract it', () => {
    // A verb that could close what a drag may not remove would be a hole straight through fixity.
    // The refusal must happen BEFORE the extract, or the pane is gone either way.
    const root = el()
    const p = placementHolding(['a'], { type: 'container-slot', fixed: true } as ContainerSlot)
    registerContainer(root, p)
    try {
      expect(closePane('a')).toBe(false)
      expect(p.extracted).toEqual([])
      expect(p.panes()).toEqual(['a'])
    } finally {
      deregisterContainer(root)
    }
  })

  it('a slot with rules but no fixity still closes', () => {
    // `admits` governs what may OCCUPY a position, never whether its occupant may leave. Conflating
    // the two would make every constrained slot silently unclosable.
    const root = el()
    const p = placementHolding(['a'], { type: 'container-slot', admits: ['[[editor-pane]]'] } as unknown as ContainerSlot)
    registerContainer(root, p)
    try {
      expect(closePane('a')).toBe(true)
      expect(p.extracted).toEqual(['a'])
    } finally {
      deregisterContainer(root)
    }
  })

  it('declines for an id no container holds, rather than throwing', () => {
    expect(closePane('nobody')).toBe(false)
  })
})
