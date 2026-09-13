// The shared union normalizer, exercised against each container's slot behavior.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setHostDiagnosticSink, type HostDiagnostic } from '@arsumbris/au-host-sdk';

import { makeSlotCodec, persistedId, type SlotState } from '../src/slot-codec.ts';
import { setSlotTypeProvider } from '../src/slots.ts';
import { _resetBlockIdsForTests } from '../src/block-id.ts';

// The codec mints an id-less child's pool `^:` via the SUBSTRATE minter, so pin its
// session prefix so a minted id is assertable (`wrap-test-1`, ...).
beforeEach(() => _resetBlockIdsForTests());
afterEach(() => {
  setSlotTypeProvider(null);
  setHostDiagnosticSink(null);
});

type Sized = { size?: number; collapsed?: boolean };

/** A container that honours two extras (sandwich / column). */
const sized = makeSlotCodec<{ type: string }, Sized>({
  slotType: 'sandwich-slot',
  extras: ['size', 'collapsed'], label: 'sandwich',
});

/** A container that honours none (tabs / dock / bento). */
const plain = makeSlotCodec<{ type: string }>({ slotType: 'container-slot', label: 'tabs' });

describe('the bare branch', () => {
  it('reads a bare projection as an occupant with no rules', () => {
    const pos = sized.read({ type: 'editor-pane', file: 'a.md' });
    expect(pos.slot).toEqual({});
    expect(pos.child?.instance).toEqual({ type: 'editor-pane', file: 'a.md' });
  });

  it('writes an unruled position back as a BARE reference, no wrapper', () => {
    // The whole reason the union has a bare branch: an unruled position gains no slot wrapper. Under
    // the composition pool the occupant is a `[[^^id]]` reference (its config lives in the pool),
    // and the id it carried survives inside the reference.
    const out = sized.write(sized.read({ '^': 'keep', type: 'editor-pane' }));
    expect(out).toBe('[[^^keep]]');
  });

  it('round-trips an absent position to nothing at all', () => {
    expect(sized.write(sized.read(undefined))).toBeUndefined();
  });
});

describe('the slot branch', () => {
  const record = {
    '^': 'pos-1',
    type: 'sandwich-slot',
    admits: ['[[editor-pane::editor]]'],
    fixed: true,
    label: 'Sidebar',
    size: 240,
    collapsed: true,
    child: { '^': 'kid', type: 'file-tree' },
  };

  it('splits the POSITION from the THING, which is the model\'s central claim', () => {
    const pos = sized.read(record);
    expect(pos.slot.id).toBe('pos-1'); // the position
    expect(pos.child!.id).toBe('kid'); // the occupant
  });

  it('reads every base field and every declared extra', () => {
    expect(sized.read(record).slot).toEqual({
      id: 'pos-1', admits: ['[[editor-pane::editor]]'], fixed: true, label: 'Sidebar', size: 240, collapsed: true,
    });
  });

  it('round-trips a full slot record — rules verbatim, occupant as a reference', () => {
    // The POSITION's rules round-trip unchanged; the OCCUPANT is now a pool reference (its `file-tree`
    // config lives in the pool, keyed by `kid`) rather than an inline record.
    expect(sized.write(sized.read(record))).toEqual({ ...record, child: '[[^^kid]]' });
  });

  it('writes the keys in the ORDER already on disk', () => {
    // Object equality ignores key order. Check serialization order explicitly to avoid needless
    // diffs in authored composition files.
    expect(Object.keys(sized.write(sized.read(record)) as object)).toEqual([
      'type', '^', 'admits', 'fixed', 'size', 'collapsed', 'label', 'child',
    ]);
  });

  it('makes an unhonoured field INERT without destroying it', () => {
    // Two rules meeting, and both matter. The runtime half of "an author can only write a field the
    // container acts on": `size` never reaches tabs' typed surface, so nothing half-honours it. And
    // the ownership rule: it is not tabs' field, so tabs does not get to delete it either.
    const slot = plain.read({ type: 'container-slot', size: 240, fixed: true }).slot;
    expect(slot).not.toHaveProperty('size');
    expect(slot.carried).toEqual({ size: 240 });
  });
});

