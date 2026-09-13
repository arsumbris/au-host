// The toon-eye sphere, drawn in raw WebGL with zero dependencies.
//
// The whole look is a single fragment shader over one full-canvas quad: an analytic
// ray→sphere hit gives the surface normal per fragment, and the toon banding + the lit
// "pupil" band that tracks the light + the blink lids are computed straight from that
// normal and a light direction. There is no scene, camera, mesh or matrix maths — an
// orthographic sphere is just `z = sqrt(R^2 - d^2)` off the disc, so the normal is free.
//
// The rim outline is computed as a screen-space ring.

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAG = `
precision highp float;

uniform vec2  uCenter;    // sphere centre, in gl_FragCoord space (y up), pixels
uniform float uRadius;    // sphere radius, pixels
uniform vec3  uLightDir;  // gaze/light direction, view space (z toward the viewer)
uniform vec3  uColor;     // body colour
uniform vec3  uOutline;   // rim outline colour
uniform float uBlink;     // 0 eye open .. 1 lids fully shut
uniform float uPupil;     // size of the bright pupil band (0 small .. 1 big)
uniform float uMid;       // mid-band size (dark->mid boundary)
uniform float uBands;     // number of toon bands

void main() {
  vec2  p = gl_FragCoord.xy - uCenter;
  float d = length(p);
  float R = uRadius;

  // Antialiased silhouette: full alpha inside, feathered across ~1.5px at the rim.
  float inSphere = 1.0 - smoothstep(R - 1.5, R + 1.5, d);
  if (inSphere <= 0.0) discard;

  // Orthographic normal straight off the disc.
  float zz = sqrt(max(R * R - d * d, 0.0));
  vec3  N  = normalize(vec3(p.x, p.y, zz));
  vec3  L  = normalize(uLightDir);
  float ndl = dot(N, L);

  // ── Flat toon shading; band PLACEMENT tracks the light, colours are flat body tones. ──
  float Nb     = max(floor(uBands + 0.5), 1.0);
  float tLight = mix(0.82, 0.50, uPupil);   // pupil band lower edge
  float tDark  = mix(0.42, 0.05, uMid);     // dark->mid boundary
  float denom  = max(Nb - 1.0, 1.0);

  float level;
  if (Nb < 1.5)           level = denom;                              // single flat band
  else if (ndl >= tLight) level = Nb - 1.0;                           // lightest = pupil
  else if (ndl <  tDark)  level = 0.0;                                // darkest
  else {
    float u = (ndl - tDark) / max(tLight - tDark, 1e-3);
    level = 1.0 + floor(u * max(Nb - 2.0, 0.0) * 0.99999);           // mid bands
  }

  float tone    = (Nb < 1.5) ? 1.0 : 0.16 * pow(10.625, level / denom);
  vec3  toonCol = uColor * tone;

  // ── Lids: recolour the lightest band down to the next band from the rim inward. ──
  vec3  lr = normalize(cross(vec3(0.0, 1.0, 0.0), L) + vec3(1e-4));
  vec3  lv = normalize(cross(L, lr));
  float nv = dot(N, lv);                                              // vertical pos across the eye
  float openH      = (1.0 - uBlink) * 0.8;
  float isLightest = step(Nb - 1.5, level);
  float bar = step(1.5, Nb) * isLightest * smoothstep(openH, openH + 0.04, abs(nv));
  float secondTone = 0.16 * pow(10.625, (Nb - 2.0) / denom);
  toonCol = mix(toonCol, uColor * secondTone, bar);

  // ── Rim outline: a thin screen-space ring at the silhouette. ──
  float rim = smoothstep(R - 2.5, R - 0.5, d);
  vec3  col = mix(toonCol, uOutline, rim * 0.85);

  gl_FragColor = vec4(col * inSphere, inSphere);   // premultiplied straight-alpha output
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('au-avatar: failed to create shader')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error('au-avatar: shader compile failed: ' + log)
  }
  return sh
}

/** A named gesture writes transient offsets into `Fx` for `dur` seconds. */
interface Fx {
  scaleMul: number
  blink: number
  lookDX: number
  lookDY: number
  look: { x: number; y: number } | null // absolute gaze override (wake look-around / loop)
}
type GestureFn = (t01: number, fx: Fx, tSec: number) => void
interface Gesture {
  dur: number
  fn: GestureFn
}

const GESTURES: Record<string, Gesture> = {
  // Click in mode 1: a springy scale pulse with a blink at the end.
  bounce: {
    dur: 0.7,
    fn: (t, f) => {
      f.scaleMul = 1 + 0.14 * Math.abs(Math.sin(t * Math.PI * 2))
      f.blink = t > 0.78 ? (t - 0.78) / 0.22 : 0
    },
  },
  // Tap while asleep: a small horizontal head-shake of the pupil.
  shake: {
    dur: 0.55,
    fn: (t, f) => {
      f.lookDX = Math.sin(t * Math.PI * 6) * 0.4 * (1 - t)
    },
  },
  // Rapid taps wake it: eyes open, it looks around, does one loop, then dozes off.
  wake: {
    dur: 4.2,
    fn: (t, f, ts) => {
      if (t < 0.5) {
        // look around — a couple of darting saccades
        const s = ts * 3.0
        f.look = { x: 0.7 * Math.sin(s), y: 0.35 * Math.sin(s * 1.7 + 1.0) }
        f.scaleMul = 1 + 0.04 * Math.sin(ts * 6)
      } else if (t < 0.78) {
        // the loop — the pupil rolls a full circle while the body arcs a little bob
        const u = (t - 0.5) / 0.28
        const ang = u * Math.PI * 2 - Math.PI / 2
        f.look = { x: Math.cos(ang) * 0.9, y: Math.sin(ang) * 0.9 }
        f.scaleMul = 1 + 0.18 * Math.sin(u * Math.PI)
      } else {
        // settle back toward centre before sleep reclaims it
        const u = (t - 0.78) / 0.22
        f.look = { x: 0, y: -0.2 * u }
      }
    },
  },
}

export interface SphereOptions {
  /** Body colour, hex like `#6f7682`. */
  color?: string
  /** Rim outline colour, hex. */
  outline?: string
  /** Start asleep (lids heavy, gaze drifting). Mode 2 does; mode 1 does not. */
  sleeping?: boolean
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * The sphere renderer. Owns a `<canvas>`'s GL context and an rAF loop. High-level intent
 * (which mode, taps, holds) lives in the custom element; this exposes the low-level levers:
 * a gaze target, gesture triggers, and the sleep flag. All values ease frame-rate-independently.
 */
