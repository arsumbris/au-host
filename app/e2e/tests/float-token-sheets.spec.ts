// A FLOATED window must load every projection's + component set's `customTokenEntry` declaration sheet, the
// SAME document-level eager-load the main window runs. Without it a floated window has none of the
// `--au-<projection>-*` / `--au-<component>-*` tokens, so a projection that colors text / strokes lines via
// its own tokens (focal-tree's `--au-focal-tree-label` / `-edge`, radial-tree, force-graph) renders with
// unset fill + stroke — the reported "text color broken, lines don't draw" in a popped-out window. The
// surface is a DIFFERENT renderer than the main window, so this is driven from the FLOATED window.
//
// focal-tree is not in the e2e vault, so this asserts the general MECHANISM through the always-discovered
// component set: `--au-tree-item-radius` is declared only in `component-set.tokens.css` (a customTokenEntry),
// so it resolves EMPTY in a floated document unless the surface loaded that sheet.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-reorder' })

test('a floated window loads projection/component customTokenEntry sheets (P5-5.2)', async ({ page, electronApp }) => {
  // Float the LEFT region (a tabs group) into its own OS window.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })

  // The main window resolves the token (it always loads token sheets) — the floated window must agree.
  const mainRadius = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--au-tree-item-radius').trim())
  expect(mainRadius, 'the component-set token resolves in the main window (control)').not.toBe('')

  // THE FIX: the surface loaded every customTokenEntry sheet, so the component-set token resolves in the
  // floated document too. The load is non-blocking, so poll until it lands (progressive enhancement).
  await expect.poll(
    () => floated.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--au-tree-item-radius').trim()),
    { timeout: 15_000, message: 'the component-set customTokenEntry token resolves in the floated window' },
  ).not.toBe('')
})
