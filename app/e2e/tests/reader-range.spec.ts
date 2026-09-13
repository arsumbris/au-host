import {test, expect} from '../fixtures/app'

test.use({composition:'reader-range'})
test('Reader follows a block link to its source passage', async ({page}) => {
  await expect(page.getByRole('heading', {name:'range-document', level:1, exact:true})).toHaveCount(0)
  await expect(page.getByText('More', {exact:true})).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Navigation test',exact:true})).toBeVisible()
  const reader = page.locator('.au-reader')
  await expect(reader).toHaveAttribute('data-scroll-toolbar','true')
  const scroll = reader.locator('au-scroll-area').first()
  await scroll.evaluate(el => { const area = el as HTMLElement & {scrollElement:HTMLElement}; area.scrollElement.scrollTop=500 })
  await expect(reader).toHaveAttribute('data-toolbar-hidden','true')
  await scroll.evaluate(el => { const area = el as HTMLElement & {scrollElement:HTMLElement}; area.scrollElement.scrollTop=450 })
  await expect(reader).not.toHaveAttribute('data-toolbar-hidden','true')
  await page.getByText('the target block',{exact:true}).click({modifiers:['Meta']})
  const passage=page.locator('.au-md p').filter({hasText:'The referenced passage.'})
  await expect(passage).toBeInViewport()
  await page.screenshot({path:'/private/tmp/au-reader-range-after.png'})
})
