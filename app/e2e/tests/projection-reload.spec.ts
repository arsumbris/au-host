import { test, expect, floatedWindow } from '../fixtures/app'
import { writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { VAULT } from '../support/paths'

test.use({ composition: 'close-guard-floated', projectionDevelopment: true })

test('manual reload preserves a dirty main editor on veto, then replaces it on consent', async ({ page }) => {
  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.type('RELOAD UNSAVED')
  await content.evaluate(el => { el.setAttribute('data-reload-original', 'true') })
  await page.getByRole('button', { name: 'Pane actions', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Reload projection', exact: true }).click()
  const guard = page.locator('.au-chooser-card')
  await expect(guard).toContainText('unsaved changes')
  await guard.getByRole('menuitem', { name: 'Keep editing' }).click()
  await expect(content).toHaveAttribute('data-reload-original', 'true')
  await expect(content).toContainText('RELOAD UNSAVED')
  await page.getByRole('button', { name: 'Pane actions', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Reload projection', exact: true }).click()
  await guard.getByRole('menuitem', { name: 'Discard changes and close' }).click()
  await expect(page.locator('[data-reload-original]')).toHaveCount(0)
  await expect(content).toBeVisible()
  await expect(page.locator('au-tree-row').first()).toBeVisible()
})

test('floated root reload honors its local guard and recovers with the main sibling intact', async ({ page, electronApp }) => {
  await page.getByRole('button', { name: 'Pane actions', exact: true }).first().click()
  const [surface] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window', exact: true }).click(),
  ])
  const content = surface.locator('.cm-content').first()
  await content.click()
  await surface.keyboard.type('SURFACE RELOAD UNSAVED')
  await content.evaluate(el => { el.setAttribute('data-reload-original', 'true') })
  await surface.getByRole('button', { name: 'Root actions', exact: true }).click()
  await surface.getByRole('menuitem', { name: 'Reload projection', exact: true }).click()
  const guard = surface.locator('.au-chooser-card')
  await expect(guard).toContainText('unsaved changes')
  await guard.getByRole('menuitem', { name: 'Keep editing' }).click()
  await expect(content).toHaveAttribute('data-reload-original', 'true')
  await surface.getByRole('button', { name: 'Root actions', exact: true }).click()
  await surface.getByRole('menuitem', { name: 'Reload projection', exact: true }).click()
  await guard.getByRole('menuitem', { name: 'Discard changes and close' }).click()
  await expect(surface.locator('[data-reload-original]')).toHaveCount(0)
  await expect(content).toBeVisible()
  await expect(page.locator('au-tree-row').first()).toBeVisible()
  expect(electronApp.windows()).toHaveLength(2)
})

test.describe('host-owned terminal', () => {
  test.use({ composition: 'reload-terminal' })
  test('reattaches to the exact shell process after reloading its projection', async ({ page }) => {
    const input = page.getByRole('textbox', { name: 'Terminal input' })
    await input.fill("printf 'BEFORE_PID:%s\\n' \"$$\"")
    await input.press('Enter')
    const terminal = page.locator('.xterm')
    await expect(terminal).toContainText(/BEFORE_PID:\d+/)
    const pid = (await terminal.innerText()).match(/BEFORE_PID:(\d+)/)![1]
    await terminal.evaluate(el => el.setAttribute('data-reload-original', 'true'))
    await page.getByRole('button', { name: 'Pane actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Reload projection', exact: true }).click()
    await expect(page.locator('[data-reload-original]')).toHaveCount(0)
    await input.fill("printf 'AFTER_PID:%s\\n' \"$$\"")
    await input.press('Enter')
    await expect(terminal).toContainText(`AFTER_PID:${pid}`)
  })
})

test.describe('floated container', () => {
  test.use({ composition: 'bento-nested' })
  test('gathers descendant guards on root reload and can reload its nested leaf', async ({ page, electronApp }) => {
    await page.getByRole('button', { name: 'Pane actions', exact: true }).first().click()
    const [surface] = await Promise.all([
      floatedWindow(electronApp),
      page.getByRole('menuitem', { name: 'Open in a new window', exact: true }).click(),
    ])
    const content = surface.locator('.cm-content').first()
    await content.click()
    await surface.keyboard.type('NESTED UNSAVED')
    await content.evaluate(el => el.setAttribute('data-reload-original', 'true'))
    await surface.getByRole('button', { name: 'Root actions', exact: true }).click()
    await surface.getByRole('menuitem', { name: 'Reload projection', exact: true }).click()
    const guard = surface.locator('.au-chooser-card')
    await expect(guard).toContainText('unsaved changes')
    await guard.getByRole('menuitem', { name: 'Keep editing' }).click()
    await expect(content).toHaveAttribute('data-reload-original', 'true')
    await surface.getByRole('button', { name: 'Root actions', exact: true }).click()
    await surface.getByRole('menuitem', { name: 'Reload projection', exact: true }).click()
    await guard.getByRole('menuitem', { name: 'Discard changes and close' }).click()
    await expect(surface.locator('[data-reload-original]')).toHaveCount(0)
    await content.evaluate(el => el.setAttribute('data-reload-original', 'true'))
    await surface.getByRole('button', { name: 'Pane actions', exact: true }).first().click()
    await surface.getByRole('menuitem', { name: 'Reload projection', exact: true }).click()
    await expect(surface.locator('[data-reload-original]')).toHaveCount(0)
    await expect(content).toBeVisible()
    await expect(page.locator('au-tree-row').first()).toBeVisible()
  })
})

test.describe('live discovery', () => {
  test.use({ composition: 'reload-discovery' })
  for (const floated of [false, true]) {
    test(`an already-open ${floated ? 'floated' : 'main'} picker discovers a new type`, async ({ page, electronApp }) => {
      let target = page
      if (floated) {
        await page.getByRole('button', { name: 'Pane actions', exact: true }).first().click()
        ;[target] = await Promise.all([
          floatedWindow(electronApp),
          page.getByRole('menuitem', { name: 'Open in a new window', exact: true }).click(),
        ])
      }
      await target.getByRole('button', { name: 'New tab', exact: true }).click()
      const picker = target.getByRole('tabpanel', { name: 'Pick content', exact: true })
      const search = picker.getByRole('combobox')
      const errors: string[] = []
      target.on('pageerror', error => errors.push(error.message))
      await expect(search).toBeVisible()
      const typeFile = join(dirname(VAULT), 'hello/type/reload-created.type.yaml')
      try {
        await writeFile(typeFile, `extends: pane-projection::au-host-sdk\nfields: {}\nmeta:\n  - type: projection-runtime-meta::au-host-sdk\n    entry: ./dist/index.js\n    contractVersion: 7\n  - type: projection-presentation-meta::au-host-sdk\n    title: Reload Created\n`)
        await search.fill('Reload Created')
        await expect(picker.getByRole('option', { name: /Reload Created/ })).toBeVisible({ timeout: 20_000 })
        await search.press('Enter')
        await expect(target.getByRole('tab', { name: 'Reload Created', exact: true })).toBeVisible()
        await expect(target.getByText(/hello from a mounted projection/)).toBeVisible()
        expect(errors).toEqual([])
      } finally { await rm(typeFile, { force: true }) }
    })
  }
})
