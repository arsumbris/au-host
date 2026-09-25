// Bento's derived container schemas, installed the way the host does after discovery.
//
// The slot codec asks the TYPE GRAPH which slot types a position's field admits (`slotFieldOf`).
// Without installed schemas it falls back to the base `container-slot` name only, so a unit test
// that reads a `bento-slot` record must install these first, or the record reads as a bare child.

import { afterEach, beforeEach } from 'vitest'

import type { ContainerSchemas, SlotField } from '@arsumbris/au-host-sdk'
import { setContainerSchemas } from '@arsumbris/container-core'

/** One child field admitting `bento-slot` and a nested branch, as `deriveContainerSchemas` reports it. */
const leafField = (name: string, list: boolean): SlotField => ({
  name,
  list,
  slotTypes: ['bento-slot'],
  slotTypesQualified: ['bento-slot::bento'],
  nodeTypes: ['bento-node.branch'],
})

export const BENTO_SCHEMAS: ContainerSchemas = {
  containers: new Map([['bento', { type: 'bento', fields: [leafField('root', false)] }]]),
  nodes: new Map([['bento-node.branch', { type: 'bento-node.branch', fields: [leafField('children', true)] }]]),
}

/** Install bento's schemas for every test in the calling file, and clear them after. */
export function useBentoSchemas(): void {
  beforeEach(() => setContainerSchemas(BENTO_SCHEMAS))
  afterEach(() => setContainerSchemas(null))
}
