/**
 * Reads and writes a container position's union of a bare child and a slot record.
 *
 * The codec is bound to a SITE, a container's child-bearing field, and asks the type graph what that
 * field admits. It never declares a slot type of its own: the derived schema (`slotFieldOf`) says which
 * slot types the field's union names, so a field typed to bare children (dock's `bar-projection*[]`
 * edges) reads and writes bare children only, and a field typed to a slot subtype writes that subtype.
 * A slot record is recognized by type closure (is-a `container-slot`), so a subtype keeps its rules.
 * Container-specific wrappers, entry ids and tree nodes remain owned by each container.
 */

import { bareTypeName, reportHostDiagnostic, slotRuleMeaningful } from '@arsumbris/au-host-sdk';
import type { ContainerSlot, Occupant, SlotField } from '@arsumbris/au-host-sdk';
import { slotTypes } from './singletons.ts';
import { slotFieldOf } from './slots.ts';
import { mintBlockId } from './block-id.ts';

/** The slot base every slot type descends from. A record whose type is-a this is a slot record. */
const SLOT_ROOT = 'container-slot';

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
  /** The slot record's own `type:` as authored (`sandwich-slot::sandwich`, a third-party subtype).
   *  Written back verbatim, so a subtype keeps its identity. Absent for a position read bare; a
   *  freshly materialized record takes the field's declared slot type. Identity, never a rule. */
  type?: string;
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
   * The child position this codec reads and writes: a container or structural-node type (BARE, the
   * module's own base type) and one of its child-bearing fields. The field's derived shape decides which
   * slot types it admits; a subtype of the container inherits the field unchanged.
   */
  site: { type: string; field: string };
  /**
   * The extra fields this container HONOURS, beyond the base ones. Keys are checked against `E`, so a
   * name that is not on the state type fails to compile.
   *
   * DECLARED HERE RATHER THAN DERIVED from the slot subtype's own fields, and the difference is the
   * point: the type-def says what may be AUTHORED, this says what the container ACTS ON. They should
   * agree, and the type-def is what makes an author unable to write a field nothing honours — but
   * honouring is code, so the code is what declares it.
   */
  extras?: readonly (keyof E & string)[];
  /** The container's name, for the diagnostics this can raise. */
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
  /**
   * An EMPTY slot record of this site's declared slot type, qualified by its owner: an unoccupied
   * position a container must keep in its record (bento's branch needs two children). Throws when the
   * site's shape is not derived or it admits no slot record, since neither can hold an empty position.
   */
  emptyRecord(): Record<string, unknown>;
}

/**
 * Is a value MEANINGFUL — worth writing, and enough on its own to keep a slot alive? ONE RULE for
 * every field, base and extra alike: present, not `false`, and (for a list) non-empty. `slotRuleMeaningful`
 * is owned by au-host-sdk (the slot vocabulary's home), so the host's raw-pool-form `setSlotRules` and this
 * resolved-form codec materialize / collapse a slot by the SAME predicate — no drift between the two writers.
 */
const meaningful = slotRuleMeaningful;

export function makeSlotCodec<C, E extends object = Record<never, never>>(
  opts: SlotCodecOptions<E>,
): SlotCodec<C, E> {
  const { site, extras = [], label } = opts;
  const BASE = ['id', 'admits', 'fixed', 'placeholder', 'label', 'hideHeader'] as const;
  const field = (): SlotField | undefined => slotFieldOf(site.type, site.field);

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
    // BY CLOSURE: slot types and projections are disjoint trees, so "is-a container-slot" is the whole
    // question. Without the predicate (a unit test, or a mount before discovery) the field's own derived
    // slot types, else the base name, are the exact-name floor.
    const provider = slotTypes.provider;
    if (provider) return provider.isA(t, SLOT_ROOT);
    return field()?.slotTypes.includes(t) ?? t === SLOT_ROOT;
  };

  /** Does this site's field admit a slot record of type `t`? Unknown until schemas are installed. */
  const admitted = (t: string): boolean => {
    const f = field();
    if (!f) return true;
    const provider = slotTypes.provider;
    return f.slotTypes.some((s) => (provider ? provider.isA(t, s) : t === s));
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

  /** The slot type a freshly materialized record at this site claims: the field's first declared
   *  slot type, qualified by its owner so a composition in another repo claims it validly. */
  const declaredType = (): string | undefined => {
    const f = field();
    return f?.slotTypesQualified[0] ?? f?.slotTypes[0];
  };

  return {
    isSlotRecord,
    speaks,
    survivesEmpty,

    emptyRecord(): Record<string, unknown> {
      const type = declaredType();
      if (type === undefined) {
        throw new Error(`${label}: '${site.type}.${site.field}' ${field() ? 'admits no slot record' : 'has no derived shape (container schemas not installed)'}, so it cannot hold an empty position`);
      }
      return { type };
    },

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
      const recType = rec['type'] as string;
      if (!admitted(bareTypeName(recType))) {
        // The field's type holds no slot of this kind (dock's edges hold bars, bare), so no rule here
        // can mean anything. The occupant is kept; the rules are dropped on the next save, and said so.
        reportHostDiagnostic({
          code: 'slot-record-not-admitted',
          severity: 'warning',
          message: `${label}: '${site.field}' holds ${field()?.slotTypes.length ? `only ${field()!.slotTypes.join(' / ')} slot records` : 'no slot records'}, so a '${bareTypeName(recType)}' record there is read as its child alone; its rules are ignored and dropped on the next save.`,
          subject: `${site.type}.${site.field}`,
          detail: { site, read: recType, admits: field()?.slotTypes ?? [] },
        });
        const kept = readChild(rec['child']);
        return { ...(kept === undefined ? {} : { child: kept }), slot: {} as SlotState<E> };
      }
      const slot = {} as Record<string, unknown>;
      slot['type'] = recType;
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
      // The record's own type when it was read as one, else the field's declared slot type, qualified
      // by its owner so a composition authored in another repo claims it validly.
      const f = field();
      const type = slot.type ?? declaredType();
      if (type === undefined) {
        // The field admits no slot record (or the schemas are not installed), so these rules have no
        // record to live in. The child stays bare; the dropped rules are named.
        reportHostDiagnostic({
          code: 'slot-rule-inexpressible',
          severity: 'warning',
          message: `${label}: '${site.field}' ${f ? 'holds no slot records' : 'has no derived shape yet'}, so the rules set on this position cannot be written; the child stays bare.`,
          subject: `${site.type}.${site.field}`,
          detail: { site, rules: Object.keys(slot).filter((k) => k !== 'type' && k !== 'carried') },
        });
        return body;
      }
      const s = slot as Record<string, unknown>;
      const out: Record<string, unknown> = { type };
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
