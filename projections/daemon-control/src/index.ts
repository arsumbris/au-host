import { mountMcpConfiguration } from './mcp-configuration'
import { STYLE } from './style'
import { defineProjection, type ProjectionModule, type MountHost } from '@arsumbris/au-host-sdk'
import type { ActionResult, DaemonStatus, HostApp, McpStatus } from '@arsumbris/au-host-app'
import { showPaneIntent } from '@arsumbris/intent'

type AuCheckboxEl = HTMLElement & { checked: boolean; indeterminate: boolean; disabled: boolean }
const createAuCheckbox = (): AuCheckboxEl => {
  const el = document.createElement('au-checkbox') as AuCheckboxEl
  el.setAttribute('size', 'sm') // daemon-control's rows are dense lists — the small box
  return el
}

// A vanilla-created `<au-button>`, typed STRUCTURALLY (set-independent). Emits `au-activate`
// (composed + bubbling), so a consumer listens for `au-activate`, not `click`. `disabled` is a
// reflected boolean property. size=small for daemon-control's dense rows.
type AuButtonEl = HTMLElement & { disabled: boolean; loading: boolean }
const createAuButton = (label: string): AuButtonEl => {
  const el = document.createElement('au-button') as AuButtonEl
  el.setAttribute('size', 'sm') // dense rows — small button (solid default)
  el.setAttribute('variant', 'outline')
  el.textContent = label
  return el
}

// A vanilla-created single-line field / a ✕ close affordance / a streaming log tail, structurally typed.
type AuOutputLogEl = HTMLElement & { lines: readonly string[]; maxLines: number }

/** A collapsible section = a standalone <au-accordion-item> (flush, dense). The accordion owns the
 *  header, the disclosure chevron, the open/close state, and the measured panel animation. Returns the
 *  element (append into `root`), its right-aligned `meta` host (a badge / count), and its `body` (the
 *  default slot). Refresh-on-open rides the item's `au-toggle` event. */
type AuAccordionItemEl = HTMLElement & { open: boolean }
function createSection(label: string): {
  section: AuAccordionItemEl
  meta: HTMLSpanElement
  body: HTMLDivElement
} {
  const section = document.createElement('au-accordion-item') as AuAccordionItemEl
  section.className = 'au-daemon-sec'
  section.setAttribute('label', label)
  section.setAttribute('variant', 'flush')
  section.setAttribute('density', 'compact')
  const meta = document.createElement('span')
  meta.slot = 'meta'
  const body = document.createElement('div')
  body.className = 'au-daemon-sec-body'
  section.append(meta, body)
  return { section, meta, body }
}

const POLL_INTERVAL_MS = 2000
const MAX_LOG_LINES = 500

