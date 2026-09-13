import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installKeybindGate, type KeybindGateDeps } from '../src/renderer/src/projections/keybind-gate.ts'
import { setCategory, clear, read } from '@arsumbris/au-host-sdk'

// A mock window that captures the capture-phase keydown handler.
function mockWindow(): { win: Window; fire: (e: unknown) => void } {
  let handler: ((e: unknown) => void) | null = null
  const win = {
    addEventListener: (_t: string, fn: (e: unknown) => void) => { handler = fn },
    removeEventListener: () => { handler = null },
  } as unknown as Window
  return { win, fire: (e) => handler?.(e) }
}

// A fake keydown. Tests explicitly select macOS so Node/browser navigator defaults cannot
// change the meaning of the `meta` accelerator.
function keydown(
  code: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
  opts: { repeat?: boolean; isComposing?: boolean; inChrome?: boolean } = {},
): unknown {
  return {
    code,
    metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift,
    repeat: !!opts.repeat, isComposing: !!opts.isComposing, keyCode: 0, key: '',
    target: { closest: (selector: string) => (opts.inChrome && selector.startsWith('input,') ? {} : null) },
  }
}

const traceNames = (): string[] => read({ category: 'keybind' }).map((e) => e.name)

const deps = (over: Partial<KeybindGateDeps> = {}): KeybindGateDeps => ({
  isFocusedRawTextSurface: () => false,
  isBlockingModalOpen: () => false,
  ...over,
})

describe('keybind gate classification', () => {
  beforeEach(() => { vi.stubGlobal('navigator', { platform: 'MacIntel' }); clear(); setCategory('keybind', true) })
  afterEach(() => vi.unstubAllGlobals())

  it('a modified chord with no text context is a CANDIDATE', () => {
    const { win, fire } = mockWindow()
    installKeybindGate(win, deps())
    fire(keydown('KeyS', { meta: true }))
    expect(traceNames()).toContain('candidate')
  })

  it('a bare key in a host-chrome text input PASSES THROUGH', () => {
    const { win, fire } = mockWindow()
    installKeybindGate(win, deps())
    fire(keydown('KeyK', {}, { inChrome: true }))
    expect(traceNames()).toEqual(['passthrough'])
  })

  it('a bare key with NO text context is a CANDIDATE (single-key binds are possible)', () => {
    const { win, fire } = mockWindow()
    installKeybindGate(win, deps())
    fire(keydown('KeyG'))
    expect(traceNames()).toEqual(['candidate'])
  })

  it('a command chord in a text input still RESOLVES (candidate)', () => {
    const { win, fire } = mockWindow()
    installKeybindGate(win, deps())
    fire(keydown('KeyS', { meta: true }, { inChrome: true }))
    expect(traceNames()).toEqual(['candidate'])
  })

  it('a bare key over a focused raw-text PROJECTION passes through', () => {
    const { win, fire } = mockWindow()
    installKeybindGate(win, deps({ isFocusedRawTextSurface: () => true }))
    fire(keydown('KeyJ'))
    expect(traceNames()).toEqual(['passthrough'])
  })

  it('guards: auto-repeat, IME, and an open blocking modal each short-circuit', () => {
    for (const [ev, name] of [
      [keydown('KeyS', { meta: true }, { repeat: true }), 'guard-repeat'],
      [keydown('KeyS', { meta: true }, { isComposing: true }), 'guard-ime'],
    ] as const) {
      const { win, fire } = mockWindow()
      clear()
      installKeybindGate(win, deps())
      fire(ev)
      expect(traceNames()).toEqual([name])
    }
    const { win, fire } = mockWindow()
    clear()
    installKeybindGate(win, deps({ isBlockingModalOpen: () => true }))
    fire(keydown('KeyS', { meta: true }))
    expect(traceNames()).toEqual(['guard-modal'])
  })

  it('a non-bindable key (numpad, bare modifier) is NON-KEY, never a candidate', () => {
    const { win, fire } = mockWindow()
    installKeybindGate(win, deps())
    fire(keydown('Numpad5', { meta: true }))
    expect(traceNames()).toEqual(['non-key'])
  })

  it('the disposer removes the listener', () => {
    const { win, fire } = mockWindow()
    const dispose = installKeybindGate(win, deps())
    dispose()
    fire(keydown('KeyS', { meta: true }))
    expect(traceNames()).toEqual([])
  })
  it('passes a pending continuation from a text field to the authority', () => {
    const { win, fire } = mockWindow()
    const candidate = vi.fn()
    installKeybindGate(win, deps({ hasPendingSequence: () => true, onCandidate: candidate }))
    fire(keydown('ArrowDown', {}, { inChrome: true }))
    expect(candidate).toHaveBeenCalledOnce()
  })

  it('Escape cancels a pending sequence before it can execute another binding', () => {
    const { win, fire } = mockWindow()
    const cancel = vi.fn(), candidate = vi.fn(), preventDefault = vi.fn()
    installKeybindGate(win, deps({ hasPendingSequence: () => true, cancelPendingSequence: cancel, onCandidate: candidate }))
    fire({ ...keydown('Escape') as object, preventDefault })
    expect(cancel).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(candidate).not.toHaveBeenCalled()
  })

})
