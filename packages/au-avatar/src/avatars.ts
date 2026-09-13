import { avatarKind, type AvatarKind } from './avatar-config'
import { configFromProjection } from './companion/config'
import { CompanionStage } from './companion/stage'
import { COMPANION_STYLE } from './companion/presentation'
import { SPHERE_STYLE } from './sphere-presentation'
import { createCapybaraRig } from './companion/rig'
import { Heinrich } from './companion/heinrich'
import { Schnappa } from './companion/schnappa'
import { Umbra } from './umbra/rig'
import { RichAvatar } from './rich-avatar'

export const AVATAR_CHOICES: ReadonlyArray<{ value: AvatarKind; label: string }> = [
  { value: 'umbra', label: 'Umbra' },
  { value: 'wizard', label: 'lt0gt' },
  { value: 'capybara', label: 'friedrich' },
  { value: 'heinrich', label: 'heinrich' },
]
export const AVATAR_STYLE = COMPANION_STYLE + SPHERE_STYLE

export interface AvatarInstance {
  readonly character: AvatarKind
  readonly companion?: CompanionStage
  snapshot(): object
  dispose(): void
}

/** Select and mount a character through a shared boundary. */
export function createAvatar(container: HTMLElement, config: unknown, onState?: (state: string) => void): AvatarInstance {
  const input = config && typeof config === 'object' ? config as Record<string, unknown> : {}
  const character = avatarKind(input.character)
  const root = document.createElement('div')
  root.className = (character === 'umbra' || character === 'capybara' || character === 'schnappa' || character === 'heinrich') ? 'companion-stage' : 'au-avatar-stage'
  root.setAttribute('data-au-scope', container.closest('[data-au-scope]')?.getAttribute('data-au-scope') ?? ''); root.dataset.avatar = character; container.append(root)
  try {
    if (character === 'umbra' || character === 'capybara' || character === 'schnappa' || character === 'heinrich') {
      const companion = new CompanionStage(root, configFromProjection(input), onState, character === 'umbra' ? config => new Umbra(config) : character === 'heinrich' ? () => new Heinrich() : character === 'schnappa' ? () => new Schnappa() : createCapybaraRig, character === 'umbra' ? 'ruminate' : 'sleep')
      return { character, companion, snapshot: () => ({ character, ...companion.snapshot() }), dispose: () => { companion.dispose(); root.remove() } }
    }
    const canvas = document.createElement('canvas'), zzz = document.createElement('div')
    zzz.className = 'au-avatar-zzz'; zzz.innerHTML = '<span>z</span><span>z</span><span>z</span>'
    root.append(canvas, zzz)
    const sphere = new RichAvatar(canvas, zzz, input.backdrop !== false, onState, character === 'wizard'); sphere.start()
    return { character, snapshot: () => ({ character, state: sphere.state }), dispose: () => { sphere.dispose(); root.remove() } }
  } catch (error) { root.remove(); throw error }
}
