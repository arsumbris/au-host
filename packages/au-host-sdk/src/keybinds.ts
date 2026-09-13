// The keybinds CANONICALIZER — the shared, pure seam that turns a `KeyboardEvent` into a canonical
// `{ mods, key }` keystroke, typed against the generated `KeyName` / `KeyModifier` vocabulary. It is
// host-sdk-owned so the ONE canonicalizer is shared by the dispatcher (app renderer) and the
// `<au-chord-input>` capture element (component set) — a captured chord always matches what the
// dispatcher produces. No DOM, no engine, no state: a keydown in, a keystroke out.


import { KeyNameValues } from './generated'
import type { KeyName, KeyModifier } from './generated'

// KeyNameValues and the KeyName union are generated from key-name.type.yaml,
// so the runtime vocabulary and the type share one definition.
export const KEY_NAMES: readonly KeyName[] = KeyNameValues

const KEY_NAME_SET: ReadonlySet<string> = new Set(KEY_NAMES)

/** A canonicalized keydown: the modifiers held plus one bindable key. */
export interface CanonicalKeystroke {
  mods: KeyModifier[]
  key: KeyName
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
  const p = uaData?.platform || navigator.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(p)
}

/** The modifiers held, in canonical order (mod, ctrl, alt, shift). `mod` is the platform accelerator
 *  (⌘ on macOS, Ctrl elsewhere); `ctrl` is raw Control, distinct from `mod` only on macOS. */
export function canonicalMods(e: KeyboardEvent, mac = isMacPlatform()): KeyModifier[] {
  const mods: KeyModifier[] = []
  if (mac ? e.metaKey : e.ctrlKey) mods.push('mod')
  if (mac && e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey) mods.push('shift')
  return mods
}

/** Map a `KeyboardEvent.code` to its canonical `key-name`, or null when the code is not a bindable key.
 *  Letters strip the `Key` prefix (`KeyS` -> `s`); every other bindable code is its lowercase form and
 *  must be a `KeyName` member. Numpad, media, international, and bare-modifier codes fall outside the
 *  vocabulary and return null. */
export function canonicalKey(code: string): KeyName | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1].toLowerCase() as KeyName
  const lower = code.toLowerCase()
  return KEY_NAME_SET.has(lower) ? (lower as KeyName) : null
}

/** Canonicalize a keydown to `{ mods, key }`, or null when the key is not bindable (a bare modifier,
 *  numpad, media, or any code outside the vocabulary). A null result never matches a keybind, so the
 *  gate passes it through. */
export function canonicalizeKeystroke(e: KeyboardEvent, mac = isMacPlatform()): CanonicalKeystroke | null {
  const key = canonicalKey(e.code)
  if (key === null) return null
  return { mods: canonicalMods(e, mac), key }
}

/** A "command chord" carries a non-shift modifier (mod / ctrl / alt). A keystroke with no modifiers, or
 *  shift only, is a bare/typing keystroke — arbitration lets it type in a focused text-editing context. */
export function isCommandChord(mods: readonly KeyModifier[]): boolean {
  return mods.some((m) => m === 'mod' || m === 'ctrl' || m === 'alt')
}

// Display formatting: shared KeyName glyphs for keymap editors, menus and au-kbd.

/** The non-letter/-digit key-name display glyphs. Letters uppercase (`s`→`S`), digits strip the prefix
 *  (`digit1`→`1`), f-keys uppercase (`f1`→`F1`); everything else falls back to the raw name. */
const KEY_GLYPHS: Readonly<Record<string, string>> = {
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  enter: '⏎', tab: '⇥', escape: 'Esc', space: 'Space', backspace: '⌫', delete: '⌦',
  home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn',
  minus: '-', equal: '=', bracketleft: '[', bracketright: ']', backslash: '\\',
  semicolon: ';', quote: "'", backquote: '`', comma: ',', period: '.', slash: '/',
}

/** A single key-name as its display label. */
export function formatKeyName(key: KeyName): string {
  if (/^[a-z]$/.test(key)) return key.toUpperCase()
  const digit = /^digit(\d)$/.exec(key)
  if (digit) return digit[1]
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase()
  return KEY_GLYPHS[key] ?? key
}

const MOD_GLYPHS_MAC: Readonly<Record<KeyModifier, string>> = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' }
const MOD_WORDS: Readonly<Record<KeyModifier, string>> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', mod: 'Ctrl' }
// Display order (macOS convention): ⌃⌥⇧⌘ then the key. Elsewhere: Ctrl+Alt+Shift+ then the key.
const MOD_ORDER: readonly KeyModifier[] = ['ctrl', 'alt', 'shift', 'mod']

/** One keystroke as a display label: `⌘S` / `⌘⇧K` on macOS, `Ctrl+S` / `Ctrl+Shift+K` elsewhere. */
export function formatKeystroke(ks: CanonicalKeystroke, mac = isMacPlatform()): string {
  const set = new Set<string>(ks.mods)
  const mods = MOD_ORDER.filter((m) => set.has(m))
  const key = formatKeyName(ks.key)
  return mac
    ? mods.map((m) => MOD_GLYPHS_MAC[m]).join('') + key
    : [...mods.map((m) => MOD_WORDS[m]), key].join('+')
}

/** A whole chord (a sequence of keystrokes) as a display label, e.g. `⌘K ⌘S`. */
export function formatChord(chord: readonly CanonicalKeystroke[], mac = isMacPlatform()): string {
  return chord.map((ks) => formatKeystroke(ks, mac)).join(' ')
}
