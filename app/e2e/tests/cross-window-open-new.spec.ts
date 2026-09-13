// A file-tree with no eligible open handler offers Open in a new window. Choosing it creates
// a viewer and window record through `openInWindow`, realizes the surface, and renders the file.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'cross-window-open-new' })

test('the open-floor "new window" escape opens a fresh file in its own window', async ({ page, electronApp, events }) => {
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()
  await fileRow.click()

  // Nothing can open the file in place → the open-floor chooser. It offers the pane picker ("Place into a
  // pane…") AND the universal escape; this test exercises the escape, targeted by name.
  const option = page.locator('.au-chooser-card').getByRole('menuitem', { name: 'Open in a new window' })
  await option.waitFor({ state: 'visible', timeout: 10_000 })

  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    option.click(),
  ])

  // The fresh editor renders sample.md in its OWN window — the pool grew a `window` record the authority
  // realized as a surface (openInWindow reuses float's window-realization).
  await expect(floated.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
