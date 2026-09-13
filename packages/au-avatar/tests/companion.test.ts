import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, parseConfig, configFromProjection } from '../src/companion/config.ts'
import { Behavior } from '../src/companion/behavior.ts'
import { Flight, Heading, angleDelta, stepSpring } from '../src/companion/motion.ts'
import { GesturePlayer, GESTURE_DURATION, sampleGesture, type Gesture } from '../src/companion/gestures.ts'
import { avatarKind, parseAvatarPreset } from '../src/avatar-config.ts'

test('spring trajectory is independent of frame rate', () => {
  const simulate = (hz: number) => {
    const state = { position: -2, velocity: 1 }
    for (let i = 0; i < hz; i++) stepSpring(state, 3, 4, 1 / hz)
    return state
  }
  const a = simulate(30), b = simulate(144)
  assert.ok(Math.abs(a.position - b.position) < 1e-10)
  assert.ok(Math.abs(a.velocity - b.velocity) < 1e-10)
})

test('a reversal preserves position and momentum rather than snapping', () => {
  const flight = new Flight(); flight.targetX = 2
  flight.step(0.2, { x: 3, y: 3 }, false, false)
  const before = { ...flight.x }
  flight.targetX = -2
  assert.deepEqual(flight.x, before)
  flight.step(1 / 144, { x: 3, y: 3 }, false, false)
  assert.ok(Math.abs(flight.x.position - before.position) < 0.1)
  assert.ok(flight.x.velocity > 0)
})

test('target extremes and a shrinking pane cannot place the companion out of bounds', () => {
  const flight = new Flight(); flight.targetX = 1e8; flight.targetY = -1e8
  for (let i = 0; i < 300; i++) {
    flight.step(1 / 60, { x: 2, y: 1 }, false, false)
    assert.ok(Math.abs(flight.x.position) <= 2 && Math.abs(flight.y.position) <= 1)
  }
  flight.step(0, { x: 0, y: 0 }, false, false)
  assert.ok(flight.x.position === 0 && flight.y.position === 0)
  assert.equal(flight.x.velocity, 0); assert.equal(flight.y.velocity, 0)
})

test('dragging follows the grab point and records bounded velocity for banking', () => {
  const flight = new Flight(); flight.targetX = 0.8; flight.targetY = -0.2
  flight.step(1 / 60, { x: 2, y: 1 }, true, false)
  assert.equal(flight.x.position, 0.8); assert.equal(flight.y.position, -0.2)
  assert.ok(flight.x.velocity > 0 && flight.x.velocity <= 12)
})

test('reduced motion has no animated travel or retained momentum', () => {
  const flight = new Flight(); flight.targetX = 1; flight.x.velocity = 5
  flight.step(1 / 60, { x: 2, y: 1 }, false, true)
  assert.equal(flight.x.position, 1); assert.equal(flight.x.velocity, 0)
})

test('inactivity curls up, pointer activity does not wake sleep, deliberate wake does', () => {
  const behavior = new Behavior({ ...DEFAULT_CONFIG, idleSeconds: 5 })
  behavior.update(5.1, false)
  assert.equal(behavior.sleeping, true)
  behavior.activity(); behavior.update(0.1, false)
  assert.equal(behavior.sleeping, true)
  behavior.wake(); behavior.update(0.1, false)
  assert.equal(behavior.sleeping, false); assert.equal(behavior.state, 'waking')
})

test('a held drag does not fall asleep and release restarts the inactivity timer', () => {
  const behavior = new Behavior({ ...DEFAULT_CONFIG, idleSeconds: 5, startSleeping: true })
  behavior.grab(); behavior.update(20, false)
  assert.equal(behavior.state, 'dragging'); assert.equal(behavior.sleeping, false)
  behavior.release(); behavior.update(4, false)
  assert.equal(behavior.sleeping, false)
  behavior.update(2, false); assert.equal(behavior.sleeping, true)
})

