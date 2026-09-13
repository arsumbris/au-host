// Closing a nested view removes the focused pane through the enclosing container's placement.
// The fixture distinguishes the child identity from its container so the close cannot target the parent.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'close-view-nested' })

test('DIAG-B: ⌘W with the INNER editor focused', async ({ page, events }) => {
  await page.locator('[data-pane-id="ed"] .cm-content').first().waitFor({ timeout: 30_000 })
  await page.locator('au-tree-row').first().waitFor({ timeout: 30_000 })

  // Structural evidence: dump host nesting (the branch's trigger precondition).
  const nesting = await page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-host]'))
    const pairs: string[] = []
    for (const a of hosts) for (const b of hosts) if (a !== b && a.contains(b)) pairs.push(`${a.getAttribute('data-pane-host')}⊃${b.getAttribute('data-pane-host')}`)
    return { hosts: hosts.map((h) => h.getAttribute('data-pane-host')), contains: pairs }
  })
  console.log('[D1] hosts:', JSON.stringify(nesting.hosts), 'nesting:', JSON.stringify(nesting.contains))

  await page.locator('[data-pane-id="ed"] .cm-content').first().click()
  await events.clear()
  await page.keyboard.press('ControlOrMeta+w')

  const cmd = await events.waitFor((e) => e.category === 'placement' && e.name === 'close-view-command')
  const edGone = (await page.locator('[data-pane-id="ed"]').count()) === 0
  console.log('[D1-B] close-view-command:', JSON.stringify(cmd.fields), '| ed closed:', edGone)

  // The user was typing in the inner editor → ⌘W should close `ed`.
  expect(cmd.fields?.paneId, 'B: close-view targeted the inner editor').toBe('ed')
  expect(edGone, 'B: the inner editor closed').toBe(true)
})

test('DIAG-C: ⌘W with the OUTER container host (grid) DOM-focused', async ({ page, events }) => {
  await page.locator('[data-pane-id="ed"] .cm-content').first().waitFor({ timeout: 30_000 })

  // Establish the inner editor as the worked-in pane first.
  await page.locator('[data-pane-id="ed"] .cm-content').first().click()

  // Now move DOM focus to the OUTER container host (the bento `grid`) — the branch's precondition: DOM focus
  // on an outer pane whose host contains the inner one. Programmatic focus fires the `focusin` the tracker sees.
  const focused = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-pane-host="grid"]')
    if (!el) return false
    el.focus()
    return document.activeElement === el || el.contains(document.activeElement)
  })
  console.log('[D1-C] grid host focused:', focused)
  await events.clear()
  await page.keyboard.press('ControlOrMeta+w')

  const cmd = await events.waitFor((e) => e.category === 'placement' && e.name === 'close-view-command')
  const edGone = (await page.locator('[data-pane-id="ed"]').count()) === 0
  const gridGone = (await page.locator('[data-pane-id="grid"]').count()) === 0
  console.log('[D1-C] close-view-command:', JSON.stringify(cmd.fields), '| ed closed:', edGone, '| grid closed:', gridGone)

  // No hard assertion on which pane — this diagnostic proves the window
  // survived and a resolution happened.
  expect(cmd.fields?.resolved, 'C: close-view resolved SOME pane').toBe(true)
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors)}`).toHaveLength(0)
})

// The trigger: `reported ≠ dom` with containment. The documented `report` path is a
// tabs tab whose BUTTON (not content) holds focus — tabs `report`s the content pane while DOM focus sits on
// the strip. Does ⌘W then close the active TAB or the whole GROUP?
test.describe('DIAG-D: tabs, focus on the tab STRIP (button), not content', () => {
  test.use({ composition: 'close-view-cmd' })
  test('⌘W after clicking a tab-strip cell', async ({ page, events }) => {
    const cells = page.locator('au-tab-strip-cell')
    await expect(cells).toHaveCount(2)
    // Click the tab STRIP CELL (the button), which selects the tab; focus lands on the strip, not content.
    await cells.first().click()
    const activeInfo = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      // walk up to the nearest pane-id host (the resolver's algorithm)
      let el: Element | null = a
      while (el) { const id = el.getAttribute?.('data-pane-id'); if (id) return { tag: a?.tagName, resolvedPane: id }; el = el.parentElement }
      return { tag: a?.tagName, resolvedPane: null }
    })
    console.log('[D1-D] active element after tab-cell click:', JSON.stringify(activeInfo))
    await events.clear()
    await page.keyboard.press('ControlOrMeta+w')
    const cmd = await events.waitFor((e) => e.category === 'placement' && e.name === 'close-view-command')
    const remaining = await cells.count()
    console.log('[D1-D] close-view-command:', JSON.stringify(cmd.fields), '| tab cells remaining:', remaining)
    // Diagnostic: 1 remaining = closed the active TAB (branch-like); 0 = closed the GROUP; 2 = no-op.
    const errors = (await events.conditions()).filter((c) => c.severity === 'error')
    expect(errors, `standing error conditions: ${JSON.stringify(errors)}`).toHaveLength(0)
  })
})
