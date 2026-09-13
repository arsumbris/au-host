/**
 * The host installs grouping capability lookups; this package consumes them.
 * A grouping-container implementation exports buildGroup and owns its config schema. The substrate
 * resolves the capability and calls the builder without naming a particular container.
 *
 * The host owns the type graph and module loader, so it resolves modules eagerly and updates the
 * provider when the graph changes. A window-global holder makes that provider available across
 * projection bundles. The drop path performs synchronous lookups through the installed provider.
 */

import type { ContainerKind } from '@arsumbris/au-host-sdk';
import { grouping, wrapTargets as wrapTargetsHolder } from './singletons.ts';
import { resolveDecision } from './resolve.ts';

/** What a container declared about holding N children as one node. */
export interface GroupingCapability {
  /** The container's own type name. Carried for diagnostics only — the substrate never writes it. */
  typeName: string
  /**
   * The container's OWN `buildExport`, already resolved from its module. Builds an instance
   * holding these children, each child's stable id landing as its `^:` block-id.
   */
  build: (children: { id: string; instance: unknown }[]) => unknown
  /**
   * Below this many children the group dissolves to its lone child. Undefined = it never does.
   * The container's own invariant, not a rule the router applies to everyone.
   */
  minChildren?: number
}

/** The host's handle on the declared grouping capabilities. */
export interface GroupingProvider {
  /** The capability to build a NEW group with, or null when the workspace declares none. */
  forNewGroup: () => GroupingCapability | null
  /** What THIS container kind declared, or null when it declared nothing (it is not a group). */
  forKind: (kind: ContainerKind | undefined) => GroupingCapability | null
  /** The full OUTCOME behind `forNewGroup` (chosen + reason + available). Lets a caller SEE a
   *  `defaulted` ambiguity that `forNewGroup` hides by returning only the name-sorted pick. Optional,
   *  so a hand-built test provider need not supply it. */
  outcomeForNewGroup?: () => GroupingChoiceOutcome
  /** The composition's arrival policy: does a NEW document pane arrive wrapped in a group? A grouping
   *  policy the host installs from `composition.grouping.group-new-panes`, read by the container that
   *  places a fresh document (bento). Optional; absent = false. */
  groupNewPanes?: boolean
}

/**
 * The host-installed ASYNC resolver for an AMBIGUOUS group-creation choice: given the available
 * grouping container type names (the declaring containers, name-sorted), it returns the picked one, or
 * null on cancel. Injected exactly like the provider (window-global, see `singletons.ts`), and async
 * because it asks the user — so only an async wrapper ABOVE the synchronous `routeDrop` ever calls it.
 * The host installs a resolver that surfaces `host.chooser`; the substrate never imports the chooser.
 */
export type GroupingChooser = (available: readonly string[]) => Promise<string | null>

/**
 * Install the grouping lookup. The HOST calls this once it has resolved the declared capabilities;
 * `null` clears it (teardown).
 */
export function setGroupingProvider(provider: GroupingProvider | null): void {
  grouping.provider = provider;
}

/** The capability for a new group, or null when nothing is installed or nothing is declared. */
export function groupingForNewGroup(): GroupingCapability | null {
  return grouping.provider?.forNewGroup() ?? null;
}

/** What this container kind declared about grouping, or null. */
export function groupingForKind(kind: ContainerKind | undefined): GroupingCapability | null {
  return grouping.provider?.forKind(kind) ?? null;
}

/** Whether this container kind is itself a group (so a center drop ADDS to it rather than wrapping it). */
export function isGroupingKind(kind: ContainerKind | undefined): boolean {
  return groupingForKind(kind) !== null;
}

/** Install the host's async ambiguity resolver; `null` clears it (teardown). See `GroupingChooser`. */
export function setGroupingChooser(chooser: GroupingChooser | null): void {
  grouping.chooser = chooser;
}

/** The installed async ambiguity resolver, or null when none is installed (no interactive ask possible). */
export function groupingChooser(): GroupingChooser | null {
  return grouping.chooser ?? null;
}

/** The provider's full new-group OUTCOME (chosen + reason + available), or null when nothing is installed
 *  or the provider predates it. A caller reads `reason === 'defaulted'` to detect an ambiguity the plain
 *  `groupingForNewGroup()` would silently resolve to the name-sorted pick. */
export function groupingOutcomeForNewGroup(): GroupingChoiceOutcome | null {
  return grouping.provider?.outcomeForNewGroup?.() ?? null;
}

/** Whether the composition wants a NEW document pane to ARRIVE grouped (`grouping.group-new-panes`), read
 *  by the container placing a fresh document. False when nothing is installed. */
export function groupNewPanesEnabled(): boolean {
  return grouping.provider?.groupNewPanes ?? false;
}

/** Why a particular grouping container won, so the caller can report it. */
export type GroupingChoiceReason =
  /** The caller asked for this one and it declares grouping. */
  | 'requested'
  /** Exactly one container declares grouping, so there was nothing to choose. */
  | 'only'
  /** Several declare and nothing was requested; the name-sorted first won. */
  | 'defaulted'
  /** Something was requested but declares no grouping; the name-sorted first won instead. */
  | 'request-unresolved'
  /** Nothing declares grouping at all. */
  | 'none';

