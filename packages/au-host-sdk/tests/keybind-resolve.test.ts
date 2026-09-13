import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveChord, keystrokeEquals, buildActiveKeybinds, KeybindDispatcher, type ActiveKeybind } from '../src/keybind-resolve.ts'
import type { CanonicalKeystroke } from '../src/keybinds.ts'

const k = (key: string, ...mods: string[]): CanonicalKeystroke => ({ key: key as never, mods: mods as never })
const kb = (chord: CanonicalKeystroke[], intent: string, order: number, focusScoped = false): ActiveKeybind =>
  ({ chord, intent, order, focusScoped })

describe('keystrokeEquals', () => {
  it('matches on key + modifier SET (order-independent)', () => {
    expect(keystrokeEquals(k('s', 'mod', 'shift'), k('s', 'shift', 'mod'))).toBe(true)
    expect(keystrokeEquals(k('s', 'mod'), k('s'))).toBe(false)
    expect(keystrokeEquals(k('s', 'mod'), k('k', 'mod'))).toBe(false)
  })
})

describe('resolveChord', () => {
  it('fires a lone matching keybind', () => {
    const active = [kb([k('s', 'mod')], 'save-intent', 0)]
    expect(resolveChord([k('s', 'mod')], active)).toEqual({ kind: 'fire', intent: 'save-intent' })
  })

  it('is `none` when nothing matches', () => {
    const active = [kb([k('s', 'mod')], 'save-intent', 0)]
    expect(resolveChord([k('k', 'mod')], active)).toEqual({ kind: 'none' })
  })

  it('a focus-scoped match wins over a global one', () => {
    const active = [
      kb([k('s', 'mod')], 'save-composition', 0, false),
      kb([k('s', 'mod')], 'save-file', 1, true),
    ]
    expect(resolveChord([k('s', 'mod')], active)).toEqual({ kind: 'fire', intent: 'save-file' })
  })

  it('list order breaks a tie among equally-specific candidates (later wins)', () => {
    const active = [
      kb([k('s', 'mod')], 'old', 0, false),
      kb([k('s', 'mod')], 'new', 1, false),
    ]
    expect(resolveChord([k('s', 'mod')], active)).toEqual({ kind: 'fire', intent: 'new' })
  })

  it('asks the chooser on a genuine tie (same list position, distinct intents)', () => {
    const active = [
      kb([k('s', 'mod')], 'a', 0, false),
      kb([k('s', 'mod')], 'b', 0, false),
    ]
    const r = resolveChord([k('s', 'mod')], active)
    expect(r.kind).toBe('ask')
    expect((r as { intents: string[] }).intents.sort()).toEqual(['a', 'b'])
  })

  it('holds on a prefix of a longer sequence', () => {
    const active = [kb([k('k', 'mod'), k('s', 'mod')], 'save-all', 0)]
    expect(resolveChord([k('k', 'mod')], active)).toEqual({ kind: 'prefix' })
  })

  it('a full match that is ALSO a prefix holds until final, then fires', () => {
    const active = [
      kb([k('k', 'mod')], 'palette', 0),                     // full on ⌘K
      kb([k('k', 'mod'), k('s', 'mod')], 'save-all', 0),     // ⌘K is its prefix
    ]
    expect(resolveChord([k('k', 'mod')], active)).toEqual({ kind: 'prefix' })
    expect(resolveChord([k('k', 'mod')], active, true)).toEqual({ kind: 'fire', intent: 'palette' })
  })

  it('completes a two-step sequence', () => {
    const active = [kb([k('k', 'mod'), k('s', 'mod')], 'save-all', 0)]
    expect(resolveChord([k('k', 'mod'), k('s', 'mod')], active)).toEqual({ kind: 'fire', intent: 'save-all' })
  })
})

