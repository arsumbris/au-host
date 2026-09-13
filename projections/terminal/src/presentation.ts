import type { ITerminalOptions, ITheme, Terminal } from '@xterm/xterm'

const palette = {
  black: 'black', red: 'red', green: 'green', yellow: 'yellow', blue: 'blue',
  magenta: 'magenta', cyan: 'cyan', white: 'white', brightBlack: 'bright-black',
  brightRed: 'bright-red', brightGreen: 'bright-green', brightYellow: 'bright-yellow',
  brightBlue: 'bright-blue', brightMagenta: 'bright-magenta', brightCyan: 'bright-cyan',
  brightWhite: 'bright-white',
} as const

/** Resolve the same optional typography overrides for terminal rendering and settings. */
export function readTextPresentation(css: Pick<CSSStyleDeclaration, 'getPropertyValue'>): ITerminalOptions {
  const fontSize = parseFloat(css.getPropertyValue('--au-terminal-font-size')) || parseFloat(css.getPropertyValue('--au-t-sm'))
  const lineHeight = parseFloat(css.getPropertyValue('--au-terminal-line-height')) || parseFloat(css.getPropertyValue('--au-lh-sm')) / fontSize
  const contrast = parseFloat(css.getPropertyValue('--au-terminal-minimum-contrast'))
  return {
    minimumContrastRatio: Number.isFinite(contrast) ? Math.min(21, Math.max(1, contrast)) : 4.5,
    fontFamily: css.getPropertyValue('--au-font-mono').trim() || undefined,
    ...(fontSize > 0 ? { fontSize, ...(lineHeight > 0 ? { lineHeight: Math.max(1, lineHeight) } : {}) } : {}),
  }
}

/** Convert modern CSS colors to the rgba syntax supported by the terminal renderer. */
export function readPresentation(el: HTMLElement): ITerminalOptions {
  const css = getComputedStyle(el)
  const canvas = el.ownerDocument.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const rgba = (value: string): number[] | undefined => {
    if (!value || !CSS.supports('color', value)) return undefined
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  const color = (token: string): string | undefined => {
    const channels = rgba(css.getPropertyValue(token).trim())
    return channels ? `rgba(${channels.join(', ')})` : undefined
  }
  const layers: number[][] = []
  let ground = rgba(css.getPropertyValue('--au-terminal-contrast-ground').trim())
    ?? rgba(css.getPropertyValue('--au-color-surface-1').trim()) ?? [23, 21, 18, 1]
  for (let node: HTMLElement | null = el; node;) {
    const style = getComputedStyle(node)
    // Images and native/backdrop material need the theme's reference ground.
    if (style.backgroundImage !== 'none' || style.backdropFilter !== 'none') break
    const layer = rgba(style.backgroundColor)
    if (layer) {
      layers.push(layer)
      if (layer[3] === 1) break
    }
    const root = node.getRootNode()
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host as HTMLElement : null)
  }
  for (const layer of layers.reverse()) {
    ground = ground.map((v, i) => i < 3 ? layer[i] * layer[3] + v * (1 - layer[3]) : 1)
  }
  const theme: ITheme = {
    // Preserve transparency while giving xterm the RGB ground needed for foreground contrast.
    background: `rgba(${ground.slice(0, 3).map(Math.round).join(', ')}, 0)`,
    foreground: color('--au-ink-2'),
    cursor: color('--au-focus-outer'),
    cursorAccent: color('--au-color-surface-1'),
    selectionBackground: color('--au-selection-bg'),
    selectionInactiveBackground: color('--au-selection-bg'),
    selectionForeground: color('--au-selection-fg'),
  }
  for (const [key, suffix] of Object.entries(palette)) {
    theme[key as keyof typeof palette] = color(`--au-terminal-${suffix}`)
  }

  return {
    theme,
    ...readTextPresentation(css),
    cursorBlink: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    cursorStyle: 'bar',
    cursorInactiveStyle: 'outline',
    smoothScrollDuration: 0,
  }
}

/** Apply visual settings without replacing the terminal or its host-owned session. */
export function watchPresentation(term: Terminal, el: HTMLElement, refit: () => void, overrides: () => ITerminalOptions = () => ({})): () => void {
  let frame = 0
  const apply = (): void => {
    frame = 0
    const next = {...readPresentation(el),...overrides()}
    const metricsChanged = next.fontFamily !== term.options.fontFamily || next.fontSize !== term.options.fontSize || next.lineHeight !== term.options.lineHeight
    term.options = next
    if (metricsChanged) refit()
  }
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(apply)
  }
  const observer = new MutationObserver(schedule)
  for (let node: HTMLElement | null = el; node;) {
    observer.observe(node, { attributes: true, attributeFilter: ['style', 'class'] })
    const root = node.getRootNode()
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host as HTMLElement : null)
  }
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', schedule)
  apply()
  return () => {
    if (frame) cancelAnimationFrame(frame)
    observer.disconnect()
    motion.removeEventListener('change', schedule)
  }
}
