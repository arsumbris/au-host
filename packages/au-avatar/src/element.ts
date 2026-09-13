// `<au-avatar-sphere>` — a standalone, framework-agnostic custom element wrapping the
// WebGL toon sphere. Deliberately NOT a member of the swappable au-component-set: this is
// a bespoke animated brand element (a placeholder easter-egg), not a design-system atom, so
// it self-registers its own tag and owns its own shadow styles rather than going through the
// component-contract `register(api)` seam.
//
// Two modes, chosen by the `mode` attribute:
//   mode="1"  the launcher mark. No emotion — the eye just follows the cursor; a click
//             makes it briefly bounce.
//   mode="2"  the projection. It dozes in place with floating zZ. A tap shakes it; rapid
//             taps wake it (it looks around, does a loop, then dozes off). A 10s press-and-
//             hold gives it a top hat.
//

import { SphereRenderer } from './sphere-gl'

const TAG = 'au-avatar-sphere'

const RAPID_TAPS = 5 // taps to wake
const RAPID_WINDOW = 1500 // ms window they must land within
const HOLD_MS = 10_000 // press-and-hold to earn the top hat

const STYLE = `
  :host {
    display: inline-block;
    position: relative;
    width: 48px;
    height: 48px;
    -webkit-user-select: none;
    user-select: none;
    cursor: pointer;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  /* floating zZ while asleep */
  .zzz {
    position: absolute;
    font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
    font-weight: 700;
    color: var(--au-ink-3);
    opacity: 0;
  }
  :host([data-sleeping]) .zzz { animation: au-avatar-float 3.2s ease-in-out infinite; }
  .zzz:nth-child(1) { font-size: 0.7em; animation-delay: 0s; }
  .zzz:nth-child(2) { font-size: 0.95em; animation-delay: 0.5s; }
  .zzz:nth-child(3) { font-size: 1.25em; animation-delay: 1.0s; }
  @keyframes au-avatar-float {
    0%   { opacity: 0; transform: translate(0, 0) rotate(-6deg); }
    18%  { opacity: 0.9; }
    70%  { opacity: 0.9; }
    100% { opacity: 0; transform: translate(14px, -32px) rotate(10deg); }
  }
  /* top hat */
  .hat {
    position: absolute;
    left: 50%;
    transform: translate(-50%, 0) scale(0);
    transform-origin: 50% 100%;
    transition: transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1);
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35));
  }
  :host([data-hat]) .hat { transform: translate(-50%, 0) scale(1); }
  @media (prefers-reduced-motion: reduce) {
    :host([data-sleeping]) .zzz { animation-duration: 6s; }
    .hat { transition: none; }
  }
`

const HAT_SVG = `
  <svg class="hat" width="0" height="0" viewBox="0 0 120 92" aria-hidden="true">
    <ellipse cx="60" cy="82" rx="56" ry="10" fill="#15161b"/>
    <rect x="30" y="10" width="60" height="66" rx="6" fill="#1b1c22"/>
    <rect x="30" y="52" width="60" height="12" fill="#8d3b3b"/>
    <ellipse cx="60" cy="12" rx="30" ry="7" fill="#26272f"/>
  </svg>
`

export class AuAvatarSphereElement extends HTMLElement {
  static readonly tag = TAG
  static get observedAttributes(): string[] {
    return ['mode', 'color', 'outline']
  }

  private renderer: SphereRenderer | null = null
  private canvas!: HTMLCanvasElement
  private hatEl!: SVGElement
  private ro: ResizeObserver | null = null

