// Three.js avatar with a room, floor grid and soft-shadow lighting. The toon eye uses
// uLightPos as its gaze position independently of scene lighting, so it follows the cursor.
//
// TWO RENDER SURFACES over ONE scene, so the room keeps rendering in the pane while he roams the whole
// window: the pane renderer draws the room (plus him, when docked); a full-window overlay renderer
// draws only him (transparent) while roaming. Visibility is toggled between the two sequential renders
// each frame. Size is the character's SCALE (overlay camera fixed) and screen position is a world
// placement, decoupled — so the dock↔roam transition animates seamlessly with no perspective drift.
//
// Interaction (docked): one click wakes him with a little joy; a second click sends him roaming after
// the cursor; press-and-hold 5s gives him a random hat. Scroll zooms the stage. When the mouse rests
// while roaming, he flies home, docks back, and dozes off.

import * as THREE from 'three'
import { disposeObject } from './three-resources'

const MAX_RIPPLES = 6

interface EyeUniforms {
  uTime: { value: number }
  uRippleStart: { value: number[] }
  uRippleOrigin: { value: THREE.Vector3[] }
  uRippleSpeed: { value: number }
  uRippleLag: { value: number }
  uRippleDur: { value: number }
  uLightPos: { value: THREE.Vector3 }
  uCameraPos: { value: THREE.Vector3 }
  uBlink: { value: number }
  uPupil: { value: number }
  uBands: { value: number }
  uMid: { value: number }
  uShadeFloor: { value: number }
}

