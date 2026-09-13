// Docking a floated editor after wrapping it into a two-tab group preserves the whole current subtree.
// A clean inverse applies only while the floated content remains unchanged; after wrapping, docking
// re-homes the group and both tabs.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-wrap' })

test('docking a floated window whose content was wrapped re-homes the whole group, not just the original pane', async ({ page, electronApp, events }) => {
  // Float the LEFT bare editor into its own window (mirrors cross-window-wrap's proven setup).
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('.cm-content', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Other content', { timeout: 15_000 })

  // Open a file onto it → wrap into Tabs, so the floated window's content is now a tabs GROUP with two tabs
  // (other.md + sample.md). This is the setup the bug needed: the content differs from the floated pane.
  await page.locator('au-tree-row[data-path$="/sample.md"]').click()
  await page.getByRole('menuitem', { name: /^Keep Editor and add this file/ }).click()
  await page.getByRole('menuitem', { name: 'Tabs', exact: true }).click()
  await expect(floated.locator('au-tab-strip-cell')).toHaveCount(2, { timeout: 15_000 })

  // Dock back. The content changed since the float, so the clean-inverse is skipped and the fallback
  // re-homes the CURRENT content (the group) into a main-window leaf via the spatial chooser.
  await events.clear()
  // "Move to other window": the sole other window is main, so it auto-picks and runs the dock
  // path — the changed content skips the clean inverse and asks the main-window spatial chooser.
  await floated.getByRole('button', { name: 'Root actions' }).click()
  await floated.getByRole('menuitem', { name: 'Move to other window' }).click()
  const targets = page.locator('au-pane-target')
  await targets.first().waitFor({ timeout: 10_000 })
  // Pick the LEFTMOST candidate = the emptied origin slot, so the group returns whence it was floated.
  const n = await targets.count()
  let leftmost = 0
  let minX = Infinity
  for (let i = 0; i < n; i++) {
    const box = await targets.nth(i).boundingBox()
    if (box && box.x < minX) {
      minX = box.x
      leftmost = i
    }
  }
  await targets.nth(leftmost).click()

  // THE FIX: the WHOLE group re-homed to the main window — a tabs group with BOTH tabs, nothing lost. The
  // active tab (the last-child rule → the opened file) renders.
  await expect(page.locator('au-tab-strip-cell')).toHaveCount(2, { timeout: 15_000 })
  await expect(page.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
  // The floated window closed (its content is back in the main window).
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(1)

  // Assert no standing error after docking. The tab-count assertion independently detects a lost subtree,
  // which can occur without producing an error diagnostic.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
