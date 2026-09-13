import type { MountFn, TerminalPreferences } from '@arsumbris/au-host-sdk'
import type { Terminal } from '@xterm/xterm'
import { mountTerminal, outputOptions } from './renderer'
import { readTextPresentation } from './presentation'

const STYLE = `
.terminal-preferences { height:100%; min-height:0; min-width:0; display:flex; flex-direction:column; container-type:inline-size; }
.terminal-preferences [hidden] { display:none!important; }
.terminal-preferences-scroll { flex:1; min-height:0; }
.terminal-preferences-content { box-sizing:border-box; width:100%; max-width:860px; margin-inline:auto; padding:var(--au-space-5); display:flex; flex-direction:column; gap:var(--au-space-5); color:var(--au-ink-1); font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.terminal-preferences-content h2, .terminal-preferences-content h3 { margin:0; font:var(--au-w-strong) var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.terminal-preferences-content p { margin:0; color:var(--au-ink-3); }
.terminal-preferences-section { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,2fr); gap:var(--au-space-5); padding-block:var(--au-space-4); border-top:1px solid var(--au-line-1); }
.terminal-preferences-intro { display:flex; flex-direction:column; gap:var(--au-space-2); }
.terminal-preferences-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--au-space-4); min-width:0; align-content:start; }
.terminal-preferences-fields > p, .terminal-preferences-fields > .terminal-preview-controls, .terminal-preferences-fields > .terminal-preview { grid-column:1/-1; }
.terminal-preferences-field { min-width:0; }
.terminal-preferences-field[data-wide] { grid-column:1/-1; }
.terminal-preferences-footer { flex-shrink:0; border-top:1px solid var(--au-line-1); padding:var(--au-space-3) var(--au-space-5); display:flex; flex-wrap:wrap; align-items:center; gap:var(--au-space-3); font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.terminal-preferences-footer p[data-error] { color:var(--au-color-danger); }
.terminal-preferences-footer p { flex:1 1 240px; margin:0; color:var(--au-ink-3); }
.terminal-preferences-actions { display:flex; flex-wrap:wrap; gap:var(--au-space-2); margin-inline-start:auto; }
.terminal-preview { height:calc(var(--au-space-4)*14); min-width:0; overflow:hidden; border:1px solid var(--au-line-1); border-radius:var(--au-radius-md); background:var(--au-color-surface-1); }
.terminal-preview:empty { display:none; }
.terminal-preview-controls { display:flex; flex-wrap:wrap; align-items:center; gap:var(--au-space-2); }
@container (max-width:620px) { .terminal-preferences-section { grid-template-columns:minmax(0,1fr); } }
@container (max-width:380px) { .terminal-preferences-fields { grid-template-columns:minmax(0,1fr); } }
`
type Input = HTMLElement & { value: string }
type Select = Input & { options: { value: string; label: string }[] }
export const PROMPTS = [
  { value: 'clean', label: 'Clean' },
  { value: 'inherit', label: 'Use shell prompt' },
  { value: 'raw', label: 'Raw · $' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'compact-git', label: 'Compact Git' },
  { value: 'context', label: 'Context' },
]
const node = (tag: string, text = '') => {
  const el = document.createElement(tag)
  el.textContent = text
  return el
}
export const mountSettings: MountFn = (container, host) => {
  const api = host.terminalPreferences
  const root = node('div')
  const scroll = node('au-scroll-area')
  scroll.className = 'terminal-preferences-scroll'
  scroll.setAttribute('axis', 'y')
  root.className = 'terminal-preferences'
  const content = node('div')
  content.className = 'terminal-preferences-content'
  scroll.append(content)
  root.append(scroll)
  container.append(root)
  const release = host.styles?.inject(STYLE, container)
  content.append(
    node('h2', 'Terminal settings'),
    node(
      'p',
      'Device defaults. Individual panes can override these settings.',
    ),
  )
  let alive = true,
    saved: TerminalPreferences | undefined,
    dirty = false,
    busy = false
  const theme = host.theme?.openDraft?.()
  const inputs = new Map<string, Input>()
  const feedback = node('p')
  feedback.setAttribute('role', 'status')
  function clearErrors() {
    feedback.textContent = ''
    feedback.removeAttribute('data-error')
    for (const input of inputs.values()) { input.removeAttribute('error'); if (input.parentElement) (input.parentElement as HTMLElement & { error?: string }).error = undefined }
  }
  function invalid(key: string, message: string): never {
    const input = inputs.get(key)!
    input.setAttribute('error', '')
    input.parentElement?.setAttribute('error', message)
    input.scrollIntoView({block:'nearest'})
    input.focus()
    throw Error(message)
  }
  function section(title: string, description: string) {
    const el = node('section')
    el.className = 'terminal-preferences-section'
    el.setAttribute('role', 'group')
    el.setAttribute('aria-label', title)
    const intro = node('div')
    intro.className = 'terminal-preferences-intro'
    intro.append(node('h3', title), node('p', description))
    const fields = node('div')
    fields.className = 'terminal-preferences-fields'
    el.append(intro, fields)
    content.append(el)
    return fields
  }
  function field(
    parent: HTMLElement,
    label: string,
    key: string,
    choices?: { value: string; label: string }[],
  ) {
    const group = node('au-field')
    group.className = 'terminal-preferences-field'
    group.setAttribute('label', label)
    const hints: Record<string, string> = {
      '--au-terminal-font-size': '6–72 px',
      '--au-terminal-line-height': 'Line spacing multiplier, 1–3.',
      '--au-terminal-minimum-contrast': 'Adjusts text brightness for contrast. 1 disables adjustment; maximum 21.',
    }
    if (hints[key]) group.setAttribute('hint', hints[key])
    if (key === '--au-font-mono' || key === 'shell' || key === 'prompt') group.setAttribute('data-wide', '')
    const el = node(choices ? 'au-select' : 'au-input') as Select
    el.setAttribute('label', label)
    el.setAttribute('spellcheck', 'false')
    if (choices) {
      el.options = choices
      el.addEventListener('au-change', () => {
        dirty = true
        clearErrors()
      })
    } else
      el.addEventListener('au-input', () => {
        dirty = true
        clearErrors()
      })
    group.append(el)
    parent.append(group)
    inputs.set(key, el)
    return el
  }
  const appearance = section('Text and readability', 'Appearance previews live. Font family is shared with other monospace text in the app.')
  appearance.append(
    node(
      'p',
      'Save and Revert include all pending edits in the shared appearance draft, including edits made elsewhere.',
    ),
  )
  const tokens = [
    ['Monospace font', '--au-font-mono'],
    ['Font size (px)', '--au-terminal-font-size'],
    ['Line height', '--au-terminal-line-height'],
    ['Minimum contrast', '--au-terminal-minimum-contrast'],
  ] as const
  for (const [label, token] of tokens) {
    const el = field(appearance, label, token)
    el.addEventListener('au-input', () => {
      const raw = el.value.trim()
      if (token === '--au-font-mono') {
        if (raw && CSS.supports('font-family', raw)) theme?.setToken(token, raw)
        return
      }
      const value = Number(raw),
        min = token.includes('font-size') ? 6 : 1,
        max = token.includes('font-size')
          ? 72
          : token.includes('contrast')
            ? 21
            : 3
      if (Number.isFinite(value) && value >= min && value <= max)
        theme?.setToken(
          token,
          token.includes('font-size') ? `${value}px` : String(value),
        )
    })
  }
  const previewControls = node('div')
  previewControls.className = 'terminal-preview-controls'
  const startPreview = node('au-button', 'Start preview shell'),
    stopPreview = node('au-button', 'Stop preview')
  startPreview.setAttribute('variant', 'outline')
  stopPreview.setAttribute('variant', 'ghost')
  stopPreview.hidden = true
  const previewHint = node(
    'p',
    'A separate interactive shell. Stops when you leave these settings.',
  )
  const preview = node('div')
  preview.className = 'terminal-preview'
  preview.setAttribute('aria-label', 'Terminal preview')
  previewControls.append(startPreview, stopPreview)
  appearance.append(previewControls, previewHint, preview)
  let disposePreview: (() => void) | undefined,
    previewTerm: Terminal | undefined
  const previewConfig: Partial<import('./generated').Terminal> = {}
  function updatePreview() {
    if (!previewTerm) return
    try {
      Object.assign(previewConfig, readPreferences())
      previewTerm.options = {
        ...previewTerm.options,
        ...outputOptions(previewConfig),
      }
    } catch {
      /* Keep the last valid preview while a field is incomplete. */
    }
  }
  function endPreview() {
    disposePreview?.()
    disposePreview = undefined
    previewTerm = undefined
    preview.replaceChildren()
    startPreview.textContent = 'Start preview shell'
    stopPreview.hidden = true
    previewHint.textContent = 'A separate interactive shell. Stops when you leave these settings.'
  }
  const visibility = new ResizeObserver(([entry]) => {
    if (previewTerm && entry.contentRect.width === 0) endPreview()
  })
  visibility.observe(preview)
  startPreview.addEventListener('au-activate', () => {
    try {
      if (!saved) throw Error('Wait for terminal settings to load')
      const next = readPreferences()
      endPreview()
      Object.assign(previewConfig, next)
      disposePreview = mountTerminal(
        preview,
        { ...host, instanceId: undefined, config: previewConfig },
        {
          ready(term) {
            previewTerm = term
            term.write(
              '\x1b[2mTerminal preview · type here to try your shell\x1b[0m\r\n\x1b[32mSuccess\x1b[0m  \x1b[33mWarning\x1b[0m  \x1b[31mError\x1b[0m\r\n',
            )
          },
        },
      )
      startPreview.textContent = 'Restart preview'
      stopPreview.hidden = false
      previewHint.textContent =
        'Interactive preview. Restart to apply shell or prompt changes.'
    } catch (error) {
      feedback.textContent =
        error instanceof Error ? error.message : String(error)
    }
  })
  stopPreview.addEventListener('au-activate', endPreview)
  const shell = section('New shells', 'Shell and prompt changes apply to new terminals. Saving never restarts an existing shell.')
  field(
    shell,
    'Shell executable',
    'shell',
  ).setAttribute('placeholder', 'System default')
  field(shell, 'Prompt preset', 'prompt', PROMPTS)
  shell.append(
    node(
      'p',
      'Leave the executable blank for the system default. Prompt presets support zsh and bash; other shells keep their own prompt.',
    ),
  )
  const output = section('Output and cursor', 'Output settings apply to open terminals. Reducing scrollback discards older output.')
  field(output, 'Scrollback lines (0–100000)', 'scrollback')
  field(output, 'Cursor shape', 'cursorStyle', [
    { value: 'bar', label: 'Bar' },
    { value: 'block', label: 'Block' },
    { value: 'underline', label: 'Underline' },
  ])
  field(output, 'Cursor blinking', 'cursorBlink', [
    { value: 'true', label: 'On' },
    { value: 'false', label: 'Off' },
  ])
  output.append(
    node(
      'p',
      'Reduced motion always disables cursor blinking.',
    ),
  )
  function readPreferences(): TerminalPreferences {
    const raw = inputs.get('scrollback')!.value.trim(),
      scrollback = Number(raw)
    if (
      !raw ||
      !Number.isInteger(scrollback) ||
      scrollback < 0 ||
      scrollback > 100000
    )
      throw Error('Scrollback must be 0–100000 lines')
    return {
      shell: inputs.get('shell')!.value.trim(),
      prompt: inputs.get('prompt')!.value as TerminalPreferences['prompt'],
      scrollback,
      cursorStyle: inputs.get('cursorStyle')!
        .value as TerminalPreferences['cursorStyle'],
      cursorBlink: inputs.get('cursorBlink')!.value === 'true',
    }
  }
  content.addEventListener('au-input', updatePreview)
  content.addEventListener('au-change', updatePreview)
  const actions = node('div')
  actions.className = 'terminal-preferences-actions'
  const save = node('au-button', 'Save settings'),
    revert = node('au-button', 'Revert'),
    reset = node('au-button', 'Use defaults')
  save.setAttribute('variant', 'cta')
  revert.setAttribute('variant', 'outline')
  reset.setAttribute('variant', 'ghost')
  const retry = node('au-button', 'Retry loading')
  retry.setAttribute('variant', 'outline')
  retry.hidden = true
  actions.append(save, revert, reset, retry)
  function controls() {
    const disabled = busy || !saved
    for (const input of inputs.values()) input.toggleAttribute('disabled', disabled)
    for (const button of [save, revert, reset, startPreview]) button.toggleAttribute('disabled', disabled)
    save.toggleAttribute('loading', busy)
    retry.toggleAttribute('disabled', busy)
  }
  const footer = node('div')
  footer.className = 'terminal-preferences-footer'
  footer.append(feedback, actions)
  root.append(footer)
  function render() {
    if (!saved) return
    for (const [key, value] of Object.entries(saved))
      inputs.get(key)!.value = String(value)
    renderAppearance()
  }
  function renderAppearance() {
    const resolved = readTextPresentation(getComputedStyle(root))
    const values: Record<string, string> = {
      '--au-font-mono': resolved.fontFamily ?? '',
      '--au-terminal-font-size': resolved.fontSize == null ? '' : String(resolved.fontSize),
      '--au-terminal-line-height': resolved.lineHeight == null ? '' : String(Number(resolved.lineHeight.toFixed(2))),
      '--au-terminal-minimum-contrast': String(resolved.minimumContrastRatio),
    }
    for (const [, token] of tokens) {
      if (inputs.get(token)!.matches(':focus-within')) continue
      inputs.get(token)!.value = values[token]
    }
  }
  let appearanceFrame = 0
  const offTheme = theme?.subscribe(() => {
    cancelAnimationFrame(appearanceFrame)
    appearanceFrame = requestAnimationFrame(() => {
      if (alive) renderAppearance()
    })
  })

  save.addEventListener('au-activate', () => {
    if (busy || !saved) return
    clearErrors()
    void (async () => {
      try {
        if (!api || !saved) throw Error('Terminal settings unavailable')
        const scrollback = inputs.get('scrollback')!.value.trim()
        if (!scrollback || !Number.isInteger(Number(scrollback)) || Number(scrollback) < 0 || Number(scrollback) > 100000)
          invalid('scrollback', 'Enter a whole number from 0 to 100000.')
        const next = readPreferences()
        for (const [label, token] of tokens) {
          if (token === '--au-font-mono') {
            const family = inputs.get(token)!.value.trim()
            if (!family || !CSS.supports('font-family', family))
              invalid(token, 'Enter a valid monospace font family.')
            continue
          }
          const value = Number(inputs.get(token)!.value),
            max = token.includes('font-size')
              ? 72
              : token.includes('contrast')
                ? 21
                : 3,
            min = token.includes('font-size') ? 6 : 1
          if (!Number.isFinite(value) || value < min || value > max)
            invalid(token, `${label}: enter a value from ${min} to ${max}.`)
        }
        busy = true
        controls()
        feedback.textContent = 'Saving settings…'
        saved = await api.save(next)
        if (!alive) return
        try {
          theme?.save()
        } catch (error) {
          throw Error(
            `Terminal defaults saved, but appearance could not be saved: ${String(error)}`,
          )
        }
        dirty = false
        feedback.textContent =
          'Saved. Appearance and output settings apply now; shell defaults apply to new terminals.'
      } catch (error) {
        if (alive) {
          feedback.setAttribute('data-error', '')
          feedback.textContent = error instanceof Error ? error.message : String(error)
        }
      } finally {
        busy = false
        if (alive) controls()
      }
    })()
  })
  revert.addEventListener('au-activate', () => {
    if (busy || !saved) return
    clearErrors()
    theme?.discard()
    dirty = false
    render()
    updatePreview()
    feedback.textContent = 'Changes reverted.'
  })
  reset.addEventListener('au-activate', () => {
    if (busy || !saved) return
    clearErrors()
    for (const [key, value] of Object.entries({
      shell: '',
      prompt: 'clean',
      scrollback: 10000,
      cursorStyle: 'bar',
      cursorBlink: true,
    }))
      inputs.get(key)!.value = String(value)
    for (const [, token] of tokens) theme?.setToken(token, null)
    dirty = true
    renderAppearance()
    feedback.textContent = 'Default values previewed. Save to keep them.'
    updatePreview()
  })
  const off = api?.subscribe((value) => {
    if (!dirty && !busy && alive) {
      saved = value
      render()
    }
  })
  async function load() {
    if (busy) return
    busy = true
    retry.hidden = true
    clearErrors()
    controls()
    feedback.textContent = 'Loading terminal settings…'
    try {
      if (!api) throw Error('Terminal settings are unavailable in this host.')
      const value = await api.get()
      if (!alive) return
      saved = value
      render()
      feedback.textContent = ''
    } catch (error) {
      if (alive) {
        feedback.setAttribute('data-error', '')
        feedback.textContent = error instanceof Error ? error.message : String(error)
        retry.hidden = !api
      }
    } finally {
      busy = false
      if (alive) controls()
    }
  }
  retry.addEventListener('au-activate', () => void load())
  void load()
  return () => {
    alive = false
    visibility.disconnect()
    cancelAnimationFrame(appearanceFrame)
    offTheme?.()
    endPreview()
    off?.()
    theme?.dispose()
    release?.()
    root.remove()
  }
}
