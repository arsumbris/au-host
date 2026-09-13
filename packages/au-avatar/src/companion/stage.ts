import { cursorAttention, WorkAttention } from './attention'
import * as THREE from 'three'
import { Follow } from './follow'
import { Navigation } from './navigation'
import { Behavior } from './behavior'
import { type Emotion, type Gesture } from './capybara'
import { createCapybaraRig, type CompanionRig, type RigFactory } from './rig'
import { type CompanionConfig, parseConfig } from './config'
import { disposeObject } from '../three-resources'
import { clamp, damp, smooth, Flight, angleDelta, type Bounds } from './motion'

export class CompanionStage {
  readonly behavior: Behavior
  readonly flight = new Flight()
  readonly canvas = document.createElement('canvas')
  readonly bubble = document.createElement('div')
  private speech = document.createElement('span')
  private sleepLetters = document.createElement('span')
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
  private rig = new THREE.Group()
  private model = new THREE.Group()
  private character: CompanionRig
  private observer: ResizeObserver
  private media = matchMedia('(prefers-reduced-motion: reduce)')
  private abort = new AbortController()
  private bounds: Bounds = { x: 0, y: 0 }
  private width = 1
  private height = 1
  private scale = 1
  private baseScale = 1
  private busyUntil = 0
  private personalSpace = 0
  private pointerClient = { clientX: 0, clientY: 0, time: 0 }
  private worldWidth = 8
  private frameId = 0
  private previousTime = 0
  private disposed = false
  private pointer = { x: 0, y: 0, present: false }
  private grab: { id: number; x: number; y: number; offsetX: number; offsetY: number; dragged: boolean } | null = null
  private screenGazeX = 0
  private gazeX = 0
  private gazeY = 0
  private lookYaw = 0
  private lookPitch = 0
  private bank = 0
  private navigation = new Navigation()
  private lastTravelTime = -100
  private travelPointer = { x: 0, y: 0 }
  private follow = new Follow()
  private workAttention = new WorkAttention()
  private wasParked = false
  private cameraAzimuth = 28 * Math.PI / 180
  private nextGlance = 0
  private idleGaze = { x: 0, y: 0 }
  private right = new THREE.Vector3()
  private up = new THREE.Vector3()
  private scratch = new THREE.Vector3()
  private ndc = new THREE.Vector2()
  private ray = new THREE.Raycaster()
  private lastState = ''
  private home: HTMLElement | null = null
  private returning: { time: number; x: number; y: number; vx: number; vy: number; scale: number } | null = null
  private portal: HTMLElement | null = null
  private homeButton = document.createElement('button')
  private roamHeight = 150
  private config: CompanionConfig

