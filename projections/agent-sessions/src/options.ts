import type { HostApp, AgentProfileData, DiscoveredAdapter } from '@arsumbris/au-host-app'
import { button, text } from './controls'
import { profileSummary } from './model'
import { STYLE } from './style'

/** The human label for an adapter selection: the discovered adapter's presentation label, falling
 *  back to its bare type name, or "Default adapter" when a profile pins none (the host's count rule
 *  picks at launch). */
export const adapterLabel = (adapters: DiscoveredAdapter[], name?: string): string =>
  name ? (adapters.find((a) => a.name === name)?.label ?? name) : 'Default adapter'
export function openSessionOptions(
  host: HostApp,
  trigger: HTMLElement,
  profiles: AgentProfileData[],
  adapters: DiscoveredAdapter[],
  /** The adapter the next launch will use (profile pin, else ad-hoc override, else the single one). */
  selectedAdapter: string | undefined,
  /** True when the selected profile pins no adapter AND ≥2 are discovered — i.e. the ad-hoc picker is
   *  meaningful (the user must choose). False hides the adapter section (a pin or a single adapter). */
  adapterChoosable: boolean,
  chooseAdapter: (name: string) => void,
  selected: string,
  chooseProfile: (profile: AgentProfileData) => void,
  configure: () => void,
  dismissed: () => void,
  copyStart?: () => void,
) {
  let release: (() => void) | undefined
  const handle = host.popover?.open(
    trigger.getBoundingClientRect(),
    (element) => {
      release = host.styles?.inject(STYLE, element)
      const panel = document.createElement('au-popover') as HTMLElement & {
        arrow: boolean
      }
      panel.arrow = false
      panel.className = 'sessions-options'
      const heading = text('div', '', 'sessions-menu-heading')
      const edit = document.createElement('au-icon-button')
      edit.setAttribute('label', 'Configure session profiles')
      edit.setAttribute('size', 'sm')
      const gear = document.createElement('au-icon')
      gear.setAttribute('name', 'gear')
      edit.append(gear)
      edit.addEventListener('au-activate', () => {
        handle?.close()
        configure()
      })
      heading.append(text('span', 'Session profiles'), edit)
      const profileSection = text('section', '', 'sessions-menu-section')
      const scroll = document.createElement('au-scroll-area')
      scroll.setAttribute('axis', 'y')
      scroll.className = 'sessions-options-list'
      const list = text('div', '', 'sessions-profile-list')
      const summary = text(
        'p',
        profileSummary(
          profiles.find((p) => p.path === selected) ?? { name: '' },
        ),
        'sessions-selection-summary',
      )
      for (const profile of profiles) {
        const row = document.createElement('au-list-row')
        row.setAttribute('interactive', '')
        row.setAttribute('primary', profile.name)
        row.setAttribute('secondary', adapterLabel(adapters, profile.adapter))
        row.toggleAttribute('selected', profile.path === selected)
        const check = document.createElement('au-icon')
        check.setAttribute('name', 'check')
        check.setAttribute('slot', 'trailing')
        check.hidden = profile.path !== selected
        row.append(check)
        row.addEventListener('click', () => {
          for (const sibling of list.querySelectorAll('au-list-row')) {
            sibling.removeAttribute('selected')
            ;(sibling.querySelector('au-icon') as HTMLElement).hidden = true
          }
          row.setAttribute('selected', '')
          check.hidden = false
          summary.textContent = profileSummary(profile)
          chooseProfile(profile)
          handle?.close()
        })
        list.append(row)
      }
      if (!profiles.length)
        list.append(
          text(
            'p',
            'Create a profile to choose context and tools.',
            'sessions-hint',
          ),
        )
      scroll.append(list)
      profileSection.append(scroll)

      // The ad-hoc ADAPTER picker: shown only when the selected profile pins none and ≥2 adapters are
      // discovered (the user must choose). A single adapter (auto) or a profile pin hides it.
      let adapterSection: HTMLElement | undefined
      if (adapterChoosable) {
        adapterSection = text('section', '', 'sessions-menu-section')
        adapterSection.append(text('div', 'Adapter', 'sessions-menu-heading'))
        const alist = text('div', '', 'sessions-profile-list')
        for (const a of adapters) {
          const arow = document.createElement('au-list-row')
          arow.setAttribute('interactive', '')
          arow.setAttribute('primary', a.label)
          if (a.description) arow.setAttribute('secondary', a.description)
          arow.toggleAttribute('selected', a.name === selectedAdapter)
          arow.addEventListener('click', () => {
            chooseAdapter(a.name)
            handle?.close()
          })
          alist.append(arow)
        }
        adapterSection.append(alist)
      }

      panel.append(heading, ...(adapterSection ? [adapterSection] : []), profileSection, summary)
      if (copyStart) {
        const copy = button('Copy start command', () => {
          handle?.close()
          copyStart()
        }, 'ghost')
        copy.className = 'sessions-copy-command'
        const icon = document.createElement('au-icon')
        icon.setAttribute('name', 'copy')
        icon.setAttribute('aria-hidden', 'true')
        copy.replaceChildren(icon, text('span', 'Copy start command'))
        panel.append(copy)
      }
      element.append(panel)
    },
    () => {
      release?.()
      dismissed()
      trigger.focus({ preventScroll: true })
    },
  )
  return handle
}
