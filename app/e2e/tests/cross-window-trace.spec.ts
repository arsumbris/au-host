// Behaviour: a surface's OWN event-substrate traces are RELAYED to the authority's
// one ring, WINDOW-ATTRIBUTED. Float the tabs into window 2, then open a file cross-window — the floated tabs
// resolves the editor viewer ON THE SURFACE (viewer-defaults are proxied), emitting a `viewer/resolved` trace
// in window 2's own substrate. The surface forwards that trace up; the authority re-records it with a `surface`
// field. A `viewer/resolved` is emitted only by a container resolving a viewer, and an authority-local resolve
// carries no `surface` attribution — so a `viewer/resolved` WITH a `surface` field can only have crossed from
// window 2. That is the assertion: the authority's `trace-inspector` spans windows.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-route' })

test('a surface-local trace is relayed to the authority substrate, window-attributed', async ({ page, electronApp, events }) => {
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Other content', { timeout: 15_000 })

  await events.clear()

  // Open a file cross-window → the floated tabs (window 2) resolves the editor viewer on the surface.
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()
  await fileRow.click()

  // The surface-local `viewer/resolved` trace reached the AUTHORITY ring, attributed to its source window.
  const relayed = await events.waitFor(
    (e) => e.category === 'viewer' && e.name === 'resolved' && typeof e.fields?.surface === 'string',
    { filter: { category: 'viewer' }, timeout: 15_000 },
  )
  expect(relayed.fields?.surface, 'the relayed trace carries a surface attribution').toBeTruthy()
})
