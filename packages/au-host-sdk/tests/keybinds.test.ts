import { describe, it, expect } from 'vitest'
import { canonicalKey, canonicalMods, canonicalizeKeystroke, isCommandChord, KEY_NAMES } from '../src/keybinds.ts'
import type { KeyModifier } from '../src/generated.ts'

// A minimal KeyboardEvent stand-in — the canonicalizer reads only these fields.
function ev(code: string, mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>> = {}): KeyboardEvent {
  return {
    code,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  } as KeyboardEvent
}

describe('canonicalKey', () => {
  it('strips the Key prefix for letters', () => {
    expect(canonicalKey('KeyS')).toBe('s')
    expect(canonicalKey('KeyZ')).toBe('z')
  })
  it('lowercases digit-row, function, arrow, nav and punctuation codes', () => {
    expect(canonicalKey('Digit1')).toBe('digit1')
    expect(canonicalKey('F12')).toBe('f12')
    expect(canonicalKey('ArrowUp')).toBe('arrowup')
    expect(canonicalKey('PageDown')).toBe('pagedown')
    expect(canonicalKey('BracketLeft')).toBe('bracketleft')
    expect(canonicalKey('Slash')).toBe('slash')
  })
  it('returns null for codes outside the vocabulary', () => {
    expect(canonicalKey('Numpad1')).toBeNull()
    expect(canonicalKey('ShiftLeft')).toBeNull()
    expect(canonicalKey('F13')).toBeNull()
    expect(canonicalKey('MediaPlayPause')).toBeNull()
  })
  it('every produced key is a real KEY_NAMES member', () => {
    const set = new Set<string>(KEY_NAMES)
    for (const code of ['KeyA', 'Digit0', 'F1', 'ArrowLeft', 'Enter', 'Slash']) {
      expect(set.has(canonicalKey(code) as string)).toBe(true)
    }
  })
})

describe('canonicalMods', () => {
  it('maps the platform accelerator to `mod` — Cmd on mac, Ctrl elsewhere', () => {
    expect(canonicalMods(ev('KeyS', { meta: true }), true)).toEqual<KeyModifier[]>(['mod'])
    expect(canonicalMods(ev('KeyS', { ctrl: true }), false)).toEqual<KeyModifier[]>(['mod'])
  })
  it('distinguishes raw Control from `mod` on mac only', () => {
    expect(canonicalMods(ev('KeyS', { ctrl: true }), true)).toEqual<KeyModifier[]>(['ctrl'])
  })
  it('emits a canonical order (mod, ctrl, alt, shift)', () => {
    expect(canonicalMods(ev('KeyS', { meta: true, ctrl: true, alt: true, shift: true }), true))
      .toEqual<KeyModifier[]>(['mod', 'ctrl', 'alt', 'shift'])
  })
})

describe('canonicalizeKeystroke', () => {
  it('produces { mods, key } for a bindable key', () => {
    expect(canonicalizeKeystroke(ev('KeyS', { meta: true }), true)).toEqual({ mods: ['mod'], key: 's' })
    expect(canonicalizeKeystroke(ev('Digit2', { meta: true, shift: true }), true))
      .toEqual({ mods: ['mod', 'shift'], key: 'digit2' })
  })
  it('returns null for a non-bindable key (a bare modifier keydown, numpad, media)', () => {
    expect(canonicalizeKeystroke(ev('ShiftLeft', { shift: true }), true)).toBeNull()
    expect(canonicalizeKeystroke(ev('Numpad5', { meta: true }), true)).toBeNull()
  })
})

describe('isCommandChord', () => {
  it('is true for a non-shift modifier', () => {
    expect(isCommandChord(['mod'])).toBe(true)
    expect(isCommandChord(['ctrl'])).toBe(true)
    expect(isCommandChord(['alt'])).toBe(true)
    expect(isCommandChord(['mod', 'shift'])).toBe(true)
  })
  it('is false for no modifier or shift-only (a typing keystroke)', () => {
    expect(isCommandChord([])).toBe(false)
    expect(isCommandChord(['shift'])).toBe(false)
  })
})
