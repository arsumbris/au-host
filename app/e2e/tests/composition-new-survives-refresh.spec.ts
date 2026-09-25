// A NEW composition has no file yet, and it stays mounted across a type-graph change. Discovery re-runs the
// startup auto-mount on every type-graph change; that auto-mount only fills a window with NOTHING mounted, so
// an unsaved new composition is never replaced by the most recent saved one. Main-window behaviour.
import { test, expect } from '../fixtures/app'
import { writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'

test.use({ composition: 'bare-editor' })

test('a type-graph change does not replace an unsaved new composition with the recent saved one', async ({ page, vault }) => {
  // Start from a saved composition (bare-editor, a single editor), so it is the most recent one.
  await page.waitForSelector('.cm-content', { timeout: 30_000 })

  await page.getByRole('button', { name: /^Compositions/ }).click()
  await page.locator('.composition-popover').waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const picker = page.locator('[data-pane-picker]')
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.cm-content')).toHaveCount(0)

  // A type-graph change: a new projection type-def. The picker listing it proves discovery re-ran.
  const typeFile = join(dirname(vault), 'hello/type/new-composition-refresh.type.yaml')
  try {
    await writeFile(typeFile, `extends: pane-projection::au-host-sdk\nfields: {}\nmeta:\n  - type: projection-runtime-meta::au-host-sdk\n    entry: ./dist/index.js\n    contractVersion: 8\n  - type: projection-presentation-meta::au-host-sdk\n    title: New Composition Refresh\n`)
    await picker.getByRole('combobox').fill('New Composition Refresh')
    await expect(picker.getByRole('option', { name: /New Composition Refresh/ })).toBeVisible({ timeout: 20_000 })

    // The auto-mount ran in the same discovery pass. Give its async reads time to land, then the new
    // composition must still be the one on screen.
    await page.waitForTimeout(3000)
    await expect(picker).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveCount(0)
  } finally { await rm(typeFile, { force: true }) }
})
