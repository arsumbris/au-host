// KEYBINDS — the keymap-editor projection over the host.keymaps capability. Asserts it MOUNTS
// (registers + renders, no crash), READS the composition's active keymap + its keybinds, and that Remove
// drives host.keymaps.remove end to end (the active keymap moves to Available). This exercises the app-owned
// KeymapsControl capability through a real projection.

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
  await page.screenshot({path:'/private/tmp/au-keymap-recording-after.png'})
  await page.getByRole('button', {name:'Cancel', exact:true}).click()
  await expect(page.locator('au-chord-input')).toHaveCount(0)

  // Remove the active keymap → host.keymaps.remove → it leaves "Active" and appears under "Available".
  await page.getByRole('button', { name: 'Remove' }).first().click()
  await expect(page.getByRole('heading', { name: 'Available keymaps' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add' }).first()).toBeVisible()
  // Re-add it → back to Active.
  await page.getByRole('button', { name: 'Add' }).first().click()
  await expect(page.getByRole('button', { name: 'Remove' }).first()).toBeVisible()
  await page.screenshot({path:'/private/tmp/au-keymap-editor-after.png'})
})

test('keymap file import validates and activates a workspace copy', async ({page}) => {
  const {readFileSync, unlinkSync, existsSync} = await import('node:fs')
  const {join} = await import('node:path')
  const {VAULT} = await import('../support/paths')
  const target = join(VAULT, 'e2e-import-review.keymap.yaml')
  expect(existsSync(target)).toBe(false)
  try {
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
  } finally { if(existsSync(target)) unlinkSync(target) }
})

test('add shortcut records a new binding while preserving the keymap', async ({page}) => {
  const {readFileSync,writeFileSync} = await import('node:fs')
  const {join} = await import('node:path')
  const {VAULT} = await import('../support/paths')
  const file = join(VAULT,'e2e-default.keymap.yaml')
  const before=readFileSync(file,'utf8')
  try {
    await page.getByRole('button',{name:'Add shortcut…',exact:true}).click()
    await page.getByRole('button',{name:'Command',exact:true}).click()
    await page.getByRole('option').filter({hasText:'Unassigned'}).first().click()
    const capture=page.locator('au-chord-input[aria-label="Shortcut for new command"]')
    await capture.click()
    await capture.press('Control+Alt+Shift+9')
    await page.getByRole('button',{name:'Add binding',exact:true}).click()
    await expect(page.getByRole('status')).toContainText('Shortcut saved')
    const after=readFileSync(file,'utf8')
    expect(after).toContain('# E2E keymap fixture')
    expect((after.match(/intent:/g)||[]).length).toBe((before.match(/intent:/g)||[]).length+1)
  } finally {writeFileSync(file,before)}
})