describe('the no-wrapper guarantee, for every container that ships', () => {
  // The model's central promise to an author who wants none of this: an unruled position gains NO
  // slot wrapper. Under the composition pool the occupant is a bare `[[^^id]]` reference (its config
  // lives in the pool), so "no wrapper" means the value is exactly that reference — not a slot record.
  // It has to hold for EVERY container, because the cost of breaking it is a diff on every composition.
  const codecs = {
    sandwich: makeSlotCodec<{ type: string }, Sized>({ slotType: 'sandwich-slot', extras: ['size', 'collapsed'], label: 'sandwich' }),
    column: makeSlotCodec<{ type: string }, Sized>({ slotType: 'column-slot', extras: ['size', 'collapsed'], label: 'column' }),
    tabs: makeSlotCodec<{ type: string }>({ slotType: 'container-slot', label: 'tabs' }),
    dock: makeSlotCodec<{ type: string }>({ slotType: 'container-slot', label: 'dock' }),
    bento: makeSlotCodec<{ type: string }>({ slotType: 'bento-slot', label: 'bento' }),
  };

  for (const [name, codec] of Object.entries(codecs)) {
    it(`${name}: an unruled child writes as a bare reference, no wrapper`, () => {
      const bare = { '^': 'kid', type: 'editor-pane::editor', file: 'a.md' };
      const out = codec.write(codec.read(bare));
      // A bare reference to the occupant's id — no slot record, and the id preserved.
      expect(out).toBe('[[^^kid]]');
    });
  }
});

describe('carrying what the container does not own', () => {
  // The config-ownership rule, recursed one level in. A slot record is an instance like any other,
  // so a container emits what it owns and returns the rest untouched — otherwise it silently deletes
  // a field a third-party subtype of its slot added, or a base field shipped after it was written.
  // Invisible when it happens: the file stays valid and just stops saying something.

  it('round-trips a field the container does not understand', () => {
    const rec = { type: 'sandwich-slot', fixed: true, futureField: 'keep me', child: { '^': 'k', type: 'editor-pane' } };
    // The unowned field survives; the occupant is a reference (its config lives in the pool).
    expect(sized.write(sized.read(rec))).toEqual({ ...rec, child: '[[^^k]]' });
  });

  it('keeps the unowned field OUT of the typed surface', () => {
    // Carried, never honoured. A container reading `slot.futureField` would be acting on a field it
    // does not implement, which is the mirror of an author writing one.
    const slot = sized.read({ type: 'sandwich-slot', futureField: 1 }).slot;
    expect(slot).not.toHaveProperty('futureField');
    expect(slot.carried).toEqual({ futureField: 1 });
  });

  it('keeps a slot ALIVE whose only content is a carried field', () => {
    // If `speaks` ignored the remainder, a slot carrying nothing else would collapse to a bare child
    // and take the unowned field with it — the carrying would then only work when it was not needed.
    const pos = sized.read({ type: 'sandwich-slot', futureField: 'x', child: { '^': 'k', type: 'editor-pane' } });
    expect(sized.speaks(pos.slot)).toBe(true);
    expect(sized.write(pos)).toHaveProperty('futureField', 'x');
  });

  it('does not carry the STRUCTURAL keys, which `write` re-emits itself', () => {
    // `type` / `^` / `child` are the record's own frame. Carrying them would emit each twice, and
    // the second copy would be a stale snapshot of the first.
    const pos = sized.read({ '^': 'p', type: 'sandwich-slot', fixed: true, child: { '^': 'k', type: 'editor-pane' } });
    expect(pos.slot.carried).toBeUndefined();
  });

  it('adds nothing to a slot that carries only understood fields', () => {
    // The byte-identical guarantee: an ordinary slot must not grow an empty `carried` key.
    expect(sized.read({ type: 'sandwich-slot', fixed: true }).slot).toEqual({ fixed: true });
  });
});

describe('speaks — the materialize / collapse predicate', () => {
  it('is false for a slot with nothing to say', () => {
    expect(sized.speaks({})).toBe(false);
    expect(sized.speaks(undefined)).toBe(false);
  });

  it('treats a false flag and an empty admits as saying nothing', () => {
    // `fixed: false` and `admits: []` are not statements. Writing a record for either would break
    // the byte-identical guarantee for a composition that never asked for a rule.
    expect(sized.speaks({ fixed: false, collapsed: false })).toBe(false);
    expect(sized.speaks({ admits: [] })).toBe(false);
  });

  it('is true for each field on its own, base and extra alike', () => {
    for (const slot of [
      { id: 'x' }, { admits: ['[[a]]'] }, { fixed: true }, { label: 'L' }, { size: 1 }, { collapsed: true },
    ] as SlotState<Sized>[]) {
      expect(sized.speaks(slot)).toBe(true);
    }
  });

  it('drops a slot that lost its last statement, back to a bare reference', () => {
    // Expanding a collapsed region is the live case: the flag goes, and so must the wrapper — leaving
    // the bare `[[^^id]]` reference to the occupant.
    const pos = sized.read({ type: 'sandwich-slot', collapsed: true, child: { '^': 'k', type: 'editor-pane' } });
    expect(sized.write({ ...pos, slot: {} })).toBe('[[^^k]]');
  });
});

describe('survivesEmpty — deliberately NOT the same question as speaks', () => {
  it('keeps a position that still governs something', () => {
    expect(sized.survivesEmpty({ admits: ['[[a]]'] })).toBe(true);
    expect(sized.survivesEmpty({ id: 'x' })).toBe(true);
  });

  it('drops a position whose only state was presentational', () => {
    // A row that holds nothing has no size and no title worth keeping. If this used `speaks`, an
    // emptied list entry would linger forever as an invisible husk.
    expect(sized.survivesEmpty({ size: 200, collapsed: true, label: 'L' })).toBe(false);
    expect(sized.survivesEmpty({})).toBe(false);
  });
});

