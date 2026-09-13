// Behaviour: the CLOSE-GUARD holds the reap and PRESERVES a projection's in-memory state on a cancel.

// The first tab is a test-only guarded pane: it renders an "unsaved buffer" input and registers a
// close-guard that vetoes while the buffer is non-empty. This is the make-or-break proof of the removal
// lifecycle: closing the tab orphans the guarded pane’s record; the host HOLDS the reap and gathers the
// guard's consensus; a veto never unmounts the node, so the buffer's text survives (continuous `^:`-keyed
// mount). Clearing the buffer makes the guard consent, so the tab then reaps.

import { test, expect } from '../fixtures/app'

test.use({ composition: 'close-guard' })

test('a close-guard veto holds the reap and preserves in-memory state; consent reaps', async ({ page, events }) => {
  const cells = page.locator('au-tab-strip-cell')
  const buffer = page.locator('.hello-buffer')
  await expect(buffer).toBeVisible()
  await expect(cells).toHaveCount(2)

  // In-memory unsaved work: type into the buffer (never persisted anywhere — it lives only in the DOM).
  await buffer.fill('unsaved work')
  await expect(buffer).toHaveValue('unsaved work')

  // Close the guarded pane’s tab (the first, active cell). Its close affordance fades in on hover.
  await events.clear()
  const helloTab = cells.first()
  await helloTab.hover()
  await helloTab.locator('au-close-button').click()

  // VETO: the guard refused (buffer non-empty). The host recorded a held reap that resolved to a veto.
  await events.waitFor((e) => e.category === 'placement' && e.name === 'close-veto')
  // The tab is STILL there and the in-memory buffer text SURVIVED — the node was never unmounted.
  await expect(cells).toHaveCount(2)
  await expect(buffer).toBeVisible()
  await expect(buffer).toHaveValue('unsaved work')

  // Now clear the buffer (the "unsaved work" is gone) and close again → the guard CONSENTS → it reaps.
  await buffer.fill('')
  await events.clear()
  await helloTab.hover()
  await helloTab.locator('au-close-button').click()

  await events.waitFor((e) => e.category === 'placement' && e.name === 'close-reap')
  await expect(cells).toHaveCount(1) // the guarded pane’s tab reaped; the other tab remains.
})