export interface GroupingChoiceOutcome {
  chosen: GroupingCapability | null
  reason: GroupingChoiceReason
  /** Every declarer's type name, name-sorted. */
  available: string[]
  /** What was asked for, when a request was made. */
  requested?: string
}

/**
 * Choose which declared container a NEW group is built with. PURE — no lookup, no reporting — so
 * the rule is testable in isolation and the caller decides how to surface it.
 *
 * The substrate owns the RULE (it is the consumer) but knows nothing about where a request comes
 * from; the host supplies one from the composition's `grouping-choice.group-into`. That is what
 * keeps the framework free of any container's name: the only way one wins by default is by sorting
 * first among whatever happens to be declared.
 *
 * Order: an unresolvable request falls through to the default rather than failing the drop, and
 * says so — refusing outright would break grouping over a typo the engine could not catch (its
 * def-ref bound checks the target IS a container-projection, not that it declares grouping).
 */
// ── WRAP-TARGET registry — the DECOUPLED sibling of the grouping provider above.

// The grouping provider (above) is the DROP's stack-group set: `groupingForKind` / `isGroupingKind` decide
// whether a center-drop ADDS a child, and it is the drop's new-group default. The WRAP action offers a
// WIDER set — grouping ∪ spatial containers (tabs, column, bento, canvas) — WITHOUT changing that drop
// behaviour: a spatial container is a wrap target but NOT a grouping kind, so `isGroupingKind('bento')`
// stays false and center-drop-onto-bento still wraps. So the wrap targets live in their OWN registry, read
// by `wrapPane` / the floor's `pickWrapKind`, never by the drop path. Family-tagged so the picker sections
// Stack (grouping) from Arrange (spatial).


/** A container a pane can be WRAPPED into: a grouping capability plus its FAMILY (which picker section). */
export interface WrapTarget extends GroupingCapability {
  /** `grouping` = a flat STACK group (tabs, column); `spatial` = a SPATIAL layout (bento, canvas). Drives
   *  the wrap picker's Stack / Arrange sectioning. */
  family: 'grouping' | 'spatial';
}

/** Install the wrap-target registry: the family-tagged UNION, plus the composition's `group-into` so the
 *  outcome respects it. `null`/empty clears it (teardown). Idempotent; re-call on a type-graph or
 *  composition change, like the grouping provider. */
export function setWrapTargets(targets: WrapTarget[], groupInto?: string): void {
  wrapTargetsHolder.targets = targets;
  wrapTargetsHolder.outcome = targets.length > 0 ? chooseGrouping(targets, groupInto) : null;
}

/** Every wrap target (grouping ∪ spatial), family-tagged. Empty when none is installed. */
export function wrapTargets(): WrapTarget[] {
  return wrapTargetsHolder.targets;
}

/** The wrap target for a container kind (bare name or `::`-qualified), or null. Reads the UNION — so it
 *  resolves bento (spatial) where `groupingForKind` (grouping-only) would not. */
export function wrapTargetForKind(kind: ContainerKind | string | undefined): WrapTarget | null {
  if (!kind) return null;
  const bare = (n: string): string => n.split('::')[0] ?? n;
  const b = bare(kind);
  return wrapTargetsHolder.targets.find((t) => bare(t.typeName) === b) ?? null;
}

/** The wrap-target new-group OUTCOME (chosen + reason + available), over the UNION and respecting
 *  `group-into`. The floor reads `reason` to use the composition's choice silently (`requested` / `only`)
 *  or open the family-sectioned picker (`defaulted`). Null when nothing is installed. */
export function wrapTargetOutcome(): GroupingChoiceOutcome | null {
  return wrapTargetsHolder.outcome;
}

export function chooseGrouping(
  capabilities: readonly GroupingCapability[],
  requested?: string,
): GroupingChoiceOutcome {
  const sorted = [...capabilities].sort((a, b) => a.typeName.localeCompare(b.typeName));
  const available = sorted.map((c) => c.typeName);
  const bare = (n: string): string => n.split('::')[0] ?? n;
  if (sorted.length === 0) return { chosen: null, reason: 'none', available };

  // `request-unresolved` is a grouping-domain nuance the generic ladder does not carry: a request naming
  // a container that declares no grouping falls through to the default AND says so (the def-ref bound only
  // guarantees the target IS a container, not that it groups — so a typo must not fail the drop). Kept
  // here explicitly; the shared ladder decides the rest.
  const hit = requested ? sorted.find((c) => bare(c.typeName) === bare(requested)) : undefined;
  if (requested && !hit) return { chosen: sorted[0], reason: 'request-unresolved', available, requested };

  // The value instantiation of the one ladder over the name-sorted set: a matched request is the
  // "configured" default, else the count decides (sole → `only`, 2+ → `defaulted`, the alphabetical pick).
  const outcome = resolveDecision({
    candidates: available.map(bare),
    configured: hit ? bare(hit.typeName) : undefined,
  });
  switch (outcome.kind) {
    case 'configured':
      return { chosen: hit!, reason: 'requested', available, requested };
    case 'sole':
      return { chosen: sorted[0], reason: 'only', available };
    case 'ask':
      return { chosen: sorted[0], reason: 'defaulted', available };
    case 'nothing':
      // Unreachable — sorted.length > 0 here — but keeps the switch total.
      return { chosen: null, reason: 'none', available };
  }
}
