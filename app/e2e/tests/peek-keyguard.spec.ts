// PEEK-KEYGUARD — a shown cmd-hover PEEK must NOT swallow a command keybind. The shared host preview
// surface claims the overlay `popover` band (for z-order, above confirm dialogs); `popover` is a BLOCKING
// band, so a naive claim makes `overlaySiteHasBlockingLayer()` true while a peek is up and the keybind gate
// guards EVERY chord away (`guard-modal`). A hover peek is keyboard-PASSIVE decoration, so it opts out with
// `keyguard: false` and chords stay live. This proves it end-to-end: peek showing → ⌘S still fires.
//
// RED before the fix: with the peek up, the gate records `guard-modal` and never a `candidate`/`fire`.
// GREEN after: the chord rides the gate → authority → fire, exactly as with no peek.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'peek-keyguard' })

test('a shown cmd-hover peek does not suppress a command keybind (⌘S still fires)', async ({ page, events }) => {
  // The file-tree painted with the vault's files.
  const row = page.locator('au-tree-row[data-path$="/sample.md"]')
  await expect(row).toBeVisible({ timeout: 30_000 })

  // Trigger the cmd-hover peek: hold Meta, hover the file row. Meta stays down through the 240ms dwell
  // (its keydown carries into the mousemove's metaKey), so the peek shows. It is the shared host preview
  // surface's `.au-pcard`, claimed in the `popover` band.
  await page.keyboard.down('Meta')
  await row.hover()
  await expect(page.locator('.au-pcard')).toBeVisible({ timeout: 10_000 })

  // Isolate this chord's traces, then press ⌘S. The file-tree peek ignores non-modifier keys, so the peek
  // is STILL up when the gate sees the chord — the exact condition that used to guard-modal it away.
  await events.clear()
  await page.keyboard.press('s')

  // The chord survived the gate as a candidate and fired down the command path (the peek did not block it).
  const fired = await events.waitFor(
    (e) => e.name === 'fire' && String(e.fields?.intent).includes('save-composition-intent'),
    { filter: { category: 'keybind' }, timeout: 10_000 },
  )
  expect(fired.fields?.dispatch).toBe('ambient')

  // The gate never recorded a modal guard for this chord (the peek's layer no longer counts as blocking).
  const guarded = (await events.read({ category: 'keybind' })).filter((e) => e.name === 'guard-modal')
  expect(guarded, `guard-modal traces while a passive peek was up: ${JSON.stringify(guarded)}`).toHaveLength(0)

  await page.keyboard.up('Meta')
})
