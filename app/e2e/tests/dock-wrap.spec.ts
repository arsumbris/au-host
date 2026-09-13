// Dock into an occupied non-grouping region by wrapping the occupant and incoming pane together.
// Float the center editor, then wrap the left region to invalidate the clean inverse. Dock into
// the occupied right region and assert a new tabs group and a `dock:wrap` trace.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'dock-wrap' })

test('docking into an occupied non-grouping region WRAPS, never replaces', async ({ page, electronApp, events }) => {
  // Three occupied regions: two editors + a file-tree.
  await expect(page.locator('.cm-content')).toHaveCount(2)

  // 1) Float the CENTER editor (the middle pane in DOM order left/center/right) into its own window.
  await page.getByRole('button', { name: 'Pane actions' }).nth(1).click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.getByRole('button', { name: 'Root actions' }).waitFor({ timeout: 30_000 })

  // 2) Change the ORIGIN: wrap the LEFT region (file-tree) in tabs, so the sandwich record differs from
  // the center editor's post-extract witness → clean-inverse can no longer apply on dock.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: 'tabs', exact: true }).click()
  await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible()

  // 3) Dock the center editor via "Move to other window" (: sole other window = main → auto-picks
  // → the dock path). The origin changed, so the spatial chooser opens over the main-window candidates.
  await floated.getByRole('button', { name: 'Root actions' }).click()
  await floated.getByRole('menuitem', { name: 'Move to other window' }).click()
  const targets = page.locator('au-pane-target')
  await targets.first().waitFor({ timeout: 10_000 })

  // 4) Pick the RIGHTMOST candidate = the right region (occupied by an editor, a NON-GROUPING slot).
  const n = await targets.count()
  let rightmost = 0
  let maxX = -Infinity
  for (let i = 0; i < n; i++) {
    const box = await targets.nth(i).boundingBox()
    if (box && box.x > maxX) {
      maxX = box.x
      rightmost = i
    }
  }
  await targets.nth(rightmost).click()

  // 4b) The right region holds a real occupant, so the dock now ASKS which container to wrap into (a real occupant is preserved by a wrap, never replaced). Pick tabs, matching the assertion below.
  const wrapCard = page.locator('.au-chooser-card')
  await wrapCard.waitFor({ timeout: 10_000 })
  await wrapCard.getByRole('menuitem', { name: 'Tabs', exact: false }).first().click()

  // Docking wraps the occupied target and incoming pane together. `dock:wrap` identifies this branch;
  // `dock:inject` would signal an invalid replacement of the existing occupant.
  const dockEv = await events.waitFor((e) => e.category === 'dock' && (e.name === 'wrap' || e.name === 'inject'), { timeout: 15_000 })
  expect(dockEv.name, `dock decision was "${dockEv.name}" — want "wrap"; "inject" is the destructive replace the fix removed`).toBe('wrap')
})
