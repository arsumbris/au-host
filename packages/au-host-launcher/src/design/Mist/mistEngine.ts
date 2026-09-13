/** Token-colored WebGL mist with cursor displacement and an animated dissolve.
 * Palette colors are sampled from CSS and passed to the shader as uniforms.
 * Parameter changes settle exponentially; dissolve completes before app reveal.
 */
const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`

const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform float D;
uniform float uFlow,uCovLo,uCovHi,uInten,uAlpha,uMouseAmt,uMouseRad,uGlow,uGlowMode,uDriftOut,uDriftDown;
uniform vec2 uMouse;
uniform vec3 uBase, uGlowTint;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.0+1.3;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/R; float asp=R.x/R.y;
  vec2 p=vec2(uv.x*asp,uv.y)*2.2;
  // dissolve DRIFT — as D rises the mist parts OUTWARD from centre (a curtain opening off both edges)
  // and sinks gently DOWN, so the field opens away from the launcher rather than sliding up-right.
  // Both amounts are token-tunable (uDriftOut / uDriftDown); this is ADDED to the erosion/thinning/glow
  // recipe below, not a replacement for it.
  p.x += (uv.x - 0.5) * D * uDriftOut * asp;   // symmetric: left edge pulled left, right edge right
  p.y -= D * uDriftDown;                         // positive uDriftDown = the field sinks downward
  // cursor displacement — part the mist near the pointer (off when uMouseAmt==0)
  float md=distance(uv,uMouse);
  float push=uMouseAmt*exp(-(md*md)/max(0.0001,uMouseRad*uMouseRad));
  p += (uv-uMouse)*vec2(asp,1.0)*push*3.0;
  // flowing domain warp — one fbm advects the next (visible, never-repeating flow)
  float t=T*uFlow;
  vec2 q=vec2(fbm(p+vec2(0.0,t)), fbm(p+vec2(4.7,2.1)-t));
  float d=fbm(p+2.1*q+vec2(t*0.5,t*0.3));
  float dap=smoothstep(uCovLo,uCovHi,d);
  // erosion dissolve
  float ero=fbm(p*1.25+vec2(-t*1.3,t*0.8));
  dap*=smoothstep(D*1.28-0.18, D*1.28+0.10, ero);
  dap*=(1.0-0.55*D);
  // soft vertical edges
  dap*=smoothstep(0.0,0.30,uv.y);
  dap*=smoothstep(1.0,0.86,uv.y);
  float dir=smoothstep(1.35,-0.05, uv.x*0.55 + (1.0-uv.y)*0.85);
  float vig=smoothstep(1.28,0.32,length((uv-0.5)*vec2(asp,1.0)));
  float old=step(uGlowMode,0.5);
  vec2 gc=mix(vec2(0.5,0.34), vec2(0.5,0.12), old);   // center: broad mode higher, compact mode lower
  float gsh=mix(2.6, 3.6, old);                        // falloff: broad or compact
  vec3 gcol=mix(uGlowTint, uGlowTint*0.62, old);       // Palette-derived glow tint
  vec2 gv=(uv-gc)*vec2(asp,1.0);
  float glow=exp(-dot(gv,gv)*gsh)*(1.0-D)*smoothstep(0.0,0.12,uv.y);
  float a=(dap*(0.58+0.5*dir) + glow*uGlow)*(0.72+0.28*vig)*uAlpha;
  vec3 warm=mix(uBase, gcol, clamp(glow*uGlow*1.6,0.0,1.0))*uInten;   // uBase = TOKEN-BRIDGED body grey
  gl_FragColor=vec4(warm, a);
}`

/* ── params ─────────────────────────────────────────────────────────────────────────────────────── */

export interface MistParams {
  /** Domain-warp flow speed (drift). Gentle on a launcher. */
  flow: number
  /** Cloud coverage (lower = more mist). */
  covLo: number
  /** Wisp contrast (upper edge). */
  covHi: number
  /** Mist brightness multiplier. */
  inten: number
  /** Overall opacity. */
  alpha: number
  /** Cursor-parting strength (0 = off). */
  mouseAmt: number
  /** Cursor influence radius. */
  mouseRad: number
  /** Glow-core strength. */
  glow: number
  /** 0 = compact radial glow · 1 = broader glow. */
  glowMode: number
  /** How far the dissolve parts the mist OUTWARD from centre (curtain off both edges). */
  driftOut: number
  /** How far the dissolve sinks the mist DOWN as it blows off. */
  driftDown: number
  /** Render resolution factor (perf). */
  scale: number
  /** Frame-gate target (frames/s). */
  fps: number
  /**
   * How much of the app's OWN palette hue the mist keeps (0 = fully desaturated dead grey, 1 = the
   * palette's warm umbra colour at full strength). Defaults subtle so the mist reads as our palette,
   * never neutral grey. Tunable on the bench.
   */
  tintAmt: number
}

