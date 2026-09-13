// Behaviour: the PER-WINDOW active-pane RING works IN a floated window.
// A container renders its own ring from `host.focus.watchActive`, which for a floated window delivers the
// authority's window-scoped active-pane head (the ONE aggregate FILTERED to that window), gated by the
// window's OS-focus. Assert the ring in the secondary renderer, driven over IPC;
// a main-window assertion cannot exercise this surface path.
//
// w1 is a DECLARED second window (no float gesture) whose content is a sandwich; its CENTRE editor sits in an
// `au-pane-frame` (the same clean ring attribute the focus-route test asserts). Focus the centre in
// the floated window → its card rings; focus the side rail (the tree, no card) → the centre clears.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'cross-window-ring' })

test('a floated window rings its OWN active pane from the pushed window-scoped signal', async ({ page, electronApp }) => {
  // The main window painted its own editor.
  await page.locator('[data-pane-id="ed0"] .cm-content').first().waitFor({ timeout: 30_000 })
  // The declared second window is realized on load (no float gesture); it may open before the test body runs,
  // so poll the window set rather than waitForEvent (the window-restore pattern).
  await expect.poll(() => electronApp.windows().length, { timeout: 15_000 }).toBe(2)
  const floated = electronApp.windows().find((w) => w !== page)!
  await floated.locator('[data-pane-id="edC"] .cm-content').first().waitFor({ timeout: 30_000 })
  await floated.locator('au-tree-row').first().waitFor({ timeout: 30_000 })

  // The centre card = the au-pane-frame wrapping edC IN THE FLOATED WINDOW.
  const centreCard = floated.locator('au-pane-frame').filter({ has: floated.locator('[data-pane-id="edC"]') })

  // Focus the centre editor in the FLOATED window → its card rings (the pushed active-pane head reached the
  // floated sandwich and it drew its own ring).
  await floated.locator('[data-pane-id="edC"] .cm-content').first().click()
  await expect(centreCard).toHaveAttribute('focused', '')

  // Click a file-tree row (the left rail, no card) IN THE FLOATED WINDOW → the active pane is now the tree, so
  // the centre clears its ring — the window-scoped head follows real DOM focus within the floated window.
  await floated.locator('au-tree-row').first().click()
  await expect(centreCard).not.toHaveAttribute('focused', '')
})

// only the OS-focused window shows a ring — a blurred window hides its ring, and a
// refocus re-rings its retained head instantly. The gate is the window's own `focus`/`blur` listeners feeding
// `setOsFocused`; we drive them with the SAME events the OS fires (a real OS window switch is not reliably
// simulable in playwright, but the listener wiring is exactly what a real blur triggers).
test('the floated window hides its ring on blur (A2a) and re-rings its retained head on refocus', async ({ page, electronApp }) => {
  await page.locator('[data-pane-id="ed0"] .cm-content').first().waitFor({ timeout: 30_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 15_000 }).toBe(2)
  const floated = electronApp.windows().find((w) => w !== page)!
  await floated.locator('[data-pane-id="edC"] .cm-content').first().waitFor({ timeout: 30_000 })
  const centreCard = floated.locator('au-pane-frame').filter({ has: floated.locator('[data-pane-id="edC"]') })

  // Focus the centre in the floated window → it rings.
  await floated.locator('[data-pane-id="edC"] .cm-content').first().click()
  await expect(centreCard).toHaveAttribute('focused', '')

  // The window loses OS focus → the ring HIDES (its retained head is unchanged, just gated off).
  await floated.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(centreCard).not.toHaveAttribute('focused', '')

  // The window regains OS focus → its retained head (edC) re-rings instantly, no re-click needed.
  await floated.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(centreCard).toHaveAttribute('focused', '')
})
