import * as THREE from 'three'

function texture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The companion needs a canvas drawing context.')
  paint(ctx)
  const result = new THREE.CanvasTexture(canvas)
  result.colorSpace = THREE.SRGBColorSpace
  result.anisotropy = 4
  return result
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, petals = 6): void {
  ctx.save(); ctx.translate(x, y)
  for (let petal = 0; petal < petals; petal++) {
    ctx.rotate(Math.PI * 2 / petals)
    ctx.beginPath(); ctx.ellipse(0, radius * 0.65, radius * 0.23, radius * 0.48, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.beginPath(); ctx.arc(0, 0, radius * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.restore()
}

export function carpetTexture(color: string): THREE.CanvasTexture {
  return texture(1024, 640, ctx => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, 1024, 640)
    ctx.strokeStyle = '#d1aa61'; ctx.lineWidth = 7; ctx.strokeRect(17, 17, 990, 606)
    ctx.lineWidth = 2; ctx.strokeRect(31, 31, 962, 578)
    ctx.fillStyle = '#372341'; ctx.fillRect(44, 44, 936, 552)
    ctx.fillStyle = color; ctx.fillRect(106, 106, 812, 428)
    ctx.strokeStyle = '#c9a460'; ctx.lineWidth = 3; ctx.strokeRect(98, 98, 828, 444)
    ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5; ctx.strokeRect(112, 112, 800, 416); ctx.setLineDash([])
    ctx.fillStyle = '#caaa73'
    for (let x = 72; x < 990; x += 54) { flower(ctx, x, 71, 20); flower(ctx, x, 569, 20) }
    for (let y = 126; y < 550; y += 54) { flower(ctx, 73, y, 20); flower(ctx, 951, y, 20) }
    ctx.save(); ctx.translate(512, 320); ctx.scale(1.45, 1)
    ctx.beginPath()
    for (let i = 0; i <= 96; i++) {
      const angle = i / 96 * Math.PI * 2; const r = 120 + 16 * Math.cos(angle * 8)
      const x = Math.cos(angle) * r; const y = Math.sin(angle) * r
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.closePath(); ctx.fillStyle = '#3e294d'; ctx.fill(); ctx.strokeStyle = '#e0bd79'; ctx.lineWidth = 3; ctx.stroke()
    ctx.fillStyle = '#d8b571'; flower(ctx, 0, 0, 70, 8)
    ctx.fillStyle = '#af8eaf'
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; flower(ctx, Math.cos(a) * 99, Math.sin(a) * 99, 13) }
    ctx.restore()
    for (const x of [161, 863]) for (const y of [159, 481]) {
      ctx.fillStyle = '#d5b77f'; flower(ctx, x, y, 30, 8)
      ctx.fillStyle = '#b2a0b8'; flower(ctx, x + (x < 512 ? 65 : -65), y, 15)
    }
    // Fine warp and weft give the pattern a textile surface without noisy fur-like detail.
    ctx.fillStyle = 'rgba(255,235,203,0.035)'
    for (let x = 0; x < 1024; x += 4) ctx.fillRect(x, 0, 1, 640)
    for (let y = 0; y < 640; y += 4) ctx.fillRect(0, y, 1024, 1)
  })
}

export function scarfTexture(): THREE.CanvasTexture {
  return texture(256, 256, ctx => {
    ctx.fillStyle = '#657246'; ctx.fillRect(0, 0, 256, 256); ctx.fillStyle = '#e2d6a4'
    for (let y = 23; y < 256; y += 52) for (let x = 23; x < 256; x += 52) {
      flower(ctx, x + (y % 104 > 52 ? 12 : 0), y, 9, 4)
    }
  })
}
