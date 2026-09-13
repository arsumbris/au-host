// oklch.ts — zero-dependency OKLCH ⇄ sRGB-hex conversion for <au-color-picker>.
//
// OKLCH is the perceptual polar space (Lightness 0–1, Chroma ≥0, Hue 0–360°). It is the right space
// to EDIT colour in: a lightness nudge reads as an even lightness nudge, and chroma/hue move
// independently — unlike HSL, where the same hue reads at wildly different perceived lightness.
//
// Source and public-domain permission: https://bottosson.github.io/posts/oklab/
// The pipeline is the reference Björn Ottosson conversion:
//   OKLCH → OKLab (polar → cartesian) → LMS' → LMS (cube) → linear sRGB (matrix) → gamma sRGB.
// The reverse walks it backwards. `oklchToHex` GAMUT-CLAMPS: OKLCH addresses colours sRGB cannot show,
// so it bisects chroma down to the sRGB boundary rather than emit an out-of-range channel.

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number
  /** Chroma (colourfulness), ≥0 (sRGB tops out around 0.37). */
  c: number
  /** Hue angle in degrees, 0–360. */
  h: number
  /** Alpha, 0–1 (defaults to 1). */
  a?: number
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/** linear-light sRGB channel → gamma-encoded (0–1). */
function gamma(x: number): number {
  return x >= 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x
}

/** gamma-encoded sRGB channel (0–1) → linear-light. */
function linear(x: number): number {
  return x >= 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92
}

/** OKLab → linear sRGB {r,g,b} (may fall outside 0–1 when out of gamut). */
function oklabToLinearSrgb(L: number, aa: number, bb: number): [number, number, number] {
  const l_ = L + 0.3963377774 * aa + 0.2158037573 * bb
  const m_ = L - 0.1055613458 * aa - 0.0638541728 * bb
  const s_ = L - 0.0894841775 * aa - 1.291485548 * bb
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** linear sRGB → OKLab. */
function linearSrgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** True when this OKLCH triple resolves inside the sRGB cube (all channels 0–1, tiny epsilon). */
function inGamut(l: number, c: number, h: number): boolean {
  const hr = (h * Math.PI) / 180
  const [r, g, b] = oklabToLinearSrgb(l, c * Math.cos(hr), c * Math.sin(hr))
  const eps = 1e-4
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps
}

/** Largest chroma at this L/H that still fits in sRGB (binary search). */
function maxChroma(l: number, h: number): number {
  let lo = 0
  let hi = 0.4
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(l, mid, h)) lo = mid
    else hi = mid
  }
  return lo
}

/** OKLCH → sRGB hex (`#rrggbb`, or `#rrggbbaa` when alpha < 1). Gamut-clamps chroma. */
export function oklchToHex({ l, c, h, a = 1 }: Oklch): string {
  const L = clamp01(l)
  const C = inGamut(L, c, h) ? c : maxChroma(L, h)
  const hr = (h * Math.PI) / 180
  const [lr, lg, lb] = oklabToLinearSrgb(L, C * Math.cos(hr), C * Math.sin(hr))
  const r = Math.round(clamp01(gamma(lr)) * 255)
  const g = Math.round(clamp01(gamma(lg)) * 255)
  const b = Math.round(clamp01(gamma(lb)) * 255)
  const hx = (n: number): string => n.toString(16).padStart(2, '0')
  const base = `#${hx(r)}${hx(g)}${hx(b)}`
  return a >= 1 ? base : `${base}${hx(Math.round(clamp01(a) * 255))}`
}

/** Compact fixed-point: round to `p` decimals and drop trailing zeros. */
function fmt(n: number, p: number): string {
  const f = 10 ** p
  return String(Math.round(n * f) / f)
}

/**
 * OKLCH → a CSS `oklch()` string, in the token vocabulary's authored notation: `oklch(L C H)` with
 * L/C as 0–1 decimals and H in degrees, plus ` / alpha` only when alpha < 1. Unlike `oklchToHex` this
 * does NOT gamut-clamp — an `oklch()` string keeps the wide-gamut colour the author asked for and lets
 * the browser render it. This is the EMIT path, so editing a token PRESERVES oklch notation instead of
 * collapsing to sRGB hex.
 */
