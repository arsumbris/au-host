// The shipped keymap binds ⌘K to toggle-command-palette-intent and ⌘S to save-intent.
// Assert that both shortcuts dispatch through the active keymap and reach their host handlers.

import { test, expect } from '../fixtures/app'

test.use({ composition: 'keybind-default' })

test('⌘K toggles the command palette through the keymap (no hardcoded handler)', async ({ page }) => {
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()
  await page.waitForTimeout(500) // let the async keymap read settle before the one-shot keypress
  await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.locator('.cmd-palette-overlay')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0)
})

test('the palette shows a command shortcut by reverse-lookup over the active keymaps', async ({ page }) => {
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()
  await page.waitForTimeout(500)
  // Open the palette; the "Save" command (save-intent) is bound to ⌘S in the active keymap, so its shortcut
  // renders from the REVERSE-LOOKUP (command-meta.defaultBinding is gone), not a per-command meta.
  await page.locator('.cmd-palette-trigger').click()
  await expect(page.locator('.cmd-palette-overlay')).toBeVisible()
  await expect(page.getByText('⌘S').first()).toBeVisible()
  await page.keyboard.press('Escape')
})

test('⌘S fires the generic host-handled save-intent through the keymap', async ({ page, events }) => {
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()
  await page.waitForTimeout(500)
  await events.clear()

  await page.keyboard.press('ControlOrMeta+s')

  const fired = await events.waitFor(
    (e) => e.name === 'fire' && String(e.fields?.intent).includes('save-intent'),
    { filter: { category: 'keybind' }, timeout: 10_000 },
  )
  expect(fired.fields?.kind).toBe('routed')
  expect(fired.fields?.dispatch).toBe('ambient')
})
