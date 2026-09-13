/**
 * SLOT-RULE ENFORCEMENT — the substrate owns the rule, once, for every container.
 *
 * A `container-slot` carries what belongs to a POSITION: `admits` (what may occupy it) and `fixed`
 * (the occupant may not be dragged out, closed, or displaced by a restructure). A container answers
 * `slotFor(id)`; everything in this file is the substrate deciding what the answer MEANS.
 *
 * WHY HERE AND NOT IN EACH CONTAINER. The check is generic: read the slot, compare `admits`, honour
 * `fixed`. `slotFor` separates container-specific position lookup from shared enforcement:
 * the container knows which slot sits at an id; the substrate knows what its rules mean.
 *
 * THE RULE AT THE DESTRUCTIVE SEAMS: never destroy state you might not be allowed to write. Asking
 * BEFORE extracting is what makes a refusal safe, rather than a rollback after loss.
 *
 * A container with no `slotFor` is UNENFORCED. That is correct for one with no placement seam, not
 * a hole: it has no slots to govern.
 *
 * WHAT THIS DOES NOT CLOSE, stated rather than discovered later: a DIALECT can still emit a target
 * the seam then refuses, so a drop PREVIEW may promise a placement that does not happen. Deliberate
 * ordering — a wrong preview is cosmetic, a lost pane is not, and the refusal is what makes the
 * guarantee real. It closes by deriving emission from the same slot rules.
 *
 *
 */

import type { ContainerPlacement, ContainerSlot } from '@arsumbris/au-host-sdk';
import { reportHostDiagnostic, event, on } from '@arsumbris/au-host-sdk';
import { findContainerRoot, slotTypes } from './singletons.ts';

/** The gesture a refusal names, so a diagnostic says which seam refused and why. */
export type SlotGesture = 'drag-start' | 'reorder' | 'move' | 'group' | 'dissolve' | 'close' | 'place';

/** How a refusal reads for each gesture, so the message names what was actually attempted. */
const REFUSAL: Record<SlotGesture, string> = {
  'drag-start': 'dragged out of it',
  reorder: 'reordered',
  move: 'moved out of it',
  group: 'displaced by a group',
  dissolve: 'displaced by a dissolve',
  close: 'closed',
  place: 'replaced',
};

/**
 * The host's handle on TYPE-CLOSURE, injected exactly as the grouping lookup is.
 *
 * `admits` must be checked by CLOSURE, never by exact type match: a slot admitting `pane-projection`
 * admits every pane, and a slot admitting `notification` admits its subtypes.
 *
 * WHY INJECTED. Answering it needs the TYPE GRAPH, and this package is a library that is never
 * mounted, so it has no engine access. The host already computes each projection's full kind
 * closure in its ONE `subtypes` discovery pass, so it installs a predicate over data it holds.
 */
export interface SlotTypeProvider {
  /**
   * Is `candidate` the type `admitted`, or a subtype of it? Both are projection type names, which
   * may arrive `::repo`-qualified. Absent / unknown `candidate` should answer FALSE at a slot that
   * declares `admits`: a rule that cannot be evaluated must not silently pass.
   */
  isA: (candidate: string | undefined, admitted: string) => boolean;
}

/** Install the type-closure predicate. `null` clears it (teardown). */
export function setSlotTypeProvider(provider: SlotTypeProvider | null): void {
  slotTypes.provider = provider;
}

/**
 * The bare NAME of a `type<projection>*` def-ref value:
 * `[[rail]]` -> `rail`, `[[rail::rail]]` -> `rail`, `[[type/rail.type.yaml::rail]]` -> `rail`.
 *
 * All three forms resolve against a live daemon, so the bare one is what an author writes; the
 * verbose path form is accepted because it exists in authored files today.
 */