test('reduced motion changes the sleeping posture immediately', () => {
  const behavior = new Behavior({ ...DEFAULT_CONFIG })
  behavior.rest(); behavior.update(0.01, true)
  assert.equal(behavior.sleep, 1)
  behavior.wake(); behavior.update(0.01, true)
  assert.equal(behavior.sleep, 0)
})

test('import validates ranges, types, colors and own property names', () => {
  for (const invalid of [{ size: 0 }, { motion: NaN }, { idleSeconds: Infinity }, { glasses: 'true' },
    { rugColor: 'url(example)' }, { mystery: true }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => parseConfig(invalid))
  }
  assert.deepEqual(parseConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG))), DEFAULT_CONFIG)
})

test('projection configuration accepts framework fields without admitting them to a preset', () => {
  const config = configFromProjection({ character: 'capybara', backdrop: false, size: 0.5, glasses: false })
  assert.equal(config.size, 0.5); assert.equal(config.glasses, false)
  assert.equal(Object.hasOwn(config, 'character'), false)
})

test('all gestures finish at neutral with finite poses', () => {
  for (const gesture of Object.keys(GESTURE_DURATION) as Gesture[]) {
    for (let t = 0; t < GESTURE_DURATION[gesture]; t += 1 / 60) {
      assert.ok(Object.values(sampleGesture(gesture, t)).every(Number.isFinite))
    }
    assert.ok(Object.values(sampleGesture(gesture, GESTURE_DURATION[gesture])).every(value => value === 0))
  }
})

test('jump anticipates, leaves the carpet and settles without sinking below it', () => {
  assert.ok(sampleGesture('jump', 0.18).squash > 0)
  assert.ok(sampleGesture('jump', 0.52).lift > 0.4)
  for (let t = 0; t < 1.4; t += 1 / 60) assert.ok(sampleGesture('jump', t).lift >= 0)
  assert.equal(sampleGesture('jump', 1.4).lift, 0)
  assert.ok(Math.abs(sampleGesture('jump', 0.24 - 1e-6).squash - sampleGesture('jump', 0.24).squash) < 1e-5)
})

test('interrupting a wave blends from the current pose rather than popping', () => {
  const player = new GesturePlayer(); player.play('wave'); player.update(0.8)
  const before = { ...player.pose }; player.play('nod'); player.update(0)
  assert.deepEqual(player.pose, before)
  player.update(0.2, true)
  assert.ok(Object.values(player.pose).every(value => value === 0))
})

test('avatar selection survives a preset round trip and rejects unknown characters', () => {
  for (const character of ['umbra', 'sphere', 'capybara'] as const) {
    const preset = { ...DEFAULT_CONFIG, character, backdrop: false }
    assert.deepEqual(parseAvatarPreset(JSON.parse(JSON.stringify(preset))), preset)
  }
  assert.equal(avatarKind(undefined), 'umbra')
  assert.throws(() => avatarKind('missing-character'))
  assert.throws(() => parseAvatarPreset({ ...DEFAULT_CONFIG, character: 'capybara', backdrop: 'false' }))
})


test('orbit remains inside the window at every edge, including tiny viewports', async () => {
  const { orbitTarget } = await import('../src/companion/motion.ts')
  for (const bounds of [{ x: 5, y: 3 }, { x: 0.1, y: 0 }, { x: 0, y: 0 }]) {
    for (let phase = 0; phase < Math.PI * 2; phase += 0.05) {
      for (const x of [-100, 0, 100]) for (const y of [-100, 0, 100]) {
        const target = orbitTarget({ x, y }, bounds, phase, 2)
        assert.ok(Math.abs(target.x) <= bounds.x + 1e-10)
        assert.ok(Math.abs(target.y) <= bounds.y + 1e-10)
      }
    }
  }
})


