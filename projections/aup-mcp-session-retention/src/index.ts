import { defineProjection, type ProjectionModule, type MountHost } from '@arsumbris/au-host-sdk'
import type { DormantSession, HostApp } from '@arsumbris/au-host-app'
import { STYLE } from './styles'

const DAY_MS = 86_400_000
function element(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node
}
function button(label: string, activate: () => void, variant = 'ghost'): HTMLElement & { disabled: boolean } {
  const node = element('au-button', '', label) as HTMLElement & { disabled: boolean }
  node.setAttribute('size', 'sm'); node.setAttribute('variant', variant); node.addEventListener('au-activate', activate); return node
}
function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  let amount = value / 1024, unit = 0; const units = ['KB', 'MB', 'GB']
  while (amount >= 1024 && unit < 2) { amount /= 1024; unit++ }
  return `${amount < 10 ? amount.toFixed(1) : Math.round(amount)} ${units[unit]}`
}
function pending(label: string): HTMLElement {
  const row = element('div', 'au-ret-loading'); const spinner = element('au-spinner')
  spinner.setAttribute('size', 'sm'); spinner.setAttribute('label', label); row.append(spinner, label); return row
}
function message(): HTMLElement { const node = element('div', 'au-ret-message'); node.setAttribute('role', 'status'); return node }
function report(node: HTMLElement, text = '', error = false): void { node.textContent = text; node.classList.toggle('au-ret-error', error) }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function sessionRecord(session: DormantSession): HTMLElement {
  const row = element('div', 'au-ret-item')
  const date = new Date(session.lastActiveMs)
  row.append(element('div', 'au-ret-id', session.id), element('div', 'au-ret-meta', `Run ${session.run} · Last active ${Number.isFinite(date.getTime()) ? date.toLocaleString() : 'unknown'} · ${bytes(session.sizeBytes)}`))
  return row
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const mcp = (host as HostApp).mcp
  let alive = true, configGeneration = 0, listGeneration = 0, previewGeneration = 0
  let draftDays: number | null = null
  let currentDays: number | undefined, edited = false, reviewing = false, applying = false
  let sessions: DormantSession[] | undefined, reviewed: { days: number; sessions: DormantSession[] } | undefined
  let retiring: string | undefined
  const root = element('div', 'au-ret'), scroll = element('au-scroll-area'), content = element('div', 'au-ret-content')
  scroll.setAttribute('axis', 'y'); root.append(scroll); scroll.append(content)
  content.append(element('h2', '', 'Session retention'), element('p', 'au-ret-intro', 'Keep closed MCP sessions available to resume, and review which dormant sessions are eligible for retirement.'))
  const layout = element('div', 'au-ret-layout'), policy = element('section', 'au-ret-section'), library = element('section', 'au-ret-section au-ret-sessions')
  layout.append(policy, library); content.append(layout)
  const current = element('div', 'au-ret-current'), configStatus = message(), policyStatus = message()
  const field = element('div', 'au-ret-field'), input = element('au-number-input') as HTMLElement & { value: number | null; disabled: boolean }
  input.setAttribute('label', 'Retention window in days'); input.setAttribute('min', '1'); input.setAttribute('step', '1'); input.setAttribute('size', 'sm')
  field.append(element('span', '', 'Retention window in days'), input)
  const reviewButton = button('Review impact', () => void preview(), 'outline')
  const resetButton = button('Discard change', () => { if (currentDays !== undefined) { input.value = currentDays; draftDays = currentDays }; edited = false; invalidate(); report(policyStatus); sync() })
  const actions = element('div', 'au-ret-row'); actions.append(reviewButton, resetButton)
  const previewBox = element('div', 'au-ret-preview'); previewBox.hidden = true
  policy.append(element('h3', '', 'Retention policy'), current, configStatus, field, element('p', 'au-ret-hint', 'Whole days since the session’s last activity. The daemon retires expired dormant sessions during its scheduled cleanup.'), actions, policyStatus, previewBox)
  const listHead = element('div', 'au-ret-row'), refresh = button('Refresh', () => { invalidate(); void loadConfig(); void loadList() })
  listHead.append(element('h3', '', 'Dormant sessions'), refresh)
  const summary = element('div', 'au-ret-hint'), listStatus = message(), list = element('div', 'au-ret-list')
  library.append(listHead, element('p', 'au-ret-hint', 'These sessions closed cleanly and can still be resumed. Retiring a session removes that ability permanently.'), summary, listStatus, list)
  const disposeStyles = host.styles?.inject(STYLE, container); container.append(root)

  function days(): number | null {
    const value = draftDays
    return value !== null && Number.isInteger(value) && value >= 1 && Number.isSafeInteger(value * DAY_MS) ? value : null
  }
  function sync(): void {
    input.disabled = applying
    reviewButton.disabled = reviewing || applying || retiring !== undefined || currentDays === undefined || days() === null
    resetButton.disabled = applying || currentDays === undefined || draftDays === currentDays
    refresh.disabled = applying || retiring !== undefined
    reviewButton.toggleAttribute('loading', reviewing)
  }
  function invalidate(): void { ++previewGeneration; reviewing = false; reviewed = undefined; previewBox.hidden = true; previewBox.replaceChildren(); report(policyStatus); sync() }
  const edit = (event: Event): void => {
    draftDays = (event as CustomEvent<{ value: number | null }>).detail.value
    edited = true; invalidate(); report(policyStatus, days() === null ? 'Enter a whole number of days, at least 1.' : '', days() === null)
  }
  input.addEventListener('au-input', edit); input.addEventListener('au-change', edit)

  async function loadConfig(): Promise<void> {
    const generation = ++configGeneration
    if (currentDays === undefined) current.replaceChildren(pending('Reading retention policy'))
    report(configStatus)
    try {
      const result = await mcp.retentionConfig()
      if (!alive || generation !== configGeneration) return
      if (!result.ok) throw Error(result.error)
      currentDays = result.windowDays; current.textContent = `Currently keeping dormant sessions for ${currentDays} days`
      if (!edited) { input.value = currentDays; draftDays = currentDays }
    } catch (error) {
      if (!alive || generation !== configGeneration) return
      current.textContent = currentDays === undefined ? 'Current policy unavailable' : `Last read policy: ${currentDays} days`
      report(configStatus, errorText(error), true)
    } finally { if (alive && generation === configGeneration) sync() }
  }
  function renderList(): void {
    list.replaceChildren()
    if (sessions === undefined) return
    summary.textContent = `${sessions.length} dormant session${sessions.length === 1 ? '' : 's'} · ${bytes(sessions.reduce((total, s) => total + s.sizeBytes, 0))}`
    if (!sessions.length) {
      const empty = element('au-empty-state'); empty.setAttribute('label', 'No dormant sessions'); empty.setAttribute('hint', 'Cleanly closed MCP sessions will appear here while they remain resumable.'); list.append(empty); return
    }
    for (const session of sessions) {
      const row = sessionRecord(session), controls = element('div', 'au-ret-confirm')
      const retire = button('Retire session', () => {
        const confirm = button('Confirm retirement', () => void retireOne(session.id), 'outline')
        const cancel = button('Cancel', () => { controls.replaceChildren(retire); retire.focus() })
        const confirmActions = element('div', 'au-ret-row'); confirmActions.append(confirm, cancel)
        controls.replaceChildren(element('p', 'au-ret-danger', 'This session will no longer be resumable.'), confirmActions); requestAnimationFrame(() => { if (cancel.isConnected) cancel.focus() })
      })
      retire.disabled = applying || retiring !== undefined
      if (retiring === session.id) controls.append(pending('Retiring session'))
      else controls.append(retire)
      row.append(controls); list.append(row)
    }
  }
  async function loadList(): Promise<void> {
    const generation = ++listGeneration
    listStatus.replaceChildren(pending(sessions ? 'Refreshing dormant sessions' : 'Reading dormant sessions'))
    try {
      const result = await mcp.listDormant()
      if (!alive || generation !== listGeneration) return
      if (!result.ok) throw Error(result.error)
      sessions = result.sessions; report(listStatus); renderList()
    } catch (error) { if (alive && generation === listGeneration) report(listStatus, errorText(error), true) }
  }
  async function preview(): Promise<void> {
    const value = days(); if (value === null || applying || retiring !== undefined) return
    invalidate(); const generation = previewGeneration; reviewing = true; sync(); policyStatus.replaceChildren(pending('Reviewing affected sessions'))
    try {
      const result = await mcp.retentionPreview(value * DAY_MS)
      if (!alive || generation !== previewGeneration) return
      if (!result.ok) throw Error(result.error)
      reviewed = { days: value, sessions: result.sessions }; report(policyStatus)
      previewBox.hidden = false
      previewBox.append(element('h3', '', `Review: ${value} days`), element('p', '', result.sessions.length ? `${result.sessions.length} dormant session${result.sessions.length === 1 ? ' is' : 's are'} currently eligible for retirement under this policy.` : 'No dormant sessions are currently eligible for retirement under this policy.'))
      if (result.sessions.length) { const affected = element('au-scroll-area'); affected.setAttribute('axis', 'y'); affected.append(...result.sessions.map(sessionRecord)); previewBox.append(affected) }
      previewBox.append(element('p', 'au-ret-hint', 'This preview is a snapshot. Saving changes the policy; the daemon performs cleanup separately.'))
      const applyButton = button('Apply reviewed policy', () => void apply(), 'cta'), cancel = button('Cancel review', () => { invalidate(); report(policyStatus); reviewButton.focus() })
      const row = element('div', 'au-ret-row'); row.append(applyButton, cancel); previewBox.append(row)
    } catch (error) { if (alive && generation === previewGeneration) report(policyStatus, errorText(error), true) }
    finally { if (alive && generation === previewGeneration) { reviewing = false; sync() } }
  }
  async function apply(): Promise<void> {
    if (!reviewed || reviewed.days !== days() || applying || retiring !== undefined) return
    const focusRoot = root.getRootNode() as Document | ShadowRoot
    const restoreFocus = previewBox.contains(focusRoot.activeElement)
    const submitted = reviewed.days; ++configGeneration; applying = true; invalidate(); sync(); renderList(); policyStatus.replaceChildren(pending('Saving retention policy'))
    if (restoreFocus) { policyStatus.tabIndex = -1; policyStatus.focus({ preventScroll: true }) }
    try {
      const result = await mcp.setRetentionWindow(submitted)
      if (!alive) return
      if (!result.ok) throw Error(result.error)
      currentDays = result.windowDays; input.value = result.windowDays; draftDays = result.windowDays; edited = false
      current.textContent = `Currently keeping dormant sessions for ${currentDays} days`
      report(configStatus); report(policyStatus, `Saved ${currentDays}-day retention policy.`); void loadList()
    } catch (error) { if (alive) report(policyStatus, errorText(error), true) }
    finally {
      applying = false
      if (alive) {
        sync(); renderList()
        if (restoreFocus) requestAnimationFrame(() => {
          if (alive && focusRoot.activeElement === policyStatus) reviewButton.focus()
        })
      }
    }
  }
  async function retireOne(id: string): Promise<void> {
    if (retiring !== undefined || applying) return
    retiring = id; invalidate(); sync(); renderList(); report(listStatus)
    try {
      const result = await mcp.retireSession(id)
      if (!alive) return
      if (!result.ok) throw Error(result.error)
      sessions = sessions?.filter(s => s.id !== id); await loadList()
    } catch (error) { if (alive) report(listStatus, errorText(error), true) }
    finally { retiring = undefined; if (alive) { sync(); renderList() } }
  }
  sync(); void loadConfig(); void loadList()
  return () => { alive = false; disposeStyles?.(); root.remove() }
}
export default defineProjection<ProjectionModule>({ mount })
