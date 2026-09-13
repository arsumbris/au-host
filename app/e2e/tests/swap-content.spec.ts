// Behaviour: the per-tab Swap replaces the tab's CONTENT (its viewer) in place — it never wraps or
// replaces the enclosing tabs container.
//
// Swap routes through `setPaneContent`, which keeps the occupant's `^:` id and only changes its
// projection type (carrying the document). So after a swap the tabs container and the tab's pane id are
// both unchanged; only the rendered viewer differs. This also exercises the tabs `⋯` menu's Swap row.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'swap-content' })

const tabs = (page: import('@playwright/test').Page) => page.locator('[data-pane-id="tabs"]')
const occupant = (page: import('@playwright/test').Page) => page.locator('[data-pane-id="ed"]')

test('swapping a tab replaces its viewer in place, container and pane id unchanged', async ({ page, events }) => {
  // Start: tabs → [editor#ed]. The tabs container and the editor occupant are present; the editor renders.
  await expect(tabs(page).first()).toBeVisible()
  await expect(occupant(page).first()).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveCount(1)
  await expect(page.locator('[role="tree"]')).toHaveCount(0)

  // ⋯ → Swap → pick the file-tree viewer (deterministic by its type-id title).
  await page.getByRole('button', { name: 'Tab actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Swap pane' }).click()
  await page.locator('button[title="file-tree"]').first().click()

  // REPLACED IN PLACE: the tabs container and the `ed` pane id are UNCHANGED (no wrap, no re-mint), but the
  // viewer changed — the editor is gone and a file tree renders.
  await expect(tabs(page).first()).toBeVisible()
  await expect(occupant(page).first()).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await expect(page.locator('[role="tree"]').first()).toBeVisible()

  // No error condition was raised by the swap.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
