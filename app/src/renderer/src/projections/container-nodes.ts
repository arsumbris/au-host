// Read the `container-node` type graph for structural nodes and slot types. The slot codec uses its
// ancestor closures to recognize a slot subtype and retain the position's rules.
// This root is distinct from loadable `projection` types; keeping the queries separate preserves
// the distinction between a child projection and a slot record in a union.



import { readSubtypes, type WireReader, type WireSubtype } from '@arsumbris/au-host-sdk/engine-reads'
import { refName } from '@arsumbris/type-query'

/** The structural root every slot and every structural node descends from. */
const NODE_BASE = 'container-node'

/** Every `container-node` subtype, by BARE name → its transitive ancestor closure (bare, reflexive). */
export type NodeClosures = ReadonlyMap<string, ReadonlySet<string>>

/** The transitive ancestor closure of a def, reflexive and bare. Resolves parents by NAME, since
 *  names are workspace-unique and a `::repo` qualifier is a scope rather than part of the name. */
function closureOf(name: string, byName: ReadonlyMap<string, WireSubtype>): Set<string> {
  const out = new Set<string>()
  const walk = (n: string): void => {
    if (out.has(n)) return
    out.add(n)
    for (const p of byName.get(n)?.parents ?? []) walk(refName(p))
  }
  walk(refName(name))
  return out
}

/**
 * Read `container-node` ancestor closures. Return an empty map while the graph is unavailable;
 * the slot codec then uses its exact-name fallback.
 */
export async function readNodeClosures(reader: WireReader): Promise<NodeClosures> {
  const res = await readSubtypes(reader, NODE_BASE)
  if (!('ready' in res) || !res.ready || !res.result) return new Map()
  const defs = res.result.subtypes as WireSubtype[]
  const byName = new Map(defs.map((d) => [refName(d.name), d]))
  const closures = new Map<string, ReadonlySet<string>>()
  for (const d of defs) closures.set(refName(d.name), closureOf(d.name, byName))
  return closures
}
