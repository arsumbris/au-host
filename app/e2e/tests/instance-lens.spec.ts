// The editor's "N instances" lens above a `type:` claim counts the type the claim NAMES, the identity the
// engine resolved it to: a qualified claim names its owner's type, a bare claim the type owned by the
// file's own repo. Counts are file instances, so each fixture asserts a real number, never the 0 a missed
// join produced. The segment's peek lists the same identity, so peek and count agree.
import { test, expect } from '../fixtures/app'

const lens = (page: import('@playwright/test').Page, type: string) =>
  page.locator('.au-inline-references-inst span').filter({ hasText: new RegExp(`^⊙ \\d+ ${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })

test.describe('a qualified claim', () => {
  test.use({ composition: 'instance-lens-qualified' })
  test('counts the peer type it names', async ({ page }) => {
    const segment = lens(page, 'composition::au-host-sdk')
    await expect(segment).toBeVisible({ timeout: 15_000 })
    await expect(segment).toHaveAttribute('data-inst-type', 'composition::au-host-sdk')
    const count = Number((await segment.textContent())!.match(/⊙ (\d+)/)![1])
    // Every fixture composition in the vault is a file instance of composition::au-host-sdk.
    expect(count).toBeGreaterThan(10)
  })
})

test.describe('a bare claim', () => {
  test.use({ composition: 'instance-lens-bare' })
  test("counts the type owned by the file's own repo", async ({ page }) => {
    const segment = lens(page, 'lens-sample')
    await expect(segment).toHaveText('⊙ 2 lens-sample', { timeout: 15_000 })
    // The peek queries the resolved identity, qualified by its owner, and lists exactly the counted files.
    await expect(segment).toHaveAttribute('data-inst-type', /^lens-sample::[A-Za-z][\w-]*$/)
    await segment.click()
    await expect(page.getByText('2 instances', { exact: true })).toBeVisible()
  })
})
