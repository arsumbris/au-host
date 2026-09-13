import test from 'node:test'
import assert from 'node:assert/strict'
import { pointerTurn } from '../src/umbra/attention.ts'

test('Umbra attention preserves all eight pointer directions with equal strength', () => {
  let magnitude = 0
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4
    const x = Math.cos(angle) * 200, y = Math.sin(angle) * 200
    const turn = pointerTurn(x, y, 100)
    assert.ok(Math.abs(turn.x * y - turn.y * x) < 1e-10)
    if (i === 0) magnitude = Math.hypot(turn.x, turn.y)
    assert.ok(Math.abs(Math.hypot(turn.x, turn.y) - magnitude) < 1e-12)
  }
})
test('Umbra attention is size independent, neutral at center, and bounded at distant edges', () => {
  assert.deepEqual(pointerTurn(0, 0, 100), { x: 0, y: 0 })
  const small = pointerTurn(30, -40, 50), large = pointerTurn(300, -400, 500)
  assert.ok(Math.abs(small.x-large.x) < 1e-12 && Math.abs(small.y-large.y) < 1e-12)
  assert.ok(Math.hypot(...Object.values(pointerTurn(1e6, 1e6, 1))) <= .95000000001)
})

import { Behavior } from '../src/companion/behavior.ts'
import { DEFAULT_CONFIG } from '../src/companion/config.ts'

test('Umbra ruminates without sleeping and immediately attends to activity', () => {
  const behavior = new Behavior({ ...DEFAULT_CONFIG, idleSeconds: 5 }, 'ruminate')
  behavior.update(6, false)
  assert.equal(behavior.state, 'ruminating')
  assert.equal(behavior.sleeping, false)
  assert.equal(behavior.sleep, 0)
  behavior.activity()
  assert.equal(behavior.state, 'attentive')
  behavior.emotion = 'focused'
  assert.equal(behavior.state, 'thinking')
  behavior.rest()
  behavior.update(1, true)
  assert.equal(behavior.state, 'ruminating')
  assert.equal(behavior.sleep, 0)
  behavior.grab()
  assert.equal(behavior.state, 'dragging')
})

test('transient missing layout cannot poison subsequent material turns', () => {
  for (const [x, y, radius] of [[Infinity, 1, 1], [0, NaN, 1], [1, 1, NaN]]) {
    assert.deepEqual(pointerTurn(x, y, radius), { x: 0, y: 0 })
  }
  const recovered = pointerTurn(30, -40, 50)
  assert.ok(Number.isFinite(recovered.x) && Number.isFinite(recovered.y))
})