describe('isSlotRecord — by closure, not by name', () => {
  it('matches the container\'s own slot type without a provider', () => {
    expect(sized.isSlotRecord({ type: 'sandwich-slot' })).toBe(true);
    expect(sized.isSlotRecord({ type: 'sandwich-slot::sandwich' })).toBe(true);
    expect(sized.isSlotRecord({ type: 'editor-pane' })).toBe(false);
    expect(sized.isSlotRecord(undefined)).toBe(false);
  });

  it('reads a SUBTYPE of the slot as a slot once the host installs the predicate', () => {
    // A slot subtype read as a CHILD would silently lose the position's rules.
    expect(sized.isSlotRecord({ type: 'my-slot' })).toBe(false);
    setSlotTypeProvider({ isA: (c, a) => c === 'my-slot' && a === 'sandwich-slot' });
    expect(sized.isSlotRecord({ type: 'my-slot' })).toBe(true);
  });

  it('reads a subtype record\'s fields, not just its identity', () => {
    setSlotTypeProvider({ isA: (c, a) => c === 'my-slot' && a === 'sandwich-slot' });
    expect(sized.read({ type: 'my-slot', fixed: true, size: 12 }).slot).toEqual({ fixed: true, size: 12 });
  });
});

describe('footgun guard — a subtype is flattened on write, so warn at read', () => {
  // write emits one fixed slot type per container. Reject additional slot subtypes at read time
  // when serializing them as the base type would lose their identity.
  it('warns when a slot record\'s type is not the codec\'s exact slot type', () => {
    const seen: HostDiagnostic[] = [];
    setHostDiagnosticSink((d) => seen.push(d));
    setSlotTypeProvider({ isA: (c, a) => c === 'my-slot' && a === 'sandwich-slot' });
    // The read still succeeds — fields intact — it is the WRITE that would flatten, so the warning
    // rides the read rather than blocking it.
    expect(sized.read({ type: 'my-slot', fixed: true }).slot).toEqual({ fixed: true });
    const flagged = seen.filter((d) => d.code === 'slot-subtype-flattened');
    expect(flagged.length).toBe(1);
    expect(flagged[0].severity).toBe('warning');
    expect(flagged[0].subject).toBe('my-slot');
    expect(flagged[0].detail).toMatchObject({ read: 'my-slot', willWrite: 'sandwich-slot' });
  });

  it('does NOT warn for the codec\'s own exact type, qualified or bare', () => {
    const seen: HostDiagnostic[] = [];
    setHostDiagnosticSink((d) => seen.push(d));
    sized.read({ type: 'sandwich-slot', fixed: true });
    sized.read({ type: 'sandwich-slot::sandwich', fixed: true }); // exact by BARE name, qualifier aside
    expect(seen.filter((d) => d.code === 'slot-subtype-flattened')).toEqual([]);
  });
});

describe('the qualifier', () => {
  it('writes the qualified type name a cross-repo composition needs', () => {
    const q = makeSlotCodec<{ type: string }>({ slotType: 'bento-slot', qualifier: '::bento', label: 'bento' });
    expect(q.write({ slot: { fixed: true } })).toEqual({ type: 'bento-slot::bento', fixed: true });
  });
});

describe('ids', () => {
  it('mints a child id through the SUBSTRATE minter, not a per-container generator', () => {
    // Pool ids are minted by the shared substrate authority; container-specific prefixes carry no meaning.

    expect(sized.read({ type: 'editor-pane' }).child!.id).toBe('wrap-test-1');
  });

  it('never mints a POSITION id — a slot gets one only when authored', () => {
    // The spec's rule: minted only when something needs them. Nothing needs a position id unless
    // something points at it, so an unauthored one stays absent and the file stays clean.
    expect(sized.read({ type: 'sandwich-slot', fixed: true }).slot.id).toBeUndefined();
  });

  it('reads `^` as identity-layer, never as a declared field', () => {
    expect(persistedId({ '^': 'x' })).toBe('x');
    expect(persistedId({ '^': 42 })).toBeUndefined();
    expect(persistedId(undefined)).toBeUndefined();
  });
});

describe('references at a child position', () => {
  it('throws NAMING THE CONTAINER rather than reading a link as an empty position', () => {
    // The model admits a referenced view; no container resolves one yet. A silent empty position
    // would look exactly like a composition that never had a child there.
    expect(() => sized.read('[[some-view]]')).toThrow(/sandwich: position references/);
    expect(() => plain.read({ type: 'container-slot', child: '[[v]]' })).toThrow(/tabs: position references/);
  });
});