export function oklchToString({ l, c, h, a = 1 }: Oklch): string {
  const triple = `${fmt(clamp01(l), 4)} ${fmt(Math.max(0, c), 4)} ${fmt(((h % 360) + 360) % 360, 2)}`
  return a >= 1 ? `oklch(${triple})` : `oklch(${triple} / ${fmt(clamp01(a), 4)})`
}

/**
 * Parse a CSS `oklch(L C H[ / A])` string → OKLCH, or null when it isn't one. L and A accept a 0–1
 * number or a `%` (100% = 1); C accepts a number or a `%` (100% = 0.4, per CSS Color 4); H is in
 * degrees. The inverse of `oklchToString`, so the picker round-trips its own output.
 */
export function parseOklch(str: string): Oklch | null {
  const m = /^\s*oklch\(([^)]*)\)\s*$/i.exec(str.trim())
  if (!m) return null
  const [coords, alphaTok] = m[1].split('/')
  const parts = coords.trim().split(/[\s,]+/).filter(Boolean)
  if (parts.length < 3) return null
  const axis = (tok: string, pctScale: number): number | null => {
    const t = tok.trim()
    if (t === '' || t.toLowerCase() === 'none') return 0
    const pct = t.endsWith('%')
    const v = parseFloat(pct ? t.slice(0, -1) : t)
    if (Number.isNaN(v)) return null
    return pct ? (v / 100) * pctScale : v
  }
  const l = axis(parts[0], 1)
  const c = axis(parts[1], 0.4)
  const h = axis(parts[2], 1)
  if (l === null || c === null || h === null) return null
  const a = alphaTok !== undefined ? (axis(alphaTok, 1) ?? 1) : 1
  return { l: clamp01(l), c: Math.max(0, c), h: ((h % 360) + 360) % 360, a: clamp01(a) }
}

/** Parse `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` → {r,g,b,a} bytes (a 0–1), or null. */
export function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  const v = hex.trim().replace(/^#/, '')
  const expand = (s: string): string =>
    s.length === 3 || s.length === 4 ? s.split('').map((ch) => ch + ch).join('') : s
  const h = expand(v)
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a }
}

/** sRGB hex → OKLCH. Returns null for an unparseable string. */
export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  return srgbToOklch(rgb)
}

/** Parse absolute numeric RGB notation, including percentage channels and alpha. */
export function rgbToOklch(value: string): Oklch | null {
  const match = /^rgba?\((.*)\)$/i.exec(value.trim())
  if (!match) return null
  const body = match[1].trim()
  const legacy = body.includes(',')
  const parts = legacy ? body.split(',').map(v => v.trim()) : body.split(/\s*\/\s*/)
  if (legacy && (parts.length < 3 || parts.length > 4 || body.includes('/'))) return null
  if (!legacy && parts.length > 2) return null
  const channels = legacy ? parts.slice(0, 3) : parts[0].split(/\s+/)
  if (channels.length !== 3) return null
  if (legacy && channels.some(v => v.endsWith('%')) && !channels.every(v => v.endsWith('%'))) return null
  const channel = (token: string, scale: number): number | null => {
    if (!legacy && token.toLowerCase() === 'none') return 0
    if (!/^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?%?$/i.test(token)) return null
    const number = Number(token.replace(/%$/, ''))
    if (!Number.isFinite(number)) return null
    return clamp01(number / (token.endsWith('%') ? 100 : scale))
  }
  const values = channels.map(v => channel(v, 255))
  const alpha = legacy ? parts[3] : parts[1]
  const a = alpha === undefined ? 1 : channel(alpha, 1)
  if (values.some(v => v === null) || a === null) return null
  return srgbToOklch({ r: values[0]! * 255, g: values[1]! * 255, b: values[2]! * 255, a })
}

function srgbToOklch(rgb: { r: number; g: number; b: number; a: number }): Oklch {
  const [L, aa, bb] = linearSrgbToOklab(linear(rgb.r / 255), linear(rgb.g / 255), linear(rgb.b / 255))
  const c = Math.sqrt(aa * aa + bb * bb)
  let h = (Math.atan2(bb, aa) * 180) / Math.PI
  if (h < 0) h += 360
  // Achromatic colours have an undefined hue; report 0 rather than atan2 noise.
  return { l: L, c: c < 1e-4 ? 0 : c, h: c < 1e-4 ? 0 : h, a: rgb.a }
}