export const DEFAULT_MIST_PARAMS: MistParams = {
  flow: 0.095,
  covLo: 0.38,
  covHi: 1.0,
  inten: 1.15,
  alpha: 1.05,
  mouseAmt: 0.12,
  mouseRad: 0.28,
  glow: 0.26,
  glowMode: 1,
  driftOut: 1.2,
  driftDown: 0.5,
  scale: 0.5,
  fps: 30,
  tintAmt: 1,
}

export interface MistOptions {
  /** Element to read the palette off (getComputedStyle). Default: document.documentElement. */
  root?: HTMLElement
  /** Partial param overrides on top of DEFAULT_MIST_PARAMS. */
  params?: Partial<MistParams>
  /** Re-read the palette when the root's theme attributes change. Default true. */
  watchTheme?: boolean
}

export interface DissolveOptions {
  /** Tween length in ms. Default 800. */
  duration?: number
  /** Easing t∈[0,1]→[0,1]. Default a soft ease-out. */
  easing?: (t: number) => number
}

export interface SetParamsOptions {
  /** Time to settle approximately 95% toward the target, in ms. Zero applies instantly. */
  duration?: number
}

export interface MistHandle {
  /** Set the dissolve amount directly (0 = full mist, 1 = gone). Cancels any running tween. */
  setD(d: number): void
  /** Current dissolve amount. */
  getD(): number
  /** Tween D from its current value to 1 (mist blows away). Resolves when complete. */
  dissolve(opts?: DissolveOptions): Promise<void>
  /**
   * Merge new look params (no recompile). By default the numeric params TWEEN from their current value
   * to the target over ~900ms on the rAF loop (a soft, continuous swell — so a boot-phase change reads
   * as a slow move, never a snap). Pass `{ duration: 0 }` for an instant set (bench slider drags).
   */
  setParams(p: Partial<MistParams>, opts?: SetParamsOptions): void
  /** Tear down: stop the loop, drop listeners, lose the GL context. */
  destroy(): void
}

/* ── colour helpers (token bridge) ──────────────────────────────────────────────────────────────── */

// One shared 1×1 2D context to normalise ANY CSS colour. Our themes declare colours as `oklch(...)`
// (see themes/*.theme.css), and a registered `<color>` @property serialises through getComputedStyle
// in a form a hand-written rgb()/hex regex does NOT cover — such a regex silently returns black for
// every oklch token (`--au-color-bg` → #000). Painting the colour and reading the pixel back lets
// the browser resolve oklch / color() / named / hex / rgb uniformly, then we read straight sRGB bytes.
let colorCtx: CanvasRenderingContext2D | null | undefined
function normalizeColor(input: string, fallback: [number, number, number]): [number, number, number] {
  const s = input.trim()
  if (!s) return fallback
  if (colorCtx === undefined) {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    colorCtx = c.getContext('2d', { willReadFrequently: true })
  }
  if (!colorCtx) return fallback
  try {
    colorCtx.clearRect(0, 0, 1, 1)
    // Seed FULLY-TRANSPARENT: an INVALID fillStyle assignment is ignored (the property keeps its prior
    // value), so a bad token leaves the seed and paints nothing → the pixel stays alpha 0 and we return
    // the fallback rather than stale data. Valid tokens paint opaque and we read straight sRGB bytes.
    colorCtx.fillStyle = 'transparent'
    colorCtx.fillStyle = s
    colorCtx.fillRect(0, 0, 1, 1)
    const d = colorCtx.getImageData(0, 0, 1, 1).data
    if (d[3] === 0) return fallback // paint didn't take (invalid colour) → fall back
    return [d[0] / 255, d[1] / 255, d[2] / 255]
  } catch {
    return fallback
  }
}

