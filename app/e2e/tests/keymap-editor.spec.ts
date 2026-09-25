// KEYBINDS — the keymap-editor projection over the host.keymaps capability. Asserts it MOUNTS
// (registers + renders, no crash), READS the composition's active keymap + its keybinds, and that Remove
// drives host.keymaps.remove end to end (the active keymap moves to Available). This exercises the app-owned
// KeymapsControl capability through a real projection.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '../fixtures/app'

test.use({ composition: 'keymap-editor' })

test('the keymap editor mounts, reads the active keymap, and Remove turns it off', async ({ page }) => {
  // Mounted: the editor pane rendered its shell (proves the projection registered + read host.keymaps).
  await expect(page.locator('.au-kme')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Active keymaps' })).toBeVisible()
  // The active keymap and its keybinds (save-intent / toggle-command-palette-intent) render.
  await expect(page.getByText('e2e-default.keymap').first()).toBeVisible()
  await expect(page.locator('.au-kme-bind__cmd').filter({hasText:'Save'}).first()).toBeVisible()
  // Its chord shows via <au-kbd> (formatted glyphs), and a rebind capture field is present.
  await expect(page.locator('.au-kme-bind au-kbd').first()).toBeVisible()
  const search = page.getByRole('textbox', {name:'Search shortcuts'})
  await search.fill('no-such-command')
  await expect(page.getByText('No shortcuts match that search.')).toBeVisible()
  await search.fill('')
  await page.getByRole('button', {name:/^Change /}).first().click()
  await expect(page.locator('.au-kme-bind au-chord-input').first()).toBeVisible()
  await expect(page.locator('au-chord-input')).not.toBeFocused()
  await expect(page.getByText('Click the field to record a shortcut')).toBeVisible()
  await page.locator('au-chord-input').click()
  await expect(page.locator('au-chord-input')).toBeFocused()
  await expect(page.getByText('Recording — press your shortcut. Esc stops recording.')).toBeVisible()
  await page.locator('.au-kme-edit').evaluate(async el => { await Promise.all(el.getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {}))) })
  await page.screenshot({path: join(tmpdir(), 'au-keymap-recording-after.png')})
  await page.getByRole('button', {name:'Cancel', exact:true}).click()
  await expect(page.locator('au-chord-input')).toHaveCount(0)

  // Remove the active keymap → host.keymaps.remove → it leaves "Active" and appears under "Available".
  await page.getByRole('button', { name: 'Remove' }).first().click()
  await expect(page.getByRole('heading', { name: 'Available keymaps' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add' }).first()).toBeVisible()
  // Re-add it → back to Active.
  await page.getByRole('button', { name: 'Add' }).first().click()
  await expect(page.getByRole('button', { name: 'Remove' }).first()).toBeVisible()
  await page.screenshot({path: join(tmpdir(), 'au-keymap-editor-after.png')})
})

test('keymap file import validates and activates a workspace copy', async ({page, vault}) => {
  const {readFileSync, existsSync} = await import('node:fs')
  const {join} = await import('node:path')
  const target = join(vault, 'e2e-import-review.keymap.yaml')
  expect(existsSync(target)).toBe(false)
  await page.locator('.au-kme').waitFor()
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({name:'invalid.yaml',mimeType:'text/yaml',buffer:Buffer.from('type: something-else\n')})
  await expect(page.getByRole('alert')).toContainText('Choose a valid keymap')
  const content = 'type: keymap::au-host-sdk\n# Keep this comment\nkeybinds:\n  - intent: "[[save-intent::intent]]"\n    chord: [{key: s, mods: [mod, shift]}]\n'
  await page.locator('input[type="file"]').setInputFiles({name:'e2e-import-review.keymap.yaml',mimeType:'text/yaml',buffer:Buffer.from(content)})
  await page.getByRole('button',{name:'Import and activate',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Imported e2e-import-review.keymap')
  expect(readFileSync(target,'utf8')).toBe(content)
  await expect(page.getByText('e2e-import-review.keymap',{exact:true})).toBeVisible()
})

test('add shortcut records a new binding while preserving the keymap', async ({page, vault}) => {
  const {readFileSync} = await import('node:fs')
  const {join} = await import('node:path')
  const file = join(vault,'e2e-default.keymap.yaml')
  const before=readFileSync(file,'utf8')
  await page.getByRole('button',{name:'Add shortcut…',exact:true}).click()
  await page.getByRole('button',{name:'Command',exact:true}).click()
  await page.getByRole('option').filter({hasText:'Unassigned'}).first().click()
  const capture=page.locator('au-chord-input[aria-label="Shortcut for new command"]')
  await capture.click()
  await capture.press('Control+Alt+Shift+9')
  await page.getByRole('button',{name:'Add binding',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Shortcut saved')
  const after=readFileSync(file,'utf8')
  // The rest of the keymap survives the edit, its authored comment included.
  expect(after).toContain(before.split('\n')[0])
  const {parse} = await import('yaml')
  const beforeBinds: {intent: string}[] = parse(before).keybinds
  const afterBinds: {intent: string}[] = parse(after).keybinds
  expect(afterBinds.slice(0, beforeBinds.length)).toEqual(beforeBinds)
  expect(afterBinds).toHaveLength(beforeBinds.length + 1)
  // The vault owns no intents, so the new binding names its intent's owning repo (a bare name would not resolve).
  expect(afterBinds.at(-1)!.intent).toMatch(/^\[\[[a-z0-9-]+::[a-z0-9-]+\]\]$/)
  // The engine committed the save into the vault's OWN repository (the e2e vault is never au-host's tree).
  const {execFileSync} = await import('node:child_process')
  const log = execFileSync('git', ['log', '--format=%s', '--', 'e2e-default.keymap.yaml'], {cwd: vault, encoding: 'utf8'})
  expect(log.split('\n').filter(Boolean).length, 'the engine commits the save in the per-test vault').toBe(2)
})

test.describe('a shared keymap', () => {
  test.use({ composition: 'keymap-editor-shared' })
  test('changing a shortcut copies it into the workspace with its references rewritten, then edits the copy', async ({ page, vault }) => {
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { parse } = await import('yaml')
    const copy = join(vault, 'shared-local.keymap.yaml')
    expect(existsSync(copy)).toBe(false)
    await expect(page.getByText('Shared · copies on edit').first()).toBeVisible()
    await page.getByRole('button', { name: /^Change / }).first().click()
    const capture = page.locator('.au-kme-bind au-chord-input').first()
    await capture.click()
    await capture.press('Control+Alt+Shift+8')
    await page.getByRole('button', { name: 'Save shortcut', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Shortcut saved')
    // The shipped keymap names its own repo's intent bare. In the vault a bare name would resolve in the
    // vault, so the copy names the owner; the third repo's qualifier is kept.
    const written = parse(readFileSync(copy, 'utf8'))
    expect(written.type).toBe('keymap::au-host-sdk')
    expect(written.keybinds.map((b: { intent: string }) => b.intent)).toEqual([
      '[[e2e-shared-intent::e2e-shared]]',
      '[[save-intent::intent]]',
    ])
    // The edit landed in the copy, and the copy took the shipped keymap's place in the active list.
    expect(written.keybinds[0].chord).not.toEqual([{ mods: ['mod', 'alt'], key: 'j' }])
    await expect(page.getByText('shared-local.keymap', { exact: true }).first()).toBeVisible()
  })
})
