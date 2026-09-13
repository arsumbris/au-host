// A strict switchboard wire delivers an open intent from main's file-tree to floated tabs.
// Assert the remote claim and commit, the rendered preview, and the absence of ambient candidate
// traces: the explicit wire determines the recipients.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-wired' })

test('a STRICT intent-wire routes an open across to the tabs floated into window 2', async ({ page, electronApp, events }) => {
  // Float the LEFT region (the wired recipient tabs) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Other content', { timeout: 15_000 })

  // The file-tree STAYS in the main window (the sandwich CENTER); it is the wire SOURCE.
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()

  // Isolate this gesture's traces, then click the file → an open-intent the STRICT wire binds to the tabs.
  await events.clear()
  await fileRow.click()

  // DECISION SPINE (on the AUTHORITY substrate, the main window):
  // 1. the open-intent fired (window 1's file-tree).
  await events.waitFor((e) => e.name === 'fire' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  // 2. the WIRE gathered the remote recipient's claim over the boundary (`deliverWired` → queryRemoteClaim).
  const remoteClaim = await events.waitFor((e) => e.name === 'claim-remote' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  expect(remoteClaim.fields?.record, 'the wired claim query names the surface record it asked').toBeTruthy()
  // 3. the widen AIMED the commit at the remote claimer — exactly one actor crosses back.
  const committed = await events.waitFor((e) => e.name === 'commit-remote' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  expect(committed.fields?.record, 'the aimed commit names the winning surface record').toBeTruthy()

  // 4. THE DISCRIMINATOR — the wire short-circuited the AMBIENT path: no `candidates` enumeration and no
  // ambient `claim` fired for this gesture (those belong to the routed MRU walk `deliverWired` bypasses).
  const intentTraces = await events.read({ category: 'intent' })
  const ambient = intentTraces.filter((e) => (e.name === 'candidates' || e.name === 'claim') && e.fields?.type === 'open-intent')
  expect(ambient, `no ambient candidates/claim traces (the wire routed it): ${JSON.stringify(ambient.map((e) => e.name))}`).toHaveLength(0)

  // No standing ERROR was raised by the cross-window wired open.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)

  // THE VISIBLE LANDING: the floated tabs mints a fresh preview tab rendering sample.md — the wired open,
  // painted across the process boundary (a SECOND tab cell, the editor showing the opened file).
  await expect(floated.locator('au-tab-strip-cell')).toHaveCount(2, { timeout: 15_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
})