test('heading crosses the angle seam by the short route and limits reversal speed', () => {
  const heading = new Heading(); heading.angle = Math.PI - 0.02
  heading.update(-Math.PI + 0.02, 1 / 60, false)
  assert.ok(heading.angle > Math.PI - 0.02)
  const before = heading.angle
  heading.update(0, 1 / 60, false)
  assert.ok(Math.abs(heading.angle - before) <= 2.8 / 60 + 1e-10)
  for (let i = 0; i < 600; i++) heading.update(0, 1 / 60, false)
  assert.ok(Math.abs(angleDelta(heading.angle, 0)) < 1e-8)
  heading.update(1, 1 / 60, true)
  assert.equal(heading.angle, 1); assert.equal(heading.rate, 0)
})

test('observed clicks react nearby with a cooldown, never waking sleep or interrupting a gesture', () => {
  const behavior = new Behavior(DEFAULT_CONFIG)
  behavior.observeClick(false); assert.equal(behavior.expression.gesture, null)
  behavior.observeClick(true); assert.equal(behavior.expression.gesture, 'nod')
  behavior.update(1.3, false); behavior.observeClick(true)
  assert.equal(behavior.expression.gesture, null)
  behavior.update(4, false); behavior.observeClick(true)
  assert.equal(behavior.expression.gesture, 'blink')
  behavior.play('jump'); behavior.observeClick(true)
  assert.equal(behavior.expression.gesture, 'jump')
  behavior.rest(); behavior.observeClick(true)
  assert.equal(behavior.sleeping, true); assert.equal(behavior.expression.gesture, null)
})

test('navigation drifts on small corrections, commits to sustained travel, and settles from a rear view', async () => {
  const { Navigation } = await import('../src/companion/navigation.ts')
  const navigation = new Navigation()
  for (let i = 0; i < 60; i++) navigation.update(Math.PI, 30, 20, true, 1 / 60, false)
  assert.equal(navigation.mode, 'drifting')
  assert.ok(Math.abs(navigation.heading.angle) < 0.4)
  for (let i = 0; i < 120; i++) navigation.update(Math.PI, 150, 200, true, 1 / 60, false)
  assert.equal(navigation.mode, 'travelling')
  assert.ok(Math.abs(angleDelta(navigation.heading.angle, Math.PI)) < 0.1)
  for (let i = 0; i < 240; i++) navigation.update(Math.PI, 0, 0, false, 1 / 60, false)
  assert.equal(navigation.mode, 'resting')
  assert.ok(Math.abs(angleDelta(navigation.heading.angle, 0)) < 0.001)
  assert.ok(Math.abs(navigation.lead) < 0.001)
})

test('moderate cursor travel turns promptly and keeps turning during catch-up', async () => {
  const { Navigation } = await import('../src/companion/navigation.ts')
  const navigation = new Navigation()
  for (let i = 0; i < 12; i++) navigation.update(1.4, 55, 40, true, 1 / 60, false)
  assert.equal(navigation.mode, 'travelling')
  const before = navigation.heading.angle
  for (let i = 0; i < 30; i++) navigation.update(1.4, 25, 10, false, 1 / 60, false)
  assert.equal(navigation.mode, 'travelling')
  assert.ok(navigation.heading.angle > before)
  for (let i = 0; i < 6; i++) navigation.update(-1.4, 3, 1, false, 1 / 60, false)
  assert.equal(navigation.mode, 'travelling')
  for (let i = 0; i < 240; i++) navigation.update(-1.4, 0, 0, false, 1 / 60, false)
  assert.equal(navigation.mode, 'resting')
  assert.ok(Math.abs(angleDelta(navigation.heading.angle, 0)) < 0.001)
})


