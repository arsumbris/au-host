// The CHOOSE strategy is the DEFAULT for ambient routed intents: on >1 genuine claim the host shows the
// spatial picker instead of silently auto-picking the focus/MRU head. These specs DRIVE the picker
// (Enter commits the pre-highlighted head), prove the `default-strategy: mru` opt-out stays silent, and
// cover the ⌘S save-file / save-composition overlap.
import { test, expect } from '../fixtures/app'

test.describe('ambient picker on >1 (choose is the default)', () => {
  test.use({ composition: 'picker-open' }) // two tabs groups + a file-tree; an open claims in both

  test('an open with >1 capable group shows the picker; Enter commits the pre-highlighted head', async ({ page, events }) => {
    await page.locator('au-tree-row').first().waitFor({ timeout: 30_000 })
    await events.clear()

    // Click a file → ambient open-intent → both tabs groups claim → the picker.
    await page.locator('au-tree-row[data-path$="/sample.md"]').first().click()

    // The CHOOSE trace fired with >1 genuine candidate, and the spatial picker rendered.
    const choose = await events.waitFor(
      (e) => e.name === 'choose' && String(e.fields?.type).includes('open-intent'),
      { filter: { category: 'intent' }, timeout: 10_000 },
    )
    expect((choose.fields?.candidates as unknown[]).length).toBeGreaterThanOrEqual(2)
    const targets = page.locator('au-pane-target')
    await targets.first().waitFor({ timeout: 10_000 })
    expect(await targets.count()).toBeGreaterThanOrEqual(2)

    // Enter commits the pre-highlighted head — a real commit, traced, opening the file in a group.
    await page.keyboard.press('Enter')
    await events.waitFor(
      (e) => e.name === 'choose-pick' && String(e.fields?.type).includes('open-intent'),
      { filter: { category: 'intent' }, timeout: 10_000 },
    )
    await expect(page.locator('.au-chooser-card')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.locator('.cm-content', { hasText: 'Sample content' }).first()).toBeVisible({ timeout: 15_000 })
    const errors = (await events.conditions()).filter((c) => c.severity === 'error')
    expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
  })
})

test.describe('picker opt-out (default-strategy: mru)', () => {
  test.use({ composition: 'picker-open-mru' }) // the same layout + the silent-MRU opt-out

  test('an open with >1 capable group auto-picks SILENTLY — no picker', async ({ page, events }) => {
    await page.locator('au-tree-row').first().waitFor({ timeout: 30_000 })
    await events.clear()

    await page.locator('au-tree-row[data-path$="/sample.md"]').first().click()

    // The file opens directly — no chooser card, no picker targets, no CHOOSE trace.
    await expect(page.locator('.cm-content', { hasText: 'Sample content' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.au-chooser-card')).toHaveCount(0, { timeout: 3_000 })
    const choose = (await events.read({ category: 'intent' })).filter((e) => e.name === 'choose')
    expect(choose, 'mru opt-out must never open the picker').toHaveLength(0)
  })
})

test.describe('⌘S picker — save file vs save composition', () => {
  test.use({ composition: 'picker-save' }) // a bare editor at root, no mru opt-out

  test('⌘S offers the focused editor (save file) and the host (save composition)', async ({ page, events }) => {
    await expect(page.locator('.cm-content').first()).toBeVisible()
    await page.waitForTimeout(700) // let the file open + async keymap read settle
    await events.clear()

    await page.keyboard.press('ControlOrMeta+s')

    // ⌘S is claimed by BOTH the editor and the host commands node → the picker, offering both.
    const choose = await events.waitFor(
      (e) => e.name === 'choose' && String(e.fields?.type).includes('save-intent'),
      { filter: { category: 'intent' }, timeout: 10_000 },
    )
    // The trace labels each candidate via describeNode: the focused editor (save file) and the host
    // commands node (save composition) — the two genuine meanings of ⌘S.
    const labels = (choose.fields?.candidateLabels as string[]) ?? []
    expect(labels.length, `candidates: ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(2)
    expect(labels.some((l) => l.includes('editor')), `want the save-file (editor) candidate in ${JSON.stringify(labels)}`).toBe(true)
    expect(labels.some((l) => l.includes('host:commands')), `want the save-composition (host commands) candidate in ${JSON.stringify(labels)}`).toBe(true)
    await expect(page.locator('.au-chooser-card')).toBeVisible({ timeout: 5_000 })

    // Esc cancels the routing (nothing fires), traced as a user cancel.
    await page.keyboard.press('Escape')
    await events.waitFor(
      (e) => e.name === 'choose-cancel' && String(e.fields?.type).includes('save-intent'),
      { filter: { category: 'intent' }, timeout: 10_000 },
    )
    await expect(page.locator('.au-chooser-card')).toHaveCount(0, { timeout: 5_000 })
  })

  // Reentrancy (design D8): a second ambient dispatch while a picker is open SUPERSEDES the first
  // (`chooser: superseded`, distinct from a user `chooser: cancel`, so the intent is never silently dropped).
  //
  // NOT USER-GESTURE-DRIVABLE, so no e2e: an open picker structurally BLOCKS every path that could produce a
  // second USER dispatch — its backdrop turns a background click into a cancel, and the keybind system
  // GUARDS keybinds while a modal is open (a `keybind: guard-modal` trace, verified: a second ⌘S never
  // reaches dispatch). So a supersede only arises from a NON-user dispatch (an async relay / cross-window),
  // which needs a programmatic fire hook the harness does not expose. The behaviour is committed +
  // trace-instrumented (chooser-surface emits `superseded` vs `cancel`); this documents why it has no e2e.
  test.skip('a second dispatch supersedes the open picker (D8) — not user-gesture-drivable; needs a programmatic-fire hook', async () => {})
})
