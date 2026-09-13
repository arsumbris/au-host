// A newly created empty tab can close through its pane-actions control.
// Assert that the empty tab disappears while the existing populated tab remains.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'close-empty-tab' })

test('an empty tab added via "+" can be closed', async ({ page }) => {
  const cells = page.locator('au-tab-strip-cell')
  // The tabs render with its single real tab + the "New tab" (+) control.
  await expect(page.getByRole('button', { name: 'New tab' })).toBeVisible()
  await expect(cells).toHaveCount(1)

  // Add an empty tab (no child → the placeholder picker), which becomes active.
  await page.getByRole('button', { name: 'New tab' }).click()
  await expect(cells).toHaveCount(2)

  // Close the empty (last, active) tab. Its close affordance fades in on hover/active.
  const emptyTab = cells.last()
  await emptyTab.hover()
  await emptyTab.locator('au-close-button').click()

  // The empty tab is gone → back to one. (With the bug present this stays 2.)
  await expect(cells).toHaveCount(1)
})
