import { angleDelta, clamp } from './motion.ts'

/** Screen-space attention: vertical cursor movement must never turn the head sideways. */
export function cursorAttention(dx: number, dy: number, radius: number, cameraYaw: number, heading: number) {
  const depth = Math.max(radius, 1)
  const horizontal = Math.atan2(dx, depth)
  return {
    yaw: angleDelta(heading, cameraYaw + horizontal),
    pitch: clamp(Math.atan2(dy, depth * 0.7), -0.4, 0.4),
    gazeX: clamp(dx / depth, -1, 1),
    gazeY: clamp(dy / depth, -1, 1),
  }
}

/** Local input activity pauses travel without claiming knowledge of editor content. */
export class WorkAttention {
  parked = false
  private held = false
  private quietUntil = 0
  private anchor = { x: 0, y: 0 }
  private pointer = { x: 0, y: 0 }
  private movedSince: number | null = null

  work(time: number, held = false): void {
    this.parked = true; this.held ||= held
    this.quietUntil = time + 0.7; this.anchor = { ...this.pointer }; this.movedSince = null
  }
  release(time: number): void { this.held = false; this.quietUntil = time + 0.7 }
  move(x: number, y: number, time: number): void {
    this.pointer = { x, y }
    if (!this.parked || this.held || time < this.quietUntil) { this.movedSince = null; return }
    if (Math.hypot(x-this.anchor.x,y-this.anchor.y) < 96) this.movedSince = null
    else this.movedSince ??= time
  }
  update(time: number): void {
    if (!this.held && this.movedSince !== null && time-this.movedSince >= 0.25) this.reset()
  }
  reset(): void { this.parked = false; this.held = false; this.movedSince = null }
}
