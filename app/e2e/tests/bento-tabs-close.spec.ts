import {test, expect} from '../fixtures/app'

test.use({composition:'bento-tabs-close'})

test('pane X removes the last Tabs occupant and exposes an empty position', async ({page}) => {
  await page.locator('[data-pane-host="document"] .cm-content').first().waitFor({timeout:30_000})
  await page.getByRole('button',{name:'Close pane',exact:true}).first().click()
  await expect(page.locator('[data-pane-host="documents"]')).toHaveCount(0)
  await expect(page.getByRole('combobox',{name:'Search available panes'})).toBeVisible()
  await expect(page.getByRole('button', {name:'Close pane', exact:true})).toHaveCount(0)
  const search = page.getByRole('combobox',{name:'Search available panes'})
  await search.fill('not-an-installed-view')
  await search.press('Enter')
  await expect(search).toHaveValue('not-an-installed-view')
  await expect(page.getByText('No matches',{exact:true})).toBeVisible()
  await search.fill('Editor')
  await page.getByRole('option',{name:'Editor',exact:true}).click()
  await expect(page.locator('.cm-content').first()).toBeVisible()
  await expect(page.getByRole('button', {name:'Close pane', exact:true})).toBeVisible()
})

test('closing the last tab leaves a picker that can create a new tab', async ({page}) => {
  await page.locator('.cm-content').first().waitFor({timeout:30_000})
  await page.getByRole('button', {name:'Close sample.md',exact:true}).click()
  const search=page.getByRole('combobox',{name:'Search available panes'})
  await expect(search).toBeVisible()
  await search.fill('Reader')
  await page.getByRole('option',{name:'Reader',exact:true}).click()
  await expect(page.getByText('No document open',{exact:true})).toBeVisible()
  await expect(page.getByText(/This view could not be placed/)).toHaveCount(0)
})
