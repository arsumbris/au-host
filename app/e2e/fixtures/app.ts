// The E2E test fixture: launch the REAL built Electron app against the vault (AU_ENTRY auto-opens the
// workspace with no clicks), wait for the composition to paint, and expose the page plus two helpers:
//   - `events`  — read the host event-substrate decision traces + conditions (the assertion spine)
//   - `drive`   — perform real UI gestures (click a chrome button, open a file)
// The whole point is to assert on the DECISION ("open-intent fired → tabs claimed → editor mounted"),
// not scraped pixels, so a behaviour test reads like the spec it enforces.
import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { MAIN_ENTRY, VAULT, EVENT_CATEGORIES, AU_BINARY } from '../support/paths'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedComposition } from '../support/recents'
import { stopDaemon } from '../support/daemon'

/** A host event record, mirrored from `@arsumbris/au-host-sdk`'s HostEvent (kept local so the e2e
 *  package needs no build-time dep on the SDK types). */
export interface HostEvent {
  seq: number
  t: number
  category: string
  name: string
  kind: 'trace' | 'condition'
  cause?: number
  subject?: string
  severity?: 'error' | 'warning' | 'hint'
  cleared?: true
  fields?: Record<string, unknown>
}
export interface EventFilter {
  category?: string
  cause?: number
  subject?: string
}

export interface Events {
  /** The trace timeline (newest last), optionally filtered. */
  read(filter?: EventFilter): Promise<HostEvent[]>
  /** The standing condition set as an array. */
  conditions(): Promise<HostEvent[]>
  /** Ring stats — `{ size, capacity, dropped, seq }`. */
  stats(): Promise<{ size: number; capacity: number; dropped: number; seq: number }>
  /** Drop every recorded event (to isolate a gesture's traces). */
  clear(): Promise<void>
  /** Poll the timeline until `pred` matches some event, or time out. Returns the matching event. */
  waitFor(pred: (e: HostEvent) => boolean, opts?: { timeout?: number; filter?: EventFilter }): Promise<HostEvent>
}

function makeEvents(page: Page): Events {
  const read = (filter?: EventFilter) =>
    page.evaluate((f) => (globalThis as unknown as { __auEvents: { read(f?: unknown): HostEvent[] } }).__auEvents.read(f), filter) as Promise<HostEvent[]>
  return {
    read,
    conditions: () =>
      page.evaluate(() => (globalThis as unknown as { __auEvents: { conditions(): HostEvent[] } }).__auEvents.conditions()) as Promise<HostEvent[]>,
    stats: () =>
      page.evaluate(() => (globalThis as unknown as { __auEvents: { stats(): { size: number; capacity: number; dropped: number; seq: number } } }).__auEvents.stats()),
    clear: () => page.evaluate(() => (globalThis as unknown as { __auEvents: { clear(): void } }).__auEvents.clear()),
    async waitFor(pred, opts) {
      const deadline = Date.now() + (opts?.timeout ?? 10_000)
      let last: HostEvent[] = []
      while (Date.now() < deadline) {
        last = await read(opts?.filter)
        const hit = last.find(pred)
        if (hit) return hit
        await page.waitForTimeout(150)
      }
      throw new Error(`waitFor: no matching event within timeout. saw ${last.length} events: ${JSON.stringify(last.slice(-12))}`)
    },
  }
}

/** Grab a FLOATED surface window (opened by a `children.pool.float` / "Open in a new window") as a
 *  drivable Page. Playwright surfaces every BrowserWindow the app opens as a `window` event on the
 *  ElectronApplication, so call this in a `Promise.all` with the gesture that floats:
 *    const [floated] = await Promise.all([floatedWindow(electronApp), openInNewWindow()])
 *  The floated window boots the mount agent + its `<au-*>` chrome bar (the pop-back button). Its own
 *  event substrate is separate; dock traces fire on the MAIN window's substrate (the authority), so
 *  assert those via the main `events`, and use this only to DRIVE the floated window's chrome. */
export async function floatedWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.waitForEvent('window')
  page.on('pageerror', (e) => console.error(`[floated pageerror] ${e.message}`))
  return page
}

export { makeEvents }

export interface Drive {
  /** Click a pane-header action button by its accessible label, scoped to the app. */
  clickButton(name: string | RegExp): Promise<void>
}

function makeDrive(page: Page): Drive {
  return {
    clickButton: (name) => page.getByRole('button', { name }).first().click(),
  }
}

interface Fixtures {
  electronApp: ElectronApplication
  page: Page
  events: Events
  drive: Drive
}
interface Options {
  projectionDevelopment: boolean
  /** The composition fixture to auto-mount — `vault/compositions/<composition>.yaml`. Override per test
   *  with `test.use({ composition: 'close-empty-tab' })`. */
  composition: string
}

export const test = base.extend<Fixtures & Options>({
  projectionDevelopment: [false, { option: true }],
  composition: ['sanity', { option: true }],
  electronApp: async ({ composition, projectionDevelopment }, use) => {
    // Deterministically auto-mount THIS test's composition: seed recents to rank-0, and stop any stale
    // vault daemon so the app spawns a fresh one that sees the current vault (compositions + files).
    seedComposition(composition)
    stopDaemon()
    const profile = mkdtempSync(join(tmpdir(), 'au-host-e2e-'))
    const app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
      // AU_E2E_OFFSCREEN: create the app window hidden so the run never covers the developer's screen (real
      // Chromium still renders; Playwright drives it over CDP). Unset it in the env to watch a run live.
      env: { ...process.env, AU_ENTRY: VAULT, AU_HOST_EVENTS: EVENT_CATEGORIES, AU_E2E_OFFSCREEN: '1', AU_PROJECTION_DEV: projectionDevelopment ? '1' : '0' } as Record<string, string>,
    })
    try {
      const initial = await app.firstWindow()
      // These tests exercise mounted workspace behavior with a configured engine.
      // Keep that fixture configuration out of the developer's Electron profile.
      const setup = initial.getByText('Engine and agent tools', { exact: true })
      await setup.or(initial.locator('[data-pane-id]').first()).first().waitFor({ timeout: 60_000 }).catch(async error => {
        throw new Error(`Workspace setup did not complete: ${await initial.locator('body').innerText()}`, { cause: error })
      })
      if (await setup.isVisible()) {
        await setup.click()
        await initial.getByLabel('Engine executable · required to open').fill(AU_BINARY)
        await initial.getByRole('button', { name: 'Start and open workspace →', exact: true }).click()
      }
      await use(app)
    } finally {
      await app.close()
      rmSync(profile, { recursive: true, force: true })
    }
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    const logs: string[] = []
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
    // The composition has painted once a pane is mounted (the launcher dissolved into ProjectionHost).
    try {
      await page.waitForSelector('[data-pane-id]', { timeout: 60_000 })
      await expect(page.locator('.au-dissolve')).toHaveAttribute('data-phase', 'done')
    } catch (err) {
      const text = await page.evaluate(() => document.body.innerText).catch(() => '<no body>')
      throw new Error(
        `composition never painted (no [data-pane-id] in 60s).\n--- on-screen text ---\n${text}\n--- recent console (${logs.length}) ---\n${logs.slice(-40).join('\n')}\n--- original ---\n${(err as Error).message}`,
      )
    }
    await use(page)
  },
  events: async ({ page }, use) => {
    await use(makeEvents(page))
  },
  drive: async ({ page }, use) => {
    await use(makeDrive(page))
  },
})

export { expect }
