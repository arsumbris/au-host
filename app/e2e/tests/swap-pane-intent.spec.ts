// Behaviour: firing `swap-pane-intent` opens the FOCUSED pane's swap picker, wherever that pane lives.
//
// This is the keyboard-command twin of swap-content.spec (which drives the ⋯ menu's Swap row). The intent
// path is distinct: it dispatches ROUTED + AMBIENT over every container, and only the one whose child is the
// window's active pane (`useSwapPaneIntent` → `host.focus.activePane()` ∈ its children) claims and opens the
// picker. Bindings are per-workspace keymap files, so this proves the behaviour through the command PALETTE
// (the intent carries a `command-meta`), not a hardcoded accelerator.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'swap-content' })

const tabs = (page: import('@playwright/test').Page) => page.locator('[data-pane-id="tabs"]')
const occupant = (page: import('@playwright/test').Page) => page.locator('[data-pane-id="ed"]')

test('the Swap pane command opens the focused pane picker and swaps its viewer in place', async ({ page, events }) => {
  // Start: tabs → [editor#ed]. Focus the editor so it becomes the window's active pane — the routed+ambient
  // walk resolves the target from `activePane`, so a swap with nothing focused would have no claimant.
  await expect(tabs(page).first()).toBeVisible()
  await expect(occupant(page).first()).toBeVisible()
  await page.locator('.cm-content').click()
  await expect(page.locator('.cm-content')).toHaveCount(1)

  // Fire the command. "Swap pane" carries no params, so selecting it fires immediately (no inline filler);
  // the routed+ambient intent reaches the tabs container holding `ed`, which opens its swap picker.
  await page.locator('.cmd-palette-trigger').click()
  await expect(page.locator('.cmd-palette-overlay')).toBeVisible()
  await page.getByText('Swap pane', { exact: true }).click()
  await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0) // fired → palette closed

  // The FOCUSED pane's picker opened (the same PanePicker the ⋯ row uses, titled "Swap this pane").
  await expect(page.getByText('Swap this pane')).toBeVisible()
  await page.locator('button[title="file-tree"]').first().click()

  // REPLACED IN PLACE: the tabs container and the `ed` pane id are UNCHANGED, but the viewer changed — the
  // editor is gone and a file tree renders. Same seam (`setPaneContent`) as the menu swap, reached via intent.
  await expect(tabs(page).first()).toBeVisible()
  await expect(occupant(page).first()).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await expect(page.locator('[role="tree"]').first()).toBeVisible()

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
