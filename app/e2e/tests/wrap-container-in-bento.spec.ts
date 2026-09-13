// Behaviour: wrapping a CONTAINER (a tabs group holding a child) inside a bento preserves the container
// and its subtree — bento → tabs → editor. Regression guard for a bug where the tabs group and its editor
// vanished into an empty bento: bento's single-child wrap minted a degenerate one-child bento-node.branch
// (a spatial split with one child renders empty), instead of a bare-leaf root.
//
// Start: sandwich → center: editor. Wrap the editor in tabs (sandwich center → tabs → editor). Then wrap
// that tabs group in bento. The editor must still render and a tabs must still exist.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'sandwich-editor' })

test('wrapping a tabs group in bento preserves the tabs and its editor', async ({ page }) => {
  // Step 1 — wrap the center editor in tabs.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: 'tabs', exact: true }).click()
  await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible()
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')

  // Step 2 — wrap that tabs group in bento. The tabs + its editor must survive.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: 'bento', exact: true }).click()
  await expect(page.locator('[data-container-kind="bento"]').first()).toBeVisible()
  await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible() // tabs must NOT vanish
  await expect(page.locator('.cm-content').first()).toContainText('Sample content') // editor must survive
})
