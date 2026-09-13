// Behaviour: a floated CONTAINER proposes a STRUCTURAL edit over the wire.
// Float a tabs group into its own OS window, then REORDER its tabs ON THE FLOATED SURFACE. The reorder is
// a `moveWithin` the container builds (pure) and PROPOSES up over the transport; the authority — the sole
// committer — applies it via `applyStructural` and mirrors the subtree back down (`pool-sync`), so the
// surface re-renders. Without `children.pool`, floated drops fall to the
// mutating fallback. A synthetic pointer drag over the au-tab-bar contract also proves the harness
// can drive a real drag.
//
// The assertion spine is the `placement / surface-propose` trace (a floated container's edit reached the
// authority over the wire), asserted on the MAIN window's event substrate where the authority runs.
import { test, expect, floatedWindow } from '../fixtures/app'

test.use({ composition: 'float-reorder' })

test('a floated tabs group reorders its tabs over the wire (M1 proxied pool)', async ({ page, electronApp, events }) => {
  // Float the LEFT region (the tabs group) into its own OS window via the region's generic pane action.
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  const [floated] = await Promise.all([
    floatedWindow(electronApp),
    page.getByRole('menuitem', { name: 'Open in a new window' }).click(),
  ])
  // The tabs group renders on the surface: its <au-tab-bar> with two cells (an editor + a file-tree).
  await floated.waitForSelector('au-tab-bar', { timeout: 30_000 })

  // The bar's viewport position + its cell WIDTHS (tabCellRects exposes width only; cells live in the
  // bar's shadow), so a drop past tab 1 is the bar origin + the running width.
  const geo = await floated.evaluate(() => {
    const bar = document.querySelector('au-tab-bar') as unknown as
      | ({ tabCellRects?: () => { width: number }[] } & Element)
      | null
    if (!bar) return null
    const r = bar.getBoundingClientRect()
    return { barX: r.x, barY: r.y, barH: r.height, widths: (bar.tabCellRects?.() ?? []).map((c) => c.width) }
  })
  expect(geo).not.toBeNull()
  expect(geo!.widths.length).toBe(2)
  const y = geo!.barY + geo!.barH / 2
  const pastX = geo!.barX + geo!.widths[0] + geo!.widths[1] - 4 // just inside tab 1's trailing edge → gap AFTER tab 1

  // The DRAG affordance is the TAB BODY itself: au-tab-bar renders
  // cells with `.grip=false`, and au-tab-strip-cell emits `au-tab-drag-start` on the CELL's own pointerdown
  // ("the tab body is the drag affordance"). The container owns the threshold + protocol from there. So
  // start the drag from tab 0's cell, not a grip glyph.
  const gb = await floated.locator('au-tab-strip-cell').first().boundingBox()
  expect(gb).not.toBeNull()
  const src = { x: gb!.x + gb!.width / 2, y: gb!.y + gb!.height / 2 }

  // Drag tab 0 PAST tab 1 → the floated container's `moveWithin` proposes over the wire. Steps clear the
  // 5px drag threshold (the gesture arms on window pointermove) and reach the drop gap after tab 1.
  await floated.mouse.move(src.x, src.y)
  await floated.mouse.down()
  await floated.mouse.move(src.x + 8, src.y, { steps: 3 })
  await floated.mouse.move(pastX, y, { steps: 12 })
  await floated.mouse.up()

  // The transport assertion: the floated container's structural edit crossed to the authority as a propose — proof
  // that a floated container builds an edit and asks over the wire.
  await events.waitFor((e) => e.category === 'placement' && e.name === 'surface-propose', { timeout: 15_000 })
  // The cross-process apply + mirror-back raised no standing error, and the group still holds both tabs
  // (the round-trip neither lost a tab nor corrupted the pool).
  const conds = await events.conditions()
  expect(conds.find((c) => c.severity === 'error')).toBeUndefined()
  const cellsAfter = await floated.evaluate(() => {
    const bar = document.querySelector('au-tab-bar') as unknown as { tabCellRects?: () => { width: number }[] } | null
    return bar?.tabCellRects?.().length ?? 0
  })
  expect(cellsAfter).toBe(2)
})
