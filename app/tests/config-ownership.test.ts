// The ownership boundary the host enforces at `saveConfig`.

// The failure under test is SILENT. A container rebuilds its
// config from its runtime model, omits a field it does not understand, and the rewritten file stays
// ENGINE-VALID — it just stops saying anything. Nothing errors, nothing warns, and the record's unowned
// mixin field is gone. So every case below is a thing that produced no signal before.

// The rule under test: a projection owns the fields of its OWN effective shape and nothing else.


import { describe, expect, it } from 'vitest'

import { droppedOwnFields, mergeOwned } from '../src/renderer/src/projections/config-ownership.ts'

/** A sandwich root that also mixes in `grouping-choice` — the shape that carries an unowned mixin field
 *  (`group-into`) the sandwich itself does not declare. */
const ROOT = {
  type: ['sandwich::sandwich', 'grouping-choice::au-host-sdk'],
  left: { type: 'file-tree::file-tree' },
  center: { type: 'bento::bento' },
  'group-into': '[[tabs::tabs]]',
}

/** Sandwich's own effective shape. `group-into` (the grouping-choice mixin's field) is NOT in it. */
const SANDWICH = new Set(['left', 'center', 'right'])

describe('mergeOwned — the host guarantees what is not yours', () => {
  it('carries a mixin’s field through a save that never mentions it', () => {
    // THE ORIGINAL BUG SHAPE: a sidebar collapse erased a record's unowned mixin field.
    const emitted = { left: { type: 'file-tree::file-tree' }, center: { type: 'bento::bento' } }
    const out = mergeOwned(ROOT, emitted, SANDWICH)
    expect(out['group-into']).toBe('[[tabs::tabs]]')
  })

  it('carries an EXTRA — a field no type declares — rather than dropping it', () => {
    // Open-world: an extra is legal and someone authored it deliberately. Not ours to delete.
    const out = mergeOwned({ ...ROOT, somethingNobodyDeclared: 42 }, { left: null }, SANDWICH)
    expect(out.somethingNobodyDeclared).toBe(42)
  })

  it('takes an owned field from the EMITTED config, not the input', () => {
    const out = mergeOwned(ROOT, { left: { type: 'terminal::terminal' } }, SANDWICH)
    expect(out.left).toEqual({ type: 'terminal::terminal' })
  })

  it('honours an owned field’s ABSENCE as a real removal', () => {
    // The host TRUSTS a projection with its own shape: dropping `center` must mean dropping it,
    // or a region could never be emptied. This is the half that must NOT be "protected".
    const out = mergeOwned(ROOT, { left: ROOT.left }, SANDWICH)
    expect('center' in out).toBe(false)
    // ...while the unowned half is untouched by the same call.
    expect(out['group-into']).toBe('[[tabs::tabs]]')
  })

  it('does not let a projection write a field outside its own shape', () => {
    // A misbehaving projection emitting `group-into` must not overwrite the record's.
    const out = mergeOwned(ROOT, { left: ROOT.left, 'group-into': '[[column::column]]' }, SANDWICH)
    expect(out['group-into']).toBe('[[tabs::tabs]]')
  })

  it('survives a non-object input without throwing', () => {
    expect(mergeOwned(undefined, { left: 1 }, SANDWICH)).toEqual({ left: 1 })
  })
})

describe('droppedOwnFields — the honest-mistake warning', () => {
  it('reports an owned field that was handed in and is not emitted', () => {
    expect(droppedOwnFields(ROOT, { left: ROOT.left }, SANDWICH)).toEqual(['center'])
  })

  it('does NOT report an unowned field, which is the host’s job to carry', () => {
    // Otherwise every single save would warn about `group-into`, and the warning would be noise
    // within a day — the fastest way to make a real signal unreadable.
    expect(droppedOwnFields(ROOT, { left: ROOT.left, center: ROOT.center }, SANDWICH)).toEqual([])
  })

  it('does not report a field that was never on the input', () => {
    expect(droppedOwnFields({ type: 'sandwich' }, {}, SANDWICH)).toEqual([])
  })
})
