import {test, expect} from '../fixtures/app'
test.use({composition:'document-surfaces'})
test('document toolbar inherits its sidebar or framed surface', async ({page}) => {
  const sidebar=page.locator('[data-pane-host="sidebar-reader"] .au-document-toolbar')
  const center=page.locator('[data-pane-host="center-reader"] .au-document-toolbar')
  await expect(sidebar).toBeVisible()
  await expect(center).toBeVisible()
  const sidebarFill=await sidebar.evaluate(el=>getComputedStyle(el).backgroundColor)
  const expectedSidebar=await page.evaluate(()=>{
    const probe=document.createElement('div');probe.style.background='var(--au-color-bg)';document.body.append(probe)
    const color=getComputedStyle(probe).backgroundColor;probe.remove();return color
  })
  expect(sidebarFill).toBe(expectedSidebar)
  const expectedCenter=await center.evaluate(el=>{
    let node:Element|null=el
    while(node&&node.tagName!=='AU-PANE-FRAME') node=node.parentElement
    return node ? getComputedStyle(node).backgroundColor : null
  })
  expect(await center.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(expectedCenter)
  // A standalone Reader's opaque toolbar must not paint over the containing frame outline.
  const frame = page.locator('au-pane-frame').filter({has: center}).last()
  const edge = await frame.evaluate(el => ({
    shadow: getComputedStyle(el, '::after').boxShadow,
    pointerEvents: getComputedStyle(el, '::after').pointerEvents,
    isolation: getComputedStyle(el).isolation,
  }))
  expect(edge.shadow).not.toBe('none')
  expect(edge.pointerEvents).toBe('none')
  expect(edge.isolation).toBe('isolate')
  await page.screenshot({path:'/private/tmp/au-document-surfaces.png'})
})
