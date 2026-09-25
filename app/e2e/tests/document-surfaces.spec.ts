import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {test, expect} from '../fixtures/app'
test.use({composition:'document-surfaces'})
test('document toolbar is transparent over its sidebar or framed surface', async ({page}) => {
  const sidebar=page.locator('[data-pane-host="sidebar-reader"] .au-document-toolbar')
  const center=page.locator('[data-pane-host="center-reader"] .au-document-toolbar')
  await expect(sidebar).toBeVisible()
  await expect(center).toBeVisible()
  // The action row is transparent, so the document shows its containing surface through it, whether a
  // sidebar or a framed pane.
  expect(await sidebar.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  expect(await center.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  // The toolbar must not paint over the containing frame outline.
  const frame = page.locator('au-pane-frame').filter({has: center}).last()
  const edge = await frame.evaluate(el => ({
    shadow: getComputedStyle(el, '::after').boxShadow,
    pointerEvents: getComputedStyle(el, '::after').pointerEvents,
    isolation: getComputedStyle(el).isolation,
  }))
  expect(edge.shadow).not.toBe('none')
  expect(edge.pointerEvents).toBe('none')
  expect(edge.isolation).toBe('isolate')
  await page.screenshot({path: join(tmpdir(), 'au-document-surfaces.png')})
})
