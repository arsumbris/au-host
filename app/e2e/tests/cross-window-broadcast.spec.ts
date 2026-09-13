// A broadcast fired in main reaches a handler floated into another window. Float the file-tree,
// then reveal the editor's file. Assert a broadcast and remote commit without a remote claim query:
// broadcast dispatch fans out to handlers without routed claim selection.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-broadcast' })

test('a broadcast fired in window 1 fans out to a handler floated into window 2', async ({ page, electronApp, events }) => {
  // Float the LEFT region (the file-tree, the broadcast handler) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  // The floated file-tree renders (its rows list the vault) — it is a live remote handler in window 2.
  await floated.waitForSelector('au-tree-row', { timeout: 30_000 })

  // The editor STAYS in the main window (the sandwich CENTER), holding sample.md. The secondary actions are in an "Editor options" disclosure (a <details>), so open it to reach `reveal`; the
  // button is enabled once the file has loaded.
  await page.locator('summary[aria-label="Editor options"]').first().click()
  const reveal = page.getByRole('button', { name: 'reveal' })
  await expect(reveal).toBeEnabled({ timeout: 15_000 })

  // Isolate this gesture's traces, then click `reveal` → a broadcast ui-intent-highlight for sample.md.
  await events.clear()
  await reveal.click()

  // DECISION SPINE (on the AUTHORITY substrate, the main window):
  // 1. the broadcast fanned out (delivered to at least one capable handler).
  const bcast = await events.waitFor((e) => e.name === 'broadcast' && e.fields?.type === 'ui-intent-highlight', { filter: { category: 'intent' }, timeout: 15_000 })
  expect((bcast.fields?.delivered as number) ?? 0, 'the broadcast reached at least one handler').toBeGreaterThan(0)
  // 2. the floated file-tree in window 2 got the aimed commit over the wire.
  const committed = await events.waitFor((e) => e.name === 'commit-remote' && e.fields?.type === 'ui-intent-highlight', { filter: { category: 'intent' }, timeout: 15_000 })
  expect(committed.fields?.record, 'the commit names the floated surface record it crossed to').toBeTruthy()

  // 3. THE DISCRIMINATOR — broadcast issues NO claim query (it fans out, it never gathers): no
  // `claim-remote` fired for this intent (that trace belongs to the routed/wired gather).
  const intentTraces = await events.read({ category: 'intent' })
  const claimQueries = intentTraces.filter((e) => e.name === 'claim-remote' && e.fields?.type === 'ui-intent-highlight')
  expect(claimQueries, `broadcast issues no claim query: ${JSON.stringify(claimQueries.map((e) => e.name))}`).toHaveLength(0)

  // No standing ERROR was raised by the cross-window broadcast.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
