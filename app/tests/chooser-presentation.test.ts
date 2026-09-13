// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createChooserPresentation, CHOOSER_BACK } from '@arsumbris/au-component-catalog/chooser-presentation'

afterEach(() => document.body.replaceChildren())
describe('chooser interaction', () => {
  it('captures focus, contains Tab, and restores the trigger on Escape', async () => {
    const trigger = document.createElement('button'); const root = document.createElement('div')
    document.body.append(trigger, root); trigger.focus()
    const chooser = createChooserPresentation(root)
    const pending = chooser.choose({ title: 'Open notes.md', options: [{ id: 'one', label: 'Reader' }, { id: 'two', label: 'Editor' }] })
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement?.tagName).toBe('AU-MENU-ITEM')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement?.textContent).toBe('Cancel')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(await pending).toBeNull(); expect(document.activeElement).toBe(trigger)
    expect(root.childElementCount).toBe(0)
  })
  it('Back is distinct from caller option ids', async () => {
    const root = document.createElement('div'); document.body.append(root)
    const chooser = createChooserPresentation(root)
    const pending = chooser.choose({ title: 'Choose', back: true, options: [{ id: 'back', label: 'A file called back' }] })
    root.querySelector('au-button')!.dispatchEvent(new CustomEvent('au-activate'))
    expect(await pending).toBe(CHOOSER_BACK)
  })
})
