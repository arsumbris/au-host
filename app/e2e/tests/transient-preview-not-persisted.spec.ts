// Serializing a composition with an open preview excludes transient records and their inbound refs.
// Read the exact persistence payload through the gated composition bridge without modifying the fixture.
import { test, expect } from '../fixtures/app'

// The fixture has a file-tree at left and a tabs group holding Backlinks at center.
// It declares no editor, so any live editor record comes from the transient preview opened by the click.
test.use({ composition: 'preview-selection-to-backlinks' })

interface Composition {
  projections?: Array<Record<string, unknown>>
}
const readComposition = (page: import('@playwright/test').Page): Promise<Composition | null> =>
  page.evaluate(() => {
    const fn = (globalThis as unknown as { __auComposition?: () => unknown }).__auComposition
    return (fn ? fn() : null) as Composition | null
  })

const typeOf = (r: Record<string, unknown>): string => String(r['type'] ?? '')
const isEditor = (r: Record<string, unknown>): boolean => typeOf(r).includes('editor')
const tabsRecord = (c: Composition): Record<string, unknown> | undefined => (c.projections ?? []).find((r) => typeOf(r).includes('tabs'))

test('a composition with an open preview tab serializes with zero transient records and no dangling ref', async ({ page, events }) => {
  // Baseline: the loaded composition declares no editor, and the tabs holds exactly its one Backlinks tab.
  const before = await readComposition(page)
  expect(before, 'the __auComposition read bridge is installed (AU_HOST_EVENTS enables it)').not.toBeNull()
  expect((before!.projections ?? []).filter(isEditor), 'no editor record before the preview opens').toHaveLength(0)
  expect((tabsRecord(before!)?.['tabs'] as unknown[] | undefined) ?? [], 'the tabs starts with one tab (Backlinks)').toHaveLength(1)

  const fileRow = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(fileRow).toBeVisible()
  await fileRow.click()

  // The preview really opened: a transient editor is LIVE in the pool (CodeMirror renders sample.md).
  await expect(page.locator('.cm-content').first()).toContainText('Sample content', { timeout: 10_000 })

  // THE LOCK: the serialized (persist) form drops the transient preview and strips its inbound ref.
  const after = await readComposition(page)
  expect(after, 'composition still serializes').not.toBeNull()
  // (a) NO transient editor record reaches the persist payload — the record drop.
  expect(
    (after!.projections ?? []).filter(isEditor),
    `serialized projections must contain no transient editor; got ${JSON.stringify((after!.projections ?? []).filter(isEditor))}`,
  ).toHaveLength(0)
  // (b) the tabs' inbound ref to the preview is stripped — still exactly one tab (Backlinks), no dangling ref.
  expect(
    (tabsRecord(after!)?.['tabs'] as unknown[] | undefined) ?? [],
    'the tabs serializes with only its persistent Backlinks tab (the preview ref is stripped)',
  ).toHaveLength(1)

  // And the open raised no error condition.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
