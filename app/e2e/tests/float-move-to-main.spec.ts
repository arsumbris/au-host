// Regression (data-loss): a move-to-window onto an OCCUPIED main-window slot must WRAP the moved
// subtree with the occupant — never lose it. A FRESH editor opened in a new
// window via the open-floor (`openInWindow`, so it has NO clean-inverse origin — the dock clean-inverse is
// skipped and the move falls through to `placeIntoMainLeaf`'s wrap), then "move to other window" → Main →
// the OCCUPIED center. Pre-fix the wrap edit was TRUNCATED to its first record (the group), dropping the
// slot re-point, so the group (holding the editor) was orphaned and reaped — the editor vanished.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-move-to-main' }) // sandwich → left + center file-trees (neither a viewer)

test('a floated editor moved onto an occupied main slot is WRAPPED, not lost', async ({ page, electronApp, events }) => {
  await page.locator('au-tree-row').first().waitFor({ timeout: 30_000 })

  // Open a file in its OWN window via the open-floor (nothing in the sandwich can open it in place).
  await page.locator('au-tree-row[data-path$="/sample.md"]').first().click()
  const option = page.locator('.au-chooser-card').getByRole('menuitem', { name: 'Open in a new window' })
  await option.waitFor({ state: 'visible', timeout: 10_000 })
  const [win] = await Promise.all([
    floatedWindow(electronApp),
    option.click(),
  ])
  await win.locator('.cm-content').first().waitFor({ timeout: 30_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(2)

  // From the FLOATED editor window: "Move to other window". Main is the sole other window → auto-picks main
  // and goes to the spatial pane pick. The editor has NO origin, so this is the wrap fallback, not a dock inverse.
  await win.getByRole('button', { name: 'Root actions' }).click()
  await win.getByRole('menuitem', { name: 'Move to other window' }).click()

  // Spatial pick in MAIN over the receivable panes. Pick the LEFTMOST = an OCCUPIED file-tree (the sandwich's
  // empty `right` region is the rightmost candidate — picking that would INJECT, not exercise the wrap). Its
  // occupied non-grouping slot must WRAP editor + file-tree into a grouping container — the data-loss path.
  const targets = page.locator('au-pane-target')
  await targets.first().waitFor({ timeout: 10_000 })
  const n = await targets.count()
  let leftmost = 0
  let minX = Infinity
  for (let i = 0; i < n; i++) {
    const box = await targets.nth(i).boundingBox()
    if (box && box.x < minX) { minX = box.x; leftmost = i }
  }
  await targets.nth(leftmost).click()

  // The OCCUPIED target now asks WHICH container to wrap into (in main). Pick one.
  const wrapCard = page.locator('.au-chooser-card')
  await wrapCard.waitFor({ timeout: 10_000 })
  await wrapCard.getByRole('menuitem').first().click()

  // move-to-main-sole routes through the DOCK path (dock is the move-to-main special case).
  const mv = await events.waitFor((e) => (e.category === 'dock' || e.category === 'move') && (e.name === 'applied' || e.name === 'abandoned'), { timeout: 15_000 })
  const trace = (await events.read()).filter((e) => e.category === 'move' || e.category === 'dock')
  expect(mv.name, `outcome — trace: ${JSON.stringify(trace.map((e) => ({ c: e.category, n: e.name, ...(e.fields ?? {}) })), null, 2)}`).toBe('applied')

  // THE PROOF: the editor SURVIVES in main, WRAPPED with the file-tree (a grouping container); nothing reaped.
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('au-tree-row').first()).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(1)
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
