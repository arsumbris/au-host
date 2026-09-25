// The E2E test fixture: launch the REAL built Electron app against the vault (AU_ENTRY auto-opens the
// workspace with no clicks), wait for the composition to paint, and expose the page plus two helpers:
//   - `events`  — read the host event-substrate decision traces + conditions (the assertion spine)
//   - `drive`   — perform real UI gestures (click a chrome button, open a file)
// The whole point is to assert on the DECISION ("open-intent fired → tabs claimed → editor mounted"),
// not scraped pixels, so a behaviour test reads like the spec it enforces.
import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { MAIN_ENTRY, EVENT_CATEGORIES, AU_BINARY } from '../support/paths'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedComposition, shortTempDir } from '../support/recents'
import { daemonStatus, stopDaemon } from '../support/daemon'
import { freshVault, removeVault } from '../support/vault'

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

/** The Electron main process's own stdout + stderr, per launch, bounded to the most recent lines. The
 *  daemon supervisor logs there, so a boot failure or a failed test can show what the engine said. */
const MAIN_LOG_LINES = 400
const mainLogs = new WeakMap<ElectronApplication, string[]>()
function captureMainLog(app: ElectronApplication): void {
  const lines: string[] = []
  mainLogs.set(app, lines)
  const push = (stream: string) => (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line) continue
      lines.push(`[${stream}] ${line}`)
      if (lines.length > MAIN_LOG_LINES) lines.shift()
    }
  }
  app.process().stdout?.on('data', push('out'))
  app.process().stderr?.on('data', push('err'))
}
const mainLogOf = (app: ElectronApplication): string => (mainLogs.get(app) ?? []).join('\n')

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
  /** This test's vault: a fresh copy of the authored fixture in its own git repository (support/vault.ts).
   *  The app opens it as AU_ENTRY; engine writes commit there, never into au-host. */
  vault: string
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
  vault: async ({}, use) => {
    const vault = freshVault()
    try {
      await use(vault)
    } finally {
      stopDaemon(vault)
      removeVault(vault)
    }
  },
  electronApp: async ({ vault, composition, projectionDevelopment }, use, testInfo) => {
    // ISOLATION: each launch gets its own au-host device dir (AU_HOST_DEVICE_DIR) — its own drafts,
    // view-state, recents and workspace claims — so a run never reads or writes the user's real stores and
    // never restores state another run left behind. The engine tenant (the device registry) is NOT relocated.
    const hostDir = shortTempDir('auh-')
    // Deterministically auto-mount THIS test's composition: seed recents to rank-0.
    seedComposition(composition, hostDir, vault)
    // The engine binary is configured in the relocated host config, as an install would, so the launcher's
    // member check answers and the workspace auto-opens with no setup UI to drive.
    mkdirSync(join(hostDir, 'config'), { recursive: true })
    writeFileSync(join(hostDir, 'config', 'paths.yaml'), `au: ${AU_BINARY}\n`)
    const profile = mkdtempSync(join(tmpdir(), 'au-host-e2e-'))
    // The temp dirs are removed however the launch ends, a failed launch included.
    try {
      const app = await electron.launch({
        args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
        // AU_E2E_OFFSCREEN: create the app window hidden so the run never covers the developer's screen (real
        // Chromium still renders; Playwright drives it over CDP). Unset it in the env to watch a run live.
        env: { ...process.env, AU_HOST_DEVICE_DIR: hostDir, AU_ENTRY: vault, AU_HOST_EVENTS: EVENT_CATEGORIES, AU_E2E_OFFSCREEN: '1', AU_PROJECTION_DEV: projectionDevelopment ? '1' : '0' } as Record<string, string>,
      })
      // The app is closed however the rest ends. A failure before the test body (a failed trace start, a
      // setup that never completes) keeps the same evidence a failed test does.
      let failedBeforeTest = false
      try {
        captureMainLog(app)
        // A trace covers every window of the app (one browser context). It is written only for a failed test.
        await app.context().tracing.start({ screenshots: true, snapshots: true })
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
        } catch (error) {
          failedBeforeTest = true
          throw error
        }
        await use(app)
      } finally {
        if (failedBeforeTest || testInfo.status !== testInfo.expectedStatus) {
          const trace = testInfo.outputPath('trace.zip')
          await app.context().tracing.stop({ path: trace }).catch(() => undefined)
          await testInfo.attach('trace', { path: trace, contentType: 'application/zip' }).catch(() => undefined)
          for (const [i, window] of app.windows().entries()) {
            try {
              const shot = testInfo.outputPath(`window-${i}.png`)
              await window.screenshot({ path: shot, timeout: 5_000 })
              await testInfo.attach(`window-${i}`, { path: shot, contentType: 'image/png' })
            } catch (error) {
              await testInfo.attach(`window-${i}-screenshot-failed`, { body: String(error), contentType: 'text/plain' })
            }
          }
          await testInfo.attach('main-process-log', { body: mainLogOf(app), contentType: 'text/plain' })
        } else {
          await app.context().tracing.stop().catch(() => undefined)
        }
        await app.close()
      }
    } finally {
      rmSync(profile, { recursive: true, force: true })
      rmSync(hostDir, { recursive: true, force: true })
    }
  },
  page: async ({ electronApp, vault }, use) => {
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
      // The launcher's startup log sits in a collapsed disclosure, which innerText skips.
      const startup = await page.locator('.gate-disclosure pre.log').textContent().catch(() => null)
      throw new Error(
        `composition never painted (no [data-pane-id] in 60s).\n--- on-screen text ---\n${text}\n--- launcher startup log ---\n${startup ?? '<none>'}\n--- au daemon status ---\n${daemonStatus(vault)}\n--- main process (tail) ---\n${mainLogOf(electronApp).split('\n').slice(-60).join('\n')}\n--- recent console (${logs.length}) ---\n${logs.slice(-40).join('\n')}\n--- original ---\n${(err as Error).message}`,
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