  constructor(private container: HTMLElement, config: CompanionConfig, private onState?: (state: string) => void, createRig: RigFactory = createCapybaraRig, restMode: 'sleep' | 'ruminate' = 'sleep') {
    this.config = parseConfig(config); this.behavior = new Behavior(this.config, restMode)
    this.canvas.tabIndex = 0; this.canvas.setAttribute('role', 'button')
    this.canvas.setAttribute('aria-label', 'Companion. Click to wake, then click to follow around the window. Drag to move. Enter to greet, S to sleep, arrow keys to move, Escape to rest.')
    if (restMode === 'ruminate') this.canvas.setAttribute('aria-label', 'Umbra. Click to follow. Drag to move. Enter to greet, S to ruminate, arrow keys to move, Escape to return.')
    this.canvas.setAttribute('aria-keyshortcuts', 'Enter Space S Escape ArrowUp ArrowDown ArrowLeft ArrowRight')
    this.canvas.style.touchAction = 'none'
    this.bubble.className = 'companion-bubble'; this.bubble.setAttribute('aria-live', 'polite'); this.bubble.hidden = true
    this.sleepLetters.className = 'companion-sleep-letters'; this.sleepLetters.setAttribute('aria-hidden', 'true')
    this.sleepLetters.innerHTML = '<span>z</span><span>z</span><span>Z</span>'
    this.bubble.append(this.speech, this.sleepLetters)
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setClearColor(0, 0)
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0
    this.scene.add(new THREE.HemisphereLight('#fff0d9', '#a3a9c5', 1.1))
    const light = new THREE.DirectionalLight('#fff0d8', 2.0); light.position.set(-3, 7, 6)
    light.castShadow = true; light.shadow.mapSize.set(1024, 1024)
    light.shadow.camera.left = light.shadow.camera.bottom = -6
    light.shadow.camera.right = light.shadow.camera.top = 6
    light.shadow.normalBias = 0.03; light.shadow.bias = -0.0001
    this.scene.add(light)
    const rim = new THREE.DirectionalLight('#d7dcff', 0.8); rim.position.set(3, 4, -4); this.scene.add(rim)
    this.character = createRig(this.config)
    this.model.add(this.character.root); this.model.position.y = -1.2
    this.rig.add(this.model); this.scene.add(this.rig)
    this.setView(28)
    container.append(this.canvas, this.bubble)
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container)
    this.bindInput(); this.resize(); this.start()
  }

  get settings(): CompanionConfig { return { ...this.config } }
  get reduced(): boolean { return this.config.reducedMotion || this.media.matches }

  configure(config: CompanionConfig): void {
    const next = parseConfig(config)
    this.config = next; this.character.configure(next); this.behavior.configure(next); this.resize()
  }

  setView(degrees: number): void {
    const a = degrees * Math.PI / 180
    this.cameraAzimuth = a
    this.camera.position.set(Math.sin(a) * 10, 4.2, Math.cos(a) * 10)
    this.camera.lookAt(0, 0, 0); this.camera.updateMatrixWorld()
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0); this.up.setFromMatrixColumn(this.camera.matrixWorld, 1)
  }

  sleep(): void { this.dock(); this.behavior.rest(); this.flight.targetX = this.flight.targetY = 0 }
  wake(): void { this.behavior.wake() }
  express(gesture: Gesture): void { if (this.behavior.sleeping) this.wake(); this.behavior.play(gesture) }
  setEmotion(emotion: Emotion): void { this.behavior.emotion = emotion; this.behavior.activity() }
  reset(): void {
    this.finishDock(); this.cancelGrab(); this.flight.targetX = this.flight.targetY = 0
    this.flight.x.position = this.flight.y.position = 0; this.flight.x.velocity = this.flight.y.velocity = 0
    this.behavior.emotion = 'content'; this.config.startSleeping ? this.sleep() : this.wake()
  }

  get roaming(): boolean { return this.home !== null }

  detach(): void {
    if (this.home) return
    const rect = this.container.getBoundingClientRect()
    const px = rect.left + rect.width / 2 + this.flight.x.position * rect.height / 6
    const py = rect.top + rect.height / 2 - this.flight.y.position * rect.height / 6
    this.roamHeight = Math.min(rect.height, 160) * 0.65
    this.follow.reset(); this.workAttention.reset(); this.wasParked = false
    this.home = this.container.parentElement!
    this.homeButton.type = 'button'; this.homeButton.className = 'companion-call-home'
    this.homeButton.setAttribute('aria-label', 'Bring companion home to sleep')
    this.homeButton.title = 'Return to bed — click anywhere in this area'
    this.homeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18V7m0 8h18v4M3 11h5a3 3 0 0 1 3 3v1m0-5h6a4 4 0 0 1 4 4v1M3 18v2m18-2v2"/><path d="M5 9h2"/></svg>'
    this.homeButton.onclick = () => this.dock()
    this.home.append(this.homeButton)
    this.portal = document.createElement('div')
    this.portal.setAttribute('data-au-scope', this.container.getAttribute('data-au-scope') ?? '')
    this.container.classList.add('companion-roaming'); this.portal.append(this.container); document.body.append(this.portal)
    this.resize()
    this.flight.x.position = (px - this.width / 2) * 6 / this.height
    this.flight.y.position = (this.height / 2 - py) * 6 / this.height
    this.flight.targetX = this.flight.x.position; this.flight.targetY = this.flight.y.position
    this.flight.x.velocity = this.flight.y.velocity = 0
    this.behavior.activity()
  }

  dock(): void {
    if (!this.home || this.returning) return
    this.cancelGrab(); this.pointer.present = false
    this.behavior.rest()
    if (this.reduced) { this.finishDock(); return }
    this.returning = { time: 0, x: this.flight.x.position, y: this.flight.y.position,
      vx: this.flight.x.velocity, vy: this.flight.y.velocity, scale: this.scale }
    this.homeButton.setAttribute('aria-label', 'Companion returning home')
    this.homeButton.setAttribute('aria-busy', 'true'); this.homeButton.disabled = true
  }

  private finishDock(): void {
    this.returning = null; this.homeButton.disabled = false
    this.homeButton.removeAttribute('aria-busy')
    if (!this.home) return
    this.cancelGrab(); this.home.append(this.container); this.home = null
    this.container.classList.remove('companion-roaming'); this.homeButton.remove()
    this.portal?.remove(); this.portal = null
    this.pointer.present = false
    this.flight.x.position = this.flight.y.position = this.flight.targetX = this.flight.targetY = 0
    this.flight.x.velocity = this.flight.y.velocity = 0
    this.resize()
  }

  private get envelope(): { width: number; height: number } {
    return this.character.envelope ?? { width: 6.4, height: 3.9 }
  }

  private resize(): void {
    this.width = Math.max(1, this.container.clientWidth); this.height = Math.max(1, this.container.clientHeight)
    this.worldWidth = 6 * this.width / this.height
    this.camera.left = -this.worldWidth / 2; this.camera.right = this.worldWidth / 2
    this.camera.updateProjectionMatrix(); this.renderer.setSize(this.width, this.height, false)
    // Envelope includes tilted carpet, tassels, awake ears, sleep posture and breathing.
    this.scale = Math.min(6 * this.config.size / this.envelope.height, this.worldWidth * 0.9 / this.envelope.width)
    if (this.roaming) this.scale *= this.roamHeight / this.height
    this.baseScale = this.scale
    if (this.pointer.present) this.pointer = { ...this.pointerPosition(this.pointerClient), present: true }
    this.rig.scale.setScalar(this.scale)
    this.bounds = { x: Math.max(0, this.worldWidth / 2 - this.scale * this.envelope.width / 2 - 0.08), y: Math.max(0, 3 - this.scale * this.envelope.height / 2 - 0.1) }
    this.flight.step(0, this.bounds, false, false)
  }

  private pointerPosition(event: Pick<PointerEvent, 'clientX' | 'clientY'>): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    // Container reparenting can temporarily remove its layout box. Do not feed infinities
    // into movement or material rotation while the next layout is pending.
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
    return { x: ((event.clientX - rect.left) / rect.width - 0.5) * this.worldWidth, y: (0.5 - (event.clientY - rect.top) / rect.height) * 6 }
  }

  private hit(event: PointerEvent): boolean {
    const p = this.pointerPosition(event)
    this.ndc.set(p.x / this.worldWidth * 2, p.y / 3)
    this.scene.updateMatrixWorld(true); this.ray.setFromCamera(this.ndc, this.camera)
    return this.ray.intersectObject(this.rig, true).some(hit => {
      let object: THREE.Object3D | null = hit.object
      while (object) { if (!object.visible) return false; object = object.parent }
      return true
    })
  }

  private bindInput(): void {
    const options = { signal: this.abort.signal }
    window.addEventListener('pointermove', event => {
      this.workAttention.move(event.clientX,event.clientY,this.behavior.time)
      const elapsed = (event.timeStamp - this.pointerClient.time) / 1000
      const travel = Math.hypot(event.clientX - this.pointerClient.clientX, event.clientY - this.pointerClient.clientY)
      if (elapsed > 0 && elapsed < 0.2 && travel / elapsed > 350 && !this.grab) this.busyUntil = this.behavior.time + 1.2
      this.pointerClient = { clientX: event.clientX, clientY: event.clientY, time: event.timeStamp }
      const p = this.pointerPosition(event)
      if (Math.hypot(event.clientX - this.travelPointer.x, event.clientY - this.travelPointer.y) > 8) {
        this.travelPointer = { x: event.clientX, y: event.clientY }; this.lastTravelTime = this.behavior.time
      }
      this.pointer = { ...p, present: true }
      if (!this.behavior.sleeping) this.behavior.activity()
      if (this.grab && event.pointerId === this.grab.id) {
        if (!this.grab.dragged && Math.hypot(event.clientX - this.grab.x, event.clientY - this.grab.y) >= 5) {
          this.grab.dragged = true; this.behavior.grab()
        }
        if (this.grab.dragged) {
          this.flight.targetX = p.x + this.grab.offsetX; this.flight.targetY = p.y + this.grab.offsetY
        }
      }
    }, options)
    window.addEventListener('pointerout', event => { if (!event.relatedTarget) this.pointer.present = false }, options)
    window.addEventListener('click', event => {
      if (event.button !== 0) return
      if (event.target !== this.canvas) this.busyUntil = this.behavior.time + 1.2
      const rect = this.canvas.getBoundingClientRect()
      const x = rect.left + rect.width / 2 + this.flight.x.position * this.height / 6
      const y = rect.top + rect.height / 2 - this.flight.y.position * this.height / 6
      this.behavior.observeClick(Math.hypot(event.clientX - x, event.clientY - y) < 320)
    }, options)
    window.addEventListener('pointerdown', event => {
      if (event.target instanceof Node && this.homeButton.contains(event.target)) return
      if(event.button === 0 && event.target !== this.canvas && !this.hit(event)) this.workAttention.work(this.behavior.time,true)
      if (!this.roaming && event.target !== this.canvas) return
      if (event.button !== 0 || this.returning || this.grab || !this.hit(event)) return
      event.preventDefault(); event.stopPropagation()
      this.pointerClient = { clientX: event.clientX, clientY: event.clientY, time: event.timeStamp }
      const p = this.pointerPosition(event)
      this.canvas.focus({ preventScroll: true }); this.canvas.setPointerCapture(event.pointerId)
      this.grab = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX: this.flight.x.position - p.x, offsetY: this.flight.y.position - p.y, dragged: false }
    }, { ...options, capture: true })
    window.addEventListener('pointerup', event => {
      this.workAttention.release(this.behavior.time)
      if (!this.grab || this.grab.id !== event.pointerId) return
      const click = !this.grab.dragged
      this.cancelGrab()
      if (click) this.greet()
    }, options)
    window.addEventListener('pointercancel', () => this.workAttention.release(this.behavior.time), options)
    window.addEventListener('wheel', () => { this.workAttention.work(this.behavior.time); if(!this.behavior.sleeping) this.behavior.activity() }, { ...options, passive:true })
    this.canvas.addEventListener('pointercancel', () => this.cancelGrab(), options)
    this.canvas.addEventListener('lostpointercapture', () => this.cancelGrab(), options)
    window.addEventListener('blur', () => { this.workAttention.release(this.behavior.time); this.cancelGrab(); this.pointer.present = false }, options)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.cancelGrab(); cancelAnimationFrame(this.frameId); this.frameId = 0 }
      else this.start()
    }, options)
    window.addEventListener('keydown', event => {
      if (this.roaming && event.key === 'Escape') { this.dock(); return }
      if (event.target !== this.canvas) {
        if(event.key.length === 1 || ['Backspace','Delete','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
          this.workAttention.work(this.behavior.time); if(!this.behavior.sleeping) this.behavior.activity()
        }
        return
      }
      if (['Enter', ' ', 's', 'S', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault()
      if (event.key === 'Enter' || event.key === ' ') this.greet()
      if (event.key.toLowerCase() === 's') this.sleep()
      if (event.key === 'Escape') { this.cancelGrab(); this.flight.targetX = this.flight.targetY = 0; this.pointer.present = false }
      if (event.key.startsWith('Arrow')) {
        this.pointer.present = false; this.behavior.activity()
        if (this.behavior.sleeping) this.wake()
        if (event.key === 'ArrowLeft') this.flight.targetX -= 0.4
        if (event.key === 'ArrowRight') this.flight.targetX += 0.4
        if (event.key === 'ArrowUp') this.flight.targetY += 0.4
        if (event.key === 'ArrowDown') this.flight.targetY -= 0.4
      }
    }, options)
  }

  private greet(): void {
    if (this.behavior.sleeping) this.wake()
    else if (!this.roaming) { this.detach(); this.behavior.play('wave') }
    else { this.behavior.play('wave'); this.behavior.say('Hello.') }
  }

  private cancelGrab(): void {
    const id = this.grab?.id; this.grab = null; this.behavior.release()
    if (id !== undefined && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id)
  }

  private start(): void {
    if (this.disposed || this.frameId || document.hidden) return
    this.previousTime = performance.now(); this.frameId = requestAnimationFrame(this.frame)
  }

  private frame = (now: number): void => {
    const dt = Math.min((now - this.previousTime) / 1000, 0.05); this.previousTime = now
    const b = this.behavior, reduced = this.reduced, amount = reduced ? 0 : this.config.motion
    const activeTravel = b.dragging || (this.pointer.present && b.time - this.lastTravelTime < 0.7)
    b.update(dt, reduced)
    this.workAttention.update(b.time)
    const parked=this.workAttention.parked && !b.dragging
    if(parked && !this.wasParked) { this.flight.targetX=this.flight.x.position; this.flight.targetY=this.flight.y.position; this.follow.reset() }
    if(!parked && this.wasParked) this.follow.reset()
    this.wasParked=parked
    this.personalSpace = reduced ? 0 : damp(this.personalSpace, b.time < this.busyUntil && !b.dragging ? 1 : 0, 3, dt)
    if (this.roaming && !this.returning) {
      this.scale = reduced ? this.baseScale : damp(this.scale, this.baseScale, 4, dt)
      this.rig.scale.setScalar(this.scale)
      this.bounds = { x: Math.max(0, this.worldWidth / 2 - this.scale * this.envelope.width / 2 - 0.08), y: Math.max(0, 3 - this.scale * this.envelope.height / 2 - 0.1) }
    }
    if (b.sleeping && this.roaming) this.dock()
    if (b.sleeping && !b.dragging) this.flight.targetX = this.flight.targetY = 0
    else if (this.roaming && !this.returning && this.pointer.present && this.config.followCursor && !this.grab && !reduced && !parked) {
      const target = this.follow.update(this.pointer,
        {x:this.flight.x.position,y:this.flight.y.position},this.bounds,
        {x:this.scale*3.2+64*6/this.height,y:this.scale*1.95+48*6/this.height},6/this.height,dt)
      this.flight.targetX = target.x; this.flight.targetY = target.y
    }
    if (this.returning && this.home) {
      const r = this.returning; r.time += dt
      const rect = this.home.getBoundingClientRect(), t = Math.min(1, r.time / 1.1), ease = smooth(t)
      const tx = (rect.left + rect.width / 2 - this.width / 2) * 6 / this.height
      const ty = (this.height / 2 - rect.top - rect.height / 2) * 6 / this.height
      const carry = t * (1 - t) * (1 - t) * 1.1
      this.flight.x.position = r.x + (tx - r.x) * ease + r.vx * carry
      this.flight.y.position = r.y + (ty - r.y) * ease + r.vy * carry
      this.flight.x.velocity = this.flight.y.velocity = 0
      const homeScale = Math.min(6 * this.config.size / 3.9, 6 * rect.width / Math.max(1, rect.height) * 0.9 / 6.4) * rect.height / this.height
      this.scale = r.scale + (homeScale - r.scale) * ease; this.rig.scale.setScalar(this.scale)
      if (t === 1) this.finishDock()
    } else this.flight.step(dt, this.bounds, b.dragging, reduced)
    const speed = Math.min(1, Math.hypot(this.flight.x.velocity, this.flight.y.velocity) / 3)
    const vx = this.flight.x.velocity, vz = -this.flight.y.velocity / Math.max(0.2, Math.hypot(this.up.x, this.up.z))
    const travelHeading = Math.atan2(vx, vz) + this.cameraAzimuth
    const pixelScale = this.height / 6
    const distance = Math.hypot(this.flight.targetX - this.flight.x.position, this.flight.targetY - this.flight.y.position) * pixelScale
    this.navigation.update(travelHeading, Math.hypot(vx, this.flight.y.velocity) * pixelScale,
      b.dragging ? 100 : distance, (activeTravel || (this.roaming && distance > 18)) && !b.sleeping && amount > 0, dt, reduced)
    const targetBank = clamp(-this.navigation.heading.rate * 0.07 * speed, -0.16, 0.16) * amount
    this.bank = damp(this.bank, targetBank, 5, dt)
    const float = amount * (b.sleeping ? 0.012 : 0.035) * Math.sin(b.time * 1.3)
    this.rig.position.copy(this.right).multiplyScalar(this.flight.x.position).addScaledVector(this.up, this.flight.y.position + float)
    this.model.rotation.set(-speed * 0.035 * amount, this.navigation.heading.angle, this.bank, 'YXZ')
    if (b.time > this.nextGlance) {
      this.nextGlance = b.time + 2.5 + Math.random() * 3
      this.idleGaze = { x: (Math.random() - 0.5) * 0.5, y: (Math.random() - 0.5) * 0.2 }
    }
    const attentive = this.pointer.present
    const dx = this.pointer.x - this.flight.x.position, dy = this.pointer.y - this.flight.y.position
    // Pointer coordinates use six world units per viewport height. Use an app-sized
    // attention radius even while docked, so most of the window is not a clamped extreme.
    const radius = Math.max(window.innerWidth, window.innerHeight) * 0.45 * 6 / this.height
    const attention = cursorAttention(dx, dy, radius, this.cameraAzimuth, this.navigation.heading.angle)
    const gx = attentive ? attention.gazeX : this.idleGaze.x
    const gy = attentive ? attention.gazeY : this.idleGaze.y
    this.gazeX = reduced ? attentive ? gx : 0 : damp(this.gazeX, gx, 7, dt)
    const screenGX = attentive ? clamp(dx / 2, -1, 1) : this.idleGaze.x
    this.screenGazeX = reduced ? attentive ? screenGX : 0 : damp(this.screenGazeX, screenGX, 7, dt)
    this.gazeY = reduced ? attentive ? gy : 0 : damp(this.gazeY, gy, 7, dt)
    const yaw = attentive ? attention.yaw : this.idleGaze.x * 0.35
    const pitch = attentive ? attention.pitch : this.idleGaze.y * 0.2
    this.lookYaw += reduced ? angleDelta(this.lookYaw, yaw) : angleDelta(this.lookYaw, yaw) * (1 - Math.exp(-5 * dt))
    this.lookYaw = angleDelta(0, this.lookYaw)
    this.lookPitch = reduced ? pitch : damp(this.lookPitch, pitch, 5, dt)
    this.character.pose({ time: b.time, sleep: b.sleep, blink: b.blink, gazeX: this.gazeX, gazeY: this.gazeY,
      screenGazeX: this.screenGazeX, lookYaw: this.lookYaw, lookPitch: this.lookPitch, headLead: this.navigation.lead, lean: this.bank, motion: amount, expression: b.expression.pose, emotion: b.emotion }, dt, speed)
    this.character.aim?.(attentive && this.config.followCursor ? { x: this.pointer.x * 2 / this.worldWidth, y: this.pointer.y / 3 } : null, this.camera, dt, reduced)
    this.updateBubble()
    this.container.dataset.state = b.state
    this.container.dataset.reduced = String(reduced)
    this.canvas.style.cursor = b.dragging ? 'grabbing' : 'grab'
    if (this.lastState !== b.state) { this.lastState = b.state; this.onState?.(b.state) }
    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.frame)
  }

  private updateBubble(): void {
    const b = this.behavior
    const text = b.sleep > 0.98 ? 'z z' : b.time < b.bubbleUntil ? b.bubble : ''
    this.bubble.hidden = !this.config.bubbles || !text
    this.speech.hidden = b.sleep > 0.98; this.sleepLetters.hidden = b.sleep <= 0.98
    if (this.speech.textContent !== text) this.speech.textContent = text
    if (!text) return
    this.scratch.copy(this.rig.position).addScaledVector(this.up, this.scale * (b.sleep > 0.98 ? 0.65 : 1.5)).project(this.camera)
    const x = (this.scratch.x * 0.5 + 0.5) * this.width
    const y = (-this.scratch.y * 0.5 + 0.5) * this.height
    const half = this.bubble.offsetWidth / 2
    this.bubble.style.left = `${clamp(x + this.scale * this.height * 0.11, half + 6, Math.max(half + 6, this.width - half - 6))}px`
    const topInset = b.sleep > 0.98 ? 36 : 6
    this.bubble.style.top = `${clamp(y - 18, topInset, Math.max(topInset, this.height - this.bubble.offsetHeight - 6))}px`
    this.bubble.dataset.sleeping = String(b.sleep > 0.98)
  }

  /** Read-only measurements for behavior checks. */
  snapshot(): object {
    const visiblePixels = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    this.scene.updateMatrixWorld(true)
    this.rig.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.computeBoundingBox()
      const box = object.geometry.boundingBox
      if (!box) return
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        this.scratch.set(x, y, z).applyMatrix4(object.matrixWorld).project(this.camera)
        const px = (this.scratch.x * 0.5 + 0.5) * this.width, py = (-this.scratch.y * 0.5 + 0.5) * this.height
        visiblePixels.left = Math.min(visiblePixels.left, px); visiblePixels.right = Math.max(visiblePixels.right, px)
        visiblePixels.top = Math.min(visiblePixels.top, py); visiblePixels.bottom = Math.max(visiblePixels.bottom, py)
      }
    })
    return { workPaused: this.workAttention.parked, returning: !!this.returning, roaming: this.roaming, state: this.behavior.state, sleep: this.behavior.sleep, position: [this.flight.x.position, this.flight.y.position],
      bounds: { ...this.bounds }, visiblePixels, viewport: { width: this.width, height: this.height },
      rigPose: this.character.snapshot?.(), navigation: this.navigation.mode, headLead: this.navigation.lead, heading: this.navigation.heading.angle, turnRate: this.navigation.heading.rate, look: [this.lookYaw, this.lookPitch], gaze: [this.gazeX, this.gazeY], pointer: { ...this.pointer }, personalSpace: this.personalSpace, scale: this.scale, reduced: this.reduced, gesture: this.behavior.expression.gesture,
      expression: { ...this.behavior.expression.pose }, geometries: this.renderer.info.memory.geometries,
      drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }
  }

  dispose(): void {
    if (this.disposed) return
    this.finishDock(); this.homeButton.onclick = null
    this.disposed = true; cancelAnimationFrame(this.frameId); this.cancelGrab(); this.abort.abort(); this.observer.disconnect()
    disposeObject(this.scene)
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove(); this.bubble.remove()
  }
}
