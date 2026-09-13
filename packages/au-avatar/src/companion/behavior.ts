import type { CompanionConfig } from './config'
import type { Emotion } from './capybara'
import { GesturePlayer, type Gesture } from './gestures.ts'
import { damp, smooth } from './motion.ts'

export type CompanionState = 'attentive' | 'ruminating' | 'thinking' | 'awake' | 'dragging' | 'settling' | 'sleeping' | 'waking'

/** Character decisions are independent of DOM events and rendering. */
export class Behavior {
  time = 0
  sleep = 0
  sleeping = false
  ruminating = false
  dragging = false
  emotion: Emotion = 'content'
  readonly expression = new GesturePlayer()
  bubble = ''
  bubbleUntil = 0
  private lastActivity = 0
  private nextReaction = 0
  private reactionCount = 0
  private nextBlink = 3.2
  blink = 0

  constructor(private config: CompanionConfig, private restMode: 'sleep' | 'ruminate' = 'sleep') {
    this.sleeping = restMode === 'sleep' && config.startSleeping
    this.ruminating = restMode === 'ruminate' && config.startSleeping
    this.sleep = this.sleeping ? 1 : 0
  }

  configure(config: CompanionConfig): void { this.config = config }
  activity(): void { this.lastActivity = this.time; this.ruminating = false }
  wake(): void { this.sleeping = false; this.activity(); this.say('Hello.'); this.play('nod') }
  rest(): void { this.sleeping = this.restMode === 'sleep'; this.ruminating = this.restMode === 'ruminate'; this.expression.play(null); this.bubble = '' }
  say(text: string): void { this.bubble = text; this.bubbleUntil = this.time + 2.5 }
  play(gesture: Gesture): void { this.expression.play(gesture); this.activity() }
  grab(): void { this.sleeping = false; this.dragging = true; this.expression.play(null); this.bubble = ''; this.activity() }
  release(): void { this.dragging = false; this.activity() }
  observeClick(nearby: boolean): void {
    if (this.sleeping || this.dragging || !nearby) return
    this.activity()
    if (this.time < this.nextReaction || this.expression.gesture) return
    this.nextReaction = this.time + 5
    this.play(this.reactionCount++ % 2 === 0 ? 'nod' : 'blink')
  }

  get state(): CompanionState {
    if (this.dragging) return 'dragging'
    if (this.restMode === 'ruminate') return this.ruminating ? 'ruminating' : this.emotion === 'focused' ? 'thinking' : 'attentive'
    if (this.sleeping) return this.sleep > 0.98 ? 'sleeping' : 'settling'
    return this.sleep > 0.02 ? 'waking' : 'awake'
  }

  update(dt: number, reduced: boolean): void {
    this.time += dt
    if (!this.sleeping && !this.ruminating && !this.dragging && this.time - this.lastActivity >= this.config.idleSeconds) this.rest()
    this.sleep = reduced ? Number(this.sleeping) : damp(this.sleep, Number(this.sleeping), 3.5, dt)
    this.expression.update(dt, reduced)
    if (this.time >= this.nextBlink + 0.22) this.nextBlink = this.time + 2.6 + Math.random() * 3.5
    const t = (this.time - this.nextBlink) / 0.22
    this.blink = t >= 0 && t <= 1 ? smooth(t < 0.45 ? t / 0.45 : (1 - t) / 0.55) : 0
  }
}
