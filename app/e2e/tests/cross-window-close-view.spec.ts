// Behaviour: ⌘W in a FLOATED window closes THAT window's focused
// pane — not main's, not the aggregate head. The surface's gate forwards the chord
// carrying ITS window's transient focused pane `^:`; the authority resolves the
// target to the floated pane and DELEGATES the close back to that surface (the authority cannot reach the
// surface's per-renderer container placement). This is the surface close path, which a
// main-window ⌘W cannot exercise.
//
// w1 is a DECLARED second window (no float gesture) holding a tabs group with two editors; w0 (main) holds
// its own editor. Focus a tab in w1, ⌘W IN w1 → w1's tab count drops 2→1, w1 stays open, and w0 is untouched.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'cross-window-close-view' })

test('⌘W in a floated window closes that window\'s focused pane, leaving the main window untouched', async ({ page, electronApp, events }) => {
  // The main window painted its own editor (refs-sample.md).
  await page.locator('[data-pane-id="ed0"] .cm-content').first().waitFor({ timeout: 30_000 })
  // The declared second window is realized on load (no float gesture).
  await expect.poll(() => electronApp.windows().length, { timeout: 15_000 }).toBe(2)
  const floated = electronApp.windows().find((w) => w !== page)!

  // The floated tabs group has two tabs.
  const floatedCells = floated.locator('au-tab-strip-cell')
  await expect(floatedCells).toHaveCount(2)

  // Focus the active tab's editor CONTENT in the FLOATED window (⌘W closes the view holding DOM focus in THIS
  // window). The active tab is the first — editor `a` (sample.md).
  await floated.locator('[data-pane-id="a"] .cm-content').first().click()
  await events.clear()

  // ⌘W IN THE FLOATED WINDOW. Its gate forwards the chord (carrying `a`); the authority delegates the close
  // back to this surface, which closes tab `a` locally.
  await floated.keyboard.press('ControlOrMeta+w')

  // The floated tab count drops to one (tab `a` closed; `b` remains) — and the window survives (not the native
  // ⌘W closing the whole OS window).
  await expect(floatedCells).toHaveCount(1)
  await expect(floated.locator('[data-pane-id="b"]').first()).toBeVisible()
  expect(electronApp.windows().length, 'the floated window survived — the native ⌘W was suppressed').toBe(2)

  // The MAIN window is UNTOUCHED — its editor still holds refs-sample.md (the floated ⌘W did not close a main
  // pane).
  await expect(page.locator('[data-pane-id="ed0"]').first()).toBeVisible()

  // No standing error was raised on the authority.
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
