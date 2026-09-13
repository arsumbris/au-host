// KEYBINDS — the live authority-resolve + fire path, in the running app. A keymap FILE binds ⌘S to
// a host-handled intent; pressing ⌘S must ride the window-local gate → authority resolver → fire, observable
// over the `keybind` event category. And a within-file tie (two ⌘S bindings, different intents) must ASK the
// host chooser rather than silently picking. This is the end-to-end proof the unit tests (resolver +
// dispatcher + gate) cannot give — nothing else exercises a real keydown all the way to fireCommand.

import { test, expect } from '../fixtures/app'

test.describe('a bound chord fires its command', () => {
  test.use({ composition: 'keybind-fire' })

  test('pressing ⌘S resolves the active keymap and fires save-composition-intent', async ({ page, events }) => {
    // Booted: the editor pane is mounted, so ProjectionHost has read the composition's `keymaps` list.
    await expect(page.locator('[data-pane-id]').first()).toBeVisible()
    // Let the async keymap-file read settle before the one-shot keypress (a boot race, not a behaviour).
    await page.waitForTimeout(500)
    await events.clear()

    await page.keyboard.press('ControlOrMeta+s')

    // The authority resolved the chord to a single winner and fired it down the existing command path.
    const fired = await events.waitFor(
      (e) => e.name === 'fire' && String(e.fields?.intent).includes('save-composition-intent'),
      { filter: { category: 'keybind' }, timeout: 10_000 },
    )
    // It fired through the generic command call with the intent's routing stamped from the registry.
    expect(fired.fields?.kind).toBe('routed')
    expect(fired.fields?.dispatch).toBe('ambient')
  })
})

test.describe('an unresolvable within-file tie asks the chooser', () => {
  test.use({ composition: 'keybind-tie' })

  test('pressing ⌘S with two same-chord bindings routes to the host chooser', async ({ page, events }) => {
    await expect(page.locator('[data-pane-id]').first()).toBeVisible()
    await page.waitForTimeout(500)
    await events.clear()

    await page.keyboard.press('ControlOrMeta+s')

    // The resolver could not name a single winner (same keymap, both global, distinct intents), so the
    // authority ASKED instead of firing one.
    await events.waitFor((e) => e.name === 'ask', { filter: { category: 'keybind' }, timeout: 10_000 })
    // The host chooser surface is shown, listing the tied commands.
    await expect(page.locator('.au-chooser-card')).toBeVisible()
    await expect(page.getByText('Run which command?')).toBeVisible()

    await page.keyboard.press('Escape')
  })
})
