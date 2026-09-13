import { displayFilePath } from '@arsumbris/au-host-sdk'
import { parseRepoConfiguration } from './repository-config'
// Workspace-panel projection: membership, dependency health and resolution controls.
// - the members (name, four-way role, editable/local flags, scattered flag, absolute root).
// Plain DOM, no framework — matches the other list projections. the type-def IS
// the projection; this view is configless (it reads the live workspace, nothing to persist).

import { defineProjection, isAuthoringMember, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk'
import type { HostApp } from '@arsumbris/au-host-app'
import { readDiagnostics, readInstancesOf, readMembers, type WireDiagnostic, type WireMember, subscribeDiagnostics, subscribeTypes } from '@arsumbris/au-host-sdk/engine-reads'

// Workspace members carry an explicit role and a cached marker. The display uses
// these independent fields to describe authoring, consumed, and cached membership.
type Member = WireMember

// Vanilla-created `<au-*>` chrome, typed STRUCTURALLY (set-independent). au-button/au-close-button emit
// `au-activate` (composed); au-input emits `au-input`/`au-change`; au-segmented-control emits `au-change`.
type AuBtnEl = HTMLElement & { disabled: boolean }
type AuInputEl = HTMLElement & { value: string; disabled: boolean }
type AuSegEl = HTMLElement & { items: { value: string; label: string; icon?: string }[]; value: string }
const auBtn = (label: string, opts?: { variant?: string; size?: string }): AuBtnEl => {
  const el = document.createElement('au-button') as AuBtnEl
  el.setAttribute('size', opts?.size ?? 'sm')
  if (opts?.variant) el.setAttribute('variant', opts.variant)
  el.textContent = label
  return el
}
/** A small tone chip (label + variant), for a static status/role tag. A `title` gives a plain-language
 *  tooltip explaining the tag to a newcomer — AuElement surfaces the native `title` across the shadow
 *  boundary (the `<au-tooltip>` band), so the tag itself is the hover target, no wrapper. */
const auChip = (label: string, variant?: 'neutral' | 'accent' | 'danger', title?: string): HTMLElement => {
  const chip = document.createElement('au-chip')
  chip.setAttribute('label', label)
  if (variant && variant !== 'neutral') chip.setAttribute('variant', variant)
  if (title) chip.title = title
  return chip
}

// Plain-language tooltips for the member tags — one short sentence each, for a first-time reader.
const ROLE_TITLE: Record<string, string> = {
  entry: 'the workspace entry — the folder you opened; live and editable',
  edit: 'an editable authoring member — mounted live at HEAD; you author it here',
  discover: 'mounted so its types are discovered — pinned and read-only',
  dep: 'a declared type-dependency — its vocabulary is available here, read-only',
}
const roleTitle = (role: string): string => ROLE_TITLE[role] ?? 'a workspace member'
const CACHED_TITLE = 'served read-only from the package cache, not a live working tree'
const SCATTERED_TITLE = 'its folder is outside the workspace root (addressed by an absolute path)'


// Workspace/member-scope diagnostic codes (the topology health, not per-file type errors).
// A declared-but-missing peer/dependency, a member root that didn't mount, a duplicate name, etc.
const WORKSPACE_CODES = new Set([
  'workspace-member-unmounted',
  'undeclared-peer',
  'type-repo-not-a-dependency',
  'peer-out-of-scope',
  'type-repo-unavailable',
  'peer-type-not-found',
  'duplicate-repo-name',
])

// Peer/dependency-health diagnostic codes: a member's cross-repo dependency declarations vs what it
// actually references. Grouped PER MEMBER in the Dependencies section (the engine derives the gap; the
// host surfaces it). `undeclared-peer` = borrows without declaring; `peer-unmounted` = declared but no
// local path; the `type-repo-*` / `peer-type-not-found` family = an unresolved `::repo` reference.
const DEP_CODES = new Set([
  'undeclared-peer',
  'type-repo-not-a-dependency',
  'peer-unmounted',
  'peer-out-of-scope',
  'peer-path-collision',
  'type-repo-unavailable',
  'type-repo-unknown',
  'peer-type-not-found',
])

/** The first single-quoted token in a diagnostic message/fix — the peer name it concerns. */
function quotedName(s: string): string | null {
  const m = s.match(/'([^']+)'/)
  return m ? m[1] : null
}


