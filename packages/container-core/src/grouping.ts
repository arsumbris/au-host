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
import { projectionLabel } from './projection-label.ts';

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
   * Declared on the container's type-def (`arity-meta.min`), resolved by the host from the type graph.
   */
  minChildren?: number
  /**
   * The most children one wrap may put into it. Undefined = unbounded. Declared on the type-def
   * (`arity-meta.max`); every `frame-container` inherits `max: 1`.
   */
  maxChildren?: number
  /** The container's display name, from its type-def's presentation title. Absent: the picker derives
   *  one from the type name. Carried with the capability so every wrap picker, in every window, reads the
   *  same label without being handed a labeller. */
  label?: string
}

/** Does this container take `n` children in one wrap? `(min ?? 1) <= n <= (max ?? unbounded)`. */
export function admitsChildren(cap: Pick<GroupingCapability, 'minChildren' | 'maxChildren'>, n: number): boolean {
  return (cap.minChildren ?? 1) <= n && n <= (cap.maxChildren ?? Number.POSITIVE_INFINITY)
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
// WIDER set — grouping ∪ spatial ∪ frame containers (tabs, column; bento; sandwich, dock) — WITHOUT changing
// that drop behaviour: only a grouping container is a stack-group, so center-drop-onto-bento still wraps.
// So the wrap targets live in their OWN registry, read by every wrap flow through `wrapChoice`, never by the
// drop path.
//
// Every wrap flow passes a child COUNT. A target is a candidate only when it ADMITS that count
// (`admitsChildren`), so a frame (`max: 1`) is offered for a solo wrap and never for a two-child one.

/** Which picker section a wrap-target family renders under, in picker order. */
export const WRAP_SECTIONS = { grouping: 'Stack', spatial: 'Arrange', frame: 'Frame' } as const;

/** A container a pane can be WRAPPED into: a grouping capability plus its FAMILY (which picker section). */
export interface WrapTarget extends GroupingCapability {
  /** `grouping` = a flat STACK group (tabs, column); `spatial` = a SPATIAL layout (bento); `frame` = a fill
   *  `center` plus peripheral chrome (sandwich, dock). Drives the Stack / Arrange / Frame sectioning. */
  family: keyof typeof WRAP_SECTIONS;
}

/** Install the wrap-target registry: the family-tagged UNION, plus the composition's `group-into`, which
 *  `wrapChoice` honours when it names a target admitting the wrap's child count. Empty clears it
 *  (teardown). Idempotent; re-call on a type-graph or composition change, like the grouping provider. */
export function setWrapTargets(targets: WrapTarget[], groupInto?: string): void {
  wrapTargetsHolder.targets = targets;
  wrapTargetsHolder.groupInto = groupInto;
}

/** Every wrap target (grouping ∪ spatial ∪ frame), family-tagged. Empty when none is installed. */
export function wrapTargets(): WrapTarget[] {
  return wrapTargetsHolder.targets;
}

/** The wrap targets that admit `n` children. */
export function wrapTargetsFor(n: number): WrapTarget[] {
  return wrapTargetsHolder.targets.filter((t) => admitsChildren(t, n));
}

/** The wrap target for a container kind (bare name or `::`-qualified), or null. Reads the UNION — so it
 *  resolves bento (spatial) where `groupingForKind` (grouping-only) would not. */
export function wrapTargetForKind(kind: ContainerKind | string | undefined): WrapTarget | null {
  if (!kind) return null;
  const bare = (n: string): string => n.split('::')[0] ?? n;
  const b = bare(kind);
  return wrapTargetsHolder.targets.find((t) => bare(t.typeName) === b) ?? null;
}

/**
 * What a wrap of `n` children builds with: the requested kind, else the new-group default. The ONE
 * resolution every wrap path (substrate and authority) takes, so each refusal names its own cause:
 * nothing to build with (`no-grouping`) is not the same as a kind that cannot hold `n` (`arity-refused`,
 * a frame asked to hold two).
 */
export type WrapBuild =
  | { cap: GroupingCapability }
  | { refused: 'no-grouping' }
  | { refused: 'arity-refused'; typeName: string; n: number };

export function wrapBuildFor(requestedKind: string | undefined, n: number): WrapBuild {
  const cap = (requestedKind ? wrapTargetForKind(requestedKind) : null) ?? groupingForNewGroup();
  if (!cap) return { refused: 'no-grouping' };
  if (!admitsChildren(cap, n)) return { refused: 'arity-refused', typeName: cap.typeName, n };
  return { cap };
}

/** One family-sectioned picker option. */
export interface WrapOption { id: string; label: string; section: string }

/**
 * THE wrap choice for a wrap of `n` children — the ONE place every wrap flow resolves its container.
 *
 * Candidates are the targets admitting `n`. `use` is set when no ask is needed: the composition's
 * `group-into` names a candidate, or there is exactly one. A `group-into` naming a container that does NOT
 * admit `n` is inapplicable to this wrap, not an error: the choice proceeds as if it were unset. `options`
 * is always the full family-sectioned candidate list (Stack, then Arrange, then Frame), for a caller that
 * asks or shows alternatives. No candidate: `options` is empty and `use` undefined.
 */
export function wrapChoice(n: number): { use?: string; options: WrapOption[] } {
  const candidates = wrapTargetsFor(n);
  if (candidates.length === 0) return { options: [] };
  const bare = (t: string): string => t.split('::')[0] ?? t;
  const requested = wrapTargetsHolder.groupInto;
  const applicable = requested !== undefined && wrapTargetsHolder.targets.some((t) => bare(t.typeName) === bare(requested))
    && !candidates.some((t) => bare(t.typeName) === bare(requested))
    ? undefined
    : requested;
  const outcome = chooseGrouping(candidates, applicable);
  const order = Object.keys(WRAP_SECTIONS) as Array<WrapTarget['family']>;
  const options = [...candidates]
    .sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family))
    .map((t) => ({ id: t.typeName, label: t.label ?? projectionLabel(t.typeName), section: WRAP_SECTIONS[t.family] }));
  const silent = (outcome.reason === 'requested' || outcome.reason === 'only') && outcome.chosen;
  return { ...(silent ? { use: outcome.chosen!.typeName } : {}), options };
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
