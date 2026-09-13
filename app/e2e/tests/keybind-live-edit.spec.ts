// Keymap edits reach the live dispatcher. Removing an active keymap disables its chord;
// rewriting a binding enables the new chord and disables the old one through the changes subscription.
// These tests assert dispatched intents in addition to the editor's displayed state.

import { test, expect, type HostEvent } from '../fixtures/app'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { VAULT } from '../support/paths'

/** A save-intent fire on the keybind path. */
const firedSave = (e: HostEvent): boolean => e.name === 'fire' && String(e.fields?.intent).includes('save-intent')

test.describe('a keymap-editor ACTIVE-LIST edit reaches the live dispatcher', () => {
  test.use({ composition: 'keymap-editor' })

  test('removing the active keymap stops its chord from firing', async ({ page, events }) => {
    await expect(page.locator('.au-kme')).toBeVisible()
    await page.waitForTimeout(500) // let the async keymap read settle

    // Baseline: the keymap is active, so ⌘S fires save-intent through the resolver.
    await events.clear()
    await page.keyboard.press('ControlOrMeta+s')
    await events.waitFor(firedSave, { filter: { category: 'keybind' }, timeout: 10_000 })

    // Remove it through the editor (host.keymaps.remove → pool.meta.keymaps, in-memory, no disk write).
    await page.getByRole('button', { name: 'Remove' }).first().click()
    await expect(page.getByRole('heading', { name: 'Available keymaps' })).toBeVisible()

    // Now ⌘S must NOT fire — the resolver reads the LIVE pool, which no longer lists the keymap. This is the
    // Removing a keymap updates the live resolver immediately.
    await events.clear()
    await page.keyboard.press('ControlOrMeta+s')
    await page.waitForTimeout(1200)
    const traces = await events.read({ category: 'keybind' })
    expect(traces.some(firedSave)).toBe(false)
  })
})

test.describe('an EXTERNAL keymap-file edit reaches the live dispatcher', () => {
  test.use({ composition: 'keybind-live-rebind' })

  const KEYMAP = join(VAULT, 'e2e-live-rebind.keymap.yaml')
  const withChord = (key: string): string =>
    `type: keymap::au-host-sdk\nkeybinds:\n  - chord:\n      - mods: [mod]\n        key: ${key}\n    intent: "[[save-intent::intent]]"\n`
  let original = ''
  test.beforeEach(() => { original = readFileSync(KEYMAP, 'utf8') })
  // Restore the fixture: the test edits the file on disk, so leave it as authored for the next run.
  test.afterEach(() => { writeFileSync(KEYMAP, original) })

  test('editing the keymap file rebinds ⌘S→⌘J live (new chord fires, old is dead)', async ({ page, events }) => {
    await expect(page.locator('.au-kme')).toBeVisible()
    await page.waitForTimeout(500)

    // Baseline: the file binds ⌘S, so ⌘S fires.
    await events.clear()
    await page.keyboard.press('ControlOrMeta+s')
    await events.waitFor(firedSave, { filter: { category: 'keybind' }, timeout: 10_000 })

    // Edit the keymap FILE on disk — an EXTERNAL edit (an agent, another tool, or the user's own editor).
    // The engine's FS watch fires `knowledge-base-changed`; the host's `changes`
    // subscription re-reads keymaps and the LIVE resolver picks up the new chord — with no remount and no
    // editor poke. (Rebinding through the editor UI writes via the engine, which the clean-at-HEAD gate
    // blocks for an uncommitted fixture and would commit for a committed one — an external write isolates
    // the runtime re-read under test.)
    writeFileSync(KEYMAP, withChord('j'))

    // The NEW chord ⌘J fires — poll it, since the FS-watch → rebuild → re-read is async and a keypress is
    // one-shot. Once ⌘J lands, the re-read is done.
    await expect
      .poll(async () => {
        await events.clear()
        await page.keyboard.press('ControlOrMeta+j')
        return (await events.read({ category: 'keybind' })).some(firedSave)
      }, { timeout: 15_000, intervals: [400, 400, 600] })
      .toBe(true)

    // And the OLD chord ⌘S is now dead — the edit replaced the binding, and the resolver reflects it.
    await events.clear()
    await page.keyboard.press('ControlOrMeta+s')
    await page.waitForTimeout(1200)
    expect((await events.read({ category: 'keybind' })).some(firedSave)).toBe(false)
  })
})
