// Behaviour: move a subtree from popped-out window A to popped-out
// window B, with the MAIN window NEVER involved. Float the file-tree into window A and the editor into
// window B, then from A's root ⋯ "Move to other window" → pick B in A's OWN picker (the picker renders in
// the invoking window). A empties and closes; B holds both (a group), main is untouched.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-dock' }) // sandwich → left: file-tree, center: editor (two floatable leaves)

test('move a subtree between two popped-out windows, main untouched', async ({ page, electronApp, events }) => {
  // Float the LEFT region (file-tree) into window A.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [winA] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await winA.getByRole('button', { name: 'Root actions' }).waitFor({ timeout: 30_000 })
  await winA.locator('au-tree-row').first().waitFor({ timeout: 15_000 })

  // Float the (now sole) region left in the main sandwich — the editor — into window B.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [winB] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await winB.waitForSelector('.cm-content', { timeout: 30_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(3) // main + A + B

  // From WINDOW A's root ⋯ → "Move to other window". Two other windows now exist (main + B), so A's OWN
  // chooser LISTS them (the picker renders in the invoking window). Pick the NON-main option = window B.
  await winA.getByRole('button', { name: 'Root actions' }).click()
  await winA.getByRole('menuitem', { name: 'Move to other window' }).click()
  // The picker card renders in window A itself.
  await winA.locator('.au-chooser-card').waitFor({ timeout: 10_000 })
  await winA.getByRole('menuitem').filter({ hasNotText: 'Main window' }).first().click()
  // TWIN-PICK: the move into an OCCUPIED window (B) then asks WHICH container to wrap into —
  // and that chooser ALSO renders in the INVOKING window A (not the authority/main). Pick a container there.
  await winA.getByRole('menuitem', { name: 'column' }).click()

  // The move applied at the authority (secondary → secondary), main never touched.
  await events.waitFor((e) => e.category === 'move' && e.name === 'applied', { timeout: 15_000 })
  // Window A closed (emptied by the move); only main + B remain.
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(2)

  // Window B now holds BOTH panes (the editor it had + the moved file-tree, wrapped into a group).
  await expect(winB.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
  await expect(winB.locator('au-tree-row').first()).toBeVisible({ timeout: 15_000 })

  // No standing error on the authority (a reap / orphan surfaces as a condition, not a throw).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})

test('move a NESTED pane from the main window into a floated window (the sourceEdit branch)', async ({ page, electronApp, events }) => {
  // Float the LEFT region (file-tree) into window B, so a secondary target exists.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [winB] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await winB.locator('au-tree-row').first().waitFor({ timeout: 30_000 })

  // From the CENTER editor's NESTED ⋯ (still in the main sandwich) → "Move to other window". The sole other
  // window is B, so it auto-picks. The extract runs in the MAIN window (the `sourceEdit` branch), and the
  // editor lands in B alongside the file-tree.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Move to other window' }).click()

  // The move now ASKS which container to wrap the target's occupant with. This move is
  // AUTHORITY-invoked (fired from the main window), so the chooser renders here in the main window. Pick one.
  await page.locator('.au-chooser-card').getByRole('menuitem').first().click()

  await events.waitFor((e) => e.category === 'move' && e.name === 'applied', { timeout: 15_000 })
  // B now holds BOTH the file-tree it had and the editor moved in.
  await expect(winB.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
  await expect(winB.locator('au-tree-row').first()).toBeVisible()
  // The main window lost the editor (both sandwich regions are now empty).
  await expect(page.locator('.cm-content')).toHaveCount(0, { timeout: 10_000 })

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
