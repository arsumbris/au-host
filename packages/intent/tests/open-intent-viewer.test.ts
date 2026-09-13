// open-intent carries its selected viewer in with as a def-ref, so the type graph can validate it.

import { describe, expect, it } from 'vitest'

import { fileSelection } from '@arsumbris/selection'

import { openIntent, openIntentViewer } from '../src/index.ts'

describe('openIntent viewer pick', () => {
  const sel = fileSelection('notes/x.md')

  it('rides as a def-ref wikilink, and reads back to the bare type name', () => {
    const intent = openIntent(sel, undefined, 'aup-reader')
    expect(intent.with).toBe('[[aup-reader]]') // verifiable def-ref form
    expect(openIntentViewer(intent)).toBe('aup-reader')
  })

  it('omits `with` entirely when no viewer is chosen (the container resolves the default)', () => {
    const intent = openIntent(sel)
    expect('with' in intent).toBe(false)
    expect(openIntentViewer(intent)).toBeUndefined()
  })

  it('strips a ::repo qualifier when reading back', () => {
    expect(openIntentViewer({ type: 'open-intent', with: '[[aup-reader::aup-reader]]' } as never)).toBe('aup-reader')
  })

  it('the viewer pick composes with mode', () => {
    const intent = openIntent(sel, 'permanent', 'editor-pane')
    expect(intent.mode).toBe('permanent')
    expect(openIntentViewer(intent)).toBe('editor-pane')
  })
})
