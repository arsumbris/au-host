// A hidden overlay layer must NOT suppress chords. The keybind gate's modal guard
// (`overlaySiteHasBlockingLayer`) counts a layer as blocking only when it has RENDERED content, so a surface
// that hides its claimed layer by toggling `display` leaves every shortcut live. Both halves are asserted:
// a hidden child does not block, a visible one does. Must run in real Chromium: jsdom has no layout, so the
// `getClientRects` predicate is unobservable in a unit test.

import { test, expect } from '../fixtures/app'

test.describe('a hidden overlay layer does not softlock keybinds', () => {
  test.use({ composition: 'keybind-fire' })

  test('a display:none child in a blocking overlay layer does not block a chord; a visible one does', async ({ page, events }) => {
    await expect(page.locator('[data-pane-id]').first()).toBeVisible()
    // Let the async keymap-file read settle (a boot race, not a behaviour), and the overlay root exist.
    await page.waitForTimeout(500)
    await page.waitForFunction(() => !!document.querySelector('.au-overlay-root'))

    // Reproduce the leak shape: a blocking-band ('overlay') layer holding an EMPTY, display:none child —
    // what a surface that claims its layer once and hides by display-toggle leaves behind when idle.
    await page.evaluate(() => {
      const root = document.querySelector('.au-overlay-root')!
      const layer = document.createElement('div')
      layer.className = 'au-overlay-layer'
      layer.setAttribute('data-level', 'overlay')
      layer.id = '__test-leak-layer'
      const child = document.createElement('div')
      child.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none'
      layer.appendChild(child)
      root.appendChild(layer)
    })

    await events.clear()
    await page.keyboard.press('ControlOrMeta+s')
    // Hidden content is not an open modal, so the chord still resolves + fires (never guard-modal).
    await events.waitFor(
      (e) => e.name === 'fire' && String(e.fields?.intent).includes('save-composition-intent'),
      { filter: { category: 'keybind' }, timeout: 10_000 },
    )

    // CONTROL / no over-correction: make the SAME child visible → it is now an open modal → the chord IS
    // guarded (the guard must still fire for genuinely-shown content).
    await page.evaluate(() => {
      const child = document.querySelector('#__test-leak-layer > div') as HTMLElement
      child.style.display = 'block'
    })
    await events.clear()
    await page.keyboard.press('ControlOrMeta+s')
    await events.waitFor((e) => e.name === 'guard-modal', { filter: { category: 'keybind' }, timeout: 10_000 })

    await page.evaluate(() => document.querySelector('#__test-leak-layer')?.remove())
  })
})
