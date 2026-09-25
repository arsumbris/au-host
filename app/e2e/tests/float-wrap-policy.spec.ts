// A floated window wraps with the SAME policy and the SAME labels as the main window. The composition's
// `group-into` is authority-owned and mirrored down to each surface; each wrap target carries its own label,
// so the floated picker never shows a bare type name. Driven from the FLOATED window.
import { test, expect, floatedWindow } from '../fixtures/app'
import type { ElectronApplication, Page } from '@playwright/test'

async function floatTheTabs(page: Page, electronApp: ElectronApplication): Promise<Page> {
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  return floated
}

test.describe('with a composition group-into', () => {
  test.use({ composition: 'float-grouped' })

  test('the floated root wrap uses it silently', async ({ page, electronApp, events }) => {
    const floated = await floatTheTabs(page, electronApp)
    await events.clear()
    await floated.getByRole('button', { name: 'Root actions' }).click()
    await floated.getByRole('menuitem', { name: 'Wrap in a container' }).click()

    const wrapEv = await events.waitFor((e) => e.category === 'placement' && e.name === 'wrap-root', { timeout: 15_000 })
    expect(wrapEv.fields?.outcome).toBe('wrapped')
    expect(String(wrapEv.fields?.kind).split('::')[0], 'the composition group-into, not a pick').toBe('column')
    await expect(floated.locator('.au-chooser-card')).toHaveCount(0)
  })
})

test.describe('without one', () => {
  test.use({ composition: 'float-reorder' })

  test('the floated picker shows container labels, not type names', async ({ page, electronApp, events }) => {
    const floated = await floatTheTabs(page, electronApp)
    await events.clear()
    await floated.getByRole('button', { name: 'Root actions' }).click()
    await floated.getByRole('menuitem', { name: 'Wrap in a container' }).click()
    const open = await events.waitFor((e) => e.category === 'chooser' && e.name === 'open', { timeout: 15_000 })
    const labels = (open.fields?.options as string[] | undefined) ?? []
    expect(labels).toContain('Tabs')
    expect(labels).toContain('Column')
    expect(labels.some((l) => /^[a-z]/.test(l)), `labels: ${labels.join(', ')}`).toBe(false)
  })
})
