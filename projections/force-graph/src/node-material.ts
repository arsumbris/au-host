/** Cached, node-local pigment: a tonal wash and fixed fine grain, never animated noise. */
export function createNodeMaterials() {
  const cache = new Map<string, HTMLCanvasElement>()
  return {
    clear: () => cache.clear(),
    get(color: string): HTMLCanvasElement {
      const cached = cache.get(color)
      if (cached) return cached
      const size = 256
      const surface = document.createElement('canvas')
      surface.width = surface.height = size
      const ctx = surface.getContext('2d')!
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = color
      ctx.fillRect(0, 0, size, size)
      const wash = ctx.createLinearGradient(28, 12, 212, 244)
      wash.addColorStop(0, 'rgba(255,255,255,0.24)')
      wash.addColorStop(0.42, 'rgba(255,255,255,0.025)')
      wash.addColorStop(1, 'rgba(0,0,0,0.25)')
      ctx.fillStyle = wash
      ctx.fillRect(0, 0, size, size)
      const grain = document.createElement('canvas')
      grain.width = grain.height = size
      const grainContext = grain.getContext('2d')!
      const pixels = grainContext.createImageData(size, size)
      let seed = 0x71a5c39d
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
        const value = (seed >>> 0) % 256
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value
        pixels.data[i + 3] = 90
      }
      grainContext.putImageData(pixels, 0, 0)
      ctx.globalCompositeOperation = 'soft-light'
      ctx.drawImage(grain, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      cache.set(color, surface)
      return surface
    },
  }
}
