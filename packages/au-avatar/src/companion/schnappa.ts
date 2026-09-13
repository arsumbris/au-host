import * as THREE from 'three'
import type { Pose } from './capybara'
import type { CompanionConfig } from './config'
import type { CompanionRig } from './rig'
import { PlushSurface } from './plush'
import { angleDelta, damp } from './motion'
import { line } from './geometry'

/** A soft four-pawed toy with its own anatomy over the shared companion controller. */
export class Schnappa implements CompanionRig {
  readonly root = new THREE.Group()
  private head = new THREE.Group()
  private body: THREE.Group
  private paws: THREE.Group[] = []
  private ears: THREE.Group[] = []
  private eyes: THREE.Group[] = []
  private lids: THREE.Mesh[] = []
  private tail: THREE.Group
  private yaw=0
  private travel=0
  private stride=0

  constructor() {
    const plush=new PlushSurface()
    this.body=plush.part([0.64,0.48,0.82],2600);this.body.position.set(0,0.65,-0.40);this.root.add(this.body)
    for(const z of [0.52,-0.92])for(const side of [-1,1]){
      const paw=plush.part([0.285,0.255,0.40],700);paw.position.set(side*0.59,0.28,z)
      paw.rotation.z=side*-0.11;this.root.add(paw);this.paws.push(paw)
    }
    this.head.position.set(0,1.18,0.31);this.root.add(this.head)
    const skull=plush.part([0.85,0.79,0.70],6500,false,0.82);this.head.add(skull)
    for(const side of [-1,1]){
      const anchor=new THREE.Group();anchor.position.set(side*0.68,0.49,-0.02)
      const ear=plush.part([0.245,0.41,0.12],1050,true,0.82);ear.position.set(side*0.07,-0.23,0.015)
      anchor.add(ear);anchor.rotation.z=side*(side<0?0.40:0.22);anchor.rotation.x=-0.06
      this.head.add(anchor);this.ears.push(anchor)
      const eye=new THREE.Group();eye.position.set(side*0.325,-0.125,0.704)
      const stitch=new THREE.Mesh(new THREE.SphereGeometry(1,20,16),plush.charcoal);stitch.scale.set(0.048,0.064,0.024);stitch.rotation.z=side*-0.15;eye.add(stitch)
      for(let i=0;i<3;i++)line(eye,plush.charcoal,[[-0.025+i*0.019,-0.035,0.021],[-0.028+i*0.019,0.012,0.027],[-0.017+i*0.019,0.045,0.022]],0.004)
      this.head.add(eye);this.eyes.push(eye)
      const lid=line(this.head,plush.charcoal,[[side*0.325-0.051,-0.117,0.710],[side*0.325,-0.14,0.728],[side*0.325+0.051,-0.112,0.710]],0.011)
      lid.visible=false;this.lids.push(lid)
    }
    const nose=plush.part([0.085,0.071,0.043],100,true,0.78);nose.position.set(0,-0.49,0.656);this.head.add(nose)
    line(this.head,plush.charcoal,[[0,-0.546,0.651],[0,-0.585,0.627],[-0.032,-0.594,0.613]],0.007)
    line(this.head,plush.charcoal,[[0,-0.585,0.627],[0.029,-0.594,0.613]],0.006)
    this.tail=plush.part([0.16,0.16,0.29],500);this.tail.position.set(0.04,0.68,-1.16);this.tail.rotation.x=-0.35;this.root.add(this.tail)
  }

  configure(_config: CompanionConfig): void { /* Coat and embroidery are identity features. */ }

  pose(p: Pose,dt: number,speed: number): void {
    const s=p.sleep,awake=1-s,motion=p.motion,e=p.expression
    this.travel=damp(this.travel,speed*awake,3,dt);this.stride+=dt*(2+this.travel*9)
    const bounce=Math.abs(Math.sin(this.stride))*this.travel*0.055*motion
    const breath=Math.sin(p.time*(s>0.5?1.5:1.9))*0.009*motion
    this.body.scale.set(1+breath,1-s*0.12+breath,1+s*0.06)
    this.body.position.y=0.65-s*0.10+bounce*0.6
    const target=THREE.MathUtils.clamp(angleDelta(0,p.lookYaw+p.headLead),-0.75,0.75)*awake
    this.yaw=damp(this.yaw,target,4.5,dt)
    this.head.position.set(0,1.18-s*0.30+bounce,0.31+s*0.13)
    this.head.rotation.set(-p.lookPitch*0.7*awake+e.headPitch*awake+s*0.11,this.yaw,
      -0.035*awake+e.headRoll*awake-p.lean*0.08)
    const blink=Math.max(s,p.blink,e.blink)
    for(let i=0;i<2;i++){
      this.eyes[i].scale.y=Math.max(0.04,1-blink+e.wideEyes*0.3);this.eyes[i].visible=blink<0.88;this.lids[i].visible=blink>=0.88
      const side=i===0?-1:1
      const earTarget=side*((i===0?0.40:0.22)+s*0.10-e.earLift*0.12+e.earFlap*0.42)+Math.sin(this.stride-0.5+i)*this.travel*0.07*motion
      this.ears[i].rotation.z=damp(this.ears[i].rotation.z,earTarget,9,dt)
      this.ears[i].rotation.x=damp(this.ears[i].rotation.x,-0.06+s*0.16+this.travel*0.12,4,dt)
    }
    for(let i=0;i<4;i++){
      const front=i<2,side=i%2===0?-1:1,step=Math.sin(this.stride+(i===0||i===3?0:Math.PI))*this.travel*motion
      const paw=this.paws[i],greeting=i===1?e.armRaise/2.5*awake:0
      paw.position.set(side*0.59,0.28+Math.max(0,step)*0.11+greeting*0.25,(front?0.52:-0.92)+step*0.10+s*(front?0.08:0.04))
      paw.rotation.x=-step*0.22-greeting*0.6
      paw.rotation.z=side*-0.11-greeting*0.32+greeting*e.wrist*0.25
    }
    this.tail.rotation.y=Math.sin(p.time*3)*awake*motion*(p.emotion==='happy'?0.24:0.045)
    this.root.position.y=e.lift*awake*motion
    this.root.scale.set(1+e.squash*0.35,1-e.squash,1+e.squash*0.35)
  }

  snapshot(): object {return {headYaw:this.yaw,headPitch:this.head.rotation.x,travel:this.travel,earAngles:this.ears.map(ear=>ear.rotation.z),fleece:'instanced loops'}}
}