export function refToTypeName(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  let s = ref.trim();
  const m = /^\[\[(.+?)\]\]$/.exec(s);
  if (m) s = m[1]!;
  s = s.split(/[:#^|]/)[0] ?? s; // drop ::repo / #head / ^id / |alias
  const base = s.split('/').pop() ?? s; // basename over an entry path
  const name = base.replace(/\.type(\.ya?ml)?$/, ''); // strip a .type(.yaml) tail
  return name || undefined;
}

/** The slot governing this id, or null. Null whenever the container declares no `slotFor`. */
export function slotFor(placement: ContainerPlacement, id: string): ContainerSlot | null {
  return placement.slotFor?.(id) ?? null;
}

/** Whether a slot would refuse an occupant of this type. A slot with no `admits` admits anything. */
export function slotAdmits(slot: ContainerSlot | null, type: string | undefined): boolean {
  const admits = slot?.admits;
  if (!admits || admits.length === 0) return true;
  const provider = slotTypes.provider;
  if (!provider) {
    // No closure predicate installed, so the rule CANNOT be evaluated. Refusing would break every
    // drop in a host that never installed one; passing would silently drop the guarantee. Passing
    // is chosen, and SAID OUT LOUD, because the alternative fails closed on a host-wiring bug
    // rather than on anything the author did.
    reportHostDiagnostic({
      code: 'slot-admits-unevaluable',
      severity: 'warning',
      message:
        'a slot declares `admits` but no type-closure provider is installed, so the rule could not be evaluated and the occupant was allowed',
      detail: { admits: [...admits], incoming: type },
    });
    return true;
  }
  return admits.some((ref) => {
    const name = refToTypeName(ref as unknown as string);
    return name !== undefined && provider.isA(type, name);
  });
}

/**
 * Would this gesture DISPLACE the occupant of a `fixed` slot? Reports the refusal.
 *
 * `fixed` reaches DEEP: any operation that would displace the occupant is refused, not merely a
 * drag. That is why this is called at the reorder and dissolve seams too, and not only at drag
 * start.
 */
export function displacementRefused(
  placement: ContainerPlacement | undefined,
  localId: string,
  gesture: SlotGesture,
): boolean {
  if (!placement) return false;
  const slot = slotFor(placement, localId);
  if (!slot?.fixed) return false;
  reportHostDiagnostic({
    code: 'slot-fixed-refused',
    severity: 'hint',
    message: `this slot is fixed, so its occupant cannot be ${REFUSAL[gesture]}`,
    detail: { gesture, id: localId },
  });
  // A point-in-time placement rejection — trace it under the ambient cause (the fire that drove this
  // gesture), so "why did that pane refuse to move" reads under the pass, not just as a standing hint.
  if (on('placement')) event('placement', 'fixed-refused', { gesture, id: localId });
  return true;
}

/**
 * Would this target slot refuse an occupant of this type? Reports the refusal.
 *
 * Called BEFORE any destructive extract, which is the whole point: a refusal after an extract is a
 * lost subtree, and "refuse then roll back" is the family of bug this ordering removes.
 */
export function occupantRefused(
  placement: ContainerPlacement | undefined,
  slotId: string,
  type: string | undefined,
  gesture: SlotGesture,
): boolean {
  if (!placement) return false;
  const slot = slotFor(placement, slotId);
  if (slotAdmits(slot, type)) return false;
  reportHostDiagnostic({
    code: 'slot-admits-refused',
    severity: 'hint',
    message: 'this slot does not admit that projection type',
    detail: { gesture, slotId, incoming: type, admits: [...(slot?.admits ?? [])] },
  });
  if (on('placement')) event('placement', 'admits-refused', { gesture, slotId, incoming: type, admits: [...(slot?.admits ?? [])] });
  return true;
}

/**
 * Would a target slot refuse to be RESTRUCTURED — a centre-wrap replacing its occupant with a
 * container holding it, or a dissolve replacing it with a lone child?
 *
 * Both are occupant-TYPE changes at the TARGET, so both answer to the target's own `fixed` and
 * `admits`. `fixed` is checked against the slot itself here rather than against a child id, because
 * the thing being displaced IS what sits in that slot.
 */
export function restructureRefused(
  placement: ContainerPlacement | undefined,
  slotId: string,
  incomingType: string | undefined,
  gesture: SlotGesture,
): boolean {
  if (!placement) return false;
  if (displacementRefused(placement, slotId, gesture)) return true;
  return occupantRefused(placement, slotId, incomingType, gesture);
}

/** The projection type name carried by an instance config, when it has one. */
export function typeOfInstance(instance: unknown): string | undefined {
  const t = (instance as { type?: unknown } | null | undefined)?.type;
  return typeof t === 'string' ? t : undefined;
}

/**
 * SEAM 1 — drag start. Whether a drag beginning at `sourceEl` is refused because the slot holding
 * `localId` is fixed.
 *
 * Framework-free and DOM-driven: it walks up to the nearest registered container root, exactly as
 * the router does, so a vanilla container gets this from the same call the React hook makes. A drag
 * that never starts cannot be dropped anywhere, which makes this the cheapest of the five seams and
 * the only one the user feels directly.
 *
 * The AFFORDANCE (no drag handle, a lock glyph instead) stays the container's own render. This is
 * the backstop for when it is bypassed, not a replacement for it.
 */
export function dragStartRefused(sourceEl: Element | null, localId: string): boolean {
  const container = findContainerRoot(sourceEl);
  return displacementRefused(container?.placement, localId, 'drag-start');
}
