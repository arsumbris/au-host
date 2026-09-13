// A floated window canonicalizes and arbitrates its own keydown, then forwards the surviving chord
// to the authority's resolver. The main window never receives the keydown, so an intent fired at the
// authority demonstrates the complete surface-to-authority path.

import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'keybind-cross-window' })

test('a ⌘S pressed in a floated window resolves + fires at the authority', async ({ page, electronApp, events }) => {
  // Float the LEFT region (the tabs group) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  // The floated window painted its content (the tabs + its editor) and installed its own keybind gate.
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  await expect(floated.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })
  // Focus inside the floated window so the keydown targets THIS window's document (its gate, not the main's).
  await floated.locator('.cm-content').first().click()
  await events.clear()

  // Press ⌘S in the FLOATED window. Its gate arbitrates (a command chord is never plain typing), forwards the
  // keystroke UP, and the authority resolves the global keymap and fires — even though the main window never
  // saw the keydown.
  await floated.keyboard.press('ControlOrMeta+s')

  const fired = await events.waitFor(
    (e) => e.name === 'fire' && String(e.fields?.intent).includes('save-composition-intent'),
    { filter: { category: 'keybind' }, timeout: 10_000 },
  )
  expect(fired.fields?.kind).toBe('routed')
  expect(fired.fields?.dispatch).toBe('ambient')
})
