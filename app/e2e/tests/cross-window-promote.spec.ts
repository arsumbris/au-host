// Behaviour (firer-relative from a surface): a FIRER-RELATIVE intent fired INSIDE a
// floated window routes to its handler — proving the surface→authority fire path (`onSurfaceEvent`'s
// `intent-fired`) plus firer identity translation across the boundary (the firer crosses
// as its stable RECORD id, each surface maps it to a local publisher). a float
// co-locates a whole subtree, so a promote fired by the floated editor resolves to the floated tabs ABOVE
// it — both in window 2 — via the authority's firer-relative walk over the pool-derived ancestor chain.
//
// Float the tabs into window 2; click a file in window 1's file-tree → the floated tabs opens it as a
// PREVIEW tab (italic, `[preview]`). Then type into the floated editor → it fires `promote-intent`
// (firer-relative). The authority routes it back to the floated tabs, which drops the preview marker:
//   - a `fire-from-surface` trace (the floated editor's fire reached the authority).
//   - a `claim-remote` + `commit-remote` for `promote-intent` (the round-trip to the floated tabs).
//   - the `[preview]` attribute is REMOVED (the promote landed — the tab is now permanent).
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-route' })

test('a promote fired inside window 2 routes firer-relative to the tabs in window 2', async ({ page, electronApp, events }) => {
  // Float the LEFT region (the tabs) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Other content', { timeout: 15_000 })

  // Click the file in window 1 → the floated tabs opens sample.md as a PREVIEW tab (a second cell, italic).
  await page.locator('au-tree-row[data-path$="/sample.md"]').click()
  await expect(floated.locator('au-tab-strip-cell')).toHaveCount(2, { timeout: 15_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
  // The freshly-opened cross-window tab is a PREVIEW (transient) tab.
  await expect(floated.locator('au-tab-strip-cell[preview]')).toHaveCount(1, { timeout: 15_000 })

  // Isolate this gesture's traces, then EDIT the floated editor → its first real edit fires promote-intent
  // (firer-relative) from window 2. Focus the editor surface first, then type.
  await events.clear()
  await floated.locator('.cm-content').first().click()
  await floated.keyboard.type('x')

  // Assert on the authority's event substrate that the floated editor's intent reaches the authority.
  await events.waitFor((e) => e.name === 'fire-from-surface' && e.fields?.type === 'promote-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  // 2. the authority routed it back across to the floated tabs (firer-relative → the co-located ancestor).
  const claimed = await events.waitFor((e) => e.name === 'claim-remote' && e.fields?.type === 'promote-intent', { filter: { category: 'intent' }, timeout: 15_000 })
  expect(claimed.fields?.record, 'the promote claim names the floated tabs record').toBeTruthy()
  await events.waitFor((e) => e.name === 'commit-remote' && e.fields?.type === 'promote-intent', { filter: { category: 'intent' }, timeout: 15_000 })

  // 3. THE EFFECT LANDED: the preview marker is dropped — the tab is now permanent (no `[preview]` cell).
  await expect(floated.locator('au-tab-strip-cell[preview]')).toHaveCount(0, { timeout: 15_000 })

  // No standing ERROR was raised by the cross-window firer-relative promote.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
