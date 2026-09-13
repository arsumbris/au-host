import { provideOverlayTokens, type OverlayTokenScope } from '@arsumbris/component-contract'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeSpecimen } from './theme-specimen'

/** Raw declarations, not computed values: aliases must resolve against the preview's own palette. */
export function themeBaseline(doc: Document): Record<string, string> {
  const initial: Record<string, string> = {}
  const cascade: Record<string, string> = {'color-scheme':'normal'}
  const walk = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if (rule instanceof CSSPropertyRule && rule.name.startsWith('--au-')) initial[rule.name] = rule.initialValue || 'initial'
      else if (rule instanceof CSSStyleRule && [':root', ':where(:root)'].includes(rule.selectorText)) {
        for (const name of rule.style) if (name.startsWith('--au-') || name === 'color-scheme') cascade[name] = rule.style.getPropertyValue(name)
      } else if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.conditionText).matches) walk(rule.cssRules)
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) walk(rule.cssRules)
      }
    }
  }
  for (const sheet of [...doc.styleSheets, ...doc.adoptedStyleSheets]) {
    try { walk(sheet.cssRules) } catch { /* Cross-origin sheets cannot define inspected preview tokens. */ }
  }
  return { ...initial, ...cascade }
}

export function previewValues(css: string): Record<string, string> {
  const sheet = new CSSStyleSheet(); sheet.replaceSync(css)
  const values: Record<string, string> = {}
  for (const rule of sheet.cssRules) if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
    for (const name of rule.style) if (name.startsWith('--au-') || name === 'color-scheme') values[name] = rule.style.getPropertyValue(name)
  }
  return values
}

/** Isolates known theme tokens and specimen styles; never changes app styles or preferences.
 * Claimed overlays inherit the specimen tokens. Native window vibrancy is not simulated.
 */
export function ThemePreview({ css, overrides = {} }: { css: string; overrides?: Record<string, string> }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement | null>(null)
  const overlayScope = useRef<OverlayTokenScope | null>(null)
  const mounted = useRef<Root | null>(null)
  const baseline = useMemo(() => themeBaseline(document), [])
  useLayoutEffect(() => {
    const host = ref.current!
    const shadow = host.shadowRoot ?? host.attachShadow({mode: 'open'})
    const reset = document.createElement('div')
    const content = document.createElement('div')
    reset.style.cssText = 'all:initial;display:block;isolation:isolate;overflow:hidden;'
    for (const [name,value] of Object.entries(baseline)) reset.style.setProperty(name,value)
    content.style.cssText = 'padding:var(--au-space-3);background:var(--au-color-bg);color:var(--au-ink-1);font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans);'
    reset.append(content);shadow.append(reset);inner.current=content
    overlayScope.current=provideOverlayTokens(content, {})
    mounted.current=createRoot(content)
    mounted.current.render(<ThemeSpecimen layout="compact" context="Isolated · controls and dropdowns" />)
    return () => {
      const root=mounted.current
      // React parent teardown must finish before unmounting a separate renderer root.
      queueMicrotask(()=>root?.unmount())
      overlayScope.current?.dispose();overlayScope.current=null
      reset.remove();inner.current=null;mounted.current=null
    }
  }, [baseline])
  useLayoutEffect(() => {
    const content=inner.current
    if (!content) return
    for (const name of Array.from(content.style)) if (name.startsWith('--au-')) content.style.removeProperty(name)
    const values={...baseline,...previewValues(css),...overrides}
    for (const [name,value] of Object.entries(values)) content.style.setProperty(name,value)
    overlayScope.current?.update(Object.fromEntries(Object.entries(values).filter(([name]) => !name.startsWith('--au-z-'))))
  }, [baseline,css,overrides])
  return <div ref={ref} aria-label="Isolated theme preview" />
}
