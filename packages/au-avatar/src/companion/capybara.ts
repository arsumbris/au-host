import * as THREE from 'three'
import type { CompanionConfig } from './config'
import { angleDelta, damp } from './motion'
import { form, line } from './geometry'
import { scarfTexture } from './textiles'
import type { Expression } from './gestures'
export type { Gesture } from './gestures'

export type Emotion = 'content' | 'curious' | 'happy' | 'focused'
export interface Pose {
  time: number; sleep: number; blink: number; gazeX: number; gazeY: number; headLead: number; lookYaw: number; lookPitch: number
  /** Screen-space attention for view-facing materials; independent of body heading. */
  screenGazeX?: number
  lean: number; motion: number; expression: Expression; emotion: Emotion
}

export class Capybara {
  readonly root = new THREE.Group()
  private torso: THREE.Mesh
  private head = new THREE.Group()
  private headYaw = 0
  private feet: THREE.Mesh[] = []
  private arms: THREE.Group[] = []
  private wrists: THREE.Group[] = []
  private eyes: THREE.Group[] = []
  private openEyes: THREE.Group[] = []
  private closedEyes: THREE.Object3D[] = []
  private glasses = new THREE.Group()
  private scarf = new THREE.Group()
  private ears: THREE.Group[] = []
  private fur: THREE.MeshToonMaterial
  private muzzle: THREE.MeshToonMaterial
  private paws: THREE.MeshToonMaterial

  constructor(config: CompanionConfig) {
    const ramp = new THREE.DataTexture(new Uint8Array([115, 180, 235, 255]), 4, 1, THREE.RedFormat)
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true
    this.fur = new THREE.MeshToonMaterial({ color: config.bodyColor, gradientMap: ramp })
    this.muzzle = new THREE.MeshToonMaterial({ color: new THREE.Color(config.bodyColor).multiplyScalar(0.84), gradientMap: ramp })
    this.paws = new THREE.MeshToonMaterial({ color: '#886344', gradientMap: ramp })
    const dark = new THREE.MeshStandardMaterial({ color: '#352a24', roughness: 0.7 })
    const eye = new THREE.MeshStandardMaterial({ color: '#151713', roughness: 0.22 })
    const highlight = new THREE.MeshBasicMaterial({ color: '#fff5d4' })
    const earPink = new THREE.MeshToonMaterial({ color: '#9f6750', gradientMap: ramp })

    this.torso = form(this.root, this.fur, [0.74, 0.86, 0.66], [0, 0.92, 0], 0.91)
    for (const side of [-1, 1]) {
      const foot = form(this.root, this.fur, [0.3, 0.2, 0.42], [side * 0.48, 0.24, 0.48])
      this.feet.push(foot)
      for (let toe = -1; toe <= 1; toe++) {
        form(foot, this.paws, [0.064, 0.045, 0.09], [toe * 0.13, -0.015, 0.35])
      }
      const arm = new THREE.Group(); arm.position.set(side * 0.57, 1.22, 0.35)
      form(arm, this.fur, [0.22, 0.43, 0.24], [0, -0.26, 0.1])
      const wrist = new THREE.Group(); wrist.position.set(0, -0.56, 0.15)
      form(wrist, this.paws, [0.19, 0.15, 0.19], [0, 0, 0])
      arm.add(wrist); this.wrists.push(wrist)
      this.root.add(arm); this.arms.push(arm)
    }

    this.head.position.set(0, 1.55, 0.06); this.root.add(this.head)
    form(this.head, this.fur, [0.7, 0.56, 0.68], [0, 0.38, 0.12], 0.65)
    form(this.head, this.muzzle, [0.57, 0.32, 0.38], [0, 0.19, 0.66], 0.66)
    for (const side of [-1, 1]) {
      form(this.head, dark, [0.063, 0.027, 0.025], [side * 0.15, 0.36, 1.027])
      const ear = new THREE.Group(); ear.position.set(side * 0.55, 0.84, 0.05)
      form(ear, this.fur, [0.17, 0.21, 0.12], [0, 0, 0], 0.95)
      form(ear, earPink, [0.107, 0.143, 0.035], [0, 0.015, 0.105])
      this.head.add(ear); this.ears.push(ear)
      const eyeRoot = new THREE.Group(); eyeRoot.position.set(side * 0.4, 0.54, 0.71)
      const open = new THREE.Group()
      form(open, eye, [0.092, 0.113, 0.055], [0, 0, 0])
      form(open, highlight, [0.024, 0.024, 0.011], [-0.027, 0.038, 0.05])
      eyeRoot.add(open); this.openEyes.push(open)
      const closed = line(eyeRoot, dark, [[-0.1, 0.018, 0.026], [0, -0.025, 0.04], [0.1, 0.018, 0.026]], 0.014)
      closed.visible = false; this.closedEyes.push(closed); this.eyes.push(eyeRoot); this.head.add(eyeRoot)
      line(this.head, this.muzzle, [[side * 0.29, 0.73, 0.71], [side * 0.39, 0.76, 0.71], [side * 0.49, 0.73, 0.67]], 0.018)
    }
    line(this.head, dark, [[0, 0.2, 1.039], [0, 0.09, 1.045], [-0.09, 0.052, 1.025], [-0.15, 0.09, 1.01]], 0.009)
    line(this.head, dark, [[0, 0.09, 1.045], [0.09, 0.052, 1.025], [0.15, 0.09, 1.01]], 0.009)
    this.buildGlasses(); this.buildScarf(); this.configure(config)
  }

