// Behaviour: wrapping a pane in a container then unwrapping is an identity-preserving round-trip.
//
// The pane's stable `^:` id (its data-pane-id) must survive both ops — wrap/unwrap RE-POINT the pool
// record, they never re-create the pane. This also exercises the tabs `⋯` per-tab action menu (the
// affordance that opens the host context-menu) end to end: ⋯ → Wrap → chooser, then the wrapped
// container's own Unwrap. The composition authors the editor's id as `ed`, so a re-mint (a broken,
// non-identity-preserving wrap) would surface as a different data-pane-id.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'wrap-unwrap' })

const editor = (page: import('@playwright/test').Page) => page.locator('[data-pane-id="ed"]')
const column = (page: import('@playwright/test').Page) => page.locator('[data-container-kind="column"]')

test('wrap a tab in a column then unwrap it, editor identity preserved', async ({ page, events }) => {
  // Start: tabs → [editor#ed]. The editor is present, nothing wraps it yet.
  await expect(editor(page).first()).toBeVisible()
  await expect(column(page)).toHaveCount(0)

  // ⋯ → Wrap → pick `column` in the host chooser.
  await page.getByRole('button', { name: 'Tab actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: 'column', exact: true }).click()

  // WRAPPED: a column now holds the editor, and the editor kept its `ed` id (re-pointed, not re-created).
  await expect(column(page).first()).toBeVisible()
  await expect(editor(page).first()).toBeVisible()

  // The column holds one child → its ⋯ menu (labelled "Pane actions", distinct from the tab's "Tab
  // actions") offers Unwrap. Open it and dissolve the column, lifting the editor back to the tab slot.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Unwrap container' }).click()

  // ROUND-TRIP COMPLETE: the column is gone and the editor is back with the SAME `ed` id, still rendering
  // its file (state carried through, not a blank re-mount).
  await expect(column(page)).toHaveCount(0)
  await expect(editor(page).first()).toBeVisible()
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')

  // No error condition was raised by the round-trip.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
