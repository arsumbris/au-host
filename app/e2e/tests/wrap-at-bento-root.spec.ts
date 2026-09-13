// Behaviour: wrapping the occupant of a single-leaf bento (whose root is a bare-leaf editor) in a tabs
// group nests it — bento → tabs → editor. Regression guard for a no-op bug where bento's getSlotContent
// and wrapEdit keyed only by the leaf POSITION id while the wrap seam addresses the pane by its OCCUPANT
// id (the two differ at a bare-leaf root), so the wrap silently did nothing.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'bento-editor' })

test('wrapping the occupant at a bento root nests it in a tabs group', async ({ page }) => {
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: 'tabs', exact: true }).click()
  await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible()
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')
})
