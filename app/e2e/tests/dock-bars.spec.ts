// Behaviour: a dock holds bars and manages them through its own menu.
//
// 1. A dock with no bars reserves a bottom strip whose ⋯ adds a bar to an edge; the strip then goes.
// 2. A bar's right-click carries dock's rows (through `host.containerActions`): "Move bar to" keeps the
//    bar's identity on the new edge, "Remove bar" reaps it and the strip returns.
// 3. A bar offers the discovered bar items not yet placed; adding one writes an INLINE item record.
// Every step asserts the composition RECORD, not only the DOM.
import { test, expect, floatedWindow } from '../fixtures/app'
import type { Page } from '@playwright/test'

type PoolRecord = Record<string, unknown>
interface Composition { projections?: PoolRecord[] }

const readComposition = (page: Page): Promise<Composition> =>
  page.evaluate(() => (globalThis as unknown as { __auComposition: () => unknown }).__auComposition() as Composition)

const bare = (type: unknown): string => String(type ?? '').split('::')[0]!
const refId = (value: unknown): string | undefined => /^\[\[\^\^([^\]]+)\]\]$/.exec(String(value ?? ''))?.[1]
const dockOf = (c: Composition): PoolRecord => (c.projections ?? []).find((r) => bare(r.type) === 'dock')!
const barsOn = (c: Composition, edge: string): string[] => ((dockOf(c)[edge] as unknown[] | undefined) ?? []).map(refId).filter((x): x is string => !!x)
const record = (c: Composition, id: string): PoolRecord | undefined => (c.projections ?? []).find((r) => r['^'] === id)
const menuItem = (page: Page, name: string) => page.getByRole('menuitem', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( [a-z])?$`) })

test.describe('an empty dock', () => {
  test.use({ composition: 'dock-empty' })

  test('reserves a bottom strip whose menu adds a bar to an edge', async ({ page, events }) => {
    const strip = page.locator('.au-dock-strip')
    await expect(strip).toBeVisible()
    await strip.getByRole('button', { name: 'Dock bars' }).click()
    await menuItem(page, 'Add bar').click()
    await menuItem(page, 'Bottom').click()

    await expect(page.locator('.au-bar')).toBeVisible()
    await expect(strip).toHaveCount(0)
    const c = await readComposition(page)
    const [barId] = barsOn(c, 'bottom')
    expect(barId, 'the dock record gained a bar on its bottom edge').toBeDefined()
    expect(bare(record(c, barId!)?.type), 'the new position holds a bar record').toBe('bar')

    const errors = (await events.conditions()).filter((x) => x.severity === 'error')
    expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
  })
})

test.describe('a docked bar', () => {
  test.use({ composition: 'status-frame' }) // dock: editor centre, one bar on the bottom holding the engine status item

  test('its right-click moves it to another edge with the same identity, then removes it', async ({ page }) => {
    const before = await readComposition(page)
    const [barId] = barsOn(before, 'bottom')
    expect(barId).toBeDefined()

    await page.locator('.au-bar').click({ button: 'right' })
    await menuItem(page, 'Move bar to').click()
    await menuItem(page, 'Left').click()
    await expect.poll(async () => barsOn(await readComposition(page), 'left')).toEqual([barId])
    // The emptied edge is an explicit `[]`, never an omitted field: one state, one record shape.
    expect(dockOf(await readComposition(page)).bottom, 'the emptied bottom edge').toEqual([])
    await expect(page.locator('.au-bar.vertical'), 'on a side edge the bar lays out vertically').toBeVisible()

    await page.locator('.au-bar').click({ button: 'right' })
    await menuItem(page, 'Remove bar').click()
    await expect.poll(async () => record(await readComposition(page), barId!)).toBeUndefined()
    await expect(page.locator('.au-dock-strip')).toBeVisible()
    const dock = dockOf(await readComposition(page))
    for (const edge of ['top', 'bottom', 'left', 'right']) expect(dock[edge], `edge ${edge} after the last bar left`).toEqual([])
  })

  test('it adds a discovered item as an inline record', async ({ page }) => {
    const [barId] = barsOn(await readComposition(page), 'bottom')
    await page.locator('.au-bar').click({ button: 'right' })
    await menuItem(page, '+ Notifications').click()
    await expect
      .poll(async () => ((record(await readComposition(page), barId!)?.end as PoolRecord[] | undefined) ?? []).map((i) => bare(i.type)))
      .toEqual(['engine-status-bar-item', 'notification-bar-item'])
    // The added record claims its type owner-qualified, like the authored one, so it validates from the
    // composition's own repo.
    const end = (record(await readComposition(page), barId!)?.end as PoolRecord[] | undefined) ?? []
    expect(end.map((i) => i.type)).toEqual(['engine-status-bar-item::engine-status', 'notification-bar-item::notifications'])
  })
})

test.describe('a docked bar in a floated window', () => {
  test.use({ composition: 'dock-floatable' }) // column → dock (editor centre, one bottom bar)

  test('its right-click carries dock\'s rows there too, and a move lands in the record', async ({ page, electronApp }) => {
    const [barId] = barsOn(await readComposition(page), 'bottom')
    expect(barId).toBeDefined()
    await page.locator('[data-container-kind="column"]').getByRole('button', { name: 'Pane actions' }).first().click()
    const [floated] = await Promise.all([
      floatedWindow(electronApp),
      page.getByRole('menuitem', { name: 'Open in a new window', exact: true }).click(),
    ])
    await floated.locator('.au-bar').waitFor({ timeout: 30_000 })
    await floated.locator('.au-bar').click({ button: 'right' })
    await menuItem(floated, 'Move bar to').click()
    await menuItem(floated, 'Top').click()
    await expect.poll(async () => barsOn(await readComposition(page), 'top')).toEqual([barId])
    await expect(floated.locator('.au-bar').first()).toBeVisible()
  })
})
