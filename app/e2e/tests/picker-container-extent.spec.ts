// Behaviour: in the spatial resolve picker, a CONTAINER candidate's badge covers its WHOLE extent — for a
// tabs group that is the tab bar PLUS the content pane — not just the content box it shares with the pane.
//
// A tabs group renders its tab-bar header and its content in DIFFERENT portaled regions, so the container's
// [data-pane-id] slot alone covers only the content and coincides with the pane it holds. Every region of
// one container declares the same data-container-id, so `slotExtent` unions them; a leaf carries none and
// stays its own box. This proves the container badge reaches the tab bar (top) and sits ABOVE the pane.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'picker-open' }) // two tabs groups + a file-tree; an open claims in both

test('a container candidate badge covers the tab bar, above the content pane', async ({ page }) => {
  await page.locator('au-tree-row').first().waitFor({ timeout: 30_000 })
  await page.locator('au-tree-row[data-path$="/sample.md"]').first().click()
  await page.locator('au-pane-target').first().waitFor({ timeout: 10_000 })

  const m = await page.evaluate(() => {
    const top = (el: Element) => Math.round(el.getBoundingClientRect().top)
    return {
      targets: [...document.querySelectorAll('au-pane-target')].map(top),
      barTop: Math.min(...[...document.querySelectorAll('au-tab-bar')].map(top)),
      contentTop: top(document.querySelector('[data-pane-id="edL"]:not([data-pane-host])')!),
    }
  })

  expect(m.targets.length, 'both tabs groups get a spatial badge').toBeGreaterThanOrEqual(2)
  // Each container badge reaches its tab bar (its top is at or above the tab-bar top) …
  for (const t of m.targets) expect(t, 'badge top should reach the tab bar').toBeLessThanOrEqual(m.barTop + 2)
  // … and the content pane sits BELOW the tab bar, so the badge wraps strictly more than the pane.
  expect(m.contentTop, 'content pane is below the tab bar').toBeGreaterThan(m.barTop + 8)

  await page.keyboard.press('Escape')
})
