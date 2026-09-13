import { mountHistory } from './history'
import type { MountHost } from '@arsumbris/au-host-sdk'
import type { AgentProfileData, DiscoveredAdapter, HostApp } from '@arsumbris/au-host-app'
import { openPaneIntent, showPaneIntent } from '@arsumbris/intent'
import { button, text } from './controls'
import { profileRef, profileSummary, refBody } from './model'
import { openSessionOptions, adapterLabel } from './options'
import { mountMist, type MistHandle } from '@arsumbris/au-host-launcher/mist'
import { STYLE } from './style'
import {prepareProfileTerminal, copyTerminalCommand} from './launch-command'
type Config = Pick<
  import('./generated').AgentSessionLauncher,
  'profile' | 'prompt'
>
export function mountLauncher(
  container: HTMLElement,
  base: MountHost,
  initialHistory = false,
): () => void {
  const host = base as HostApp
  let config = { ...((host.config as Config) ?? {}) },
    profiles: AgentProfileData[] = [],
    adapters: DiscoveredAdapter[] = [],
    selected = '',
    // The ad-hoc adapter choice for THIS launcher (session-local), used when the selected profile
    // pins none and ≥2 adapters are discovered (no hard default). A profile's own pin wins over it.
    adapterOverride: string | undefined,
    busy = false,
    copying = false,
    alive = true,
    prepared: unknown,
    focusMoved = false
  const root = text('section', '', 'sessions-launcher')
  root.setAttribute('aria-label', 'New agent session')
  const content = text('div', '', 'sessions-start-content')
  const intro = text('div', '', 'sessions-start-intro')
  const heading = text('h2', 'Start an agent session', 'sessions-empty-message')
  const guidance = text(
    'p',
    'Start a new session above.',
    'sessions-empty-guidance',
  )
  const context = button(
    '',
    () => host.intent.fire(showPaneIntent('agent-profiles')),
    'ghost',
  )
  context.className = 'sessions-profile-pill'
  const profileGear = document.createElement('au-icon')
  profileGear.setAttribute('name', 'gear')
  profileGear.setAttribute('size', 'xs')
  profileGear.setAttribute('aria-hidden', 'true')
  context.append(profileGear, text('span', 'Edit session profiles'))
  const mistCanvas = document.createElement('canvas')
  mistCanvas.className = 'sessions-empty-mist'
  mistCanvas.setAttribute('aria-hidden', 'true')
  intro.append(mistCanvas, heading, guidance, context)
  const feedback = text('p', '', 'sessions-feedback')
  feedback.setAttribute('role', 'status')
  const pending = text('div', '', 'sessions-launch-pending')
  pending.hidden = true
  const pendingSpinner = document.createElement('au-spinner')
  pendingSpinner.setAttribute('size', 'sm')
  pending.append(pendingSpinner)
  const details = document.createElement('au-accordion-item')
  details.setAttribute('label', 'Launch details')
  details.setAttribute('density', 'compact')
  details.hidden = true
  const errorOutput = text('pre', '', 'sessions-error-detail')
  details.append(errorOutput)
  const start = button('New session', () => void launch(), 'cta')
  const copyStart = button('Copy start command', () => void launch(true), 'ghost')
  copyStart.title = 'Copy the selected profile command for your own terminal'
  copyStart.className = 'sessions-copy-command'
  const copyIcon = document.createElement('au-icon')
  copyIcon.setAttribute('name', 'copy')
  copyIcon.setAttribute('aria-hidden', 'true')
  copyStart.replaceChildren(copyIcon, text('span', 'Copy start command'))
  const startIcon = document.createElement('au-icon')
  startIcon.setAttribute('name', 'plus')
  startIcon.setAttribute('aria-hidden', 'true')
  start.className = 'sessions-start-button'
  const startLabel = text('span', 'New session', 'sessions-start-label')
  start.replaceChildren(startIcon, startLabel)
  let menu: { close(): void } | undefined
  const picker = button('Session options', () => openOptions(), 'outline')
  picker.setAttribute('aria-haspopup', 'dialog')
  picker.className = 'sessions-profile-trigger'
  const pickerChevron = document.createElement('au-icon')
  pickerChevron.setAttribute('name', 'chevron-down')
  pickerChevron.setAttribute('size', 'xs')
  pickerChevron.setAttribute('aria-hidden', 'true')
  const pickerAdapter = text('span', '', 'sessions-trigger-adapter'),
    pickerProfile = text('span', '', 'sessions-trigger-profile')
  const pickerGear = document.createElement('au-icon')
  pickerGear.setAttribute('name', 'gear')
  pickerGear.setAttribute('size', 'sm')
  pickerGear.setAttribute('aria-hidden', 'true')
  pickerGear.className = 'sessions-trigger-gear'
  picker.replaceChildren(pickerGear, pickerAdapter, pickerProfile, pickerChevron)
  const row = text('div', '', 'sessions-launch-row')
  row.append(start, picker)
  let disposeHistory: (() => void) | undefined
  function showHistory() {
    if (disposeHistory) return
    delete root.dataset.historyReturn
    root.dataset.history = 'true'
    disposeHistory = mountHistory(host, root, adapters, async id => {
      if (!host.mcp.launchAgentSession) throw Error('Agent launch is unavailable')
      const result = await host.mcp.launchAgentSession({ resumeSession: id })
      if (!alive) return
      if (!result.ok || !result.pane) throw Error(result.error ?? 'Session could not be resumed')
      prepared = { ...(result.pane as Record<string, unknown>), ...(config.prompt ? { prompt: config.prompt } : {}) }
      place()
    }, () => {
      disposeHistory?.(); disposeHistory = undefined
      delete root.dataset.history
      root.dataset.historyReturn = 'true'
      history.focus()
    })
  }
  const history = button('Session history', showHistory, 'ghost')
  history.className = 'sessions-history'
  history.setAttribute('title', 'View and resume closed sessions')
  const historyIcon = document.createElement('au-icon')
  historyIcon.setAttribute('name', 'history')
  historyIcon.setAttribute('aria-hidden', 'true')
  history.replaceChildren(historyIcon, text('span', 'Session history'))
  let openingOptions = false
  async function openOptions() {
    if (menu) {
      menu.close()
      return
    }
    if (openingOptions) return
    openingOptions = true
    picker.setAttribute('loading', '')
    try { await refresh() } finally {
      openingOptions = false
      picker.removeAttribute('loading')
    }
    if (!alive) return
    const selectedProfile = profiles.find((p) => p.path === selected)
    menu = openSessionOptions(
      host,
      picker,
      profiles,
      adapters,
      effectiveAdapter(selectedProfile),
      // Choosable only when the profile pins no adapter AND there is a real choice (≥2 discovered).
      !selectedProfile?.adapter && adapters.length >= 2,
      (name) => {
        adapterOverride = name
        prepared = undefined
        render()
      },
      selected,
      (profile) => {
        selected = profile.path ?? profile.name
        prepared = undefined
        config = {
          ...config,
          profile: profileRef(profile) as Config['profile'],
        }
        host.saveConfig(config)
        render()
      },
      () => host.intent.fire(showPaneIntent('agent-profiles')),
      () => {
        menu = undefined
        picker.setAttribute('aria-expanded', 'false')
      },
      selectedProfile ? () => void launch(true) : undefined,
    )
    picker.setAttribute('aria-expanded', String(!!menu))
  }
  const service = button(
    'Service setup',
    () => host.intent.fire(showPaneIntent('daemon-control')),
    'ghost',
  )
  service.hidden = true
  content.append(row, copyStart, history, pending, feedback, service, details)
  root.append(intro, content)
  container.append(root)
  const release = host.styles?.inject(STYLE, container)
  const isDefault = (p: AgentProfileData) =>
    config.profile &&
    [p.path, p.name, p.path?.replace(/\.ya?ml$/, '')].includes(
      refBody(config.profile).split('::')[0],
    )
  // The adapter a launch will use: the profile's pin, else the ad-hoc override, else the single
  // discovered adapter. Undefined when ≥2 are discovered and nothing is chosen — the launch
  // then surfaces main's "choose" error and the options popover's adapter section resolves it.
  const effectiveAdapter = (p?: AgentProfileData): string | undefined =>
    p?.adapter ?? adapterOverride ?? (adapters.length === 1 ? adapters[0].name : undefined)
  // The label for the launch trigger. When no adapter is settled yet and ≥2 are discovered, the launch
  // would hit main's "choose one" error, so the label is an actionable prompt that draws the user into
  // the options popover's adapter picker instead of a false "Default adapter".
  const adapterTriggerLabel = (p?: AgentProfileData): string => {
    const eff = effectiveAdapter(p)
    return !eff && adapters.length >= 2 ? 'Choose adapter' : adapterLabel(adapters, eff)
  }

  function render() {
    const p = profiles.find((p) => p.path === selected)
    guidance.textContent = p ? profileSummary(p) : 'Create a reusable profile to choose context, skills and tools.'
    context.setAttribute(
      'aria-label',
      `Configure session profiles — ${adapterTriggerLabel(p)}, ${p?.name ?? 'choose profile'}`,
    )
    start.disabled = busy && copying
    copyStart.disabled = busy || !p
    start.loading = busy && !copying
    copyStart.loading = busy && copying
    feedback.hidden = busy && copying
    root.setAttribute('aria-busy', String(busy && !copying))
    pending.hidden = !busy || copying
    if (busy) pending.append(feedback)
    else pending.after(feedback)
    startLabel.textContent = busy && !copying
      ? 'Starting…'
      : prepared
        ? 'Open ready session'
        : p ? 'New session' : 'Create profile'
    start.setAttribute('aria-label', startLabel.textContent ?? 'New session')
    start.title = startLabel.textContent ?? 'New session'
    start.setAttribute('variant', spacious ? 'cta' : 'outline')
    picker.setAttribute('variant', spacious ? 'outline' : 'ghost')
    start.setAttribute('size', 'sm')
    picker.setAttribute('size', 'sm')
    picker.disabled = busy || !!prepared
    pickerAdapter.textContent = adapterTriggerLabel(p)
    pickerProfile.textContent = p?.name ?? 'Profile'
    picker.setAttribute(
      'aria-label',
      `Session options — ${p?.name ?? 'choose profile'}, ${adapterTriggerLabel(p)}`,
    )
  }
  async function refresh() {
    try {
      const [result, discovered] = await Promise.all([host.mcp.listProfiles(), host.mcp.listAdapters()])
      if (!alive || busy) return
      profiles = result
      adapters = discovered
      if (!profiles.some((p) => p.path === selected))
        selected =
          profiles.find(isDefault)?.path ??
          profiles.find((p) => p.name === 'main')?.path ??
          profiles[0]?.path ??
          ''
      render()
    } catch (error) {
      if (alive)
        feedback.textContent = `Profiles unavailable: ${message(error)}`
    }
  }
  function place() {
    if (!prepared) return
    // intent.fire is fire-and-forget (void), so dispatch and assume the focused session area
    // handles it — there is no synchronous claimed/declined signal to branch the feedback on.
    host.intent.fire(openPaneIntent(prepared))
    prepared = undefined
    feedback.textContent = ''
    render()
  }
  async function copyPreparedCommand(pane: unknown): Promise<void> {
    await copyTerminalCommand(pane)
    feedback.dataset.copied = 'true'
    feedback.textContent = config.prompt
      ? 'Command copied. Paste it into your terminal; enter the preset prompt there separately.'
      : 'Start command copied. Paste it into your terminal.'
  }
  async function launch(copyOnly = false) {
    if (busy) return
    if (prepared) {
      if (copyOnly) {
        try { await copyPreparedCommand(prepared) } catch (error) { feedback.textContent = message(error) }
      } else place()
      return
    }
    const profile = profiles.find((p) => p.path === selected)
    if (!profile) {host.intent.fire(showPaneIntent('agent-profiles'));return}
    if (!effectiveAdapter(profile) && adapters.length >= 2) { openOptions(); return }
    const snapshot = structuredClone(profile),
      promptPreset = config.prompt
    busy = true
    copying = copyOnly
    delete feedback.dataset.copied
    focusMoved = false
    feedback.textContent = 'Checking workspace services…'
    service.hidden = true
    details.hidden = true
    render()
    try {
      const pane = await prepareProfileTerminal(host, snapshot, effectiveAdapter(snapshot))
      if (!alive) return
      if (copyOnly) {
        await copyPreparedCommand(pane)
        busy = false
        render()
        return
      }
      prepared = {
        ...(pane as Record<string, unknown>),
        ...(promptPreset ? { prompt: promptPreset } : {}),
      }
      busy = false
      if (focusMoved) {
        feedback.textContent =
          'Your session is ready. Open it when you are ready.'
        render()
      } else place()
    } catch (error) {
      if (alive) {
        const diagnostic = message(error)
        feedback.textContent =
          diagnostic.match(
            /(?:Error(?: \[.*?\])?:|launch failed:) ([^\n]+)/,
          )?.[1] ??
          diagnostic.split('\n')[0] ??
          'The session could not start.'
        errorOutput.textContent = diagnostic
        details.hidden = !diagnostic.includes('\n')
        service.hidden = false
      }
    } finally {
      if (alive) {
        busy = false
        copying = false
        render()
      }
    }
  }
  const trackKeyboard = (event: KeyboardEvent) => {
    if (busy && event.key === 'Tab') focusMoved = true
  }
  const track = (event: Event) => {
    if (busy && !event.composedPath().includes(root)) focusMoved = true
  }
  document.addEventListener('pointerdown', track, true)
  document.addEventListener('keydown', trackKeyboard, true)
  let mist: MistHandle | undefined
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const syncMist = () => {
    mist?.destroy()
    mist = undefined
    if (!spacious) return
    try {
      mist = mountMist(mistCanvas, {
        root,
        params: {
          alpha: 0.65,
          covLo: 0.2,
          covHi: 0.65,
          flow: 0.045,
          glow: 0,
          mouseAmt: 0,
          scale: 0.4,
          fps: 20,
        },
      })
    } catch (error) {
      console.warn('Session mist unavailable', error)
    }
  }
  motion.addEventListener('change', syncMist)
  let spacious: boolean | undefined
  const updatePresentation = () => {
    const { width, height } = container.getBoundingClientRect()
    root.dataset.narrow = String(width < 300)
    // Keep a readable profile alongside the launch action until only an icon fits.
    root.dataset.iconPicker = String(width < 240)
    const next = height >= 320
    if (next === spacious) return
    root.dataset.spacious = String(next)
    row.replaceChildren(...(next ? [picker, start] : [start, picker]))
    spacious = next
    render()
    syncMist()
  }
  const resize = new ResizeObserver(updatePresentation)
  resize.observe(container)
  const releaseConfig = host.onOwnConfigChange?.((next) => {
    config = { ...(next as Config) }
    selected = profiles.find(isDefault)?.path ?? selected
    render()
  })
  void refresh().then(() => { if (alive && initialHistory) showHistory() })
  const timer = setInterval(() => void refresh(), 3000)
  return () => {
    alive = false
    disposeHistory?.()
    motion.removeEventListener('change', syncMist)
    mist?.destroy()
    resize.disconnect()
    menu?.close()
    releaseConfig?.()
    clearInterval(timer)
    document.removeEventListener('pointerdown', track, true)
    document.removeEventListener('keydown', trackKeyboard, true)
    release?.()
    root.remove()
  }
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
