import { afterEach, describe, expect, it } from 'vitest'
import type { ContainerSchemas } from '@arsumbris/au-host-sdk'
import { slotFieldOf } from '@arsumbris/container-core'
import { clearSubstrateFacts, installSubstrateFacts } from '../src/renderer/src/projections/substrate-facts'

const schemas = {
  containers: new Map([['tabs', { fields: [{ name: 'tabs' }] }]]),
  nodes: new Map(),
} as unknown as ContainerSchemas

describe('installSubstrateFacts', () => {
  afterEach(() => clearSubstrateFacts())

  it('keeps the last answered schemas while the graph cannot answer', () => {
    installSubstrateFacts([], { schemas, nodeClosures: new Map() })
    expect(slotFieldOf('tabs', 'tabs')).toBeDefined()

    // A refresh mid-rebuild: the graph has no answer yet.
    installSubstrateFacts([], { schemas: null, nodeClosures: null })
    expect(slotFieldOf('tabs', 'tabs')).toBeDefined()
  })
})
