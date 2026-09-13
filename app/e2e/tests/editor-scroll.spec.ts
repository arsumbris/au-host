import {test,expect} from '../fixtures/app'
test.use({composition:'editor-scroll'})
test('Editor toolbar hides into the document and returns on reverse scrolling',async({page})=>{
  const editor=page.locator('.au-editor')
  await expect(editor).toHaveAttribute('data-scroll-toolbar','true')
  await expect(page.getByText('More',{exact:true})).toHaveCount(0)
  await page.locator('.cm-scroller').evaluate(el=>{el.scrollTop=500})
  await expect(editor).toHaveAttribute('data-toolbar-hidden','true')
  await page.locator('.cm-scroller').evaluate(el=>{el.scrollTop=450})
  await expect(editor).not.toHaveAttribute('data-toolbar-hidden','true')
  await page.screenshot({path:'/private/tmp/au-editor-scroll-after.png'})
})
