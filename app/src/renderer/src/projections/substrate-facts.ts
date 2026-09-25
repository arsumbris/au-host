// The TYPE FACTS the container substrate reads, discovered and installed the same way in every renderer.

// container-core is a library with no engine access, so the host hands it what the type graph says:
// the closure predicate (`admits`, slot-record recognition) and the derived container schemas (which
// fields hold children, and which slot type each admits). A floated window is its own renderer with its
// own container-core instance, so it installs the same facts from its own reads; one function for both
// means the two renderers cannot disagree about what a slot is.

import { bareTypeName, deriveContainerSchemas, type ContainerSchemas } from '@arsumbris/au-host-sdk'
import { readSubtypes, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import { setContainerSchemas } from '@arsumbris/container-core'

import { readNodeClosures, type NodeClosures } from './container-nodes'
import type { DiscoveredProjection } from './discovery'
import { installSlotTypeProvider } from './slot-types'

export interface SubstrateFacts {
  /** The derived child-bearing shape of every container; null while the graph cannot answer. */
  schemas: ContainerSchemas | null
  /** Every `container-node` type's ancestor closure, by bare name; null while the graph cannot answer. */
  nodeClosures: NodeClosures | null
}

/** Read the type graph for the substrate's facts. */
export async function discoverSubstrateFacts(reader: WireReader): Promise<SubstrateFacts> {
  const [nodeClosures, containerSubs, nodeSubs, mountableSubs] = await Promise.all([
    readNodeClosures(reader),
    readSubtypes(reader, 'container-projection'),
    readSubtypes(reader, 'container-node'),
    readSubtypes(reader, 'mountable'),
  ])
  if (!('ready' in containerSubs && containerSubs.ready && 'ready' in nodeSubs && nodeSubs.ready)) {
    return { schemas: null, nodeClosures }
  }
  // A slot typed to a narrower mountable subtype (a projection subtype, `composition*`) resolves through
  // the `mountable` subtypes. The `window` branch of `mountable` holds a child (`content`) but is not a
  // container-projection, so it is enumerated separately or `window.content` is never walked.
  const mountableDefs = 'ready' in mountableSubs && mountableSubs.ready ? mountableSubs.result.subtypes : []
  const windowDefs = mountableDefs.filter((d) => bareTypeName(d.name) === 'window')
  return {
    schemas: deriveContainerSchemas(containerSubs.result.subtypes, nodeSubs.result.subtypes, mountableDefs, windowDefs),
    nodeClosures,
  }
}

// The last facts the graph answered, per renderer (this module is per renderer, like container-core).
let lastNodeClosures: NodeClosures | null = null

/**
 * Install the facts into this renderer's container-core. Re-run on every type-graph change.
 * A fact the graph cannot answer yet (null, mid-rebuild) keeps the last answered one: blanking it would make
 * a save in that window throw on an empty slot, or drop a slot rule as inexpressible.
 */
export function installSubstrateFacts(projections: readonly DiscoveredProjection[], facts: SubstrateFacts): void {
  if (facts.nodeClosures) lastNodeClosures = facts.nodeClosures
  installSlotTypeProvider(projections, lastNodeClosures ?? undefined)
  if (facts.schemas) setContainerSchemas(facts.schemas)
}

/** Drop the installed facts and the kept ones (teardown): container-core then has no schemas. */
export function clearSubstrateFacts(): void {
  lastNodeClosures = null
  setContainerSchemas(null)
}
