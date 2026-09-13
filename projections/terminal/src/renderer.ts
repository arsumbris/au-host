import {
  type MountHost,
  type TerminalSession,
  type ViewStore,
  type TerminalPromptPreset,
} from '@arsumbris/au-host-sdk'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { readPresentation, watchPresentation } from './presentation'
import xtermCss from '@xterm/xterm/css/xterm.css?inline'

interface TerminalViewState {
  cwd?: string
}

// The terminal's config IS its instance : `cwd` records the shell's working
// directory. The LIVE session is host-owned + ephemeral (not config).
type TerminalConfig = Partial<import('./generated').Terminal>

export function outputOptions(config: TerminalConfig) {
  return {
    scrollback: config.scrollback ?? 10000,
    cursorStyle: config.cursorStyle ?? 'bar',
    cursorBlink:
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      (config.cursorBlink ?? true),
  }
}

// Layout + theme over the host's injected @arsumbris/style tokens (--au-*). xterm's own
// CSS is bundled inline and injected alongside.

// TRANSPARENT on purpose: the CONTAINER owns the surface (its pane card / rail IS the panel), the
// projection is only content. Painting the global canvas token here punches a darker hole through
// the card, so the pane's masthead and its body read as two different surfaces.

const STYLE = `
.au-terminal { position: relative; display: flex; flex-direction: column; height: 100%; width: 100%; background: transparent; padding: var(--au-space-2); min-width: 0; min-height: 0; box-sizing: border-box; }
.au-terminal-viewport { flex: 1; min-height: 0; min-width: 0; }
.au-terminal-viewport .xterm { height: 100%; }
.au-terminal-feedback { position: absolute; inset: var(--au-space-2); display: flex; align-items: center; justify-content: center; gap: var(--au-space-2); font: var(--au-t-xs)/var(--au-lh-base) var(--au-font-sans); color: var(--au-ink-2); pointer-events: none; }
`

// A live xterm + its session, kept alive ACROSS the projection's remount and keyed by
// the pane's stable instance id. A layout reshuffle remounts the projection; rebuilding
// the screen by replaying bytes can garble a full-screen TUI's alternate-screen
// buffer, so we keep the actual xterm and re-parent its DOM.
// The host keeps the pty alive in parallel (the session invariant); this keeps the VIEW
// alive to match. Exit removes the live cache entry while preserving visible output
// until unmount; detached exited views are disposed immediately.
interface LiveTerm {
  term: Terminal
  fitAddon: FitAddon
  element: HTMLElement
  session: TerminalSession
  input: { dispose(): void }
  prompt: TerminalPromptPreset
  shell?: string
  destroy: () => void
  exited: boolean
  disposeView: () => void
}
export const live = new Map<string, LiveTerm>()

/** Poll the shell's live working directory and persist changes to the auto-store
 *  (NOT the git config), so a reopened terminal spawns where you last were. Returns a
 *  stop function. A pty emits no cwd events, so this polls (the host reads it by pid). */
function startCwdCapture(
  session: TerminalSession,
  viewStore: ViewStore | undefined,
): () => void {
  if (!viewStore) return () => {}
  let last: string | undefined
  const tick = async (): Promise<void> => {
    const c = await session.cwd()
    if (c && c !== last) {
      last = c
      viewStore.set({ cwd: c } satisfies TerminalViewState)
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), 5000)
  return () => clearInterval(timer)
}