const STYLE = `
.au-wsp { box-sizing:border-box; min-width:0; min-height:0; font:var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); height:100%; width:100%; container:workspace-panel / inline-size; }
.au-wsp-content { box-sizing:border-box; width:min(100%, 760px); margin-inline:auto; display:flex; flex-direction:column; gap:var(--au-space-6); padding:var(--au-space-5) clamp(var(--au-space-4), 4cqi, var(--au-space-7)); }
.au-wsp-section { flex: none; min-width: 0; }
/* Section heads are <au-section-header>, the filter is <au-segmented-control>, the role tags/status are
   <au-chip>, controls are <au-button>/<au-input>/<au-close-button> — each owns its own chrome, so this
   sheet owns layout and the diagnostics, dependency-block and file-viewer surfaces. */
.au-wsp-section-body { display:flex; flex-direction:column; gap:var(--au-space-2); padding-inline-start:0; }
.au-wsp-section > au-section-header::part(header) { padding-inline:0; }
.au-wsp-section-body .au-wsp-section { margin-top:var(--au-space-2); }
.au-wsp-description { margin:0; padding:var(--au-space-1) 0 var(--au-space-2); color:var(--au-ink-3); font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.au-wsp-role-filter { display:none; }
.au-wsp-mounted { display:inline-flex; align-items:center; gap:var(--au-space-2); color:var(--au-ink-3); }
.au-wsp-filter { margin-bottom: var(--au-space-1-5); }
.au-wsp-members { display: flex; flex-direction: column; gap: var(--au-space-0-5); }
.au-wsp-member { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:center; gap:var(--au-space-3); padding:var(--au-space-3) 0; border-bottom:1px solid var(--au-line-1); }
.au-wsp-identity { display:flex; min-width:0; flex-direction:column; gap:var(--au-space-1); }
.au-wsp-member-meta { color:var(--au-ink-3); font-size:var(--au-t-xs); line-height:var(--au-lh-xs); }
.au-wsp-member:hover { background: var(--au-chrome-hover); }
/* A disabled member (declared but not mounted): grey everything except its action toggles. */
.au-wsp-member.disabled > *:not(.au-wsp-acts) { opacity: var(--au-opacity-disabled); }
.au-wsp-name { min-width: 0; overflow-wrap: anywhere; font-weight: var(--au-w-strong); color: var(--au-ink-1); }
.au-wsp-root { min-width:0; font:var(--au-t-xs)/var(--au-lh-xs) var(--au-font-mono); color:var(--au-ink-3); overflow-wrap:anywhere; }
.au-wsp-empty { color: var(--au-ink-3); font-style: italic; }
.au-wsp-acts { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:var(--au-space-2); }
.au-wsp-readme { margin: calc(var(--au-space-1) * -1) 0 var(--au-space-1) var(--au-space-3); border-left: 2px solid var(--au-line-2); }
.au-wsp-readme-body { max-height: 320px; }
.au-wsp-readme-pre { margin: 0; padding: var(--au-space-2) var(--au-space-2-5); white-space: pre-wrap; word-break: break-word; font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono); color: var(--au-ink-2); }
.au-wsp-readme-loading { padding: var(--au-space-2) var(--au-space-2-5); color: var(--au-ink-3); font-style: italic; }
.au-wsp-addbtn { align-self: flex-start; margin-top: var(--au-space-1-5); }
.au-wsp-addform { display: flex; flex-direction: column; gap: var(--au-space-1-5); margin-top: var(--au-space-1-5); padding: var(--au-space-2); border: 1px solid var(--au-line-2); border-radius: var(--au-radius-sm); }
.au-wsp-addrow { flex-wrap: wrap; display: flex; align-items: center; gap: var(--au-space-1-5); }
.au-wsp-addrow label { color: var(--au-ink-3); flex: 0 0 auto; width: 48px; }
.au-wsp-input { flex: 1; min-width: 0; }
.au-wsp-role { max-width: 100%; }
.au-wsp-addrow--role .au-wsp-path { font-family:var(--au-font-sans); font-size:var(--au-t-xs); line-height:var(--au-lh-base); flex-basis: 100%; white-space: normal; overflow-wrap: anywhere; direction: ltr; }
.au-wsp-pick { flex: 0 0 auto; }
.au-wsp-path { flex: 1; min-width: 0; font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono); color: var(--au-ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; }
.au-wsp-actions { display: flex; gap: var(--au-space-1-5); justify-content: flex-end; }
.au-wsp-err { color: var(--au-color-danger); font-size: var(--au-t-2xs); }
.au-wsp-diags { display: flex; flex-direction: column; gap: var(--au-space-1); }
.au-wsp-diag { flex-wrap: wrap; display: flex; align-items: baseline; gap: var(--au-space-2); padding: var(--au-space-1) var(--au-space-1-5); border-radius: var(--au-radius-sm); background:transparent; }
.au-wsp-diag + .au-wsp-diag { border-top:1px solid var(--au-line-1); }
.au-wsp-sev { font-size: var(--au-t-2xs); text-transform: uppercase; font-weight: var(--au-w-strong); letter-spacing: var(--au-ls-label); flex: 0 0 auto; }
.au-wsp-diag.severity-error .au-wsp-sev { color: var(--au-color-danger); }
.au-wsp-diag.severity-warning .au-wsp-sev { color: var(--au-color-warn); }
.au-wsp-code { font: var(--au-t-2xs) var(--au-font-mono); color: var(--au-ink-3); overflow-wrap:anywhere; min-width:0; }
.au-wsp-dmsg { overflow-wrap: anywhere; flex: 1; min-width: 0; color: var(--au-ink-1); }
.au-wsp-ok { display:flex; align-items:center; gap:var(--au-space-2); color:var(--au-ink-3); padding-block:var(--au-space-2); }
.au-wsp-ok au-icon { color:var(--au-color-ok); }
.au-wsp-files { display: flex; flex-direction: column; gap: var(--au-space-0-5); }
.au-wsp-file-head { display: flex; align-items: center; gap: var(--au-space-1-5); width: 100%; text-align: left; background: none; border: none; color: inherit; font: inherit; padding: var(--au-space-1) var(--au-space-1-5); cursor: pointer; border-radius: var(--au-radius-sm); }
.au-wsp-file-head:hover { background: var(--au-chrome-hover); }
.au-wsp-caret { color: var(--au-ink-3); width: 10px; flex: 0 0 auto; }
.au-wsp-file-name { min-width: 0; overflow-wrap: anywhere; color: var(--au-ink-1); font: var(--au-t-xs) var(--au-font-mono); }
.au-wsp-file-note { font-size: var(--au-t-2xs); color: var(--au-color-warn); border: 1px solid color-mix(in srgb, var(--au-color-warn) 40%, transparent); border-radius: var(--au-radius-pill); padding: 0 var(--au-space-1-5); }
.au-wsp-file-body { margin: 0 0 var(--au-space-1) var(--au-tree-indent); padding: var(--au-space-2); max-height: 320px; overflow: auto; background: var(--au-elev-1-fill); border: 1px solid var(--au-line-2); border-radius: var(--au-radius-sm); font: var(--au-t-2xs) var(--au-font-mono); color: var(--au-ink-3); white-space: pre-wrap; word-break: break-word; }
.au-wsp-deps { display: flex; flex-direction: column; gap: var(--au-space-1); }
.au-wsp-dep { display: flex; flex-direction: column; gap: var(--au-space-1); padding:var(--au-space-3) 0; }
.au-wsp-dep + .au-wsp-dep { border-top:1px solid var(--au-line-1); }
.au-wsp-dep-head > au-button { margin-left:auto; }
.au-wsp-dep-head { flex-wrap: wrap; display: flex; align-items: center; gap: var(--au-space-2); }
.au-wsp-dep-peers { display:flex; flex-wrap:wrap; column-gap:var(--au-space-2); row-gap:var(--au-space-1); color:var(--au-ink-3); font-size:var(--au-t-xs); }
.au-wsp-peer { overflow-wrap:anywhere; min-width:0; }
.au-wsp-peer:not(:last-child)::after { content:","; }
.au-wsp-declareall { align-self: flex-start; }
.au-wsp-dep-fix { font-size: var(--au-t-2xs); color: var(--au-ink-3); padding-left:0; }
.au-wsp-dep-none { font-size: var(--au-t-2xs); color: var(--au-ink-3); font-style: italic; }
@container workspace-panel (max-width: 680px) {
  .au-wsp-member { grid-template-columns:minmax(0,1fr); gap:var(--au-space-2); }
  .au-wsp-acts { justify-self:start; justify-content:flex-start; }

}
@container workspace-panel (max-width: 440px) {
  .au-wsp-filter { display:none; }
  .au-wsp-role-filter { display:block; }
}
`

