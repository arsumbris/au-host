// Behaviour: float a pane to its OWN OS window (the generic pane action, any container), then dock it
// back — the round-trip preserves the layout and loses nothing. Exercises the multi-window harness
// (a second BrowserWindow driven via `floatedWindow`) and the dock happy path (clean-inverse restore).
//
// Start: sandwich → left: file-tree, center: editor. Float the LEFT (file-tree) into its own window;
// the editor stays. Dock it back via the floated window's pop-back chrome; the file-tree returns.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-dock' })

test('float a pane to a new window, then dock it back — round-trip preserves the layout', async ({ page, electronApp, events }) => {
  // Both leaves present at start: the editor (center) + a second pane (the file-tree, left).
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')
  const panesAtStart = await page.locator('[data-pane-id]:not([data-pane-host])').count()
  expect(panesAtStart).toBeGreaterThanOrEqual(2)

  // Float the LEFT region (file-tree) into its own OS window via the generic "Open in a new window".
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  // The floated window boots and renders the SHARED root header (the same `<au-pane-header>` shell
  // as the main window, with its root pane-actions menu).
  await floated.getByRole('button', { name: 'Root actions' }).waitFor({ timeout: 30_000 })
  // The editor stays put in the main window while the tree is floated.
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')

  // Dock it back via the floated window's root ⋯ → "Move to other window" (: dock is subsumed —
  // the picker's only OTHER window is the main window, so it auto-picks and runs the dock path).
  await floated.getByRole('button', { name: 'Root actions' }).click()
  await floated.getByRole('menuitem', { name: 'Move to other window' }).click()

  // The dock applied at the authority (clean inverse — the origin was unchanged), and the layout is whole.
  await events.waitFor((e) => e.category === 'dock' && (e.name === 'applied' || e.name === 'clean-inverse'), {
    timeout: 15_000,
  })
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')
  await expect(page.locator('[data-pane-id]:not([data-pane-host])')).toHaveCount(panesAtStart)
})
