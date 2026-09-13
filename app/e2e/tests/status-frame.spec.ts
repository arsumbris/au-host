import {test, expect} from '../fixtures/app'

test.use({composition:'status-frame'})
test('dock status strip has an inset themed frame without clipping content', async ({page}) => {
  const frame=page.locator('.au-bar-frame > au-pane-frame')
  await expect(frame).toBeVisible()
  const inset=await page.locator('.au-bar-frame').boundingBox()
  const card=await frame.boundingBox()
  const status=await page.locator('.au-statusbar').boundingBox()
  expect(card!.x).toBeGreaterThan(inset!.x)
  expect(card!.y).toBeGreaterThan(inset!.y)
  expect(card!.height).toBeGreaterThanOrEqual(status!.height)
  await page.screenshot({path:'/private/tmp/au-status-frame-after.png'})
})
