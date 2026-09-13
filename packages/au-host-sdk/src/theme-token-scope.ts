/** Shared ownership rule for persisted overrides and portable theme authoring. */
const DEVICE_TOKENS = new Set(['--au-density', '--au-terminal-font-size'])

export function splitThemeOverrides(overrides: Record<string, string>): {
  appearance: Record<string, string>
  device: Record<string, string>
} {
  const appearance: Record<string, string> = {}
  const device: Record<string, string> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith('--au-') || typeof value !== 'string' || !value.trim()) continue
    const target = DEVICE_TOKENS.has(key) ? device : appearance
    target[key] = value.trim()
  }
  return { appearance, device }
}
