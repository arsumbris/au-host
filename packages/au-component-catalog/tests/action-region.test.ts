// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createActionRegion } from '../src/action-region'

describe('persistent action region', () => {
  it('retains button identity and invokes only the current action after a commit', () => {
    const first = vi.fn(), second = vi.fn()
    const region = createActionRegion(document)
    document.body.append(region.element)
    region.update({ label: 'A', primary: { id: 'switch', label: 'Custom lens', enabled: true, run: first }, actions: [{ id: 'save', label: 'Save', enabled: true, run: first }] })
    const primary = region.element.querySelector('au-viewer-switch')!
    const save = region.element.querySelector('[data-action-id="save"]')!
    region.update({ label: 'B', primary: { id: 'switch', label: 'Source lens', enabled: true, run: second }, actions: [{ id: 'save', label: 'Save changes', enabled: true, run: second }] })
    expect(region.element.querySelector('au-viewer-switch')).toBe(primary)
    expect(region.element.querySelector('[data-action-id="save"]')).toBe(save)
    primary.dispatchEvent(new Event('au-activate'))
    save.dispatchEvent(new Event('au-activate'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(2)
    region.dispose()
  })
  it('blocks stale actions while pending but allows explicit cancellation', () => {
    const run = vi.fn(), cancel = vi.fn()
    const region = createActionRegion(document)
    region.update({ label: 'A', busy: true, primary: { id: 'switch', label: 'B', enabled: true, run }, cancel: { id: 'cancel', label: 'Cancel', enabled: true, run: cancel } })
    region.element.querySelector('au-viewer-switch')!.dispatchEvent(new Event('au-activate'))
    region.element.querySelector('[data-action-role="cancel"]')!.dispatchEvent(new Event('au-activate'))
    expect(run).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
    region.dispose()
  })
  it('closes its own menu when actions change and ignores events after disposal', () => {
    const close = vi.fn(), run = vi.fn()
    const open = vi.fn(() => ({ close }))
    const region = createActionRegion(document, { open })
    region.update({ label: 'A', more: [{ id: 'custom', label: 'Inspect', enabled: true, run }] })
    const more = region.element.children[3]
    more.dispatchEvent(new Event('au-activate'))
    expect(open).toHaveBeenCalledOnce()
    region.update({ label: 'B' })
    expect(close).toHaveBeenCalledOnce()
    region.dispose()
    more.dispatchEvent(new Event('au-activate'))
    expect(open).toHaveBeenCalledOnce()
  })
})
