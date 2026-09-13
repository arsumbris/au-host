// Closing a non-empty floated window prompts in that window. Cancel retains it; close discards
// its content; moving relocates the panes. A deliberate close does not offer crash recovery.
// Assert the chooser and each resulting window state.
import { test, expect, floatedWindow } from '../fixtures/app'
import type { Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

test.use({ composition: 'float-dock' }) // sandwich → left: file-tree, center: editor (two floatable regions)

// Float the LEFT region (file-tree) into its own window B (non-empty). B holds the file-tree; main keeps the editor.
async function floatFileTree(page: Page, electronApp: ElectronApplication): Promise<Page> {
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [b] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await b.locator('au-tree-row').first().waitFor({ timeout: 30_000 })
  return b
}

// Simulate the USER closing window B (the traffic-light / cmd-W): a raw `win.close()`, which is NOT the
// authority's programmatic `surface.close`, so the authority intercepts + prompts. (The main process can't
// tell WHO clicked; it only knows the close was not programmatic.)
async function userClose(electronApp: ElectronApplication, b: Page): Promise<void> {
  const bw = await electronApp.browserWindow(b)
  await bw.evaluate((win) => win.close())
}

test('closing a NON-EMPTY floated window prompts IN that window (not silently, not in main)', async ({ page, electronApp, events }) => {
  const b = await floatFileTree(page, electronApp)
  await events.clear()
  await userClose(electronApp, b)

  // The authority intercepted the close and asked — a lifecycle trace, then the confirm rendered IN window B.
  await events.waitFor((e) => e.category === 'lifecycle' && e.name === 'surface-close-requested', { timeout: 15_000 })
  await b.locator('.au-chooser-card').waitFor({ timeout: 10_000 })
  await expect(b.getByRole('menuitem', { name: 'Close', exact: true })).toBeVisible()
  await expect(b.getByRole('menuitem', { name: 'Move its panes to another window' })).toBeVisible()
  // The dialog is NOT in the main window (the choice renders where the user acted).
  await expect(page.locator('.au-chooser-card')).toHaveCount(0)
  // B is STILL OPEN — the OS close was prevented pending the choice.
  await expect.poll(() => electronApp.windows().length, { timeout: 5_000 }).toBe(2)
})

test('Cancel keeps the window open', async ({ page, electronApp }) => {
  const b = await floatFileTree(page, electronApp)
  await userClose(electronApp, b)
  await b.locator('.au-chooser-card').waitFor({ timeout: 10_000 })
  await b.getByRole('menuitem', { name: 'Cancel', exact: true }).click()
  await b.locator('.au-chooser-card').waitFor({ state: 'detached', timeout: 5_000 })
  // The window stays, its content intact.
  await expect(b.locator('au-tree-row').first()).toBeVisible()
  await expect.poll(() => electronApp.windows().length, { timeout: 5_000 }).toBe(2)
})

test('Close reaps the content and closes the window (a deliberate discard)', async ({ page, electronApp, events }) => {
  const b = await floatFileTree(page, electronApp)
  await events.clear()
  await userClose(electronApp, b)
  await b.locator('.au-chooser-card').waitFor({ timeout: 10_000 })
  await b.getByRole('menuitem', { name: 'Close', exact: true }).click()

  // The window closed AND its content was REAPED — a distinct lifecycle trace, not the dormant onSurfaceClosed path.
  await events.waitFor((e) => e.category === 'lifecycle' && e.name === 'surface-closed-reaped', { timeout: 15_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(1) // main only
  // Main kept its OWN editor — the reap took only window B's content.
  await expect(page.locator('.cm-content').first()).toBeVisible()
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})

test('“Move its panes to another window” relocates the content — nothing lost', async ({ page, electronApp, events }) => {
  const b = await floatFileTree(page, electronApp) // B holds the file-tree; main holds the editor
  await events.clear()
  await userClose(electronApp, b)
  await b.locator('.au-chooser-card').waitFor({ timeout: 10_000 })
  await b.getByRole('menuitem', { name: 'Move its panes to another window' }).click()

  // Relocate to the sole other window (main): the surface's whole-content move-to-window docks it into main.
  // Main may ask a spatial pick if it has >1 receivable leaf — answer it if so (the pick renders in main).
  const paneTarget = page.locator('au-pane-target').first()
  if (await paneTarget.isVisible({ timeout: 4_000 }).catch(() => false)) await paneTarget.click()

  // Window B closed, and its file-tree relocated into main — nothing lost (main now shows both).
  await expect.poll(() => electronApp.windows().length, { timeout: 15_000 }).toBe(1)
  await expect(page.locator('.cm-content').first()).toBeVisible()
  await expect(page.locator('au-tree-row').first()).toBeVisible({ timeout: 15_000 })
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
