// A view's overlays live only as long as the view. The terminal's settings popover is left open, then a
// build published from disk live-reloads the terminal projection: the old mount ends, and the host
// closes the popover it opened. Nothing in the UI is touched between the open and the reload, so the
// popover can only go away through the mount lifetime. Main window and floated window (the two renderers).

import { test, expect, floatedWindow } from '../fixtures/app'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { projectionBuildDirectory, publishProjectionBuild } from '@arsumbris/au-host-sdk/build'
import { runRoot } from '../support/vault'

test.use({ composition: 'reload-terminal', projectionDevelopment: true })

/** The terminal member this run mounts: a co-present copy under the run root (support/local-members.ts). */
const terminalRoot = (): string => join(runRoot(), 'terminal')

test.afterEach(async () => {
  // The builds folder is shared by every test in the run; drop the ones this test published.
  await rm(projectionBuildDirectory(terminalRoot()), { recursive: true, force: true })
})

async function leavePopoverOpenThenReload(target: Page, actions: string): Promise<void> {
  await target.getByRole('button', { name: actions, exact: true }).first().click()
  await target.getByRole('menuitem', { name: 'Start live reload', exact: true }).click()

  const terminal = target.locator('.xterm').first()
  await terminal.evaluate((el) => el.setAttribute('data-reload-original', 'true'))
  await terminal.click({ button: 'right' })
  await target.getByRole('menuitem', { name: 'Terminal settings…', exact: true }).click()
  const popover = target.locator('au-popover[heading="This terminal"]')
  await expect(popover).toBeVisible()

  await publishProjectionBuild(terminalRoot(), join(terminalRoot(), 'dist'))

  await expect(target.locator('[data-reload-original]')).toHaveCount(0)
  await expect(target.locator('.xterm').first()).toBeVisible()
  await expect(popover).toHaveCount(0)
}

test('main window: a reloaded view leaves no popover behind', async ({ page }) => {
  await leavePopoverOpenThenReload(page, 'Pane actions')
})

test('floated window: a reloaded view leaves no popover behind', async ({ page, electronApp }) => {
  await page.getByRole('button', { name: 'Pane actions', exact: true }).first().click()
  const [surface] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window', exact: true }).click(),
  ])
  await expect(surface.locator('.xterm').first()).toBeVisible()
  await leavePopoverOpenThenReload(surface, 'Root actions')
})

// The dock's ⋯ bar menu (a context menu) left open when the dock itself reloads: the menu ends with the
// mount that opened it, so "Add bar" can never run against a dead dock record.
test.describe('the dock bar menu', () => {
  test.use({ composition: 'dock-empty', projectionDevelopment: true })
  const dockRoot = (): string => join(runRoot(), 'dock')
  test.afterEach(async () => {
    await rm(projectionBuildDirectory(dockRoot()), { recursive: true, force: true })
  })

  test('a reloaded dock leaves no bar menu behind', async ({ page }) => {
    await page.getByRole('button', { name: 'Root actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Start live reload', exact: true }).click()

    const strip = page.locator('.au-dock-strip')
    await strip.evaluate((el) => el.setAttribute('data-reload-original', 'true'))
    await strip.getByRole('button', { name: 'Dock bars' }).click()
    const addBar = page.getByRole('menuitem', { name: /^Add bar/ })
    await expect(addBar).toBeVisible()

    await publishProjectionBuild(dockRoot(), join(dockRoot(), 'dist'))

    await expect(page.locator('[data-reload-original]')).toHaveCount(0)
    await expect(page.locator('.au-dock-strip')).toBeVisible()
    await expect(addBar).toHaveCount(0)
  })
})
