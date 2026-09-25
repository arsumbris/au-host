// Discard reverts the screen to the saved file. An edit flows through the pool and never changes the mounted
// composition's identity, so applying the saved file must mount a fresh copy or the edited layout stays on
// screen while reading clean. Main-window behaviour.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'bento-editor' })

test('Discard puts the saved layout back on screen and reads clean', async ({ page }) => {
  await page.waitForSelector('[data-pane-id]', { timeout: 30_000 })
  const compositions = page.getByRole('button', { name: /^Compositions/ })
  const tabs = page.locator('[data-container-kind="tabs"]')
  await expect(tabs).toHaveCount(0)

  // An unsaved edit: wrap the editor in tabs.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: /^Tabs( [a-z])?$/ }).click()
  await expect(tabs.first()).toBeVisible()
  await expect(compositions).toHaveAccessibleName(/\(unsaved changes\)$/)

  await compositions.click()
  const popover = page.locator('.composition-popover')
  await popover.waitFor({ state: 'visible', timeout: 10_000 })
  await popover.getByRole('button', { name: 'Discard', exact: true }).click()
  await page.locator('.au-confirm-card').getByRole('button', { name: 'Discard', exact: true }).click()

  await expect(tabs).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('.cm-content').first()).toBeVisible()
  await expect(compositions).not.toHaveAccessibleName(/unsaved changes/)
})
