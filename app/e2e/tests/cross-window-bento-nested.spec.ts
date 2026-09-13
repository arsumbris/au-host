// A pane nested inside bento can float through its pane-actions menu. The menu supplies the
// occupant's pool ID, which must resolve to the container position before extraction.
// Assert that a new window opens and contains the pane.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'bento-nested' }) // sandwich → { left: bento → editor, center: file-tree }

// The bento LEAF's ⋯ is the one whose menu carries bento's own "Split right" (the sandwich REGION's ⋯ does
// not) — that is how we pick the nested-pane menu among the several "Pane actions" buttons. Returns with the
// menu OPEN on the bento leaf.
async function openBentoLeafMenu(page: import('@playwright/test').Page): Promise<void> {
  const buttons = page.getByRole('button', { name: 'Pane actions' })
  await expect.poll(() => buttons.count(), { timeout: 15_000 }).toBeGreaterThan(0)
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    await buttons.nth(i).click()
    if (await page.getByRole('menuitem', { name: 'Split right' }).isVisible().catch(() => false)) return
    await page.keyboard.press('Escape') // not the bento leaf; close and try the next
  }
  throw new Error('no bento-leaf ⋯ menu found (none offered "Split right")')
}

test('float a NESTED bento child into a new window via the ⋯ menu', async ({ page, electronApp, events }) => {
  await page.waitForSelector('.cm-content', { timeout: 30_000 })

  await openBentoLeafMenu(page)
  const [win] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])

  // THE PROOF: a new window opened AND holds the editor (its identity/content survived the extract).
  await win.waitForSelector('.cm-content', { timeout: 30_000 })
  await expect(win.locator('.cm-content').first()).toContainText('Sample content', { timeout: 15_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(2) // main + floated

  // No standing error (a silent extract-null / reap would surface as an error condition).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
