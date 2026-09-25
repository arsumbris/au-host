import {test, expect} from '../fixtures/app'

test.use({composition:'reader-range'})
const toolbarOffset=(el:import('@playwright/test').Locator)=>el.evaluate(root=>{
  const toolbar=root.querySelector(':scope > .au-document-toolbar') as HTMLElement
  return {offset:parseFloat(getComputedStyle(root).getPropertyValue('--document-toolbar-offset')), height:toolbar.offsetHeight}
})
test('Reader follows a block link to its source passage', async ({page}) => {
  await expect(page.getByRole('heading', {name:'range-document', level:1, exact:true})).toHaveCount(0)
  await expect(page.getByText('More', {exact:true})).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Navigation test',exact:true})).toBeVisible()
  const reader = page.locator('.au-reader')
  await expect(reader).toHaveAttribute('data-scroll-toolbar','true')
  const scroll = reader.locator('au-scroll-area').first()
  await scroll.evaluate(el => { const area = el as HTMLElement & {scrollElement:HTMLElement}; area.scrollElement.scrollTop=500 })
  // The action row follows the document scroll: past its own height it has moved fully out of view.
  await expect.poll(async()=>{const t=await toolbarOffset(reader);return t.height>0 && t.offset===-t.height}).toBe(true)
  await scroll.evaluate(el => { const area = el as HTMLElement & {scrollElement:HTMLElement}; area.scrollElement.scrollTop=0 })
  await expect.poll(async()=>(await toolbarOffset(reader)).offset).toBe(0)
  await page.getByText('the target block',{exact:true}).click({modifiers:['Meta']})
  const passage=page.locator('.au-md p').filter({hasText:'The referenced passage.'})
  await expect(passage).toBeInViewport()
})
