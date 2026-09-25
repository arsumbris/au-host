// FILE-TREE NESTING GUIDES paint across every gap between rows. Each `<au-tree-row>` contains itself
// (`content-visibility: auto`), which clips paint at the row box, and each subtree clips for its height
// animation; the guide overhangs its row by the tree's `--au-tree-row-gap`, so both clips must let it
// through. Checked on real pixels: jsdom has no paint, and a computed-style read cannot see a clip.

import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { test, expect } from '../fixtures/app'

test.use({ composition: 'file-empty-viewer' })

type Strip = { width: number; height: number; data: number[] }

/** Raw BGRA pixels of a page rect, in device pixels, read straight from the window's compositor. */
async function pixels(electronApp: ElectronApplication, rect: { x: number; y: number; width: number; height: number }): Promise<Strip> {
  return electronApp.evaluate(async ({ BrowserWindow }, r) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible()) ?? BrowserWindow.getAllWindows()[0]
    const image = await win.webContents.capturePage(r)
    const { width, height } = image.getSize()
    return { width, height, data: [...image.toBitmap()] }
  }, rect)
}

/** The device columns of a strip's middle line whose colour differs from its first column. */
function paintedColumns(strip: Strip): number {
  const line = Math.floor(strip.height / 2)
  const at = (col: number): number[] => strip.data.slice((line * strip.width + col) * 4, (line * strip.width + col) * 4 + 3)
  const background = at(0)
  return Array.from({ length: strip.width }, (_, c) => c).filter((c) => at(c).some((v, k) => Math.abs(v - background[k]) > 6)).length
}

/**
 * The guide at ancestor depth `depth` (0 = outermost) is painted in the gap between `above` and `below`.
 * POSITIVE CONTROL first: the same column inside `above`, where the guide always paints. A probe that sees
 * no guide there could not see one in the gap either.
 */
async function expectGuideAcrossGap(page: Page, electronApp: ElectronApplication, above: Locator, below: Locator, depth: number): Promise<void> {
  // Let every open / close settle first: a subtree still growing moves the rows below it.
  await page.locator('.au-ft').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))))
  // Hover the tree away from both rows, so the guides show and neither row lifts.
  await page.locator('.au-ft-scroll').hover({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(400)
  const a = (await above.boundingBox())!
  const b = (await below.boundingBox())!
  expect(b.y - (a.y + a.height)).toBeGreaterThan(0)
  // A guide sits at the row's base inset, plus `depth` indent steps, plus half a step (4px + 16px * depth + 8px).
  const x = Math.round(a.x + 4 + 16 * depth + 8)
  const inside = await pixels(electronApp, { x: x - 4, y: Math.floor(a.y + a.height / 2), width: 9, height: 1 })
  expect(paintedColumns(inside), 'the probe sees the guide inside the row').toBeGreaterThan(0)
  // Strictly inside the gap: a strip overlapping either row would see the guide inside that row.
  const top = Math.ceil(a.y + a.height)
  const painted = paintedColumns(await pixels(electronApp, { x: x - 4, y: top, width: 9, height: Math.max(1, Math.floor(b.y) - top) }))
  expect(painted, 'the guide is painted in the gap').toBeGreaterThan(0)
  // The guide is 1px wide; at a 2x scale it covers two device columns. Anything wider is not the guide.
  expect(painted).toBeLessThanOrEqual(3)
}

const row = (page: Page, suffix: string): Locator => page.locator(`au-tree-row[data-path$="${suffix}"]`)

test('a guide runs through the gap between two rows of one folder', async ({ page, electronApp }) => {
  await row(page, '/compositions').click()
  const children = page.locator('au-tree-row[data-path*="/compositions/"]')
  await expect(children.nth(2)).toBeVisible()
  await expectGuideAcrossGap(page, electronApp, children.nth(0), children.nth(1), 0)
})

test('a guide runs through the gap where a nested folder ends', async ({ page, electronApp }) => {
  await row(page, '/nested').click()
  await row(page, '/nested/inner').click()
  await expect(row(page, '/nested/inner/leaf.md')).toBeVisible()
  // The outer guide leaves the nested folder's last row and continues to the outer folder's next row.
  await expectGuideAcrossGap(page, electronApp, row(page, '/nested/inner/leaf.md'), row(page, '/nested/after.md'), 0)
})
