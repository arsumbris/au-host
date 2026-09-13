// Behaviour (offer to reopen): when a floated surface's
// renderer CRASHES / is force-killed (`render-process-gone`, not a clean close), its window-node stays
// DORMANT in the authority's pool and the host OFFERS to reopen it — a warn toast with a "Reopen" action.
// Activating it re-realizes the dormant window from the pool (a fresh OS surface, content re-mounted).
//
// Distinct from a deliberate close (dock / move / user X), which never offers a reopen.
//
// Start: sandwich → left: file-tree, center: editor (the `float-dock` fixture). Float the left pane, crash
// its renderer, assert the crash trace + the Reopen offer, click it, assert the reopen trace + a new window.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-dock' })

test('a crashed floated window offers to reopen, and Reopen re-realizes it', async ({ page, electronApp, events }) => {
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')

  // Float the LEFT pane into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.getByRole('button', { name: 'Root actions' }).waitFor({ timeout: 30_000 })
  await events.clear()

  // CRASH the floated surface's renderer (render-process-gone, reason 'crashed') — main-process side, since
  // Playwright can't crash a renderer from the page. This is NOT a clean close, so it reaches `onCrashed`.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const surf = BrowserWindow.getAllWindows().find((w) => {
      try {
        return w.webContents.getURL().includes('surface')
      } catch {
        return false
      }
    })
    surf?.webContents.forcefullyCrashRenderer()
  })

  // The authority detected the crash (a lifecycle trace) and offered to reopen (a warn toast + a Reopen action).
  await events.waitFor((e) => e.category === 'lifecycle' && e.name === 'surface-crashed', { timeout: 15_000 })
  const reopen = page.locator('au-button').filter({ hasText: 'Reopen' })
  await expect(reopen).toBeVisible({ timeout: 15_000 })

  // Activate Reopen → the dormant window re-realizes as a FRESH OS surface + a reopened trace. Click the
  // au-button's INNER <button> directly: the toast re-animates continuously (~12px drift), so
  // playwright's normal `reopen.click()` never sees it "stable".

  // This still exercises the real click→au-activate→reopen path (verified: fires surface-reopened + a window).
  const [reborn] = await Promise.all([
    floatedWindow(electronApp),
    reopen.evaluate((el) => (el as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot?.querySelector('button')?.click()),
  ])
  await events.waitFor((e) => e.category === 'lifecycle' && e.name === 'surface-reopened', { timeout: 15_000 })
  await reborn.getByRole('button', { name: 'Root actions' }).waitFor({ timeout: 30_000 })

  // The main window is intact throughout (the editor never left).
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')
})
