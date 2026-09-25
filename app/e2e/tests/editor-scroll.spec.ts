import {test,expect} from '../fixtures/app'
test.use({composition:'editor-scroll'})
const toolbarOffset=(el:import('@playwright/test').Locator)=>el.evaluate(root=>{
  const toolbar=root.querySelector(':scope > .au-document-toolbar') as HTMLElement
  return {offset:parseFloat(getComputedStyle(root).getPropertyValue('--document-toolbar-offset')), height:toolbar.offsetHeight}
})
test('Editor toolbar scrolls away with the document and returns at the top',async({page})=>{
  const editor=page.locator('.au-editor')
  await expect(editor).toHaveAttribute('data-scroll-toolbar','true')
  await expect(page.getByText('More',{exact:true})).toHaveCount(1)
  await page.locator('.cm-scroller').evaluate(el=>{el.scrollTop=500})
  // The action row follows the document scroll: past its own height it has moved fully out of view.
  await expect.poll(async()=>{const t=await toolbarOffset(editor);return t.height>0 && t.offset===-t.height}).toBe(true)
  await page.locator('.cm-scroller').evaluate(el=>{el.scrollTop=0})
  await expect.poll(async()=>(await toolbarOffset(editor)).offset).toBe(0)
})
