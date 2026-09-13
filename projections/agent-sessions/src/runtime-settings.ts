import type { MountFn } from '@arsumbris/au-host-sdk'
import type { HostApp } from '@arsumbris/au-host-app'
import { button, text, type Input, type Button } from './controls'
import { STYLE } from './style'

type RuntimeInput = Input & { disabled: boolean }

/** Device-local fallback locations; adapter identities come entirely from discovery. */
export const mountRuntimeSettings: MountFn = (container, base) => {
  const host = base as HostApp
  const root = document.createElement('au-scroll-area')
  root.setAttribute('axis', 'y')
  root.className = 'runtime-settings'
  const content = text('div', '', 'runtime-settings-content')
  const sections = text('div', '', 'runtime-sections')
  const feedback = text('p', '', 'sessions-feedback')
  feedback.setAttribute('role', 'status')
  const source = text('p', '', 'profile-source')
  const actions = text('div', '', 'runtime-actions')
  const save = button('Save changes', () => void persist(), 'cta')
  const discard = button('Discard changes', () => {
    for (const [bin, field] of fields) field.input.value = saved[bin] ?? ''
    message('Unsaved changes discarded.'); update()
  }, 'ghost')
  const retry = button('Retry loading', () => void load())
  actions.append(save, discard, retry)
  content.append(
    text('p', 'This device', 'sessions-hint'),
    text('h2', 'Agent runtimes'),
    text('p', 'Choose fallback executable locations for the adapters discovered in this workspace. AU uses PATH first; these locations apply when an executable is not found there.', 'sessions-hint'),
    sections, actions, feedback,
    text('p', 'Changes apply to future sessions. Authentication stays with the installed CLI; session profiles configure context, skills and tools.', 'sessions-hint'),
    source,
  )
  root.append(content); container.append(root)
  const release = host.styles?.inject(STYLE, container)
  let alive = true, busy = false, loaded = false
  let saved: Record<string, string> = {}
  const fields = new Map<string, {input: RuntimeInput; clear: Button}>()
  const dirty = () => [...fields].some(([bin, {input}]) => input.value.trim() !== (saved[bin] ?? ''))
  function message(value: string, error = false) {
    feedback.textContent = value
    feedback.toggleAttribute('data-error', error)
  }
  function update() {
    const changed = dirty()
    save.disabled = busy || !loaded || !changed
    discard.disabled = busy || !loaded || !changed
    actions.hidden = !loaded && retry.hidden
    save.hidden = discard.hidden = !loaded || fields.size === 0
    for (const {input, clear} of fields.values()) {
      input.disabled = busy
      clear.disabled = busy || !input.value.trim()
    }
  }
  async function load() {
    if (busy) return
    busy = true; loaded = false; retry.hidden = true
    message('Loading discovered adapters…'); update()
    try {
      if (!host.mcp.toolPaths || !host.mcp.saveToolPaths || !host.mcp.listAdapters)
        throw Error('Runtime settings are unavailable in this window.')
      const [info, adapters] = await Promise.all([host.mcp.toolPaths(), host.mcp.listAdapters()])
      if (!alive) return
      saved = {...info.paths.binaries}
      const groups = new Map<string, string[]>()
      for (const adapter of adapters) {
        const bin = adapter.runtime.agentBinary
        if (!bin) continue
        const labels = groups.get(bin) ?? []
        if (!labels.includes(adapter.label)) labels.push(adapter.label)
        groups.set(bin, labels)
      }
      fields.clear(); sections.replaceChildren()
      for (const [bin, labels] of groups) {
        const section = text('section', '', 'runtime-section')
        section.append(text('h3', labels.join(' · ')), text('p', bin, 'runtime-executable'))
        const field = document.createElement('au-field')
        field.setAttribute('label', 'Fallback location')
        field.setAttribute('hint', `Leave empty to use ${bin} from PATH only.`)
        const input = document.createElement('au-input') as RuntimeInput
        input.setAttribute('label', `${bin} fallback location`)
        input.setAttribute('placeholder', 'Path to executable…')
        input.setAttribute('spellcheck', 'false')
        input.value = saved[bin] ?? ''
        const clear = button('Use PATH', () => {input.value = ''; message('Unsaved changes. Save to apply.'); update()}, 'ghost')
        input.addEventListener('au-input', () => {message(dirty() ? 'Unsaved changes. Save to apply.' : ''); update()})
        fields.set(bin, {input, clear})
        field.append(input); section.append(field, clear); sections.append(section)
      }
      if (!fields.size) sections.append(text('p', 'No adapters with configurable executables were discovered in this workspace.', 'sessions-hint'))
      source.textContent = info.file
      loaded = true; message('')
    } catch (error) {
      if (alive) {message(error instanceof Error ? error.message : String(error), true); retry.hidden = false}
    } finally {busy = false; if (alive) update()}
  }
  async function persist() {
    if (busy || !loaded || !dirty() || !host.mcp.saveToolPaths) return
    // The host replaces the complete map. Retain overrides outside this workspace's discovery.
    const binaries = {...saved}
    for (const [bin, {input}] of fields) binaries[bin] = input.value.trim()
    busy = true; save.loading = true; message('Saving…'); update()
    try {
      await host.mcp.saveToolPaths({binaries})
      if (!alive) return
      saved = binaries
      for (const [bin, {input}] of fields) input.value = saved[bin] ?? ''
      message('Saved. Running sessions are unchanged.')
    } catch (error) {
      if (alive) message(error instanceof Error ? error.message : String(error), true)
    } finally {busy = false; if (alive) {save.loading = false; update()}}
  }
  void load()
  return () => {alive = false; release?.(); root.remove()}
}
