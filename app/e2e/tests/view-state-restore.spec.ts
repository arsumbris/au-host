// REGRESSION LOCK: main-window view-state (scroll) survives an app restart via the BOOT HYDRATE.
//
// The restorable view-state auto-store (editor cursor/scroll/folds) is MAIN-owned and persists across app
// restarts. The renderer holds a CACHE that `mountRootPortal` HYDRATES from main at composition load, so a
// pane's sync `viewStore.get` restores on mount. That hydrate call lived only in the dead `mountRoot` for a
// while, so main-window restore was silently broken (a surface hydrates via its mount agent, so only the
// MAIN window regressed). This test drives a scroll, restarts the app, and asserts the scroll came back —
// it FAILS if the boot hydrate is missing (fresh cache → the editor mounts at scroll 0).
//
// Bespoke TWO-LAUNCH flow (the standard fixture is single-launch): launch → scroll+persist → close (flush)
// → relaunch → assert restored. The view-state store is the real main-owned file (like the recents the
// harness already seeds), scoped to THIS fixture's composition + node, so it never clobbers unrelated state.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { MAIN_ENTRY, VAULT, EVENT_CATEGORIES, AU_BINARY } from '../support/paths'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedComposition } from '../support/recents'
import { stopDaemon } from '../support/daemon'

async function launch(profile: string, configure = false): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, AU_ENTRY: VAULT, AU_HOST_EVENTS: EVENT_CATEGORIES, AU_E2E_OFFSCREEN: '1' } as Record<string, string>,
  })
  const page = await app.firstWindow()
  if (configure) {
    await page.getByText('Engine and agent tools', { exact: true }).click()
    await page.getByLabel('Engine executable · required to open').fill(AU_BINARY)
    await page.getByRole('button', { name: 'Start and open workspace →', exact: true }).click()
  }
  await page.waitForSelector('.cm-scroller', { timeout: 60_000 }) // the editor pane painted
  await expect(page.locator('.au-dissolve')).toHaveAttribute('data-phase', 'done')
  return { app, page }
}

const scrollTopOf = (page: Page): Promise<number> =>
  page.locator('.cm-scroller').first().evaluate((el) => el.scrollTop)

test('main-window editor scroll survives an app restart (boot hydrate restores view-state)', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'au-host-e2e-restore-'))
  seedComposition('view-state-restore') // auto-mount the long-file editor composition at boot
  stopDaemon() // a fresh daemon over the current vault; the second launch adopts the still-running one

  // LAUNCH 1 — scroll the editor down, let it persist to the main-owned store, then close (flush-on-quit).
  const l1 = await launch(profile, true)
  await l1.page.locator('.cm-scroller').first().evaluate((el) => { el.scrollTop = 3000 }) // fires 'scroll' → persist
  await l1.page.waitForTimeout(800) // let the editor's scroll persist reach main (it debounces the disk flush)
  const saved = await scrollTopOf(l1.page)
  expect(saved, 'the long file must actually scroll (so restore is observable)').toBeGreaterThan(200)
  await l1.app.close() // before-quit flushes the store to disk

  // LAUNCH 2 — a FRESH renderer (empty cache). Only the boot hydrate can restore the scroll.
  const l2 = await launch(profile)
  try {
    // The scroll restore runs a frame after the editor mounts (a rAF-guarded scrollTop set), so poll.
    await expect
      .poll(() => scrollTopOf(l2.page), { timeout: 10_000, message: 'editor scroll never restored after restart' })
      .toBeGreaterThan(saved * 0.8)
  } finally {
    await l2.app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