export class SphereRenderer {
  private gl: WebGLRenderingContext
  private u: Record<string, WebGLUniformLocation | null> = {}
  private raf = 0
  private last = 0
  private t = 0

  private color: [number, number, number]
  private outline: [number, number, number]

  // eased "current" values the frame reads
  private curScale = 1
  private curLids = 0
  private curPupil = 0.5
  private curGazeX = 0
  private curGazeY = 0

  // gaze the pointer is steering toward (screen offset, roughly -1..1)
  gazeTarget = { x: 0, y: 0 }

  private gesture: Gesture | null = null
  private gestureName = ''
  private gestureT = 0
  private blinkTimer = 0
  private nextBlink = 3

  private _sleeping: boolean
  /** Fired when the sleep state flips (wake sequence ends → back to sleep, etc.). */
  onSleepChange: ((sleeping: boolean) => void) | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    opts: SphereOptions = {},
  ) {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    })
    if (!gl) throw new Error('au-avatar: WebGL is not available')
    this.gl = gl

    this.color = hexToRgb(opts.color ?? '#6f7682')
    this.outline = hexToRgb(opts.outline ?? '#c9cdd6')
    this._sleeping = opts.sleeping ?? false

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    const prog = gl.createProgram()
    if (!prog) throw new Error('au-avatar: failed to create program')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('au-avatar: program link failed: ' + gl.getProgramInfoLog(prog))
    }
    gl.useProgram(prog)

    // one full-canvas quad
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    for (const name of ['uCenter', 'uRadius', 'uLightDir', 'uColor', 'uOutline', 'uBlink', 'uPupil', 'uMid', 'uBands']) {
      this.u[name] = gl.getUniformLocation(prog, name)
    }

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied alpha
    gl.clearColor(0, 0, 0, 0)
  }

  get sleeping(): boolean {
    return this._sleeping
  }
  set sleeping(v: boolean) {
    if (v === this._sleeping) return
    this._sleeping = v
    this.onSleepChange?.(v)
  }

  play(name: keyof typeof GESTURES): void {
    this.gesture = GESTURES[name]
    this.gestureName = name
    this.gestureT = 0
  }

  /** Rapid-tap wake: opens the eye, looks around, loops, then dozes off again. */
  wake(): void {
    this.sleeping = false
    this.play('wake')
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.gl.viewport(0, 0, w, h)
  }

  start(): void {
    if (this.raf) return
    this.last = performance.now()
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop)
      const dt = Math.min((now - this.last) / 1000, 0.05)
      this.last = now
      this.frame(dt)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  dispose(): void {
    this.stop()
    const gl = this.gl
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private frame(dt: number): void {
    this.t += dt
    this.resize()

    // ── per-frame gesture offsets ──
    const fx: Fx = { scaleMul: 1, blink: 0, lookDX: 0, lookDY: 0, look: null }
    if (this.gesture) {
      this.gestureT += dt
      const t01 = this.gestureT / this.gesture.dur
      if (t01 >= 1) {
        const ended = this.gestureName
        this.gesture = null
        this.gestureName = ''
        if (ended === 'wake') this.sleeping = true // dozed off again
      } else {
        this.gesture.fn(t01, fx, this.t)
      }
    }

    // a soft involuntary blink cadence, layered on top (awake, between gestures)
    this.autoBlink(dt, fx)

    // ── resting mood: sleeping vs awake ──
    const k = 1 - Math.pow(0.0025, dt)
    const restLids = this._sleeping ? 0.86 : 0.0
    const restPupil = this._sleeping ? 0.32 : 0.5
    // asleep: gaze drifts gently downward and sways; awake: steer toward the pointer
    let gx = this.gazeTarget.x
    let gy = this.gazeTarget.y
    if (this._sleeping) {
      gx = 0.12 * Math.sin(this.t * 0.6)
      gy = -0.55 + 0.05 * Math.sin(this.t * 0.9)
    }
    if (fx.look) {
      gx = fx.look.x
      gy = fx.look.y
    }
    gx += fx.lookDX
    gy += fx.lookDY

    this.curLids += (restLids - this.curLids) * k
    this.curPupil += (restPupil - this.curPupil) * k
    this.curGazeX += (gx - this.curGazeX) * k
    this.curGazeY += (gy - this.curGazeY) * k

    // gentle breathing while asleep
    const breathe = this._sleeping ? 1 + 0.03 * Math.sin(this.t * 1.1) : 1
    this.curScale += (breathe - this.curScale) * k

    // ── draw ──
    const gl = this.gl
    gl.clear(gl.COLOR_BUFFER_BIT)

    const w = this.canvas.width
    const h = this.canvas.height
    const cx = w / 2
    const cy = h / 2
    // radius: fit the smaller half-extent with a margin; scale by mood + gesture bob
    const base = Math.min(w, h) * 0.4
    const R = base * this.curScale * fx.scaleMul

    // gaze → light direction: tilt a viewer-facing vector by the gaze offset. Screen +y
    // is down, GL space is y-up, so flip the y contribution.
    const lx = this.curGazeX
    const ly = -this.curGazeY
    const len = Math.hypot(lx, ly, 1)

    gl.uniform2f(this.u.uCenter, cx, cy)
    gl.uniform1f(this.u.uRadius, R)
    gl.uniform3f(this.u.uLightDir, lx / len, ly / len, 1 / len)
    gl.uniform3f(this.u.uColor, this.color[0], this.color[1], this.color[2])
    gl.uniform3f(this.u.uOutline, this.outline[0], this.outline[1], this.outline[2])
    gl.uniform1f(this.u.uBlink, Math.min(this.curLids + fx.blink, 1))
    gl.uniform1f(this.u.uPupil, Math.min(Math.max(this.curPupil, 0), 1))
    gl.uniform1f(this.u.uMid, 0.5)
    gl.uniform1f(this.u.uBands, 3)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // A slow involuntary blink, layered on whatever else is happening (skipped mid-gesture
  // and while asleep — the heavy lids already read as closed).
  private autoBlink(dt: number, fx: Fx): void {
    if (this.gesture || this._sleeping) {
      this.blinkTimer = 0
      return
    }
    this.blinkTimer += dt
    if (this.blinkTimer >= this.nextBlink + 0.22) {
      this.blinkTimer = 0
      this.nextBlink = 2.5 + Math.random() * 4
    }
    const bt = this.blinkTimer - this.nextBlink
    if (bt >= 0 && bt < 0.22) {
      fx.blink = bt < 0.1 ? bt / 0.1 : 1 - (bt - 0.1) / 0.12
    }
  }
}
