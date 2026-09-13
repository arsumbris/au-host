import * as THREE from 'three'
import type { Pose } from './capybara'
import type { CompanionConfig } from './config'
import type { CompanionRig } from './rig'
import { angleDelta, damp } from './motion'
import { form, line } from './geometry'
import { panel, paperMaterial } from './paper'

/** Folded paper anatomy, with independently posed hood, coat, gloves and book. */
export class Heinrich implements CompanionRig {
  readonly root = new THREE.Group()
  private figure = new THREE.Group()
  private hood = new THREE.Group()
  private coat = new THREE.Group()
  private eye = new THREE.Group()
  private pupil: THREE.Mesh
  private hands: THREE.Group[] = []
  private feet: THREE.Group[] = []
  private standingShins: THREE.Mesh[] = []
  private foldedLegs = new THREE.Group()
  private book = new THREE.Group()
  private bookCover = new THREE.Group()
  private yaw = 0
  private travel = 0
  private reading = 0

  constructor() {
    const paper = paperMaterial()
    const ink = new THREE.MeshStandardMaterial({ color: '#151617', roughness: 0.68 })
    const voidInk = new THREE.MeshBasicMaterial({ color: '#08090a', side: THREE.DoubleSide })
    const eyeWhite = new THREE.MeshBasicMaterial({ color: '#f4f0e5', side: THREE.DoubleSide })
    const edge = new THREE.MeshStandardMaterial({ color: '#bbb5a7', roughness: 0.95 })
    this.root.add(this.figure); this.figure.add(this.hood, this.coat, this.book)
    this.hood.position.y = 1.74
    const tip = [0, 1.06, -0.12], left = [-0.92, -0.40, 0.49], right = [0.92, -0.40, 0.49], back = [0, -0.43, -0.76]
    // The front opening is cut into the shell, exposing a recessed ink-dark cavity.
    const opening = [0, 0.48, 0.52], lowLeft = [-0.64,-0.23,0.54], lowRight = [0.64,-0.23,0.54]
    panel(this.hood,paper,[tip,left,lowLeft,opening]); panel(this.hood,paper,[tip,opening,lowRight,right])
    panel(this.hood,paper,[tip,back,left]); panel(this.hood,paper,[tip,right,back])
    panel(this.hood,voidInk,[[0,0.51,0.47],[-0.70,-0.30,0.47],[0.70,-0.30,0.47]],0)
    panel(this.hood,paper,[left,right,lowRight,lowLeft])
    for (const points of [[tip,left],[tip,right],[left,lowLeft,opening,lowRight,right],[left,back,right]]) {
      for (let i=1;i<points.length;i++) line(this.hood,edge,[points[i-1],points[i]],0.012)
    }
    this.eye.position.set(0,0.01,0.505); this.hood.add(this.eye)
    const almond = new THREE.Shape(); almond.moveTo(-0.39,0)
    almond.bezierCurveTo(-0.17,0.30,0.16,0.30,0.39,0); almond.bezierCurveTo(0.16,-0.24,-0.18,-0.24,-0.39,0)
    this.eye.add(new THREE.Mesh(new THREE.ShapeGeometry(almond,32),eyeWhite))
    this.pupil = form(this.eye,voidInk,[0.145,0.155,0.012],[0,0,0.012],1)
    form(this.pupil,eyeWhite,[0.035,0.035,0.009],[-0.042,0.053,0.013],1)
    // The coat is a faceted open-front frustum; its rear has genuine volume.
    this.coat.position.y = 0.65
    const count = 12
    for(let i=0;i<count;i++) {
      const a = 0.045+i*(Math.PI*2-0.09)/count, b = 0.045+(i+1)*(Math.PI*2-0.09)/count
      const at = (angle:number,radius:number,y:number):number[] => [Math.sin(angle)*radius,y,Math.cos(angle)*radius*0.72]
      panel(this.coat,paper,[at(a,0.36,0.99),at(b,0.36,0.99),at(b,0.82,0.02),at(a,0.82,0.02)],0.012)
      line(this.coat,edge,[at(a,0.82,0.02),at(b,0.82,0.02)],0.008)
    }
    const lining = new THREE.Mesh(new THREE.CylinderGeometry(0.33,0.77,0.94,32,1,false),ink)
    lining.position.y=0.50; lining.scale.z=0.72; this.coat.add(lining)
    form(this.coat,ink,[0.31,0.40,0.25],[0,0.49,0])
    for(const side of [-1,1]) {
      const hand = new THREE.Group(); this.figure.add(hand); this.hands.push(hand)
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.18,0.28,16,1,false),paper); sleeve.rotation.z=side*-0.38; sleeve.position.set(-side*0.035,0.10,-0.23); hand.add(sleeve)
      form(hand,ink,[0.155,0.17,0.125],[0,0,0]); form(hand,ink,[0.065,0.087,0.07],[-side*0.12,0.015,0.05])
      const foot = new THREE.Group(); this.figure.add(foot); this.feet.push(foot)
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.067,0.07,0.25,8),paper); shin.position.y=0.29; foot.add(shin); this.standingShins.push(shin)
      form(foot,ink,[0.12,0.13,0.145],[0,0.13,0]); form(foot,ink,[0.14,0.085,0.22],[0,0.055,0.10])
    }
    this.figure.add(this.foldedLegs)
    for(const side of [-1,1]) {
      line(this.foldedLegs,paper,[
        [side*0.22,0.79,0.13],
        [side*0.53,0.58,0.34],
        [side*0.59,0.47,0.48],
        [side*0.25,0.46,0.64],
        [-side*0.22,0.55,0.68],
      ],0.105)
    }
    this.foldedLegs.scale.setScalar(0)
    const pagesMaterial = new THREE.MeshStandardMaterial({ color: '#d9d0ba', roughness: 0.95 })
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.33,0.45,0.075),pagesMaterial)
    this.book.add(pages)
    const backCover = new THREE.Mesh(new THREE.BoxGeometry(0.38,0.50,0.026),ink)
    backCover.position.z=-0.052; this.book.add(backCover)
    this.bookCover.position.set(-0.19,0,0.052); this.book.add(this.bookCover)
    const frontCover = new THREE.Mesh(new THREE.BoxGeometry(0.38,0.50,0.026),ink)
    frontCover.position.x=0.19; this.bookCover.add(frontCover)
    for(const y of [-0.205,0.205]) line(this.bookCover,edge,[[0.035,y,0.016],[0.345,y,0.016]],0.004)
    for(const x of [0.035,0.345]) line(this.bookCover,edge,[[x,-0.205,0.016],[x,0.205,0.016]],0.004)
    for(let i=0;i<5;i++) line(this.book,edge,[[0.166,-0.216,-0.025+i*0.012],[0.166,0.216,-0.025+i*0.012]],0.002)
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.027,0.50,0.13),ink)
    spine.position.x=-0.184; this.book.add(spine)
  }

  configure(_config: CompanionConfig): void { /* Paper, ink and the book define the character's palette. */ }

  pose(p: Pose, dt: number, speed: number): void {
    const s=p.sleep, awake=1-s, e=p.expression
    this.travel=damp(this.travel,speed*awake,2.5,dt)
    this.reading=damp(this.reading,p.emotion==='focused'?awake:0,3,dt)
    const reading=this.reading, breath=Math.sin(p.time*1.6)*0.009*p.motion
    this.yaw=damp(this.yaw,THREE.MathUtils.clamp(angleDelta(0,p.lookYaw+p.headLead),-0.85,0.85)*awake*(1-reading*0.65),4,dt)
    this.hood.rotation.set(-p.lookPitch*awake*0.55+e.headPitch*awake+reading*0.16,this.yaw,e.headRoll*awake)
    this.hood.position.y=1.74-s*0.16+breath
    this.eye.scale.y=Math.max(0.025,(1-Math.max(s,p.blink,e.blink))*(1+e.wideEyes*0.2))
    this.pupil.position.x=damp(this.pupil.position.x,THREE.MathUtils.clamp(p.gazeX,-1,1)*0.11*awake*(1-reading),7,dt)
    this.pupil.position.y=damp(this.pupil.position.y,THREE.MathUtils.clamp(p.gazeY,-1,1)*0.025*awake-reading*0.025,7,dt)
    this.figure.rotation.set(-this.travel*0.25*p.motion,0,-p.lean*0.10*awake)
    this.figure.position.set(0,0.12+s*0.15+breath,0)
    this.foldedLegs.scale.setScalar(s)
    this.coat.scale.y=1-s*0.16
    this.coat.rotation.x=damp(this.coat.rotation.x,this.travel*0.13*p.motion,3,dt)
    this.coat.scale.z=1+this.travel*0.08*p.motion
    this.book.position.set(-0.28*(1-reading)*awake,1.14-s*0.42,0.70+s*0.04)
    this.book.rotation.set((-0.05-reading*0.30)*awake-Math.PI/2*s,-0.10*(1-reading)*awake,0.12*(1-reading)*(1-s))
    this.bookCover.rotation.y=-reading*2.5
    for(let i=0;i<2;i++) {
      const side=i===0?-1:1, wave=i===1?e.armRaise/2.5*awake*(1-reading):0
      this.hands[i].position.set(i===0 ? -0.31 : 0.57*(1-reading)+0.25*reading+wave*0.16, (i===0 ? 1.01 : 0.92+reading*0.12)+wave*0.60+s*0.05, i===0 ? 0.81 : 0.35+reading*0.45-wave*0.10)
      this.hands[i].position.lerp(new THREE.Vector3(side*0.55,0.68,0.58),s)
      this.hands[i].rotation.z=(side*(0.08-wave*0.45)+wave*e.wrist*0.5)*awake-side*0.25*s
      this.feet[i].position.set(side*0.29,0.26+Math.sin(p.time*2+i)*this.travel*0.025*p.motion,-0.04-this.travel*0.12*p.motion)
      this.standingShins[i].scale.y=awake
      this.standingShins[i].visible=s<0.95
      this.feet[i].position.lerp(new THREE.Vector3(-side*0.22,0.44,0.68),s)
      this.feet[i].rotation.set(-this.travel*0.4*p.motion,side*(0.17+s*1.05),side*(0.08+s*0.5))
    }
    this.root.position.y=e.lift*awake*p.motion
    this.root.scale.set(1+e.squash*0.25,1-e.squash,1+e.squash*0.25)
  }

  snapshot(): object { return { restPose:'meditation', headYaw:this.yaw, reading:this.reading, travel:this.travel, eyeOpen:this.eye.scale.y, bookOpening:-this.bookCover.rotation.y/2.5 } }
}
