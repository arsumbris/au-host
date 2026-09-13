// Pane-level actions share one Pane actions overflow menu. The host context menu exposes swap,
// split, wrap, unwrap, and window actions through the same affordance used by the tab strip.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'pane-actions-menu' })

test('a bento pane header shows one ⋯ menu that opens the occupant actions', async ({ page, events }) => {
  // Two panes → exactly one "Pane actions" ⋯ button each (no inline glyph row).
  const menuButtons = page.getByRole('button', { name: 'Pane actions' })
  await expect(menuButtons).toHaveCount(2)

  // Open one pane's ⋯ menu: it carries the occupant-level actions as icon'd rows.
  await menuButtons.first().click()
  const menuitem = (name: string) => page.getByRole('menuitem', { name })
  await expect(menuitem('Swap pane')).toBeVisible()
  await expect(menuitem('Split right')).toBeVisible()
  await expect(menuitem('Split down')).toBeVisible()
  await expect(menuitem('Wrap in a container')).toBeVisible()
  await expect(menuitem('Open in a new window')).toBeVisible()

  // Each row carries its glyph.
  const icons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('au-menu-item')).map((m) => m.shadowRoot?.querySelector('au-icon')?.getAttribute('name') ?? null),
  )
  expect(icons).toEqual(expect.arrayContaining(['swap', 'split-right', 'split-down', 'wrap', 'pop-out']))

  // Firing one action from the menu works and raises no error: Split right adds a (new empty) leaf, so the
  // pane count — and thus the number of ⋯ menus — goes 2 → 3.
  await menuitem('Split right').click()
  await expect(menuButtons).toHaveCount(3)
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
