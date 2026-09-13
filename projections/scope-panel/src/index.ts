import { displayFilePath } from '@arsumbris/au-host-sdk'
import { lineKind, literalPatternText, pathPattern } from './patterns'
// scope-panel — a projection over each workspace member's FILE SCOPE.
//
// It reads the engine `ignores` surface (`readIgnores`) and re-scopes a member through the
// `set_ignores` mutation (`host.scope.setIgnores`). Per member it surfaces:
//   - patterns        — the `.auignore` lines. Editable as STRUCTURED RULES (removable rows) or,
//                       via an "Edit as text" toggle, as raw text. Comments/blanks are preserved.
//   - default_excludes — the seeded, overridable excludes (node_modules, target).
//   - floor           — the unconditional floor (.git,.arsumbris), read-only.
//   - resolved        — with resolve:true, the boundary-level effect (pruned dirs + excluded files);
//                       boundaries NOT contents. Doubles as the un-ignore surface.
//
// The `.auignore` grammar is full gitignore (au-parser's `ignore`-crate matcher), so the guided
// pickers emit real globs:
//   - ignore filetype → `*.ext`               (bare, matches at any depth)
//   - ignore folder   → `/relpath/`           (leading slash root-anchors the specific pick, trailing prunes)
//   - ignore file     → `/relpath`            (root-anchored)
//   - un-ignore       → `!/relpath[/]`        (best-effort; no-op if a parent dir is pruned)
//
// Configless: the type-def IS the projection. Plain DOM, no framework.

