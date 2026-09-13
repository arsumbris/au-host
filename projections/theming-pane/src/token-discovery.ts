export interface Token {
  name: string
  syntax: string
  initialValue: string
  /** Unregistered cascade declaration. Inspectable without inventing an editable type. */
  expression?: string
}

/** Discover registered controls and separately expose shared cascade declarations. */
export function discoverTokens(): Token[] {
  const registered = new Map<string, Token>()
  const cascade = new Map<string, string>()
  const walk = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if (rule instanceof CSSPropertyRule && rule.name.startsWith('--au-')) {
        registered.set(rule.name, { name: rule.name, syntax: rule.syntax.trim(), initialValue: (rule.initialValue ?? '').trim() })
      } else if (rule instanceof CSSStyleRule && [':root', ':where(:root)'].includes(rule.selectorText)) {
        for (const name of rule.style) if (name.startsWith('--au-')) cascade.set(name, rule.style.getPropertyValue(name).trim())
      } else if (rule instanceof CSSGroupingRule) {
        walk(rule.cssRules)
      }
    }
  }
  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    try { walk(sheet.cssRules) } catch { /* Cross-origin sheets cannot be inspected. */ }
  }
  for (const [name, expression] of cascade) {
    if (!registered.has(name)) registered.set(name, { name, syntax: '*', initialValue: '', expression })
  }
  return [...registered.values()].sort((a, b) => a.name.localeCompare(b.name))
}
