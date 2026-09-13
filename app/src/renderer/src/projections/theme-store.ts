/** Applies the active theme, its appearance edits, and device-wide preferences to the app. */
import { defaultTheme } from '@arsumbris/style/default-theme'
import type { ThemeControl, ThemeDraftSession, ThemeSelection as ThemeCandidate } from '@arsumbris/au-host-sdk'
import {
  createThemePreferences, inlineThemeId, sanitizeThemeOverrides, splitThemeOverrides, themeIdentity,
  type ThemeOverrides as Overrides, type ThemePreferences, type ThemeSelection,
} from './theme-preferences'
import type { ThemeSyncState } from '../../../shared/daemon-api'

export type { ThemeControl }
const preferences = createThemePreferences(localStorage, defaultTheme)
const root = document.documentElement

// ---------- theme CSS -> override map ----------

/** Read theme tokens and native-control color scheme from root declarations. */
function parseThemeCss(css: string): Overrides {
  const out: Overrides = {}
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSStyleRule && /(^|,)\s*:root\s*$/.test(rule.selectorText)) {
        const style = rule.style
        for (let i = 0; i < style.length; i++) {
          const prop = style[i]
          if (prop.startsWith('--au-') || prop === 'color-scheme') out[prop] = style.getPropertyValue(prop).trim()
        }
      }
    }
  } catch {
    // malformed CSS — ignore, treat as no overrides
  }
  return out
}

// Reconcile properties removed by switching themes or resetting an override.
let applied = new Set<string>()
function applyEffective(active: ThemeSelection | null, overrides: Overrides): void {
  const { 'color-scheme': scheme, ...tokens } = active ? parseThemeCss(active.css) : {}
  const theme = splitThemeOverrides(tokens).appearance
  if (scheme) root.style.setProperty('color-scheme', scheme)
  else root.style.removeProperty('color-scheme')
  const effective = { ...theme, ...overrides }
  const next = new Set(Object.keys(effective))
  for (const name of applied) if (!next.has(name)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(effective)) root.style.setProperty(name, value)
  applied = next
}

/** Apply saved appearance before projections mount. Does not mutate storage. */
export function applyStoredTheme(): void {
  try {
    const state = preferences.read()
    applyEffective(state.active, preferences.overrides(state))
  } catch (error) {
    applyEffective(null, {})
    console.error('Saved theme could not be applied; its storage has been retained.', error)
  }
  ensureSync() // install the cross-window receive-listener once, at boot (both the main window and a surface).
}

// ---------- cross-window sync ----------
//
// Theme + device preferences are APP-GLOBAL per-machine state, so in the one-authority model (every window
// is a surface) a change in ANY window must reach every other. A mutation relays this window's FULL
// preferences snapshot UP to main, which fans it OUT to every OTHER window; each RECEIVER persists it (so its
// own next boot is correct) and re-applies. Persisting on the receiver makes this origin-INDEPENDENT — it
// never leans on shared localStorage. Only a user mutation ORIGINATES a broadcast; the receive path never
// re-broadcasts, so there is no echo loop (main also excludes the sender).

/** Relay THIS window's new preferences to the others (through main). No-op when no bridge (a test/dev shell). */
function broadcast(): void {
  try {
    window.main?.theme?.changed(preferences.read() as unknown as ThemeSyncState)
  } catch {
    // no main bridge — local-only, never error.
  }
}

/** Apply a preferences snapshot RECEIVED from another window: persist locally, then re-apply. NEVER re-broadcasts. */
function applyRemote(state: ThemeSyncState): void {
  try {
    preferences.replace(state as unknown as ThemePreferences)
  } catch {
    return // a malformed remote snapshot is ignored; the local saved state is retained.
  }
  applyCurrent()
}

let syncInstalled = false
function ensureSync(): void {
  if (syncInstalled) return
  syncInstalled = true
  try {
    window.main?.theme?.onApply(applyRemote)
  } catch {
    // no main bridge — cross-window sync is simply off (single-window / test).
  }
}

