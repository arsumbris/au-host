// Loop-sanity: the harness end-to-end. Proves the real app launches, auto-opens the vault via AU_ENTRY,
// recents-seeds + mounts THIS fixture's composition (window → editor on sample.md), and the event-substrate
// read bridge is reachable — with no error conditions. If this passes, the launch → mount → trace-assert
// loop works and every other behaviour test builds on it.
import { test, expect } from '../fixtures/app'

test('boots the vault composition and mounts a pane, no error conditions', async ({ page, events }) => {
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()

  // The event read bridge is reachable — a static mount may emit 0 traces, so assert the ring EXISTS
  // (capacity), not that anything was recorded. Reaching this proves `page.evaluate(window.__auEvents)` works.
  const s = await events.stats()
  expect(s.capacity).toBeGreaterThan(0)

  // No ERROR conditions stand after boot (a broken mount / missing dep would raise one).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})

test('the editor pane auto-loads its composition-declared file', async ({ page }) => {
  // sanity.yaml declares `file: sample.md` on the editor; it should auto-load. toContainText spans the
  // tokenized CodeMirror lines (getByText wants one node — a markdown heading is split).
  await expect(page.locator('[data-pane-id]').first()).toContainText('Sample content', { timeout: 10_000 })
})
