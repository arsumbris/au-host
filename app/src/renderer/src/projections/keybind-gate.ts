// The KEYBIND GATE — the window-local half of keybind dispatch. On every keydown it canonicalizes, runs
// the guards (auto-repeat, IME, an open blocking modal), and arbitrates typing versus a command chord.
// Only a keystroke that SURVIVES as a chord candidate is handed on for resolution; typing and non-bindable
// keys never leave the window. The gate itself resolves and fires NOTHING — that is the authority's job
// (wired via `onCandidate`). It runs in every window (the main window and each floated surface).

// Every decision records a gated `event('keybind', ...)` trace, so the gate is observable over the event
// substrate without firing anything.


import { canonicalizeKeystroke, isCommandChord, event, on, type CanonicalKeystroke } from '@arsumbris/au-host-sdk'

export interface KeybindGateDeps {
  /** Only a sequence owned by this input surface may take continuation keys from text. */
  hasPendingSequence?: () => boolean
  cancelPendingSequence?: () => void
  /** Whether the focused PROJECTION is a raw-text surface (declares `raw-text-surface-meta`). */
  isFocusedRawTextSurface: () => boolean
  /** Whether a blocking overlay (palette / chooser / dialog / menu) is open in this window. */
  isBlockingModalOpen: () => boolean
  /** A surviving chord candidate, for the authority to resolve + fire. Absent until resolution is wired. */
  onCandidate?: (keystroke: CanonicalKeystroke, e: KeyboardEvent) => void
}

// Host-chrome text inputs (the palette search field, a rename field, a dialog input) are detected at the
// DOM. This is the CHROME half of the text-editing-context question; the projection flag is the other half.
const TEXT_INPUT_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"]'

function focusedHostChromeTextInput(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null
  return !!target?.closest?.(TEXT_INPUT_SELECTOR)
}

/** Install the gate on a window's capture-phase keydown. Returns a disposer. */
export function installKeybindGate(win: Window, deps: KeybindGateDeps): () => void {
  const onKeydown = (e: KeyboardEvent): void => {
    // Guards — window-local facts, applied before canonicalization.
    if (e.repeat) {
      if (on('keybind')) event('keybind', 'guard-repeat', { code: e.code })
      return
    }
    if (e.isComposing || e.keyCode === 229 || e.key === 'Dead') {
      deps.cancelPendingSequence?.()
      if (on('keybind')) event('keybind', 'guard-ime', { code: e.code })
      return
    }
    if (deps.isBlockingModalOpen()) {
      deps.cancelPendingSequence?.()
      if (on('keybind')) event('keybind', 'guard-modal', { code: e.code })
      return
    }

    // A focused chord-CAPTURE surface (e.g. `<au-chord-input>` while rebinding) owns EVERY keystroke —
    // command chords included. It is capturing the chord to bind, so the dispatcher must never fire the
    // command being captured. `[data-au-keycapture]` is the generic signal (any capture widget sets it);
    // yield entirely, before canonicalization, so even a non-bindable key reaches the capture element.
    const target = e.target as HTMLElement | null
    if (target?.closest?.('[data-au-keycapture]')) {
      deps.cancelPendingSequence?.()
      if (on('keybind')) event('keybind', 'passthrough', { code: e.code, reason: 'key-capture' })
      return
    }

    const ks = canonicalizeKeystroke(e)
    if (!ks) {
      // Not a bindable key (a bare modifier, numpad, media, …) — never a candidate, always passes through.
      if (on('keybind')) event('keybind', 'non-key', { code: e.code })
      return
    }

    // Arbitration: a focused text-editing context (a flagged projection, or host chrome) owns a bare
    // (typing) keystroke; a command chord still resolves even there.
    const textContext = deps.isFocusedRawTextSurface() || focusedHostChromeTextInput(e)
    const pending = deps.hasPendingSequence?.() ?? false
    if (pending && ks.key === 'escape' && ks.mods.length === 0) {
      deps.cancelPendingSequence?.()
      e.preventDefault()
      return
    }
    if (textContext && !isCommandChord(ks.mods) && !pending) {
      if (on('keybind')) event('keybind', 'passthrough', { key: ks.key, mods: ks.mods, reason: 'text-input' })
      return
    }

    // A chord candidate. The gate does not fire — resolution + fire are the authority's.
    if (on('keybind')) event('keybind', 'candidate', { key: ks.key, mods: ks.mods })
    deps.onCandidate?.(ks, e)
  }

  win.addEventListener('keydown', onKeydown, true)
  return () => win.removeEventListener('keydown', onKeydown, true)
}
