import * as THREE from 'three'
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js'
import { softForm } from './geometry'

/** Short looped fleece shares geometry and material across instanced tufts. */
export class PlushSurface {
  readonly cream = new THREE.MeshStandardMaterial({ color: '#e6e0d3', roughness: 0.98, emissive: '#bcb6a9', emissiveIntensity: 0.08 })
  readonly charcoal = new THREE.MeshStandardMaterial({ color: '#252326', roughness: 1 })
  private loop: THREE.BufferGeometry
  private seed = 142

  constructor() {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.4,0,0),new THREE.Vector3(-0.3,0.26,0.26),new THREE.Vector3(0.08,0.34,0.36),
      new THREE.Vector3(0.34,0.09,0.23),new THREE.Vector3(0.12,-0.10,0.07),
    ])
    this.loop = new THREE.TubeGeometry(curve, 7, 0.14, 5, false)
  }

  private random = (): number => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  part(size: number[], density: number, dark = false, exponent = 0.84): THREE.Group {
    const root = new THREE.Group(), material = dark ? this.charcoal : this.cream
    const base = new THREE.Mesh(softForm(size[0],size[1],size[2],exponent),material)
    base.castShadow = true; base.receiveShadow = true; root.add(base)
    const sampler = new MeshSurfaceSampler(base) as MeshSurfaceSampler & { setRandomGenerator(random: () => number): MeshSurfaceSampler }
    sampler.setRandomGenerator(this.random); sampler.build()
    const fleece = new THREE.InstancedMesh(this.loop,material,density)
    const point = new THREE.Vector3(), normal = new THREE.Vector3(), dummy = new THREE.Object3D(), axis = new THREE.Vector3(0,0,1)
    const twist = new THREE.Quaternion()
    for(let i=0;i<density;i++){
      sampler.sample(point,normal)
      dummy.position.copy(point).addScaledVector(normal,0.003)
      dummy.quaternion.setFromUnitVectors(axis,normal.normalize())
      twist.setFromAxisAngle(axis,this.random()*Math.PI*2);dummy.quaternion.multiply(twist)
      const scale=(dark?0.026:0.035)*(0.7+this.random()*0.6)
      dummy.scale.set(scale,scale,scale*(0.8+this.random()*0.4));dummy.updateMatrix();fleece.setMatrixAt(i,dummy.matrix)
    }
    fleece.raycast = () => {}
    fleece.instanceMatrix.needsUpdate=true;fleece.computeBoundingSphere();root.add(fleece)
    return root
  }
}
