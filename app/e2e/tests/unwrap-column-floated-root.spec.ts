// Unwrapping a single-child column at a floated window root lifts its editor into that window's
// content position. Keep another pane in main so the test can distinguish both windows.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'column-region-float' }) // window → sandwich → { left: column{editor}, center: file-tree }

test('unwrap a single-child column at a FLOATED window root lifts the editor to window content', async ({ page, electronApp, events }) => {
  await page.waitForSelector('.cm-content', { timeout: 30_000 })

  // Float the LEFT region (the column) into its own window — `.first()` "Pane actions" is the left region.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [winA] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  // The floated window's root IS the single-child column (holding the editor). (If `.first()` had floated the
  // column's ITEM instead, winA would hold a bare editor with no column — so this also confirms we floated the column.)
  await winA.waitForSelector('[data-container-kind="column"]', { timeout: 30_000 })
  await expect(winA.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })

  // Unwrap the column via its item ⋯ (offered because the column holds ONE item).
  const buttons = winA.getByRole('button', { name: 'Pane actions' })
  await expect.poll(() => buttons.count(), { timeout: 15_000 }).toBeGreaterThan(0)
  let unwrapped = false
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    await buttons.nth(i).click()
    const item = winA.getByRole('menuitem', { name: 'Unwrap container' })
    if (await item.isVisible().catch(() => false)) {
      await item.click()
      unwrapped = true
      break
    }
    await winA.keyboard.press('Escape')
  }
  expect(unwrapped, 'no "Unwrap container" offered in the floated window').toBe(true)

  // THE PROOF: the column is gone and the editor is now the floated window's content (still visible).
  await expect(winA.locator('[data-container-kind="column"]')).toHaveCount(0, { timeout: 10_000 })
  await expect(winA.locator('.cm-content').first()).toBeVisible()
  await expect(winA.locator('.cm-content').first()).toContainText('Sample content')

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