  private buildGlasses(): void {
    const metal = new THREE.MeshStandardMaterial({ color: '#a68747', metalness: 0.65, roughness: 0.35 })
    const lens = new THREE.MeshPhysicalMaterial({ color: '#e6ece2', transparent: true, opacity: 0.07, roughness: 0.05, depthWrite: false })
    for (const side of [-1, 1]) {
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 8, 56), metal)
      frame.position.set(side * 0.38, 0.55, 0.805); this.glasses.add(frame)
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.234, 48), lens)
      glass.position.copy(frame.position); this.glasses.add(glass)
      line(this.glasses, metal, [[side * 0.63, 0.58, 0.8], [side * 0.72, 0.61, 0.3], [side * 0.66, 0.59, -0.15]], 0.015)
    }
    line(this.glasses, metal, [[-0.13, 0.55, 0.8], [0, 0.6, 0.86], [0.13, 0.55, 0.8]], 0.017)
    this.head.add(this.glasses)
  }

  private buildScarf(): void {
    const material = new THREE.MeshStandardMaterial({ map: scarfTexture(), roughness: 1, side: THREE.DoubleSide })
    const shape = new THREE.Shape()
    shape.moveTo(-0.63, 0); shape.quadraticCurveTo(0, -0.13, 0.63, 0)
    shape.lineTo(0.45, -0.35); shape.quadraticCurveTo(0.18, -0.43, 0, -0.63)
    shape.quadraticCurveTo(-0.3, -0.36, -0.53, -0.3); shape.closePath()
    const geometry = new THREE.ShapeGeometry(shape, 24)
    const vertices = geometry.attributes.position, uv = geometry.attributes.uv
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), y = vertices.getY(i)
      vertices.setZ(i, 0.77 - x * x * 0.32 + Math.sin(y * 8) * 0.025)
      uv.setXY(i, (x + 0.7) / 1.4, (y + 0.65) / 0.7)
    }
    geometry.computeVertexNormals()
    const bib = new THREE.Mesh(geometry, material); bib.position.y = 1.69; this.scarf.add(bib)
    form(this.scarf, material, [0.18, 0.12, 0.14], [-0.63, 1.62, 0.02])
    const bow = form(this.scarf, material, [0.26, 0.085, 0.12], [-0.83, 1.66, 0.01]); bow.rotation.z = -0.35
    const tail = form(this.scarf, material, [0.11, 0.24, 0.06], [-0.75, 1.41, 0.04]); tail.rotation.z = -0.45
    this.root.add(this.scarf)
  }

  configure(config: CompanionConfig): void {
    this.fur.color.set(config.bodyColor); this.muzzle.color.set(config.bodyColor).multiplyScalar(0.84)
    this.glasses.visible = config.glasses; this.scarf.visible = config.scarf
  }

  snapshot(): object { return { headYaw: this.head.rotation.y, headPitch: this.head.rotation.x, earAngles: this.ears.map(ear => ear.rotation.z) } }

  pose(p: Pose, dt = 1 / 60): void {
    const s = p.sleep, awake = 1 - s, expression = p.expression
    const breath = Math.sin(p.time * (s > 0.5 ? 1.55 : 1.9)) * 0.012 * p.motion
    this.torso.position.set(0, 0.92 - s * 0.29, -s * 0.15)
    this.torso.scale.set(1 + s * 0.06 + breath, 1 - s * 0.24 + breath, 1 + s * 0.26 + breath)
    this.head.position.set(0, 1.55 - s * 1.12, 0.06 + s * 0.25)
    const yaw = THREE.MathUtils.clamp(angleDelta(0, p.lookYaw + p.headLead), -1.05, 1.05) * awake
    this.headYaw = p.motion === 0 ? yaw : damp(this.headYaw, yaw, 6, dt)
    this.head.rotation.set(s * 0.16 + awake * (-p.lookPitch + expression.headPitch), this.headYaw,
      ((p.emotion === 'curious' ? -0.09 : 0) + expression.headRoll) * awake - p.lean * 0.2)
    this.scarf.position.set(0, -s * 0.56, s * 0.02); this.scarf.scale.y = 1 - s * 0.25
    const blink = Math.max(s, p.blink, expression.blink)
    for (let i = 0; i < 2; i++) {
      this.openEyes[i].visible = blink < 0.88; this.closedEyes[i].visible = blink >= 0.88
      this.openEyes[i].scale.y = Math.max(0.04, (1 - blink) * (p.emotion === 'happy' ? 0.68 : p.emotion === 'focused' ? 0.75 : 1) + expression.wideEyes)
      this.openEyes[i].scale.x = 1 + expression.wideEyes * 0.35
      this.openEyes[i].position.set(p.gazeX * 0.023 * awake, p.gazeY * 0.023 * awake, 0)
      this.ears[i].rotation.z = (i === 0 ? -1 : 1) * (s * 0.22 + (p.emotion === 'happy' ? -0.12 : 0) - expression.earLift * 0.17 + expression.earFlap * 0.28)
      this.feet[i].position.z = 0.48 - s * 0.35
      const arm = this.arms[i]
      arm.position.set((i === 0 ? -1 : 1) * (0.57 - s * 0.22), 1.22 - s * 0.88, 0.35 + s * 0.25)
      arm.rotation.x = -s * 1.1 - expression.armRaise * 0.12 * awake
      arm.rotation.z = i === 1 ? expression.armRaise * awake - 0.08 * awake : 0.08 * awake
      this.wrists[i].rotation.z = i === 1 ? expression.wrist * awake : 0
    }
    this.root.position.y = expression.lift * awake * p.motion
    this.root.scale.set(1 + expression.squash * 0.5, 1 - expression.squash, 1 + expression.squash * 0.5)
    this.root.rotation.z = -p.lean * 0.2
  }
}
