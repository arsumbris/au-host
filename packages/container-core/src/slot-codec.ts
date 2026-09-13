/**
 * Reads and writes a container position's union of a bare projection and a slot record.
 * Slot type names and extra fields vary by container; normalization and identity are shared.
 * Slot records are recognized by type closure through the host-installed predicate, so a
 * subtype retains its position rules instead of being mistaken for a bare child projection.
 * Container-specific wrappers, entry ids and tree nodes remain owned by each container.
 */

import { bareTypeName, reportHostDiagnostic } from '@arsumbris/au-host-sdk';
import type { ContainerSlot, Occupant } from '@arsumbris/au-host-sdk';
import { slotTypes } from './singletons.ts';
import { mintBlockId } from './block-id.ts';

/**
 * What a POSITION says, when it says anything.
 *
 * The four base fields every `container-slot` carries, plus `E` — whatever the container's own slot
 * SUBTYPE adds and the container actually honours (`size` / `collapsed` on sandwich and column;
 * nothing on tabs, dock and bento). Generic rather than open, so a typo in an extra is a compile
 * error rather than a silently-dropped field.
 */
export type SlotState<E extends object = Record<never, never>> = {
  /** The slot record's OWN `^:` id — the POSITION's identity, distinct from its occupant's. */
  id?: string;
  /** What may occupy it, as authored def-ref links. Absent admits anything. */
  admits?: readonly string[];
  /** The occupant may not be dragged out, closed, or displaced by a restructure. */
  fixed?: boolean;
  /** The PER-SLOT default placeholder this EMPTY position resolves to, as an authored def-ref link. Unlike
   *  `label` / `hideHeader` it CROSSES to the placement seam (`toSeamSlot`): the empty-slot driver reads it
   *  as the `configured` rung, overriding the composition-wide `slot-defaults`. */
  placeholder?: string;
  /** What the container's chrome titles this position; absent falls back to the occupant's name. */
  label?: string;
  /** Draw no per-child header at this position (a self-chrome occupant owns its surface). A
   *  container MUST choose to honour it; some ignore it. Presentational — it does not cross to the
   *  placement seam (see `toSeamSlot`), the same as `label`. */
  hideHeader?: boolean;
  /**
   * Every field on the authored slot record this container does NOT understand, carried verbatim.
   *
   * A slot record is an instance like any other, so the rule that governs a projection's config
   * governs it too: **emit what you own, return the rest untouched.** A container that rebuilt only
   * the fields it knows would silently delete a field a THIRD-PARTY subtype of its slot added, or a
   * base field shipped after it was written — the exact failure `preserveUnowned` exists to stop,
   * one level deeper, and invisible because the file stays valid and just stops saying something.
   *
   * Opaque on purpose: a container must never read this. It exists to survive a round trip.
   *
   *
   * whose rule this recursion completes.
   */
  carried?: Readonly<Record<string, unknown>>;
} & E;

// au-host-sdk owns Occupant<C>, the value shared by placement methods and this slot codec.

/** One position, as the container's runtime holds it: what sits here, and what the position says. */
export interface Position<C, E extends object = Record<never, never>> {
  child?: Occupant<C>;
  slot: SlotState<E>;
}

/** The `^:` block-id an inline record carries, if any. Identity-layer, never a declared field. */
export function persistedId(record: object | undefined): string | undefined {
  if (!record) return undefined;
  const id = (record as Record<string, unknown>)['^'];
  return typeof id === 'string' ? id : undefined;
}

/** How a container declares the union it reads and writes. */
export interface SlotCodecOptions<E extends object> {
  /**
   * The slot type this container writes, BARE (`sandwich-slot`, or `container-slot` for a container
   * that adds nothing). A record whose `type:` is this OR ANY SUBTYPE of it reads as a slot.
   */
  slotType: string;
  /**
   * The extra fields this container HONOURS, beyond the four base ones. Keys are checked against
   * `E`, so a name that is not on the state type fails to compile.
   *
   * DECLARED HERE RATHER THAN DERIVED from the slot subtype's own fields, and the difference is the
   * point: the type-def says what may be AUTHORED, this says what the container ACTS ON. They should
   * agree, and the type-def is what makes an author unable to write a field nothing honours — but
   * honouring is code, so the code is what declares it.
   */
  extras?: readonly (keyof E & string)[];
  /**
   * Appended to the written `type:`, for a composition whose types are `::repo`-qualified.
   * Empty for an unqualified one.
   */
  qualifier?: string;
  /** The container's name, for the one error message this can raise. */
  label: string;
}

