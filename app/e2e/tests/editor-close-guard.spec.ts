// Behaviour: the MARQUEE case — a dirty editor blocks its close with a save/discard/cancel prompt, and a
// cancel keeps the pane AND its unsaved buffer.
//
// The editor registers a close-guard. On ⌘W over a dirty editor, the host HOLDS the reap and the guard
// shows the host chooser. "Keep editing" (cancel) vetoes → the pane is never unmounted, so the buffer text
// survives. "Discard changes and close" consents → it reaps. This is the projection-owned veto decision
// meeting the host-owned removal at the reap.

import { test, expect } from '../fixtures/app'

test.use({ composition: 'close-view-cmd' })

test('a dirty editor blocks ⌘W with a prompt; cancel keeps it + its buffer, discard closes', async ({ page }) => {
  const cells = page.locator('au-tab-strip-cell')
  const content = page.locator('.cm-content').first()
  await expect(cells).toHaveCount(2)
  await expect(content).toBeVisible()

  // Focus the first editor's tab, then make its buffer DIRTY by typing.
  await cells.first().click()
  await content.click()
  await page.keyboard.type('UNSAVED EDIT')
  await expect(content).toContainText('UNSAVED EDIT')
  // The DIRTY DOT lights up on the tab (editor publishes `dirty` on view-state; tabs renders it).
  await expect(page.locator('au-tab-strip-cell[dirty]')).toHaveCount(1)

  // ⌘W → the guard holds the reap and shows the save/discard/cancel prompt.
  await page.keyboard.press('ControlOrMeta+w')
  const chooser = page.locator('.au-chooser-card')
  await expect(chooser).toBeVisible()
  await expect(chooser).toContainText('unsaved changes')

  // CANCEL ("Keep editing"): the pane and its unsaved buffer survive (never unmounted).
  await chooser.getByRole('menuitem', { name: 'Keep editing' }).click()
  await expect(chooser).toHaveCount(0)
  await expect(cells).toHaveCount(2)
  await expect(content).toContainText('UNSAVED EDIT')

  // ⌘W again → prompt → DISCARD: the editor closes (one tab remains).
  await page.keyboard.press('ControlOrMeta+w')
  await expect(chooser).toBeVisible()
  await chooser.getByRole('menuitem', { name: 'Discard changes and close' }).click()
  await expect(cells).toHaveCount(1)
})
