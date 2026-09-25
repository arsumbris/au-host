// Folder Move / Rename / Delete in the file tree. Each is one engine saga, previewed first: a move or rename
// lists the referrers whose path links it rewrites (a bare `[[name]]` keeps working and is not listed), a
// delete lists the files whose links it breaks, and a refused preview is reported instead of confirmed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-dock' })

type Page = import('@playwright/test').Page
const row = (page: Page, suffix: string) => page.locator(`au-tree-row[data-path$="${suffix}"]`).first()

async function openFixture(page: Page): Promise<void> {
  await row(page, '/fixtures').click()
  await row(page, '/fixtures/folder-ops').click()
  await expect(row(page, '/fixtures/folder-ops/src')).toBeVisible()
}

async function folderMenu(page: Page, suffix: string, item: string): Promise<void> {
  await row(page, suffix).click({ button: 'right' })
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

const at = (vault: string, rel: string) => join(vault, 'fixtures/folder-ops', rel)

test('Move… on a folder lists the rewritten referrer, then moves it and rewrites only the path link', async ({ page, electronApp, vault }) => {
  await openFixture(page)
  await electronApp.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
  }, at(vault, 'dest'))
  // Open `src`, so the move can show its open state follows it.
  await row(page, '/fixtures/folder-ops/src').click()
  await expect(row(page, '/fixtures/folder-ops/src/note.md')).toBeVisible()
  await folderMenu(page, '/fixtures/folder-ops/src', 'Move…')

  const card = page.locator('.au-confirm-card')
  await expect(card).toContainText('1 file(s) link into it by path, and those links will be rewritten')
  await expect(card.getByRole('button', { name: 'by-path.md by path' })).toBeVisible()
  await expect(card.getByRole('button', { name: /by-name\.md/ })).toHaveCount(0)
  await card.getByRole('button', { name: 'Move' }).click()

  await expect.poll(() => existsSync(at(vault, 'dest/src/note.md')), { timeout: 15_000 }).toBe(true)
  expect(existsSync(at(vault, 'src'))).toBe(false)
  expect(readFileSync(at(vault, 'by-path.md'), 'utf8')).toContain('[[fixtures/folder-ops/dest/src/note]]')
  expect(readFileSync(at(vault, 'by-name.md'), 'utf8')).toContain('[[note]]')
  // The moved folder is still open at its new place: opening `dest` shows `src`'s contents at once.
  await row(page, '/fixtures/folder-ops/dest').click()
  await expect(row(page, '/fixtures/folder-ops/dest/src/note.md')).toBeVisible()
})

test('Rename… on a folder lists the rewritten referrer before the name is chosen, then renames it', async ({ page, vault }) => {
  await openFixture(page)
  await folderMenu(page, '/fixtures/folder-ops/src', 'Rename…')

  const card = page.locator('.au-confirm-card')
  await expect(card).toContainText('rewrites 1 file(s) that link into it by path')
  await expect(card.getByRole('button', { name: 'by-path.md by path' })).toBeVisible()
  await card.getByRole('textbox').fill('lib')
  await card.getByRole('button', { name: 'Rename' }).click()

  await expect.poll(() => existsSync(at(vault, 'lib/note.md')), { timeout: 15_000 }).toBe(true)
  expect(readFileSync(at(vault, 'by-path.md'), 'utf8')).toContain('[[fixtures/folder-ops/lib/note]]')
})

test('a file inside the folder that path-links a sibling is listed where it is now, never at a destination', async ({ page, vault }) => {
  writeFileSync(at(vault, 'src/inner.md'), '# inner\n\nSee [[fixtures/folder-ops/src/note]].\n')
  await openFixture(page)
  await folderMenu(page, '/fixtures/folder-ops/src', 'Rename…')
  const card = page.locator('.au-confirm-card')
  await expect(card.getByRole('button', { name: 'inner.md by path' })).toBeVisible()
  await expect(card.locator(`[title="${at(vault, 'src/inner.md')}"]`)).toHaveCount(1)
  // Nothing the dialog shows is a path that does not exist yet.
  const titles = await card.locator('[title]').evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''))
  expect(titles.filter((t) => t.includes('rename-preview'))).toEqual([])
  await card.getByRole('button', { name: 'Cancel' }).click()
})

test('an unusable folder name is reported, and nothing is renamed', async ({ page, vault }) => {
  await openFixture(page)
  await folderMenu(page, '/fixtures/folder-ops/src', 'Rename…')
  const card = page.locator('.au-confirm-card')
  await card.getByRole('textbox').fill('..')
  await card.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByText(/Cannot rename “src”: “\.\.” is not a usable name/)).toBeVisible({ timeout: 15_000 })
  expect(existsSync(at(vault, 'src/note.md'))).toBe(true)
})

test('Delete… on a folder lists every file whose link it breaks, then deletes it', async ({ page, vault }) => {
  await openFixture(page)
  await folderMenu(page, '/fixtures/folder-ops/src', 'Delete…')

  const card = page.locator('.au-confirm-card')
  await expect(card).toContainText('will BREAK the links in 2 file(s)')
  await expect(card.getByRole('button', { name: /by-path\.md/ })).toBeVisible()
  await expect(card.getByRole('button', { name: /by-name\.md/ })).toBeVisible()
  await card.getByRole('button', { name: 'Delete' }).click()

  await expect.poll(() => existsSync(at(vault, 'src')), { timeout: 15_000 }).toBe(false)
  expect(readFileSync(at(vault, 'by-path.md'), 'utf8')).toContain('[[fixtures/folder-ops/src/note]]')
})

