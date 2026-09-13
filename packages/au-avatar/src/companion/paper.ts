import * as THREE from 'three'

/** Ink fibres and engraved hatching remain attached to each folded panel. */
export function paperMaterial(): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  let seed = 81
  const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  ctx.fillStyle = '#e6e1d4'; ctx.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 7000; i++) {
    ctx.fillStyle = `rgba(65,53,41,${random() * 0.10})`
    ctx.fillRect(random() * 512, random() * 512, 0.5 + random(), 0.5 + random())
  }
  ctx.strokeStyle = '#080808'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'
  for (let row = 0; row < 43; row++) {
    const y = 5 + row * 12
    const extent = 115 + 55 * Math.sin(row * 0.08)
    for (let x = 5; x < extent; x += 30 + random() * 15) {
      const length = 20 + random() * 30
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x+length*0.5,y-4,x+length,y-9); ctx.stroke()
      if (x < 65 && row % 2 === 0) {
        ctx.beginPath(); ctx.moveTo(x,y-5); ctx.lineTo(x+16,y+13); ctx.stroke()
      }
    }
    for(let x=410+random()*22;x<503;x+=24) {
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+12+random()*10,y-6); ctx.stroke()
    }
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4
  return new THREE.MeshStandardMaterial({ map, roughness: 0.94, side: THREE.DoubleSide })
}

export function panel(parent: THREE.Object3D, material: THREE.Material, points: number[][], curvature = 0.045): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  const vertices: number[] = [], uv: number[] = []
  const corners = points.map(point => new THREE.Vector3(...point))
  const normal = new THREE.Vector3().subVectors(corners[1],corners[0]).cross(new THREE.Vector3().subVectors(corners[2],corners[0])).normalize()
  const divisions=16
  const vertex = (u:number,v:number):void => {
    const point = points.length === 4
      ? corners[0].clone().lerp(corners[1],u).lerp(corners[3].clone().lerp(corners[2],u),v)
      : corners[0].clone().multiplyScalar(1-u-v).addScaledVector(corners[1],u).addScaledVector(corners[2],v)
    const bulge=points.length===4 ? Math.sin(Math.PI*u)*Math.sin(Math.PI*v) : 27*u*v*(1-u-v)
    point.addScaledVector(normal,bulge*curvature)
    vertices.push(point.x,point.y,point.z); uv.push(u,1-v)
  }
  for(let y=0;y<divisions;y++) for(let x=0;x<divisions;x++) {
    if(points.length===3 && x+y>=divisions) continue
    const u=x/divisions,v=y/divisions,d=1/divisions
    vertex(u,v);vertex(u+d,v);vertex(u,v+d)
    if(points.length===4 || x+y<divisions-1) {vertex(u+d,v);vertex(u+d,v+d);vertex(u,v+d)}
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2)); geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry,material); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh)
  return mesh
}
