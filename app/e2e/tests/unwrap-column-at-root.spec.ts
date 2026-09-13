// Unwrapping a single-child column at a window root lifts its child bento into the window's content
// position. Assert that the column disappears while the bento and its editor remain.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'column-bento-root' }) // window → column → bento → editor

// The COLUMN-item's ⋯ (for the bento) offers "Unwrap container" (dissolve the column) but NOT bento's own
// "Split right"; the bento-LEAF's ⋯ (for the editor) offers "Split right". Pick the column-item one.
async function openColumnItemMenu(page: import('@playwright/test').Page): Promise<void> {
  const buttons = page.getByRole('button', { name: 'Pane actions' })
  await expect.poll(() => buttons.count(), { timeout: 15_000 }).toBeGreaterThan(0)
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    await buttons.nth(i).click()
    const hasUnwrap = await page.getByRole('menuitem', { name: 'Unwrap container' }).isVisible().catch(() => false)
    const hasSplit = await page.getByRole('menuitem', { name: 'Split right' }).isVisible().catch(() => false)
    if (hasUnwrap && !hasSplit) return // the column-item menu (unwrap the column, not the bento)
    await page.keyboard.press('Escape')
  }
  throw new Error('no column-item ⋯ menu found (none offered Unwrap without Split right)')
}

test('unwrap a single-child column at the window root lifts the bento to window content', async ({ page, events }) => {
  await expect(page.locator('[data-container-kind="column"]').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-container-kind="bento"]').first()).toBeVisible()

  await openColumnItemMenu(page)
  await page.getByRole('menuitem', { name: 'Unwrap container' }).click()

  // THE PROOF: the column is gone and the bento is now the window content (still holding its editor).
  await expect(page.locator('[data-container-kind="column"]')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator('[data-container-kind="bento"]').first()).toBeVisible()
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