test('a folder the engine refuses to delete is reported, and no confirm is offered', async ({ page, vault }) => {
  // Content the engine does not catalogue: a `node_modules` inside the folder.
  mkdirSync(at(vault, 'src/node_modules'), { recursive: true })
  writeFileSync(at(vault, 'src/node_modules/x.js'), '')
  await openFixture(page)
  await folderMenu(page, '/fixtures/folder-ops/src', 'Delete…')

  await expect(page.getByText(/Cannot delete “src”/)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.au-confirm-card')).toHaveCount(0)
  expect(existsSync(at(vault, 'src/note.md'))).toBe(true)
})

test('dragging a folder onto another folder moves it through the same preview', async ({ page, vault }) => {
  await openFixture(page)
  const from = await row(page, '/fixtures/folder-ops/src').boundingBox()
  const to = await row(page, '/fixtures/folder-ops/other').boundingBox()
  if (!from || !to) throw new Error('rows not laid out')
  await page.mouse.move(from.x + 20, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 3 })
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()

  const card = page.locator('.au-confirm-card')
  await expect(card).toContainText('Move “src” into')
  await card.getByRole('button', { name: 'Move' }).click()
  await expect.poll(() => existsSync(at(vault, 'other/src/note.md')), { timeout: 15_000 }).toBe(true)
})

test('a folder offers no Move over itself, its own contents, or its own parent', async ({ page, vault }) => {
  mkdirSync(at(vault, 'src/sub'), { recursive: true })
  writeFileSync(at(vault, 'src/sub/deep.md'), 'deep\n')
  await openFixture(page)
  await row(page, '/fixtures/folder-ops/src').click()
  await expect(row(page, '/fixtures/folder-ops/src/sub')).toBeVisible()
  const action = page.locator('.au-content-drag-preview__action')
  const hover = async (suffix: string): Promise<void> => {
    const box = await row(page, suffix).boundingBox()
    if (!box) throw new Error(`${suffix} not laid out`)
    await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 8 })
  }
  const from = await row(page, '/fixtures/folder-ops/src').boundingBox()
  if (!from) throw new Error('src not laid out')
  await page.mouse.move(from.x + 20, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 3 })
  // The control: a real destination offers Move, so the label is live.
  await hover('/fixtures/folder-ops/other')
  await expect(action).toHaveText('Move')
  for (const target of ['/fixtures/folder-ops/src/sub', '/fixtures/folder-ops', '/fixtures/folder-ops/src']) {
    await hover(target)
    await expect(action, `no Move over ${target}`).not.toHaveText('Move')
  }
  await page.mouse.up()
  await page.waitForTimeout(500)
  await expect(page.locator('.au-confirm-card')).toHaveCount(0)
  expect(existsSync(at(vault, 'src/sub/deep.md'))).toBe(true)
})

test('a folder dropped on a pane opens nothing and offers no drop zone there', async ({ page, events }) => {
  await openFixture(page)
  const from = await row(page, '/fixtures/folder-ops/src').boundingBox()
  const pane = await page.locator('.cm-content').first().boundingBox()
  if (!from || !pane) throw new Error('not laid out')
  // A drop that minted a pane would add one; nothing may be mounted by a folder drop.
  const panesBefore = await page.locator('[data-pane-id]').count()
  await page.mouse.move(from.x + 20, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 3 })
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  expect(await page.locator('[data-pane-id]').count()).toBe(panesBefore)
  // No pane zone was offered, so the host never tried (and failed) to resolve a folder to a viewer.
  const unresolved = (await events.conditions()).filter((c) => c.name === 'selection-drop-unresolved')
  expect(unresolved).toHaveLength(0)
})

test('in a FLOATED window, Rename… on a folder previews and renames it', async ({ page, electronApp, vault }) => {
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.locator('au-tree-row').first().waitFor({ timeout: 30_000 })
  await openFixture(floated)
  await folderMenu(floated, '/fixtures/folder-ops/src', 'Rename…')

  const card = floated.locator('.au-confirm-card')
  await expect(card).toContainText('rewrites 1 file(s) that link into it by path')
  await card.getByRole('textbox').fill('lib')
  await card.getByRole('button', { name: 'Rename' }).click()
  await expect.poll(() => existsSync(at(vault, 'lib/note.md')), { timeout: 15_000 }).toBe(true)
})

// A file or folder sitting directly in the member's root, dragged onto a sibling folder: the folder row
// accepts, while the member group around it refuses (the item is already there). The row's accept must
// stand, so the drop opens the Move card instead of silently doing nothing.
for (const [label, suffix, moved] of [
  ['a file', '/other.md', 'fixtures/other.md'],
  ['a folder', '/nested', 'fixtures/nested'],
] as const) {
  test(`dragging ${label} from the member root onto a sibling folder moves it through the preview`, async ({ page, vault }) => {
    const from = await row(page, suffix).boundingBox()
    const to = await row(page, '/fixtures').boundingBox()
    if (!from || !to) throw new Error('rows not laid out')
    await page.mouse.move(from.x + 20, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 3 })
    await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()

    const card = page.locator('.au-confirm-card')
    await expect(card).toContainText(`Move “${suffix.slice(1)}” into`)
    await card.getByRole('button', { name: 'Move' }).click()
    await expect.poll(() => existsSync(join(vault, moved)), { timeout: 15_000 }).toBe(true)
  })
}
