// THE DECLARED-CAPABILITY GATE — a projection may only handle an intent its
// type-def DECLARES (`handles-intent-meta`), so which projection handles which intent is a type-graph fact.
//
// RUNG 3 (warn-then-ratchet), not refuse. An honest third-party author trips this by forgetting the
// declaration, and nothing is destroyed — a declaration gap is not an attack. So the framework WARNS
// through the diagnostic seam and the registration still proceeds. These tests pin exactly that: the
// warning fires on an undeclared type, stays silent on a declared one and on an exempt (host-owned)
// node, and NEVER refuses — the handler is registered regardless.


import { afterEach, describe, expect, it } from 'vitest'

import { setHostDiagnosticSink, type HostDiagnostic } from '@arsumbris/au-host-sdk'

import { IntentTree } from '../src/renderer/src/projections/intent-channel'
import type { IntentPayload } from '../src/renderer/src/projections/host-config'

// A flat tree (no parents), so a firer-relative fire resolves the lone owner as its own candidate.
function tree(): IntentTree {
  const t = new IntentTree(() => null)
  // 'n-decl' declares only open-intent; 'n-empty' declares nothing; 'n-host' is exempt (undefined).
  t.setDeclaredHandles((node) =>
    node === 'n-decl' ? ['open-intent'] : node === 'n-host' ? undefined : [],
  )
  return t
}

function capture(): HostDiagnostic[] {
  const seen: HostDiagnostic[] = []
  setHostDiagnosticSink((d) => seen.push(d))
  return seen
}

const promote: IntentPayload = { type: 'promote-intent', dispatch: 'firer-relative' } as IntentPayload

// A handler is a `{ claim, commit }` pair (the gather-then-commit split). These gate tests only
// need a CLAIMING handler; registration + the warning fire regardless of what commit does.
const claims = (): { claim: () => boolean; commit: () => void } => ({ claim: () => true, commit: () => {} })

afterEach(() => setHostDiagnosticSink(null))

describe('the declared-capability gate', () => {
  it('stays silent when the type IS declared', () => {
    const seen = capture()
    tree().forNode('n-decl').handle('open-intent', claims())
    expect(seen).toHaveLength(0)
  })

  it('WARNS when the type is not in the declared set, with the code and subject', () => {
    const seen = capture()
    tree().forNode('n-decl').handle('promote-intent', claims())
    expect(seen).toHaveLength(1)
    expect(seen[0].code).toBe('intent-handled-undeclared')
    expect(seen[0].severity).toBe('warning')
    expect(seen[0].subject).toBe('promote-intent')
  })

  it('warns when a projection declaring NOTHING handles anything', () => {
    const seen = capture()
    tree().forNode('n-empty').handle('open-intent', claims())
    expect(seen).toHaveLength(1)
    expect(seen[0].subject).toBe('open-intent')
  })

  it('EXEMPTS a host-owned node (undeclared-handles resolves undefined)', () => {
    const seen = capture()
    tree().forNode('n-host').handle('ui-notification', claims())
    expect(seen).toHaveLength(0)
  })

  it('is OFF entirely when no resolver is injected', () => {
    const seen = capture()
    const bare = new IntentTree(() => null) // no setDeclaredHandles
    bare.forNode('anything').handle('whatever', claims())
    expect(seen).toHaveLength(0)
  })

  it('WARNS but does NOT refuse — the undeclared handler is still registered and fires', () => {
    capture()
    const t = tree()
    let ran = false
    t.forNode('n-decl').handle('promote-intent', { claim: () => true, commit: () => { ran = true } })
    // rung 3 warns, it does not block: firing the undeclared intent still reaches the handler.
    t.forNode('n-decl').fire(promote)
    expect(ran).toBe(true)
  })
})
