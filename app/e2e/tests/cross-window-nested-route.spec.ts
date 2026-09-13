// A routed intent reaches a nested child on a floated surface. Float a bento containing tabs,
// then open a file from main. The nested tabs must register a mounted handler so the surface can
// answer the claim, commit the open, and render a preview in its window.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-nested-route' })

test('an open-intent routes to a NESTED tabs (a mountChild) floated into window 2', async ({ page, electronApp, events }) => {
  // Float the LEFT region (the BENTO subtree) into its own OS window. `.first()` "Pane actions" is the
  // sandwich LEFT region's ⋯ (outermost), so this floats the whole bento — the tabs stays NESTED under it.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  // The NESTED tabs renders on the surface (au-tab-bar), holding other.md — proof the float landed the bento
  // subtree (tabs nested), not the tabs as a bare root.
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Other content', { timeout: 15_000 })

  // The file-tree STAYS in the main window (the sandwich CENTER); it lists the vault's sample.md.
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()

  await events.clear()
  await fileRow.click() // → an open-intent whose only handler is the NESTED tabs in window 2.

  // Routing assertion: the open was CLAIMED by the nested tabs — its handler was reachable via
  // `this.mounted`. Pre-fix `this.mounted.get(tabsRecordId)` was undefined, so the surface declined.
  const claim = await events.waitFor(
    (e) => e.name === 'claim' && e.fields?.type === 'open-intent',
    { filter: { category: 'intent' }, timeout: 15_000 },
  )
  expect(claim.fields?.ownerLabel, 'the open was claimed by the NESTED tabs in window 2').toContain('tabs')

  // The nested tabs creates a preview and renders sample.md. Assert a second tab and the file content.
  await expect(floated.locator('au-tab-strip-cell')).toHaveCount(2, { timeout: 15_000 })
  await expect(floated.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })

  // No standing error (a declined-into-nowhere would surface as a warning at most, never a throw).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