describe('KeybindDispatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = (active: ActiveKeybind[]) => {
    const fired: string[] = []
    const asked: string[][] = []
    const d = new KeybindDispatcher({
      activeKeybinds: () => active,
      fire: (i) => fired.push(i),
      ask: (is) => asked.push(is),
      sequenceTimeoutMs: 500,
    })
    return { d, fired, asked }
  }

  it('fires a single-step chord immediately and consumes the key', () => {
    const { d, fired } = setup([kb([k('s', 'mod')], 'save', 0)])
    expect(d.push(k('s', 'mod'))).toBe(true)
    expect(fired).toEqual(['save'])
  })

  it('does NOT consume an unmatched key', () => {
    const { d, fired } = setup([kb([k('s', 'mod')], 'save', 0)])
    expect(d.push(k('q', 'mod'))).toBe(false)
    expect(fired).toEqual([])
  })

  it('holds a sequence prefix, then completes it on the next key', () => {
    const { d, fired } = setup([kb([k('k', 'mod'), k('s', 'mod')], 'save-all', 0)])
    expect(d.push(k('k', 'mod'))).toBe(true)   // held
    expect(fired).toEqual([])
    expect(d.push(k('s', 'mod'))).toBe(true)   // completes
    expect(fired).toEqual(['save-all'])
  })

  it('a chord that is both full and a prefix fires on timeout', () => {
    const { d, fired } = setup([
      kb([k('k', 'mod')], 'palette', 0),
      kb([k('k', 'mod'), k('s', 'mod')], 'save-all', 0),
    ])
    d.push(k('k', 'mod'))
    expect(fired).toEqual([])       // held, could be a sequence
    vi.advanceTimersByTime(500)
    expect(fired).toEqual(['palette'])
  })

  it('routes a genuine tie to the chooser', () => {
    const { d, asked } = setup([kb([k('s', 'mod')], 'a', 0), kb([k('s', 'mod')], 'b', 0)])
    d.push(k('s', 'mod'))
    expect(asked).toEqual([['a', 'b']])
  })
})

describe('buildActiveKeybinds', () => {
  const km = (keybinds: any[], when?: string[]) => ({ when, keybinds })
  const bind = (key: string, intent: string, when?: string[]) => ({ chord: [k(key, 'mod')], intent, when })

  it('a global keymap is always active; its keybinds are not focus-scoped', () => {
    const out = buildActiveKeybinds([km([bind('s', 'save')])], new Set())
    expect(out).toEqual([{ chord: [k('s', 'mod')], intent: 'save', order: 0, focusScoped: false }])
  })

  it('a focus-scoped keymap contributes only while its type is focused, and is focus-scoped then', () => {
    const maps = [km([bind('s', 'save-file')], ['editor'])]
    expect(buildActiveKeybinds(maps, new Set())).toEqual([])
    expect(buildActiveKeybinds(maps, new Set(['editor']))).toEqual([
      { chord: [k('s', 'mod')], intent: 'save-file', order: 0, focusScoped: true },
    ])
  })

  it('assigns list-order by keymap index (later wins downstream)', () => {
    const out = buildActiveKeybinds([km([bind('s', 'a')]), km([bind('s', 'b')])], new Set())
    expect(out.map((b) => [b.intent, b.order])).toEqual([['a', 0], ['b', 1]])
  })
})

