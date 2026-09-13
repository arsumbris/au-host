import { parseThemeCss } from './theme-config'

/** Restore touched preview tokens through the selected theme and then the tweak layer. */
export function restorePreviewTokens(
  target: HTMLElement,
  names: Iterable<string>,
  themeCss: string | undefined,
  tweaks: Record<string, string>,
): void {
  const theme = themeCss ? parseThemeCss(themeCss) : {}
  for (const name of names) {
    const value = tweaks[name] ?? theme[name]
    if (value === undefined) target.style.removeProperty(name)
    else target.style.setProperty(name, value)
  }
}