// A collapsible section: an <au-section-header collapsible> (owns its chevron + the au-toggle) titling
// a body. Starts open. The header's `count` attribute carries the right-aligned tally.
function createSection(label: string, initiallyOpen = true): { el: HTMLDivElement; setCount: (c: string) => void; body: HTMLDivElement } {
  const el = document.createElement('div')
  el.className = 'au-wsp-section'
  const head = document.createElement('au-section-header')
  head.setAttribute('collapsible', '')
  head.toggleAttribute('open', initiallyOpen)
  head.setAttribute('sans', '')
  head.setAttribute('chevron-end', '')
  head.textContent = label // the default slot IS the label
  const body = document.createElement('div')
  body.className = 'au-wsp-section-body'
  body.style.display = initiallyOpen ? '' : 'none'
  // The header emits a toggle notification; its consumer owns the open state.
  head.addEventListener('au-toggle', (event) => {
    event.stopPropagation()
    const open = !head.hasAttribute('open')
    head.toggleAttribute('open', open)
    body.style.display = open ? '' : 'none'
  })
  el.append(head, body)
  return { el, setCount: (c) => head.setAttribute('count', c), body }
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const root = document.createElement('au-scroll-area')
  root.className = 'au-wsp'
  root.setAttribute('axis', 'y')
  const disposeStyles = host.styles?.inject(STYLE, container)

  // Members section (collapsible) with a role filter (projects always sort first).
  const membersSection = createSection('Members')
  const setMembersCount = membersSection.setCount
  const memFilter = document.createElement('au-segmented-control') as AuSegEl
  memFilter.className = 'au-wsp-filter'
  memFilter.setAttribute('label', 'Filter workspace members')
  memFilter.items = [
    { value: 'all', label: 'All' },
    { value: 'projects', label: 'Editable' },
    { value: 'discover', label: 'Discovered' },
    { value: 'deps', label: 'Dependencies' },
  ]
  memFilter.value = 'all'
  const memberRole = document.createElement('au-select') as HTMLElement & {value:string; options:{value:string;label:string}[]}
  memberRole.className = 'au-wsp-role-filter'
  memberRole.setAttribute('label', 'Filter members by role')
  memberRole.options = memFilter.items
  memberRole.value = 'all'
  const memberNotice = document.createElement('p')
  memberNotice.className = 'au-wsp-description'
  memberNotice.setAttribute('role', 'status')
  memberNotice.textContent = 'Loading workspace members…'
  const membersList = document.createElement('div')
  membersList.className = 'au-wsp-members'
  const memberSearch = document.createElement('au-input') as AuInputEl
  memberSearch.setAttribute('label', 'Find a workspace member')
  memberSearch.setAttribute('placeholder', 'Find a repository or path…')
  memberSearch.addEventListener('au-input', () => renderMembers(allMembers))
  membersSection.body.append(memberSearch, memFilter, memberRole, memberNotice, membersList)

  // Dependencies (peer-health) section: per member, its declared cross-repo peers + resolution state,
  // and the engine's peer-gap diagnostics with fix hints. Collapsible.
  const depSection = createSection('Dependency health')
  const setDepCount = depSection.setCount
  const depList = document.createElement('div')
  depList.className = 'au-wsp-deps'
  depSection.body.appendChild(depList)

  // Diagnostics section (workspace/member-scope only), collapsible.
  const diagSection = createSection('Workspace issues')
  const setDiagCount = diagSection.setCount
  const diagList = document.createElement('div')
  diagList.className = 'au-wsp-diags'
  diagSection.body.appendChild(diagList)

  // Resolution files section (read-only), collapsible.
  const filesSection = createSection('Resolution files', false)
  const filesList = document.createElement('div')
  filesList.className = 'au-wsp-files'
  filesSection.body.appendChild(filesList)

  const content = document.createElement('div')
  content.className = 'au-wsp-content'
  content.append(membersSection.el, depSection.el, diagSection.el, filesSection.el)
  root.append(content)
  container.appendChild(root)

  let alive = true
  const disclosureState = new Map<string, boolean>()
  function rememberedSection(key: string, label: string, initiallyOpen: boolean) {
    const section = createSection(label, disclosureState.get(key) ?? initiallyOpen)
    const heading = section.el.querySelector('au-section-header')!
    heading.addEventListener('au-toggle', () => disclosureState.set(key, heading.hasAttribute('open')))
    return section
  }
  const files = host.files
  const wsRoot = host.entry.path
  const wsEdit = (host as HostApp).workspaceEdit // host-local capability; absent on older hosts

  // Remove a member (workspace.yaml only). window.confirm warns; the live Workspace-issues section
  // surfaces any breakage after. The type-graph subscription refreshes the list.
  async function removeMember(name: string): Promise<void> {
    if (!wsEdit) return
    const ok = window.confirm(
      `Remove "${name}" from the workspace?\n\nThis un-declares it from this workspace's .arsumbris/workspace.yaml. The repo itself is untouched, and its device location entry stays (it is shared across workspaces). Members that reference its types may break — watch the Workspace issues below.`,
    )
    if (!ok) return
    const res = await wsEdit.removeMember(wsRoot, name)
    if (!res.ok) window.alert(`Could not remove ${name}: ${res.error ?? 'unknown error'}`)
  }

  // Move a member between edit: and discover: (change its role). Only the two list-roles are movable —
  // the entry repo is pinned to edit: and a dep lives in its own repo.yaml. The type-graph sub refreshes.
  async function moveMemberRole(m: Member): Promise<void> {
    if (!wsEdit) return
    const target = m.role === 'edit' ? 'discover' : 'edit'
    const res = await wsEdit.setMemberRole(wsRoot, m.repo, target)
    if (!res.ok) window.alert(`Could not move ${m.repo} to ${target}: ${res.error ?? 'unknown error'}`)
  }

  // Enable / disable a declared member (the engine `disabled:` overlay — the member stays declared but
  // mounts nothing while disabled). The type-graph sub refreshes the list + the greyed state.
  async function setMemberDisabled(m: Member, disabled: boolean): Promise<void> {
    if (!wsEdit) return
    const res = await wsEdit.setMemberDisabled(wsRoot, m.repo, disabled)
    if (!res.ok) window.alert(`Could not ${disabled ? 'disable' : 'enable'} ${m.repo}: ${res.error ?? 'unknown error'}`)
  }

  // README presence + location, keyed by owning member. A README is a TYPED INSTANCE
  // (`au.engine.readme::au-engine`), so `instances_of` gives us existence + the file `path` in ONE read,
  // joined to members by the `member` field — no per-member existence probe. Absent → no README button.
  const readmeByMember = new Map<string, string>()
  async function loadReadmes(): Promise<void> {
    const res = await readInstancesOf(host.engine, 'au.engine.readme::au-engine')
    if (!alive) return
    readmeByMember.clear()
    if ('ready' in res && res.ready) {
      for (const inst of res.result) if (inst.member && !readmeByMember.has(inst.member)) readmeByMember.set(inst.member, inst.path)
    }
    renderMembers(allMembers) // re-render so the README buttons appear/disappear
  }

  // Toggle a member's README as an INLINE expansion card below its row (read lazily on first open).
  async function toggleReadme(path: string, exp: HTMLElement): Promise<void> {
    if (!exp.hidden) {
      exp.hidden = true
      exp.replaceChildren()
      return
    }
    exp.hidden = false
    const loading = document.createElement('div')
    loading.className = 'au-wsp-readme-loading'
    loading.textContent = 'loading…'
    exp.replaceChildren(loading)
    const r = await files.read(path)
    if (!alive || exp.hidden) return
    const body = document.createElement('au-scroll-area')
    body.className = 'au-wsp-readme-body'
    const pre = document.createElement('pre')
    pre.className = 'au-wsp-readme-pre'
    pre.textContent = r.ok && r.content ? r.content : '(could not read README)'
    body.appendChild(pre)
    exp.replaceChildren(body)
  }

  // The "+ add member" affordance: pick a local repo folder → name (derived, editable) + role →
  // add. LOCAL members only (a fetched dep needs the engine package-manager verb). Mounts live.
  function buildAddMemberUI(): void {
    if (!wsEdit) return // capability absent → no add UI
    const addBtn = auBtn('Add repository', { variant: 'ghost' })
    addBtn.className = 'au-wsp-addbtn'

    const form = document.createElement('div')
    form.className = 'au-wsp-addform'
    form.style.display = 'none'

    let pickedPath: string | null = null
    // Default `discover`: adding someone else's repo to mount its types is the common case, and it
    // is the conservative one — `edit` declares an authoring surface the engine watches live.
    let role: 'edit' | 'discover' = 'discover'

    // folder pick row
    const pickRow = document.createElement('div')
    pickRow.className = 'au-wsp-addrow'
    const pickBtn = auBtn('Choose folder…', { variant: 'outline' })
    pickBtn.className = 'au-wsp-pick'
    const pathEl = document.createElement('span')
    pathEl.className = 'au-wsp-path'
    pathEl.textContent = 'no folder chosen'
    pickRow.append(pickBtn, pathEl)

    // name row
    const nameRow = document.createElement('div')
    nameRow.className = 'au-wsp-addrow'
    const nameLabel = document.createElement('label')
    nameLabel.textContent = 'Name'
    const nameInput = document.createElement('au-input') as AuInputEl
    nameInput.className = 'au-wsp-input'
    nameInput.setAttribute('size', 'sm')
    nameInput.setAttribute('placeholder', 'Repository name')
    nameInput.setAttribute('label', 'Repository name')
    nameRow.append(nameLabel, nameInput)

    // role row — which `workspace.yaml` list the member lands in. A member has ONE role, so this is
    // an exclusive pick, and the hint explains the consequence rather than restating the label.
    const roleRow = document.createElement('div')
    roleRow.className = 'au-wsp-addrow au-wsp-addrow--role'
    const roleLabel = document.createElement('label')
    roleLabel.textContent = 'Role'
    const roleSeg = document.createElement('au-segmented-control') as AuSegEl
    roleSeg.className = 'au-wsp-role'
    roleSeg.setAttribute('label', 'Workspace member role')
    roleSeg.items = [
      { value: 'discover', label: 'Read-only' },
      { value: 'edit', label: 'Editable' },
    ]
    roleSeg.value = 'discover'
    const roleHint = document.createElement('span')
    roleHint.className = 'au-wsp-path'
    const setRole = (r: 'edit' | 'discover'): void => {
      role = r
      roleHint.textContent =
        r === 'edit'
          ? 'Files are live, watched, and available for editing and saving.'
          : 'Files remain read-only. Types are discoverable; cross-repository references still require a dependency declaration.'
    }
    roleSeg.addEventListener('au-change', (e) => setRole((e as CustomEvent<{ value: string }>).detail.value as 'edit' | 'discover'))
    setRole(role)
    roleRow.append(roleLabel, roleSeg, roleHint)

    const err = document.createElement('div')
    err.className = 'au-wsp-err'
    err.style.display = 'none'

    // actions
    const actions = document.createElement('div')
    actions.className = 'au-wsp-actions'
    const cancelBtn = auBtn('Cancel', { variant: 'ghost' })
    const addConfirm = auBtn('Add repository', { variant: 'solid' })
    addConfirm.disabled = true
    actions.append(cancelBtn, addConfirm)

    form.append(pickRow, nameRow, roleRow, err, actions)

    const refreshEnabled = (): void => {
      addConfirm.disabled = !pickedPath || !/^[A-Za-z0-9._-]+$/.test(nameInput.value.trim())
    }
    const reset = (): void => {
      pickedPath = null
      pathEl.textContent = 'no folder chosen'
      nameInput.value = ''
      setRole('discover')
      err.style.display = 'none'
      refreshEnabled()
    }
    const closeForm = (): void => {
      form.style.display = 'none'
      addBtn.style.display = ''
      reset()
    }

    addBtn.addEventListener('au-activate', () => {
      form.style.display = ''
      addBtn.style.display = 'none'
    })
    cancelBtn.addEventListener('au-activate', closeForm)
    nameInput.addEventListener('au-input', refreshEnabled)
    pickBtn.addEventListener('au-activate', async () => {
      // The CONTRACT capability, not the app-owned one. `pickFolder` reports a path and changes
      // nothing, so it belongs on `MountHost` — this pane reaches it the way a third party would.
      const p = await host.workspace.pickFolder?.()
      if (!alive || !p) return
      pickedPath = p
      pathEl.textContent = p
      pathEl.title = p
      if (!nameInput.value.trim()) nameInput.value = p.replace(/\/+$/, '').split('/').pop() ?? ''
      refreshEnabled()
    })
    addConfirm.addEventListener('au-activate', async () => {
      if (!pickedPath) return
      addConfirm.disabled = true
      const memberName = nameInput.value.trim()
      // List in the entry's `workspace.yaml` (`edit:` or `discover:`) + seed the member's repo.yaml
      // (addMember), THEN register its device-global location so it actually mounts. repo.yaml must
      // exist before register verifies it.
      const res = await wsEdit.addMember(wsRoot, { name: memberName, memberPath: pickedPath, role })
      const located = res.ok ? await wsEdit.register(memberName, pickedPath) : res
      if (!alive) return
      if (res.ok && located.ok) closeForm() // the type-graph subscription refreshes the list
      else {
        err.textContent = (res.ok ? located.error : res.error) ?? 'could not add member'
        err.style.display = ''
        refreshEnabled()
      }
    })

    membersSection.body.append(addBtn, form)
  }
  buildAddMemberUI()

  // Update the selected membership filter in place. The default is all members.
  let filterMode: 'all' | 'projects' | 'discover' | 'deps' = 'all'
  let allMembers: Member[] = []
  const rank = (m: Member): number => (isAuthoringMember(m) ? 0 : 1)
  memFilter.addEventListener('au-change', (e) => {
    filterMode = (e as CustomEvent<{ value: string }>).detail.value as 'all' | 'projects' | 'discover' | 'deps'
    memberRole.value = filterMode
    renderMembers(allMembers)
  })
  memberRole.addEventListener('au-change', () => {
    filterMode = memberRole.value as typeof filterMode
    memFilter.value = filterMode
    renderMembers(allMembers)
  })

  function renderMembers(members: Member[]): void {
    allMembers = members
    // Projects first, then dependencies; each group name-sorted. The filter narrows to one group.
    const shown = members
      .filter((m) => (filterMode === 'all' || (isAuthoringMember(m) ? filterMode === 'projects' : m.role === 'discover' ? filterMode === 'discover' : filterMode === 'deps')) && `${m.repo} ${m.root}`.toLowerCase().includes(memberSearch.value?.trim().toLowerCase() ?? ''))
      .sort((a, b) => rank(a) - rank(b) || a.repo.localeCompare(b.repo))
    setMembersCount(shown.length === members.length ? `${members.length}` : `${shown.length} of ${members.length}`)
    membersList.replaceChildren()
    if (shown.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'au-wsp-empty'
      empty.textContent = members.length ? 'No repositories match these filters.' : 'No members resolved.'
      membersList.appendChild(empty)
      return
    }
    // Reserve the README column on every row when ANY member has one, so the columns align.
    const anyReadme = readmeByMember.size > 0
    const memberGroups = new Map<string, HTMLDivElement>()
    const roleGroups = [
      {role:'entry', label:'Workspace root', hint:'The folder opened for this workspace. Its membership is fixed.'},
      {role:'edit', label:'Editable projects', hint:'Live working repositories. Files can be edited and saved here.'},
      {role:'discover', label:'Discovered repositories', hint:'Available for type discovery, read-only. Make editable to author their files.'},
      {role:'dep', label:'Dependencies', hint:'Included through dependency resolution, read-only. Membership is controlled by dependency declarations.'},
    ]
    for (const {role, label, hint} of roleGroups) {
      const groupMembers = shown.filter(m => m.role === role)
      if (!groupMembers.length) continue
      const section = rememberedSection(`members:${role}:${filterMode}`, label, filterMode !== 'all' || Boolean(memberSearch.value?.trim()) || role === 'entry')
      section.setCount(String(groupMembers.length))
      const explanation = document.createElement('p')
      explanation.className = 'au-wsp-description'
      explanation.textContent = hint
      section.body.append(explanation)
      memberGroups.set(role, section.body)
      membersList.append(section.el)
    }
    for (const m of shown) {
      const row = document.createElement('div')
      row.className = 'au-wsp-member'
      if (m.disabled) row.classList.add('disabled') // greyed: declared but not mounted
      const name = document.createElement('span')
      name.className = 'au-wsp-name'
      name.textContent = m.repo
      const identity = document.createElement('div')
      identity.className = 'au-wsp-identity'
      identity.append(name)
      const meta = document.createElement('span')
      meta.className = 'au-wsp-member-meta'
      const roles: Record<string, string> = { entry: 'Workspace root', edit: 'Editable project', discover: 'Discovered repository', dep: 'Dependency' }
      meta.textContent = [roles[m.role] ?? m.role, !m.local ? 'Cached' : '', m.scattered ? 'Outside workspace' : ''].filter(Boolean).join(' · ')
      meta.title = [roleTitle(m.role), !m.local ? CACHED_TITLE : '', m.scattered ? SCATTERED_TITLE : ''].filter(Boolean).join('. ')
      identity.append(meta)
      const rootPath = document.createElement('span')
      rootPath.className = 'au-wsp-root'
      rootPath.textContent = m.disabled ? 'Disabled — not mounted' : displayFilePath(m.root, host.workspace.members)
      rootPath.title = m.disabled ? 'Declared but disabled; no local root is resolved' : displayFilePath(m.root, host.workspace.members)
      identity.append(rootPath)
      row.append(identity)
      // Per-member actions, always shown. Every APPLICABLE column is reserved on EVERY row (an inert
      // ghost placeholder where the action doesn't apply) so the icon columns line up down the list:
      // README (reserved when any member has one), then the edit columns role-move / disable / remove
      // (reserved whenever the workspace is editable). Movable = an edit/discover member (not entry/dep).
      const acts = document.createElement('div')
      acts.className = 'au-wsp-acts'
      const movable = wsEdit && (m.role === 'edit' || m.role === 'discover')
      const readmePath = readmeByMember.get(m.repo)
      let readmeExp: HTMLElement | null = null
      if (anyReadme) {
        if (readmePath) {
          readmeExp = document.createElement('div')
          readmeExp.className = 'au-wsp-readme'
          readmeExp.hidden = true
          const exp = readmeExp
          const btn = auBtn('README', {variant:'ghost'})
          btn.title = `Read ${m.repo}'s README`
          btn.addEventListener('au-activate', (e) => {
            e.stopPropagation()
            void toggleReadme(readmePath, exp)
          })
          acts.appendChild(btn)
        }
      }
      if (wsEdit) {
        // role-move (edit↔discover)
        if (movable) {
          const target = m.role === 'edit' ? 'discover' : 'edit'
          const move = auBtn(target === 'edit' ? 'Make editable' : 'Make read-only', {variant:'ghost'})
          move.title = `Change ${m.repo} to ${target === 'edit' ? 'an editable project' : 'a discovered repository'}`
          move.addEventListener('au-activate', (e) => {
            e.stopPropagation()
            void moveMemberRole(m)
          })
          acts.appendChild(move)
        }
        // Active/disable toggle: ON = active (mounted), OFF = disabled (declared but not mounted, role
        // kept). Backed by the engine `member.disabled` field + the setMemberDisabled verb.
        const dis = document.createElement('au-switch') as HTMLElement & { checked: boolean }
        if (movable) {
          dis.checked = !m.disabled
          dis.setAttribute('label', 'Mounted')
          dis.setAttribute('aria-label', `${m.repo} mounted`)
          dis.title = m.disabled ? `${m.repo} is disabled (declared, not mounted) — enable it` : `disable ${m.repo} (keep it declared, stop mounting it)`
          dis.addEventListener('au-change', () => void setMemberDisabled(m, !dis.checked))
          const mounted = document.createElement('span')
          mounted.className = 'au-wsp-mounted'
          mounted.append('Mounted', dis)
          acts.appendChild(mounted)
        }
        // remove (edit/discover members only; the entry repo + a dep are not workspace.yaml-removable)
        if (movable) {
          const rm = auBtn('Remove', {variant:'ghost'})
          rm.title = `Remove ${m.repo} from workspace membership`
          rm.addEventListener('au-activate', (e) => {
            e.stopPropagation()
            void removeMember(m.repo)
          })
          acts.appendChild(rm)
        }
      }
      if (acts.childElementCount > 0) row.appendChild(acts)
      const group = memberGroups.get(m.role)!
      group.appendChild(row)
      if (readmeExp) group.appendChild(readmeExp)
    }
  }

  // --- dependencies / peer health -------------------------------------------------------------
  // Combines three sources: readMembers (which repos are mounted), each member's declared `peers`
  // (parsed from its repo.yaml), and the peer-family diagnostics (the engine-derived gaps).
  let latestMembers: Member[] = []
  let latestDiags: WireDiagnostic[] = []
  const peersByMember = new Map<string, string[]>() // member repo -> declared peer names
  const configurationErrors = new Map<string, string>()
  const implicitMembers = new Set<string>() // members with no repo.yaml `name` (anonymous implicit repos)
  // Peers located THIS session (keyed `member::peer`). The renderer can't read the per-machine
  // location file (it can't derive the machine key), so a just-located peer is tracked here to clear
  // its ⚠ immediately — the peer-unmounted diagnostic itself lags until a re-derive / reload.
  const justLocated = new Set<string>()

  async function loadMemberPeers(members: Member[]): Promise<void> {
    await Promise.all(
      members.map(async (m) => {
        if (m.disabled) {
          peersByMember.set(m.repo, []) // disabled → empty root, no file work
          return
        }
        const r = await files.read(`${m.root}/.arsumbris/repo.yaml`)
        if (!alive) return
        if (!r.ok) {
          configurationErrors.set(m.repo, r.error ?? 'Configuration could not be read')
          implicitMembers.delete(m.repo)
          return
        }
        const config = parseRepoConfiguration(r.content ?? '')
        peersByMember.set(m.repo, config.peers)
        if (config.error) configurationErrors.set(m.repo, config.error)
        else configurationErrors.delete(m.repo)
        if (config.identity || config.error) implicitMembers.delete(m.repo)
        else implicitMembers.add(m.repo)

      }),
    )
    if (alive) renderDependencies()
  }

  // The member a diagnostic belongs to: the member whose root is the longest matching prefix of its file.
  function memberOfFile(file: string): string | null {
    let best: Member | null = null
    for (const m of latestMembers) {
      if ((file === m.root || file.startsWith(m.root + '/')) && (!best || m.root.length > best.root.length)) best = m
    }
    return best?.repo ?? null
  }

  function renderDependencies(): void {
    const mounted = new Set(latestMembers.map((m) => m.repo))
    const byMember = new Map<string, WireDiagnostic[]>()
    for (const d of latestDiags) {
      if (!DEP_CODES.has(d.code)) continue
      const owner = memberOfFile(d.span.file)
      if (!owner) continue
      const list = byMember.get(owner) ?? []
      list.push(d)
      byMember.set(owner, list)
    }
    // A row per member. Issues are resolved against what the member NOW declares, so a just-fixed gap
    // disappears even before the engine re-derives (a member's own repo.yaml is not the live
    // re-derive trigger). `undeclared-peer` → a referenced-but-undeclared peer (a gap, unless now
    // declared). `peer-unmounted` → a declared peer with no local path (warn). Attention-first sort.
    const rows = latestMembers
      .map((m) => {
        const peers = peersByMember.get(m.repo) ?? []
        const diags = byMember.get(m.repo) ?? []
        const gaps = new Set<string>()
        const unmounted = new Set<string>()
        const otherHints: string[] = []
        for (const d of diags) {
          if (d.code === 'undeclared-peer') {
            const n = quotedName(d.fix?.description ?? d.message)
            if (n && !peers.includes(n)) gaps.add(n) // already declared → resolved, not a gap
          } else if (d.code === 'peer-unmounted') {
            const n = quotedName(d.message)
            if (n && !justLocated.has(`${m.repo}::${n}`)) unmounted.add(n) // located this session → resolved
          } else {
            otherHints.push(d.fix?.description ?? d.message)
          }
        }
        const implicit = implicitMembers.has(m.repo)
        const configurationError = configurationErrors.get(m.repo)
        const needsAttention = Boolean(configurationError) || gaps.size > 0 || unmounted.size > 0 || otherHints.length > 0 || implicit
        return { repo: m.repo, root: m.root, peers, gaps: [...gaps], unmounted, otherHints, implicit, needsAttention, configurationError }
      })
      .filter((r) => r.peers.length > 0 || r.needsAttention)
      .sort((a, b) => (b.needsAttention ? 1 : 0) - (a.needsAttention ? 1 : 0) || a.repo.localeCompare(b.repo))

    setDepCount(String(rows.length))
    depList.replaceChildren()
    if (rows.length === 0) {
      const none = document.createElement('div')
      none.className = 'au-wsp-dep-none'
      none.textContent = 'no cross-repo dependencies'
      depList.appendChild(none)
      return
    }
    const category = (r: typeof rows[number]): string => r.configurationError ? 'Configuration unavailable' : r.gaps.length || r.unmounted.size || r.otherHints.length ? 'Unresolved peers' : r.implicit ? 'Missing registry identity' : 'Declared dependencies'
    const grouped = new Map<string, HTMLDivElement>()
    for (const label of ['Configuration unavailable', 'Unresolved peers', 'Missing registry identity', 'Declared dependencies']) {
      const count = rows.filter(r => category(r) === label).length
      if (!count) continue
      const section = rememberedSection(`health:${label}`, label, label === 'Unresolved peers' || label === 'Configuration unavailable')
      section.setCount(String(count))
      const description = document.createElement('p')
      description.className = 'au-wsp-description'
      description.textContent = label === 'Missing registry identity' ? 'These repositories have no name in repo.yaml. Create a registry to make a repository self-describing.' : label === 'Configuration unavailable' ? 'These repository configurations could not be read or parsed. Resolve the reported problem before changing their declarations.' : label === 'Unresolved peers' ? 'Review missing declarations and local paths for these repositories.' : 'Repositories with declared peers and no detected dependency issues.'
      section.body.append(description)
      grouped.set(label, section.body)
      depList.append(section.el)
    }
    for (const r of rows) {
      const block = document.createElement('div')
      block.className = `au-wsp-dep${r.needsAttention ? ' issue' : ''}`
      const head = document.createElement('div')
      head.className = 'au-wsp-dep-head'
      const name = document.createElement('span')
      name.className = 'au-wsp-name'
      name.textContent = r.repo
      head.appendChild(name)
      block.appendChild(head)
      if (r.configurationError) {
        const error = document.createElement('p')
        error.className = 'au-wsp-description'
        error.textContent = r.configurationError
        block.append(error)
      }

      const peers = document.createElement('div')
      peers.className = 'au-wsp-dep-peers'
      for (const p of r.peers) {
        const state = r.unmounted.has(p) ? 'warn' : mounted.has(p) ? 'ok' : ''
        // A ⚠ (declared-but-unlocated) peer is an ACTION → a small button that locates it.
        if (state === 'warn' && wsEdit) {
          const chip = auBtn('Locate ' + p, { variant: 'outline', size: 'sm' })
          chip.title = `locate '${p}' (add its path to this machine's location file)`
          chip.addEventListener('au-activate', () => void fixPeer(r.root, r.repo, p, chip, { declare: false, locate: true }))
          peers.appendChild(chip)
        } else {
          const peer = document.createElement('span')
          peer.className = 'au-wsp-peer'
          peer.textContent = p + (state === 'warn' ? ' — path missing' : state === '' ? ' — not mounted' : '')
          peer.title = state === 'ok' ? 'Declared and mounted in this workspace' : 'Declared dependency without a mounted member'
          peers.appendChild(peer)
        }
      }
      for (const g of r.gaps) {
        // A gap is an ACTION → declares the peer AND locates it (both, so a fix doesn't just trade
        // undeclared-peer for peer-unmounted). Static (no wsEdit) → a danger chip.
        if (wsEdit) {
          const chip = auBtn('Declare and locate ' + g, { variant: 'outline', size: 'sm' })
          chip.title = `declare + locate '${g}' as a peer of ${r.repo}`
          chip.addEventListener('au-activate', () => void fixPeer(r.root, r.repo, g, chip, { declare: true, locate: true }))
          peers.appendChild(chip)
        } else {
          peers.appendChild(auChip('+ ' + g, 'danger', 'referenced but NOT declared as a peer (undeclared-peer)'))
        }
      }
      if (peers.childElementCount > 0) block.appendChild(peers)

      // Bulk "fix all N" when a member has several gaps (declare + locate each).
      if (wsEdit && r.gaps.length > 1) {
        const all = auBtn(`fix all ${r.gaps.length} peers`, { variant: 'outline', size: 'sm' })
        all.title = `declare + locate all ${r.gaps.length} undeclared peers of ${r.repo} at once`
        all.className = 'au-wsp-declareall'
        all.addEventListener('au-activate', () => void fixPeers(r.root, r.repo, r.gaps, all, { declare: true, locate: true }))
        block.appendChild(all)
      }

      // Implicit repo (no repo.yaml `name`): offer to scaffold one, making it self-describing.
      if (r.implicit) {
        if (wsEdit) {
          const btn = auBtn('Create registry', { variant: 'outline', size: 'sm' })
          btn.className = 'au-wsp-declareall'
          btn.title = `give ${r.repo} a repo.yaml identity — it is mounted as an anonymous implicit repo`
          btn.addEventListener('au-activate', () => void scaffold(r.root, r.repo, btn))
          head.appendChild(btn)
        }
        const note = document.createElement('div')
        note.className = 'au-wsp-dep-fix'
        note.append('Repository identity is missing.')
        if (category(r) !== 'Missing registry identity') block.appendChild(note)
      }

      // Fix hints for the still-unresolved issues only (a fixed gap drops out above).
      const hints = new Set<string>()
      if (r.gaps.length) hints.add(`add ${r.gaps.map((g) => `'${g}'`).join(', ')} to this repo's peers`)
      for (const u of r.unmounted) hints.add(`add a path for '${u}' to this machine's location file`)
      for (const h of r.otherHints) hints.add(h)
      for (const h of hints) {
        const fix = document.createElement('div')
        fix.className = 'au-wsp-dep-fix'
        fix.textContent = h
        block.appendChild(fix)
      }
      grouped.get(category(r))!.appendChild(block)
    }
  }

  // Fix one member's peer: DECLARE it (the member's repo.yaml `deps:`) and/or LOCATE it (register the
  // peer's device-global location), so a fix doesn't just trade undeclared-peer for peer-unmounted.
  // Locating needs the peer's root — available only when the peer is a mounted workspace member; a
  // non-member peer is declared but not located (nothing to point at). Returns false on error.
  async function fixOne(root: string, repo: string, peer: string, opts: { declare: boolean; locate: boolean }): Promise<{ ok: boolean; error?: string }> {
    if (!wsEdit) return { ok: false, error: 'no write capability' }
    if (opts.declare) {
      const res = await wsEdit.declarePeer(root, repo, peer)
      if (!res.ok) return res
    }
    if (opts.locate) {
      const peerRoot = latestMembers.find((m) => m.repo === peer)?.root
      if (peerRoot) {
        // Schema-12 folder-picker bootstrap: register the peer's device-global location (repos.yaml).
        const res = await wsEdit.register(peer, peerRoot)
        if (!res.ok) return res
        justLocated.add(`${repo}::${peer}`)
      }
    }
    return { ok: true }
  }

  // Apply a fix to several peers of a member, then refresh (re-read declared peers + diagnostics; the
  // located set clears the ⚠ locally since the location file isn't renderer-readable). Busy on the trigger.
  async function fixPeers(root: string, repo: string, peerNames: string[], trigger: AuBtnEl, opts: { declare: boolean; locate: boolean }): Promise<void> {
    if (!wsEdit) return
    const label = trigger.textContent
    trigger.disabled = true
    trigger.textContent = 'fixing…'
    for (const p of peerNames) {
      const res = await fixOne(root, repo, p, opts)
      if (!alive) return
      if (!res.ok) {
        window.alert(`Could not fix '${p}' for ${repo}: ${res.error ?? 'unknown error'}`)
        trigger.disabled = false
        trigger.textContent = label
        return
      }
    }
    await loadMemberPeers(latestMembers) // re-render Dependencies with fixed items resolved
    await reloadDiagnostics()
  }
  const fixPeer = (root: string, repo: string, peer: string, trigger: AuBtnEl, opts: { declare: boolean; locate: boolean }): Promise<void> =>
    fixPeers(root, repo, [peer], trigger, opts)

  // Give an implicit (registry-less) member a `self` identity, then refresh.
  async function scaffold(root: string, repo: string, trigger: AuBtnEl): Promise<void> {
    if (!wsEdit) return
    const label = trigger.textContent
    trigger.disabled = true
    trigger.textContent = 'creating…'
    const res = await wsEdit.scaffoldRegistry(root, repo)
    if (!alive) return
    if (!res.ok) {
      window.alert(`Could not create a registry for ${repo}: ${res.error ?? 'unknown error'}`)
      trigger.disabled = false
      trigger.textContent = label
      return
    }
    await loadMemberPeers(latestMembers) // re-read: the member now has `self`, so it drops out of implicit
    await reloadDiagnostics()
  }

  // A collapsible read-only viewer for one file, lazy-read on first expand.
  function addFileViewer(label: string, path: string, note?: string): void {
    const head = document.createElement('button')
    head.className = 'au-wsp-file-head'
    head.setAttribute('aria-expanded', 'false')
    const caret = document.createElement('span')
    caret.className = 'au-wsp-caret'
    caret.textContent = '▸'
    const name = document.createElement('span')
    name.className = 'au-wsp-file-name'
    name.textContent = label
    head.append(caret, name)
    if (note) {
      const noteEl = document.createElement('span')
      noteEl.className = 'au-wsp-file-note'
      noteEl.textContent = note
      head.appendChild(noteEl)
    }
    const body = document.createElement('pre')
    body.className = 'au-wsp-file-body'
    body.style.display = 'none'
    let loaded = false
    head.addEventListener('click', async () => {
      const open = body.style.display !== 'none'
      head.setAttribute('aria-expanded', String(!open))
      if (open) {
        body.style.display = 'none'
        caret.textContent = '▸'
        return
      }
      body.style.display = ''
      caret.textContent = '▾'
      if (!loaded) {
        loaded = true
        const r = await files.read(path)
        if (!alive) return
        body.textContent = r.ok ? (r.content ?? '') : `(could not read: ${r.error ?? 'missing'})`
      }
    })
    filesList.append(head, body)
  }

  // A viewer over PRE-FETCHED content (device-global files sit outside the entry, so `files.read`
  // can't reach them — their content arrives via the `deviceConfig` read).
  function addContentViewer(label: string, content: string | null, note?: string): void {
    const head = document.createElement('button')
    head.className = 'au-wsp-file-head'
    head.setAttribute('aria-expanded', 'false')
    const caret = document.createElement('span')
    caret.className = 'au-wsp-caret'
    caret.textContent = '▸'
    const name = document.createElement('span')
    name.className = 'au-wsp-file-name'
    name.textContent = label
    head.append(caret, name)
    if (note) {
      const noteEl = document.createElement('span')
      noteEl.className = 'au-wsp-file-note'
      noteEl.textContent = note
      head.appendChild(noteEl)
    }
    const body = document.createElement('pre')
    body.className = 'au-wsp-file-body'
    body.style.display = 'none'
    body.textContent = content ?? '(absent)'
    head.addEventListener('click', () => {
      const open = body.style.display !== 'none'
      head.setAttribute('aria-expanded', String(!open))
      body.style.display = open ? 'none' : ''
      caret.textContent = open ? '▸' : '▾'
    })
    filesList.append(head, body)
  }

  async function loadMembers(): Promise<void> {
    let res
    try { res = await readMembers(host.engine) }
    catch (error) {
      if (alive) { memberNotice.hidden = false; memberNotice.textContent = `Could not load members: ${error instanceof Error ? error.message : String(error)}. Existing results may be out of date.` }
      return
    }
    if (!alive) return
    if ('ok' in res || !res.ready) {
      memberNotice.hidden = false
      memberNotice.textContent = 'ok' in res ? `Could not load members: ${res.error}` : 'Waiting for the workspace engine.'
      return
    }
    memberNotice.textContent = ''
    memberNotice.hidden = true
    const members = res.result as Member[]
    latestMembers = members
    renderMembers(members)
    void renderResolutionFiles(members)
    void loadMemberPeers(members)
    void loadReadmes()
  }

  // The entry's two files, the engine-written workspace lock, each member's repo.yaml, and the
  // per-user DEVICE-GLOBAL resolution files (repos.yaml / workspaces.yaml). The daemon enters on a
  // FOLDER-REPO, so `host.entry.path` IS the entry directory (entry == root == home).
  // The device files sit outside the entry, so their content comes from the `deviceConfig` read.
  async function renderResolutionFiles(members: Member[]): Promise<void> {
    filesList.replaceChildren()
    const entry = host.entry.path
    // The entry folder's own pair: its intrinsic identity, and this workspace's composition.
    // `workspace.yaml` is OPTIONAL (a single-repo workspace has none), so the viewer tolerates
    // it being absent rather than implying the file must exist.
    addFileViewer('repo.yaml', `${entry}/.arsumbris/repo.yaml`, 'the entry repo\u2019s identity + type-deps')
    addFileViewer('workspace.yaml', `${entry}/.arsumbris/workspace.yaml`, 'this workspace\u2019s edit: / discover: composition')
    addFileViewer('workspace.lock', `${entry}/.arsumbris/workspace.lock`, 'engine-written \u00b7 pins the discover closure \u00b7 do not edit')
    // Each member's identity file.
    for (const m of members) {
      addFileViewer(`${m.repo} / repo.yaml`, `${m.root}/.arsumbris/repo.yaml`)
    }
    // Device-global resolution (per-user, outside the entry): where members resolve on THIS machine,
    // and the first-run signal (a missing/empty repos.yaml means no device registry yet).
    if (wsEdit) {
      const dc = await wsEdit.deviceConfig()
      if (!alive) return
      if (dc.ok && dc.config) {
        const repos = dc.config.repos
        const entryCount = repos?.content ? (repos.content.match(/^\s*-\s*name:/gm)?.length ?? 0) : 0
        const reposNote =
          !repos || !repos.exists ? 'MISSING — first run: no device registry yet' : `${entryCount} repo location${entryCount === 1 ? '' : 's'}`
        addContentViewer('~/.arsumbris/au-engine/config/repos.yaml', repos?.content ?? null, reposNote)
        const ws = dc.config.workspaces
        addContentViewer('~/.arsumbris/au-engine/config/workspaces.yaml', ws?.content ?? null, ws?.exists ? undefined : 'absent')
      }
    }
  }

  void loadMembers()

  // Members change when the workspace manifest changes, which forces an engine rebuild + a
  // type-graph bump — re-read on that (debounced) and on the daemon-ready edge.
  let timer: ReturnType<typeof setTimeout> | undefined
  const scheduleReload = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => alive && void loadMembers(), 200)
  }
  const offTypeGraph = subscribeTypes(host.engine, (event) => {
    if (alive && event.kind === 'change') scheduleReload()
  })
  const offReady = (host as HostApp).engineReady?.subscribe((ready) => {
    if (ready && alive) {
      void loadMembers()
      connectDiagnostics()
    }
  })

  // --- workspace/member diagnostics -----------------------------------------------------------
  function renderDiagnostics(all: WireDiagnostic[]): void {
    latestDiags = all
    renderDependencies()
    const issues = all.filter((d) => WORKSPACE_CODES.has(d.code))
    setDiagCount(`${issues.length}`)
    diagList.replaceChildren()
    if (issues.length === 0) {
      const ok = document.createElement('div')
      ok.className = 'au-wsp-ok'
      ok.textContent = 'No workspace issues'
      const mark = document.createElement('au-icon')
      mark.setAttribute('name', 'check')
      mark.setAttribute('size', 'sm')
      mark.setAttribute('aria-hidden', 'true')
      ok.append(mark)
      diagList.appendChild(ok)
      return
    }
    // Worst severity first, then by code.
    const rank: Record<string, number> = { error: 0, warning: 1, drift: 2, hint: 3 }
    issues.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.code.localeCompare(b.code))
    for (const d of issues) {
      const row = document.createElement('div')
      row.className = `au-wsp-diag severity-${d.severity}`
      const sev = document.createElement('span')
      sev.className = 'au-wsp-sev'
      sev.textContent = d.severity
      const code = document.createElement('span')
      code.className = 'au-wsp-code'
      code.textContent = d.code
      const msg = document.createElement('span')
      msg.className = 'au-wsp-dmsg'
      msg.textContent = d.message
      msg.title = d.span.file
      row.append(sev, code, msg)
      diagList.appendChild(row)
    }
  }

  // Live via the diagnostics subscription: the initial value renders directly; a change event is
  // notification-only, so re-read.
  let offDiagnostics: (() => void) | null = null
  function connectDiagnostics(): void {
    offDiagnostics?.()
    offDiagnostics = subscribeDiagnostics(host.engine, (event) => {
      if (!alive) return
      if (event.kind === 'initial-value') renderDiagnostics(event.result)
      else if (event.kind === 'change') void reloadDiagnostics()
      else if (event.kind === 'closed') { setDiagCount('Updates unavailable') }
    }, {scope:'all'})
  }
  async function reloadDiagnostics(): Promise<void> {
    // scope: 'all' — schema 17 made argless diagnostics default to `own`; a workspace-wide panel
    // must surface every member's diagnostics (dep/discover included), not just editable ones.
    let res
    try { res = await readDiagnostics(host.engine, { scope: 'all' }) }
    catch { if (alive) setDiagCount('Unavailable'); return }
    if (!alive) return
    if ('ok' in res || !res.ready) { setDiagCount('Unavailable'); return }
    renderDiagnostics(res.result)
  }
  connectDiagnostics()

  return () => {
    disposeStyles?.()
    alive = false
    clearTimeout(timer)
    offTypeGraph()
    offReady?.()
    offDiagnostics?.()
    container.replaceChildren()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
