import { defineProjection } from '@arsumbris/au-host-sdk'
import type { MountFn, OpaqueConfig, ProjectionModule } from '@arsumbris/au-host-sdk'
import { AVATAR_STYLE, createAvatar } from './avatars'
import { createPicker, PICKER_STYLE } from './picker'

const mount: MountFn = (container, host) => {
  const disposeStyle = host.styles?.inject(AVATAR_STYLE + PICKER_STYLE, container)
  const shell = document.createElement('div')
  shell.className = 'companion-stage'; shell.setAttribute('data-au-scope', container.getAttribute('data-au-scope') ?? ''); container.append(shell)
  let config: OpaqueConfig | undefined
  let disposeContent: (() => void) | undefined
  const render = (next: OpaqueConfig | undefined): void => {
    if (disposeContent && JSON.stringify(next) === JSON.stringify(config)) return
    disposeContent?.(); disposeContent = undefined
    config = next
    const avatar = createAvatar(shell, config)
    const disposePicker = createPicker(shell, avatar.character, character => {
      const updated = { ...(config && typeof config === 'object' ? config : {}), character }
      host.saveConfig(updated)
      render(updated)
      shell.querySelector<HTMLElement>('.avatar-picker')?.focus()
    })
    disposeContent = () => { disposePicker(); avatar.dispose() }
  }
  try {
    render(host.config)
    const unsubscribe = host.onOwnConfigChange?.(render)
    return () => { unsubscribe?.(); disposeContent?.(); shell.remove(); disposeStyle?.() }
  } catch (error) { disposeContent?.(); shell.remove(); disposeStyle?.(); throw error }
}

export default defineProjection<ProjectionModule>({ mount })
