import { splitThemeOverrides } from '@arsumbris/au-host-sdk'
export { splitThemeOverrides } from '@arsumbris/au-host-sdk'
/** Device-local persistence for theme appearance and independent device preferences. */
export type ThemeOverrides = Record<string, string>
export interface ThemeSelection {
  /** Stable discovery identity, independent of the display name and CSS contents. */
  id: string
  name: string
  css: string
}
export interface ThemePreferences {
  version: 1
  active: ThemeSelection | null
  appearance: Record<string, ThemeOverrides>
  device: ThemeOverrides
  unresolved?: ThemeSelection
}

export const THEME_PREFERENCES_KEY = 'au-host.theme.preferences'
const BASE_ID = 'base'
const LEGACY_ACTIVE_KEY = 'au-host.theme.active'
const LEGACY_OVERRIDES_KEY = 'au-host.theme.overrides'
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizeThemeOverrides(value: unknown): ThemeOverrides {
  if (!record(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) =>
    key.startsWith('--au-') && typeof entry === 'string' && entry.trim()
      ? [[key, entry.trim()]] : [],
  ))
}


export function themeIdentity(theme: ThemeSelection | null): string {
  return theme ? `theme:${theme.id}` : BASE_ID
}

export function inlineThemeId(theme: Pick<ThemeSelection, 'name' | 'css'>): string {
  return `inline:${JSON.stringify([theme.name, theme.css])}`
}

function selection(value: unknown): value is ThemeSelection {
  return record(value) && typeof value.id === 'string' && !!value.id &&
    typeof value.name === 'string' && typeof value.css === 'string'
}

function parseStored(raw: string): unknown {
  try { return JSON.parse(raw) } catch {
    throw new Error('Stored theme preferences could not be read. The saved record has been retained.')
  }
}

function decode(value: unknown): ThemePreferences {
  if (!record(value) || value.version !== 1 ||
    !(value.active === null || selection(value.active)) ||
    !record(value.appearance) || !record(value.device) ||
    !(value.unresolved === undefined || selection(value.unresolved)) ||
    !Object.values(value.appearance).every(record)) {
    throw new Error('Stored theme preferences have an unsupported shape. The saved record has been retained.')
  }
  return {
    version: 1,
    active: value.active,
    appearance: Object.fromEntries(Object.entries(value.appearance).map(([id, entries]) =>
      [id, splitThemeOverrides(sanitizeThemeOverrides(entries)).appearance])),
    device: splitThemeOverrides(sanitizeThemeOverrides(value.device)).device,
    ...(value.unresolved ? { unresolved: value.unresolved } : {}),
  }
}

/** All persisted mutations use one atomic storage record; source records remain recoverable. */
export function createThemePreferences(storage: StoragePort, initialTheme: ThemeSelection | null = null) {
  function read(): ThemePreferences {
    const saved = storage.getItem(THEME_PREFERENCES_KEY)
    if (saved !== null) return decode(parseStored(saved))
    const activeRaw = storage.getItem(LEGACY_ACTIVE_KEY)
    const oldActive = activeRaw === null ? null : parseStored(activeRaw)
    const active = record(oldActive) && typeof oldActive.name === 'string' && typeof oldActive.css === 'string'
      ? { id: `unresolved:${oldActive.name}`, name: oldActive.name, css: oldActive.css } : activeRaw === null && storage.getItem(LEGACY_OVERRIDES_KEY) === null ? initialTheme : null
    const overridesRaw = storage.getItem(LEGACY_OVERRIDES_KEY)
    const overrides = splitThemeOverrides(sanitizeThemeOverrides(overridesRaw === null ? {} : parseStored(overridesRaw)))
    return { version: 1, active, appearance: { [themeIdentity(active)]: overrides.appearance }, device: overrides.device,
      ...(active && oldActive ? { unresolved: active } : {}) }
  }

  function write(next: ThemePreferences): ThemePreferences {
    try { storage.setItem(THEME_PREFERENCES_KEY, JSON.stringify(next)) } catch {
      throw new Error('Theme preferences could not be saved on this device. Your preview is still unsaved.')
    }
    return next
  }

  function view(active: ThemeSelection | null): ThemePreferences {
    const state = read()
    if (active && !selection(active)) throw new Error('A theme requires a stable discovery identity.')
    const previous = state.unresolved
    // Resolve a saved selection only when both its label and contents match discovery.
    if (previous?.id.startsWith('unresolved:') && active &&
      previous.name === active.name && previous.css === active.css &&
      !Object.hasOwn(state.appearance, themeIdentity(active))) {
      state.appearance[themeIdentity(active)] = { ...state.appearance[themeIdentity(previous)] }
      delete state.unresolved
    }
    if (active && !Object.hasOwn(state.appearance, themeIdentity(active))) {
      const inline = state.appearance[themeIdentity({ ...active, id: inlineThemeId(active) })]
      if (inline) state.appearance[themeIdentity(active)] = { ...inline }
    }
    return { ...state, active: active ? { ...active } : null }
  }

  return {
    read,
    overrides(state = read()): ThemeOverrides {
      return { ...state.appearance[themeIdentity(state.active)], ...state.device }
    },
    view,
    /** Persist a full preferences snapshot verbatim — the receive path for cross-window theme sync. */
    replace(next: ThemePreferences): ThemePreferences { return write(next) },
    select(active: ThemeSelection | null): ThemePreferences { return write(view(active)) },
    save(overrides: ThemeOverrides, active?: ThemeSelection | null): ThemePreferences {
      const state = active === undefined ? read() : view(active)
      const next = splitThemeOverrides(overrides)
      return write({ ...state, device: next.device,
        appearance: { ...state.appearance, [themeIdentity(state.active)]: next.appearance } })
    },
  }
}
