// Cross-window theme sync relays the full persisted preferences snapshot. A receiver applies and
// persists it without echoing it to main, including inactive themes and independent device settings.
// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { Storage } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_PREFERENCES_KEY, type ThemePreferences } from '../src/renderer/src/projections/theme-preferences.ts'
import type { ThemeSyncState } from '../src/shared/daemon-api.ts'

const root = document.documentElement
const relayed: ThemeSyncState[] = []
let applyRemote: ((s: ThemeSyncState) => void) | undefined
let store: typeof import('../src/renderer/src/projections/theme-store.ts')
let storage: Storage

beforeEach(async () => {
  // Node 25 can expose its native localStorage instead of happy-dom's. Install browser storage
  // before importing the module, which captures that port once at initialization.
  vi.resetModules()
  storage = new Storage()
  vi.stubGlobal('localStorage', storage)
  root.removeAttribute('style')
  relayed.length = 0
  applyRemote = undefined
  ;(window as unknown as { main: unknown }).main = {
    theme: {
      changed: (s: ThemeSyncState) => relayed.push(s),
      onApply: (cb: (s: ThemeSyncState) => void) => { applyRemote = cb },
    },
  }
  store = await import('../src/renderer/src/projections/theme-store.ts')
  store.applyStoredTheme()
})

afterEach(() => vi.unstubAllGlobals())

const ACCENT = ':root { --au-color-accent: #123456; }'
const OCEAN = { id: 'ocean', name: 'Ocean', css: ACCENT }
const persisted = (): ThemePreferences => JSON.parse(storage.getItem(THEME_PREFERENCES_KEY)!)
const receive = (state: ThemePreferences) => {
  expect(applyRemote, 'the receive-listener must have registered at boot').toBeTypeOf('function')
  applyRemote!(state as unknown as ThemeSyncState)
}

describe('a theme mutation relays its persisted state to the other windows', () => {
  it('setActiveTheme applies locally and broadcasts the full preferences snapshot', () => {
    store.themeControl.setActiveTheme(OCEAN)
    expect(root.style.getPropertyValue('--au-color-accent')).toBe('#123456')
    expect(relayed).toEqual([persisted()])
    expect(persisted()).toEqual({ version: 1, active: OCEAN, appearance: { 'theme:shipped:umbris-flat': {} }, device: {} })
  })

  it('save broadcasts theme appearance and independent device preferences together', () => {
    store.themeControl.setActiveTheme(OCEAN)
    relayed.length = 0
    store.themeControl.save({ '--au-color-accent': '#abcdef', '--au-terminal-font-size': '15px' })
    expect(root.style.getPropertyValue('--au-color-accent')).toBe('#abcdef')
    expect(root.style.getPropertyValue('--au-terminal-font-size')).toBe('15px')
    expect(relayed).toEqual([persisted()])
    expect(persisted()).toEqual({
      version: 1, active: OCEAN,
      appearance: { 'theme:shipped:umbris-flat': {}, 'theme:ocean': { '--au-color-accent': '#abcdef' } },
      device: { '--au-terminal-font-size': '15px' },
    })
  })
})

describe('a received snapshot is applied and persisted without re-broadcasting', () => {
  it('retains inactive theme settings while applying the remote active theme and device preferences', () => {
    const snapshot: ThemePreferences = {
      version: 1, active: OCEAN,
      appearance: { base: { '--au-color-accent': '#999999' }, 'theme:ocean': {} },
      device: { '--au-terminal-font-size': '16px' },
    }
    receive(snapshot)
    expect(root.style.getPropertyValue('--au-color-accent')).toBe('#123456')
    expect(root.style.getPropertyValue('--au-terminal-font-size')).toBe('16px')
    expect(store.themeControl.getActiveTheme()).toEqual(OCEAN)
    expect(persisted()).toEqual(snapshot)
    expect(relayed).toEqual([])
  })

  it('restores received appearance and device settings from storage at the next boot without echoing', async () => {
    const snapshot: ThemePreferences = {
      version: 1, active: null,
      appearance: { base: { '--au-color-accent': '#0f0f0f' } },
      device: { '--au-terminal-font-size': '17px' },
    }
    receive(snapshot)
    expect(persisted()).toEqual(snapshot)
    root.removeAttribute('style')
    vi.resetModules()
    const rebooted = await import('../src/renderer/src/projections/theme-store.ts')
    rebooted.applyStoredTheme()
    expect(root.style.getPropertyValue('--au-color-accent')).toBe('#0f0f0f')
    expect(root.style.getPropertyValue('--au-terminal-font-size')).toBe('17px')
    expect(rebooted.themeControl.getOverrides()).toEqual({ '--au-color-accent': '#0f0f0f', '--au-terminal-font-size': '17px' })
    expect(relayed).toEqual([])
  })
})

 it('starts a fresh profile with flat surfaces', () => {
   expect(store.themeControl.getActiveTheme()?.name).toBe('Umbris — Flat')
   for (const token of ['--au-chrome-background-image', '--au-pane-background-image', '--au-pane-edge-image']) expect(readFileSync('../packages/style/themes/flat-surfaces.css', 'utf8')).toContain(`${token}: none`)
 })
