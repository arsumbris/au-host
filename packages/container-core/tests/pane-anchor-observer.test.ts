/**
 * @vitest-environment happy-dom
 */
// THE DOM-AUTHORITATIVE ANCHOR DERIVATION. An anchor IS a
// DOM element carrying `data-pane-id`, not a host, connected in the composition root. These pin the
// derivation the observer maintains: the initial scan, host-exclusion, self-cycle refusal, move-ordering
// (most-recently-tagged wins), and re-derivation when the current anchor is removed. Each case is
// falsified — the assertion fails if the guard is dropped.
//
// The derivation writes into a PER-RUNTIME registry: a fresh `createPortalRegistry()` per test, so
// there is no cross-test global to clear and two runtimes could never collide on a shared `^:`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPortalRegistry, installPaneAnchorObserver, scanAnchors, type PortalRegistry } from '../src/pane-portal.ts'

/** A tagged anchor slot appended to `parent` (default: body). */
function anchor(id: string, parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-pane-id', id)
  parent.appendChild(el)
  return el
}

/** Flush the MutationObserver's async delivery (microtask + macrotask). */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

let reg: PortalRegistry

beforeEach(() => {
  reg = createPortalRegistry()
  document.body.replaceChildren()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('anchor derivation — the initial scan', () => {
  it('maps every tagged, connected, non-host slot to its element', () => {
    const a = anchor('a')
    const b = anchor('b')
    scanAnchors(reg, document.body)
    expect(reg.paneAnchors.get('a')).toBe(a)
    expect(reg.paneAnchors.get('b')).toBe(b)
    expect(reg.paneAnchors.size).toBe(2)
  })

  it('never treats a `data-pane-host` element as an anchor (the flat PaneHost carries both attributes)', () => {
    // The flat host's mount slot is tagged `data-pane-id` AND `data-pane-host` — it must NOT anchor.
    const host = anchor('h')
    host.setAttribute('data-pane-host', 'h')
    scanAnchors(reg, document.body)
    expect(reg.paneAnchors.has('h')).toBe(false)
    // Falsify: drop the `:not([data-pane-host])` filter and this would wrongly record the host.
  })

  it('refuses an anchor that sits inside its own pane host (a self-cycle)', () => {
    const host = document.createElement('div')
    host.setAttribute('data-pane-host', 'c')
    document.body.appendChild(host)
    reg.paneHosts.set('c', host)
    // A slot tagged `c` INSIDE host `c`: appending host into it would be a DOM cycle.
    anchor('c', host)
    scanAnchors(reg, document.body)
    expect(reg.paneAnchors.has('c')).toBe(false)
  })
})

describe('anchor derivation — the live observer', () => {
  // paneHosts stays EMPTY, so the reconcile the observer calls is a no-op loop and cannot append
  // anything — these assert the map derivation alone, end-to-end through the real MutationObserver.

  it('seeds the map on install, then repoints when a newer slot for the same id appears (last wins)', async () => {
    const first = anchor('x')
    const dispose = installPaneAnchorObserver(reg, document.body)
    expect(reg.paneAnchors.get('x')).toBe(first) // seeded by the install scan

    const second = anchor('x') // a second slot claims x (e.g. mid-move, the new container's slot)
    await flush()
    expect(reg.paneAnchors.get('x')).toBe(second) // most-recently-tagged wins
    dispose()
  })

  it('re-derives to a surviving slot when the current anchor is removed', async () => {
    const first = anchor('x')
    const second = anchor('x')
    const dispose = installPaneAnchorObserver(reg, document.body)
    expect(reg.paneAnchors.get('x')).toBe(second) // scan document-order: last recorded wins

    second.remove()
    await flush()
    expect(reg.paneAnchors.get('x')).toBe(first) // fell back to the survivor
    dispose()
  })

  it('drops the entry when the last slot for an id is removed', async () => {
    const only = anchor('y')
    const dispose = installPaneAnchorObserver(reg, document.body)
    expect(reg.paneAnchors.get('y')).toBe(only)

    only.remove()
    await flush()
    expect(reg.paneAnchors.has('y')).toBe(false)
    dispose()
  })

  it('repoints on an attribute change and drops the old id', async () => {
    const el = anchor('x')
    const dispose = installPaneAnchorObserver(reg, document.body)
    expect(reg.paneAnchors.get('x')).toBe(el)

    el.setAttribute('data-pane-id', 'z') // same element, new id
    await flush()
    expect(reg.paneAnchors.has('x')).toBe(false) // old id released
    expect(reg.paneAnchors.get('z')).toBe(el) // new id claimed
    dispose()
  })

  it('disposes clean: disconnects and clears the map', async () => {
    anchor('x')
    const dispose = installPaneAnchorObserver(reg, document.body)
    expect(reg.paneAnchors.size).toBe(1)
    dispose()
    expect(reg.paneAnchors.size).toBe(0)

    // After dispose the observer is disconnected — a later mutation is NOT tracked.
    anchor('late')
    await flush()
    expect(reg.paneAnchors.has('late')).toBe(false)
  })
})
