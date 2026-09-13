import {test, expect} from '../fixtures/app'

test.use({composition: 'empty-slot-admits'})

test('a slot that rejects placeholders still offers and mounts admitted content', async ({page}) => {
  const center = page.locator('[id$="-center"]')
  const search = center.getByRole('combobox', {name: 'Search available panes'})
  await expect(search).toBeVisible({timeout: 30_000})
  await expect(center.getByRole('option')).toHaveCount(1)
  await center.getByRole('option', {name: 'Editor', exact: true}).click()
  await expect(page.locator('.cm-content')).toBeVisible()
  await expect(search).toHaveCount(0)
})
