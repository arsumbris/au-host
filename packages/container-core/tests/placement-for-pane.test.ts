/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { ContainerPlacement } from '@arsumbris/au-host-sdk'
import { activatePane, closePane, deregisterContainer, placementForPane, registerContainer } from '../src/registry.ts'

// `placementForPane` locates a pane's container through the framework's OWN
// DOM truth — the anchor slot carrying `data-pane-id` (the stable child id), which sits inside its
// container's DOM, resolved by a query and walked up to the container root. NOT by asking a container to
// map the id via `findPane` — a container that resolved occupant ops by its internal position id
// silently broke every out-of-band caller (`closePane` / `activatePane`), and the wrong lookup was
// indistinguishable from the right one at author time. Resolving by DOM (not by reading the anchor map)
// is also what lets that map be a PER-RUNTIME registry: this runs from a projection bundle too, with
// no registry handle but the shared DOM. These pin the DOM path wins even when `findPane` says NO, and
// that the `findPane` scan is only the fallback when no anchor is in the DOM.

const roots: Element[] = []

/** Register a container root that is CONNECTED in the document (so `document.querySelector` sees its
 *  anchors and `findContainerRoot` can walk up to it). */
const registerRoot = (placement: ContainerPlacement): HTMLElement => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  registerContainer(root, placement)
  roots.push(root)
  return root
}

/** Add an anchor slot for `paneId` inside `root` (the DOM fact `placementForPane` queries). */
const anchorInto = (root: HTMLElement, paneId: string): HTMLElement => {
  const slot = document.createElement('div')
  slot.setAttribute('data-pane-id', paneId)
  root.appendChild(slot)
  return slot
}

// A placement whose `findPane` ALWAYS says no — so a resolution can only come from the DOM anchor. A
// container that mis-answers `findPane` for a stable child id.
const denyingPlacement = (over: Partial<ContainerPlacement> = {}): ContainerPlacement =>
  ({
    panes: () => [],
    findPane: () => null,
    activate: () => {},
    getSlotContent: () => null,
    setSlotContent: () => {},
    moveWithin: () => true,
    extract: () => null,
    inject: () => {},
    ...over,
  }) as unknown as ContainerPlacement

afterEach(() => {
  for (const r of roots.splice(0)) deregisterContainer(r)
  document.body.replaceChildren()
})

describe('placementForPane — framework-owned pane location (violation #22)', () => {
  it('resolves through the DOM anchor even when the container `findPane` denies the id', () => {
    const placement = denyingPlacement()
    const root = registerRoot(placement)
    anchorInto(root, 'childX') // the anchor sits INSIDE its container's DOM
    // findContainerRoot walks the anchor up to `root` — the container is located WITHOUT `findPane`.
    expect(placementForPane('childX')).toBe(placement)
  })

  it('never resolves through the flat host element (data-pane-host is excluded)', () => {
    const placement = denyingPlacement()
    const root = registerRoot(placement)
    const host = anchorInto(root, 'childH')
    host.setAttribute('data-pane-host', 'childH') // the flat host carries data-pane-id too — must not match
    expect(placementForPane('childH')).toBeNull()
  })

  it('falls back to the findPane scan when no anchor is in the DOM (legacy / detached)', () => {
    // This one WILL claim the pane via findPane, standing in for the legacy path; no anchor is rendered.
    const claiming = denyingPlacement({ findPane: (id: string) => (id === 'childY' ? ({} as never) : null) })
    registerRoot(claiming)
    expect(placementForPane('childY')).toBe(claiming)
  })

  it('returns null when neither a DOM anchor nor any container claims the pane', () => {
    registerRoot(denyingPlacement())
    expect(placementForPane('nobody')).toBeNull()
  })
})

// The occupant ops fired OUT OF BAND by the stable child id — `activatePane` (the `containerOp: activate`
// implementation) and `closePane` (the removal floor under every container's ✕). Both resolve their container through `placementForPane` (the DOM anchor), then invoke the op
// BY THE SAME STABLE ID. This is the routing bridge's occupant-op conformance half — its parentage half
// lives in host-sdk's resolveLogicalParent test. Both fire the op and assert it actually resolves.

describe('activatePane / closePane — occupant ops resolve + fire by stable child id', () => {
  // A placement that records what it was asked to do, so a test can assert the op reached it BY ID.
  const spyPlacement = (over: Partial<ContainerPlacement> = {}): ContainerPlacement & { calls: string[] } => {
    const calls: string[] = []
    const p = denyingPlacement({
      activate: (id: string) => calls.push(`activate:${id}`),
      extract: (id: string) => (calls.push(`extract:${id}`), {} as never), // legacy close = extract, discarded
      ...over,
    }) as ContainerPlacement & { calls: string[] }
    p.calls = calls
    return p
  }

  it('activatePane resolves via the DOM anchor and fires activate with the SAME id', () => {
    const p = spyPlacement()
    anchorInto(registerRoot(p), 'childX')
    expect(activatePane('childX')).toBe(true)
    expect(p.calls).toEqual(['activate:childX'])
  })

  it('activatePane returns false when no container holds the pane (no side effect)', () => {
    const p = spyPlacement()
    registerRoot(p) // registered but no anchor, and findPane denies
    expect(activatePane('ghost')).toBe(false)
    expect(p.calls).toEqual([])
  })

  it('closePane (legacy, no poolEdit) resolves and closes via extract by the stable id', () => {
    const p = spyPlacement()
    anchorInto(registerRoot(p), 'childY')
    expect(closePane('childY')).toBe(true)
    expect(p.calls).toEqual(['extract:childY'])
  })

  it('closePane (pool path) drives poolEdit.extractEdit + propose by the stable id, never extract', () => {
    const proposals: unknown[] = []
    const poolEdit = {
      recordId: () => 'rec-1',
      extractEdit: (id: string) => ({ record: { closed: id } }),
      propose: (edits: unknown) => proposals.push(edits),
    }
    const p = spyPlacement({ poolEdit } as Partial<ContainerPlacement>)
    anchorInto(registerRoot(p), 'childZ')
    expect(closePane('childZ')).toBe(true)
    expect(p.calls).toEqual([]) // a close is a pool reference-removal, not extract
    expect(proposals).toEqual([[{ id: 'rec-1', record: { closed: 'childZ' } }]])
  })

  it('closePane refuses a FIXED slot and does not remove the occupant', () => {
    const p = spyPlacement({ slotFor: () => ({ fixed: true }) } as Partial<ContainerPlacement>)
    anchorInto(registerRoot(p), 'childF')
    expect(closePane('childF')).toBe(false)
    expect(p.calls).toEqual([]) // fixity is honoured — no extract, no pool edit
  })
})
