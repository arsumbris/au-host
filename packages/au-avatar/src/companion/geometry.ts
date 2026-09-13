import * as THREE from 'three'

/** Rounded box-like organic forms with a continuous surface and smooth normals. */
export function softForm(width: number, height: number, depth: number, exponent = 0.8): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 32, 24)
  const vertices = geometry.attributes.position
  const power = (n: number): number => Math.sign(n) * Math.pow(Math.abs(n), exponent)
  for (let i = 0; i < vertices.count; i++) {
    vertices.setXYZ(i, power(vertices.getX(i)) * width, power(vertices.getY(i)) * height, power(vertices.getZ(i)) * depth)
  }
  geometry.computeVertexNormals()
  return geometry
}

export function form(parent: THREE.Object3D, material: THREE.Material, size: number[], position: number[], exponent = 0.85): THREE.Mesh {
  const mesh = new THREE.Mesh(softForm(size[0], size[1], size[2], exponent), material)
  mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow = true; mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

export function line(parent: THREE.Object3D, material: THREE.Material, points: number[][], radius = 0.015): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])))
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 6, false), material)
  parent.add(mesh)
  return mesh
}
