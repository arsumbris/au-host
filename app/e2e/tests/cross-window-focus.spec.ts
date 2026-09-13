// Behaviour: FOCUS-MRU SPANS WINDOWS. Two open-claimers, one per window — tabs A
// floated into window 2, tabs B in the main window. Focus B (window 1) so it is the most-recent LOCAL
// candidate; then focus A (window 2). If focus crosses the window boundary, A becomes the most-recently
// focused open-candidate tree-wide, so an open fired from the window-1 file-tree routes ACROSS to A — not to
// the locally-focused B.
//
// The airtight signal is on the AUTHORITY substrate: the open COMMITS to a REMOTE candidate (`commit-remote`).
// B is LOCAL to the main window, so if B won there would be NO `commit-remote` (a local commit, no wire). A
// `commit-remote` for open-intent therefore proves the winner is the window-2 pane A — i.e. the window-2 focus
// re-ranked A above the locally-focused B, which is only possible if focus-MRU spans windows. A `surface-focus`
// trace confirms the window-2 focus reached the authority in the first place.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-focus' })

test('focusing a pane in window 2 makes it the target for an ambient intent fired in window 1', async ({ page, electronApp, events }) => {
  // Float the LEFT region (tabs A) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Other content', { timeout: 15_000 })

  // Focus B in the MAIN window (its tabs is the only tab-bar left there): activate its second tab so it is the
  // most-recently-focused open-candidate LOCALLY. (Two tabs per group so a non-active tab is always clickable.)
  await page.locator('au-tab-strip-cell').nth(1).click()

  await events.clear()

  // Focus A in WINDOW 2: activate its second tab → the container reports focus, which crosses to
  // the authority's one FocusTree. Assert the cross-window focus reached the authority.
  await floated.locator('au-tab-strip-cell').nth(1).click()
  const surfaceFocus = await events.waitFor((e) => e.name === 'surface-focus', { filter: { category: 'focus' }, timeout: 15_000 })
  expect(surfaceFocus.fields?.record, 'the surface-focus trace names the focused record').toBeTruthy()

  // Fire an open from the window-1 file-tree.
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()
  await fileRow.click()

  // THE ASSERTION: the open COMMITTED to a REMOTE candidate — the winner is tabs A in window 2, reached only
  // because its focus crossed and out-ranked the locally-focused B. A local B win would emit no `commit-remote`.
  await events.waitFor((e) => e.name === 'fire' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  const committed = await events.waitFor((e) => e.name === 'commit-remote' && e.fields?.type === 'open-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  expect(committed.fields?.record, 'the aimed commit crossed to the winning window-2 record').toBeTruthy()

  // No standing error was raised.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