import { defineProjection, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk'
import type {
  HostApp,
} from '@arsumbris/au-host-app'
import { readDirEntries, readIgnores, type WireIgnoresMember, type WireDirEntry, subscribeTypes, subscribeFiles } from '@arsumbris/au-host-sdk/engine-reads'

// `engineReady` is a MountHost contract capability now (optional; inherited). `scope` stays app-owned.

// The raw-text editor is an `<au-textarea>` — a mono code well (ignore patterns), so `mono` + `size=sm`
// + `spellcheck=off`. Set-INDEPENDENT structural cast (only the property shape the contract guarantees):
// this vanilla projection reads `.value` after each `au-input`, so the bare shape suffices.
type AuTextareaEl = HTMLElement & { value: string; disabled: boolean }
const createAuTextarea = (): AuTextareaEl => {
  const el = document.createElement('au-textarea') as AuTextareaEl
  el.setAttribute('mono', '')
  el.setAttribute('size', 'sm')
  el.setAttribute('spellcheck', 'false')
  el.setAttribute('rows', '5') // the raw-text well's line count
  el.style.display = 'block'
  return el
}

// Set-independent structural casts for the vanilla projection creating <au-*> chrome. au-button /
// au-close-button / au-chevron emit `au-activate` (composed); au-input emits `au-input` / `au-change`.
type AuBtnEl = HTMLElement & { disabled: boolean }
type AuInputEl = HTMLElement & { value: string; disabled: boolean }
const auBtn = (label: string, opts?: { variant?: 'solid' | 'ghost' | 'outline' | 'cta'; size?: 'sm' | 'md' | 'lg' }): AuBtnEl => {
  const b = document.createElement('au-button') as AuBtnEl
  b.setAttribute('size', opts?.size ?? 'sm')
  b.setAttribute('variant', opts?.variant ?? 'ghost')
  b.textContent = label
  return b
}

import { CSS } from './styles'


type PickerKind = 'filetype' | 'folder' | 'file' | 'pattern'

function arrEq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
/** A short muted label for a pattern row, derived from its shape. */
function patternTag(p: string): string {
  const t = p
  if (t.startsWith('!')) return 'Include'
  if (t.endsWith('/')) return 'folder'
  if (/[*?[]/.test(t)) return 'glob'
  if (t.includes('/')) return 'path'
  return 'name'
}
/** The extension of a path's basename, or null (dotfiles / no-dot names have none). */
function extOf(path: string): string | null {
  const slash = path.lastIndexOf('/')
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null
  return base.slice(dot + 1)
}
/** `abs` made relative to member `root` (abs stays as-is if it is not under root). */
function relOf(root: string, abs: string): string {
  const prefix = root.endsWith('/') ? root : root + '/'
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const hx = host as HostApp
  const canWrite = typeof hx.scope?.setIgnores === 'function'
  let alive = true

  const root = document.createElement('div')
  root.className = 'au-scp'
  const content = document.createElement('div')
  content.className = 'au-scp-content'
  root.appendChild(content)
  const disposeStyles = host.styles?.inject(CSS, container)

  const top = document.createElement('div')
  top.className = 'au-scp-top'
  const title = document.createElement('h2')
  title.textContent = 'File scope'
  const activity = document.createElement('au-spinner')
  activity.setAttribute('size', 'sm')
  activity.setAttribute('label', 'Reading file scope')
  const refresh = auBtn('Refresh', { variant: 'outline' })
  refresh.addEventListener('au-activate', () => void reload())
  top.append(title, activity, refresh)
  content.append(top)
  const readStatus = document.createElement('div')
  readStatus.className = 'au-scp-status'
  readStatus.setAttribute('role', 'status')
  content.append(readStatus)
  const intro = document.createElement('div')
  intro.className = 'au-scp-intro'
  intro.textContent = 'Choose a member, edit its exclusion rules, then save to update which files enter the graph.'
  content.appendChild(intro)

  if (!canWrite) {
    const banner = document.createElement('div')
    banner.className = 'au-scp-banner'
    banner.textContent = 'File scope is read-only in this workspace.'
    content.appendChild(banner)
  }

  const search = document.createElement('au-input') as AuInputEl
  search.setAttribute('aria-label', 'Find workspace member')
  search.setAttribute('placeholder', 'Find a member or path…')
  const chooseMember = auBtn('Change member', { variant: 'outline' })
  chooseMember.className = 'au-scp-choose-member'
  chooseMember.setAttribute('aria-expanded', 'false')
  const setChoosing = (choosing: boolean): void => {
    root.classList.toggle('au-scp-choosing', choosing)
    chooseMember.setAttribute('aria-expanded', String(choosing))
    chooseMember.textContent = choosing ? 'Back to rules' : 'Change member'
  }
  chooseMember.addEventListener('au-activate', () => {
    const choosing = !root.classList.contains('au-scp-choosing')
    setChoosing(choosing)
    if (choosing) search.focus()
  })
  content.append(chooseMember)
  const layout = document.createElement('div')
  layout.className = 'au-scp-layout'
  const navigation = document.createElement('au-scroll-area')
  navigation.setAttribute('axis', 'y')
  navigation.className = 'au-scp-navigation'
  const list = document.createElement('div')
  navigation.append(list)
  const memberBrowser = document.createElement('div')
  memberBrowser.className = 'au-scp-member-browser'
  memberBrowser.append(search, navigation)
  const detail = document.createElement('au-scroll-area')
  detail.setAttribute('axis', 'y')
  detail.className = 'au-scp-detail'
  layout.append(memberBrowser, detail)
  content.append(layout)
  let members: WireIgnoresMember[] = []
  let selectedRoot: string | null = null
  let readGeneration = 0
  const saving = new Set<string>()
  const writeFailures = new Map<string, string>()
  let updateSelected: ((member: WireIgnoresMember) => void) | undefined
  search.addEventListener('au-input', () => renderNavigation())
  container.appendChild(root)

  // Drafts survive member navigation and saved-state refreshes.
  const edits = new Map<string, string[]>()

  // Panel-level `entry.files` catalog → the filetype picker's extension source. One subscription
  // for the whole pane; kept live via the change delta.
  const catalog = new Set<string>()
  let catalogReady = false
  let refreshCatalogPicker: (() => void) | undefined
  const offFiles = subscribeFiles(host.engine, (event) => {
    if (!alive) return
    if (event.kind === 'initial-value') {
      for (const f of event.result) catalog.add(f.path)
      catalogReady = true
    } else if (event.kind === 'change') {
      for (const p of event.scopeHint.added) catalog.add(p)
      for (const p of event.scopeHint.removed) catalog.delete(p)
    }
    refreshCatalogPicker?.()
  })
  function extHistogram(memberRoot: string): Array<{ ext: string; count: number }> {
    const prefix = memberRoot.endsWith('/') ? memberRoot : memberRoot + '/'
    const counts = new Map<string, number>()
    for (const path of catalog) {
      if (!path.startsWith(prefix)) continue
      const ext = extOf(path)
      if (ext) counts.set(ext, (counts.get(ext) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
  }

  function renderMember(m: WireIgnoresMember): HTMLElement {
    // Editable line list — seeded from an unsaved edit if present, else the server truth.
    let lines = edits.get(m.root)?.slice() ?? m.patterns.slice()
    let baseline = m.patterns
    let textMode = false
    let openPicker: PickerKind | null = null

    const wrap = document.createElement('div')
    wrap.className = 'au-scp-member'

    const head = document.createElement('div')
    head.className = 'au-scp-member-heading'
    const name = document.createElement('h3')
    name.textContent = m.repo
    head.append(name)
    const rootPath = document.createElement('span')
    rootPath.className = 'au-scp-root'
    rootPath.textContent = displayFilePath(m.root, host.workspace.members)
    rootPath.title = displayFilePath(m.root, host.workspace.members)
    head.appendChild(rootPath)
    const body = document.createElement('div')
    body.className = 'au-scp-body'

    // --- rules field: header + (structured | text) + toolbar + picker ---
    const rulesHead = document.createElement('div')
    rulesHead.className = 'au-scp-fieldhead'
    const rulesTitle = document.createElement('span')
    rulesTitle.textContent = '.auignore rules'
    const toggle = auBtn('Edit as text ▸', { variant: 'ghost', size: 'sm' })
    toggle.style.marginLeft = 'auto'
    toggle.addEventListener('au-activate', () => {
      textMode = !textMode
      toggle.textContent = textMode ? '◂ Structured' : 'Edit as text ▸'
      renderRules()
    })
    rulesHead.append(rulesTitle, toggle)

    const rulesBox = document.createElement('div')

    const status = document.createElement('span')
    status.setAttribute('role', 'status')
    status.className = 'au-scp-status'
    const setStatus = (msg: string, kind: '' | 'ok' | 'err' = ''): void => {
      status.textContent = msg
      status.className = `au-scp-status${kind ? ' ' + kind : ''}`
    }

    const discard = auBtn('Discard changes', { variant: 'ghost', size: 'sm' })
    const save = auBtn('Save', { variant: 'cta', size: 'sm' })
    const savingSpinner = document.createElement('au-spinner')
    savingSpinner.setAttribute('size', 'sm')
    savingSpinner.setAttribute('label', 'Saving exclusion rules')
    const dirty = (): boolean => !arrEq(lines, baseline)
    const refreshSave = (): void => {
      save.disabled = !canWrite || !dirty() || saving.has(m.root)
      discard.disabled = !dirty() || saving.has(m.root)
      savingSpinner.style.display = saving.has(m.root) ? '' : 'none'
      if (saving.has(m.root)) setStatus('Saving rules…')
      else if (writeFailures.has(m.root)) setStatus(writeFailures.get(m.root)!, 'err')
      else if (!dirty()) setStatus('')
      else setStatus('Unsaved changes')
    }

    // The one mutation entry point: update lines, sync the edits map, re-arm Save, optionally redraw.
    const setLines = (next: string[], rerender: boolean): void => {
      lines = next
      writeFailures.delete(m.root)
      if (arrEq(lines, baseline) && !saving.has(m.root)) edits.delete(m.root)
      else edits.set(m.root, lines.slice())
      refreshSave()
      renderNavigation()
      if (rerender) renderRules()
    }
    discard.addEventListener('au-activate', () => {
      if (saving.has(m.root)) return
      openPicker = null
      renderPicker()
      setLines(baseline.slice(), true)
    })
    const append = (line: string): void => {
      if (lines.includes(line)) {
        setStatus(`already present: ${line}`)
        return
      }
      openPicker = null
      renderPicker()
      setLines([...lines, line], true)
      setStatus(`Added ${line} · not saved yet`)
    }

    function appendLiteral(make: () => string): void {
      try { append(make()) } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create exclusion rule', 'err') }
    }

    function renderRules(): void {
      rulesBox.replaceChildren()
      if (textMode) {
        const ta = createAuTextarea()
        ta.setAttribute('aria-label', `${m.repo} .auignore rules`)
        ta.value = lines.join('\n')
        ta.disabled = !canWrite
        ta.setAttribute('placeholder', 'one pattern per line — empty reverts to the default excludes')
        // Text edits update the same lines WITHOUT a re-render (keeps the caret).
        ta.addEventListener('au-input', () => setLines(ta.value === '' ? [] : ta.value.split('\n'), false))
        rulesBox.appendChild(ta)
        return
      }
      const rules = document.createElement('div')
      rules.className = 'au-scp-rules'
      if (lines.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'au-scp-rules-empty'
        empty.textContent = 'no rules — only the default excludes apply'
        rules.appendChild(empty)
      }
      lines.forEach((line, i) => {
        const kind = lineKind(line)
        const row = document.createElement('div')
        row.className = `au-scp-rule ${kind}`
        const tag = document.createElement('span')
        tag.className = 'au-scp-rule-tag'
        const text = document.createElement('span')
        text.className = 'au-scp-rule-text'
        if (kind === 'pattern') {
          const t = patternTag(line)
          tag.textContent = t
          if (t === 'Include') tag.classList.add('neg')
          text.textContent = line
        } else if (kind === 'comment') {
          tag.textContent = ''
          text.textContent = line
        } else {
          tag.textContent = ''
          text.textContent = '(blank)'
        }
        row.append(tag, text)
        // Only pattern rows are removable in structured mode (comments/blanks preserved verbatim).
        if (canWrite && kind === 'pattern') {
          const x = document.createElement('au-close-button')
          x.setAttribute('label', `Remove rule ${line}`)
          x.title = 'remove'
          x.addEventListener('au-activate', () => setLines(lines.filter((_, j) => j !== i), true))
          row.appendChild(x)
        }
        rules.appendChild(row)
      })
      rulesBox.appendChild(rules)
    }

    // --- toolbar + inline picker (write mode only) ---
    const toolbar = document.createElement('div')
    toolbar.className = 'au-scp-toolbar'
    const picker = document.createElement('div')
    picker.style.display = 'none'

    function tbtn(label: string, kind: PickerKind): AuBtnEl {
      const b = auBtn(label, { variant: 'ghost', size: 'sm' })
      b.dataset.pickerKind = kind
      b.setAttribute('aria-expanded', 'false')
      b.addEventListener('au-activate', () => {
        openPicker = openPicker === kind ? null : kind
        // The open picker's button reads as pressed (outline); the rest recede to ghost.
        for (const child of toolbar.children) child.setAttribute('variant', child === b && openPicker === kind ? 'outline' : 'ghost')
        renderPicker()
      })
      return b
    }
    if (canWrite) {
      toolbar.append(
        tbtn('+ Filetype', 'filetype'),
        tbtn('+ Folder', 'folder'),
        tbtn('+ File', 'file'),
        tbtn('+ Pattern', 'pattern'),
      )
    }

    function renderPicker(): void {
      picker.replaceChildren()
      for (const child of toolbar.children) {
        const active = (child as HTMLElement).dataset.pickerKind === openPicker
        child.setAttribute('variant', active ? 'outline' : 'ghost')
        child.setAttribute('aria-expanded', String(active))
      }
      if (!openPicker) {
        picker.style.display = 'none'
        return
      }
      picker.style.display = ''
      picker.className = 'au-scp-picker'
      if (openPicker === 'filetype') renderFiletypePicker(picker)
      else if (openPicker === 'pattern') renderPatternInput(picker)
      else void renderTreeLevel(picker, m.root, 0)
    }

    refreshCatalogPicker = () => { if (openPicker === 'filetype' && picker.isConnected) renderPicker() }

    function renderFiletypePicker(host_: HTMLElement): void {
      if (!catalogReady) {
        host_.innerHTML = ''
        const p = document.createElement('div')
        p.className = 'au-scp-picker-empty'
        const spinner = document.createElement('au-spinner')
        spinner.setAttribute('size', 'sm')
        spinner.setAttribute('label', 'Reading file types')
        p.append(spinner, ' Reading file types…')
        host_.appendChild(p)
        return
      }
      const hist = extHistogram(m.root)
      if (hist.length === 0) {
        const p = document.createElement('div')
        p.className = 'au-scp-picker-empty'
        p.textContent = 'no file extensions in scope'
        host_.appendChild(p)
        return
      }
      for (const { ext, count } of hist) {
        const b = document.createElement('au-list-row')
        b.setAttribute('interactive', '')
        b.setAttribute('primary', `*.${ext}`)
        const c = document.createElement('span')
        c.className = 'au-scp-ext-count'
        c.slot = 'trailing'
        c.textContent = String(count)
        b.appendChild(c)
        b.addEventListener('click', () => appendLiteral(() => `*.${literalPatternText(ext)}`))
        host_.appendChild(b)
      }
    }

    function renderPatternInput(host_: HTMLElement): void {
      const wrapIn = document.createElement('div')
      wrapIn.className = 'au-scp-patin'
      const input = document.createElement('au-input') as AuInputEl
      input.setAttribute('size', 'sm')
      input.setAttribute('aria-label', 'Exclusion pattern')
      input.setAttribute('placeholder', 'a gitignore pattern, e.g. build/ or *.tmp')
      input.style.flex = '1'
      input.style.minWidth = '0'
      const add = auBtn('Add', { variant: 'ghost', size: 'sm' })
      const commit = (): void => {
        const v = input.value
        if (v.trim()) append(v)
      }
      add.addEventListener('au-activate', commit)
      input.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') commit()
      })
      wrapIn.append(input, add)
      host_.appendChild(wrapIn)
      input.focus()
    }

    // Lazy dir-tree over `readDirEntries` (post-filter: shows only IN-SCOPE entries). In 'file' mode
    // file leaves are pickable too; otherwise only directories are pickable.
    async function renderTreeLevel(into: HTMLElement, dir: string, depth: number): Promise<void> {
      const loading = document.createElement('div')
      loading.className = 'au-scp-picker-empty'
      const spinner = document.createElement('au-spinner')
      spinner.setAttribute('size', 'sm')
      spinner.setAttribute('label', 'Reading folder')
      loading.append(spinner, ' Reading folder…')
      loading.style.paddingLeft = `min(calc(${depth} * var(--au-space-3)), 25%)`
      into.appendChild(loading)
      let entries: WireDirEntry[]
      try {
        const result = await readDirEntries(host.engine, dir)
        if (!alive || !into.isConnected || !loading.isConnected) return
        if ('ok' in result) throw Error(result.error)
        if (!result.ready) throw Error('Folder is not ready')
        entries = [...result.result]
        loading.remove()
      } catch (error) {
        if (!alive || !loading.isConnected) return
        loading.replaceChildren(document.createTextNode(error instanceof Error ? error.message : 'Could not read folder'))
        const retry = auBtn('Retry')
        retry.addEventListener('au-activate', () => { loading.remove(); void renderTreeLevel(into, dir, depth) })
        loading.append(retry)
        return
      }
      if (!entries.length) {
        const empty = document.createElement('p')
        empty.className = 'au-scp-picker-empty'
        empty.textContent = 'No indexed entries in this folder'
        into.append(empty)
      }
      entries.sort(
        (a, b) => (a.kind === 'directory' ? 0 : 1) - (b.kind === 'directory' ? 0 : 1) || a.name.localeCompare(b.name),
      )
      const pickFiles = openPicker === 'file'
      for (const entry of entries) {
        const isDir = entry.kind === 'directory'
        const row = document.createElement('div')
        row.className = 'au-scp-tree-row'
        row.style.paddingLeft = `min(calc(${depth} * var(--au-space-3)), 25%)`
        // Directories get an au-chevron disclosure; files a same-width spacer so names align.
        const caretBtn = isDir ? document.createElement('au-chevron') : document.createElement('span')
        if (isDir) caretBtn.setAttribute('label', `expand ${entry.name}`)
        else caretBtn.className = 'au-scp-tree-caret'
        const nm = document.createElement('span')
        nm.className = `au-scp-tree-name ${isDir ? 'dir' : 'file'}`
        nm.textContent = entry.name
        row.append(caretBtn, nm)
        const rel = relOf(m.root, entry.path)
        if (isDir || pickFiles) {
          const pick = auBtn('ignore', { variant: 'ghost', size: 'sm' })
          pick.addEventListener('au-activate', () => appendLiteral(() => pathPattern(rel, isDir)))
          row.appendChild(pick)
        }
        into.appendChild(row)
        if (isDir) {
          const childBox = document.createElement('div')
          into.appendChild(childBox)
          let loaded = false
          let open = false
          caretBtn.addEventListener('au-activate', () => {
            open = !open
            caretBtn.toggleAttribute('open', open)
            caretBtn.setAttribute('label', `${open ? 'collapse' : 'expand'} ${entry.name}`)
            childBox.style.display = open ? '' : 'none'
            if (open && !loaded) {
              loaded = true
              void renderTreeLevel(childBox, entry.path, depth + 1)
            }
          })
          childBox.style.display = 'none'
        }
      }
    }

    body.append(rulesHead, rulesBox, toolbar, picker)

    // --- default excludes (overridable) ---
    const defHead = document.createElement('div')
    defHead.className = 'au-scp-fieldhead'
    defHead.textContent = 'default excludes'
    const defChips = document.createElement('div')
    defChips.className = 'au-scp-chips'
    for (const d of m.default_excludes) {
      const c = document.createElement('au-tag')
      c.textContent = d
      defChips.appendChild(c)
    }
    const defHint = document.createElement('div')
    defHint.className = 'au-scp-hint'
    defHint.textContent = 'seeded; re-include one with a !negation rule, or narrow it with your own patterns.'

    // --- floor (read-only) ---
    const floorHead = document.createElement('div')
    floorHead.className = 'au-scp-fieldhead'
    floorHead.textContent = 'floor (always excluded)'
    const floorChips = document.createElement('div')
    floorChips.className = 'au-scp-chips'
    for (const f of m.floor) {
      const c = document.createElement('au-tag')
      c.setAttribute('muted', '')
      c.textContent = f
      floorChips.appendChild(c)
    }

    // --- actions ---
    const actions = document.createElement('div')
    actions.className = 'au-scp-actions'
    save.addEventListener('au-activate', async () => {
      if (!canWrite || !dirty() || saving.has(m.root)) return
      const submitted = lines.slice()
      saving.add(m.root)
      writeFailures.delete(m.root)
      refreshSave()
      try {
        const result = await hx.scope!.setIgnores(m.root, submitted)
        if (!alive) return
        if (!result.ok) throw Error(result.error ?? 'Could not save rules')
        // Another render/edit may have occurred while this write was pending.
        const latest = edits.get(m.root) ?? members.find(member => member.root === m.root)?.patterns ?? baseline
        if (arrEq(latest, submitted)) edits.delete(m.root)
        else edits.set(m.root, latest.slice())
        saving.delete(m.root)
        await reload()
      } catch (error) {
        if (alive) {
          saving.delete(m.root)
          writeFailures.set(m.root, error instanceof Error ? error.message : 'Could not save rules')
          const selected = members.find(member => member.root === selectedRoot)
          if (selected?.root === m.root) updateSelected?.(selected)
        }
      } finally {
        saving.delete(m.root)
        if (alive) save.disabled = !canWrite || !dirty()
      }
    })
    actions.append(savingSpinner)
    if (canWrite) actions.append(save, discard, status)
    else actions.append(status)

    body.appendChild(actions)
    body.append(defHead, defChips, defHint, floorHead, floorChips)

    // --- resolved boundary preview + un-ignore ---
    const effect = document.createElement('div')
    effect.className = 'au-scp-effect'
    body.append(effect)
    function renderEffect(resolved: NonNullable<WireIgnoresMember['resolved']>): void {
      effect.replaceChildren()
      const dirs = resolved.ignored_dirs
      const filesN = resolved.ignored_files
      const resHead = document.createElement('div')
      resHead.className = 'au-scp-fieldhead'
      resHead.textContent = `Saved exclusions (${dirs.length} dir${dirs.length === 1 ? '' : 's'}, ${filesN.length} file${filesN.length === 1 ? '' : 's'})`
      const res = document.createElement('div')
      res.className = 'au-scp-resolved'
      const dirSet = dirs
      const parentPruned = (abs: string): boolean => dirSet.some((d) => d !== abs && abs.startsWith(d.endsWith('/') ? d : d + '/'))
      if (dirs.length === 0 && filesN.length === 0) {
        const none = document.createElement('div')
        none.className = 'au-scp-res-none'
        none.textContent = 'nothing pruned'
        res.appendChild(none)
      } else {
        for (const abs of dirs) res.appendChild(resRow('dir', abs, true, parentPruned(abs)))
        for (const abs of filesN) res.appendChild(resRow('file', abs, false, parentPruned(abs)))
      }
      effect.append(resHead, res)
    }
    let effectGeneration = 0
    async function readEffect(): Promise<void> {
      const generation = ++effectGeneration
      const spinner = document.createElement('au-spinner')
      spinner.setAttribute('size', 'sm')
      spinner.setAttribute('label', 'Reading saved exclusions')
      effect.replaceChildren(spinner, document.createTextNode(' Reading saved exclusions…'))
      try {
        const result = await readIgnores(host.engine, { repo: m.repo, resolve: true })
        if (!alive || !wrap.isConnected || generation !== effectGeneration) return
        if ('ok' in result) throw Error(result.error)
        if (!result.ready) throw Error('Saved exclusions are not ready')
        const resolved = result.result.find(member => member.root === m.root)?.resolved
        if (!resolved) throw Error('Saved exclusions are unavailable')
        m.resolved = resolved
        renderEffect(resolved)
      } catch (error) {
        if (!alive || !wrap.isConnected || generation !== effectGeneration) return
        const retry = auBtn('Retry exclusions')
        retry.addEventListener('au-activate', () => void readEffect())
        effect.replaceChildren(document.createTextNode(error instanceof Error ? error.message : 'Could not read saved exclusions'), retry)
      }
    }
    if (m.resolved) renderEffect(m.resolved)
    else void readEffect()

    function resRow(tag: string, abs: string, isDir: boolean, parentPruned: boolean): HTMLElement {
      const rel = relOf(m.root, abs)
      const row = document.createElement('div')
      row.className = 'au-scp-res-row'
      const t = document.createElement('span')
      t.className = 'au-scp-res-tag'
      t.textContent = tag
      const p = document.createElement('span')
      p.className = 'au-scp-res-path'
      p.textContent = rel
      p.title = abs
      row.append(t, p)
      if (canWrite) {
        const un = auBtn('un-ignore', { variant: 'ghost', size: 'sm' })
        if (parentPruned) {
          un.disabled = true
          un.title = 'a parent directory is pruned — gitignore cannot re-include inside it'
        } else {
          un.addEventListener('au-activate', () => appendLiteral(() => pathPattern(rel, isDir, true)))
        }
        row.appendChild(un)
      }
      return row
    }

    wrap.append(head, body)

    // initial paint of the mutable regions
    renderRules()
    renderPicker()
    refreshSave()

    // Saved-state refreshes reconcile the current editor in place. Replacing it would discard
    // a not-yet-added pattern, raw mode, directory disclosures, focus and scroll position.
    updateSelected = (next) => {
      m = next
      baseline = next.patterns
      const nextLines = edits.get(next.root)?.slice() ?? baseline.slice()
      if (!arrEq(lines, nextLines)) {
        lines = nextLines
        renderRules()
      }
      name.textContent = next.repo
      defChips.replaceChildren(...next.default_excludes.map(value => {
        const tag = document.createElement('au-tag'); tag.textContent = value; return tag
      }))
      floorChips.replaceChildren(...next.floor.map(value => {
        const tag = document.createElement('au-tag'); tag.setAttribute('muted', ''); tag.textContent = value; return tag
      }))
      refreshSave()
      if (next.resolved) { ++effectGeneration; renderEffect(next.resolved) }
      else void readEffect()
    }

    return wrap
  }

  function renderNavigation(): void {
    list.replaceChildren()
    const query = search.value?.trim().toLowerCase() ?? ''
    const shown = members.filter(m => `${m.repo} ${m.root}`.toLowerCase().includes(query))
    for (const m of shown) {
      const row = document.createElement('au-list-row')
      row.setAttribute('interactive', '')
      row.setAttribute('primary', m.repo)
      row.setAttribute('secondary', `${m.patterns.filter(p => lineKind(p) === 'pattern').length} rules${edits.has(m.root) ? ' · Unsaved' : ''}`)
      row.toggleAttribute('selected', selectedRoot === m.root)
      row.title = displayFilePath(m.root, host.workspace.members)
      row.addEventListener('click', () => {
        selectedRoot = m.root
        renderNavigation()
        detail.replaceChildren(renderMember(m))
        setChoosing(false)
        if (getComputedStyle(chooseMember).display !== 'none') chooseMember.focus()
      })
      list.append(row)
    }
    if (!shown.length) {
      const empty = document.createElement('p')
      empty.className = 'au-scp-empty'
      empty.textContent = members.length ? 'No matching members' : 'No workspace members'
      list.append(empty)
    }
  }

  function renderMembers(next: WireIgnoresMember[]): void {
    const previousRoot = selectedRoot
    members = next
    if (!members.some(m => m.root === selectedRoot)) selectedRoot = members[0]?.root ?? null
    renderNavigation()
    const selected = members.find(m => m.root === selectedRoot)
    chooseMember.disabled = !selected
    if (selected && selectedRoot === previousRoot && updateSelected) updateSelected(selected)
    else {
      updateSelected = undefined
      if (selected) detail.replaceChildren(renderMember(selected))
      else {
        const empty = document.createElement('au-empty-state')
        empty.setAttribute('label', 'No member to edit')
        empty.setAttribute('hint', 'This workspace has no members. Refresh after adding one to the workspace.')
        detail.replaceChildren(empty)
        setChoosing(false)
      }
    }
  }

  async function reload(): Promise<void> {
    const generation = ++readGeneration
    activity.hidden = false
    refresh.disabled = true
    readStatus.textContent = members.length ? 'Refreshing saved scope…' : 'Reading workspace members…'
    try {
      const result = await readIgnores(host.engine, { resolve: false })
      if (!alive || generation !== readGeneration) return
      if ('ok' in result) throw Error(result.error)
      if (!result.ready) throw Error('Engine is not ready. Refresh to retry.')
      renderMembers(result.result)
      readStatus.textContent = `${members.length} workspace members · exclusions reflect saved rules`
      readStatus.className = 'au-scp-status'
    } catch (error) {
      if (!alive || generation !== readGeneration) return
      readStatus.textContent = error instanceof Error ? error.message : 'Could not read file scope. Refresh to retry.'
      readStatus.className = 'au-scp-status err'
    } finally {
      if (alive && generation === readGeneration) {
        activity.hidden = true
        refresh.disabled = false
      }
    }
  }

  void reload()

  // Scope changes force an engine rebuild + a type-graph bump — re-read on that (debounced) and on
  // the daemon-ready edge. Unsaved edits survive via the `edits` map (re-seeded per card).
  let timer: ReturnType<typeof setTimeout> | undefined
  const scheduleReload = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => alive && void reload(), 200)
  }
  const offTypeGraph = subscribeTypes(host.engine, (event) => {
    if (alive && event.kind === 'change') scheduleReload()
  })
  const offReady = hx.engineReady?.subscribe((ready) => {
    if (ready && alive) void reload()
  })

  return () => {
    disposeStyles?.()
    alive = false
    clearTimeout(timer)
    offTypeGraph()
    offFiles()
    offReady?.()
    container.removeChild(root)
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