function mount(container: HTMLElement, host: MountHost): () => void {
  const daemon = (host as HostApp).daemon
  const mcp = (host as HostApp).mcp

  const root = document.createElement('div')
  root.className = 'au-daemon'
  const scroll = document.createElement('au-scroll-area') as HTMLElement & { scrollElement: HTMLElement | null }
  scroll.className = 'au-daemon-scroll'
  scroll.setAttribute('axis', 'y')
  scroll.append(root)

  if (!daemon || !mcp) {
    const empty = document.createElement('au-empty-state')
    empty.setAttribute('label', 'Service controls unavailable')
    empty.setAttribute('hint', 'This host does not provide the required engine and agent-tools controls.')
    root.append(empty)
    container.append(scroll)
    const offStyles = host.styles?.inject(STYLE, container)
    return () => { offStyles?.(); scroll.remove() }
  }

  // Read-only paths — editing lives in the host (the entry is a workspace binding).
  const paths = document.createElement('div')
  paths.className = 'au-daemon-paths'
  const entryLine = document.createElement('div')
  const binaryLine = document.createElement('div')
  entryLine.innerHTML = `Workspace <b>${escapeHtml(daemon.config.entryPath)}</b>`
  binaryLine.innerHTML = `Engine binary <b>${escapeHtml(daemon.config.binaryPath)}</b>`
  paths.append(entryLine, binaryLine)

  // Engine operation tracing (dev). Read by the daemon at SPAWN, so it never affects the running
  // one — the hint says so rather than letting the toggle look inert. The engine writes its trace
  // to `<entry>/.arsumbris/au-engine/logs/trace/`. This `AU_TRACE` is the ENGINE daemon's toggle
  // (au-engine's perfetto tracing), unrelated to the agent launcher below.
  const traceLabel = document.createElement('label')
  traceLabel.className = 'au-daemon-trace'
  const traceBox = createAuCheckbox()
  traceBox.setAttribute('aria-label', 'Engine tracing')
  traceBox.checked = daemon.config.trace === true
  const traceText = document.createElement('span')
  traceText.textContent = 'Engine tracing'
  const traceHint = document.createElement('span')
  traceHint.className = 'au-daemon-trace-hint'
  const paintTrace = (): void => {
    traceHint.textContent = traceBox.checked
      ? 'Enabled for the next engine start.'
      : 'Disabled. Takes effect on the next engine start.'
  }
  paintTrace()
  traceBox.addEventListener('au-change', () => {
    daemon.setTrace(traceBox.checked)
    paintTrace()
  })
  traceLabel.append(traceBox, traceText, traceHint)
  paths.append(traceLabel)

  const row = document.createElement('div')
  row.className = 'au-daemon-row'
  const pill = document.createElement('span')
  pill.className = 'au-daemon-pill stopped'
  pill.textContent = 'Checking…'
  const detail = document.createElement('span')
  detail.className = 'au-daemon-detail'
  const startButton = createAuButton('Start')
  const stopButton = createAuButton('Stop')
  const refreshButton = createAuButton('Refresh')
  const engineDot = document.createElement('au-status-dot')
  const engineName = document.createElement('strong')
  engineName.textContent = 'Engine'
  row.setAttribute('role', 'group')
  row.setAttribute('aria-label', 'Engine service')
  startButton.setAttribute('aria-label', 'Start engine')
  stopButton.setAttribute('aria-label', 'Stop engine')
  refreshButton.setAttribute('aria-label', 'Refresh service status')
  refreshButton.setAttribute('variant', 'ghost')
  const engineActions = document.createElement('div')
  engineActions.className = 'au-daemon-actions'
  engineActions.append(startButton, stopButton)
  const engineIdentity = document.createElement('div')
  engineIdentity.className = 'au-daemon-identity'
  const engineTitle = document.createElement('div')
  engineTitle.className = 'au-daemon-service-title'
  engineTitle.append(engineDot, engineName, pill)
  const enginePurpose = document.createElement('p')
  enginePurpose.textContent = 'Indexes workspace files and serves the graph used by projections.'
  engineIdentity.append(engineTitle, enginePurpose)
  row.append(engineIdentity, engineActions)

  // The mcp daemon (the agent-tools broker), the second row.
  const mcpRow = document.createElement('div')
  mcpRow.className = 'au-daemon-row'
  const mcpPill = document.createElement('span')
  mcpPill.className = 'au-daemon-pill stopped'
  mcpPill.textContent = 'Checking…'
  const mcpStartButton = createAuButton('Start')
  const mcpStopButton = createAuButton('Stop')
  const mcpDot = document.createElement('au-status-dot')
  const mcpName = document.createElement('strong')
  mcpName.textContent = 'Agent tools (MCP)'
  mcpRow.setAttribute('role', 'group')
  mcpRow.setAttribute('aria-label', 'Agent tools service')
  mcpStartButton.setAttribute('aria-label', 'Start MCP')
  mcpStopButton.setAttribute('aria-label', 'Stop MCP')
  const mcpActions = document.createElement('div')
  mcpActions.className = 'au-daemon-actions'
  mcpActions.append(mcpStartButton, mcpStopButton)
  const mcpIdentity = document.createElement('div')
  mcpIdentity.className = 'au-daemon-identity'
  const mcpTitle = document.createElement('div')
  mcpTitle.className = 'au-daemon-service-title'
  mcpTitle.append(mcpDot, mcpName, mcpPill)
  const mcpPurpose = document.createElement('p')
  mcpPurpose.textContent = 'Brokers tools for agent sessions connected to this workspace.'
  mcpIdentity.append(mcpTitle, mcpPurpose)
  mcpRow.append(mcpIdentity, mcpActions)

  const errorLine = document.createElement('div')
  errorLine.className = 'au-daemon-error'
  errorLine.setAttribute('role', 'alert')

  // The daemon + mcp log tail. au-output-log owns the panel look + auto-follow-tail; the empty
  // default-slot text shows until the first line arrives.
  const log = document.createElement('au-output-log') as AuOutputLogEl
  log.className = 'au-daemon-log'
  log.textContent = 'Service output will appear here.'

  const services = document.createElement('section')
  services.className = 'au-daemon-services'
  const serviceHeading = document.createElement('h2')
  serviceHeading.textContent = 'Workspace services'
  const serviceHead = document.createElement('div')
  serviceHead.className = 'au-daemon-heading'
  serviceHead.append(serviceHeading, refreshButton)
  services.append(serviceHead, row, mcpRow)

  const profiles = createAuButton('Session profiles…')
  profiles.setAttribute('variant', 'ghost')
  profiles.addEventListener('au-activate', () => host.intent.fire(showPaneIntent('agent-profiles')))
  const hint = document.createElement('p')
  hint.className = 'au-daemon-hint'
  hint.textContent = 'Start sessions from New session. Configure their adapter and context in Session profiles.'
  services.append(hint, profiles)

  const { section: diagnostics, body: diagnosticsBody } = createSection('Engine configuration')
  diagnostics.setAttribute('sublabel', 'Workspace, binary, protocol and tracing')
  diagnosticsBody.append(paths, detail)
  const { section: mcpConfig, body: mcpConfigBody } = createSection('Agent tools configuration')
  mcpConfig.setAttribute('sublabel', 'MCP CLI path for this device')
  const mcpSettings = mountMcpConfiguration(mcpConfigBody, mcp)
  const configureMcp = createAuButton('Configure')
  configureMcp.setAttribute('aria-label', 'Configure MCP path')
  configureMcp.setAttribute('variant', 'ghost')
  configureMcp.addEventListener('au-activate', () => {
    mcpConfig.open = true
    mcpConfig.scrollIntoView({block:'nearest'})
    mcpConfigBody.querySelector<HTMLElement>('au-input')?.focus()
  })
  mcpActions.append(configureMcp)
  const { section: output, body: outputBody, meta: outputCount } = createSection('Service output')
  output.setAttribute('sublabel', 'Output received while this pane is open')
  outputBody.append(log)
  log.maxLines = MAX_LOG_LINES
  root.append(services, errorLine, diagnostics, mcpConfig, output)
  container.appendChild(scroll)
  const disposeStyles = host.styles?.inject(STYLE, container)

  let alive = true
  let pending = false
  let refreshing = false
  let lastEngine: DaemonStatus | undefined
  let lastMcp: McpStatus | undefined
  const engineNotice = document.createElement('p')
  engineNotice.className = 'au-daemon-service-notice'
  engineNotice.setAttribute('role', 'status')
  engineIdentity.append(engineNotice)
  const mcpNotice = document.createElement('p')
  mcpNotice.className = 'au-daemon-service-notice'
  mcpNotice.setAttribute('role', 'status')
  mcpIdentity.append(mcpNotice)
  const actionButtons = [startButton, stopButton, mcpStartButton, mcpStopButton]
  actionButtons.forEach(button => { button.disabled = true })
  const logLines: string[] = []

  function appendLog(line: string): void {
    logLines.push(line)
    if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES)
    // A FRESH array — au-output-log compares `lines` by identity, so mutating in place would not
    // re-render. The element caps to maxLines and rides the tail down on its own.
    log.lines = logLines.slice()
    outputCount.textContent = `${logLines.length} lines`
  }

  function renderStatus(status: DaemonStatus): void {
    const running = status.running
    const ready = status.probe?.ready ?? false
    // `booting`: a live pid but a silent socket (cold-building or wedged). Reads as "starting", not
    // the false "stopped", and keeps Stop enabled so a wedged non-owned daemon can be reclaimed.
    const booting = status.booting && !running
    engineDot.setAttribute('tone', status.schemaMismatch ? 'danger' : running ? (ready ? 'ok' : 'warn') : booting ? 'warn' : 'ink')
    pill.textContent = status.schemaMismatch ? 'Incompatible' : running ? (ready ? 'Ready' : 'Indexing') : booting ? 'Starting' : 'Stopped'
    engineNotice.textContent = status.schemaMismatch?.message ?? (booting ? 'A process is alive but is not answering yet.' : running && !ready ? 'The engine is responding; the workspace is not ready yet.' : '')
    detail.textContent = [
      `Protocol schema: ${status.schemaVersion}`,
      status.probe ? `Engine: ${status.probe.engine ?? 'unknown'} · References: ${status.probe.refState ?? 'unknown'} · Graph version: ${status.probe.version ?? 'unknown'}` : 'No engine probe available.',
      status.ownedByFrame ? 'Process managed by this window.' : 'No engine process owned by this window.',
    ].join('\n')
    startButton.disabled = pending || running || booting
    stopButton.disabled = pending || (!running && !booting)
  }

  function renderMcp(status: McpStatus): void {
    const running = status.running
    const listening = status.listening
    mcpNotice.textContent = running && !listening ? 'The process is running and waiting for its socket.' : ''
    mcpDot.setAttribute('tone', running ? (listening ? 'ok' : 'warn') : 'ink')
    mcpPill.textContent = running ? (listening ? 'Ready' : 'Starting') : 'Stopped'
    mcpStartButton.disabled = pending || running
    mcpStopButton.disabled = pending || !running
  }

  async function refresh(showPending = false): Promise<void> {
    if (refreshing) return
    refreshing = true
    if (showPending) refreshButton.loading = true
    try {
      const results = await Promise.allSettled([daemon.status(), mcp.status()])
      if (!alive) return
      const [engineResult, mcpResult] = results
      if (engineResult.status === 'fulfilled') {
        lastEngine = engineResult.value
        renderStatus(lastEngine)
      } else {
        lastEngine = undefined
        pill.textContent = 'Unavailable'
        engineDot.setAttribute('tone', 'warn')
        engineNotice.textContent = `Could not read status: ${String(engineResult.reason)}`
        startButton.disabled = stopButton.disabled = true
      }
      if (mcpResult.status === 'fulfilled') {
        lastMcp = mcpResult.value
        renderMcp(lastMcp)
      } else {
        lastMcp = undefined
        mcpPill.textContent = 'Unavailable'
        mcpDot.setAttribute('tone', 'warn')
        mcpNotice.textContent = `Could not read status: ${String(mcpResult.reason)}`
        mcpStartButton.disabled = mcpStopButton.disabled = true
      }
    } finally {
      refreshing = false
      if (alive) refreshButton.loading = false
    }
  }

  startButton.addEventListener('au-activate', () => void run(startButton, () => daemon.start(), 'Engine start failed'))
  stopButton.addEventListener('au-activate', () => void run(stopButton, () => daemon.stop(), 'Engine stop failed'))
  mcpStartButton.addEventListener('au-activate', () => void run(mcpStartButton, () => mcp.start(), 'Agent tools start failed'))
  mcpStopButton.addEventListener('au-activate', () => void run(mcpStopButton, () => mcp.stop(), 'Agent tools stop failed'))
  refreshButton.addEventListener('au-activate', () => {
    void refresh(true)
    void mcpSettings.refresh()
  })
  async function run(button: AuButtonEl, action: () => Promise<ActionResult>, fallback: string): Promise<void> {
    if (pending) return
    pending = true
    button.loading = true
    actionButtons.forEach(actionButton => { actionButton.disabled = true })
    errorLine.textContent = ''
    try {
      const result = await action()
      if (!alive) return
      if (!result.ok) {
        errorLine.textContent = result.error ?? fallback
        if (button === mcpStartButton && mcpSettings.missingPath()) mcpConfig.open = true
      }
    } catch (err) {
      if (alive) errorLine.textContent = `${fallback}: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      pending = false
      if (alive) {
        button.loading = false
        if (lastEngine) renderStatus(lastEngine)
        if (lastMcp) renderMcp(lastMcp)
        await refresh()
      }
    }
  }

  const offLog = daemon.onLog((line) => alive && appendLog(line))
  const offExit = daemon.onExit((code) => alive && appendLog(`[host] daemon child exited (code ${code ?? '?'})`))
  const offMcpLog = mcp.onLog((line) => alive && appendLog(`[mcp] ${line}`))
  const offMcpExit = mcp.onExit((code) => alive && appendLog(`[mcp] daemon exited (code ${code ?? '?'})`))

  void refresh()
  const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)

  return () => {
    alive = false
    disposeStyles?.()
    mcpSettings.dispose()
    clearInterval(timer)
    offLog()
    offExit()
    offMcpLog()
    offMcpExit()
    container.replaceChildren()
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/** The mount export (the locator's `export`, default `mount`). */
// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
