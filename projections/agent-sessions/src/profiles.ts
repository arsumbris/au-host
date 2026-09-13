import type { MountHost } from '@arsumbris/au-host-sdk'
import type { AgentProfileData, DiscoveredAdapter, HostApp } from '@arsumbris/au-host-app'
import { readSubtypes } from '@arsumbris/au-host-sdk/engine-reads'
import { openIntent, showPaneIntent } from '@arsumbris/intent'
import { fileSelection } from '@arsumbris/selection'
import { parse, stringify } from 'yaml'
import { button, select, text, type Input } from './controls'
import { instanceRef, profileSummary } from './model'
import { STYLE } from './style'
import {prepareProfileTerminal, copyTerminalCommand} from './launch-command'
interface Option {
  ref: string
  name: string
  description: string
  owner: string
  path?: string
  required?: boolean
  includedByDefault?: boolean
}
type Axis = 'skills' | 'inject' | 'tools' | 'hooks'
interface DraftState {
  draft: AgentProfileData
  dirty: boolean
  hookText?: string
  hookError?: string
  nativeMode?: 'inherit' | 'none' | 'selected'
}
export function mountProfiles(
  container: HTMLElement,
  base: MountHost,
): () => void {
  const host = base as HostApp
  let alive = true,
    profiles: AgentProfileData[] = [],
    adapters: DiscoveredAdapter[] = [],
    busy = false
  let copyingCommand = false
  let loadRevision = 0
  let loading = true, catalogueLoaded = false, capabilitiesReady = false, operation = 'Saving…'
  const stored = host.viewStore?.get() as DraftState | undefined
  let draft: AgentProfileData = stored?.draft ?? { name: '' },
    dirty = stored?.dirty ?? false
  let nativeModeChoice = stored?.nativeMode
  let hookText = stored?.hookText,
    hookError = stored?.hookError
  let options: Record<Axis, Option[]> = {
    skills: [],
    inject: [],
    tools: [],
    hooks: [],
  }
  const root = text('section', '', 'profiles-editor')
  root.setAttribute('aria-label', 'Session profiles')
  const picker = select('Saved profile', [], '', (value) => {
    if (!canLeave()) {
      picker.value = draft.path ?? ''
      return
    }
    const p = profiles.find((p) => p.path === value)
    if (p) {
      draft = structuredClone(p)
      dirty = false
      hookText = undefined
      hookError = undefined
      nativeModeChoice = undefined
      render()
      void load()
    }
  })
  const head = text('div', '', 'profiles-head')
  head.append(
    picker,
    button('New profile', () => {
      if (canLeave()) {
        draft = { name: '' }
        hookText = undefined
        hookError = undefined
        nativeModeChoice = undefined
        render()
        void load()
      }
    }),
    button('Duplicate', () => {
      if (canLeave()) {
        draft = {
          ...structuredClone(draft),
          name: draft.name ? draft.name + '-copy' : '',
        }
        delete draft.path
        delete draft.revision
        dirty = true
        render()
      }
    }),
  )
  const scroll = document.createElement('au-scroll-area')
  scroll.className = 'profiles-body'
  scroll.setAttribute('axis', 'y')
  const content = text('div', '', 'profiles-content')
  scroll.append(content)
  const feedback = text('p', '', 'profile-feedback')
  feedback.setAttribute('role', 'status')
  const retryLoad = button('Retry loading profiles', () => void (catalogueLoaded ? load() : initialize()))
  retryLoad.hidden = true
  const status = text('div', '', 'profiles-feedback-region')
  status.append(feedback, retryLoad)
  const draftStatus = text('span', '', 'profile-draft')
  const overview = text('p', '', 'sessions-hint')
  const copyStart = button('Copy start command', () => void copyCommand(), 'ghost')
  const copyIcon = document.createElement('au-icon')
  copyIcon.setAttribute('name', 'copy')
  copyIcon.setAttribute('aria-hidden', 'true')
  copyStart.replaceChildren(copyIcon, text('span', 'Copy start command'))
  const save = button('Save profile', () => void saveDraft(), 'solid')
  const discard = button('Discard changes', () => {
    draft = structuredClone(
      profiles.find((p) => p.path === draft.path) ?? { name: '' },
    )
    dirty = false
    hookText = undefined
    hookError = undefined
    nativeModeChoice = undefined
    render()
    void load()
  })
  const remove = button(
    'Delete profile',
    () => {
      confirmation.hidden = false
    },
    'ghost',
  )
  const actions = text('div', '', 'profiles-actions')
  actions.append(draftStatus, copyStart, discard, save)
  const confirmation = text('div', '', 'profiles-actions')
  confirmation.hidden = true
  confirmation.append(
    text(
      'span',
      'Delete this saved profile? Running sessions are unaffected.',
      'sessions-hint',
    ),
    button('Keep profile', () => (confirmation.hidden = true)),
    button('Delete', () => void deleteDraft()),
  )
  const title = text('header', '', 'profiles-title')
  title.append(text('h2', 'Session profiles'), text('p', 'Reusable agent setups for this workspace. Changes apply to future sessions.', 'sessions-hint'))
  root.append(title, head, scroll, status, confirmation, actions)
  container.append(root)
  const release = host.styles?.inject(STYLE, container)
  function report(message: string, error = false) {
    feedback.textContent = message
    feedback.toggleAttribute('data-error', error)
    status.hidden = !message && retryLoad.hidden
  }
  async function copyCommand() {
    if (copyingCommand || busy || loading || dirty || !draft.path) return
    const profile = structuredClone(draft)
    let adapter = profile.adapter ?? (adapters.length === 1 ? adapters[0].name : undefined)
    if (!adapter && adapters.length > 1) {
      const chosen = await host.chooser?.choose({title:'Choose an adapter', options:adapters.map(a => ({id:a.name,label:a.label}))})
      if (!chosen) return
      adapter = chosen
    }
    copyingCommand = true
    updateActions()
    try {
      await copyTerminalCommand(await prepareProfileTerminal(host, profile, adapter))
      if (alive) report('Start command copied. Paste it into your terminal.')
    } catch (error) {
      if (alive) report(error instanceof Error ? error.message : String(error), true)
    } finally {
      copyingCommand = false
      if (alive) updateActions()
    }
  }
  function canLeave() {
    if (busy || loading) return false
    if (dirty) {
      report(
        'Save or discard your changes before choosing another profile.',
        true,
      )
      return false
    }
    return true
  }
  function changed() {
    dirty = true
    host.viewStore?.set({ draft, dirty, hookText, hookError, nativeMode: nativeModeChoice })
    updateActions()
  }
  function updateActions() {
    root.dataset.loaded = String(catalogueLoaded)
    status.hidden = !feedback.textContent && retryLoad.hidden
    const hooks = draft.hooks === undefined ? 'Default hooks' : draft.hooks.length ? `${draft.hooks.length} hook references + required hooks` : 'Required hooks only'
    const native = draft.nativeToolAllowlist === undefined ? 'All native tools' : draft.nativeToolAllowlist.length ? `${draft.nativeToolAllowlist.length} native tools` : 'No native tools'
    overview.textContent = `${profileSummary(draft)} · ${hooks} · ${native}`
    copyStart.disabled = copyingCommand || busy || loading || dirty || !draft.path
    copyStart.loading = copyingCommand
    copyStart.title = dirty || !draft.path ? 'Save this profile before copying its start command' : 'Copy the saved profile command for your own terminal'
    save.disabled = busy || loading || !catalogueLoaded || !capabilitiesReady || !dirty || !!hookError || !draft.name.trim()
    save.loading = busy
    discard.disabled = busy || loading || !dirty
    remove.disabled = busy || loading || !draft.path
    draftStatus.textContent = busy
      ? operation
      : loading ? 'Loading profiles…' : dirty
        ? 'Unsaved changes'
        : draft.path ? 'Saved profile' : 'New profile'
    picker.toggleAttribute('disabled', busy || loading)
    content.inert = busy || loading || !catalogueLoaded
    confirmation.inert = busy || loading
    for (const action of head.querySelectorAll('au-button')) action.toggleAttribute('disabled', busy || loading)
  }
  function render() {
    // Keep one live status region; return it to the footer before rebuilding its previous parent.
    status.removeAttribute('slot')
    root.insertBefore(status, confirmation)
    content.replaceChildren()
    confirmation.hidden = true
    picker.value = draft.path ?? ''
    host.viewStore?.set({ draft, dirty, hookText, hookError, nativeMode: nativeModeChoice })
    updateActions()
    const name = document.createElement('au-input') as Input
    name.setAttribute('aria-label', 'Profile name')
    name.setAttribute('placeholder', 'Profile name')
    name.value = draft.name
    name.toggleAttribute('disabled', !!draft.path)
    name.addEventListener('au-input', () => {
      draft.name = name.value
      changed()
    })
    const identity = text('section', '', 'profiles-identity')
    const nameField = document.createElement('au-field')
    nameField.setAttribute('label', 'Profile name')
    nameField.setAttribute('hint', draft.path ? 'Duplicate this profile to create a named variant.' : 'Give this reusable setup a name before saving.')
    nameField.append(name)
    identity.append(nameField)
    // The adapter options are the DISCOVERED `mcp.adapter` set (label = presentation label), not a
    // hardcoded pair. Value = the adapter's type name (== AdapterInfo.harness).
    //
    // HONEST default (with ≥2 adapters the user must CHOOSE): when ≥2 are discovered and the
    // profile pins none, offer a "Choose at launch…" placeholder (value '') rather than silently
    // showing the first — otherwise the select LOOKS set while `adapter` stays unpersisted, and the
    // launch then reports "multiple adapters — choose one". With a single adapter, no choice is
    // needed (launch auto-picks it), so it can display without a pin.
    const needsChoice = adapters.length > 1
    const adapter = select(
      'Adapter',
      [
        ...(needsChoice ? [{ value: '', label: 'Choose at launch…' }] : []),
        ...adapters.map((a) => ({ value: a.name, label: a.label })),
      ],
      draft.adapter ?? (needsChoice ? '' : (adapters[0]?.name ?? '')),
      (value) => {
        draft.adapter = value || undefined // '' (the placeholder) = no pin, choose at launch
        changed()
        // The offered skills/injects are the chosen adapter's, so re-read them for the new adapter.
        void load()
      },
    )
    const adapterField = document.createElement('au-field')
    adapterField.setAttribute('label', 'Adapter')
    adapterField.setAttribute('hint', 'Determines the available context and skills. Runtime locations are configured separately.')
    adapterField.append(adapter)
    identity.append(adapterField)
    content.append(identity, button(
      'Configure installed runtimes',
      () => host.intent.fire(showPaneIntent('agent-runtime-settings')),
      'ghost',
    ))
    if (!capabilitiesReady) {
      const unavailable = document.createElement('au-empty-state')
      unavailable.setAttribute('label', loading ? 'Loading profile capabilities…' : 'Profile capabilities unavailable')
      unavailable.setAttribute('hint', loading ? 'Reading the available context, tools and policies for this profile.' : 'Your selections are preserved. Retry loading, or choose another adapter.')
      if (catalogueLoaded) {
        status.setAttribute('slot', 'action')
        unavailable.append(status)
      }
      content.append(unavailable)
      return
    }
    const capabilities = text('section', '', 'profiles-capabilities')
    capabilities.append(text('h2', 'Context and capabilities'), text('p', 'Keep workspace defaults or choose exactly what this profile includes.', 'sessions-hint'))
    content.append(capabilities)
    for (const [axis, label, hint] of [
      [
        'inject',
        'Always-on context',
        'Included at session start. Workspace defaults include entry/edit context, not dependency context.',
      ],
      ['skills', 'Skills', 'Reusable capabilities available to the agent.'],
      [
        'tools',
        'AU tools',
        'Controls tool visibility. A tool’s declared engine access is not changed here.',
      ],
      [
        'hooks',
        'Hooks',
        'Critical hooks always run. Optional hooks can inherit defaults or use an explicit selection.',
      ],
    ] as const) {
      const section = document.createElement('au-accordion-item')
      section.setAttribute('label', label)
      section.setAttribute('density', 'compact')
      section.setAttribute(
        'sublabel',
        draft[axis] === undefined
          ? 'Inherited defaults'
          : draft[axis]!.length
            ? `${draft[axis]!.length} selected`
            : axis === 'hooks' ? 'Required hooks only' : 'None selected',
      )
      const body = text('div', '', 'profile-field')
      body.append(text('p', hint, 'sessions-hint'))
      const mode = select(
        label + ' selection',
        [
          { value: 'inherit', label: 'Use defaults' },
          {
            value: 'none',
            label: axis === 'hooks' ? 'Critical hooks only' : 'None',
          },
          { value: 'selected', label: 'Choose individually' },
        ],
        draft[axis] === undefined
          ? 'inherit'
          : draft[axis]!.length
            ? 'selected'
            : 'none',
        (value) => {
          if (value === 'inherit') delete draft[axis]
          else if (value === 'none') draft[axis] = []
          else
            draft[axis] = options[axis]
              .filter((o) => !o.required)
              .map((o) => o.ref)
          changed()
          render()
          content
            .querySelector<HTMLElement>(`au-accordion-item[label="${label}"]`)
            ?.setAttribute('open', '')
        },
      )
      body.append(mode)
      const groups = new Map<string, HTMLElement>()
      for (const option of [...options[axis]].sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))) {
        let group = groups.get(option.owner)
        if (!group) {
          group = text('section', '', 'profile-origin-group')
          group.setAttribute('aria-label', option.owner)
          group.append(text('h3', option.owner, 'profile-origin-heading'))
          groups.set(option.owner, group)
          body.append(group)
        }
        const row = document.createElement('label')
        row.className = 'profile-option'
        const box = document.createElement('au-checkbox') as HTMLElement & {
          checked: boolean
          disabled: boolean
        }
        box.checked =
          !!option.required ||
          (draft[axis] === undefined
            ? (option.includedByDefault ?? true)
            : draft[axis]!.includes(option.ref))
        box.disabled = !!option.required || draft[axis] === undefined
        box.setAttribute('aria-label', option.name + (option.required ? ' · Required' : ''))
        box.addEventListener('au-change', () => {
          const next = new Set(draft[axis] ?? [])
          if (box.checked) next.add(option.ref)
          else next.delete(option.ref)
          draft[axis] = [...next]
          changed()
          section.setAttribute('sublabel', `${next.size} selected`)
        })
        const detail = text('div', '', 'profile-option-content')
        detail.append(
          text('strong', option.name + (option.required ? ' · Required' : '')),
          text('p', option.description),
        )
        row.append(box, detail)
        const entry = text('div', '', 'profile-option-entry')
        entry.append(row)
        group.append(entry)
        if (option.path)
          entry.append(
            button(
              'View source',
              () => host.intent.fire(openIntent(fileSelection(option.path!))),
              'ghost',
            ),
          )
      }
      const unresolved = (draft[axis] ?? []).filter(
        (ref) => !options[axis].some((o) => o.ref === ref),
      )
      if (unresolved.length)
        body.append(
          text(
            'p',
            `Unresolved references preserved: ${unresolved.join(', ')}`,
            'sessions-hint',
          ),
        )
      if (!options[axis].length)
        body.append(
          text(
            'p',
            'No capabilities discovered in this workspace. Existing references are preserved.',
            'sessions-hint',
          ),
        )
      section.append(body)
      capabilities.append(section)
    }
    const advanced = text('section', '', 'profiles-capabilities')
    advanced.append(text('h2', 'Adapter policies'), text('p', 'Configure native tool access and typed hook instances.', 'sessions-hint'))
    content.append(advanced)
    const native = document.createElement('au-accordion-item')
    native.setAttribute('label', 'Native tools')
    native.setAttribute('density', 'compact')
    const nativeMode = select(
      'Native tool policy',
      [
        { value: 'inherit', label: 'All native tools' },
        { value: 'none', label: 'No native tools' },
        { value: 'selected', label: 'Named allowlist' },
      ],
      nativeModeChoice ?? (draft.nativeToolAllowlist === undefined
        ? 'inherit'
        : draft.nativeToolAllowlist.length
          ? 'selected'
          : 'none'),
      (value) => {
        nativeModeChoice = value as 'inherit' | 'none' | 'selected'
        if (value === 'inherit') delete draft.nativeToolAllowlist
        else draft.nativeToolAllowlist = []
        changed()
        nativeField.hidden = value !== 'selected'
      },
    )
    const nativeField = document.createElement('au-textarea') as Input
    nativeField.setAttribute('aria-label', 'Native tool names, one per line')
    nativeField.setAttribute(
      'placeholder',
      'One adapter-native tool name per line',
    )
    nativeField.value = draft.nativeToolAllowlist?.join('\n') ?? ''
    nativeField.hidden = nativeMode.value !== 'selected'
    nativeField.addEventListener('au-input', () => {
      draft.nativeToolAllowlist = nativeField.value
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
      changed()
    })
    native.append(
      text(
        'p',
        'Names are adapter-specific. They apply to the adapter selected in this session profile.',
        'sessions-hint',
      ),
      nativeMode,
      nativeField,
    )
    advanced.append(native)
    const hooks = document.createElement('au-accordion-item')
    hooks.setAttribute('label', 'Hook configuration')
    hooks.setAttribute('sublabel', 'Advanced · typed hook instances')
    hooks.setAttribute('density', 'compact')
    const hookField = document.createElement('au-textarea') as Input
    hookField.setAttribute('aria-label', 'Typed hook configuration YAML')
    hookField.setAttribute('mono', '')
    hookField.setAttribute('rows', '6')
    hookField.value =
      hookText ?? (draft.hookConfig ? stringify(draft.hookConfig) : '')
    hookField.toggleAttribute('error', !!hookError)
    hookField.addEventListener('au-input', () => {
      hookText = hookField.value
      try {
        const value = hookField.value.trim()
          ? parse(hookField.value)
          : undefined
        if (value !== undefined && (!Array.isArray(value) || !value.length))
          throw Error(
            'Use a non-empty list of typed hook instances, or leave empty to inherit.',
          )
        draft.hookConfig = value
        hookError = undefined
        hookField.removeAttribute('error')
        report('')
        changed()
      } catch (error) {
        hookError = error instanceof Error ? error.message : String(error)
        hookField.setAttribute('error', '')
        changed()
        report(hookError, true)
      }
    })
    hooks.append(
      text(
        'p',
        'Configure typed hook instances independently of optional hook selection. Required hooks cannot be disabled.',
        'sessions-hint',
      ),
      hookField,
    )
    advanced.append(hooks)
    content.append(
      text('h2', 'Selection overview'),
      overview,
    )
    const source = document.createElement('au-accordion-item')
    source.setAttribute('label', 'Profile source and management')
    source.setAttribute('density', 'compact')
    source.append(text('p', draft.path ?? 'This profile has not been saved yet.', 'profile-source'), remove)
    content.append(source)
  }
  async function refresh() {
    const [result, discovered] = await Promise.all([host.mcp.listProfiles(), host.mcp.listAdapters()])
    if (!alive) return
    profiles = result
    adapters = discovered
    picker.options = profiles.map((p) => ({
      value: p.path ?? p.name,
      label: p.name,
    }))
    if (!draft.name && !dirty && profiles[0])
      draft = structuredClone(profiles[0])
    render()
  }
  async function saveDraft() {
    if (busy || loading || !catalogueLoaded || !capabilitiesReady || hookError || !dirty || !draft.name.trim()) return
    operation = 'Saving…'
    busy = true
    updateActions()
    try {
      const result = await host.mcp.saveProfile(draft.name, {
        ...structuredClone(draft),
        // The pinned adapter type name (a discovered `mcp.adapter`), or undefined = the host's
        // count rule chooses at launch. No hardcoded fallback.
        adapter: draft.adapter,
      })
      if (!alive) return
      if (!result.ok) throw Error(result.error ?? 'Profile could not be saved')
      dirty = false
      hookText = undefined
      hookError = undefined
      nativeModeChoice = undefined
      const name = result.name ?? draft.name
      profiles = await host.mcp.listProfiles()
      const saved = profiles.find((p) => p.name === name)
      if (!saved) {
        dirty = true
        throw Error('The file was written, but the workspace has not discovered it as a session profile. Check its type and workspace dependencies before trying again.')
      }
      draft = structuredClone(saved)
      await refresh()
      await load()
      report('Profile saved. Select it in New session to use these settings.')
    } catch (error) {
      report(error instanceof Error ? error.message : String(error), true)
    } finally {
      busy = false
      if (alive) updateActions()
    }
  }
  async function deleteDraft() {
    if (busy || loading || !draft.path) return
    busy = true; operation = 'Deleting…'; updateActions()
    try {
      const result = await host.mcp.deleteProfile(draft.name, draft.path)
      if (!alive) return
      if (!result.ok) throw Error(result.error ?? 'Could not delete profile')
      draft = { name: '' }; dirty = false
      hookText = undefined; hookError = undefined; nativeModeChoice = undefined
      await refresh()
      if (!alive) return
      await load()
      report('Profile deleted.')
    } catch (error) {
      if (alive) report(error instanceof Error ? error.message : String(error), true)
    } finally { busy = false; if (alive) updateActions() }
  }
  async function load() {
    const revision = ++loadRevision
    const adapter = draft.adapter
    loading = true; capabilitiesReady = false; retryLoad.hidden = true; report(''); render()
    try {
      // Skills + injects are the SELECTED adapter's (its gen-* bins produce them), so scope the reads
      // to `draft.adapter`. Absent pin → main's count rule (single adapter auto; ≥2 → empty until the
      // user picks an adapter in the select, whose onChange re-runs this). Tools/hooks are
      // adapter-independent engine reads.
      const [skills, injects, tools, hooks] = await Promise.all([
        host.mcp.skillManifest(adapter),
        host.mcp.injectManifest(adapter),
        readSubtypes(host.engine, 'mcp.tool'),
        readSubtypes(host.engine, 'mcp.hook'),
      ])
      if (!alive || revision !== loadRevision) return
      options.skills = skills.skills.map((s) => ({
        ref: instanceRef(s),
        name: s.name,
        description: s.description,
        owner: s.owner,
        path: s.path,
      }))
      options.inject = injects.injects.map((s) => ({
        ref: instanceRef(s),
        name: s.name,
        owner: s.owner,
        description: `${s.description} · ${s.bytes.toLocaleString()} bytes · ${s.role}`,
        path: s.path,
        includedByDefault: s.role === 'entry' || s.role === 'edit',
      }))
      for (const [axis, response] of [
        ['tools', tools],
        ['hooks', hooks],
      ] as const) {
        if (!('ready' in response) || !response.ready || !response.result)
          throw Error(`The ${axis} catalogue is not ready. Retry when the workspace engine is ready.`)
        options[axis] = response.result.subtypes
            .filter((t) =>
              t.meta_blocks?.some((b) =>
                b.type_name.startsWith('plugin-runtime-meta'),
              ),
            )
            .map((t) => ({
              ref: `[[${t.name}::${t.repo}]]`,
              owner: t.repo,
              name: t.name.replace(/^mcp\.(tool|hook)\./, ''),
              description:
                (t.meta_blocks
                  ?.flatMap((b) => b.body)
                  .find((f) => f.name === 'description')?.value as string) ??
                t.repo,
              path: t.source.file,
              required:
                axis === 'hooks' &&
                t.meta_blocks
                  ?.flatMap((b) => b.body)
                  .some((f) => f.name === 'critical' && f.value === true),
            }))
      }
      capabilitiesReady = true
      render()
    } catch (error) {
      if (alive && revision === loadRevision) {
        retryLoad.hidden = false
        report(
          `Could not load profiles: ${error instanceof Error ? error.message : String(error)}`,
          true,
        )
      }
    } finally {
      if (alive && revision === loadRevision) { loading = false; if (!capabilitiesReady) render(); else updateActions() }
    }
  }
  async function initialize() {
    loading = true; retryLoad.hidden = true; report('Loading profiles…'); updateActions()
    try {
      await refresh()
      if (!alive) return
      catalogueLoaded = true
      await load()
    } catch (error) {
      if (alive) {
        loading = false; retryLoad.hidden = false; updateActions()
        report(`Could not load profiles: ${error instanceof Error ? error.message : String(error)}`, true)
      }
    }
  }
  render()
  void initialize()
  return () => {
    alive = false
    loadRevision++
    release?.()
    root.remove()
  }
}