  private taps: number[] = []
  private holdTimer = 0
  private holdConsumed = false
  private hat = false

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.renderer) return
    const r = this.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    // normalize by ~2x the sphere radius so a cursor near the element reaches the edge of
    // the gaze range without pinning; clamp so far-away cursors don't over-tilt.
    const span = Math.max(r.width, r.height)
    const gx = Math.max(-1, Math.min(1, (e.clientX - cx) / span))
    const gy = Math.max(-1, Math.min(1, (e.clientY - cy) / span))
    this.renderer.gazeTarget.x = gx
    this.renderer.gazeTarget.y = gy
  }

  // Read the mode from the ATTRIBUTE only — deliberately NOT a JS property. A `mode` getter
  // would make React (and any framework) try `element.mode = '1'`, which throws on a getter-only
  // property; config reaches a custom element as an attribute, so that is the only channel here.
  private get viewMode(): 1 | 2 {
    return this.getAttribute('mode') === '2' ? 2 : 1
  }

  connectedCallback(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = STYLE
    this.canvas = document.createElement('canvas')

    const overlay = document.createElement('div')
    overlay.className = 'overlay'
    overlay.innerHTML =
      `<span class="zzz">z</span><span class="zzz">z</span><span class="zzz">z</span>` + HAT_SVG
    root.append(style, this.canvas, overlay)
    this.hatEl = overlay.querySelector('.hat') as SVGElement

    const sleeping = this.viewMode === 2
    try {
      this.renderer = new SphereRenderer(this.canvas, {
        color: this.getAttribute('color') ?? undefined,
        outline: this.getAttribute('outline') ?? undefined,
        sleeping,
      })
    } catch (err) {
      // WebGL unavailable: fail soft — the element just stays an empty box.
      console.warn('[au-avatar]', err)
      return
    }
    this.renderer.onSleepChange = (s) => this.reflectSleeping(s)
    this.reflectSleeping(sleeping)
    this.renderer.start()

    this.ro = new ResizeObserver(() => this.layoutOverlay())
    this.ro.observe(this)
    this.layoutOverlay()

    window.addEventListener('pointermove', this.onPointerMove)
    this.addEventListener('pointerdown', this.onPointerDown)
    this.addEventListener('pointerup', this.onPointerUp)
    this.addEventListener('pointercancel', this.cancelHold)
    this.addEventListener('pointerleave', this.cancelHold)
  }

  disconnectedCallback(): void {
    window.removeEventListener('pointermove', this.onPointerMove)
    this.removeEventListener('pointerdown', this.onPointerDown)
    this.removeEventListener('pointerup', this.onPointerUp)
    this.removeEventListener('pointercancel', this.cancelHold)
    this.removeEventListener('pointerleave', this.cancelHold)
    this.cancelHold()
    this.ro?.disconnect()
    this.ro = null
    this.renderer?.dispose()
    this.renderer = null
  }

  attributeChangedCallback(): void {
    // Colour/outline changes take effect on the next mount; mode flips the sleep base.
    if (this.renderer && this.isConnected) {
      this.renderer.sleeping = this.viewMode === 2 && this.renderer.sleeping
    }
  }

  private reflectSleeping(s: boolean): void {
    if (s && this.viewMode === 2) this.setAttribute('data-sleeping', '')
    else this.removeAttribute('data-sleeping')
  }

  private layoutOverlay(): void {
    const r = this.getBoundingClientRect()
    const radius = Math.min(r.width, r.height) * 0.4
    const cx = r.width / 2
    const cy = r.height / 2
    // hat sits on the crown; scale it to the sphere
    const hatW = radius * 1.7
    this.hatEl.setAttribute('width', String(hatW))
    this.hatEl.setAttribute('height', String(hatW * (92 / 120)))
    ;(this.hatEl as unknown as HTMLElement).style.top = `${cy - radius - hatW * (92 / 120) * 0.72}px`
    // zZ drift from the upper-right of the crown
    const zs = this.shadowRoot?.querySelectorAll<HTMLElement>('.zzz') ?? []
    zs.forEach((z) => {
      z.style.left = `${cx + radius * 0.5}px`
      z.style.top = `${cy - radius * 0.5}px`
      z.style.fontSize = `${Math.max(10, radius * 0.5)}px`
    })
  }

  private onPointerDown = (): void => {
    if (this.viewMode !== 2) return
    this.holdConsumed = false
    this.cancelHold()
    this.holdTimer = window.setTimeout(() => {
      this.holdConsumed = true
      this.toggleHat()
    }, HOLD_MS)
  }

  private onPointerUp = (): void => {
    if (this.viewMode === 1) {
      this.renderer?.play('bounce')
      return
    }
    // mode 2 tap
    this.cancelHold()
    if (this.holdConsumed) {
      this.holdConsumed = false
      return // the hold already acted; not a tap
    }
    this.registerTap()
  }

  private cancelHold = (): void => {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
      this.holdTimer = 0
    }
  }

  private registerTap(): void {
    const r = this.renderer
    if (!r) return
    const now = performance.now()
    this.taps = this.taps.filter((t) => now - t < RAPID_WINDOW)
    this.taps.push(now)

    if (r.sleeping) {
      if (this.taps.length >= RAPID_TAPS) {
        this.taps = []
        r.wake()
      } else {
        r.play('shake')
      }
    }
    // awake taps are ignored — it's already up and about
  }

  private toggleHat(): void {
    this.hat = !this.hat
    if (this.hat) this.setAttribute('data-hat', '')
    else this.removeAttribute('data-hat')
  }
}

/** Register `<au-avatar-sphere>` once. Safe to call repeatedly. */
export function defineAuAvatarSphere(): void {
  if (!customElements.get(TAG)) customElements.define(TAG, AuAvatarSphereElement)
}
