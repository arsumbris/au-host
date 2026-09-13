import { angleDelta, clamp, damp, Heading } from './motion.ts'

/** Enter travel easily, then keep the turn through deceleration before settling. */
export class Navigation {
  readonly heading = new Heading()
  lead = 0
  mode: 'resting' | 'drifting' | 'travelling' = 'resting'
  private held = 0
  private quiet = 0
  private direction = 0

  update(direction: number, speedPixels: number, distancePixels: number, active: boolean, dt: number, reduced: boolean): void {
    const journey = active && speedPixels > 30 && distancePixels > 26
    this.held = journey ? this.held + dt : Math.max(0, this.held - dt)
    this.quiet = speedPixels < 12 ? this.quiet + dt : 0
    if (reduced) this.mode = 'resting'
    else if (this.mode === 'travelling') {
      if (this.quiet > 0.4) this.mode = 'resting'
    } else if (this.held > 0.12) this.mode = 'travelling'
    else this.mode = active && speedPixels > 8 ? 'drifting' : 'resting'

    // Ignore unstable velocity headings at the very end of an arrival.
    if (speedPixels > 12) this.direction += angleDelta(this.direction, direction) * (1 - Math.exp(-7 * dt))
    const target = this.mode === 'travelling' ? this.direction : this.mode === 'drifting' ? clamp(angleDelta(0, this.direction), -0.32, 0.32) : 0
    this.heading.update(reduced ? 0 : target, dt, reduced)
    const anticipation = this.mode === 'travelling' || journey ? clamp(angleDelta(this.heading.angle, this.direction), -0.38, 0.38) : 0
    this.lead = reduced ? 0 : damp(this.lead, anticipation, 7, dt)
  }
}
