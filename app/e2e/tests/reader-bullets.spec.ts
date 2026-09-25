// Behaviour: the reader renders authored bullet grouping and hard line breaks as written.
//
// CommonMark would render `alpha/bravo/charlie <blank> delta/echo/foxtrot` as ONE loose list of six
// items (each wrapped in <p>, so the group break is lost and every item is padded). The reader's
// `remarkSplitBulletGroups` restores the author's reading: a blank line between bullets is a NEW list, so
// two TIGHT lists render with one line between them. And `remark-breaks` renders an authored single
// newline as a <br>, which CommonMark would fold to a space.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'reader-bullets' })

test('a blank line between bullets splits into two tight lists, and a newline is a hard break', async ({ page, events }) => {
  await expect(page.getByRole('heading', { name: 'Bullet groups', exact: true })).toBeVisible()

  // SPLIT: the six items are TWO sibling lists, not one, and each holds its own three items.
  const lists = page.locator('.au-md ul')
  await expect(lists).toHaveCount(2)
  await expect(lists.nth(0).locator('> li')).toHaveCount(3)
  await expect(lists.nth(1).locator('> li')).toHaveCount(3)
  await expect(lists.nth(0)).toContainText('alpha')
  await expect(lists.nth(1)).toContainText('delta')

  // TIGHT: a single-line bullet drops its <p> (a loose list would wrap every item), so no padding.
  await expect(page.locator('.au-md li p')).toHaveCount(0)

  // HARD BREAK: the two authored lines render as one paragraph split by a <br>, not joined by a space.
  const para = page.locator('.au-md p').filter({ hasText: 'Line one' })
  await expect(para).toHaveCount(1)
  await expect(para.locator('br')).toHaveCount(1)
  await expect(para).toContainText('line two')

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
