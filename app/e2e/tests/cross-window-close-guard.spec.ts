// Behaviour (cross-window close lifecycle): a dirty editor floated into its
// own OS window blocks that window's close with its OWN save/discard/cancel prompt, IN the floated window,
// and a cancel preserves the window and its unsaved buffer. The main-window e2e cannot observe this — the
// floated window is a DIFFERENT renderer (the thin `MountAgent`, not the full runtime), so the guard runs
// through the surface path: the editor registers its guard LOCALLY, the authority (sole reaper) gathers it
// OVER THE WIRE before reaping the window's content, and the dialog appears where the content is.
//
// Composed with the window-level confirm: closing a non-empty floated window first asks "Close this window?"
// (the LAYOUT decision), and on "Close" the CONTENT guard runs at the reap (the unsaved-work decision). Two
// distinct prompts, both in the floated window.

import { test, expect, floatedWindow } from '../fixtures/app'
import type { Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

test.use({ composition: 'close-guard-floated' }) // sandwich → left: editor (floated first), center: file-tree

// Float the LEFT region (the editor) into its own window B, and dirty its buffer THERE.
async function floatDirtyEditor(page: Page, electronApp: ElectronApplication): Promise<Page> {
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [b] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  const content = b.locator('.cm-content').first()
  await content.waitFor({ timeout: 30_000 })
  await content.click()
  await b.keyboard.type('FLOATED UNSAVED')
  await expect(content).toContainText('FLOATED UNSAVED')
  return b
}

// The USER closes window B (traffic-light): a raw `win.close()`, NOT the authority's programmatic close, so
// the authority intercepts and prompts IN the window (the LAYOUT confirm).
async function userClose(electronApp: ElectronApplication, b: Page): Promise<void> {
  const bw = await electronApp.browserWindow(b)
  await bw.evaluate((win) => win.close())
}

test('a dirty floated editor blocks its window close IN the floated window; cancel preserves it + its buffer', async ({ page, electronApp, events }) => {
  const b = await floatDirtyEditor(page, electronApp)
  await events.clear()

  // Traffic-light close → the LAYOUT confirm renders in B; pick "Close".
  await userClose(electronApp, b)
  await b.locator('.au-chooser-card').waitFor({ timeout: 10_000 })
  await b.getByRole('menuitem', { name: 'Close', exact: true }).click()

  // The CONTENT guard now runs — the editor's save/discard/cancel, gathered over the wire, shown IN B.
  const guard = b.locator('.au-chooser-card')
  await expect(guard).toBeVisible({ timeout: 10_000 })
  await expect(guard).toContainText('unsaved changes')
  // The authority HELD the window reap for the cross-window gather.
  await events.waitFor((e) => e.category === 'placement' && e.name === 'close-window-hold', { timeout: 10_000 })

  // CANCEL ("Keep editing"): the whole close is abandoned — window B stays open with its unsaved buffer intact.
  await guard.getByRole('menuitem', { name: 'Keep editing' }).click()
  await events.waitFor((e) => e.category === 'placement' && e.name === 'close-window-veto', { timeout: 10_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 5_000 }).toBe(2)
  await expect(b.locator('.cm-content').first()).toContainText('FLOATED UNSAVED')
})

test('discarding at the floated guard closes the window and reaps its content', async ({ page, electronApp, events }) => {
  const b = await floatDirtyEditor(page, electronApp)
  await events.clear()

  await userClose(electronApp, b)
  await b.locator('.au-chooser-card').waitFor({ timeout: 10_000 })
  await b.getByRole('menuitem', { name: 'Close', exact: true }).click()

  const guard = b.locator('.au-chooser-card')
  await expect(guard).toContainText('unsaved changes', { timeout: 10_000 })
  // DISCARD: consent → the held window reap completes, the OS window closes, its content is reaped.
  await guard.getByRole('menuitem', { name: 'Discard changes and close' }).click()

  await events.waitFor((e) => e.category === 'lifecycle' && e.name === 'surface-closed-reaped', { timeout: 15_000 })
  await expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(1) // main only
  // Main kept its OWN pane (the file-tree) — the reap took only window B's content.
  await expect(page.locator('au-tree-row').first()).toBeVisible()
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
