// A FLOATED window's ROOT-HEADER "Wrap in a container" — the reported "can't wrap in a container on the
// root of a popped-out window". The surface holds no pool, so a local `wrapPaneSolo` would hit `not-pooled`;
// the surface picks the wrap kind in ITS window and proxies a `wrap-root` event up. The authority solo-wraps
// the window's current content in a new single-child group and re-drives the surface. A floated
// window is a DIFFERENT renderer than the main window, so this is driven from the FLOATED window.
//
// Before the fix the surface root header omitted the wrap action entirely (renderHeader only carried
// move + reload), so a floated root had no way to wrap.
//
// Floats a GROUP (float-reorder), not a bare editor: `wrapRemoteWindowContentSolo` reads the window's current
// content and wraps it whatever its type, so the group case exercises the identical path — and the bare-editor
// float fixture is a pre-existing flake (see the merge-introduced-e2e-failures todo), which this avoids.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-reorder' })

test('a floated window root-header wraps its content in a container over the wire (P5-5.1)', async ({ page, electronApp, events }) => {
  // Float the LEFT region (a tabs group) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })
  await events.clear()

  // Open the FLOATED window's ROOT ⋯ ("Root actions") and wrap its content in a container. The action exists
  // on the surface header now (the twin of the main window's `root.wrap`), proxied to the authority.
  await floated.getByRole('button', { name: 'Root actions' }).click()
  await floated.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  // Several grouping/spatial containers are registered on the surface, so the wrap asks the family-sectioned
  // chooser: pick the first (grouping / "Stack") option — the twin-pick, rendered IN this window.
  const chooserOption = floated.locator('.au-chooser-card au-menu-item')
  await chooserOption.first().waitFor({ state: 'visible', timeout: 10_000 })
  await chooserOption.first().click()

  // The authority solo-wrapped this window's content: assert the `wrap-root` trace on the main authority with
  // a 'wrapped' outcome (container-agnostic — the first grouping option may be any grouping container).
  const wrapEv = await events.waitFor((e) => e.category === 'placement' && e.name === 'wrap-root', { timeout: 15_000 })
  expect(wrapEv.fields?.outcome, 'the floated-window root wrap succeeded').toBe('wrapped')
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)

  // The wrapped content keeps its `^:`, so the original tabs group survives the re-drive, now nested inside
  // the new container.
  await expect(floated.locator('au-tab-bar').first()).toBeVisible({ timeout: 15_000 })
})
