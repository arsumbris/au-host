// An unsaved layout survives a reload, whether the composition has no file yet or was just saved.
// 1. A NEW composition, edited, is recorded as the open one; a reload restores it from its draft, still dirty.
// 2. After Save as, the new file IS the open composition: a reload reopens it, and an edit made after the
//    save restores silently against that file (no "saved file changed" prompt).
// Main-window behaviour.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'bare-editor' })

const compositionsButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Compositions/ })

test('an edited new composition comes back after a reload', async ({ page }) => {
  await page.waitForSelector('.cm-content', { timeout: 30_000 })
  await compositionsButton(page).click()
  await page.locator('.composition-popover').waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByRole('button', { name: 'New', exact: true }).click()

  // The edit: fill the root's picker with the hello projection.
  const picker = page.locator('[data-pane-picker]')
  await expect(picker).toBeVisible({ timeout: 15_000 })
  // A pristine New is clean: nothing to save yet.
  await page.waitForTimeout(1000)
  await expect(compositionsButton(page)).toHaveAccessibleName('Compositions')
  await picker.getByRole('combobox').fill('hello')
  await picker.getByRole('option', { name: /hello/i }).first().click()
  const hello = page.getByText(/hello from a mounted projection/)
  await expect(hello).toBeVisible({ timeout: 15_000 })
  await expect(compositionsButton(page)).toHaveAccessibleName(/unsaved changes/)
  await page.waitForTimeout(1000) // the renderer debounces the draft to main (400ms)

  await page.reload()
  await expect(hello).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await expect(compositionsButton(page)).toHaveAccessibleName(/unsaved changes/)
})

test('Save as keeps an unsaved edit on screen and reads clean', async ({ page }) => {
  await page.waitForSelector('.cm-content', { timeout: 30_000 })
  await compositionsButton(page).click()
  const popover = page.locator('.composition-popover')
  await popover.waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const picker = page.locator('[data-pane-picker]')
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await picker.getByRole('combobox').fill('hello')
  await picker.getByRole('option', { name: /hello/i }).first().click()
  const hello = page.getByText(/hello from a mounted projection/)
  await expect(hello).toBeVisible({ timeout: 15_000 })
  await expect(compositionsButton(page)).toHaveAccessibleName(/unsaved changes/)

  await compositionsButton(page).click()
  await popover.waitFor({ state: 'visible', timeout: 10_000 })
  await popover.getByPlaceholder('save as…').fill('saved-new')
  await popover.getByRole('button', { name: 'Save as', exact: true }).click()
  await expect(compositionsButton(page)).toHaveAccessibleName(/— saved-new$/, { timeout: 15_000 })
  await page.keyboard.press('Escape')

  // The save changed the composition's path, not what is mounted: the edit is still on screen.
  await page.waitForTimeout(1000)
  await expect(hello).toBeVisible()
  await expect(picker).toHaveCount(0)
  await expect(compositionsButton(page)).toHaveAccessibleName(/— saved-new$/)
})

test('New confirms before replacing an edited unsaved layout', async ({ page }) => {
  await page.waitForSelector('.cm-content', { timeout: 30_000 })
  const popover = page.locator('.composition-popover')
  const newButton = async (): Promise<void> => {
    await compositionsButton(page).click()
    await popover.waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: 'New', exact: true }).click()
  }
  await newButton() // from a saved composition: nothing unsaved to lose, no confirm
  const picker = page.locator('[data-pane-picker]')
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.au-confirm-card')).toHaveCount(0)
  await picker.getByRole('combobox').fill('hello')
  await picker.getByRole('option', { name: /hello/i }).first().click()
  const hello = page.getByText(/hello from a mounted projection/)
  await expect(hello).toBeVisible({ timeout: 15_000 })

  const card = page.locator('.au-confirm-card')
  await newButton()
  await expect(card).toContainText('Discard the unsaved layout')
  await card.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(hello).toBeVisible()

  await newButton()
  await card.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await expect(hello).toHaveCount(0)
})

test.describe('a saved copy', () => {
  test.use({ composition: 'bento-editor' })

  test('after Save as, a reload reopens the saved copy with the edit made since, without a stale-file prompt', async ({ page }) => {
    await page.waitForSelector('[data-pane-id]', { timeout: 30_000 })
    await compositionsButton(page).click()
    const popover = page.locator('.composition-popover')
    await popover.waitFor({ state: 'visible', timeout: 10_000 })
    await popover.getByPlaceholder('save as…').fill('saved-copy')
    await popover.getByRole('button', { name: 'Save as', exact: true }).click()
    await expect(compositionsButton(page)).toHaveAccessibleName(/— saved-copy$/, { timeout: 15_000 })
    await page.keyboard.press('Escape')

    // An edit after the save: wrap the editor in tabs.
    await page.getByRole('button', { name: 'Pane actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
    await page.getByRole('menuitem', { name: /^Tabs( [a-z])?$/ }).click()
    await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible()
    await expect(compositionsButton(page)).toHaveAccessibleName(/— saved-copy \(unsaved changes\)$/)
    await page.waitForTimeout(1000) // the renderer debounces the draft to main (400ms)

    await page.reload()
    await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible({ timeout: 60_000 })
    await expect(compositionsButton(page)).toHaveAccessibleName(/— saved-copy \(unsaved changes\)$/)
    await expect(page.getByText('Unsaved layout — saved file changed')).toHaveCount(0)
  })
})
