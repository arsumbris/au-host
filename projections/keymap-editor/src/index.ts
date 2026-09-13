import { displayFilePath } from '@arsumbris/au-host-sdk'
// KEYMAP EDITOR projection — the human surface over the keybinds system. It reads the composition's ACTIVE
// keymaps (host.keymaps — the app-owned list-edit capability), the discoverable keymap FILES, and shows each
// active keymap's keybinds. It manages the active list (add / remove / reorder — every layer removable,
// nothing hidden) and REBINDS a keybind's chord via <au-chord-input>, writing the keymap file. A CONSUMED
// (shipped, read-only) keymap is copied into the vault under a distinct `-local` name first, then the active
// list is re-pointed at the copy.

// host.keymaps is app-owned (HostApp), reached by casting the mount host — the established pattern for a
// projection using an app-owned capability (the trust boundary is the agent bridge, not the type).


import { defineProjection, formatChord, bareTypeName, type ProjectionModule, type MountHost, type CanonicalKeystroke, type KeyName, type KeyModifier } from '@arsumbris/au-host-sdk'
import type { HostApp, KeymapsControl } from '@arsumbris/au-host-app'
import { readInstancesOf, readSubtypes, type WireSubtype, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'

interface Keybind {
  chord: CanonicalKeystroke[]
  intent: string // the raw ref target, `::repo` PRESERVED (e.g. `save-intent::intent`)
  when?: string[]
}
interface KeymapFile {
  name: string // the stem incl. `.keymap` (e.g. `default.keymap`) — matches the reference + registry keying
  path: string
  when?: string[]
  keybinds: Keybind[]
}

import { STYLE } from './style'
import {parseDocument} from 'yaml'


/** Strip `[[ ]]` from a wikilink value, PRESERVING the `::repo` qualifier + inner name. Accepts a raw string
 *  or a parsed ref object. Returns the ref target (e.g. `save-intent::intent`), or '' when unresolvable. */
function refTarget(value: unknown): string {
  if (typeof value === 'string') {
    const m = /\[\[([^\]]+)\]\]/.exec(value)
    return (m ? m[1] : value).trim()
  }
  if (value && typeof value === 'object') {
    const t = (value as Record<string, unknown>).target ?? (value as Record<string, unknown>).name
    if (typeof t === 'string') return t.trim()
  }
  return ''
}

/** A keymap file's name: its basename minus the file extension (`default.keymap.yaml` -> `default.keymap`). */
function keymapName(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.(md|ya?ml)$/i, '')
}

function parseKeystroke(rec: unknown): CanonicalKeystroke | null {
  if (!rec || typeof rec !== 'object') return null
  const r = rec as Record<string, unknown>
  if (typeof r.key !== 'string') return null
  const mods = (Array.isArray(r.mods) ? r.mods : []).filter((m): m is string => typeof m === 'string')
  return { key: r.key as KeyName, mods: mods as KeyModifier[] }
}

function parseKeybind(rec: unknown): Keybind | null {
  if (!rec || typeof rec !== 'object') return null
  const r = rec as Record<string, unknown>
  const chord = (Array.isArray(r.chord) ? r.chord : []).map(parseKeystroke).filter((x): x is CanonicalKeystroke => !!x)
  const intent = refTarget(r.intent)
  if (chord.length === 0 || !intent) return null
  const when = Array.isArray(r.when) ? r.when.map(refTarget).filter(Boolean) : undefined
  return { chord, intent, when: when && when.length ? when : undefined }
}

