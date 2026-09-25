import {test, expect, floatedWindow} from '../fixtures/app'

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

// The same slot in a FLOATED window. A floated window is its own renderer; it evaluates `admits` only if
// it installs the substrate's type facts itself, so this is the half a main-window test cannot see.
test.describe('in a floated window', () => {
  test.use({composition: 'empty-slot-admits-floatable'})

  test('the slot offers only admitted content there too', async ({page, electronApp}) => {
    await page.locator('[data-container-kind="column"]').getByRole('button', {name: 'Pane actions'}).first().click()
    const [floated] = await Promise.all([
      floatedWindow(electronApp),
      page.getByRole('menuitem', {name: 'Open in a new window', exact: true}).click(),
    ])
    const center = floated.locator('[id$="-center"]')
    const search = center.getByRole('combobox', {name: 'Search available panes'})
    await expect(search).toBeVisible({timeout: 30_000})
    await expect(center.getByRole('option')).toHaveCount(1)
    await expect(center.getByRole('option', {name: 'Editor', exact: true})).toBeVisible()
  })
})