// Appearance drafts follow theme identity; device edits are shared across themes.
const appearanceDrafts = new Map<string, Overrides>()
let deviceDraft: Overrides | undefined
let editors = 0
let preview: ThemeSelection | null | undefined
const listeners = new Set<() => void>()
function normalizeTheme(theme: ThemeCandidate | null): ThemeSelection | null {
  return theme ? { ...theme, id: theme.id ?? inlineThemeId(theme) } : null
}
function currentState() {
  return preview === undefined ? preferences.read() : preferences.view(preview)
}
function currentDraft(): Overrides {
  const state = currentState()
  const id = themeIdentity(state.active)
  if (!appearanceDrafts.has(id)) {
    const active = state.active
    const unresolved = preferences.read().unresolved
    const recovered = active && unresolved && active.name === unresolved.name && active.css === unresolved.css
      ? appearanceDrafts.get(themeIdentity(unresolved)) : undefined
    const inline = active ? appearanceDrafts.get(themeIdentity({ ...active, id: inlineThemeId(active) })) : undefined
    appearanceDrafts.set(id, { ...(recovered ?? inline ?? state.appearance[id]) })
  }
  deviceDraft ??= { ...state.device }
  return { ...appearanceDrafts.get(id), ...deviceDraft }
}
function notifyDraft(): void {
  for (const listener of listeners) {
    try { listener() } catch { console.error('A theme draft subscriber failed.') }
  }
}
function applyCurrent(): void {
  const state = currentState()
  applyEffective(state.active, editors > 0 ? currentDraft() : preferences.overrides(state))
}
function replaceDraft(next: Overrides): void {
  const split = splitThemeOverrides(next)
  appearanceDrafts.set(themeIdentity(currentState().active), split.appearance)
  deviceDraft = split.device
  applyCurrent()
  notifyDraft()
}
function openDraft(): ThemeDraftSession {
  currentDraft()
  editors++
  applyCurrent()
  let disposed = false
  const owned = new Set<() => void>()
  return {
    snapshot: () => ({ overrides: currentDraft(), saved: preferences.overrides(currentState()),
      activeTheme: currentState().active, savedTheme: preferences.read().active, previewing: preview !== undefined }),
    subscribe(listener) {
      if (disposed) return () => {}
      owned.add(listener); listeners.add(listener)
      return () => { owned.delete(listener); listeners.delete(listener) }
    },
    setToken(name, value) {
      if (disposed || !name.startsWith('--au-')) return
      const next = currentDraft()
      if (value === null) delete next[name]
      else if (value.trim()) next[name] = value.trim()
      replaceDraft(next)
    },
    reset() { if (!disposed) replaceDraft({}) },
    discard() { if (!disposed) replaceDraft(preferences.overrides(currentState())) },
    save() {
      if (disposed) return
      const next = currentDraft()
      preferences.save(next, currentState().active)
      preview = undefined
      replaceDraft(next)
      broadcast()
    },
    previewTheme(theme) {
      if (disposed) return
      const candidate = normalizeTheme(theme)
      preferences.view(candidate)
      preview = candidate
      applyCurrent()
      notifyDraft()
    },
    applyThemePreview() {
      if (disposed || preview === undefined) return
      preferences.select(preview)
      preview = undefined
      applyCurrent()
      notifyDraft()
      broadcast()
    },
    cancelThemePreview() {
      if (disposed || preview === undefined) return
      preview = undefined
      applyCurrent()
      notifyDraft()
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const listener of owned) listeners.delete(listener)
      owned.clear()
      editors--
      if (editors === 0) preview = undefined
      applyCurrent()
    },
  }
}

export const themeControl: ThemeControl = {
  openDraft,
  getOverrides: () => preferences.overrides(),
  save: (overrides) => {
    const next = sanitizeThemeOverrides(overrides)
    preferences.save(next)
    preview = undefined
    replaceDraft(next)
    broadcast()
  },
  clear: () => {
    preferences.save({})
    preview = undefined
    replaceDraft({})
    broadcast()
  },
  getActiveTheme: () => preferences.read().active,
  setActiveTheme: (theme) => {
    const before = preferences.read()
    // Inline themes have content identity; discovered themes supply their stable source identity.
    const selected = normalizeTheme(theme)
    const after = preferences.select(selected)
    preview = undefined
    const unresolved = before.unresolved
    if (unresolved && !after.unresolved && after.active) {
      const source = appearanceDrafts.get(themeIdentity(unresolved))
      if (source && !appearanceDrafts.has(themeIdentity(after.active))) {
        appearanceDrafts.set(themeIdentity(after.active), { ...source })
      }
    }
    if (after.active && !appearanceDrafts.has(themeIdentity(after.active))) {
      const inline = appearanceDrafts.get(themeIdentity({ ...after.active, id: inlineThemeId(after.active) }))
      if (inline) appearanceDrafts.set(themeIdentity(after.active), { ...inline })
    }
    applyCurrent()
    notifyDraft()
    broadcast()
  },
}
