import { describe, expect, it } from 'vitest'
import { workingAfterSave } from '../src/renderer/src/projections/composition-config'

const key = (v: { layout: string }): string => v.layout

describe('workingAfterSave', () => {
  it('adopts the saved form, clean, when nothing changed during the save', () => {
    const start = { layout: 'a' }
    expect(workingAfterSave(start, start, start, key)).toEqual({ working: start, baseline: 'a', dirty: false })
  })

  it('keeps an edit made during the save, dirty against the saved form', () => {
    const start = { layout: 'a' }
    const edited = { layout: 'b' }
    expect(workingAfterSave(edited, start, start, key)).toEqual({ working: edited, baseline: 'a', dirty: true })
  })

  it('a newer buffer equal to the saved form reads clean', () => {
    const start = { layout: 'a' }
    const echo = { layout: 'a' }
    expect(workingAfterSave(echo, start, start, key)).toEqual({ working: echo, baseline: 'a', dirty: false })
  })
})
