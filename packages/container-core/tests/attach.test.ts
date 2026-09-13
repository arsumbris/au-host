import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { attachContainer } from '../src/attach.ts'
import { deregisterContainer, findPlacementByPane } from '../src/registry.ts'
import type { ContainerPlacement } from '@arsumbris/au-host-sdk'

// THE FRAMEWORK-FREE DECLARATION PATH.
//
// This path lets a vanilla container declare itself identically to one using a React hook.
// The properties worth pinning are the ones that would fail INVISIBLY:
//
// - the substrate must see the LATEST placement after an update, without re-registering. A
//   container rebuilds its placement whenever its model changes; if the registry held the first
//   one, drops would silently operate on a stale layout.
// - the façade must forward members it was never told about. A hand-listed literal drops any
//   member nobody remembered, and because the router only ever sees the façade, that member goes
//   missing for EVERY container at once. An absent OPTIONAL member is indistinguishable from
//   "this container does not implement it", so it never surfaces as a bug.
// - a container authored as a CLASS must keep its `this`.

const el = (): Element => ({ parentElement: null }) as unknown as Element

const placementFor = (panes: string[]): ContainerPlacement =>
  ({
    panes: () => panes,
    findPane: (id: string) => (panes.includes(id) ? ({ id } as never) : null),
    activate: () => {},
    getSlotContent: () => null,
    setSlotContent: () => {},
    moveWithin: () => true,
    extract: () => null,
    inject: () => {},
  }) as unknown as ContainerPlacement

let root: Element
beforeEach(() => { root = el() })
afterEach(() => deregisterContainer(root))

describe('attachContainer', () => {
  it('registers the placement so the substrate can reach the container', () => {
    attachContainer(root, { placement: placementFor(['p1']) })
    expect(findPlacementByPane('p1')).not.toBeNull()
  })

  it('reflects an UPDATED placement without re-registering', () => {
    const a = attachContainer(root, { placement: placementFor(['p1']) })
    expect(findPlacementByPane('p2')).toBeNull()

    a.update({ placement: placementFor(['p2']) })

    // The registry still holds the same façade; the façade now reads the new placement.
    expect(findPlacementByPane('p2')).not.toBeNull()
    expect(findPlacementByPane('p1')).toBeNull()
  })

  it('forwards a member the façade was never told about', () => {
    // The seam can grow. A hand-listed forwarder table would return undefined
    // here, which the router reads as "not implemented" rather than as a bug.
    const canAccept = vi.fn(() => true)
    const placement = { ...placementFor(['p1']), canAccept } as unknown as ContainerPlacement
    attachContainer(root, { placement })

    const seen = findPlacementByPane('p1') as unknown as { canAccept?: () => boolean }
    expect(typeof seen.canAccept).toBe('function')
    expect(seen.canAccept?.()).toBe(true)
    expect(canAccept).toHaveBeenCalled()
  })

  it('keeps `this` for a container authored as a class', () => {
    class ClassPlacement {
      readonly mine = ['p9']
      panes(): string[] { return this.mine }         // throws if `this` is lost
      findPane(id: string): unknown { return this.mine.includes(id) ? { id } : null }
      activate(): void {}
      getSlotContent(): unknown { return null }
      setSlotContent(): void {}
      moveWithin(): boolean { return true }
      extract(): unknown { return null }
      inject(): void {}
    }
    attachContainer(root, { placement: new ClassPlacement() as unknown as ContainerPlacement })
    expect(findPlacementByPane('p9')).not.toBeNull()
  })

  it('detaches, and detaching twice is safe', () => {
    const a = attachContainer(root, { placement: placementFor(['p1']) })
    a.detach()
    expect(findPlacementByPane('p1')).toBeNull()
    expect(() => a.detach()).not.toThrow()
  })

  it('ignores an update after detach', () => {
    const a = attachContainer(root, { placement: placementFor(['p1']) })
    a.detach()
    a.update({ placement: placementFor(['p2']) })
    expect(findPlacementByPane('p2')).toBeNull()
  })
})
