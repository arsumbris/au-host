// KEYBINDS — the <au-chord-input> element. Verifies it actually REGISTERS in the running
// app (guarding the "unregistered tag" trap) and CAPTURES a chord: focus marks `data-au-keycapture` (the
// gate's yield signal), a keydown canonicalizes via the shared SDK canonicalizer, and it emits the
// structured keystroke record the keymap editor writes.

import { test, expect } from '../fixtures/app'

test('<au-chord-input> registers and captures a chord', async ({ page }) => {
  await expect(page.locator('[data-pane-id]').first()).toBeVisible()

  const result = await page.evaluate(async () => {
    // Registered by the host at boot (the set's dist defines it)? — the unregistered-tag guard.
    if (!customElements.get('au-chord-input')) return { defined: false }
    const el = document.createElement('au-chord-input') as HTMLElement & {
      chord?: { mods: string[]; key: string }[]
      updateComplete?: Promise<unknown>
    }
    document.body.appendChild(el)
    await customElements.whenDefined('au-chord-input')

    // Focus → capture mode marks the generic `data-au-keycapture` the keybind gate yields to.
    el.focus()
    await el.updateComplete
    const capturing = el.hasAttribute('data-au-keycapture')

    // A ⌘S keydown canonicalizes + emits the structured record (metaKey → `mod` on mac).
    let emitted: { mods: string[]; key: string }[] | null = null
    el.addEventListener('au-chord-change', (e) => {
      emitted = (e as CustomEvent<{ chord: { mods: string[]; key: string }[] }>).detail?.chord ?? null
    })
    el.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }))
    await el.updateComplete
    const chord = el.chord ?? null
    el.remove()
    return { defined: true, capturing, emitted, chord }
  })

  expect(result.defined).toBe(true)
  expect(result.capturing).toBe(true)
  // metaKey OR ctrlKey set, so `mod` is present on both mac (metaKey) and elsewhere (ctrlKey).
  expect(result.emitted?.[0]?.key).toBe('s')
  expect(result.emitted?.[0]?.mods).toContain('mod')
  expect(result.chord?.[0]?.key).toBe('s')
})
