// Behaviour: the window draws the root content's pane header (the ONLY top chrome — no app bar), so the
// root content can always be wrapped via the header's "Root actions" ⋯ — whether it is a bare projection
// or a container. Covers the regression: wrap a bare editor into tabs, then wrap that whole tabs
// GROUP into a bento, all through the root header (the wrap targets the ROOT placement, not the
// container's own).
import { test, expect } from '../fixtures/app'

test.use({ composition: 'bare-editor' })

const rootMenu = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Root actions' })

test('the window root header wraps a bare root, then the resulting container', async ({ page }) => {
  // Start: bare editor root. No container; the window root header is the top chrome; the editor renders.
  await expect(page.locator('[data-container-kind]')).toHaveCount(0)
  await expect(page.locator('.window-root-header').first()).toBeVisible()
  await expect(page.locator('.cm-content').first()).toBeVisible()

  // Root ⋯ → Wrap → tabs: the bare editor is wrapped in a tabs container; the header persists.
  await rootMenu(page).click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: 'tabs', exact: true }).click()
  await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible()
  await expect(page.locator('.cm-content').first()).toBeVisible()
  await expect(page.locator('.window-root-header').first()).toBeVisible()

  // Root ⋯ → Wrap → bento: the WHOLE tabs group is wrapped in a bento (the original bug — the tabs must
  // survive, not vanish). Both the tabs and the editor must remain.
  await rootMenu(page).click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: 'bento', exact: true }).click()
  await expect(page.locator('[data-container-kind="bento"]').first()).toBeVisible()
  await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible()
  await expect(page.locator('.cm-content').first()).toBeVisible()
})
