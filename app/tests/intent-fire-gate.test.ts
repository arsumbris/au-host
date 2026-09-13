// THE DECLARED-FIRE GATE — the mirror of the declared-CAPABILITY (handle) gate. A projection may
// only fire an intent its type-def DECLARES (`fires-intent-meta`), so which projection fires which
// intent is a type-graph fact and the declaration cannot drift silently from the code.

// RUNG 3 (warn-then-ratchet), not refuse. An honest author trips this by forgetting the declaration,
// and nothing is destroyed. So the framework WARNS through the diagnostic seam and the fire still
// routes. These tests pin exactly that: the warning fires on an undeclared type, stays silent on a
// declared one and on an exempt (host-owned) node, and NEVER refuses — the intent still routes.


import { afterEach, describe, expect, it } from 'vitest'

import { setHostDiagnosticSink, type HostDiagnostic } from '@arsumbris/au-host-sdk'

import { IntentTree } from '../src/renderer/src/projections/intent-channel'
import type { IntentPayload } from '../src/renderer/src/projections/host-config'

// A flat tree (no parents). 'n-decl' declares only open-intent; 'n-empty' declares nothing;
// 'n-host' is exempt (undefined, a host-owned surface).
function tree(): IntentTree {
  const t = new IntentTree(() => null)
  t.setDeclaredFires((node) =>
    node === 'n-decl' ? ['open-intent'] : node === 'n-host' ? undefined : [],
  )
  return t
}

function capture(): HostDiagnostic[] {
  const seen: HostDiagnostic[] = []
  setHostDiagnosticSink((d) => seen.push(d))
  return seen
}

const openIntent: IntentPayload = { type: 'open-intent', dispatch: 'ambient' } as IntentPayload
const promote: IntentPayload = { type: 'promote-intent', dispatch: 'firer-relative' } as IntentPayload

afterEach(() => setHostDiagnosticSink(null))

describe('the declared-fire gate', () => {
  it('stays silent when the fired type IS declared', () => {
    const seen = capture()
    tree().forNode('n-decl').fire(openIntent)
    expect(seen).toHaveLength(0)
  })

  it('WARNS when the fired type is not in the declared set, with the code and subject', () => {
    const seen = capture()
    tree().forNode('n-decl').fire(promote)
    expect(seen).toHaveLength(1)
    expect(seen[0].code).toBe('intent-fired-undeclared')
    expect(seen[0].severity).toBe('warning')
    expect(seen[0].subject).toBe('promote-intent')
  })

  it('warns when a projection declaring NOTHING fires anything', () => {
    const seen = capture()
    tree().forNode('n-empty').fire(openIntent)
    expect(seen).toHaveLength(1)
    expect(seen[0].subject).toBe('open-intent')
  })

  it('EXEMPTS a host-owned node (declared-fires resolves undefined)', () => {
    const seen = capture()
    tree().forNode('n-host').fire(promote)
    expect(seen).toHaveLength(0)
  })

  it('is OFF entirely when no resolver is injected', () => {
    const seen = capture()
    const bare = new IntentTree(() => null) // no setDeclaredFires
    bare.forNode('anything').fire(openIntent)
    expect(seen).toHaveLength(0)
  })

  it('WARNS but does NOT refuse — the undeclared fire still routes to a handler', () => {
    capture()
    const t = tree()
    let ran = false
    // A handler is a `{ claim, commit }` pair (the gather-then-commit split); `commit` is the act.
    t.forNode('n-decl').handle('promote-intent', { claim: () => true, commit: () => { ran = true } })
    t.forNode('n-decl').fire(promote)
    expect(ran).toBe(true)
  })
})
