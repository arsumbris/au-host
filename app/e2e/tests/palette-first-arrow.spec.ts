import {test, expect} from '../fixtures/app'
test.use({composition:'file-tabs-preference'})
test('palette first ArrowDown advances the preselected result', async ({page}) => {
  await page.getByRole('button',{name:'Search commands…',exact:true}).click()
  const palette=page.locator('au-command-palette')
  const input=palette.getByRole('combobox',{name:'Search commands'})
  await expect(input).toBeFocused()
  await expect(palette.getByRole('option').first()).toHaveAttribute('aria-selected','true')
  await input.press('ArrowDown')
  await expect(palette.getByRole('option').nth(1)).toHaveAttribute('aria-selected','true')
  await expect(palette.getByRole('listbox')).toBeFocused()
  await page.keyboard.press('Escape')
})

// The arrow keys walk the rows in the order they are drawn. Grouping draws a group's rows together, and
// the vault carries an uncategorised command beside grouped ones, so this fails if navigation follows the
// item array instead of the screen.
test('ArrowDown walks every result in on-screen order', async ({page}) => {
  await page.getByRole('button',{name:'Search commands…',exact:true}).click()
  const palette=page.locator('au-command-palette')
  const options=palette.getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-selected','true')
  const count=await options.count()
  expect(count).toBeGreaterThan(3)
  await palette.getByRole('combobox',{name:'Search commands'}).press('ArrowDown')
  for (let i=1;i<count;i++) {
    await expect(options.nth(i)).toHaveAttribute('aria-selected','true')
    if (i<count-1) await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('Escape')
})
