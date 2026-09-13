import { damp, smooth } from './motion.ts'

export type Gesture = 'nod' | 'wave' | 'surprise' | 'jump' | 'blink' | 'makeear'
export interface Expression {
  headPitch: number; headRoll: number; armRaise: number; wrist: number
  lift: number; squash: number; wideEyes: number; blink: number; earLift: number; earFlap: number
}

const NEUTRAL: Readonly<Expression> = Object.freeze({ headPitch: 0, headRoll: 0, armRaise: 0, wrist: 0, lift: 0, squash: 0, wideEyes: 0, blink: 0, earLift: 0, earFlap: 0 })
export const GESTURE_DURATION: Record<Gesture, number> = { wave: 2, nod: 1.15, surprise: 1.45, jump: 1.4, blink: 0.3, makeear: 1.8 }
const windowed = (t: number, start: number, rise: number, end: number, fall: number): number => smooth((t - start) / rise) * (1 - smooth((t - end) / fall))

/** Art-directed gesture channels; each motion returns exactly to its neutral pose. */
export function sampleGesture(gesture: Gesture | null, seconds: number): Expression {
  const p = { ...NEUTRAL }
  if (!gesture || seconds < 0 || seconds >= GESTURE_DURATION[gesture]) return p
  const t = seconds
  if (gesture === 'wave') {
    const envelope = windowed(t, 0, 0.34, 1.55, 0.45)
    p.armRaise = envelope * 2.5
    p.wrist = envelope * Math.sin((t - 0.32) * 15) * 0.38
    p.headRoll = -0.08 * envelope
    p.blink = windowed(t, 0.2, 0.08, 0.29, 0.12) * 0.2
  } else if (gesture === 'makeear') {
    const envelope = windowed(t, 0, 0.22, 1.18, 0.62)
    p.earFlap = Math.sin(t * Math.PI * 4) * envelope
    p.headRoll = Math.sin(t * Math.PI * 2) * envelope * 0.035
  } else if (gesture === 'nod') {
    const envelope = windowed(t, 0, 0.12, 0.8, 0.35)
    p.headPitch = envelope * (0.17 - 0.23 * Math.cos(t * Math.PI * 3.7))
    p.blink = Math.max(0, p.headPitch) * 0.45
  } else if (gesture === 'surprise') {
    const envelope = windowed(t, 0, 0.12, 0.65, 0.8)
    p.wideEyes = envelope * 0.4; p.earLift = envelope
    p.headPitch = -0.13 * envelope
    p.armRaise = 0.4 * envelope; p.squash = -0.035 * envelope
    p.lift = 0.07 * Math.sin(Math.min(1, t / 0.55) * Math.PI)
  } else if (gesture === 'jump') {
    if (t < 0.24) p.squash = 0.1 * Math.sin(t / 0.24 * Math.PI / 2)
    else if (t < 0.84) {
      const flight = (t - 0.24) / 0.6
      p.lift = 0.52 * 4 * flight * (1 - flight)
      p.squash = 0.1 * (1 - smooth(flight / 0.18)) - 0.07 * Math.sin(flight * Math.PI)
      p.armRaise = 0.35 * Math.sin(flight * Math.PI)
    } else {
      const settle = (t - 0.84) / 0.56
      p.squash = 0.1 * Math.sin(settle * Math.PI * 2) * Math.pow(1 - settle, 2)
    }
    p.headPitch = -p.lift * 0.12
  } else p.blink = Math.sin(t / 0.3 * Math.PI)
  return p
}

export class GesturePlayer {
  gesture: Gesture | null = null
  time = 0
  pose: Expression = { ...NEUTRAL }
  private from: Expression = { ...NEUTRAL }

  play(gesture: Gesture | null): void {
    this.from = { ...this.pose }; this.gesture = gesture; this.time = 0
  }

  update(dt: number, reduced = false): void {
    this.time += dt
    if (this.gesture && this.time >= GESTURE_DURATION[this.gesture]) this.gesture = null
    if (reduced) { this.pose = { ...NEUTRAL }; this.from = { ...NEUTRAL }; return }
    const target = sampleGesture(this.gesture, this.time), blend = smooth(this.time / 0.24)
    for (const key of Object.keys(target) as (keyof Expression)[]) {
      const value = this.from[key] + (target[key] - this.from[key]) * blend
      this.pose[key] = damp(this.pose[key], value, key === 'blink' || key === 'wrist' ? 28 : 16, dt)
      if (!this.gesture && Math.abs(this.pose[key]) < 0.00001) this.pose[key] = 0
    }
  }
}
