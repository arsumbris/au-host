// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { parentMap, type CompositionPool, type ContainerSchemas } from '@arsumbris/au-host-sdk'
import { CompositionRuntime } from '../src/renderer/src/projections/composition'
import { SelectionTree } from '../src/renderer/src/projections/selection-channel'

const schemas: ContainerSchemas = {
  containers: new Map([['custom-deck', { type: 'custom-deck', fields: [
    { name: 'contents', list: true, slotTypes: [], nodeTypes: [] },
  ] }]]),
  nodes: new Map(),
}

describe('selection ancestry after a container saves new children', () => {
  it.each([false, true])('connects newly referenced siblings with a separate mount pool: %s', (separateMountPool) => {
    const pool: CompositionPool = { roots: ['deck'], records: new Map([
      ['deck', { type: 'custom-deck', '^': 'deck', contents: [] }],
      ['source', { type: 'custom-source', '^': 'source' }],
      ['observer', { type: 'custom-observer', '^': 'observer' }],
    ]) }
    const runtime = Object.create(CompositionRuntime.prototype) as CompositionRuntime
    Object.assign(runtime, {
      opts: { schemas: () => schemas }, pool,
      mountPool: separateMountPool ? { ...pool, records: new Map(pool.records) } : pool,
      poolParents: parentMap(pool, schemas),
      inboundHandlers: new Map(),
      mainRoot: 'pub-deck',
      prevReachable: new Set(['deck']), prevReachableRootsKey: 'deck',
      nodes: new Map([
        ['pub-deck', { nodeId: 'deck', parentId: null }],
        ['pub-source', { nodeId: 'source', parentId: null }],
        ['pub-observer', { nodeId: 'observer', parentId: null }],
      ]),
      nodeIdToPublisher: new Map([['deck', 'pub-deck'], ['source', 'pub-source'], ['observer', 'pub-observer']]),
    })
    runtime['mergeRecord']('deck', { type: 'custom-deck', '^': 'deck', contents: ['[[^^source]]', '[[^^observer]]'] })
    expect(runtime['logicalParent']('pub-observer')).toBe('pub-deck')
    const tree = new SelectionTree((id) => runtime['poolParents'].get(id) ?? null, (publisher) => runtime['nodes'].get(publisher)?.nodeId ?? null)
    const receive = vi.fn()
    const stop = tree.forNode('pub-observer').follow(receive)
    const selection = { type: 'custom-selection', value: 42 }
    tree.forNode('pub-source').publish(selection)
    expect(receive).toHaveBeenCalledExactlyOnceWith(selection)
    stop()
    tree.forNode('pub-source').publish({ type: 'custom-selection', value: 43 })
    expect(receive).toHaveBeenCalledTimes(1)
  })
})