describe('pending sequence presentation', () => {
  it('reports effective continuations, preserving ambiguity and hiding shadowed bindings', () => {
    const notify = vi.fn()
    const fire = vi.fn()
    const active = [
      kb([k('k', 'mod'), k('h')], 'old', 0),
      kb([k('k', 'mod'), k('h')], 'new', 1),
      kb([k('k', 'mod'), k('x'), k('y')], 'custom-a', 1),
      kb([k('k', 'mod'), k('x'), k('y')], 'custom-b', 1),
    ]
    const d = new KeybindDispatcher({ activeKeybinds: () => active, fire, ask: vi.fn(), onPendingChange: notify })
    d.push(k('k', 'mod'))
    expect(d.pending).toBe(true)
    expect(notify.mock.lastCall?.[0].bindings.map((b: ActiveKeybind) => b.intent)).toEqual(['new', 'custom-a', 'custom-b'])
    d.push(k('h'))
    expect(fire).toHaveBeenCalledWith('new')
    expect(notify).toHaveBeenLastCalledWith(null)
    expect(d.pending).toBe(false)
    d.dispose()
  })

  it('clears on timeout and cancellation without firing a cancelled standalone match', () => {
    vi.useFakeTimers()
    try {
      const notify = vi.fn(), fire = vi.fn()
      const d = new KeybindDispatcher({ activeKeybinds: () => [
        kb([k('k', 'mod')], 'standalone', 0), kb([k('k', 'mod'), k('h')], 'long', 0),
      ], fire, ask: vi.fn(), onPendingChange: notify })
      d.push(k('k', 'mod')); d.cancel(); vi.advanceTimersByTime(600)
      expect(fire).not.toHaveBeenCalled()
      expect(notify).toHaveBeenLastCalledWith(null)
      d.push(k('k', 'mod')); vi.advanceTimersByTime(600)
      expect(fire).toHaveBeenCalledWith('standalone')
      expect(notify).toHaveBeenLastCalledWith(null)
      d.dispose()
    } finally { vi.useRealTimers() }
  })
})

describe('sequence inspection timing', () => {
  it('refills on inspection and resumes a full configured interval, while commands remain active', () => {
    vi.useFakeTimers()
    try {
      const notify = vi.fn(), fire = vi.fn()
      const d = new KeybindDispatcher({ activeKeybinds: () => [kb([k('k','mod'), k('h')], 'headers', 0)],
        sequenceTimeoutMs: () => 5000, onPendingChange: notify, fire, ask: vi.fn() })
      d.push(k('k','mod')); vi.advanceTimersByTime(4000); d.inspect(true)
      expect(notify.mock.lastCall?.[0]).toMatchObject({ durationMs: 5000, deadline: null, paused: true })
      vi.advanceTimersByTime(20000); expect(d.pending).toBe(true)
      d.inspect(false); vi.advanceTimersByTime(4999); expect(d.pending).toBe(true)
      vi.advanceTimersByTime(1); expect(d.pending).toBe(false)
      d.push(k('k','mod')); d.inspect(true); d.push(k('h'))
      expect(fire).toHaveBeenCalledWith('headers'); expect(d.pending).toBe(false)
      d.dispose()
    } finally { vi.useRealTimers() }
  })

  it('zero disables expiry and cancellation remains available', () => {
    vi.useFakeTimers()
    try {
      const d = new KeybindDispatcher({ activeKeybinds: () => [kb([k('k','mod'), k('h')], 'headers', 0)],
        sequenceTimeoutMs: 0, fire: vi.fn(), ask: vi.fn() })
      d.push(k('k','mod')); vi.advanceTimersByTime(100000)
      expect(d.pending).toBe(true); d.cancel(); expect(d.pending).toBe(false)
    } finally { vi.useRealTimers() }
  })
})

describe('clicked shortcut continuations', () => {
  it('fires once and consumes the sequence', () => {
    const binding = kb([k('k', 'mod'), k('p')], 'pick', 0)
    const fire = vi.fn()
    const dispatcher = new KeybindDispatcher({ activeKeybinds: () => [binding], fire, ask: vi.fn() })
    dispatcher.push(k('k', 'mod'))
    expect(dispatcher.choose(binding)).toBe(true)
    expect(dispatcher.pending).toBe(false)
    expect(dispatcher.choose(binding)).toBe(false)
    expect(fire.mock.calls).toEqual([['pick']])
  })
  it('rejects a removed or overridden continuation', () => {
    const binding = kb([k('k', 'mod'), k('p')], 'pick', 0)
    let active = [binding]
    const fire = vi.fn()
    const dispatcher = new KeybindDispatcher({ activeKeybinds: () => active, fire, ask: vi.fn() })
    dispatcher.push(k('k', 'mod'))
    active = [kb(binding.chord, 'replacement', 1)]
    expect(dispatcher.choose(binding)).toBe(false)
    expect(fire).not.toHaveBeenCalled()
    dispatcher.cancel()
  })
})
