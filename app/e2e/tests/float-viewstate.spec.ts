// REGRESSION LOCK (FLOATED window): an editor's view-state survives a MOVE across the window
// boundary. This is the cross-window half of view-state-restore.spec (which covers the main-window restart path). A cross-window move ALWAYS remounts (DOM cannot cross an OS-window boundary), so survival rides
// ENTIRELY on the round-trip: flush-on-unmount (the debounced save is flushed as the float tears the editor
// down) → the main-owned store → refresh-node-on-mount (the destination window pulls the pane's slot from
// main, defeating its stale boot cache) → restore. Break any leg and the floated editor mounts at scroll 0.
//
// Scroll is the assertion target because it is a plain `scrollTop` number — no CodeMirror-internal selectors,
// and it rides the same capture/restore path as folds + selection.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-viewstate' }) // sandwich → left: editor (long file, scrolls), center: file-tree

test('a floated editor restores its scroll (view-state survives the window move)', async ({ page, electronApp }) => {
  await page.waitForSelector('.cm-scroller', { timeout: 30_000 })

  // Scroll the MAIN editor down. The 'scroll' schedules a 400ms-debounced view-state save; the float below
  // tears the editor down well within that window, so ONLY the flush-on-unmount can get it to main.
  await page.locator('.cm-scroller').first().evaluate((el) => { el.scrollTop = 3000 })
  const saved = await page.locator('.cm-scroller').first().evaluate((el) => el.scrollTop)
  expect(saved, 'the long file must actually scroll (so restore is observable)').toBeGreaterThan(200)

  // Float the EDITOR (the LEFT region, so `.first()` Pane actions is its) into a new window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('.cm-scroller', { timeout: 30_000 }) // the editor re-mounted in the new window

  // THE PROOF: the floated editor restored the scroll. Restore runs a frame after mount (a rAF-guarded
  // scrollTop set once layout settles), so poll. Scroll 0 here = a broken leg of the round-trip.
  await expect
    .poll(() => floated.locator('.cm-scroller').first().evaluate((el) => el.scrollTop), {
      timeout: 10_000,
      message: 'the floated editor never restored its scroll — the cross-window view-state round-trip is broken',
    })
    .toBeGreaterThan(saved * 0.8)
})
