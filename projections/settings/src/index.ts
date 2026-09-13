import { defineProjection, descriptorTitle, type MountFn, type ProjectionModule, type ProjectionDescriptor, type ChildHandle } from '@arsumbris/au-host-sdk'
import { STYLE } from './layout'

const HELP_PAGE = 'help-community'
const DEFAULT_SURFACES = ['theming-pane', 'keymap-editor', 'terminal-settings', 'workspace-panel', 'agent-runtime-settings', 'agent-profiles', 'daemon-control']
const identity = (d: ProjectionDescriptor) => `${d.type}::${d.repo}`

/** Settings owns navigation; child projections retain their capabilities and settings ownership. */
const mount: MountFn = (container, host) => {
  const rootId = crypto.randomUUID()
  const root = document.createElement('section')
  root.className = 'settings-hub'
  root.setAttribute('aria-label', 'Settings')
  const releaseStyle = host.styles?.inject(STYLE, container)
  root.innerHTML = `<aside class="settings-nav"><header><h1>Settings</h1><au-input inputtype="search" aria-label="Search settings pages" placeholder="Find a page…"></au-input></header><au-scroll-area axis="y"><nav class="settings-list" aria-label="Settings pages"></nav><p class="settings-empty" hidden>No matching pages.</p></au-scroll-area><p class="settings-nav-note">Your workspace, your preferences.</p></aside><main class="settings-main"><div class="settings-context"><au-select class="settings-mobile" label="Settings page"></au-select><span class="settings-source"></span><au-button variant="ghost" size="sm" class="settings-open">Open in pane</au-button></div><div class="settings-body"></div><p class="settings-feedback" role="alert"></p></main>`
  const support = document.createElement('au-scroll-area')
  support.className = 'settings-help-page'
  support.setAttribute('axis', 'y')
  support.hidden = true
  support.setAttribute('aria-label', 'Help and community')
  support.innerHTML = `<div class="settings-help-content">
    <section class="settings-help-contact" aria-label="Ask the community">
      <h2>Need anything?</h2>
      <p>Ask a question or tell us what you’re building.</p>
      <au-button variant="cta" data-support="discord"><span slot="leading" class="settings-brand-mark settings-brand-discord" aria-hidden="true"></span>Ask on Discord<au-icon slot="trailing" name="external-link" size="sm"></au-icon></au-button>
    </section>
    <section class="settings-help-links" aria-label="Around Ars Umbris">
      <au-list-row interactive data-support="website" primary="Website" secondary="Explore Ars Umbris"><au-icon slot="leading" name="globe" size="sm"></au-icon><au-icon slot="trailing" name="external-link" size="sm"></au-icon></au-list-row>
      <au-list-row interactive data-support="social" primary="X" secondary="Follow along"><span slot="leading" class="settings-brand-mark settings-brand-x" aria-hidden="true"></span><au-icon slot="trailing" name="external-link" size="sm"></au-icon></au-list-row>
      <au-list-row interactive data-support="github" primary="Leave a star" secondary="Support the project on GitHub"><span slot="leading" class="settings-brand-mark settings-brand-github" aria-hidden="true"></span><au-icon slot="trailing" name="external-link" size="sm"></au-icon></au-list-row>
    </section>
  </div>`
  const destinations = {
    website: 'https://arsumbris.ai/',
    discord: 'https://discord.gg/MecBjKZY9d',
    social: 'https://x.com/arsumbrisai',
    github: 'https://github.com/arsumbris/arsumbris/',
  }
  for (const [key, url] of Object.entries(destinations)) {
    const action = support.querySelector<HTMLElement>(`[data-support="${key}"]`)!
    action.toggleAttribute('disabled', !host.shell)
    const activate = () => {
      void host.shell?.openExternal(url).catch(() => { feedback.textContent = 'Could not open the link. Please try again.' })
    }
    if (action.localName === 'au-list-row') {
      action.addEventListener('click', activate)
    } else action.addEventListener('au-activate', activate)
  }
  root.querySelector('.settings-body')!.append(support)
  container.append(root)
  const list = root.querySelector<HTMLElement>('.settings-list')!
  const body = root.querySelector<HTMLElement>('.settings-body')!
  const feedback = root.querySelector<HTMLElement>('.settings-feedback')!
  const search = root.querySelector('au-input') as HTMLElement & { value: string }
  const picker = root.querySelector('au-select') as HTMLElement & { value: string; options: {value:string;label:string}[] }
  const source = root.querySelector<HTMLElement>('.settings-source')!
  const open = root.querySelector<HTMLElement>('.settings-open')!
  const pages = new Map<string, {slot: HTMLElement; handle?: ChildHandle}>()
  let descriptors: ProjectionDescriptor[] = []
  let selected = ''
  let disposed = false
  const persisted = host.viewStore?.get('settings-navigation') as {page?: string} | undefined
  const label = (d: ProjectionDescriptor) => descriptorTitle(d) ?? d.type.replaceAll('-', ' ')
  const show = async (id: string) => {
    if (disposed) return
    const descriptor = descriptors.find(d => identity(d) === id)
    if (!descriptor && id !== HELP_PAGE) return
    selected = id
    host.viewStore?.set({page:id}, 'settings-navigation')
    feedback.textContent = ''
    source.textContent = descriptor ? label(descriptor) : 'Help & community'
    support.hidden = id !== HELP_PAGE
    open.hidden = id === HELP_PAGE
    picker.value = id
    for (const row of list.querySelectorAll<HTMLElement>('au-list-row')) {
      row.toggleAttribute('selected', row.dataset.id === id)
      if (row.dataset.id === id) row.setAttribute('aria-current', 'page')
      else row.removeAttribute('aria-current')
    }
    for (const [key, page] of pages) page.slot.hidden = key !== id
    if (!descriptor || pages.has(id)) return
    const slot = document.createElement('section')
    slot.className = 'settings-page'
    slot.setAttribute('aria-label', label(descriptor))
    const loading = document.createElement('p')
    loading.className = 'settings-loading'
    loading.setAttribute('role', 'status')
    loading.textContent = `Opening ${label(descriptor)}…`
    slot.append(loading)
    body.append(slot)
    const page: {slot: HTMLElement; handle?: ChildHandle} = {slot}
    pages.set(id, page)
    try {
      if (!host.children?.mount) throw new Error('This host cannot show settings pages here. Use Open in pane.')
      // The host's nodeId mount extension gives each settings page its own terminal and view store.
      const child = {id, config:{type:id}, nodeId: `${host.instanceId ?? rootId}:settings:${id}`}
      page.handle = await host.children.mount(slot, child)
      loading.remove()
      if (disposed || pages.get(id) !== page) { page.handle.unmount(); slot.remove() }
    } catch (error) {
      loading.textContent = error instanceof Error ? error.message : 'Could not open this page.'
      loading.setAttribute('role', 'alert')
      const retry = document.createElement('au-button')
      retry.textContent = 'Try again'
      retry.addEventListener('au-activate', () => {pages.delete(id); slot.remove(); void show(id)})
      slot.append(retry)
    }
  }
  const filter = () => {
    const terms = (search.value ?? '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    let count = 0
    for (const row of list.querySelectorAll<HTMLElement>('au-list-row')) {
      row.hidden = !terms.every(term => row.dataset.search!.includes(term))
      if (!row.hidden) count++
    }
    root.querySelector<HTMLElement>('.settings-empty')!.hidden = count > 0
  }
  const refresh = () => {
    const config = host.config as {surfaces?: unknown} | undefined
    const requested = Array.isArray(config?.surfaces) ? config.surfaces.filter((v): v is string => typeof v === 'string') : DEFAULT_SURFACES
    const discovered = host.describeProjections?.() ?? []
    const unique = new Map<string, ProjectionDescriptor>()
    for (const id of requested) {
      const matches = discovered.filter(d => d.type === id || identity(d) === id)
      if (matches.length === 1 && matches[0].type !== 'settings-hub') unique.set(identity(matches[0]), matches[0])
    }
    descriptors = [...unique.values()]
    for (const [id, page] of pages) if (!unique.has(id)) {page.handle?.unmount(); page.slot.remove(); pages.delete(id)}
    list.replaceChildren()
    picker.options = [...descriptors.map(d => ({value:identity(d),label:label(d)})), {value:HELP_PAGE,label:'Help & community'}]
    for (const d of descriptors) {
      const row = document.createElement('au-list-row')
      row.setAttribute('interactive', '')
      row.setAttribute('primary', label(d))
      row.dataset.id = identity(d)
      row.dataset.search = `${label(d)} ${identity(d)}`.toLocaleLowerCase()
      row.addEventListener('click', () => void show(identity(d)))
      row.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); void show(identity(d))}})
      list.append(row)
    }
    const help = document.createElement('au-list-row')
    help.setAttribute('interactive', '')
    help.setAttribute('primary', 'Help & community')
    help.className = 'settings-help-nav'
    help.innerHTML = '<au-icon slot="leading" name="info" size="sm"></au-icon>'
    help.dataset.id = HELP_PAGE
    help.dataset.search = 'help community support discord website twitter github star'
    help.addEventListener('click', () => void show(HELP_PAGE))
    help.addEventListener('keydown', event => { if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void show(HELP_PAGE) } })
    list.append(help)
    filter()
    const next = selected === HELP_PAGE || unique.has(selected) ? selected : persisted?.page === HELP_PAGE || unique.has(persisted?.page ?? '') ? persisted!.page! : descriptors[0] ? identity(descriptors[0]) : HELP_PAGE
    if (next) void show(next)
    else {selected=''; source.textContent='Settings'; feedback.textContent='No configured settings pages are installed in this workspace.'}
  }
  search.addEventListener('au-input', filter)
  search.addEventListener('keydown', event => {if(event.key === 'Escape') {event.stopPropagation(); search.value=''; filter()}})
  picker.addEventListener('au-change', event => void show((event as CustomEvent).detail.value))
  open.toggleAttribute('disabled', !host.intent)
  open.addEventListener('au-activate', () => {
    if (!selected || selected === HELP_PAGE || !host.intent) return
    try {
      // intent.fire is fire-and-forget (void); dispatch and assume the focused area handles it.
      host.intent.fire({type:'open-pane-intent',dispatch:'ambient',pane:{type:selected}} as Parameters<typeof host.intent.fire>[0])
      feedback.textContent = ''
    } catch {feedback.textContent='Could not open another settings pane.'}
  })
  refresh()
  const unsubscribe = host.subscribeContributions?.(refresh)
  return () => {disposed=true; unsubscribe?.(); for(const page of pages.values()) page.handle?.unmount(); pages.clear(); releaseStyle?.(); root.remove()}
}
export default defineProjection<ProjectionModule>({mount})
