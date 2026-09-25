// A file move previews its reference impact from the engine: of the files that reference the target, only
// the ones whose link the move REWRITES (a path-bearing link) are marked "by path"; a bare `[[name]]` keeps
// working unchanged and is marked "by name". Committing the move rewrites exactly the path-bearing link.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/app'

test.use({ composition: 'float-dock' })

const row = (page: import('@playwright/test').Page, suffix: string) => page.locator(`au-tree-row[data-path$="${suffix}"]`).first()

test('a file move marks only the rewritten referrer, then rewrites exactly that link', async ({ page, electronApp, vault }) => {
  await row(page, '/fixtures').click()
  await row(page, '/fixtures/move').click()
  await expect(row(page, '/fixtures/move/move-me.md')).toBeVisible()

  // The destination the native folder picker would return.
  const dest = join(vault, 'fixtures/move/dest')
  await electronApp.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
  }, dest)

  await row(page, '/fixtures/move/move-me.md').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move…' }).click()

  const card = page.locator('.au-confirm-card')
  await expect(card).toContainText('2 file(s) reference it, 1 will be rewritten')
  await expect(card.getByRole('button', { name: 'by-path.md by path' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'by-name.md by name' })).toBeVisible()

  await card.getByRole('button', { name: 'Move' }).click()
  await expect.poll(() => existsSync(join(vault, 'fixtures/move/dest/move-me.md')), { timeout: 15_000 }).toBe(true)
  expect(existsSync(join(vault, 'fixtures/move/move-me.md'))).toBe(false)

  const byPath = readFileSync(join(vault, 'fixtures/move/by-path.md'), 'utf8')
  const byName = readFileSync(join(vault, 'fixtures/move/by-name.md'), 'utf8')
  expect(byPath).toContain('[[fixtures/move/dest/move-me]]')
  expect(byName).toContain('[[move-me]]')
})
