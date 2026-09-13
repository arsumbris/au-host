// Behaviour (gather-then-commit): a fired intent ROUTES ACROSS THE WINDOW BOUNDARY
// to a remote candidate. Float the tabs group (the open-CLAIMER) into its own OS window, then click a file
// in the file-tree that STAYS in the main window. The open-intent fires in window 1, and its only capable
// handler is now the tabs in window 2 — so the authority GATHERS the remote candidate's claim over the wire
// (a `claim` query), and, it being the winner, sends the aimed `commit`.
//
// The assertion spine is the authority's (main window) event substrate: open-intent FIRED (window 1's
// file-tree), a `claim-remote` trace (the claim query crossed to the surface), the open CLAIMED (the remote
// tabs took it), and a `commit-remote` trace (the aimed commit crossed to the winner). Then the floated
// window renders the file — the end-to-end cross-process proof, with exactly one actor (no double-open).
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-route' })

test('an open-intent fired in window 1 routes to the tabs floated into window 2', async ({ page, electronApp, events }) => {
  // Float the LEFT region (the tabs group, the open-claimer) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  // The tabs renders on the surface (its editor tab shows other.md — a DIFFERENT file from the one we open,
  // so the cross-window open lands a distinct NEW preview tab).
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Other content', { timeout: 15_000 })

  // The file-tree STAYS in the main window (the sandwich CENTER); it lists the vault's sample.md.
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()

  // Isolate this gesture's traces, then click the file in window 1 → an open-intent whose only handler is
  // the floated tabs in window 2.
  await events.clear()
  await fileRow.click()

  // DECISION SPINE (on the AUTHORITY substrate, the main window):
  // 1. the open-intent fired (window 1's file-tree).
  await events.waitFor((e) => e.name === 'fire' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  // 2. the authority's GATHER crossed the window boundary — a `claim` query to the remote candidate.
  const remote = await events.waitFor((e) => e.name === 'claim-remote' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  expect(remote.fields?.record, 'the claim query names the surface record it asked').toBeTruthy()
  // 3. a candidate CLAIMED it (the remote tabs took the open).
  await events.waitFor((e) => e.name === 'claim' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })

  // The CLAIM names the floated tabs as the taker (owner `tabs::tabs`, in window 2) — the intent was
  // resolved across the boundary, not silently dropped.
  const claim = await events.waitFor((e) => e.name === 'claim' && e.fields?.type === 'open-intent', { filter: { category: 'intent' } })
  expect(claim.fields?.ownerLabel, 'the open was claimed by the floated tabs in window 2').toContain('tabs')

  // 4. the authority AIMED the commit at the winner — exactly one actor crosses back (no double-open).
  const committed = await events.waitFor((e) => e.name === 'commit-remote' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  expect(committed.fields?.record, 'the aimed commit names the winning surface record').toBeTruthy()

  // No standing ERROR was raised by the cross-window open (declaration-gap warnings are not errors).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)

  // THE VISIBLE LANDING (the bounded new-content mint OVER THE WIRE + the proxied viewer-defaults). Routing
  // is proven above; now the floated tabs MINTS a fresh preview child on the surface (`createChild` →
  // `createRecord` → a `mint` event UP → the authority pools it additively), and — with the composition's
  // viewer-defaults proxied to the surface — resolves the editor viewer WITHOUT falling to the chooser, so a
  // NEW preview tab renders sample.md in window 2. The tab bar gains a SECOND cell and the active editor shows
  // the opened file: the end-to-end cross-process open, painted.
  await expect(floated.locator('au-tab-strip-cell')).toHaveCount(2, { timeout: 15_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
})