test('pointer clearance includes the silhouette and finds room near window edges', async () => {
  const { keepPointerClear } = await import('../src/companion/motion.ts')
  const bounds = { x: 5, y: 3 }, clearance = { x: 1.8, y: 1.2 }
  for (const x of [-5, 0, 5]) for (const y of [-3, 0, 3]) {
    const pointer = { x, y }, target = keepPointerClear(pointer, pointer, bounds, clearance)
    assert.ok(Math.abs(target.x - x) >= clearance.x - 1e-8 || Math.abs(target.y - y) >= clearance.y - 1e-8)
    assert.ok(Math.abs(target.x) <= bounds.x && Math.abs(target.y) <= bounds.y)
  }
  const tiny = keepPointerClear({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, clearance)
  assert.deepEqual(tiny, { x: 0, y: 0 })
})


test('makeear flaps both directions and settles; reduced motion suppresses it', () => {
  const samples = Array.from({ length: 180 }, (_, i) => sampleGesture('makeear', i / 100).earFlap)
  assert.ok(Math.max(...samples) > 0.7)
  assert.ok(Math.min(...samples) < -0.7)
  assert.equal(sampleGesture('makeear', 1.8).earFlap, 0)
  const player = new GesturePlayer(); player.play('makeear'); player.update(0.3, true)
  assert.equal(player.pose.earFlap, 0)
})

test('plush companion is preserved by preset import/export', () => {
  const preset = parseAvatarPreset({ character: 'schnappa', motion: 0.4 })
  assert.equal(parseAvatarPreset(JSON.parse(JSON.stringify(preset))).character, 'schnappa')
})

test('follow quiet zone does not retarget for tiny pointer corrections', async () => {
  const { Follow } = await import('../src/companion/follow.ts')
  const a=new Follow(),b=new Follow(),bounds={x:10,y:8},clearance={x:1,y:1}
  a.update({x:0,y:0},{x:4,y:0},bounds,clearance,0.01)
  b.update({x:0,y:0},{x:4,y:0},bounds,clearance,0.01)
  for(let i=0;i<60;i++) {
    assert.deepEqual(a.update({x:0,y:0},{x:4,y:0},bounds,clearance,0.01),b.update({x:0.03,y:0.02},{x:4,y:0},bounds,clearance,0.01))
  }
})

test('follow target eases on reversal and rests below the working line', async () => {
  const { Follow } = await import('../src/companion/follow.ts')
  const follow=new Follow(),bounds={x:10,y:8},clearance={x:1,y:1},pos={x:4,y:-2}
  let target=pos
  for(let i=0;i<240;i++) target=follow.update({x:0,y:0},pos,bounds,clearance,0.01)
  assert.ok(target.y < -1)
  const next=follow.update({x:3,y:0},pos,bounds,clearance,0.01)
  assert.ok(Math.hypot(next.x-target.x,next.y-target.y)<0.2)
})

test('work pauses chasing until release, quiet time and a deliberate area change', async () => {
  const { WorkAttention } = await import('../src/companion/attention.ts')
  const a=new WorkAttention();a.move(100,100,0);a.work(0,true)
  a.move(500,100,2);a.update(3);assert.equal(a.parked,true)
  a.release(3);a.move(500,100,3.2);a.update(3.5);assert.equal(a.parked,true)
  a.move(500,100,4);a.update(4.2);assert.equal(a.parked,true)
  a.update(4.3);assert.equal(a.parked,false)
  a.work(5);a.move(510,100,6);a.update(7);assert.equal(a.parked,true)
})


test('Umbra material settings survive presets and reject unsafe numeric values', () => {
  const preset = parseAvatarPreset({ character: 'umbra', umbraDetail: 0.8, umbraSoftness: 0.02, umbraBrightness: 1.2, umbraLightAngle: 45 })
  assert.deepEqual(parseAvatarPreset(JSON.parse(JSON.stringify(preset))), preset)
  assert.throws(() => parseAvatarPreset({ character: 'umbra', umbraBrightness: Infinity }))
  assert.throws(() => parseAvatarPreset({ character: 'umbra', umbraDetail: 2 }))
})
