// Opening a file in a wrapped single-tab group creates a transient preview whose editor renders
// the file. Assert both intent dispatch and visible content so a missing live preview record fails.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'open-into-wrapped-tabs' })

test('clicking a file in a wrapped tabs opens a preview editor that renders the file', async ({ page, events }) => {
  const cells = page.locator('au-tab-strip-cell')
  // The wrapped tabs boots with its single tab (the file-tree), which lists the vault's sample.md.
  // (The tree's `data-path` is the ABSOLUTE file path, so match by suffix, not the bare name.)
  await expect(cells).toHaveCount(1)
  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()

  // Isolate this gesture's traces, then open the file (plain click → transient preview).
  await events.clear()
  await fileRow.click()

  // DECISION: an open-intent fired and the tabs container CLAIMED it (the responder-chain win).
  await events.waitFor((e) => e.name === 'fire' && e.fields?.type === 'open-intent', { filter: { category: 'intent' } })
  await events.waitFor((e) => e.name === 'claim' && e.fields?.type === 'open-intent', { filter: { category: 'intent' } })

  // The tabs realizes the open as a transient PREVIEW tab beside the file-tree tab.
  await expect(cells).toHaveCount(2)

  // The preview editor renders sample.md's content. `.cm-content` is CodeMirror's text layer.
  await expect(page.locator('.cm-content').first()).toContainText('Sample content', { timeout: 10_000 })

  // And no error condition was raised by the open (a dropped/empty mount would surface one).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
