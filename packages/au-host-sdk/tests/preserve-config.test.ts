import { describe, expect, it } from 'vitest'

import { preserveUnowned } from '../src/index.ts'

// A serializer preserves every input field it does not own while replacing its own fields.
// These tests exercise that merge contract, including composition metadata on a root container.
// Each consuming serializer is responsible for supplying its own owned-key list.

/**
 * A root sandwich fixture with bare regions and a rule-bearing sandwich-slot.
 * The locks field is intentionally unowned; it must survive serialization unchanged.
 */
const ROOT_INSTANCE = {
  type: 'sandwich',
  left: {
    type: 'sandwich-slot',
    size: 276.34,
    fixed: true,
    child: { '^': 'swtest-left', type: 'column::column' },
  },
  center: { '^': 'swtest-center', type: 'bento::bento' },
  right: { '^': 'swtest-right', type: 'column::column' },
  locks: [{ move: true, node: '[[^^swtest-left]]' }],
  // The two that are NOT the container's, and that a from-scratch rebuild destroys.
  'intent-defaults': [{ intent: '[[open-intent::intent]]', roles: ['tabs'] }],
  'initial-focus': '[[bento::bento]]',
}

const SANDWICH_OWNED = ['left', 'center', 'right'] as const

/** What `toConfig` rebuilds from the model after the user collapses the left sidebar: the same
 *  region, its slot now also carrying `collapsed`. Note it mentions no composition field: they
 *  exist nowhere in the container's runtime model, which is precisely why rebuilding loses them. */
const REBUILT_COLLAPSED = {
  type: 'sandwich',
  left: { ...ROOT_INSTANCE.left, collapsed: true },
  center: ROOT_INSTANCE.center,
  right: ROOT_INSTANCE.right,
}

describe('preserveUnowned — the carry', () => {
  it('re-emits composition fields the writer does not own', () => {
    const out = preserveUnowned(ROOT_INSTANCE, REBUILT_COLLAPSED, SANDWICH_OWNED) as Record<string, unknown>
    expect(out['intent-defaults']).toEqual(ROOT_INSTANCE['intent-defaults'])
    expect(out['initial-focus']).toBe('[[bento::bento]]')
  })

  it('carries a field it has never heard of', () => {
    // The point of inverting the rule: the composition format can GROW a field and no writer needs
    // to learn about it. Hand-listing the known three would fix today and break again next time,
    // which is the same bug deferred.
    const input = { ...ROOT_INSTANCE, 'some-future-field': { nested: ['value'] } }
    const out = preserveUnowned(input, REBUILT_COLLAPSED, SANDWICH_OWNED) as Record<string, unknown>
    expect(out['some-future-field']).toEqual({ nested: ['value'] })
  })

  it('does not deep-clone a carried value', () => {
    // Carried by reference, deliberately: the writer never owned it, so it has no business
    // copying it either. Pinning this so a future "defensive clone" is a conscious change.
    const out = preserveUnowned(ROOT_INSTANCE, REBUILT_COLLAPSED, SANDWICH_OWNED) as Record<string, unknown>
    expect(out['intent-defaults']).toBe(ROOT_INSTANCE['intent-defaults'])
  })
})

describe('preserveUnowned — the writer still wins on what it owns', () => {
  it('an owned field takes the output value, not the input value', () => {
    const out = preserveUnowned(ROOT_INSTANCE, REBUILT_COLLAPSED, SANDWICH_OWNED) as Record<string, unknown>
    // The input's `left` slot had no `collapsed` at all; the rebuilt one does, and wins.
    expect((out.left as Record<string, unknown>).collapsed).toBe(true)
  })

  it('an owned field is REMOVABLE — the whole reason this is not a blind spread', () => {
    // Drag the right region's content out and `toConfig` stops emitting `right` entirely.
    // `{...input, ...output}` would resurrect the stale child from the instance it was handed, so
    // the pane the user just moved away would reappear on every save. Owned keys are subtracted
    // from the carry, so absence in the output means absence.
    const rebuiltEmptied = { ...REBUILT_COLLAPSED }
    delete (rebuiltEmptied as Record<string, unknown>).right

    const out = preserveUnowned(ROOT_INSTANCE, rebuiltEmptied, SANDWICH_OWNED) as Record<string, unknown>
    expect('right' in out).toBe(false)
    // ...and the unowned fields still survive the removal path.
    expect(out['initial-focus']).toBe('[[bento::bento]]')
    expect(out.locks).toBe(ROOT_INSTANCE.locks)
  })

  it('a written field MISSING from the owned list still takes the fresh value', () => {
    // The forgiving case, and the reason the merge is `{...carried, ...output}` and not the
    // reverse. A writer that emits a key but forgets to declare it owned is a very ordinary
    // mistake — add a config field, miss the OWNED array. Output-last means the consequence is
    // only that the key stops being REMOVABLE. Carried-last would mean the STALE input value wins
    // on every save and the writer's new value never lands, silently and forever.
    //
    // Found by mutation: `{...output, ...carried}` passed the entire rest of this file.
    const stale = { type: 'sandwich', undeclared: 'OLD', 'initial-focus': '[[bento::bento]]' }
    const fresh = { type: 'sandwich', undeclared: 'NEW' }
    const out = preserveUnowned(stale, fresh, SANDWICH_OWNED) as Record<string, unknown>
    expect(out.undeclared).toBe('NEW')
    expect(out['initial-focus']).toBe('[[bento::bento]]')
  })

  it('an owned field the writer omits does not come back from the input', () => {
    // The general form of the case above, for every conditionally-written key. Under the slot
    // model EVERY region key is conditional — an unoccupied, unruled region is simply not written.
    const out = preserveUnowned(ROOT_INSTANCE, { type: 'sandwich' }, SANDWICH_OWNED) as Record<string, unknown>
    for (const key of SANDWICH_OWNED) expect(key in out).toBe(false)
    expect(out['intent-defaults']).toBeDefined() // unowned is untouched by all of that
    expect(out.locks).toBeDefined()
  })
})

