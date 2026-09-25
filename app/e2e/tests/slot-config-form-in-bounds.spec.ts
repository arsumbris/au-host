// The "Layout rules" form (SlotConfigHost / ConfigSlotForm) must stay within the viewport. It is a wide
// panel (up to 640px) on the host POPOVER seam, which owns the anchoring + viewport clamp, so it lands fully
// on-screen even when opened for a RIGHT-edge pane. Deterministic in real Chromium: the form has a real
// 640px width, which would hang off the right edge without the clamp.

import { test, expect } from '../fixtures/app'

test.use({ composition: 'pane-actions-menu' })

test('the Layout rules form for a right-edge pane stays within the viewport', async ({ page, events }) => {
  const menuButtons = page.getByRole('button', { name: 'Pane actions' })
  await expect(menuButtons).toHaveCount(2)
  // pane-actions-menu is a bento ROW split: pane `b` is the RIGHT pane, its ⋯ button near the viewport edge.
  // Its "Layout rules" form anchors at that pane's right edge — the reported off-right-edge repro.
  await menuButtons.last().click()
  await page.getByRole('menuitem', { name: /Layout rules/ }).click()

  const form = page.getByRole('dialog', { name: 'Layout rules' })
  await expect(form).toBeVisible()
  await page.waitForTimeout(100) // let the layout-effect + ResizeObserver clamp against the settled size

  const box = await form.boundingBox()
  // Electron has no Playwright-set viewport, so read the real window dims.
  const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  expect(box, 'form bounding box').not.toBeNull()
  expect(box!.x, `form left edge x=${box!.x}`).toBeGreaterThanOrEqual(0)
  expect(
    box!.x + box!.width,
    `form right edge ${box!.x + box!.width} must be <= viewport width ${vp.width}`,
  ).toBeLessThanOrEqual(vp.width)

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})

// Switching the form from one position to another WITHOUT a pointerdown (the keybind path, or a second
// "Layout rules…" fire) replaces the open form. The owner's own close of A's popover fires no dismiss, so
// it cannot clear `editing` out from under B.
test('switching the Layout rules form from one pane to another keeps the second open', async ({ page, events }) => {
  const menuButtons = page.getByRole('button', { name: 'Pane actions' })
  await expect(menuButtons).toHaveCount(2)
  await menuButtons.first().click()
  await page.getByRole('menuitem', { name: /Layout rules/ }).click()

  const form = page.getByRole('dialog', { name: 'Layout rules' })
  await expect(form).toHaveAttribute('data-child-id', 'a')

  // The seam every "Layout rules…" row fires, dispatched directly: no pointer event reaches the page.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('au-open-slot-config', { detail: 'b' })))
  await expect(form).toHaveAttribute('data-child-id', 'b')
  await page.waitForTimeout(300) // a re-entrant dismiss would close it within a frame or two
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('data-child-id', 'b')

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