export const keymapEditor: ProjectionModule['mount'] = (container: HTMLElement, host: MountHost) => {
  const root = document.createElement('div')
  root.className = 'au-kme'
  container.appendChild(root)
  const disposeStyle = host.styles?.inject(STYLE, container)

  const keymaps: KeymapsControl | undefined = (host as unknown as HostApp).keymaps
  const reader: WireReader = host.engine

  if (!keymaps) {
    root.innerHTML = '<div class="au-kme-empty">Keymap editing runs in the main window (a root composition mount).</div>'
    return () => disposeStyle?.()
  }

  let files: KeymapFile[] = []
  let labels = new Map<string, string>() // bare intent name -> command label
  let error: string | null = null
  let busy = false
  let query = ''
  let status = ''
  let editing: string | null = null
  let draft: CanonicalKeystroke[] = []
  let adding = false
  let newIntent = ''
  let newMap = ''
  let pendingImport: {name: string; content: string; count: number} | null = null

  const fileByName = (name: string): KeymapFile | undefined => files.find((f) => f.name === name)
  const memberOf = (path: string) => host.workspace.members.find((m) => path.startsWith(m.root))
  const isConsumed = (f: KeymapFile): boolean => !memberOf(f.path)?.editable

  async function load(): Promise<void> {
    const [kmRes, intentRes] = await Promise.all([
      readInstancesOf(reader, 'keymap', { origins: ['file'] }),
      readSubtypes(reader, 'intent'),
    ])
    if ('ready' in kmRes && kmRes.ready && kmRes.result) {
      files = (kmRes.result as { path: string; fields?: Record<string, unknown> }[]).map((inst) => ({
        name: keymapName(inst.path),
        path: inst.path,
        when: Array.isArray(inst.fields?.when) ? inst.fields!.when.map(refTarget).filter(Boolean) : undefined,
        keybinds: (Array.isArray(inst.fields?.keybinds) ? inst.fields!.keybinds : []).map(parseKeybind).filter((x): x is Keybind => !!x),
      }))
    }
    // Command labels from command-meta on each intent subtype (best-effort; falls back to the bare name).
    labels = new Map()
    if ('ready' in intentRes && intentRes.ready && intentRes.result) {
      const subs = Array.isArray(intentRes.result) ? intentRes.result : (intentRes.result as { subtypes?: unknown[] }).subtypes ?? []
      for (const def of subs as WireSubtype[]) {
        const block = def.meta_blocks?.find(meta => bareTypeName(meta.type_name) === 'command-meta')
        const label = block?.body.find(field => field.name === 'label')?.value
        if (typeof label === 'string') labels.set(def.name, label)
      }
    }
    render()
  }

  const cmdLabel = (intent: string): string => labels.get(intent) ?? labels.get(bareTypeName(intent)) ?? bareTypeName(intent)

  /** Persist a keymap's keybinds. Editable member → guarded in-place write. Consumed (shipped) → copy into a
   *  writable member under a distinct `-local` name (no `[[name]]` collision), then re-point the active list. */
  async function persist(km: KeymapFile, index: number, chord: CanonicalKeystroke[], intent?: string): Promise<void> {
    busy = true
    error = null
    status = ''
    render()
    try {
      const cur = await host.files.read(km.path)
      if (!cur.ok || typeof cur.content !== 'string') throw new Error('Could not read the keymap. Your change has not been saved.')
      const document = parseDocument(cur.content)
      if (document.errors.length) throw new Error('The keymap contains invalid YAML. Fix its source before rebinding.')
      if (intent) {
        const bindings = document.toJS()?.keybinds
        if (!Array.isArray(bindings) || bindings.length !== km.keybinds.length) throw new Error('This keymap changed. Reload before adding a shortcut.')
        document.addIn(['keybinds'], {intent: `[[${intent}]]`, chord})
      } else {
        const current = parseKeybind(document.toJS()?.keybinds?.[index])
        if (!current || current.intent !== km.keybinds[index]?.intent || JSON.stringify(current.chord) !== JSON.stringify(km.keybinds[index]?.chord)) throw new Error('This shortcut changed in the file. Reload it before trying again.')
        document.setIn(['keybinds', index, 'chord'], chord)
      }
      const yaml = document.toString()
      if (!isConsumed(km)) {
        const res = await host.files.write(km.path, yaml, cur.ok ? cur.hash : undefined)
        if (!res.ok) error = `write failed: ${res.error ?? 'unknown'}`
      } else {
        const target = host.workspace.members.find((m) => m.editable)
        if (!target) {
          error = 'no writable member to copy the shipped keymap into'
        } else {
          const stem = km.name.replace(/\.keymap$/, '')
          let copyName = `${stem}-local.keymap`
          let copyPath = `${target.root}/${copyName}.yaml`
          let suffix = 2
          while ((await host.files.read(copyPath)).ok) {
            copyName = `${stem}-local-${suffix++}.keymap`
            copyPath = `${target.root}/${copyName}.yaml`
          }
          const res = await host.files.write(copyPath, yaml)
          if (!res.ok) error = `copy failed: ${res.error ?? 'unknown'}`
          else {
            // Re-point the active list: the shipped name out, the local copy in (kept at the same position).
            const order = keymaps!.list().map((n) => (n === km.name ? copyName : n))
            keymaps!.reorder(order.includes(copyName) ? order : [...order, copyName])
          }
        }
      }
      if (!error) { status = 'Shortcut saved. Save the composition to keep any keymap-list changes.'; editing = null; adding = false }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save the shortcut.'
    } finally {
      busy = false
      await load() // re-read (the new copy appears, hashes refresh)
    }
  }

  async function chooseImport(file: File): Promise<void> {
    error = null
    try {
      const content = await file.text()
      const document = parseDocument(content)
      const data = document.toJS()
      if (document.errors.length || bareTypeName(refTarget(data?.type)) !== 'keymap' || !Array.isArray(data?.keybinds) || data.keybinds.some((binding: unknown) => !parseKeybind(binding))) {
        throw new Error('Choose a valid keymap YAML file with type keymap::au-host-sdk and a keybinds list.')
      }
      pendingImport = {name: file.name.replace(/\.(?:yaml|yml)$/i, '').replace(/\.keymap$/, ''), content, count: data.keybinds.length}
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not read the selected file.' }
    render()
  }

  async function importKeymap(): Promise<void> {
    const selected = pendingImport
    if (!selected || busy) return
    const members = host.workspace.members.filter(member => member.editable)
    if (!members.length) { error = 'This workspace has no editable member to import into.'; render(); return }
    let target = members[0]
    if (members.length > 1) {
      if (!host.chooser) { error = 'This host cannot choose an import destination.'; render(); return }
      const id = await host.chooser.choose({title: 'Import keymap into', options: members.map(member => ({id: member.root, label: member.name}))})
      if (!id) return
      target = members.find(member => member.root === id)!
    }
    busy = true; error = null; render()
    try {
      let name = `${selected.name}.keymap`
      let path = `${target.root}/${name}.yaml`
      let suffix = 2
      while (files.some(file => file.name === name) || (await host.files.read(path)).ok) {
        name = `${selected.name}-${suffix++}.keymap`
        path = `${target.root}/${name}.yaml`
      }
      const result = await host.files.write(path, selected.content)
      if (!result.ok) throw new Error(result.error ?? 'Could not import the keymap.')
      keymaps!.add(name)
      pendingImport = null
      status = `Imported ${name} into ${target.name}. Save the composition to keep it active.`
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not import the keymap.' }
    finally { busy = false; await load() }
  }

  function rebind(km: KeymapFile, index: number, chord: CanonicalKeystroke[]): void {
    if (chord.length === 0) return
    void persist(km, index, chord)
  }

  function render(): void {
    const oldScroll = root.querySelector('au-scroll-area')?.shadowRoot?.querySelector('.scroll')?.scrollTop ?? 0
    root.replaceChildren()
    const toolbar = el('header', 'au-kme-toolbar')
    toolbar.append(el('h1', '', 'Keyboard shortcuts'), el('p', '', 'Find a command, then change its shortcut. Keymaps belong to this composition.'))
    const search = document.createElement('au-input') as HTMLElement & {value: string}
    search.setAttribute('aria-label', 'Search shortcuts')
    search.setAttribute('placeholder', 'Search commands, shortcuts or keymaps…')
    search.value = query
    toolbar.append(search)
    root.append(toolbar)
    const scroll = document.createElement('au-scroll-area')
    scroll.setAttribute('axis', 'y')
    const content = el('div', 'au-kme-content')
    scroll.append(content)
    root.append(scroll)
    if (error) { const notice = el('div', 'au-kme-err', error); notice.setAttribute('role', 'alert'); content.append(notice) }
    if (status) { const notice = el('div', 'au-kme-status', status); notice.setAttribute('role', 'status'); content.append(notice) }
    const active = keymaps!.list()
    const activeSet = new Set(active)
    content.append(mkBtn('Add shortcut…', busy || !active.length, () => { adding = true; newIntent = ''; newMap = active[0] ?? ''; draft = []; render() }))
    if (adding) {
      const panel = el('au-card', 'au-kme-library au-kme-new')
      panel.setAttribute('variant', 'outline')
      panel.append(el('h2', '', 'Add shortcut'), el('p', '', 'Choose a command and a keymap, then click the field to record its shortcut. Unassigned means no binding in the active keymaps.'))
      const intentSelect = document.createElement('au-combobox') as HTMLElement & {options: {value:string;label:string}[]; value:string}
      intentSelect.setAttribute('label', 'Command'); intentSelect.setAttribute('placeholder', 'Find a command…')
      intentSelect.options = [...labels.entries()].map(([intent,label]) => ({value:intent, label: `${label}${files.some(file => activeSet.has(file.name) && file.keybinds.some(kb => bareTypeName(kb.intent) === bareTypeName(intent))) ? '' : ' · Unassigned'}`})).sort((a,b)=>a.label.localeCompare(b.label))
      intentSelect.value = newIntent
      const mapSelect = document.createElement('au-select') as HTMLElement & {options: {value:string;label:string}[]; value:string}
      mapSelect.setAttribute('label', 'Save in keymap'); mapSelect.options = active.map(name => ({value:name,label:name})); mapSelect.value = newMap
      const capture = document.createElement('au-chord-input') as HTMLElement & {chord:CanonicalKeystroke[]}
      capture.setAttribute('aria-label', 'Shortcut for new command'); capture.chord = draft
      const save = mkBtn('Add binding', true, () => { const km = fileByName(newMap); if(km && newIntent && draft.length) void persist(km, km.keybinds.length, draft, newIntent) })
      const update = () => save.toggleAttribute('disabled', busy || !newIntent || !fileByName(newMap) || !draft.length)
      intentSelect.addEventListener('au-change', () => {newIntent = intentSelect.value; update()})
      mapSelect.addEventListener('au-change', () => {newMap = mapSelect.value; update()})
      capture.addEventListener('au-chord-change', event => {draft = (event as CustomEvent<{chord:CanonicalKeystroke[]}>).detail.chord; update()})
      panel.append(intentSelect, mapSelect, capture, save, mkBtn('Cancel new shortcut', busy, () => {adding=false;render()}))
      content.append(panel)
    }

    content.append(el('h2', '', 'Active keymaps'), el('p', '', 'Focused-view bindings take priority. Use the arrows to change keymap order; save the composition to keep list changes.'))
    if (!active.length) content.append(el('div', 'au-kme-empty', 'No active keymaps. Add a keymap below to enable its shortcuts.'))
    const rows: {element: HTMLElement; text: string}[] = []
    for (const [pos, name] of active.entries()) {
      const km = fileByName(name)
      const section = el('section', 'au-kme-km')
      const head = el('div', 'au-kme-km__head')
      const title = el('span', 'au-kme-km__name', name)
      title.title = km?.path ? displayFilePath(km.path, host.workspace.members) : name
      head.append(title, el('span', 'au-kme-consumed', km && isConsumed(km) ? 'Shared · copies on edit' : 'Workspace file'))
      const actions = el('div', 'au-kme-km__actions')
      const up = mkBtn('↑', busy || pos === 0, () => keymaps!.reorder(move(active, pos, pos - 1)))
      up.setAttribute('aria-label', `Move ${name} up`)
      const down = mkBtn('↓', busy || pos === active.length - 1, () => keymaps!.reorder(move(active, pos, pos + 1)))
      down.setAttribute('aria-label', `Move ${name} down`)
      actions.append(up, down, mkBtn('Remove', busy, () => keymaps!.remove(name)))
      head.append(actions); section.append(head)
      if (!km) section.append(el('p', 'au-kme-err', 'This keymap could not be found. Restore its source or remove it from the active list.'))
      km?.keybinds.forEach((kb, i) => {
        const row = el('au-card', 'au-kme-bind')
        row.setAttribute('variant', 'outline')
        const label = cmdLabel(kb.intent)
        const cmd = el('div', 'au-kme-bind__cmd', label)
        cmd.title = kb.intent
        const scope = (kb.when ?? km.when)?.map(bareTypeName).join(', ') || 'All views'
        cmd.append(el('span', 'au-kme-bind__scope', scope))
        const chord = document.createElement('au-kbd'); chord.textContent = formatChord(kb.chord)
        const editKey = `${km.path}:${i}`
        const trigger = el('button', 'au-kme-bind__trigger') as HTMLButtonElement
        trigger.type = 'button'
        trigger.disabled = busy
        trigger.setAttribute('aria-expanded', String(editing === editKey))
        trigger.setAttribute('aria-label', `Change ${label}`)
        trigger.append(cmd, chord, el('span', 'au-kme-change', editing === editKey ? 'Editing' : 'Change'))
        const closeEditor = () => {
          const panel = row.querySelector<HTMLElement>('.au-kme-edit')
          if (!panel || matchMedia('(prefers-reduced-motion: reduce)').matches) { editing = null; render(); return }
          const motion = panel.animate([{height: `${panel.offsetHeight}px`, opacity: 1}, {height: '0px', opacity: 0}], {duration: parseFloat(getComputedStyle(root).getPropertyValue('--au-m-fast')) || 160, easing: 'ease-out'})
          motion.onfinish = () => { editing = null; render() }
        }
        trigger.addEventListener('click', () => {
          if (editing === editKey) { closeEditor(); return }
          editing = editKey; draft = kb.chord; render()
          root.querySelector<HTMLElement>('.au-kme-bind__trigger[aria-expanded="true"]')?.focus({preventScroll: true})
        })
        row.append(trigger)
        if (editing === editKey) {
          const editor = el('div', 'au-kme-edit')
          const recording = el('p', 'au-kme-recording', 'Click the field to record a shortcut')
          recording.setAttribute('role', 'status')
          editor.append(recording)
          const capture = document.createElement('au-chord-input') as HTMLElement & {chord: CanonicalKeystroke[]}
          capture.setAttribute('aria-label', `New shortcut for ${label}`)
          capture.setAttribute('placeholder', 'Record shortcut…')
          capture.chord = draft
          if (busy) capture.setAttribute('disabled', '')
          const review = el('p', 'au-kme-bind__scope')
          const updateReview = () => {
            const shared = files.filter(f => activeSet.has(f.name)).flatMap(f => f.keybinds.map((binding, index) => ({f, binding, index}))).filter(({f, binding, index}) => !(f.path === km.path && index === i) && formatChord(binding.chord) === formatChord(draft))
            review.textContent = shared.length ? `Also assigned to ${shared.map(({binding}) => cmdLabel(binding.intent)).join(', ')}. Scope and keymap order determine which binding runs.` : 'No identical shortcut in the active keymaps.'
          }
          capture.addEventListener('focus', () => { editor.dataset.recording = 'true'; recording.textContent = 'Recording — press your shortcut. Esc stops recording.' })
          capture.addEventListener('blur', () => { delete editor.dataset.recording; recording.textContent = 'Shortcut ready to review. Click the field to record again.' })
          capture.addEventListener('au-chord-change', event => {
            draft = (event as CustomEvent<{chord: CanonicalKeystroke[]}>).detail.chord
            save.toggleAttribute('disabled', busy || !draft.length)
            updateReview()
          })
          updateReview()
          const save = mkBtn('Save shortcut', busy || !draft.length, () => rebind(km, i, draft))
          save.setAttribute('variant', 'secondary')
          const buttons = el('div', 'au-kme-edit__actions')
          buttons.append(save, mkBtn('Cancel', busy, closeEditor))
          editor.append(capture, review, buttons)
          row.append(editor)
        }
        rows.push({element: row, text: `${label} ${kb.intent} ${scope} ${formatChord(kb.chord)} ${name}`.toLowerCase()})
        section.append(row)
      })
      content.append(section)
    }
    const noMatches = el('p', 'au-kme-empty', 'No shortcuts match that search.')
    content.append(noMatches)
    const filter = () => {
      const needle = query.trim().toLowerCase()
      for (const row of rows) row.element.hidden = !row.text.includes(needle)
      noMatches.hidden = !needle || rows.some(row => !row.element.hidden)
    }
    search.addEventListener('au-input', () => { query = search.value; filter() })
    filter()
    const available = files.filter(file => !activeSet.has(file.name))
    const library = el('au-card', 'au-kme-library')
    library.setAttribute('variant', 'outline')
    const libraryHead = el('div', 'au-kme-km__head')
    libraryHead.append(el('h2', 'au-kme-km__name', 'Add keymap'), mkBtn('Refresh', busy, () => void load().catch(() => { error = 'Could not refresh keymaps.'; render() })))
    const picker = document.createElement('input')
    picker.type = 'file'; picker.accept = '.yaml,.yml'; picker.hidden = true
    picker.setAttribute('aria-label', 'Choose keymap file')
    picker.addEventListener('change', () => { const file = picker.files?.[0]; if (file) void chooseImport(file) })
    libraryHead.append(mkBtn('Choose keymap file…', busy, () => picker.click()))
    library.append(picker)
    library.append(libraryHead, el('p', '', 'Add bindings from this workspace or its dependencies. Save the composition to keep your active list.'))
    if (pendingImport) {
      const preview = el('au-card', 'au-kme-import')
      preview.setAttribute('variant', 'outline')
      preview.append(el('strong', '', `${pendingImport.name} · ${pendingImport.count} shortcuts`), el('p', '', 'Copy into this workspace and activate it. The original stays unchanged; an existing file will not be replaced.'), mkBtn('Import and activate', busy, () => void importKeymap()), mkBtn('Cancel import', busy, () => { pendingImport = null; render() }))
      library.append(preview)
    }
    if (!available.length) library.append(el('p', 'au-kme-empty', 'All discovered keymaps are active. Add a keymap file to an editable workspace folder, then refresh.'))
    else {
      library.append(el('h2', '', 'Available keymaps'))
      const find = document.createElement('au-input') as HTMLElement & {value: string}
      find.setAttribute('aria-label', 'Find a keymap'); find.setAttribute('placeholder', 'Find a keymap…')
      library.append(find)
      const options: {node: HTMLElement; text: string}[] = []
      for (const file of available) {
        const row = el('div', 'au-kme-km__head')
        const label = el('span', 'au-kme-km__name', file.name); label.title = displayFilePath(file.path, host.workspace.members)
        const member = memberOf(file.path)
        const info = `${file.keybinds.length} shortcuts · ${member?.name ?? 'Workspace dependency'}`
        row.append(label, el('span', 'au-kme-consumed', info), mkBtn('Add', busy, () => keymaps!.add(file.name)))
        library.append(row)
        options.push({node: row, text: `${file.name} ${info}`.toLowerCase()})
      }
      const empty = el('p', 'au-kme-empty', 'No keymaps match that search.'); empty.hidden = true; library.append(empty)
      find.addEventListener('au-input', () => {
        for (const option of options) option.node.hidden = !option.text.includes(find.value.trim().toLowerCase())
        empty.hidden = options.some(option => !option.node.hidden)
      })
    }
    content.prepend(library)
    const timing = el('details', 'au-kme-timing')
    timing.append(el('summary', '', 'Key sequence timing'), el('p', '', 'How long a multi-key shortcut waits for its next key. Hover pauses the hints; 0 keeps them open.'))
    const controls = el('div', 'au-kme-timing__controls')
    const field = document.createElement('au-field'); field.setAttribute('label', 'Timeout (milliseconds)')
    const input = document.createElement('au-input') as HTMLElement & {value: string; inputType: string}
    input.setAttribute('aria-label', 'Key sequence timeout (milliseconds)'); input.inputType = 'number'; input.value = String(keymaps!.sequenceTimeout())
    field.append(input)
    controls.append(field, mkBtn('Apply timeout', busy, () => {
      const value = Number(input.value)
      if (!input.value.trim() || !Number.isFinite(value) || value < 0) { error = 'Enter a non-negative timeout in milliseconds.'; render(); return }
      error = null; status = 'Timing applied. Save the composition to keep it.'; keymaps!.setSequenceTimeout(value); render()
    }))
    timing.append(controls); content.append(timing)
    requestAnimationFrame(() => {
      const viewport = scroll.shadowRoot?.querySelector('.scroll')
      if (viewport) viewport.scrollTop = oldScroll
    })
  }

  function el(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag); node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function mkBtn(text: string, disabled: boolean, onClick: () => void): HTMLElement {
    const button = document.createElement('au-button')
    button.setAttribute('size', 'sm'); button.setAttribute('variant', 'ghost')
    button.textContent = text
    if (disabled) button.setAttribute('disabled', '')
    button.addEventListener('au-activate', onClick)
    return button
  }

  function move(list: readonly string[], from: number, to: number): string[] {
    const next = [...list]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    return next
  }

  const offKeymaps = keymaps.subscribe(render)
  const offReady = host.engineReady?.subscribe((ready) => {
    if (ready) void load()
  })
  void load()

  return () => {
    offKeymaps()
    offReady?.()
    disposeStyle?.()
  }
}

export default defineProjection<ProjectionModule>({ mount: keymapEditor })
