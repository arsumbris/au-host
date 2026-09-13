// Installs the TYPE-CLOSURE predicate the container substrate checks `admits` with.

// A `container-slot`'s `admits` names the projection types that may occupy a position. It must be
// answered by CLOSURE, never by exact name: a slot admitting `pane-projection` admits every pane,
// and a slot admitting a base admits its subtypes. Exact-name matching would reject valid subtypes.

// The substrate cannot answer it itself: `container-core` is a library, never mounted, so it has no
// engine access. The host does, and it ALREADY computes each projection's full ancestor closure in
// the one `subtypes` discovery pass. So this installs a synchronous predicate over data already in
// hand — the same producer/consumer split as the grouping lookup, and for the same reason
// (`routeDrop` is synchronous and the substrate spec depends on that).




import { setSlotTypeProvider } from '@arsumbris/container-core'
import { refName } from '@arsumbris/type-query'

import type { DiscoveredProjection } from './discovery'

/**
 * Install the predicate over the current discovery result. Re-run on every type-graph change, the
 * same cadence as the grouping install.
 *
 * `kinds` is the transitive ancestor closure the discovery pass already built, so this is a lookup,
 * not a walk. Names are workspace-unique, so both sides compare BARE (a `::repo` qualifier is a
 * scope, not part of the name).
 *
 * TWO POPULATIONS, one predicate. `admits` asks its is-a question about PROJECTIONS ("may this
 * occupy the slot"); the union normalizer asks the same question about CONTAINER-NODES ("is this
 * record my slot type, or a subtype of it"). They are disjoint sets of names in one map, so one
 * `isA` answers both and there is no second predicate to disagree with this one.
 *
 * `nodeClosures` is optional so a caller with no type graph yet installs the projection half alone;
 * the codec then falls back to an exact-name compare, which is what every container did before.
 */
export function installSlotTypeProvider(
  projections: readonly DiscoveredProjection[],
  nodeClosures?: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const closures = new Map<string, ReadonlySet<string>>()
  for (const p of projections) {
    closures.set(refName(p.typeName), new Set(p.kinds.map((k) => refName(k))))
  }
  for (const [name, closure] of nodeClosures ?? []) closures.set(name, closure)

  setSlotTypeProvider({
    isA: (candidate, admitted) => {
      // A rule that CANNOT be evaluated must not silently pass. An occupant whose type is unknown
      // is refused by a slot that declares `admits`, rather than admitted by default.
      if (!candidate) return false
      const c = refName(candidate)
      const a = refName(admitted)
      if (c === a) return true
      return closures.get(c)?.has(a) ?? false
    },
  })
}
