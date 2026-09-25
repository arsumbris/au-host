import { describe, expect, it } from 'vitest'
import { UNSAVED_COMPOSITION } from '@arsumbris/au-host-sdk'
import { layoutLabelOf } from '../../packages/au-host-launcher/src/layout-label'

describe('the launcher layout label', () => {
  it('names a composition by its file, and the unsaved one by what it is', () => {
    expect(layoutLabelOf('/ws/layouts/studio.yaml')).toBe('studio')
    expect(layoutLabelOf(UNSAVED_COMPOSITION)).toBe('Unsaved layout')
    expect(layoutLabelOf(undefined)).toBeUndefined()
  })
})
