// Selection followers and subtree aggregates use stable pool node IDs. A publisher remount with
// the same node ID must retain the listener; only record removal drops it. The test mutates the
// publisher-to-node mapping to exercise remount behavior without a DOM.
import { describe, expect, it } from 'vitest'

import { SelectionTree } from '../src/renderer/src/projections/selection-channel'

// Topology: container `C` with two leaves `A` (the follower) and `B` (the publisher).
const parentOfNode = (n: string): string | null => (n === 'A' || n === 'B' ? 'C' : null)

describe('SelectionTree keys by the stable ^: node id', () => {
  it('a follower keeps hearing publishes after a sibling publisher REMOUNTS (new publisher, same ^:)', () => {
    // publisher -> node id, mutable so we can "remount" a publisher for the same `^:`.
    const pubToNode = new Map<string, string>([['aPub', 'A'], ['bPub', 'B']])
    const tree = new SelectionTree(parentOfNode, (p) => pubToNode.get(p) ?? null)

    const heard: unknown[] = []
    tree.forNode('aPub').follow((v) => heard.push(v)) // A follows its enclosing container C

    tree.forNode('bPub').publish('sel-1') // B publishes → bubbles to C → A hears
    expect(heard).toEqual(['sel-1'])

    // REMOUNT B: a new publisher for the SAME `^:` 'B'. No dropNode — a remount is not a reap.
    pubToNode.delete('bPub')
    pubToNode.set('bPub2', 'B')

    tree.forNode('bPub2').publish('sel-2') // routes by node id → still bubbles to C → A still hears
    expect(heard).toEqual(['sel-1', 'sel-2'])
  })

  it('a follower survives its own publisher remounting and still hears (re-follow under a new publisher)', () => {
    const pubToNode = new Map<string, string>([['aPub', 'A'], ['bPub', 'B']])
    const tree = new SelectionTree(parentOfNode, (p) => pubToNode.get(p) ?? null)
    const heard: unknown[] = []
    // A follows under its first publisher; the registration is keyed by A's node id, not the publisher.
    tree.forNode('aPub').follow((v) => heard.push(v))
    // A remounts: a new publisher for `^:` 'A'. Re-following under it targets the SAME container node id.
    pubToNode.delete('aPub')
    pubToNode.set('aPub2', 'A')
    tree.forNode('bPub').publish('after-remount')
    expect(heard).toEqual(['after-remount']) // the original follow (keyed by node id 'A') is unaffected
  })

  it('dropNode (the reap) removes a follower; a later publish does not reach it', () => {
    const tree = new SelectionTree(parentOfNode, (p) => ({ aPub: 'A', bPub: 'B' } as Record<string, string>)[p] ?? null)
    const heard: unknown[] = []
    tree.forNode('aPub').follow((v) => heard.push(v))
    tree.forNode('bPub').publish('x')
    expect(heard).toEqual(['x'])

    tree.dropNode('A', 'C') // the record for A left the pool
    tree.forNode('bPub').publish('y')
    expect(heard).toEqual(['x']) // A no longer hears — dropped at the reap
  })
})
