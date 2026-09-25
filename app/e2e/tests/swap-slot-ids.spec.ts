// Swap pane opens its picker in every container, from the ⋯ menu and from the command palette, including
// when the pane's POSITION carries its own id. The menu, the keyboard intent and the render all key the swap
// by the OCCUPANT's id; a container that keyed any of them by the position id opened nothing.
// - bento: a leaf's position id always differs from its occupant.
// - tabs / column: a ruled position (`^: tabslot`, `^: ruledslot`) differs from its occupant `ed`.
import { test, expect, type Page } from '../fixtures/app'

const CASES = [
  { composition: 'bento-editor', menu: 'Pane actions', row: 'Swap pane' },
  { composition: 'swap-tabs-slot', menu: 'Tab actions', row: 'Swap pane' },
  { composition: 'ruled-column', menu: 'Pane actions', row: "Swap this item's content" },
]

async function pickFileTreeAndAssertSwapped(page: Page): Promise<void> {
  await expect(page.getByText('Swap this pane')).toBeVisible()
  await page.locator('button[title="file-tree"]').first().click()
  await expect(page.locator('[data-pane-id="ed"]').first()).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await expect(page.locator('[role="tree"]').first()).toBeVisible()
}

for (const c of CASES) {
  test.describe(c.composition, () => {
    test.use({ composition: c.composition })

    test('the ⋯ menu Swap opens the picker and swaps in place', async ({ page }) => {
      await expect(page.locator('.cm-content')).toHaveCount(1, { timeout: 30_000 })
      await page.getByRole('button', { name: c.menu }).first().click()
      await page.getByRole('menuitem', { name: c.row }).click()
      await pickFileTreeAndAssertSwapped(page)
    })

    test('the Swap pane command opens the focused pane picker and swaps in place', async ({ page }) => {
      await expect(page.locator('.cm-content')).toHaveCount(1, { timeout: 30_000 })
      await page.locator('.cm-content').click()
      await page.locator('.cmd-palette-trigger').click()
      await expect(page.locator('.cmd-palette-overlay')).toBeVisible()
      await page.getByText('Swap pane', { exact: true }).click()
      await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0)
      await pickFileTreeAndAssertSwapped(page)
    })
  })
}

test.describe('a fixed position', () => {
  test.use({ composition: 'swap-fixed-slot' })

  test('the Swap pane command declines a fixed position, as the ⋯ menu hides its row', async ({ page }) => {
    await expect(page.locator('.cm-content')).toHaveCount(1, { timeout: 30_000 })
    await page.locator('.cm-content').click()
    await page.locator('.cmd-palette-trigger').click()
    await expect(page.locator('.cmd-palette-overlay')).toBeVisible()
    await page.getByText('Swap pane', { exact: true }).click()
    await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0)
    await page.waitForTimeout(1000) // the routed dispatch settles; a claim would have opened the picker by now
    await expect(page.getByText('Swap this pane')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toHaveCount(1)
  })
})
