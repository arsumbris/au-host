export interface Spring { position: number; velocity: number }
export interface Bounds { x: number; y: number }

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
export const damp = (a: number, b: number, rate: number, dt: number): number => b + (a - b) * Math.exp(-rate * dt)
export const smooth = (t: number): number => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x) }

/** Exact critically damped spring step. Retargeting preserves current velocity. */
export function stepSpring(s: Spring, target: number, frequency: number, dt: number): void {
  const displacement = s.position - target
  const impulse = s.velocity + frequency * displacement
  const decay = Math.exp(-frequency * dt)
  s.position = target + (displacement + impulse * dt) * decay
  s.velocity = (s.velocity - frequency * impulse * dt) * decay
}

export function constrain(s: Spring, extent: number): void {
  const bound = Math.max(0, extent)
  const position = clamp(s.position, -bound, bound)
  if (position !== s.position) { s.position = position; s.velocity = 0 }
}

/** X and Y settle at different rates, making diagonal approaches arc gently. */
export class Flight {
  readonly x: Spring = { position: 0, velocity: 0 }
  readonly y: Spring = { position: 0, velocity: 0 }
  targetX = 0
  targetY = 0

  step(dt: number, bounds: Bounds, direct: boolean, reduced: boolean): void {
    this.targetX = clamp(this.targetX, -bounds.x, bounds.x)
    this.targetY = clamp(this.targetY, -bounds.y, bounds.y)
    if (direct && !reduced) {
      this.x.velocity = dt > 0 ? damp(this.x.velocity, clamp((this.targetX - this.x.position) / dt, -12, 12), 12, dt) : 0
      this.y.velocity = dt > 0 ? damp(this.y.velocity, clamp((this.targetY - this.y.position) / dt, -12, 12), 12, dt) : 0
      this.x.position = this.targetX; this.y.position = this.targetY
    } else if (reduced) {
      this.x.position = this.targetX; this.y.position = this.targetY
      this.x.velocity = this.y.velocity = 0
    } else {
      stepSpring(this.x, this.targetX, 4.0, dt)
      stepSpring(this.y, this.targetY, 3.1, dt)
    }
    constrain(this.x, bounds.x); constrain(this.y, bounds.y)
  }
}

/** Keep the whole orbit inside the available flight area, including near window edges. */
export function orbitTarget(pointer: { x: number; y: number }, bounds: Bounds, phase: number, radius: number): { x: number; y: number } {
  const rx = Math.min(radius, bounds.x), ry = Math.min(radius * 0.7, bounds.y)
  return {
    x: clamp(pointer.x, -bounds.x + rx, bounds.x - rx) + Math.cos(phase) * rx,
    y: clamp(pointer.y, -bounds.y + ry, bounds.y - ry) + Math.sin(phase) * ry,
  }
}

export const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))

/** Bounded shortest-path steering holds a heading through small velocity fluctuations. */
export class Heading {
  angle = 0
  rate = 0
  update(target: number, dt: number, reduced: boolean): void {
    if (reduced) { this.angle = target; this.rate = 0; return }
    const step = clamp(angleDelta(this.angle, target) * (1 - Math.exp(-5 * dt)), -2.8 * dt, 2.8 * dt)
    this.angle += step
    this.rate = damp(this.rate, dt > 0 ? step / dt : 0, 8, dt)
  }
}

/** Reserve space around the pointer for the full character silhouette, not just its center. */
export function keepPointerClear(target: { x: number; y: number }, pointer: { x: number; y: number }, bounds: Bounds, clearance: Bounds): { x: number; y: number } {
  const fit = (p: { x: number; y: number }) => ({ x: clamp(p.x, -bounds.x, bounds.x), y: clamp(p.y, -bounds.y, bounds.y) })
  const clear = (p: { x: number; y: number }) => Math.abs(p.x - pointer.x) >= clearance.x - 1e-8 || Math.abs(p.y - pointer.y) >= clearance.y - 1e-8
  const preferred = fit(target)
  if (clear(preferred)) return preferred
  const candidates = [
    fit({ x: preferred.x, y: pointer.y + clearance.y }), fit({ x: preferred.x, y: pointer.y - clearance.y }),
    fit({ x: pointer.x + clearance.x, y: preferred.y }), fit({ x: pointer.x - clearance.x, y: preferred.y }),
  ]
  const available = candidates.filter(clear)
  if (available.length) return available.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y))[0]
  // A tiny viewport may not fit the requested clearance; use the greatest available separation.
  return candidates.sort((a, b) => Math.hypot(b.x - pointer.x, b.y - pointer.y) - Math.hypot(a.x - pointer.x, a.y - pointer.y))[0]
}
