import { defineProjection, type ProjectionModule, type IntentPayload, type MountHost, reportHostDiagnostic, clearCondition, readConditions, subscribe } from '@arsumbris/au-host-sdk'
import { notificationIntent } from '@arsumbris/intent'

const STYLE = `
.au-debug-scroll { height:100%; min-height:0; }
.au-debug { box-sizing:border-box; min-width:0; width:min(100%,760px); margin-inline:auto; padding:var(--au-space-5); background:transparent; color:var(--au-ink-1); font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); display:flex; flex-direction:column; gap:var(--au-space-6); overflow-wrap:anywhere; }
.au-debug h2 { margin:0; font:var(--au-w-strong) var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.au-debug p { margin:0; color:var(--au-ink-3); }
.au-debug-section > au-section-header::part(header) { padding-inline:0; }
.au-debug-section { display:flex; flex-direction:column; gap:var(--au-space-2); }
.au-debug-row { display:flex; align-items:center; flex-wrap:wrap; gap:var(--au-space-3); padding-block:var(--au-space-3); }
.au-debug-row + .au-debug-row { border-top:1px solid var(--au-line-1); }
.au-debug-identity { flex:1 1 260px; min-width:0; }
.au-debug-label { display:flex; align-items:center; gap:var(--au-space-2); }
.au-debug-row au-button { margin-left:auto; }
.au-debug-result { min-height:var(--au-lh-base); font-size:var(--au-t-xs); }
.au-debug-conditions { display:flex; flex-direction:column; }
.au-debug-state { color:var(--au-ink-3); font-size:var(--au-t-xs); margin-left:auto; }
.au-debug-clear { align-self:flex-start; }
`

function button(label: string): HTMLElement {
  const el = document.createElement('au-button')
  el.setAttribute('size', 'sm')
  el.setAttribute('variant', 'outline')
  el.textContent = label
  return el
}

const CONDITION_SUBJECT = 'debug-pane'
const CONDITION_CODES = { warning: 'debug-test-warning', error: 'debug-test-error' } as const

function mount(container: HTMLElement, host: MountHost): () => void {
  const root = document.createElement('div')
  root.className = 'au-debug'
  const heading = document.createElement('header')
  const title = document.createElement('h2')
  title.textContent = 'Host feedback tests'
  const intro = document.createElement('p')
  intro.textContent = 'Send example notifications and manage test conditions in this window.'
  heading.append(title, intro)
  root.append(heading)

  function section(title: string, description: string): HTMLElement {
    const section = document.createElement('section')
    section.className = 'au-debug-section'
    const header = document.createElement('au-section-header')
    header.textContent = title
    header.setAttribute('sans', '')
    const note = document.createElement('p')
    note.textContent = description
    section.append(header, note)
    root.append(section)
    return section
  }

  function scenario(parent: HTMLElement, title: string, description: string, action: string, run: () => void): {state: HTMLElement; dot: HTMLElement} {
    const row = document.createElement('div')
    row.className = 'au-debug-row'
    const identity = document.createElement('div')
    identity.className = 'au-debug-identity'
    const label = document.createElement('div')
    label.className = 'au-debug-label'
    const dot = document.createElement('au-status-dot')
    dot.setAttribute('tone', 'ink')
    const name = document.createElement('strong')
    name.textContent = title
    const state = document.createElement('span')
    state.className = 'au-debug-state'
    const note = document.createElement('p')
    note.textContent = description
    label.append(dot, name, state)
    identity.append(label, note)
    const trigger = button(action)
    trigger.addEventListener('au-activate', run)
    row.append(identity, trigger)
    parent.append(row)
    return {state, dot}
  }

  const notifications = section('Notifications', 'Each test sends one example through the host notification surface. It does not perform the operation described.')
  const result = document.createElement('p')
  result.className = 'au-debug-result'
  result.setAttribute('role', 'status')
  result.textContent = 'No notification test sent yet.'
  function send(label: string, payload: unknown): void {
    host.intent.fire(payload as IntentPayload)
    result.textContent = `${label} test dispatched. Check the host notification surface.`
  }
  const examples = [
    {name:'Information', copy:'Debug test: reindexed 3 example files.', action:'Send information', tone:'ink', payload:notificationIntent('info', 'Debug test: reindexed 3 example files.')},
    {name:'Warning', copy:'Debug test: example service restart warning.', action:'Send warning', tone:'warn', payload:notificationIntent('warn', 'Debug test: example service restart warning.')},
    {name:'Error with action', copy:'Debug test: example write conflict. Test action sends an acknowledgement.', action:'Send error', tone:'danger', payload:notificationIntent('error', 'Debug test: example write conflict.', [{type:'ui-notification-action', label:'Test action', intent:notificationIntent('info', 'Debug test action invoked.')}])},
    {name:'Progress', copy:'Debug test: example indexing at 63%. Uses the progress notification renderer.', action:'Send progress', tone:'ink', payload:{type:'ui-notification-progress', severity:'info', message:'Debug test: example indexing…', percent:63, kind:'broadcast'}},
  ]
  for (const example of examples) {
    const row = scenario(notifications, example.name, example.copy, example.action, () => send(example.name, example.payload))
    row.dot.setAttribute('tone', example.tone)
  }
  notifications.append(result)

  const conditions = section('Standing conditions', 'Test conditions remain until cleared. Raising the same condition again updates it; warning and error remain independent.')
  const states = new Map<string, {state:HTMLElement; dot:HTMLElement}>()
  for (const severity of ['warning', 'error'] as const) {
    const label = severity === 'warning' ? 'Warning' : 'Error'
    states.set(CONDITION_CODES[severity], scenario(conditions, `${label} condition`, `A deliberate ${severity} in the host condition set.`, `Raise ${severity}`, () => {
      reportHostDiagnostic({code:CONDITION_CODES[severity], severity, subject:CONDITION_SUBJECT, message:`Debug test: deliberate ${severity} condition.`})
      paintConditions()
    }))
  }
  const clear = button('Clear test conditions')
  clear.className = 'au-debug-clear'
  clear.setAttribute('variant', 'ghost')
  clear.addEventListener('au-activate', () => {
    for (const code of Object.values(CONDITION_CODES)) clearCondition(code, CONDITION_SUBJECT)
    paintConditions()
  })
  conditions.append(clear)
  function paintConditions(): void {
    const active = new Set([...readConditions().values()].filter(event => event.subject === CONDITION_SUBJECT).map(event => event.name))
    for (const [code, view] of states) {
      view.state.textContent = active.has(code) ? 'Active' : 'Clear'
      view.dot.setAttribute('tone', active.has(code) ? code === CONDITION_CODES.error ? 'danger' : 'warn' : 'ink')
    }
  }
  paintConditions()
  const offConditions = subscribe(paintConditions)
  const scroll = document.createElement('au-scroll-area')
  scroll.className = 'au-debug-scroll'
  scroll.setAttribute('axis', 'y')
  scroll.append(root)
  container.append(scroll)
  const disposeStyles = host.styles?.inject(STYLE, container)
  return () => { offConditions(); disposeStyles?.(); scroll.remove() }
}

export default defineProjection<ProjectionModule>({mount})
