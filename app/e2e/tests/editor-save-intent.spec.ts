// A focused editor handles save-intent before the host's composition handler. ⌘S follows the active
// keymap and saves that editor's file through its guarded write path. Assert the file save and retain
// the composition fallback when no editor claims the intent.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'editor-save' })

test('⌘S with an editor open is claimed by the editor, not the host composition save', async ({ page, events }) => {
  // The editor mounted and opened sample.md (currentPath set → it can claim save-intent). It is NOT focus-
  // ranked (no container reports it), so this exercises the FALLBACK-ORDERING fix, not focus-MRU.
  await expect(page.locator('.cm-content').first()).toBeVisible()
  await page.waitForTimeout(700) // let the file open + the async keymap read settle

  await events.clear()
  await page.keyboard.press('ControlOrMeta+s')

  // save-intent fired and was CLAIMED by the editor (a mount node), NOT by host:commands. The host command
  // node is the ambient FALLBACK, ordered last, so a real mount-tree handler claims ahead of it even without
  // focus — a focused editor claims the save before the host composition handler.
  const claim = await events.waitFor(
    (e) => e.name === 'claim' && String(e.fields?.type).includes('save-intent'),
    { filter: { category: 'intent' }, timeout: 10_000 },
  )
  expect(claim.fields?.owner).not.toBe('host:commands')
  expect(claim.fields?.ownerLabel).toBe('editor-pane::editor')
})
