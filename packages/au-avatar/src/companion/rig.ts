import * as THREE from 'three'
import { Capybara, type Pose } from './capybara'
import { Carpet } from './carpet'
import type { CompanionConfig } from './config'

export interface CompanionRig {
  root: THREE.Group
  /** Conservative framing and movement envelope; omitted retains the carpet envelope. */
  envelope?: { width: number; height: number }
  /** Optional view-space material attention; position is normalized device coordinates. */
  aim?(pointer: { x: number; y: number } | null, camera: THREE.Camera, dt: number, reduced: boolean): void
  snapshot?(): object
  configure(config: CompanionConfig): void
  pose(pose: Pose, dt: number, speed: number): void
}
export type RigFactory = (config: CompanionConfig) => CompanionRig

export const createCapybaraRig: RigFactory = config => {
  const character = new Capybara(config), carpet = new Carpet(config.rugColor), root = new THREE.Group()
  root.add(carpet.root, character.root)
  let rugColor = config.rugColor
  return {
    root,
    snapshot: () => character.snapshot(),
    configure(next) {
      character.configure(next)
      if (next.rugColor !== rugColor) { carpet.setColor(next.rugColor); rugColor = next.rugColor }
    },
    pose(pose, dt, speed) { character.pose(pose, dt); carpet.update(pose.time, speed, pose.motion, pose.lean, dt) },
  }
}