export interface SlotCodec<C, E extends object> {
  /** Is this union value a slot record rather than a bare child? Resolved by CLOSURE. */
  isSlotRecord(value: unknown): boolean;
  /** Does this slot have anything to say? The materialize / collapse predicate, both directions. */
  speaks(slot: SlotState<E> | undefined): boolean;
  /** Does this POSITION survive its child being closed? Only when it still governs something. */
  survivesEmpty(slot: SlotState<E> | undefined): boolean;
  /** Read one union value into the runtime shape. An absent value is an empty, unruled position. */
  read(value: unknown): Position<C, E>;
  /** Write one position back to its union value, or `undefined` when there is nothing to write. */
  write(pos: Position<C, E>): unknown;
  /**
   * The slot as the SEAM speaks it: the base `ContainerSlot`, or null when the position says
   * nothing. What every container's `slotFor` returns.
   *
   * ONLY `admits` and `fixed` cross. The extras are the container's own rendering concern — the
   * substrate has no idea what a size or a collapse would mean, and handing it fields it cannot act
   * on is the mirror of letting an author write one the container cannot act on.
   */
  toSeamSlot(slot: SlotState<E> | undefined): ContainerSlot | null;
}

/**
 * Is a value MEANINGFUL — i.e. worth writing, and enough on its own to keep a slot alive?
 *
 * ONE RULE for every field, base and extra alike: present, and not `false`. For example, `collapsed: false` and `fixed: false` say nothing,
 * and neither does an absent size. A single rule is also what keeps `speaks` and `write` from
 * drifting, which is the whole reason they sit in one file.
 */
function meaningful(v: unknown): boolean {
  if (v === undefined || v === false) return false;
  return !Array.isArray(v) || v.length > 0;
}

