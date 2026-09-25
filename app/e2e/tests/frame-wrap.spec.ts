// Behaviour: a frame container (sandwich, dock) is a wrap target for ONE child and never for two.
//
// 1. A solo wrap offers the Frame family: wrapping a bare root editor in a sandwich puts the editor in the
//    sandwich's `center`, and the empty sides materialize placeholder occupants (persisted records).
// 2. A two-child wrap never offers a frame: opening a file into an OCCUPIED pane asks for a shared layout,
//    and that choice lists Stack/Arrange containers only.
import { test, expect } from '../fixtures/app'

type PoolRecord = Record<string, unknown>
interface Composition { windows?: unknown[]; projections?: PoolRecord[] }

const readComposition = (page: import('@playwright/test').Page): Promise<Composition> =>
  page.evaluate(() => (globalThis as unknown as { __auComposition: () => unknown }).__auComposition() as Composition)

const bare = (type: unknown): string => String(type ?? '').split('::')[0]!

/** A field's occupant record: a `[[^^id]]` pool reference, or an inline record. */
function occupant(c: Composition, value: unknown): PoolRecord | undefined {
  if (value && typeof value === 'object') return value as PoolRecord
  const id = /^\[\[\^\^([^\]]+)\]\]$/.exec(String(value ?? ''))?.[1]
  return id === undefined ? undefined : (c.projections ?? []).find((r) => r['^'] === id)
}

test.describe('a solo wrap offers a frame', () => {
  test.use({ composition: 'bare-editor' })

  test('wrapping the root editor in a sandwich fills its center; the sides hold placeholders', async ({ page, events }) => {
    await expect(page.locator('.cm-content').first()).toBeVisible()
    await page.getByRole('button', { name: 'Root actions' }).click()
    await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
    await page.getByRole('menuitem', { name: /^Sandwich( [a-z])?$/ }).click()

    await expect(page.locator('[data-container-kind="sandwich"]').first()).toBeVisible()
    await expect(page.locator('.cm-content').first()).toBeVisible()

    const composition = await readComposition(page)
    const sandwich = (composition.projections ?? []).find((r) => bare(r.type) === 'sandwich')
    expect(sandwich, 'the wrap created a sandwich record').toBeDefined()
    expect(bare(occupant(composition, sandwich!.center)?.type), 'the wrapped editor is the center').toBe('editor-pane')
    for (const side of ['left', 'right']) {
      expect(bare(occupant(composition, sandwich![side])?.type), `the ${side} side holds a placeholder`).toBe('placeholder-picker')
    }

    const errors = (await events.conditions()).filter((c) => c.severity === 'error')
    expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
  })
})

test.describe('a two-child wrap never offers a frame', () => {
  test.use({ composition: 'open-beside-occupied' }) // sandwich: file-tree | backlinks | hello, every region occupied

  test('opening a file into an occupied pane offers Stack and Arrange layouts, no Frame', async ({ page }) => {
    await page.locator('au-tree-row').first().waitFor({ timeout: 30_000 })
    await page.locator('au-tree-row[data-path$="/sample.md"]').first().click()

    const card = page.locator('.au-chooser-card')
    await card.getByRole('menuitem', { name: /^Choose a pane…( [a-z])?$/ }).click()

    // Every target is occupied: the file joins the leftmost (the file-tree) in a shared layout of two children.
    const targets = page.locator('au-pane-target')
    await targets.first().waitFor({ timeout: 10_000 })
    let leftmost = 0
    let minX = Infinity
    for (let i = 0; i < (await targets.count()); i++) {
      const box = await targets.nth(i).boundingBox()
      if (box && box.x < minX) { minX = box.x; leftmost = i }
    }
    await targets.nth(leftmost).click()

    const menu = page.getByRole('menu', { name: 'Keep both files — choose a layout' })
    await expect(menu.getByRole('menuitem', { name: /^Tabs( [a-z])?$/i })).toHaveCount(1)
    await expect(menu.getByRole('menuitem', { name: /^Bento( [a-z])?$/i })).toHaveCount(1)
    await expect(menu.getByText('Stack', { exact: true })).toBeVisible()
    await expect(menu.getByText('Arrange', { exact: true })).toBeVisible()
    await expect(menu.getByText('Frame', { exact: true }), 'no Frame section for two children').toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: /^(Sandwich|Dock)( [a-z])?$/i }), 'no frame for two children').toHaveCount(0)
  })
})