/** Rec.709 luminance of an sRGB triple (already 0..1). Desaturates to a neutral grey scalar. */
function luma([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const DEFAULT_EASE = cubicBezier(0.22, 1, 0.36, 1)

/** A cubic-bezier timing sampler (Newton-Raphson on x → y), matching CSS `cubic-bezier(x1,y1,x2,y2)`. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const fx = (t: number): number => ((ax * t + bx) * t + cx) * t
  const dfx = (t: number): number => (3 * ax * t + 2 * bx) * t + cx
  const fy = (t: number): number => ((ay * t + by) * t + cy) * t
  return (x: number): number => {
    let t = x
    for (let i = 0; i < 6; i++) {
      const e = fx(t) - x
      if (Math.abs(e) < 1e-4) break
      const d = dfx(t)
      if (Math.abs(d) < 1e-6) break
      t -= e / d
    }
    return fy(Math.max(0, Math.min(1, t)))
  }
}

/** Default time to settle approximately 95% toward a parameter target, in ms. */
const DEFAULT_SETPARAMS_MS = 3500
/** Numeric look params that TWEEN on an eased setParams. `scale`/`fps` are structural → snapped. */
const TWEEN_KEYS = [
  'flow', 'covLo', 'covHi', 'inten', 'alpha', 'mouseAmt', 'mouseRad',
  'glow', 'glowMode', 'driftOut', 'driftDown', 'tintAmt',
] as const satisfies readonly (keyof MistParams)[]

/**
 * Mount the mist engine on a canvas. Returns a handle; call destroy() to tear it down.
 * Throws a clear Error if the shader fails to COMPILE or LINK (a GLSL error is otherwise silent).
 */
export function mountMist(canvas: HTMLCanvasElement, opts: MistOptions = {}): MistHandle {
  const root = opts.root ?? document.documentElement
  const watchTheme = opts.watchTheme ?? true
  const params: MistParams = { ...DEFAULT_MIST_PARAMS, ...opts.params }

  const gl = canvas.getContext('webgl', {
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
  })
  if (!gl) throw new Error('mist: WebGL is unavailable (getContext("webgl") returned null)')

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)
    if (!s) throw new Error('mist: gl.createShader returned null')
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s)
      const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'
      throw new Error(`mist: ${kind} shader failed to compile:\n${log ?? '(no info log)'}`)
    }
    return s
  }

  const prog = gl.createProgram()
  if (!prog) throw new Error('mist: gl.createProgram returned null')
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    throw new Error(`mist: shader program failed to LINK:\n${log ?? '(no info log)'}`)
  }
  gl.useProgram(prog)

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0, 0, 0, 0)

  const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n)
  const uR = u('R'), uT = u('T'), uD = u('D'), uMouse = u('uMouse')
  const uFlow = u('uFlow'), uCovLo = u('uCovLo'), uCovHi = u('uCovHi')
  const uInten = u('uInten'), uAlpha = u('uAlpha'), uMouseAmt = u('uMouseAmt'), uMouseRad = u('uMouseRad')
  const uGlow = u('uGlow'), uGlowMode = u('uGlowMode')
  const uDriftOut = u('uDriftOut'), uDriftDown = u('uDriftDown')
  const uBase = u('uBase'), uGlowTint = u('uGlowTint')

  // ── token bridge — read the palette, then blend a fully-desaturated grey ↔ the palette's OWN colour
  // by tintAmt, so the mist keeps a slight amount of the app's umbra hue rather than reading dead grey.
  let base: [number, number, number] = [0.09, 0.085, 0.08]
  let glowTint: [number, number, number] = [0.18, 0.175, 0.17]
  const readPalette = (): void => {
    const cs = getComputedStyle(root)
    // normalise both tokens through the canvas (handles the oklch our themes use); fall back to warm
    // near-black / near-white sRGB if a token is ever absent — never a bare colour literal in chrome.
    const readC = (name: string, fallback: [number, number, number]): [number, number, number] =>
      normalizeColor(cs.getPropertyValue(name), fallback)
    const bg = readC('--au-color-bg', [0.051, 0.047, 0.043])
    const ink = readC('--au-ink-1', [0.961, 0.953, 0.933])
    const bgL = luma(bg)
    const inkL = luma(ink)
    const amt = Math.max(0, Math.min(1, params.tintAmt))
    // Blend palette color and equal-luminance grey without changing brightness.
    const axis = (t: number, i: number): number => {
      const g = bgL + (inkL - bgL) * t
      const c = bg[i] + (ink[i] - bg[i]) * t
      return g * (1 - amt) + c * amt
    }
    base = [axis(0.26, 0), axis(0.26, 1), axis(0.26, 2)]
    glowTint = [axis(0.46, 0), axis(0.46, 1), axis(0.46, 2)]
  }
  readPalette()

  let appliedScale = params.scale
  const resize = (): void => {
    const s = params.scale
    canvas.width = Math.max(2, Math.round((canvas.clientWidth || window.innerWidth) * s))
    canvas.height = Math.max(2, Math.round((canvas.clientHeight || window.innerHeight) * s))
    gl.viewport(0, 0, canvas.width, canvas.height)
    appliedScale = s
  }
  resize()

  let dCur = 0
  let mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5
  const t0 = performance.now()

  // dissolve tween state (JS-driven; the launcher's enter, not scroll)
  let tween: { from: number; start: number; dur: number; ease: (t: number) => number; resolve: () => void } | null = null

  let paramTween: {
    keys: (keyof MistParams)[]
    to: Record<string, number>
    tau: number
    last: number
    palette: boolean
  } | null = null

  const drawFrame = (now: number): void => {
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (dCur > 0.992) return // fully dissolved — stop drawing entirely
    gl.uniform2f(uR, canvas.width, canvas.height)
    gl.uniform1f(uT, (now - t0) / 1000)
    gl.uniform1f(uD, dCur)
    gl.uniform2f(uMouse, mx, my)
    gl.uniform1f(uFlow, params.flow)
    gl.uniform1f(uCovLo, params.covLo)
    gl.uniform1f(uCovHi, params.covHi)
    gl.uniform1f(uInten, params.inten)
    gl.uniform1f(uAlpha, params.alpha)
    gl.uniform1f(uMouseAmt, params.mouseAmt)
    gl.uniform1f(uMouseRad, params.mouseRad)
    gl.uniform1f(uGlow, params.glow)
    gl.uniform1f(uGlowMode, params.glowMode)
    gl.uniform1f(uDriftOut, params.driftOut)
    gl.uniform1f(uDriftDown, params.driftDown)
    gl.uniform3f(uBase, base[0], base[1], base[2])
    gl.uniform3f(uGlowTint, glowTint[0], glowTint[1], glowTint[2])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // ── the loop (rAF, frame-gated, pause-aware). Reduced-motion draws a single static frame instead. ──
  let raf = 0, running = true, onScreen = true, last = 0

  const stepTween = (now: number): void => {
    if (!tween) return
    const t = Math.min(1, (now - tween.start) / tween.dur)
    dCur = tween.from + (1 - tween.from) * tween.ease(t)
    if (t >= 1) {
      dCur = 1
      const done = tween.resolve
      tween = null
      done()
    }
  }

  const stepParamTween = (now: number): void => {
    if (!paramTween) return
    // Exponential chase toward the target, time-corrected so the feel is frame-rate independent:
    // a = 1 - e^(-dt/tau). dt is clamped so a stalled tab (or a paused loop) resumes smoothly instead
    // of jumping the whole remaining distance on the first frame back.
    const dt = Math.min(120, Math.max(0, now - paramTween.last))
    paramTween.last = now
    const a = 1 - Math.exp(-dt / paramTween.tau)
    const rec = params as unknown as Record<string, number>
    let settled = true
    for (const k of paramTween.keys) {
      const target = paramTween.to[k]
      const next = rec[k] + (target - rec[k]) * a
      rec[k] = next
      // an exponential chase never mathematically ARRIVES, so settle on a relative epsilon and snap.
      if (Math.abs(target - next) > Math.abs(target) * 1e-3 + 1e-4) settled = false
    }
    if (paramTween.palette) readPalette() // only when tintAmt is among the chased keys
    if (settled) {
      for (const k of paramTween.keys) rec[k] = paramTween.to[k]
      paramTween = null
    }
  }

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame)
    if (!running) return
    // gate to ~fps, but render EVERY frame while a dissolve OR a param tween is live (smooth motion).
    // The gate is re-read per frame, like `scale` below — both are structural params `setParams` snaps.
    const tweening = tween != null || paramTween != null
    if (!tweening && now - last < 1000 / Math.max(1, params.fps)) return
    last = now
    if (params.scale !== appliedScale) resize()
    stepTween(now)
    stepParamTween(now)
    mx += (tmx - mx) * 0.08
    my += (tmy - my) * 0.08
    drawFrame(now)
  }

  const renderOnce = (): void => {
    // reduced-motion / static path: mirror one frame's uniform push + draw, no rAF.
    mx = tmx
    my = tmy
    drawFrame(performance.now())
  }

  // ── listeners ──
  const onResize = (): void => {
    resize()
    if (reduce) renderOnce()
  }
  const onMove = (e: PointerEvent): void => {
    tmx = e.clientX / window.innerWidth
    tmy = 1 - e.clientY / window.innerHeight
  }
  const onVis = (): void => {
    running = onScreen && document.visibilityState === 'visible'
  }
  window.addEventListener('resize', onResize)
  window.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('blur', onVis)
  window.addEventListener('focus', onVis)

  const io = new IntersectionObserver(
    ([e]) => {
      onScreen = e.isIntersecting
      running = onScreen && document.visibilityState === 'visible'
    },
    { threshold: 0 },
  )
  io.observe(canvas)

  let themeObs: MutationObserver | null = null
  if (watchTheme) {
    themeObs = new MutationObserver(() => {
      readPalette()
      if (reduce) renderOnce()
    })
    themeObs.observe(root, { attributes: true, attributeFilter: ['data-au-theme', 'style', 'class'] })
  }

  if (reduce) {
    renderOnce()
  } else {
    raf = requestAnimationFrame(frame)
  }

  return {
    setD(d: number): void {
      if (tween) {
        tween.resolve()
        tween = null
      }
      dCur = Math.max(0, Math.min(1, d))
      if (reduce) renderOnce()
    },
    getD(): number {
      return dCur
    },
    dissolve(o: DissolveOptions = {}): Promise<void> {
      // Resolve only when the dissolve completes so app reveal can await it.
      const dur = o.duration ?? 1900
      const ease = o.easing ?? DEFAULT_EASE
      if (reduce) {
        dCur = 1
        renderOnce()
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        if (tween) tween.resolve() // supersede any in-flight tween
        tween = { from: dCur, start: performance.now(), dur, ease, resolve }
      })
    },
    setParams(p: Partial<MistParams>, o: SetParamsOptions = {}): void {
      // Structural params (scale/fps) always snap — tweening them would realloc the canvas per frame.
      if (p.scale !== undefined) params.scale = p.scale
      if (p.fps !== undefined) params.fps = p.fps

      // Collect the numeric look targets present in this call.
      const to: Record<string, number> = {}
      const keys: (keyof MistParams)[] = []
      for (const k of TWEEN_KEYS) {
        const v = p[k]
        if (v !== undefined) {
          to[k] = v as number
          keys.push(k)
        }
      }
      const paletteAffecting = keys.includes('tintAmt')
      const dur = o.duration ?? DEFAULT_SETPARAMS_MS
      const eased = !reduce && dur > 0 && keys.length > 0

      if (!eased) {
        // instant snap (reduced-motion, explicit duration 0, or nothing tweenable to move).
        for (const k of keys) (params as unknown as Record<string, number>)[k] = to[k]
        paramTween = null
        readPalette()
        if (params.scale !== appliedScale) resize()
        if (reduce) renderOnce()
        return
      }

      const prev = paramTween
      paramTween = {
        keys: prev ? Array.from(new Set([...prev.keys, ...keys])) : keys,
        to: prev ? { ...prev.to, ...to } : to,
        tau: dur / 3,
        last: performance.now(),
        palette: paletteAffecting || (prev?.palette ?? false),
      }
      if (params.scale !== appliedScale) resize()
    },
    destroy(): void {
      cancelAnimationFrame(raf)
      running = false
      if (tween) {
        tween.resolve()
        tween = null
      }
      paramTween = null
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onVis)
      window.removeEventListener('focus', onVis)
      io.disconnect()
      themeObs?.disconnect()
      // Free the GL objects, but do NOT call WEBGL_lose_context().loseContext(): a canvas hands out
      // ONE context for its lifetime, and losing it is permanent for that element. React StrictMode
      // (and any remount onto the same <canvas>) runs mount → cleanup → mount, so a lost context on
      // the first cleanup left the remount compiling against a dead context — which fails with an
      // EMPTY info log ("vertex shader failed to compile: (no info log)"), the exact symptom seen.
      // Deleting the resources is the real cleanup; the context goes when the canvas is collected.
      gl.deleteProgram(prog)
      gl.deleteBuffer(quad)
    },
  }
}
