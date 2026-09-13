// Behaviour: DOM focus is the host's SINGLE focus source. A per-window `focusin` tracker feeds the focus
// recency from ACTUAL focus (the container no longer self-reports), so clicking a pane reports THAT pane's
// `^:` as the active node. Two editor panes (edA / edB): each click produces a `focus`/`active` trace with
// its own `^:`, and focus follows the click from one to the other. This is the reliably-fed recency that
// drives the active-pane ring and the intent routing-MRU.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'focus-route' })

test('clicking a pane feeds the host focus recency with that pane\'s ^: (DOM focus is the single source)', async ({ page, events }) => {
  // Both editors painted.
  await page.locator('[data-pane-id="edA"] .cm-content').first().waitFor({ timeout: 30_000 })
  await page.locator('[data-pane-id="edB"] .cm-content').first().waitFor({ timeout: 30_000 })

  // Establish a known focus (A). Then each subsequent click is a GUARANTEED change, so the tracker MUST
  // emit — independent of whatever held focus on cold load.
  await page.locator('[data-pane-id="edA"] .cm-content').first().click()

  // Click into editor B → the tracker reports edB as the active node.
  await events.clear()
  await page.locator('[data-pane-id="edB"] .cm-content').first().click()
  await events.waitFor((e) => e.category === 'focus' && e.name === 'active' && e.fields?.node === 'edB')

  // Click back into editor A → focus FOLLOWS the click to edA (not a stale first report).
  await events.clear()
  await page.locator('[data-pane-id="edA"] .cm-content').first().click()
  await events.waitFor((e) => e.category === 'focus' && e.name === 'active' && e.fields?.node === 'edA')

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})

// Behaviour: a container renders its OWN active-pane ring from the host signal (the host owns the truth, not
// the chrome). The centre card (`au-pane-frame`, sandwich's centre = editor edA) reflects `[focused]` when
// its occupant is the active pane, and CLEARS it when focus leaves to the file-tree (a side rail, no card).
test('the active pane\'s card shows the ring from the host signal and clears when focus leaves', async ({ page }) => {
  await page.locator('[data-pane-id="edA"] .cm-content').first().waitFor({ timeout: 30_000 })
  await page.locator('au-tree-row').first().waitFor({ timeout: 30_000 })
  // The centre card = the au-pane-frame wrapping edA.
  const centreCard = page.locator('au-pane-frame').filter({ has: page.locator('[data-pane-id="edA"]') })

  // Focus editor A (the centre) → its card rings.
  await page.locator('[data-pane-id="edA"] .cm-content').first().click()
  await expect(centreCard).toHaveAttribute('focused', '')

  // Click a file-tree row (the left rail, no card) → the active pane is now the tree, so the centre clears.
  await page.locator('au-tree-row').first().click()
  await expect(centreCard).not.toHaveAttribute('focused', '')
})
