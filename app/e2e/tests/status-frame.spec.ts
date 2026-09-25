// Behaviour: a bar is CHROME, not a pane card. A bar on a dock's bottom edge fills its edge slot, square
// (no rounded corners, no card), with one hairline rule and a small optical pad on the side facing the
// content, and its item fits inside it without clipping.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'status-frame' })

test('a docked bar fills its edge, square, ruled and padded toward the content', async ({ page }) => {
  const strip = page.locator('.au-bar-frame')
  await expect(strip).toBeVisible()
  await expect(page.locator('.au-bar-frame au-pane-frame'), 'a bar is not a pane card').toHaveCount(0)
  const box = (await strip.boundingBox())!
  const slot = (await page.locator('.au-dock-bottom > .au-dock-slot').boundingBox())!
  expect(box, 'the bar fills its edge slot, no outer inset').toEqual(slot)
  const style = await strip.evaluate((el) => {
    const s = getComputedStyle(el)
    return { radius: s.borderTopLeftRadius, ruleTop: s.borderTopWidth, ruleBottom: s.borderBottomWidth, padTop: s.paddingTop, padBottom: s.paddingBottom }
  })
  expect(style.radius, 'square corners').toBe('0px')
  expect(style.ruleTop, 'the rule faces the content').not.toBe('0px')
  expect(style.ruleBottom).toBe('0px')
  expect(style.padTop, 'the optical pad faces the content').not.toBe('0px')
  expect(style.padBottom).toBe('0px')
  const item = (await page.locator('.au-statusbar').boundingBox())!
  expect(item.y, 'the item sits inside the strip').toBeGreaterThanOrEqual(box.y)
  expect(item.y + item.height, 'the item is not clipped').toBeLessThanOrEqual(box.y + box.height + 0.5)
})