export function makeSlotCodec<C, E extends object = Record<never, never>>(
  opts: SlotCodecOptions<E>,
): SlotCodec<C, E> {
  const { slotType, extras = [], qualifier = '', label } = opts;
  const BASE = ['id', 'admits', 'fixed', 'placeholder', 'label', 'hideHeader'] as const;

  const noRefs = (): never => {
    // A wikilink at a child position is a REFERENCED view. The model admits it (`child?` carries the
    // reference suffix) and no container resolves one yet, so this is a real gap stated loudly
    // rather than a value silently read as an empty position.
    throw new Error(`${label}: position references are not supported yet (inline children only)`);
  };

  const isSlotRecord = (value: unknown): boolean => {
    if (value == null || typeof value !== 'object') return false;
    const t = bareTypeName((value as { type?: string }).type);
    if (!t) return false;
    // BY CLOSURE when the host has installed the predicate, so a subtype of this container's slot
    // reads as a slot. Without it — a unit test, or a mount before discovery has run — fall back to
    // the exact name.
    return slotTypes.provider ? slotTypes.provider.isA(t, slotType) : t === slotType;
  };

  const speaks = (slot: SlotState<E> | undefined): boolean => {
    if (!slot) return false;
    const s = slot as Record<string, unknown>;
    // A CARRIED field counts. A slot whose only content is a field this container does not
    // understand still has something to say — collapsing it to a bare child would delete that
    // field, which is precisely what the carrying exists to prevent.
    if (Object.keys(slot.carried ?? {}).length > 0) return true;
    return [...BASE, ...extras].some((k) => meaningful(s[k]));
  };

  const survivesEmpty = (slot: SlotState<E> | undefined): boolean => {
    // DELIBERATELY NOT `speaks`. A position kept alive by `admits` still says what may occupy it,
    // and one with an `^:` id may be pointed at — dropping either would silently lose the pin, which
    // is the exact defect the whole slot model exists to remove. `size` / `collapsed` / `label` do
    // NOT keep an empty entry alive: per-position sizing of a row that holds nothing is not a thing
    // anyone asked for. A `fixed` position never reaches here, since `fixed` refuses the close.
    if (!slot) return false;
    return (slot.admits?.length ?? 0) > 0 || slot.placeholder !== undefined || slot.id !== undefined;
  };

  // Mint a missing child id through the shared substrate authority. Pool id prefixes carry no container meaning.

  const readChild = (child: unknown): Occupant<C> | undefined => {
    if (child === undefined || child === null) return undefined;
    if (typeof child === 'string') noRefs();
    return { id: persistedId(child as object) ?? mintBlockId(), instance: child as C };
  };

  return {
    isSlotRecord,
    speaks,
    survivesEmpty,

    toSeamSlot(slot: SlotState<E> | undefined): ContainerSlot | null {
      if (!speaks(slot)) return null;
      const out: ContainerSlot = { type: 'container-slot' };
      // The codec types `admits` framework-free as `readonly string[]`; the generated shape is a
      // non-empty tuple of def-refs. Same values — the `[+]` arity is the ENGINE's to enforce at
      // validation, never a runtime cast's, so this asserts nothing it could be wrong about.
      if (slot!.admits !== undefined) out.admits = slot!.admits as ContainerSlot['admits'];
      if (slot!.fixed !== undefined) out.fixed = slot!.fixed;
      // `placeholder` crosses to the seam (the empty-slot driver reads it), unlike the presentational
      // `label` / `hideHeader`. The codec types it framework-free as a `string` def-ref; the generated
      // shape is a `DefRef` — the same value.
      if (slot!.placeholder !== undefined) out.placeholder = slot!.placeholder as ContainerSlot['placeholder'];
      return out;
    },

    read(value: unknown): Position<C, E> {
      if (typeof value === 'string') noRefs();
      if (value == null) return { slot: {} as SlotState<E> };
      if (!isSlotRecord(value)) {
        // The BARE branch: the record IS the child, and the position says nothing.
        return { child: readChild(value)!, slot: {} as SlotState<E> };
      }
      const rec = value as Record<string, unknown>;
      // FOOTGUN GUARD. `write` re-stamps ONE fixed `slotType`, discarding whatever `type` was read
      // (safe only while there is ONE slot type per container). `isSlotRecord` accepts a SUBTYPE by
      // closure — correctly, it IS a slot — but re-stamping the parent on the next save FLATTENS the
      // subtype's identity, silently: exactly the "valid file that stops saying what its author
      // wrote" the slot model exists to prevent. So the moment a second slot type per container
      // exists, this fires LOUD at the read seam instead of corrupting quietly at the write seam.
      // The real fix if a second type is ever wanted is per-type write handling, not this guard.
      const recType = bareTypeName(rec['type'] as string | undefined);
      if (recType && recType !== slotType) {
        reportHostDiagnostic({
          code: 'slot-subtype-flattened',
          severity: 'warning',
          message: `${label}: a '${recType}' slot record reads fine but will be RE-SERIALIZED as '${slotType}' on the next save — the codec re-stamps one slot type per container, so a distinct subtype loses its identity. Teach the codec per-type write handling before introducing a second slot type.`,
          subject: recType,
          detail: { read: recType, willWrite: slotType, container: label },
        });
      }
      const slot = {} as Record<string, unknown>;
      const pid = persistedId(rec);
      if (pid !== undefined) slot['id'] = pid;
      const understood = new Set(['admits', 'fixed', 'placeholder', 'label', 'hideHeader', ...extras]);
      for (const k of understood) {
        if (rec[k] !== undefined) slot[k] = rec[k];
      }
      // EVERYTHING ELSE, carried. `type` / `^` / `child` are structural and re-emitted by `write`;
      // the remainder is a field this container does not understand and must not destroy.
      const carried: Record<string, unknown> = {};
      for (const k of Object.keys(rec)) {
        if (k === 'type' || k === '^' || k === 'child' || understood.has(k)) continue;
        carried[k] = rec[k];
      }
      if (Object.keys(carried).length > 0) slot['carried'] = carried;
      const child = readChild(rec['child']);
      return { ...(child === undefined ? {} : { child }), slot: slot as SlotState<E> };
    },

    write(pos: Position<C, E>): unknown {
      const { child, slot } = pos;
      // THE OCCUPANT IS A REFERENCE into the composition pool, never inline: `[[^^childId]]`. The
      // child's config lives in the pool as its own record (the host is its single writer), so a
      // container's record embeds only its own dialect + child ref-ids, and no parent ever
      // re-serializes a stale child (the re-parent duplication class dies). The host RESOLVES these
      // refs back to inline records before a container READS (`resolvePoolToTree`), so `read` still
      // only ever sees inline occupants — the codec is one half of a host-mediated cycle.

      const body = child === undefined ? undefined : `[[^^${child.id}]]`;
      if (!speaks(slot)) {
        // NOTHING TO SAY, SO NO SLOT RECORD IS WRITTEN. This is what keeps an unruled composition
        // byte-identical to one authored before slots existed, and it is the whole reason the union
        // has a bare branch at all.
        return body;
      }
      const s = slot as Record<string, unknown>;
      const out: Record<string, unknown> = { type: `${slotType}${qualifier}` };
      if (meaningful(s['id'])) out['^'] = s['id'];
      // Preserve serialized key order: rules, container extras, label, then occupant.
      // Stable ordering avoids unnecessary diffs in composition files.
      for (const k of ['admits', 'fixed', 'placeholder', ...extras, 'label', 'hideHeader']) {
        if (meaningful(s[k])) out[k] = s[k];
      }
      // The unowned remainder, returned untouched. AFTER the understood fields, so an authored file
      // keeps its familiar shape; a carried key can never collide with one, since `read` only
      // carries what it did not understand.
      for (const [k, v] of Object.entries(slot.carried ?? {})) out[k] = v;
      if (body !== undefined) out['child'] = body;
      return out;
    },
  };
}
