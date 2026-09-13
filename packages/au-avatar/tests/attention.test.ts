import test from 'node:test'
import assert from 'node:assert/strict'
import { cursorAttention } from '../src/companion/attention.ts'

test('vertical attention does not bias horizontal turning', () => {
  const above = cursorAttention(0, 10, 12, 0.48, 0)
  const below = cursorAttention(0, -10, 12, 0.48, 0)
  assert.equal(above.yaw, below.yaw)
  assert.equal(above.gazeX, 0)
  assert.equal(above.pitch, -below.pitch)
})
test('the head continues an arc across distant app positions', () => {
  const yaws = [-24, -16, -8, 0, 8].map(x => cursorAttention(x, 10, 20, 0.48, 0).yaw)
  assert.ok(yaws.every((yaw, i) => i === 0 || yaw > yaws[i - 1]))
  assert.ok(yaws.every(yaw => Math.abs(yaw) < 1.05))
})
test('attention is relative to body heading and safe at zero radius', () => {
  assert.ok(Math.abs(cursorAttention(0, 0, 10, 0.48, 0.48).yaw) < 1e-10)
  assert.ok(Number.isFinite(cursorAttention(0, 0, 0, 0, 0).pitch))
})
