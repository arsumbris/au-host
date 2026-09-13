// Read-only status projection over the daemon capability: vault, state, and engine version.
// Local capability shapes describe the daemon data consumed by this projection.

import { defineProjection, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk'
import type {
  DaemonStatus,
  HostApp,
  McpStatus,
} from '@arsumbris/au-host-app'

// Local shapes for the host capabilities this projection reads.

// `engineReady` is a MountHost contract capability now (optional; inherited). daemon/mcp stay app-owned.

const POLL_INTERVAL_MS = 2000

const STYLE = `
/* No own background: the status-bar is CONTENT sitting on the bar's surface (the bar provides
   the chrome strip). Transparent so it reads as one coherent bar, not a floating pill. */
/* LOGICAL properties so the box renders identically in either orientation (the container rotates
   us via writing-mode): padding-inline is the start/end padding along the reading axis (left/right
   horizontal, top/bottom vertical); padding-block + min-block-size are the CROSS axis (the bar's
   thickness). Physical padding/min-height would inflate the thickness + drop the start/end pad
   when rotated. */
/* STYLING CONTRACT: every value is an --au-* token, no literals. No var() FALLBACKS either — every
   token here is @property-registered in @arsumbris/style, which the renderer loads unconditionally
   (tokens.css + ext.css), so a fallback arm is unreachable and would only be a second value that can
   disagree with the token. */
.au-statusbar { font-family: var(--au-font-mono); font-size: var(--au-t-2xs); line-height: var(--au-lh-2xs); letter-spacing: var(--au-ls-mono); display: flex; align-items: center; gap: var(--au-space-2); height: 100%; min-block-size: var(--au-status-h); padding-block: 0; padding-inline: var(--au-space-3); box-sizing: border-box; color: var(--au-ink-3); white-space: nowrap; overflow: hidden; }
/* The dot's diameter is space-1 + space-0-5, aligned to the 4px baseline. */
.au-statusbar-dot { width: calc(var(--au-space-1) + var(--au-space-0-5)); height: calc(var(--au-space-1) + var(--au-space-0-5)); border-radius: var(--au-radius-pill); flex: none; }
/* tone as a POINT OF INK — the semantic three are permitted on the dot itself, nowhere else here. */
.au-statusbar-dot.ready { background: var(--au-color-ok); }
.au-statusbar-dot.starting { background: var(--au-color-warn); }
.au-statusbar-dot.stopped { background: var(--au-color-danger); }
/* hierarchy is the INK LADDER (state -> entry -> mcp -> detail), not opacity fades: an opacity fade
   composites against whatever is behind and so ignores the theme, where an ink tier is themeable.
   Weight is medium, never bold. */
.au-statusbar-state { color: var(--au-ink-1); font-weight: var(--au-w-medium); }
.au-statusbar-state, .au-statusbar-entry, .au-statusbar-detail { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
.au-statusbar-mcp { flex-shrink: 0; }
.au-statusbar-entry, .au-statusbar-detail { flex: 1 1 0; }
.au-statusbar-entry { color: var(--au-ink-2); }
.au-statusbar-detail { color: var(--au-ink-4); overflow: hidden; text-overflow: ellipsis; }
.au-statusbar-mcp { color: var(--au-ink-3); }
.au-statusbar-spacer { flex: 1; }
/* The parent bar rotates vertical content. This projection only adjusts packing:
   drop the spacer and forced height so status parts pack from the top and fit
   within the rotated slot. */
.au-statusbar.vertical { height: auto; }
.au-statusbar.vertical .au-statusbar-spacer { display: none; }
`

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i >= 0 ? trimmed.slice(i + 1) : trimmed
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const daemon = (host as HostApp).daemon
  const mcp = (host as HostApp).mcp
  const engineReady = (host as HostApp).engineReady

  const root = document.createElement('div')
  root.className = 'au-statusbar'
  // CONTAINER AXIS CONTEXT (host-compositor): the bar ROTATES each vertical slot itself now (the
  // container-owned default), so the status-bar inherits the rotation + the
  // left-edge flip and adds NO rotation code. It reads `data-au-axis` only for its own PACKING
  // (drop the flex spacer when vertical so the parts pack from the top). Absent (e.g. in a pane) →
  // horizontal default. Re-read on remount (reposition remounts).
  if (container.dataset.auAxis === 'vertical') root.classList.add('vertical')
  const disposeStyles = host.styles?.inject(STYLE, container)

  // Deliberately NOT the design kit's <StatusDot>: that is a React component and this projection is
  // plain DOM with no React in its bundle, and its tone set is ink|ok only — it cannot express the
  // warn/danger third of running/deriving/stopped. So the markup stays hand-rolled and only its
  // VALUES are tokenized, against StatusDot's own diameter recipe (see the sheet above).
  const dot = document.createElement('span')
  dot.className = 'au-statusbar-dot stopped'
  const state = document.createElement('span')
  state.className = 'au-statusbar-state'
  state.textContent = '—'
  // The mcp daemon, a second dot + label right beside the engine one.
  const mcpDot = document.createElement('span')
  mcpDot.className = 'au-statusbar-dot stopped'
  const mcpState = document.createElement('span')
  mcpState.className = 'au-statusbar-mcp'
  mcpState.textContent = 'mcp'
  const entryEl = document.createElement('span')
  entryEl.className = 'au-statusbar-entry'
  if (daemon) {
    entryEl.textContent = basename(daemon.config.entryPath)
    entryEl.title = daemon.config.entryPath
  }
  const spacer = document.createElement('span')
  spacer.className = 'au-statusbar-spacer'
  const detail = document.createElement('span')
  detail.className = 'au-statusbar-detail'

  const mcpParts = mcp ? [mcpDot, mcpState] : []
  root.append(dot, state, ...mcpParts, entryEl, spacer, detail)
  container.appendChild(root)

  let alive = true

  function render(status: DaemonStatus): void {
    const running = status.running
    const ready = status.probe?.ready ?? false
    const kind = running ? (ready ? 'ready' : 'starting') : 'stopped'
    dot.className = `au-statusbar-dot ${kind}`
    state.textContent = running ? (ready ? 'ready' : 'deriving') : 'stopped'
    detail.textContent = status.probe
      ? `engine=${status.probe.engine ?? '?'} ref=${status.probe.refState ?? '?'} v${status.probe.version ?? '-'}` +
        (status.schemaVersion !== undefined ? ` · schema ${status.schemaVersion}` : '')
      : ''
    detail.title = detail.textContent
  }

  function renderMcp(status: McpStatus): void {
    const kind = status.running ? (status.listening ? 'ready' : 'starting') : 'stopped'
    mcpDot.className = `au-statusbar-dot ${kind}`
    mcpState.title = `MCP ${status.running ? (status.listening ? 'ready' : 'starting') : 'stopped'}`
    mcpState.setAttribute('aria-label', mcpState.title)
  }

  async function refresh(): Promise<void> {
    if (!daemon) {
      state.textContent = 'no daemon surface'
      return
    }
    try {
      const [status, mcpStatus] = await Promise.all([daemon.status(), mcp?.status()])
      if (!alive) return
      render(status)
      if (mcpStatus) renderMcp(mcpStatus)
    } catch {
      if (alive) state.textContent = 'daemon status unavailable'
    }
  }

  void refresh()
  // Only poll when there's a daemon surface to poll (no point firing a no-op every 2s).
  const timer = daemon ? setInterval(() => void refresh(), POLL_INTERVAL_MS) : undefined
  // Refresh immediately on the readiness edge (faster than the next poll).
  const offReady = engineReady?.subscribe(() => {
    if (alive) void refresh()
  })

  return () => {
    disposeStyles?.()
    alive = false
    if (timer) clearInterval(timer)
    offReady?.()
    container.replaceChildren()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