describe('preserveUnowned — `type` is always owned', () => {
  it('never carries `type` from the input, even when not listed', () => {
    // The parent re-stamps `type` on every save (the mount host's stamping saveConfig), and a
    // container must never carry a foreign one through. So the helper adds it to the owned set
    // itself rather than relying on 7 writers each remembering to list it.
    const foreign = { type: 'some-other-projection', 'initial-focus': '[[bento::bento]]' }
    const out = preserveUnowned(foreign, { type: 'sandwich' }, ['left']) as Record<string, unknown>
    expect(out.type).toBe('sandwich')
  })

  it('drops `type` when the output omits it, rather than inheriting the input\'s', () => {
    const out = preserveUnowned({ type: 'stale' }, { a: 1 }, []) as Record<string, unknown>
    expect('type' in out).toBe(false)
  })
})

describe('preserveUnowned — hostile and degenerate inputs', () => {
  // A writer calls this with `host.config`, which is whatever was on disk. It must never throw:
  // a crash inside `toConfig` takes the save path down and loses the layout outright.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'not a config'],
    ['a number', 42],
    ['an array', [1, 2, 3]],
  ])('returns the output unchanged for %s', (_label, input) => {
    const output = { type: 'sandwich', left: { type: 'column' } }
    expect(preserveUnowned(input, output, SANDWICH_OWNED)).toEqual(output)
  })

  it('an empty owned list carries everything except `type`', () => {
    const out = preserveUnowned({ type: 'x', a: 1, b: 2 }, { c: 3 }, []) as Record<string, unknown>
    expect(out).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('carries a key whose value is undefined, null, or falsy', () => {
    // `Object.entries` is the iteration, so presence is what counts, not truthiness. A composition
    // field explicitly set to null is an authored value and must not silently vanish.
    const out = preserveUnowned({ nil: null, zero: 0, empty: '' }, { type: 'x' }, []) as Record<string, unknown>
    expect(out).toEqual({ nil: null, zero: 0, empty: '', type: 'x' })
  })

  it('does not mutate either argument', () => {
    const input = { ...ROOT_INSTANCE }
    const output = { ...REBUILT_COLLAPSED }
    const inputBefore = JSON.stringify(input)
    const outputBefore = JSON.stringify(output)
    preserveUnowned(input, output, SANDWICH_OWNED)
    expect(JSON.stringify(input)).toBe(inputBefore)
    expect(JSON.stringify(output)).toBe(outputBefore)
  })
})

describe('preserveUnowned — the editor case: owned-so-it-is-DROPPED', () => {
  // reveal is owned so the editor can remove this one-mount navigation hint when saving.
  // The save must preserve all unrelated authored fields.
  const EDITOR_OWNED = ['file', 'reveal'] as const

  it('strips the transient field and keeps the authored ones', () => {
    const handed = {
      type: 'editor-pane',
      file: '/old.md',
      reveal: { start: 10, end: 20 },
      minimap: true, // an authored field the editor knows nothing about
    }
    const out = preserveUnowned(handed, { file: '/new.md' }, EDITOR_OWNED) as Record<string, unknown>
    expect(out.file).toBe('/new.md')
    expect('reveal' in out).toBe(false)
    expect(out.minimap).toBe(true)
  })
})
