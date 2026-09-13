// A floated container creates a group through its granted ID range and a proposed structural edit.
// Wrap one tab through its pane-actions menu: `stageGroup` creates the embedded group, then the authority
// normalizes and applies it. The button gesture isolates minting from drag behavior.
// Assert `placement / surface-propose` on the main authority and no standing error.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-reorder' })

test('a floated tabs group wraps a tab over the wire — the surface mints via the granted id-range (M2)', async ({ page, electronApp, events }) => {
  // Float the LEFT region (the tabs group) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })

  // Open the ACTIVE tab's "⋯" (Tab actions) and wrap it in a container — `wrapPaneSolo` → `stageGroup`.
  await floated.getByRole('button', { name: 'Tab actions' }).first().click()
  await floated.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  // The type graph declares several grouping/spatial containers (now registered on the surface too), so the
  // wrap asks the family-sectioned chooser: pick the first (grouping/"Stack") <au-menu-item> option.
  const chooserOption = floated.locator('.au-chooser-card au-menu-item')
  await chooserOption.first().waitFor({ state: 'visible', timeout: 10_000 })
  await chooserOption.first().click()

  // Assert that minting and wrapping crossed to the authority as a proposed edit using a granted ID.
  await events.waitFor((e) => e.category === 'placement' && e.name === 'surface-propose', { timeout: 15_000 })
  // The authority normalized the embedded group edit and applied it cleanly (no standing error).
  const conds = await events.conditions()
  expect(conds.find((c) => c.severity === 'error')).toBeUndefined()
})
