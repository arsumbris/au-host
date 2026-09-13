/** One fixed neutral pigment tile per mounted scene; it travels with each marker. */
export function createNodeGrain(): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const context = canvas.getContext('2d')!
  const pixels = context.createImageData(32, 32)
  let seed = 0x4371ab29
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    const tone = (seed >>> 0) % 256
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = tone
    pixels.data[i + 3] = 150
  }
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}
