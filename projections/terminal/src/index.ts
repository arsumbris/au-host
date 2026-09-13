import {
  defineProjection,
  type MountHost,
  type ProjectionModule,
  type TerminalPreferences,
  type TerminalPromptPreset,
} from '@arsumbris/au-host-sdk'
import { showPaneIntent } from '@arsumbris/intent'
import { mountSettings } from './settings'
import { mountTerminal, live } from './renderer'
type TerminalConfig = Partial<import('./generated').Terminal>

const PRESETS: { value: TerminalPromptPreset; label: string }[] = [
  { value: 'clean', label: 'Clean' },
  { value: 'raw', label: 'Raw · $' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'compact-git', label: 'Compact Git' },
  { value: 'context', label: 'Context' },
  { value: 'inherit', label: 'Use my existing prompt' },
]

function mount(container: HTMLElement, host: MountHost): () => void {
  let preferences: TerminalPreferences = {
    shell: '',
    prompt: 'clean',
    scrollback: 10000,
    cursorStyle: 'bar',
    cursorBlink: true,
  }
  let mounted = true
  const effective = () => ({ ...preferences, ...config })
  let config = { ...(host.config ?? {}) } as TerminalConfig
  const shell = document.createElement('div')
  shell.className = 'au-terminal-pane'
  const toolbar = document.createElement('div')
  toolbar.className = 'au-terminal-toolbar'
  const select = document.createElement('au-select') as HTMLElement & {
    options: typeof PRESETS
    value: string
    label: string
  }
  select.options = [
    { value: 'default', label: 'Use device default' },
    ...PRESETS,
  ] as typeof PRESETS
  select.value = config.prompt ?? 'default'
  select.label = 'Terminal prompt'
  select.title = 'Prompt preset · zsh and bash'
  const restart = document.createElement('au-button')
  restart.setAttribute('variant', 'outline')
  restart.setAttribute('size', 'sm')
  restart.textContent = 'Restart to apply'
  restart.title =
    'Ends the current shell and its running command, then starts the selected prompt'
  const body = document.createElement('div')
  body.className = 'au-terminal-body'
  select.setAttribute('size', 'sm')
  const pending = document.createElement('span')
  pending.className = 'au-terminal-pending'
  pending.setAttribute('role', 'status')
  const defaults = document.createElement('au-button')
  defaults.textContent = 'Terminal defaults and appearance…'
  defaults.setAttribute('variant', 'ghost')
  defaults.addEventListener('au-activate', () => {
    settingsMenu?.close()
    host.intent.fire(showPaneIntent('terminal-settings'))
  })
  const shellInput = document.createElement('au-input') as HTMLElement & {
    value: string
  }
  shellInput.setAttribute('aria-label', 'Shell override')
  shellInput.setAttribute('placeholder', 'Shell: use device default')
  shellInput.value = config.shell ?? ''
  shellInput.addEventListener('au-input', () => {
    if (shellInput.value.trim()) config.shell = shellInput.value.trim()
    else delete config.shell
    host.saveConfig(config)
    refresh()
  })
  const scrollbackInput = document.createElement('au-input') as HTMLElement & {
    value: string
  }
  scrollbackInput.setAttribute('aria-label', 'Scrollback override')
  scrollbackInput.setAttribute('placeholder', 'Scrollback: use device default')
  scrollbackInput.value =
    config.scrollback === undefined ? '' : String(config.scrollback)
  scrollbackInput.addEventListener('au-input', () => {
    const raw = scrollbackInput.value.trim(),
      n = Number(raw)
    if (raw && (!Number.isInteger(n) || n < 0 || n > 100000)) {
      pending.hidden = false
      pending.textContent = 'Scrollback must be 0–100000 lines.'
      return
    }
    if (raw) config.scrollback = n
    else delete config.scrollback
    Object.assign(runtimeConfig, effective())
    applyOutput()
    host.saveConfig(config)
    refresh()
  })
  const field = (label: string, hint: string, control: HTMLElement) => {
    const wrapper = document.createElement('au-field')
    wrapper.setAttribute('label', label)
    wrapper.setAttribute('hint', hint)
    wrapper.append(control)
    return wrapper
  }
  toolbar.append(
    field('Prompt', 'Applies when a new shell starts.', select),
    field('Shell', 'Blank uses the device default. Applies to a new shell.', shellInput),
    field('Scrollback', 'Output lines retained: 0–100000. Applies immediately; blank uses the device default.', scrollbackInput),
    restart,
    pending,
    defaults,
  )
  shell.append(body)
  let settingsMenu: { close(): void } | undefined
  let menuStyles: (() => void) | undefined
  const openSettings = (anchor: DOMRect): void => {
    settingsMenu?.close()
    settingsMenu = host.popover?.open(
      anchor,
      (element) => {
        menuStyles = host.styles?.inject(presentationStyle, element)
        const panel = document.createElement('au-popover') as HTMLElement & {
          arrow: boolean
        }
        panel.arrow = false
        panel.setAttribute('heading', 'This terminal')
        panel.style.width = 'min(320px, calc(100vw - 32px))'
        panel.append(toolbar)
        element.append(panel)
      },
      () => {
        menuStyles?.()
        settingsMenu = undefined
      },
    )
  }
  const contextMenu = (event: MouseEvent): void => {
    if (!host.contextMenu || !host.popover) return
    event.preventDefault()
    event.stopPropagation()
    host.contextMenu.open({ x: event.clientX, y: event.clientY }, [
      {
        id: 'terminal.settings',
        label: 'Terminal settings…',
        icon: 'gear',
        enabled: true,
        run: () => openSettings(new DOMRect(event.clientX, event.clientY, 0, 0)),
      },
    ])
  }
  shell.addEventListener('contextmenu', contextMenu)
  container.append(shell)
  const presentationStyle = `
    .au-terminal-pane { position:relative; height:100%; min-height:0; display:flex; flex-direction:column; }
    .au-terminal-toolbar { flex:none; display:flex; flex-direction:column; align-items:stretch; gap:var(--au-space-4); padding:var(--au-space-2); font:var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); }
    .au-terminal-toolbar au-select { width:100%; min-width:0; max-width:100%; }
    .au-terminal-settings { flex:none; border-top:1px solid var(--au-line-1); --au-accordion-pad-x:var(--au-space-2); --au-accordion-indent:0px; }
    .au-terminal-label, .au-terminal-pending { color:var(--au-ink-3); }
    .au-terminal-pending { flex-basis:100%; }
    .au-terminal-toolbar [hidden] { display:none!important; }
    .au-terminal-load-error { padding:var(--au-space-6); display:flex; flex-direction:column; align-items:flex-start; gap:var(--au-space-3); }
    .au-terminal-body { flex:1; min-height:0; min-width:0; overflow:hidden; }
  `
  const styles = host.styles?.inject(presentationStyle, container)
  let active = host.instanceId
    ? (live.get(host.instanceId)?.prompt ?? config.prompt ?? 'clean')
    : (config.prompt ?? 'clean')
  const refresh = (): void => {
    const changed =
      active !== effective().prompt ||
      (host.instanceId ? live.get(host.instanceId)?.shell : undefined) !==
        (effective().shell || undefined)
    restart.hidden = !changed
    pending.hidden = !changed
    pending.textContent = changed
      ? `Running: ${PRESETS.find((p) => p.value === active)?.label}. Restart ends this shell and its current command.`
      : ''
    select.title = `Prompt: ${PRESETS.find((p) => p.value === (config.prompt ?? 'clean'))?.label} · change applies to a new shell`
  }
  let dispose = () => {}
  const runtimeConfig = effective()
  const applyOutput = () => {
    const cached = host.instanceId ? live.get(host.instanceId) : undefined
    if (cached) {
      const e = effective()
      cached.term.options.scrollback = e.scrollback
      cached.term.options.cursorStyle = e.cursorStyle
      cached.term.options.cursorBlink =
        e.cursorBlink && !matchMedia('(prefers-reduced-motion: reduce)').matches
    }
  }
  const initialize = () => {
    if (!mounted) return
    Object.assign(runtimeConfig, effective())
    dispose = mountTerminal(body, { ...host, config: runtimeConfig })
    applyOutput()
    active = host.instanceId
      ? (live.get(host.instanceId)?.prompt ?? effective().prompt)
      : effective().prompt
    refresh()
  }
  const loadPreferences = (): void => {
    if (!mounted) return
    body.replaceChildren()
    if (!host.terminalPreferences) { initialize(); return }
    const loading = document.createElement('div')
    loading.className = 'au-terminal-load-error'
    loading.setAttribute('role', 'status')
    const spinner = document.createElement('au-spinner')
    spinner.setAttribute('size', 'sm')
    spinner.setAttribute('aria-hidden', 'true')
    loading.append(spinner, 'Loading terminal settings…')
    body.append(loading)
    void host.terminalPreferences
      .get()
      .then((value) => {
        preferences = value
        if (mounted) body.replaceChildren()
        initialize()
      })
      .catch((error) => {
        if (!mounted) return
        const message = document.createElement('p')
        message.className = 'au-terminal-pending'
        message.setAttribute('role', 'alert')
        message.textContent = `Terminal settings could not load: ${String(error)}`
        const retry = document.createElement('au-button')
        retry.textContent = 'Retry settings'
        retry.setAttribute('variant', 'outline')
        retry.setAttribute('size', 'sm')
        retry.addEventListener('au-activate', () => {retry.setAttribute('disabled', ''); loadPreferences()})
        const recovery = document.createElement('div')
        recovery.className = 'au-terminal-load-error'
        recovery.append(message, retry)
        body.replaceChildren(recovery)
      })
  }
  loadPreferences()
  const offPreferences = host.terminalPreferences?.subscribe((value) => {
    preferences = value
    Object.assign(runtimeConfig, effective())
    applyOutput()
    refresh()
  })
  refresh()
  select.addEventListener('au-change', (event) => {
    const value = (event as CustomEvent<{ value: TerminalPromptPreset }>).detail
      .value
    if (String(value) === 'default') delete config.prompt
    else {
      if (!PRESETS.some((p) => p.value === value)) return
      config = { ...config, prompt: value }
    }
    refresh()
    host.saveConfig(config)
  })
  restart.addEventListener('au-activate', () => {
    if (
      !window.confirm(
        config.command
          ? 'End this agent process and run its launch command again? This creates a fresh process, not a resumed conversation.'
          : 'End this shell and start a new one? Running commands will stop.',
      )
    )
      return
    dispose()
    if (host.instanceId) live.get(host.instanceId)?.destroy()
    Object.assign(runtimeConfig, effective())
    active = runtimeConfig.prompt
    dispose = mountTerminal(body, { ...host, config: runtimeConfig })
    refresh()
  })
  const offConfig = host.onOwnConfigChange?.((next) => {
    config = { ...(next as TerminalConfig) }
    Object.assign(runtimeConfig, effective())
    select.value = config.prompt ?? 'default'
    shellInput.value = config.shell ?? ''
    scrollbackInput.value =
      config.scrollback === undefined ? '' : String(config.scrollback)
    applyOutput()
    refresh()
  })
  return () => {
    offConfig?.()
    mounted = false
    offPreferences?.()
    settingsMenu?.close()
    shell.removeEventListener('contextmenu', contextMenu)
    dispose()
    styles?.()
    shell.remove()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<
  ProjectionModule & { settings: typeof mountSettings }
>({ mount, settings: mountSettings })
