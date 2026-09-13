// Behaviour: unwrapping a single-leaf bento at the WINDOW ROOT dissolves it to a bare editor (window
// content = the editor). Regression guard for a no-op bug: dissolve only lifted a child into a container
// GRANDPARENT, and the window is not a container. Fixed by making the window's `content` a re-pointable
// slot (ProjectionHost's root anchor registers `rootContentPlacement`), so the same generic dissolve seam
// re-points `window.content` — the outcome is a bare projection root, the window is not made a container.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'bento-editor' })

test('unwrapping a single-leaf bento at the window root dissolves it to a bare editor', async ({ page }) => {
  await expect(page.locator('[data-container-kind="bento"]').first()).toBeVisible()
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Unwrap container' }).click()
  await expect(page.locator('[data-container-kind="bento"]')).toHaveCount(0) // bento dissolved
  // The bare editor must be VISIBLE as the new window content — not merely present in the DOM. (A stale
  // root anchor left the editor orphaned/hidden: a black screen where toContainText alone still passed.)
  const editor = page.locator('.cm-content').first()
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('Sample content')
  // And it must be mounted at the ROOT anchor (the kernel-container), i.e. actually re-anchored.
  await expect(page.locator('.kernel-container [data-pane-id="ed"]').first()).toBeVisible()
})