function eyeShaderCompiler(U: EyeUniforms) {
  return (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    Object.assign(shader.uniforms, U)
    shader.vertexShader =
      `
      varying vec3 vLocalDir;
      varying vec3 vWNormal;
      varying vec3 vWPos;
      ` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vLocalDir = normalize(transformed);
         vWNormal  = normalize(mat3(modelMatrix) * normal);
         vWPos     = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader =
      `
      varying vec3 vLocalDir;
      varying vec3 vWNormal;
      varying vec3 vWPos;
      #define MAX_RIPPLES ${MAX_RIPPLES}
      uniform float uTime;
      uniform float uRippleStart[MAX_RIPPLES];
      uniform vec3  uRippleOrigin[MAX_RIPPLES];
      uniform float uRippleSpeed;
      uniform float uRippleLag;
      uniform float uRippleDur;
      uniform vec3  uLightPos;
      uniform vec3  uCameraPos;
      uniform float uBlink;
      uniform float uPupil;
      uniform float uBands;
      uniform float uMid;
      uniform float uShadeFloor;
      ` +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        {
          vec3  Nn  = normalize(vWNormal);
          vec3  Ld  = normalize(uLightPos - vWPos);
          float ndl = dot(Nn, Ld);
          vec3  lr  = normalize(cross(vec3(0.0, 1.0, 0.0), Ld) + vec3(1e-4));
          vec3  lv  = normalize(cross(Ld, lr));
          float nv  = dot(Nn, lv);
          float Nb     = max(floor(uBands + 0.5), 1.0);
          float tLight = mix(0.82, 0.50, uPupil);
          float tDark  = mix(0.42, 0.05, uMid);
          float denom  = max(Nb - 1.0, 1.0);
          float level;
          if (Nb < 1.5)            level = denom;
          else if (ndl >= tLight)  level = Nb - 1.0;
          else if (ndl <  tDark)   level = 0.0;
          else {
            float u = (ndl - tDark) / max(tLight - tDark, 1e-3);
            level = 1.0 + floor(u * max(Nb - 2.0, 0.0) * 0.99999);
          }
          float tone = (Nb < 1.5) ? 1.0 : 0.16 * pow(10.625, level / denom);
          vec3  toonCol = diffuse * max(tone, uShadeFloor);
          float openH      = (1.0 - uBlink) * 0.8;
          float isLightest = step(Nb - 1.5, level);
          float bar = step(1.5, Nb) * isLightest * smoothstep(openH, openH + 0.04, abs(nv));
          float secondTone = 0.16 * pow(10.625, (Nb - 2.0) / denom);
          toonCol = mix(toonCol, diffuse * max(secondTone, uShadeFloor), bar);
          gl_FragColor.rgb = toonCol + emissive;
        }
        #include <dithering_fragment>
        `,
      )
  }
}

type Phase = 'sleep' | 'awake' | 'roam' | 'land'
type HatKind = 'top' | 'wizard'

const R = 3.2 // gaze-light sphere radius
const BG = 0x111417
const FOV = 45
const SPHERE_R = 1.1
// The roam size + the un-zoomed docked size: fraction of viewport HEIGHT the sphere occupies. Small,
// so he reads as a little avatar in a roomy gridded space.
const SPHERE_FRACTION = 0.05
const HOME_Y = SPHERE_R
// Fixed roam offset from the cursor (world units, camera-right / camera-up). He sits at this constant
// vector from the cursor wherever it is on screen; the magnitude is the standoff distance.
const FOLLOW_OFF_X = 5.1
const FOLLOW_OFF_Y = -4.2
const HOLD_MS = 5000 // press-and-hold to earn a hat
const ROAM_IDLE_RETURN = 3.5
const JOY_DUR = 1.0
const CAM_DIR = new THREE.Vector3(3.6, 1.7, 4.2).normalize() // the sandbox 3/4 angle

export class RichAvatar {
  private rendererA: THREE.WebGLRenderer // pane
  private rendererB: THREE.WebGLRenderer | null = null // full-window roam overlay
  private overlayEl: HTMLElement | null = null
  private overlayCanvas: HTMLCanvasElement | null = null

  private scene = new THREE.Scene()
  private paneCamera: THREE.PerspectiveCamera
  private overlayCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400)
  private character = new THREE.Group()
  private gear = new THREE.Group()
  private sphere: THREE.Mesh
  private outline: THREE.Mesh
  private topHat = new THREE.Group()
  private wizHat = new THREE.Group()
  private floor: THREE.Mesh
  private grid: THREE.GridHelper
  private uniforms: EyeUniforms
  private raycaster = new THREE.Raycaster()
  private bg = new THREE.Color(BG)

  private ro: ResizeObserver
  private raf = 0
  private clock = new THREE.Clock()
  private elapsed = 0
  private disposed = false

  private readonly baseDist: number
  private paneDist: number
  private readonly minDist: number
  private readonly maxDist: number

  // interaction
  private clientX = 0
  private clientY = 0
  private lastMove = 0
  private phase: Phase = 'sleep'
  private hasHat = false
  private hat: HatKind = 'top'
  private holdTimer = 0
  private holdConsumed = false
  private joyT = -1

  // eased values
  private curLids = 0.86
  private curPupil = 0.5
  private curScale = 1
  private targetScale = 1
  private landPos = new THREE.Vector3()
  private landScale = 1
  private blinkTimer = 0
  private nextBlink = 3

  // scratch
  private _home = new THREE.Vector3(0, HOME_Y, 0)
  private _lookTarget = new THREE.Vector3()
  private _camRight = new THREE.Vector3()
  private _camUp = new THREE.Vector3()
  private _camDir = new THREE.Vector3()
  private _plane = new THREE.Plane()
  private _cursorW = new THREE.Vector3()
  private _gp = new THREE.Vector3()
  private _followTarget = new THREE.Vector3()
  private _gazeObj = new THREE.Object3D()
  private _worldLight = new THREE.Vector3()
  private _lightPos = new THREE.Vector3(0, 0, R)
  private _pa = new THREE.Vector3()
  private _pb = new THREE.Vector3()
  private _ndc = new THREE.Vector2()

  constructor(
    private canvas: HTMLCanvasElement, // the pane canvas
    private zzz: HTMLElement,
    private backdrop = true,
    private onState?: (state: string) => void,
    private wizardLook = false,
  ) {
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    const rendererA = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    rendererA.setPixelRatio(Math.min(devicePixelRatio, 2))
    rendererA.shadowMap.enabled = true
    rendererA.shadowMap.type = THREE.PCFSoftShadowMap
    this.rendererA = rendererA

    // camera distance for SPHERE_FRACTION of viewport height
    this.baseDist = (SPHERE_R * 2) / (2 * SPHERE_FRACTION * Math.tan((FOV * Math.PI) / 360))
    this.paneDist = this.baseDist * (this.backdrop ? 1 : 0.15)
    this.minDist = this.paneDist * 0.35
    this.maxDist = this.paneDist * 3

    this.paneCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400)
    this.placePaneCamera()
    this.overlayCamera.position.copy(this._home).addScaledVector(CAM_DIR, this.baseDist)
    this.overlayCamera.lookAt(this._home)

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(4, 6, 3)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.layers.enableAll()
    this.scene.add(key)
    this.scene.add(new THREE.HemisphereLight(0x8899aa, 0x222222, 0.5))

    const toonSteps = new Uint8Array([32, 108, 205])
    const gradientMap = new THREE.DataTexture(toonSteps, toonSteps.length, 1, THREE.RedFormat)
    gradientMap.minFilter = THREE.NearestFilter
    gradientMap.magFilter = THREE.NearestFilter
    gradientMap.needsUpdate = true

    this.uniforms = {
      uTime: { value: 0 },
      uRippleStart: { value: new Array(MAX_RIPPLES).fill(-1) },
      uRippleOrigin: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector3(0, 1, 0)) },
      uRippleSpeed: { value: 2.6 },
      uRippleLag: { value: 0.6 },
      uRippleDur: { value: 2.0 },
      uLightPos: { value: new THREE.Vector3() },
      uCameraPos: { value: new THREE.Vector3() },
      uBlink: { value: 0 },
      uPupil: { value: 0.5 },
      uBands: { value: 3 },
      uMid: { value: 0.5 },
      uShadeFloor: { value: this.backdrop ? 0.05 : 0.38 },
    }

    const geo = new THREE.SphereGeometry(SPHERE_R, 64, 64)
    const sphereMat = new THREE.MeshToonMaterial({ color: this.backdrop ? 0x686870 : 0xb8b8b8, gradientMap })
    sphereMat.onBeforeCompile = eyeShaderCompiler(this.uniforms)
    sphereMat.customProgramCacheKey = () => 'au-avatar-rich'
    this.sphere = new THREE.Mesh(geo, sphereMat)
    this.sphere.castShadow = true
    this.character.position.copy(this._home)
    this.scene.add(this.character)
    this.character.add(this.sphere)

    this.outline = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xd0d0d4, side: THREE.BackSide, transparent: true, opacity: 0.75, depthWrite: false }),
    )
    this.outline.scale.setScalar(1.028)
    this.character.add(this.outline)

    this.character.add(this.gear)
    this.buildHats()
    if (this.wizardLook) {
      this.hasHat = true; this.hat = 'wizard'
      sphereMat.color.setRGB(104 / 255, 104 / 255, 112 / 255, THREE.LinearSRGBColorSpace)
      this.uniforms.uShadeFloor.value = 0.05
    }

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }))
    this.floor.rotation.x = -Math.PI / 2
    this.floor.receiveShadow = true
    this.grid = new THREE.GridHelper(20, 20, 0x334455, 0x223344)
    this.scene.add(this.floor, this.grid)

    window.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.cancelHold)
    window.addEventListener('blur', this.cancelHold)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(canvas)
    this.resize()
    this.reflect()
  }

  private placePaneCamera(): void {
    this.paneCamera.position.copy(this._home).addScaledVector(CAM_DIR, this.paneDist)
    this.paneCamera.lookAt(this._home)
  }

  private buildHats(): void {
    const matTop = new THREE.MeshToonMaterial({ color: 0x1b1c22 })
    const matBand = new THREE.MeshToonMaterial({ color: 0x8d3b3b })
    const BRIM_Y = 0.86
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.28, 0.08, 28), matTop)
    brim.position.y = BRIM_Y
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 1.25, 24), matTop)
    crown.position.y = BRIM_Y + 0.62
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.07, 8, 24), matBand)
    band.rotation.x = Math.PI / 2
    band.position.y = BRIM_Y + 0.14
    this.topHat.add(brim, crown, band)
    this.topHat.rotation.x = -0.16
    this.gear.add(this.topHat)

    const matWiz = new THREE.MeshToonMaterial({ color: this.wizardLook ? 0x795bd1 : 0x3b2f6e })
    const matGold = new THREE.MeshToonMaterial({ color: this.wizardLook ? 0xf0e8ad : 0xe0bd55 })
    const WB = 0.74
    const wbrim = new THREE.Mesh(this.wizardLook ? new THREE.CylinderGeometry(1.35, 1.38, 0.07, 40) : new THREE.ConeGeometry(1.5, 0.34, 14, 1, true), matWiz)
    wbrim.position.y = WB
    const CONE_H = 2.1
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.84, CONE_H, 14), matWiz)
    cone.position.y = WB + CONE_H / 2 - 0.1
    const wband = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.09, 6, 18), matGold)
    wband.rotation.x = Math.PI / 2
    wband.position.y = WB + 0.14
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), matGold)
    star.scale.set(1, 1, 0.4)
    star.position.set(0, WB + 0.7, 0.55)
    this.wizHat.add(wbrim, cone, wband, star)
    this.wizHat.rotation.x = -0.18
    if (this.wizardLook) { this.wizHat.scale.setScalar(0.82); this.wizHat.position.y = 0.35 }
    this.gear.add(this.wizHat)

    this.topHat.visible = false
    this.wizHat.visible = false
  }

  // ── input ──
  private onPointerMove = (e: PointerEvent): void => {
    if (Math.hypot(e.clientX - this.clientX, e.clientY - this.clientY) > 1.5) this.lastMove = this.elapsed
    this.clientX = e.clientX
    this.clientY = e.clientY
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.phase === 'land') return
    if (this.phase === 'roam') {
      this.beginLand() // clicking back into the projection calls him home
      return
    }
    const r = this.canvas.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1)
    this._ndc.set(nx, ny)
    this.raycaster.setFromCamera(this._ndc, this.paneCamera)
    if (this.raycaster.intersectObject(this.sphere).length === 0) return
    this.holdConsumed = false
    this.cancelHold()
    this.holdTimer = window.setTimeout(() => {
      this.holdConsumed = true
      this.gainHat()
    }, HOLD_MS)
  }

  private onPointerUp = (): void => {
    if (!this.holdTimer && !this.holdConsumed) return
    this.cancelHold()
    if (this.holdConsumed) {
      this.holdConsumed = false
      return
    }
    if (this.phase === 'sleep') this.wake()
    else if (this.phase === 'awake') this.startRoam()
  }

  private cancelHold = (): void => {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
      this.holdTimer = 0
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.paneDist = Math.max(this.minDist, Math.min(this.maxDist, this.paneDist * (1 + e.deltaY * 0.0015)))
    this.placePaneCamera()
  }

  private wake(): void {
    this.phase = 'awake'
    this.joyT = 0
    this.reflect()
  }

  private gainHat(): void {
    this.hasHat = true
    this.hat = Math.random() < 0.5 ? 'top' : 'wizard'
    this.joyT = 0 // a happy little reaction to the new hat
    this.reflect()
  }

  // ── roam overlay (a full-window transparent surface with its own renderer) ──
  private ensureOverlay(): void {
    if (this.rendererB) return
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;'
    const c = document.createElement('canvas')
    c.style.cssText = 'display:block;width:100%;height:100%;'
    el.appendChild(c)
    document.body.appendChild(el)
    const rb = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true })
    rb.setPixelRatio(Math.min(devicePixelRatio, 2))
    rb.shadowMap.enabled = true
    rb.shadowMap.type = THREE.PCFSoftShadowMap
    rb.setClearColor(0x000000, 0)
    this.overlayEl = el
    this.overlayCanvas = c
    this.rendererB = rb
    this.resizeOverlay()
    // pre-compile against this context so the first roam frame doesn't jank (a black flash)
    this.syncCam(this.overlayCamera)
    rb.compile(this.scene, this.overlayCamera)
  }

  // Bring a camera's world matrices up to date for off-render-loop projection / raycasting (the
  // renderer does this each frame; measurements taken between frames must do it themselves).
  private syncCam(cam: THREE.PerspectiveCamera): void {
    cam.updateMatrixWorld(true)
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
  }

  private destroyOverlay(): void {
    this.rendererB?.dispose()
    this.rendererB?.forceContextLoss()
    this.rendererB = null
    this.overlayEl?.remove()
    this.overlayEl = null
    this.overlayCanvas = null
  }

  private startRoam(): void {
    this.ensureOverlay()
    const oc = this.overlayCanvas
    if (!oc) return
    this.syncCam(this.paneCamera)
    this.syncCam(this.overlayCamera)
    const pr = this.canvas.getBoundingClientRect()
    // where + how big is the pane sphere on screen right now (docked)
    const c = this.centerClient(this.character.position, this.paneCamera, pr.width, pr.height)
    const pxD = this.measureDiameter(this.character.position, this.paneCamera, pr.width, pr.height)
    const gx = pr.left + c.x
    const gy = pr.top + c.y
    const ow = oc.clientWidth || window.innerWidth
    const oh = oc.clientHeight || window.innerHeight
    // place + size the overlay sphere to match exactly, then it eases to the roam state
    const nx = (gx / ow) * 2 - 1
    const ny = -((gy / oh) * 2 - 1)
    this.worldOnHomePlane(nx, ny, this.overlayCamera, this.character.position)
    const baseDiam = this.measureDiameter(this.character.position, this.overlayCamera, ow, oh)
    this.curScale = baseDiam > 0 ? pxD / baseDiam : 1
    this.targetScale = 1
    this.phase = 'roam'
    this.lastMove = this.elapsed
    this.reflect()
  }

  private beginLand(): void {
    const oc = this.overlayCanvas
    if (!oc) {
      this.finishDock()
      return
    }
    this.syncCam(this.paneCamera)
    this.syncCam(this.overlayCamera)
    const pr = this.canvas.getBoundingClientRect()
    const dockedDiam = this.measureDiameter(this._home, this.paneCamera, pr.width, pr.height) // docked size
    const c = this.centerClient(this._home, this.paneCamera, pr.width, pr.height)
    const gx = pr.left + c.x
    const gy = pr.top + c.y
    const ow = oc.clientWidth || window.innerWidth
    const oh = oc.clientHeight || window.innerHeight
    const nx = (gx / ow) * 2 - 1
    const ny = -((gy / oh) * 2 - 1)
    this.worldOnHomePlane(nx, ny, this.overlayCamera, this.landPos)
    const baseDiam = this.measureDiameter(this.landPos, this.overlayCamera, ow, oh)
    this.landScale = baseDiam > 0 ? dockedDiam / baseDiam : 1
    this.targetScale = this.landScale
    this.phase = 'land'
    this.reflect()
  }

  private finishDock(): void {
    this.destroyOverlay()
    this.character.position.copy(this._home)
    this.curScale = 1
    this.targetScale = 1
    this.phase = 'sleep'
    this.reflect()
  }

  private reflect(): void {
    this.topHat.visible = this.hasHat && this.hat === 'top'
    this.wizHat.visible = this.hasHat && this.hat === 'wizard'
    this.zzz.hidden = this.phase !== 'sleep'
    this.onState?.(this.phase)
  }

  get state(): Phase { return this.phase }

  // ── projection helpers ──
  private centerClient(pos: THREE.Vector3, cam: THREE.PerspectiveCamera, w: number, h: number): { x: number; y: number } {
    this._pa.copy(pos).project(cam)
    return { x: (this._pa.x * 0.5 + 0.5) * w, y: (-this._pa.y * 0.5 + 0.5) * h }
  }

  private measureDiameter(pos: THREE.Vector3, cam: THREE.PerspectiveCamera, w: number, h: number): number {
    this._camRight.setFromMatrixColumn(cam.matrixWorld, 0)
    this._pa.copy(pos).project(cam)
    this._pb.copy(pos).addScaledVector(this._camRight, SPHERE_R).project(cam)
    return 2 * Math.hypot(((this._pb.x - this._pa.x) * w) / 2, ((this._pb.y - this._pa.y) * h) / 2)
  }

  private worldOnHomePlane(nx: number, ny: number, cam: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
    this._ndc.set(nx, ny)
    this.raycaster.setFromCamera(this._ndc, cam)
    cam.getWorldDirection(this._camDir)
    this._plane.setFromNormalAndCoplanarPoint(this._camDir, this._home)
    this.raycaster.ray.intersectPlane(this._plane, out)
    return out
  }

  private ndcFor(canvas: HTMLElement, out: THREE.Vector2): THREE.Vector2 {
    const r = canvas.getBoundingClientRect()
    out.set(((this.clientX - r.left) / r.width) * 2 - 1, -(((this.clientY - r.top) / r.height) * 2 - 1))
    return out
  }

  // Look straight AT the cursor: aim the lit pupil, in SCREEN space, exactly along the direction from
  // the sphere's projected centre to the cursor. The pupil rides toward the cursor (its offset from
  // centre saturating at the rim), with a toward-viewer component so it stays on the visible face.
  private gazeAtCursor(cam: THREE.PerspectiveCamera, canvas: HTMLElement): void {
    const r = canvas.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    // sphere centre + cursor, in canvas PIXELS
    this._pa.copy(this.character.position).project(cam)
    const cx = (this._pa.x * 0.5 + 0.5) * r.width
    const cy = (-this._pa.y * 0.5 + 0.5) * r.height
    let dx = this.clientX - r.left - cx
    let dy = this.clientY - r.top - cy
    const len = Math.hypot(dx, dy)
    // Turn amount from the cursor's distance in SPHERE-RADII (scale-invariant): beyond ~1.5 radii the
    // eye is essentially fully aimed at the cursor. Fixes the size-dependent under/over-steer.
    const radius = Math.max(1, this.measureDiameter(this.character.position, cam, r.width, r.height) / 2)
    const g = Math.min(len / (radius * 1.5), 0.94)
    if (len > 1e-3) {
      dx /= len
      dy /= len
    } else {
      dx = 0
      dy = 0
    }
    const fwd = Math.sqrt(Math.max(0, 1 - g * g))
    this._camRight.setFromMatrixColumn(cam.matrixWorld, 0)
    this._camUp.setFromMatrixColumn(cam.matrixWorld, 1)
    this._gp.copy(cam.position).sub(this.character.position).normalize() // toward the viewer
    this._lookTarget
      .set(0, 0, 0)
      .addScaledVector(this._camRight, dx * g)
      .addScaledVector(this._camUp, -dy * g) // screen y is down; camera up is +y
      .addScaledVector(this._gp, fwd)
      .normalize()
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth)
    const h = Math.max(1, this.canvas.clientHeight)
    this.rendererA.setSize(w, h, false)
    this.paneCamera.aspect = w / h
    this.paneCamera.updateProjectionMatrix()
    this.resizeOverlay()
  }

  private resizeOverlay(): void {
    if (!this.rendererB || !this.overlayCanvas) return
    const w = Math.max(1, this.overlayCanvas.clientWidth)
    const h = Math.max(1, this.overlayCanvas.clientHeight)
    this.rendererB.setSize(w, h, false)
    this.overlayCamera.aspect = w / h
    this.overlayCamera.updateProjectionMatrix()
  }

  start(): void {
    if (this.raf) return
    this.clock.start()
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop)
      this.frame(Math.min(this.clock.getDelta(), 0.05))
    }
    this.raf = requestAnimationFrame(loop)
  }

  private frame(dt: number): void {
    this.elapsed += dt
    this.uniforms.uTime.value = this.elapsed
    const k = 1 - Math.pow(0.0025, dt)

    // ── joy reaction ──
    let bob = 1
    let pupilTarget = 0.5
    let joyBlink = 0
    if (this.joyT >= 0) {
      this.joyT += dt
      const t = this.joyT / JOY_DUR
      if (t >= 1) this.joyT = -1
      else {
        bob = 1 + 0.13 * Math.sin(t * Math.PI) // one soft happy hop
        pupilTarget = 0.8 // bright wide eyes
        if (t < 0.12) joyBlink = t / 0.12
        else if (t < 0.24) joyBlink = 1 - (t - 0.12) / 0.12
      }
    }

    // ── gaze ──
    const sleepy = this.phase === 'sleep' || this.phase === 'land'
    if (sleepy) {
      this._lookTarget.copy(this.paneCamera.position).normalize()
      this._camRight.setFromMatrixColumn(this.paneCamera.matrixWorld, 0)
      this._camUp.setFromMatrixColumn(this.paneCamera.matrixWorld, 1)
      this._lookTarget
        .addScaledVector(this._camRight, 0.12 * Math.sin(this.elapsed * 0.6))
        .addScaledVector(this._camUp, -0.55)
        .normalize()
    } else if (this.phase === 'roam' && this.overlayCanvas) {
      this.gazeAtCursor(this.overlayCamera, this.overlayCanvas)
    } else {
      this.gazeAtCursor(this.paneCamera, this.canvas)
    }

    // ── lids + blink ──
    const restLids = sleepy ? 0.86 : 0.0
    let blink = joyBlink
    if (!sleepy && this.joyT < 0) {
      this.blinkTimer += dt
      if (this.blinkTimer >= this.nextBlink + 0.22) {
        this.blinkTimer = 0
        this.nextBlink = 2.5 + Math.random() * 4
      }
      const bt = this.blinkTimer - this.nextBlink
      if (bt >= 0 && bt < 0.22) blink = bt < 0.1 ? bt / 0.1 : 1 - (bt - 0.1) / 0.12
    }
    this.curLids += (restLids - this.curLids) * k
    this.curPupil += (pupilTarget - this.curPupil) * k

    // ── size (scale) ──
    this.curScale += (this.targetScale - this.curScale) * (1 - Math.pow(0.01, dt))
    const breathe = this.phase === 'sleep' ? 0.97 + 0.03 * Math.sin(this.elapsed * 1.1) : 1
    this.character.scale.setScalar(this.curScale * bob * breathe)

    // ── position ──
    if (this.phase === 'roam') {
      this.updateFollower(dt)
      if (this.elapsed - this.lastMove > ROAM_IDLE_RETURN) this.beginLand()
    } else if (this.phase === 'land') {
      this.character.position.lerp(this.landPos, 1 - Math.pow(0.004, dt))
      if (this.character.position.distanceTo(this.landPos) < 0.1 && Math.abs(this.curScale - this.landScale) < 0.03) {
        this.finishDock()
      }
    } else {
      this.character.position.lerp(this._home, 1 - Math.pow(0.0011, dt))
    }

    // ── gear + gaze light ──
    this._gazeObj.lookAt(this._lookTarget)
    this.gear.quaternion.slerp(this._gazeObj.quaternion, 1 - Math.pow(0.0016, dt))
    this._lightPos.lerp(this._pa.copy(this._lookTarget).multiplyScalar(R), 1 - Math.pow(0.0009, dt))
    this._worldLight.copy(this.character.position).add(this._lightPos)
    this.uniforms.uBlink.value = Math.min(this.curLids + blink, 1)
    this.uniforms.uPupil.value = Math.min(Math.max(this.curPupil, 0), 1)
    this.uniforms.uLightPos.value.copy(this._worldLight)

    // ── render: pane (room + him when docked), then the roam overlay (him only, transparent) ──
    const roaming = this.phase === 'roam' || this.phase === 'land'
    this.floor.visible = this.grid.visible = this.backdrop
    this.character.visible = !roaming
    this.scene.background = this.backdrop ? this.bg : null
    this.uniforms.uCameraPos.value.copy(this.paneCamera.position)
    this.rendererA.render(this.scene, this.paneCamera)

    if (roaming && this.rendererB) {
      this.character.visible = true
      this.floor.visible = this.grid.visible = false
      this.scene.background = null
      this.uniforms.uCameraPos.value.copy(this.overlayCamera.position)
      this.rendererB.render(this.scene, this.overlayCamera)
    }
  }

  // Sit at a FIXED offset from the cursor (a constant standoff, same wherever the cursor is), eased in.
  private updateFollower(dt: number): void {
    if (!this.overlayCanvas) return
    this.ndcFor(this.overlayCanvas, this._ndc)
    this.worldOnHomePlane(this._ndc.x, this._ndc.y, this.overlayCamera, this._cursorW)
    this._camRight.setFromMatrixColumn(this.overlayCamera.matrixWorld, 0)
    this._camUp.setFromMatrixColumn(this.overlayCamera.matrixWorld, 1)
    this._followTarget
      .copy(this._cursorW)
      .addScaledVector(this._camRight, FOLLOW_OFF_X)
      .addScaledVector(this._camUp, FOLLOW_OFF_Y)
    this.character.position.lerp(this._followTarget, 1 - Math.pow(0.0012, dt))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    window.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.cancelHold)
    window.removeEventListener('blur', this.cancelHold)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.cancelHold()
    this.destroyOverlay()
    this.ro.disconnect()
    this.clock.stop()
    disposeObject(this.scene)
    this.rendererA.dispose()
    this.rendererA.forceContextLoss()
  }
}
