// Behaviour: ⌘W closes the FOCUSED view and does NOT kill the window.

// The reproduced defect this fixes: with no binding, ⌘W fell through to Electron and closed the main
// window. Here ⌘W is bound to `close-view-intent` (host-handled): the host resolves the focused pane and
// requests its removal (through `closePane` -> `propose` -> `applyStructural`, the structural commit seam's
// guarded reap), and the main gate preventDefaults the chord it handled, so the OS window-close never runs.
// The chord is a removable keymap record — the lifecycle hangs off the COMMAND, not the key.

import { test, expect } from '../fixtures/app'

test.use({ composition: 'close-view-cmd' })

test('⌘W closes the focused pane and the window survives', async ({ page, events }) => {
  const cells = page.locator('au-tab-strip-cell')
  await expect(cells).toHaveCount(2)

  // Focus the active editor's CONTENT (⌘W closes the view holding DOM focus — the pane you are IN).
  await page.locator('.cm-content').first().click()
  await events.clear()

  // ⌘W — bound to close-view-intent. The gate handles it (preventing the native window close), the host
  // resolves the focused pane and closes it.
  await page.keyboard.press('ControlOrMeta+w')

  // The focused pane closed → one tab remains. If the binding had NOT been handled, the native ⌘W would
  // have closed the whole window and this page would be gone (a different failure).
  await expect(cells).toHaveCount(1)

  // The window is alive and healthy — no standing error condition (the app did not quit).
  const conds = await events.conditions()
  expect(conds.filter((c) => c.severity === 'error')).toHaveLength(0)
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()
})
