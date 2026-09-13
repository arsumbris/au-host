export interface CompanionConfig {
  size: number
  motion: number
  idleSeconds: number
  followCursor: boolean
  glasses: boolean
  scarf: boolean
  bubbles: boolean
  reducedMotion: boolean
  startSleeping: boolean
  bodyColor: string
  rugColor: string
  /** Preset fields accepted for import compatibility; they do not affect rendering. */
  umbraGlow: number
  umbraShadow: number
  umbraDetail: number
  umbraSoftness: number
  umbraBrightness: number
  umbraLightAngle: number
}

export const DEFAULT_CONFIG: Readonly<CompanionConfig> = Object.freeze({
  size: 0.7, motion: 0.65, idleSeconds: 24, followCursor: true,
  glasses: true, scarf: true, bubbles: true, reducedMotion: false,
  umbraGlow: 0, umbraShadow: 0, umbraDetail: 1, umbraSoftness: 0.045, umbraBrightness: 1, umbraLightAngle: 0,
  startSleeping: false, bodyColor: '#be894f', rugColor: '#633b80',
})

export const PRESETS = {
  companion: DEFAULT_CONFIG,
  quiet: { ...DEFAULT_CONFIG, motion: 0.3, idleSeconds: 15, followCursor: false },
  curious: { ...DEFAULT_CONFIG, motion: 0.9, idleSeconds: 40 },
} satisfies Record<string, CompanionConfig>

const ranges = { umbraGlow: [0, 1], umbraShadow: [0, 1], umbraDetail: [0, 1], umbraSoftness: [0.001, 0.12], umbraBrightness: [0.5, 1.5], umbraLightAngle: [-180, 180], size: [0.25, 0.95], motion: [0, 1], idleSeconds: [5, 180] } as const

/** Unknown fields and invalid values cannot enter a saved character preset. */
export function parseConfig(input: unknown): CompanionConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a companion settings object.')
  const result = { ...DEFAULT_CONFIG }
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) throw new Error(`Unknown setting: ${key}`)
    const field = key as keyof CompanionConfig
    if (typeof value !== typeof DEFAULT_CONFIG[field]) throw new Error(`Invalid value for ${key}.`)
    if (field in ranges) {
      const [min, max] = ranges[field as keyof typeof ranges]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${key} must be between ${min} and ${max}.`)
      }
    }
    if ((field === 'bodyColor' || field === 'rugColor') && !/^#[\da-f]{6}$/i.test(String(value))) {
      throw new Error(`${key} must be a six-digit hex color.`)
    }
    Object.assign(result, { [key]: value })
  }
  return result
}

/** A projection's config also contains framework fields; select only character settings. */
export function configFromProjection(config: unknown): CompanionConfig {
  const input = config && typeof config === 'object' ? config as Record<string, unknown> : {}
  return parseConfig(Object.fromEntries(Object.keys(DEFAULT_CONFIG).filter(key => key in input).map(key => [key, input[key]])))
}
