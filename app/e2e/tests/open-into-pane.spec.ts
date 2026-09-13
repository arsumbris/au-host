// When nothing can open a file in place, the open floor offers "Choose a pane…".
// Picking it runs the spatial pane pick, then fills an empty placeholder slot with the viewer
// (replacing the filler). A layout with no viewer can open a file into its empty slot.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'open-into-pane' }) // sandwich: left file-tree, center = empty placeholder slot

test('the open floor offers "Choose a pane" and FILLS an empty placeholder slot (replace, not wrap)', async ({ page, events }) => {
  await page.locator('au-tree-row').first().waitFor({ timeout: 30_000 })
  // No editor is mounted, so opening a file dead-ends onto the floor.
  await page.locator('au-tree-row[data-path$="/sample.md"]').first().click()

  const card = page.locator('.au-chooser-card')
  await card.waitFor({ timeout: 10_000 })
  // The floor offers the pane picker.
  const placeOption = card.getByRole('menuitem', { name: 'Choose a pane…', exact: true })
  await expect(placeOption).toBeVisible()
  await placeOption.click()

  // Spatial pane pick. Pick the RIGHTMOST = the empty placeholder slot; it FILLS (setPaneContent), no wrap-ask.
  const targets = page.locator('au-pane-target')
  await targets.first().waitFor({ timeout: 10_000 })
  const n = await targets.count()
  let rightmost = 0
  let maxX = -Infinity
  for (let i = 0; i < n; i++) {
    const box = await targets.nth(i).boundingBox()
    if (box && box.x > maxX) { maxX = box.x; rightmost = i }
  }
  await targets.nth(rightmost).click()

  // The rightmost target is the EMPTY placeholder center → it FILLS (replaces the filler), NO wrap-kind
  // chooser (that appears only for a REAL occupant).
  await expect(page.locator('.au-chooser-card')).toHaveCount(0, { timeout: 3_000 })

  // THE PROOF: the file opened IN PLACE, replacing the placeholder — an editor renders, no new window forced.
  await expect(page.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
