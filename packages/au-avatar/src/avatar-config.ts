import { parseConfig, type CompanionConfig } from './companion/config.ts'

export type AvatarKind = 'umbra' | 'sphere' | 'capybara' | 'wizard' | 'schnappa' | 'heinrich'
export interface AvatarPreset extends CompanionConfig { character: AvatarKind; backdrop: boolean }

export function avatarKind(value: unknown): AvatarKind {
  if (value === undefined || value === 'umbra') return 'umbra'
  if (value === 'sphere') return 'sphere'
  if (value === 'capybara' || value === 'wizard' || value === 'schnappa' || value === 'heinrich') return value
  throw new Error('Choose umbra, sphere, capybara, wizard, schnappa or heinrich as the avatar character.')
}

export function parseAvatarPreset(value: unknown): AvatarPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an avatar preset.')
  const { character, backdrop = true, ...settings } = value as Record<string, unknown>
  if (typeof backdrop !== 'boolean') throw new Error('Backdrop must be true or false.')
  return { ...parseConfig(settings), character: avatarKind(character), backdrop }
}
