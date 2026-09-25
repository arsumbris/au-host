// The composition switcher can create a fresh EMPTY composition — a primary window whose content is the
// default placeholder projection (the sole installed `placeholder-projection`, resolved by kind-closure, so
// nothing is hardcoded). It renders the empty-slot picker at the root; opening a file fills it in place
// (the placeholder handles open-intent). Main-window behaviour.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'bare-editor' })

test('the switcher creates a fresh empty composition showing the placeholder at the root (P6-B)', async ({ page, events }) => {
  // Start from a concrete composition (bare-editor mounts a single editor — no picker anywhere).
  await page.waitForSelector('.cm-content', { timeout: 30_000 })
  await expect(page.locator('[data-pane-picker]')).toHaveCount(0)

  // Open the Compositions popover and click "New".
  await page.getByRole('button', { name: /^Compositions/ }).click()
  await page.locator('.composition-popover').waitFor({ state: 'visible', timeout: 10_000 })
  await events.clear()
  await page.getByRole('button', { name: 'New', exact: true }).click()

  // The fresh empty composition mounts with the placeholder projection (the shared PanePicker) at the root.
  await expect(page.locator('[data-pane-picker]')).toBeVisible({ timeout: 15_000 })

  // No standing error from the fresh mount.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
