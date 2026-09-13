import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickNode, reserveLabel, frameEase, paletteIndex, hoverEdgeAlpha } from '../src/interaction.ts'

test('small nodes remain pickable ten screen pixels away at every zoom', () => {
  const node = { x: 100, y: 100 }
  for (const scale of [.05, .5, 1, 8]) {
    assert.equal(pickNode([node], 100 + 9 / scale, 100, scale, () => 1), node)
    assert.equal(pickNode([node], 100 + 12 / scale, 100, scale, () => 1), null)
  }
})
test('overlapping hit targets choose closest node rather than array order', () => {
  const a = { x: 0, y: 0 }; const b = { x: 8, y: 0 }
  assert.equal(pickNode([a, b], 7, 0, 1, () => 2), b)
  assert.equal(pickNode([b, a], 1, 0, 1, () => 2), a)
})
test('label collision preserves priority and allows separated labels', () => {
  const occupied: { x: number; y: number; width: number; height: number }[] = []
  assert.equal(reserveLabel(occupied, { x: 0, y: 0, width: 100, height: 17 }), true)
  assert.equal(reserveLabel(occupied, { x: 90, y: 8, width: 100, height: 17 }), false)
  assert.equal(reserveLabel(occupied, { x: 0, y: 18, width: 100, height: 17 }), true)
  assert.equal(occupied.length, 2)
})

test('hover converges equally over the same duration at 30, 60 and 120Hz', () => {
  const positions = [30,60,120].map(hz => {
    let position=0
    for(let i=0;i<hz;i++) position += (1-position)*frameEase(.12,1000/hz)
    return position
  })
  for(const position of positions) assert(Math.abs(position-positions[0]!)<1e-12)
  assert.equal(frameEase(.12,0),0)
  assert.equal(frameEase(1,16),1)
})
test('categorical identity stays stable when unrelated repositories appear or disappear', () => {
  const initial = ['notes','schema'].map(id=>[id,paletteIndex(id,8)])
  const expanded = new Map(['a-new-repo','notes','schema'].map(id=>[id,paletteIndex(id,8)]))
  for(const [id,index] of initial) assert.equal(expanded.get(id as string),index)
  for(const id of ['notes','schema','中文']) assert(paletteIndex(id,8)>=0 && paletteIndex(id,8)<8)
})

test('hub highlighting gets quieter as incident edges accumulate',()=>{
 assert.equal(hoverEdgeAlpha(1),hoverEdgeAlpha(8))
 assert(hoverEdgeAlpha(64)<hoverEdgeAlpha(16))
 assert(hoverEdgeAlpha(64)<.13)
 assert(hoverEdgeAlpha(10000)>=.08)
})