export function mountTerminal(
  container: HTMLElement,
  host: MountHost,
  preview?: { ready(term: Terminal): void },
): () => void {
  const disposeStyles = host.styles?.inject(`${xtermCss}\n${STYLE}`, container)

  const channel = host.terminal
  if (!channel) {
    const msg = document.createElement('div')
    msg.className = 'au-terminal'
    msg.textContent = 'host exposes no terminal capability'
    container.append(msg)
    return () => {
      disposeStyles?.()
      container.replaceChildren()
    }
  }

  const instanceId = host.instanceId

  // REMOUNT: a live xterm already exists for this pane — re-parent it (its screen, incl.
  // a running TUI, is intact) instead of replaying bytes. No re-attach, no reconstruction.
  const cached = instanceId ? live.get(instanceId) : undefined
  if (cached) {
    container.append(cached.element)
    requestAnimationFrame(() => {
      try {
        cached.fitAddon.fit()
        cached.session.resize(cached.term.cols, cached.term.rows)
      } catch {
        // zero-sized element — the resize observer will fit
      }
    })
    cached.term.focus()
    const observer = new ResizeObserver(() => {
      try {
        cached.fitAddon.fit()
        cached.session.resize(cached.term.cols, cached.term.rows)
      } catch {
        // ignore
      }
    })
    observer.observe(cached.element)
    const stopCwd = startCwdCapture(cached.session, host.viewStore)
    // Re-sync the theme (it may have changed while this pane was unmounted + unobserved).
    const stopTheme = watchPresentation(
      cached.term,
      cached.element,
      () => {
        cached.fitAddon.fit()
        cached.session.resize(cached.term.cols, cached.term.rows)
      },
      () => outputOptions(host.config as TerminalConfig),
    )
    return () => {
      // Unmount = keep the live xterm cached; just detach its DOM + this mount's observers.
      observer.disconnect()
      stopTheme()
      stopCwd()
      cached.element.remove()
      if (cached.exited) cached.disposeView()
      disposeStyles?.()
    }
  }

  // FIRST mount for this pane (or an id-less mount): create the xterm + attach the session.
  const root = document.createElement('div')
  root.className = 'au-terminal'
  container.append(root)

  const term = new Terminal({
    ...readPresentation(root),
    allowTransparency: true,
    scrollback: (host.config as TerminalConfig)?.scrollback ?? 10000,
    cursorStyle: (host.config as TerminalConfig)?.cursorStyle ?? 'bar',
    cursorBlink:
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      ((host.config as TerminalConfig)?.cursorBlink ?? true),
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  const viewport = document.createElement('div')
  viewport.className = 'au-terminal-viewport'
  root.append(viewport)
  term.open(viewport)
  const feedback = document.createElement('div')
  feedback.className = 'au-terminal-feedback'
  feedback.setAttribute('role', 'status')
  const spinner = document.createElement('au-spinner')
  spinner.setAttribute('size', 'sm')
  spinner.setAttribute('aria-hidden', 'true')
  const feedbackText = document.createElement('span')
  feedbackText.textContent = 'Waiting for shell output…'
  feedback.append(spinner, feedbackText)
  root.append(feedback)

  // Spawn cwd: the live cwd we last saved (auto-store) wins, else an authored config
  // default, else the workspace member root (so a terminal opens at the entry, not $HOME).
  const viewStore = preview ? undefined : host.viewStore
  const savedCwd = (viewStore?.get() as TerminalViewState | undefined)?.cwd
  const memberRoot = host.workspace.members?.[0]?.root
  const cwd =
    savedCwd ?? (host.config as TerminalConfig | undefined)?.cwd ?? memberRoot
  const session = channel.attach({
    cwd,
    shell: (host.config as TerminalConfig)?.shell || undefined,
    cols: term.cols,
    rows: term.rows,
    prompt: (host.config as TerminalConfig)?.prompt ?? 'clean',
    command: (host.config as TerminalConfig)?.command,
  })
  // Capture the onData unsubscribe so we can dispose it (a detached-but-alive session must not keep
  // writing into a disposed xterm). Kept live across an id-ful REMOUNT (the cached term reuses it);
  // disposed on the session's onExit (id-ful) or on unmount (id-less).
  let refitFeedback = (): void => {}
  let waitingForOutput = true
  const output = session.onData((chunk) => {
    if (waitingForOutput) { waitingForOutput = false; feedback.remove(); refitFeedback() }
    term.write(chunk)
  })
  const input = term.onData((data) => session.write(data))

  // SHIFT+ENTER → `ESC CR`, the "insert a newline, don't submit" sequence agent CLIs expect.
  //
  // xterm.js sends a bare `\r` for BOTH Enter and Shift+Enter, so the pty cannot tell them
  // apart. The projection supplies the binding because external terminal configuration
  // cannot configure this embedded emulator. The handler belongs to the cached term,
  // so it survives a projection remount.
  // `preventDefault()` is LOAD-BEARING, not defensive. xterm calls this handler from BOTH
  // `_keyDown` and `_keyPress`, and a `false` return only makes that one call bail early — it
  // never calls `preventDefault` itself. So without this, `keydown` is suppressed, `keypress`
  // still fires, and xterm sends the plain CR from there: the binding appears to do nothing.
  // Preventing the default on keydown stops the keypress from being dispatched at all.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    if (e.key !== 'Enter' || !e.shiftKey) return true
    if (e.altKey || e.ctrlKey || e.metaKey) return true // leave the other modifier combos alone
    e.preventDefault()
    session.write('\x1b\r') // ESC CR — newline without submitting in supporting agent CLIs
    return false // handled — stop xterm turning it into a plain CR
  })

  let exited = false
  let viewDisposed = false
  let stopExit = (): void => {}
  const disposeView = (): void => {
    if (viewDisposed) return
    viewDisposed = true
    stopExit()
    term.dispose()
  }
  let entry: LiveTerm | undefined
  stopExit = session.onExit(() => {
    exited = true
    term.options.disableStdin = true
    term.attachCustomKeyEventHandler(() => false)
    input.dispose()
    output()
    session.detach()
    if (entry) entry.exited = true
    if (instanceId && live.get(instanceId) === entry) live.delete(instanceId)
    feedback.remove()
    // Keep final feedback in scrollback, immediately after output, so it follows
    // the transcript through scrolling and resizing rather than covering input.
    term.write('\r\n\x1b[0m\x1b[2m[Shell exited]\x1b[0m\r\n')
    refitFeedback()
    if (!root.isConnected) disposeView()
  })
  if (instanceId) {
    entry = {
      term, fitAddon, element: root, session, input,
      prompt: (host.config as TerminalConfig)?.prompt ?? 'clean',
      shell: (host.config as TerminalConfig)?.shell || undefined,
      exited,
      disposeView,
      destroy: () => {
        stopExit()
        input.dispose()
        output()
        session.detach()
        disposeView()
        if (live.get(instanceId) === entry) live.delete(instanceId)
        session.close()
      },
    }
    if (!exited) live.set(instanceId, entry)
  }

  const refit = (): void => {
    try {
      fitAddon.fit()
      session.resize(term.cols, term.rows)
    } catch {
      // a zero-sized or detached element — ignore; the next resize will fit
    }
  }
  refitFeedback = refit
  const observer = new ResizeObserver(() => refit())
  observer.observe(root)
  requestAnimationFrame(refit)
  if (!preview) term.focus()
  preview?.ready(term)
  const stopCwd = startCwdCapture(session, viewStore)
  // Live-track the --au-* theme tokens (xterm's canvas doesn't follow the CSS cascade).
  const stopTheme = watchPresentation(term, root, refit, () =>
    outputOptions(host.config as TerminalConfig),
  )

  return () => {
    observer.disconnect()
    stopTheme()
    stopCwd()
    if (instanceId) {
      // Keep the live xterm cached across the remount (the session stays alive too);
      // just detach its DOM. Disposal happens on the session's onExit.
      root.remove()
      if (exited) { stopExit(); disposeView() }
      disposeStyles?.()
    } else {
      // No cache + no stable id → this session can NEVER be re-attached, so close() it (detach()
      // would orphan the pty forever). Dispose the onData too (no cached term to keep it for).
      input.dispose()
      output()
      stopExit()
      session.close()
      disposeView()
      disposeStyles?.()
      container.replaceChildren()
    }
  }
}
