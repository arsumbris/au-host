import { describe, expect, it, vi } from 'vitest'
import { prepareRead, type ReadSwitchState } from './prepare-read'

describe('switching a document to reading', () => {
  const initial = (): ReadSwitchState => ({ path: 'note.md', dirty: true, saving: false, alive: true })
  it('requires successful saving before allowing replacement', async () => {
    const state = initial()
    expect(await prepareRead(() => state, async () => true, async () => { state.dirty = false })).toBe('note.md')
  })
  it('keeps editing when the user cancels', async () => {
    const state = initial(), save = vi.fn()
    expect(await prepareRead(() => state, async () => false, save)).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
  it('keeps a buffer whose guarded save was rejected', async () => {
    const state = initial()
    expect(await prepareRead(() => state, async () => true, async () => {})).toBeNull()
  })
  it('keeps edits made while the save was running', async () => {
    const state = initial()
    expect(await prepareRead(() => state, async () => true, async () => {
      state.dirty = false
      await Promise.resolve()
      state.dirty = true
    })).toBeNull()
  })
  it('does not save a different document after the chooser resolves', async () => {
    const state = initial(), save = vi.fn()
    expect(await prepareRead(() => state, async () => { state.path = 'other.md'; return true }, save)).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
  it('opens a clean document without asking or writing', async () => {
    const state = { ...initial(), dirty: false }, confirm = vi.fn(), save = vi.fn()
    expect(await prepareRead(() => state, confirm, save)).toBe('note.md')
    expect(confirm).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
