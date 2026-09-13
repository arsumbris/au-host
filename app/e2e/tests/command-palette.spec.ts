// The command palette lists the DISCOVERED command set (intents carrying a `command-meta`) and fires the
// chosen one, filling any params through the recursive <au-typed-value-editor>. Proves the command loop:
// type-graph discovery → au-command-palette → the inline typed-value filler → normalize('fire') → fireCommand.
import { test, expect } from '../fixtures/app'

test('the command palette opens and lists the discovered Composition commands', async ({ page }) => {
  // Booted (a pane is mounted) → the window root header, and its command-palette trigger, are present.
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()

  await page.locator('.cmd-palette-trigger').click()

  // The host-global Composition commands (discovered from the type graph, not hardcoded). `au-command-palette`
  // renders the labels in its open shadow root, which Playwright's text engine pierces.
  await expect(page.locator('.cmd-palette-overlay')).toBeVisible()
  await expect(page.getByText('Save composition as…')).toBeVisible()
  await expect(page.getByText('Delete composition')).toBeVisible()
  // The curated set is not a hard gate: a "Show unregistered" escape hatch lists the raw in-scope intents.
  await expect(page.getByText(/Show unregistered/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0)
})

test('a command with params opens the inline typed-value editor', async ({ page }) => {
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()
  await page.locator('.cmd-palette-trigger').click()
  // `Save composition as…` carries a `name` param → the list is replaced by the inline RECURSIVE editor
  // (resolve → the command's effective shape → <au-typed-value-editor>).
  await page.getByText('Save composition as…').click()
  await expect(page.locator('.cmd-value-filler')).toBeVisible()
  await expect(page.locator('.cmd-value-filler__cmd')).toHaveText('Save composition as…')
  await expect(page.locator('.cmd-value-filler au-typed-value-editor')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0)
})

test('a compound command shows its fields, and picking a select option keeps the palette open', async ({ page }) => {
  // open-intent is a REAL compound command: `target: selection&` (an ABSTRACT ceiling → the subtype
  // selector), `mode` (enum), `with` (def-ref). Reached via "Show unregistered".
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()
  await page.locator('.cmd-palette-trigger').click()
  await page.getByText(/Show unregistered/).click()
  await page.getByText('open-intent', { exact: true }).first().click()
  await expect(page.locator('.cmd-value-filler au-typed-value-editor')).toBeVisible()

  // The compound command's fields resolved and rendered (its required `target` auto-expands).
  const rendersTarget = await page.evaluate(() =>
    (document.querySelector('.cmd-value-filler au-typed-value-editor')?.shadowRoot?.textContent || '').includes('target'),
  )
  expect(rendersTarget).toBe(true)

  // Open a select and PICK an option. The dropdown-band popup now NESTS under the palette's overlay layer;
  // clicking the option must NOT read as an outside dismiss (the light-dismiss fix) — the palette STAYS open.
  await page.locator('[aria-haspopup="listbox"]').first().click()
  await page.waitForTimeout(150)
  await page.locator('[role="option"]').first().click()
  await page.waitForTimeout(150)
  await expect(page.locator('.cmd-palette-overlay')).toBeVisible()
  await expect(page.locator('.cmd-value-filler au-typed-value-editor')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0)
})

test('filling a compound command and running it fires it (no error, palette closes)', async ({ page, events }) => {
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()
  await page.locator('.cmd-palette-trigger').click()
  await page.getByText(/Show unregistered/).click()
  await page.getByText('open-intent', { exact: true }).first().click()
  await expect(page.locator('.cmd-value-filler au-typed-value-editor')).toBeVisible()
  // Fill the required `target` — an ABSTRACT `selection` filled as the concrete `file-selection` with its
  // own `path` field (the subtype selector's value contract: a nested record carrying its `type:`). Then Run.
  // (Per-control typing is gallery-covered; this asserts the WIRING: au-value-complete → normalize('fire') →
  // runtime.fireCommand.) open-intent is ROUTED and lands nowhere, so the proof is: it fires without
  // raising an error and the palette closes.
  await page.evaluate(() => {
    const ed = document.querySelector('.cmd-value-filler au-typed-value-editor') as HTMLElement & { value?: unknown }
    ed.value = { target: { type: 'file-selection', path: 'sample.md' } }
    ed.dispatchEvent(new CustomEvent('au-value-change', { bubbles: true, composed: true, detail: { value: ed.value } }))
  })
  await page.getByText('Run', { exact: true }).click()
  await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0) // fired → palette closed

  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})

test('show unregistered reveals raw in-scope intents', async ({ page }) => {
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()
  await page.locator('.cmd-palette-trigger').click()
  await page.getByText(/Show unregistered/).click()
  // Unregistered intents (no command-meta) list by their bare type name — e.g. open-intent.
  await expect(page.getByText('open-intent').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cmd-palette-overlay')).toHaveCount(0)
})
