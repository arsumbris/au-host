import {test, expect} from '../fixtures/app'
test.use({composition:'file-empty-viewer'})
test('file open fills the selected empty viewer instead of adding another tab', async ({page}) => {
  await expect(page.getByText('No document open',{exact:true})).toBeVisible()
  await page.locator('au-tree-row[data-kind="file"][data-path$="/sample.md"]').click()
  await expect(page.locator('.au-reader[data-file="sample.md"]')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab',{name:'sample.md',exact:true})).toHaveAttribute('aria-selected','true')
})
