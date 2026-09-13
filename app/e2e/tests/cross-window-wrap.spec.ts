// Opening a file onto a floated bare editor wraps it in that same window. Its root container DOM
// belongs to the remote surface, so the authority wraps the pool content and re-drives the surface
// instead of using the main renderer's DOM-keyed `wrapPane`.
// Float the editor, open a file from main, then choose to keep the editor in Tabs. Assert two tabs in
// the floated window with the new file active.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-wrap' })

test('a file opened onto a floated bare editor wraps it in a tabs container in that window', async ({ page, electronApp, events }) => {
  // Float the LEFT region (a BARE editor) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  // The floated window renders the bare editor (other.md), with no tab bar yet.
  await floated.waitForSelector('.cm-content', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Other content', { timeout: 15_000 })
  await expect(floated.locator('au-tab-strip-cell')).toHaveCount(0)

  // The file-tree stays in the main window; it lists the vault's sample.md.
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()
  await events.clear()

  // Click the file → open-intent → nothing claims (the floated bare editor is aimed-only) → the authority's
  // chooser floor opens in the MAIN window. Wrap the editor, picking Tabs. viewer-defaults resolve the
  // editor silently (no second must-pick chooser).
  await fileRow.click()
  await page.getByRole('menuitem', { name: /^Keep Editor and add this file/ }).click()
  await page.getByRole('menuitem', { name: 'Tabs', exact: true }).click()

  // THE FIX: the authority wrapped the FLOATED window's root content (a pool re-point) and RE-DROVE the
  // surface, so the bare editor is now a tabs group holding [other.md, sample.md] with the NEW tab active.
  await expect(floated.locator('au-tab-strip-cell')).toHaveCount(2, { timeout: 15_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })

  // Assert a successful remote wrap outcome. A refusal carries a distinct outcome so it is observable.
  const wrapEv = await events.waitFor((e) => e.category === 'placement' && e.name === 'wrap', { timeout: 15_000 })
  expect(wrapEv.fields?.remote, 'routed as a remote (surface) wrap, not the DOM-local wrapPane').toBe(true)
  expect(wrapEv.fields?.outcome, 'the floated-window root wrap succeeded').toBe('wrapped')

  // No standing ERROR was raised by the cross-window wrap.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
