import * as THREE from 'three'
import { carpetTexture } from './textiles'
import { damp } from './motion'
import { form, line } from './geometry'

export class Carpet {
  readonly root = new THREE.Group()
  private geometry = new THREE.PlaneGeometry(4.5, 2.8, 40, 26)
  private material: THREE.MeshStandardMaterial
  private wind = 0
  private bank = 0
  private tassels: THREE.Group[] = []

  constructor(color: string) {
    this.geometry.rotateX(-Math.PI / 2)
    this.material = new THREE.MeshStandardMaterial({ map: carpetTexture(color), roughness: 0.95, side: THREE.DoubleSide })
    const cloth = new THREE.Mesh(this.geometry, this.material)
    cloth.castShadow = true; cloth.receiveShadow = true; this.root.add(cloth)
    const gold = new THREE.MeshStandardMaterial({ color: '#c4a365', roughness: 0.6, metalness: 0.2 })
    for (const x of [-2.22, 2.22]) for (const z of [-1.37, 1.37]) {
      const tassel = new THREE.Group(); tassel.position.set(x, 0.16, z)
      form(tassel, gold, [0.07, 0.07, 0.07], [0, 0, 0])
      for (let i = 0; i < 7; i++) {
        const offset = (i - 3) * 0.024
        line(tassel, gold, [[0, 0, 0], [Math.sign(x) * 0.12, -0.07, offset], [Math.sign(x) * 0.18, -0.25, offset * 1.8]], 0.017)
      }
      this.root.add(tassel); this.tassels.push(tassel)
    }
    this.update(0, 0, 0)
  }

  setColor(color: string): void {
    this.material.map?.dispose(); this.material.map = carpetTexture(color); this.material.needsUpdate = true
  }

  private heightAt(x: number, z: number, time: number, amount: number): number {
    const edge = Math.pow(Math.abs(x) / 2.25, 6) + Math.pow(Math.abs(z) / 1.4, 6)
    const trailing = (1 - z / 1.4) * 0.5
    const wave = Math.sin(z * 3.4 - time * 1.8 + x * 0.65)
    const ripple = Math.sin(z * 6 - time * 2.8 - x) * 0.15
    return 0.025 + edge * (0.1 + amount * (0.01 + this.wind * 0.035 * trailing) * (wave + ripple))
  }

  update(time: number, movement: number, amount: number, turnBank = 0, dt = 0): void {
    this.wind = amount === 0 ? 0 : damp(this.wind, Math.min(movement, 0.65), 1.8, dt)
    this.bank = amount === 0 ? 0 : damp(this.bank, -turnBank * 0.2, 2, dt)
    this.root.rotation.z = this.bank
    const vertices = this.geometry.attributes.position
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), z = vertices.getZ(i)
      vertices.setY(i, this.heightAt(x, z, time, amount))
    }
    vertices.needsUpdate = true; this.geometry.computeVertexNormals()
    for (const tassel of this.tassels) {
      tassel.position.y = this.heightAt(tassel.position.x, tassel.position.z, time, amount)
      tassel.rotation.z = amount * Math.sin(time * 1.8 + tassel.position.x) * (0.035 + this.wind * 0.1)
      tassel.rotation.x = amount * (this.wind * 0.28 + Math.sin(time * 3 - tassel.position.z) * this.wind * 0.12)
    }
  }
}
