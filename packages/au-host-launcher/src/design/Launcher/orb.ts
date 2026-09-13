// The au-hp brand mark — the pearl-umbra orb ("the art of shadows") — as a VECTOR model.
// This is the CANONICAL definition of the mark; everything that draws it reads from here.
//
// The sphere and three offset circles form crescent bands along the light axis.
//
// shade() feathers crescent boundaries; orbSvg() keeps them sharp to avoid blurring
// the sphere silhouette.

export type Rgb = [number, number, number]
export type Band = { c: [number, number]; r: number; s0: number; s1: number; from: Rgb; to: Rgb }
export type OrbModel = {
  base: Rgb
  bands: Band[]
  cap: { c: [number, number]; r: number; hot: [number, number]; gr: number; from: Rgb; to: Rgb }
}

const K = Math.SQRT1_2 // the light axis is the up-left diagonal

// All geometry is in units of the sphere radius R, origin at the sphere centre.
export const ORB: OrbModel = {
  base: [21, 22, 27],
  // painted outermost -> innermost, each clipped to the sphere
  bands: [
    { c: [-0.148, -0.162], r: 1.077, s0: 0.58, s1: 0.90, from: [57, 58, 64], to: [29, 31, 36] },
    { c: [-0.266, -0.286], r: 1.023, s0: 0.18, s1: 0.64, from: [133, 132, 137], to: [68, 69, 76] },
  ],
  cap: {
    c: [-0.527, -0.566], r: 1.006,
    hot: [-0.445, -0.645], gr: 1.32,
    from: [255, 255, 255], to: [143, 141, 148],
  },
}

// The master's crescent boundaries are soft, not hard-clipped; FEATHER is the half-width
// of that transition in units of R, fitted the same way as the colour stops.
export const FEATHER = 0.045

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

const ramp = (from: Rgb, to: Rgb, t: number): Rgb =>
  [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]

// Colour at a point, in units of R from the sphere centre. null = outside the sphere.
export function shade(px: number, py: number, M: OrbModel = ORB, feather = FEATHER): Rgb | null {
  if (px * px + py * py > 1) return null
  const s = px * K + py * K // position along the light axis, -1 (lit pole) .. 1
  let col: Rgb = M.base
  for (const b of M.bands) {
    const cov = smooth(b.r + feather, b.r - feather, Math.hypot(px - b.c[0], py - b.c[1]))
    if (cov <= 0) continue
    const t = Math.max(0, Math.min(1, (s - b.s0) / (b.s1 - b.s0)))
    col = mix(col, ramp(b.from, b.to, t), cov)
  }
  const cp = M.cap
  const cov = smooth(cp.r + feather, cp.r - feather, Math.hypot(px - cp.c[0], py - cp.c[1]))
  if (cov > 0) {
    const t = Math.max(0, Math.min(1, Math.hypot(px - cp.hot[0], py - cp.hot[1]) / cp.gr))
    col = mix(col, ramp(cp.from, cp.to, t), cov)
  }
  return col
}

const hex = (c: Rgb): string =>
  '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

// SVG of the mark alone, transparent ground, viewBox 0 0 `size` `size`.
// `fraction` is the sphere's diameter as a fraction of the viewBox — 1 inscribes it,
// less insets it (Icon Composer layers want margin; the system shape is drawn around them).
// This is the layer to hand to Icon Composer.
export function orbSvg(size = 1024, M: OrbModel = ORB, fraction = 1): string {
  const R = (size / 2) * fraction, C = size / 2
  const X = (u: number): string => (C + u * R).toFixed(2)
  // A band's linear gradient runs along the light axis; s is the projection onto it, so
  // the gradient vector in user space is the light axis scaled to the band's s-range.
  const lin = (id: string, b: Band): string => {
    const p0 = [b.s0 * K, b.s0 * K], p1 = [b.s1 * K, b.s1 * K]
    return `    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `x1="${X(p0[0])}" y1="${X(p0[1])}" x2="${X(p1[0])}" y2="${X(p1[1])}">\n` +
      `      <stop offset="0" stop-color="${hex(b.from)}"/>\n` +
      `      <stop offset="1" stop-color="${hex(b.to)}"/>\n` +
      `    </linearGradient>`
  }
  const cp = M.cap
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `  <title>Ars Umbris — the pearl-umbra orb</title>`,
    `  <defs>`,
    `    <clipPath id="sphere"><circle cx="${X(0)}" cy="${X(0)}" r="${R.toFixed(2)}"/></clipPath>`,
    lin('b0', M.bands[0]),
    lin('b1', M.bands[1]),
    `    <radialGradient id="cap" gradientUnits="userSpaceOnUse" ` +
      `cx="${X(cp.hot[0])}" cy="${X(cp.hot[1])}" r="${(cp.gr * R).toFixed(2)}">`,
    `      <stop offset="0" stop-color="${hex(cp.from)}"/>`,
    `      <stop offset="1" stop-color="${hex(cp.to)}"/>`,
    `    </radialGradient>`,
    `  </defs>`,
    `  <g clip-path="url(#sphere)">`,
    `    <circle cx="${X(0)}" cy="${X(0)}" r="${R.toFixed(2)}" fill="${hex(M.base)}"/>`,
    `    <circle cx="${X(M.bands[0].c[0])}" cy="${X(M.bands[0].c[1])}" r="${(M.bands[0].r * R).toFixed(2)}" fill="url(#b0)"/>`,
    `    <circle cx="${X(M.bands[1].c[0])}" cy="${X(M.bands[1].c[1])}" r="${(M.bands[1].r * R).toFixed(2)}" fill="url(#b1)"/>`,
    `    <circle cx="${X(cp.c[0])}" cy="${X(cp.c[1])}" r="${(cp.r * R).toFixed(2)}" fill="url(#cap)"/>`,
    `  </g>`,
    `</svg>`,
  ]
  return parts.join('\n') + '\n'
}
