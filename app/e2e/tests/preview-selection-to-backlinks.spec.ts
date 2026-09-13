// A transient preview tab's selection reaches a sibling Backlinks pane through its live parent edge.
// The file-tree sits in the left region and cannot supply the center group's selection, so the preview
// is the only source that can populate Backlinks. Assert both rendered preview content and the received file.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'preview-selection-to-backlinks' })

test('a transient preview tab publishes selection that a sibling Backlinks pane receives via the live edge', async ({ page, events }) => {
  // Backlinks (a tab in the center group) starts with NO selection — its own initial prompt. This rules
  // out a pre-existing selection standing in for the preview's.
  const target = page.locator('.au-backlinks-target')
  await expect(page.locator('.au-backlinks-empty')).toHaveAttribute('label', 'Select a file', { timeout: 30_000 })
  await expect(target).toHaveText('')

  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()

  // Isolate this gesture's traces, then click the file (plain click → transient preview).
  await events.clear()
  await fileRow.click()

  // The file-tree fired an open-intent and the CENTER tabs claimed it (the single open-capable container).
  await events.waitFor((e) => e.name === 'fire' && e.fields?.type === 'open-intent', { filter: { category: 'intent' } })
  await events.waitFor((e) => e.name === 'claim' && e.fields?.type === 'open-intent', { filter: { category: 'intent' } })

  // The preview editor mounts NON-EMPTY (the preview path executed) — CodeMirror renders sample.md.
  await expect(page.locator('.cm-content').first()).toContainText('Sample content', { timeout: 10_000 })

  // Backlinks receives the preview editor's file-selection through their shared tabs parent.
  // Its header changes when that selection arrives. The file-tree publishes in the left subtree and
  // cannot populate this center-group header.
  await expect(target).toHaveText('sample.md', { timeout: 10_000 })

  // And the reference resolves end-to-end: refs-sample.md links [[sample]], so Backlinks shows one row.
  await expect(page.locator('.au-backlinks-label')).toHaveAttribute('primary', /refs-sample/, { timeout: 10_000 })

  // No standing error condition was raised by the open (a dropped/empty mount would surface one).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
