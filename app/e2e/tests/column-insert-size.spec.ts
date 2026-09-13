import {test, expect} from '../fixtures/app'
test.use({composition:'column-insert-size'})
test('new content gets usable height beside large authored column weights', async ({page}) => {
  await page.getByRole('button',{name:'Add pane',exact:true}).click()
  await page.getByRole('combobox').fill('Reader')
  await page.getByRole('option',{name:'Reader',exact:true}).click()
  const items=page.locator('.au-col-item')
  await expect(items).toHaveCount(3)
  const sizes=await items.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height))
  expect(sizes[2]).toBeGreaterThan(sizes.reduce((a,b)=>a+b,0)*0.2)
  await expect(items.last().locator('au-pane-header')).toBeVisible()
  await page.screenshot({path:'/private/tmp/au-column-insert.png'})
})
