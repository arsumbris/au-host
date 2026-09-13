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
