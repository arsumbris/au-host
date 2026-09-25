// The composition switcher can open a composition's backing FILE in a pane (to hand-edit the YAML), distinct
// from loading it as the root. The per-row "Open as file" affordance fires a REGULAR open-intent at the
// composition's path — the host resolves the viewer, no editor is hardcoded. Main-window behaviour (the
// composition menu is main-only).
import { test, expect } from '../fixtures/app'

test.use({ composition: 'float-reorder' })

test('the switcher opens a composition as a file via a regular open-intent (P6-A)', async ({ page, events }) => {
  // Open the Compositions popover.
  await page.getByRole('button', { name: /^Compositions/ }).click()
  await page.locator('.composition-popover').waitFor({ state: 'visible', timeout: 10_000 })
  const firstRow = page.locator('.composition-popover__row').first()
  await firstRow.waitFor({ state: 'visible', timeout: 10_000 })
  await events.clear()

  // Click the row's "Open as file" trailing button (not the row body, which would LOAD it as root).
  await firstRow.getByRole('button', { name: /Open .* as a file/ }).click()

  // A regular open-intent fired, targeting the composition's file (viewer-agnostic — the host resolves it).
  const fired = await events.waitFor(
    (e) => e.category === 'intent' && e.name === 'fire' && (e.fields as { type?: string } | undefined)?.type === 'open-intent',
    { timeout: 10_000 },
  )
  expect(fired, 'an open-intent fired for the composition file').toBeTruthy()

  // No standing error from the open.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
