import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stableOpenSurfaces } from '../src/stable-open-surfaces.ts'
import type { OpenSurface } from '@arsumbris/au-host-sdk'
const surface = (projection: string): OpenSurface[] => [{ surfaceId: 'document', projection, windowId: 'local', contents: [{ identity: 'file:note.md', payload: { kind: 'file', path: 'note.md' } }] }]
test('mode handoff never publishes the temporary empty list', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const frames: OpenSurface[][] = []
  const list = stableOpenSurfaces(next => frames.push(next))
  list.update(surface('reader')); list.update([])
  t.mock.timers.tick(80)
  list.update(surface('editor')); t.mock.timers.tick(200)
  assert.deepEqual(frames.map(x => x[0]?.projection), ['reader', 'editor'])
  list.dispose()
})
test('a real close is reflected after the handoff window', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let shown: OpenSurface[] = []
  const list = stableOpenSurfaces(next => { shown = next })
  list.update(surface('reader')); list.update([])
  t.mock.timers.tick(160)
  assert.deepEqual(shown, [])
  list.dispose()
})
test('unmount cancels a pending list update', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const list = stableOpenSurfaces(() => calls++)
  list.update(surface('reader')); list.update([]); list.dispose()
  t.mock.timers.tick(200)
  assert.equal(calls, 1)
})
