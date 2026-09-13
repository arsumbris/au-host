// An occupant-addressed operation resolves to the ruled slot's position before extraction.
// The column contains position `ruledslot` with editor occupant `ed`. Floating `ed` must resolve to
// `column.extractEdit('ruledslot')`; the transform locates the entry through `idxIn` and removes it.
// Assert that the floated window opens. Comparing only occupant IDs would miss this position;
// a bare entry cannot exercise the distinction because its position and occupant IDs are equal.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'ruled-column' }) // window → column → [ ruled slot 'ruledslot' → editor 'ed' ]

test('float an occupant out of a RULED column slot (position id != occupant id) via the ⋯ menu', async ({ page, electronApp, events }) => {
  await page.waitForSelector('.cm-content', { timeout: 30_000 })
  await expect(page.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })

  // The column ITEM's ⋯ (not the window "Root actions") floats the occupant, addressing it by its `^:` id.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [win] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])

  // THE PROOF: a new window opened AND holds the editor — the ruled slot resolved occupant→position, so the
  // extract found the item. Pre-switch the extract returns null and no window ever opens.
  await win.waitForSelector('.cm-content', { timeout: 30_000 })
  await expect(win.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(2) // main + floated

  // No standing error (a resolve-miss / reap would surface as an error condition).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
