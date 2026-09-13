import * as THREE from 'three'
import type { CompanionRig } from '../companion/rig'
import type { CompanionConfig } from '../companion/config'
import type { Pose } from '../companion/capybara'
import { pointerTurn } from './attention'
import { FEATHER } from './model'
import { ORB } from '../../../au-host-launcher/src/design/Launcher/orb'

/** Umbra is faceless. The shared controller supplies movement and rest; this rig
 * expresses its channels through the entire orb and never consumes blink/eye poses. */
export class Umbra implements CompanionRig {
  readonly root = new THREE.Group()
  readonly envelope = { width: 3.7, height: 3.7 }
  private orb: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private material: THREE.ShaderMaterial
  private config: CompanionConfig
  private attention = new THREE.Vector2()
  private attentionTarget = new THREE.Vector2()
  private projectedRadius = 1
  private projected = new THREE.Vector3()
  private rim = new THREE.Vector3()
  private center = new THREE.Vector3()
  private cameraRight = new THREE.Vector3()
  private frame = new THREE.Matrix3()
  private rotation = new THREE.Matrix4()
  private turn = new THREE.Quaternion()
  private turnTarget = new THREE.Quaternion()
  private logoForward = new THREE.Vector3(-.519903, .558293, .646536).normalize()
  private facing = new THREE.Vector3()
  private materialTurn = new THREE.Quaternion()
  private roll = new THREE.Quaternion()
  private axis = new THREE.Vector3()
  private gesturePitch = 0
  private awake = 1

