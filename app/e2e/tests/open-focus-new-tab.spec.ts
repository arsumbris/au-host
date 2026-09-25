// Behaviour: opening a file into a tabs group moves DOM focus INTO the newly-active tab's content — not
// left on the opener (the file-tree row).
//
// The reproduced defect: the container `report`ed the new active tab into the recency but issued no DOM
// `.focus()`, so the transient current (DOM) diverged from the recency. Consequences the user hit: ⌘W
// closed the whole group (focus was on the group/opener, not the new tab), and clicking a prior tab took
// three tries (each early click re-synced focus before the switch registered). The fix: the tabs container
// moves real DOM focus into the child on a visible-child change (`FocusChannel.focusPane`).
import { test, expect } from '../fixtures/app'

test.use({ composition: 'open-into-wrapped-tabs' })

test('opening a file into a tabs group focuses the new tab\'s content, not the opener', async ({ page, events }) => {
  const cells = page.locator('au-tab-strip-cell')
  // Boots with the single file-tree tab (its rows list the vault's sample.md by absolute path).
  await expect(cells).toHaveCount(1)
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()

  await events.clear()
  await fileRow.click()

  // A preview editor tab is added beside the file-tree tab, rendering the file.
  await expect(cells).toHaveCount(2)
  await expect(page.locator('.cm-content').first()).toContainText('Sample content', { timeout: 10_000 })

  // THE FIX: DOM focus is now INSIDE the new preview editor, not on the file-tree row that opened it. Before
  // the fix the row kept focus, so a ⌘W closed the group and clicking a prior tab needed several tries.
  await expect(page.locator('.cm-content').first()).toBeFocused({ timeout: 10_000 })

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
