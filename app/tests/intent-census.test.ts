// The IntentTree's census — the source/sink data the layout-inspector surfaces.
//
// SINKS come from the capability map; SOURCES are recorded on `fire`.
// Two properties are worth pinning: a fire records its source REGARDLESS of whether
// anything handles it (an unhandled intent is still worth seeing), and an unmounted handler stops being
// a sink. The census is by PUBLISHER ID here; the runtime maps ids → projection-type names (untested
// here — that is a plain Map lookup over `nodes`).

import { describe, expect, it } from 'vitest'
import { IntentTree } from '../src/renderer/src/projections/intent-channel'
import type { IntentPayload } from '@arsumbris/au-host-sdk'

const routed = (type: string): IntentPayload => ({ type, kind: 'routed' }) as unknown as IntentPayload

describe('IntentTree.census', () => {
  it('records a SINK when a node handles a type', () => {
    const tree = new IntentTree(() => null)
    tree.forNode('node-a').handle('open-intent', () => true)
    expect(tree.census().sinks.get('open-intent')).toEqual(['node-a'])
  })

  it('records a SOURCE when a node fires a type — even with no handler mounted', () => {
    const tree = new IntentTree(() => null)
    tree.forNode('node-a').fire(routed('reveal-pane')) // nobody handles reveal-pane
    expect(tree.census().sources.get('reveal-pane')).toEqual(['node-a'])
    // ...and it is NOT a sink, since no one handles it.
    expect(tree.census().sinks.has('reveal-pane')).toBe(false)
  })

  it('dedupes sources and sinks per type across repeated fires / multiple owners', () => {
    const tree = new IntentTree(() => null)
    const a = tree.forNode('node-a')
    a.fire(routed('open-intent'))
    a.fire(routed('open-intent')) // same firer again → still one entry
    tree.forNode('node-b').handle('open-intent', () => true)
    tree.forNode('node-c').handle('open-intent', () => true)
    const c = tree.census()
    expect(c.sources.get('open-intent')).toEqual(['node-a'])
    expect(new Set(c.sinks.get('open-intent'))).toEqual(new Set(['node-b', 'node-c']))
  })

  it('an unmounted handler stops being a SINK (the key survives, but reads empty)', () => {
    const tree = new IntentTree(() => null)
    tree.forNode('node-a').handle('open-intent', () => true)
    tree.dropNode('node-a')
    expect(tree.census().sinks.has('open-intent')).toBe(false)
  })

  it('tracks the LAST firer per type (overwrites), for the "actual (last)" view', () => {
    const tree = new IntentTree(() => null)
    tree.forNode('node-a').fire(routed('open-intent'))
    tree.forNode('node-b').fire(routed('open-intent')) // b fires last
    const c = tree.census()
    // sources ACCUMULATE both; lastFire holds only the most recent.
    expect(new Set(c.sources.get('open-intent'))).toEqual(new Set(['node-a', 'node-b']))
    expect(c.lastFire.get('open-intent')).toBe('node-b')
  })
})