  constructor(config: CompanionConfig) {
    this.config = config
    this.material = new THREE.ShaderMaterial({
      transparent: true, toneMapped: false,
      uniforms: {
        detail: { value: 1 }, softness: { value: FEATHER },
        materialFrame: { value: new THREE.Matrix3() }, brightness: { value: 1 }, angle: { value: 0 }, rest: { value: 0 },
      },
      vertexShader: `varying vec3 viewNormal;
        void main(){viewNormal=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec3 viewNormal;
        uniform mat3 materialFrame;uniform float detail,softness,brightness,angle,rest;
        void main(){
          // Original Toon Sphere lighting: surface normal dotted with the
          // direction from that surface point to ONE gaze light. The inverse
          // frame keeps the lighting and highlight in the same orientation.
          vec3 N=normalize(materialFrame*normalize(viewNormal));
          vec3 lightPosition=normalize(vec3(-.519903,.558293,.646536))*3.2;
          vec3 L=normalize(lightPosition-N);
          float light=dot(N,L);
          vec2 p=vec2(N.x,-N.y);
          float s=dot(p,vec2(.70710678));
          float edge=max(fwidth(light),softness*.25);
          vec3 col=vec3(${ORB.base.join(',')})/255.;
          vec3 dark=mix(vec3(${ORB.bands[0].from.join(',')}),vec3(${ORB.bands[0].to.join(',')}),clamp((s-.58)/.32,0.,1.))/255.;
          col=mix(col,dark,smoothstep(-.26-edge,-.26+edge,light));
          vec3 middle=mix(vec3(${ORB.bands[1].from.join(',')}),vec3(${ORB.bands[1].to.join(',')}),clamp((s-.18)/.46,0.,1.))/255.;
          col=mix(col,middle,smoothstep(-.045-edge,-.045+edge,light));
          vec3 cap=mix(vec3(${ORB.cap.from.join(',')}),vec3(${ORB.cap.to.join(',')}),clamp(length(p-vec2(-.445,-.645))/1.32,0.,1.))/255.;
          cap=mix(vec3(.85),cap,detail);
          col=mix(col,cap,smoothstep(.18-edge,.18+edge,light));
          gl_FragColor=vec4(col*brightness*(1.-rest*.12),1.);
        }`,
    })
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(1.3, 96, 64), this.material)
    this.orb.position.y = 1.2
    this.root.add(this.orb)
    this.configure(config)
  }

  configure(config: CompanionConfig): void {
    this.config = config
    const u = this.material.uniforms
    u.detail.value = config.umbraDetail
    u.softness.value = config.umbraSoftness
    u.brightness.value = config.umbraBrightness
  }

  pose(pose: Pose, _dt: number, _speed: number): void {
    const { expression: e, motion, sleep, time } = pose
    const awake = 1 - sleep
    const breath = Math.sin(time * (sleep > .5 ? 1.2 : 1.8)) * .012 * motion
    const squash = e.squash * motion
    this.orb.scale.set(1 + breath + squash, 1 + breath - squash, 1 + breath + squash)
    this.orb.position.y = 1.2 - sleep * .14 + (e.lift - e.headPitch * .28) * motion
      + Math.sin(time * .9) * .045 * motion * awake
    this.orb.position.x = e.wrist * .15 * motion
    this.awake = awake
    this.gesturePitch = -e.headPitch * motion
    this.material.uniforms.rest.value = sleep
    this.material.uniforms.angle.value = this.config.umbraLightAngle * Math.PI / 180
      + (pose.lean * .16 + e.headRoll + e.wrist * .1) * motion
  }

  aim(pointer: { x: number; y: number } | null, camera: THREE.Camera, dt: number, reduced: boolean): void {
    this.orb.updateWorldMatrix(true, false)
    this.orb.getWorldPosition(this.center)
    this.projected.copy(this.center).project(camera)
    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0)
    const elements = this.orb.matrixWorld.elements
    const radius = 1.3 * Math.hypot(elements[0], elements[1], elements[2])
    this.rim.copy(this.center).addScaledVector(this.cameraRight, radius).project(camera)
    const projectedRadius = Math.max(.0001, Math.abs(this.rim.x - this.projected.x))
    // Correct vertical NDC for camera aspect before measuring a radial distance.
    const aspect = camera.projectionMatrix.elements[5] / camera.projectionMatrix.elements[0]
    this.projectedRadius = projectedRadius
    const x = pointer ? pointer.x - this.projected.x : 0
    const y = pointer ? (pointer.y - this.projected.y) / aspect : 0
    const target = pointerTurn(x, y, projectedRadius)
    const ease = reduced ? 1 : 1 - Math.exp(-7 * Math.min(dt, .05))
    this.attention.lerp(this.attentionTarget.set(target.x * this.awake, target.y * this.awake), ease)
    // Aim the logo's actual forward direction at the cursor, rather than adding
    // a small offset to its upper-left resting direction.
    const pitch = target.y * this.awake + this.gesturePitch
    const yaw = target.x * this.awake
    const turnAngle = Math.hypot(yaw, pitch)
    const radial = turnAngle > 1e-8 ? Math.sin(turnAngle) / turnAngle : 1
    this.facing.set(yaw * radial, pitch * radial, Math.cos(turnAngle))
    if (pointer && this.awake > .01) this.turnTarget.setFromUnitVectors(this.logoForward, this.facing)
    else this.turnTarget.identity()
    this.turn.slerp(this.turnTarget, ease)
    this.roll.setFromAxisAngle(this.axis.set(0, 0, 1), this.material.uniforms.angle.value)
    this.materialTurn.copy(this.turn).multiply(this.roll).invert()
    this.rotation.makeRotationFromQuaternion(this.materialTurn)
    this.frame.setFromMatrix4(this.rotation)
    this.material.uniforms.materialFrame.value.copy(this.frame)
  }

  snapshot(): object {
    return { projectedCenter: this.projected.toArray(), projectedRadius: this.projectedRadius, kind: 'umbra', faceless: true, facing: this.logoForward.clone().applyQuaternion(this.turn).toArray(), attention: this.attention.toArray(), material: {
      detail: this.config.umbraDetail, softness: this.config.umbraSoftness,
      brightness: this.config.umbraBrightness, lightAngle: this.config.umbraLightAngle,
    }, orbPosition: this.orb.position.toArray(), orbScale: this.orb.scale.toArray() }
  }
}
