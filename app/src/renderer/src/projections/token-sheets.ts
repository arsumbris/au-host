// Eager-load projection token-declaration sheets at document level.
//
// A projection declares its own themeable tokens (`--au-<projection>-*`) in a
// DECLARATIONS-ONLY CSS file, pointed at by `projection-runtime-meta.customTokenEntry`.
// The host reads those sheets for ALL in-scope projections (mounted or not) and adopts
// them into the document, so:
//   - a theming pane can discover the tokens via the CSSOM (`@property` -> `CSSPropertyRule`),
//     even for a projection that is not currently on screen;
//   - `@property` registers (it only registers in light DOM, so document-level is required);
//   - the crafted defaults + any theme apply through the normal cascade.
//
// Document-level injection of third-party CSS is only safe if the sheet is truly
// declarations-only. So every sheet is VALIDATED (allowlist walk) and any disallowed rule
// is DROPPED with a diagnostic — this is what keeps a projection from smuggling component
// styles (or a `*{}` reset) into a document-global sheet.

import type { FilesControl } from '@arsumbris/au-host-sdk'
import { clearTokenSheetSources, recordTokenSheetSource, scanTokenRegistration } from './token-registration'

/**
 * A source of token-declaration sheets: anything the host discovers that owns a package root and
 * MAY declare `customTokenEntry`. Both `DiscoveredProjection` and `DiscoveredComponentSet` satisfy
 * it, so the SAME eager-load path serves projections and component sets (a component surfaces its
 * `--au-<component>-*` tokens exactly as a projection does).
 */
export interface TokenSheetSource {
  /** The owner's type name — used only to label diagnostics. */
  typeName: string
  /** The owning package root on disk (token paths resolve relative to it). */
  packageRoot: string
  /** Declarations-only token stylesheet path(s), relative to `packageRoot`. Absent for most. */
  customTokenEntry?: string[]
}

export interface TokenSheetDiagnostic {
  /** The projection whose sheet produced this diagnostic. */
  projection: string
  /** The token-sheet path (relative to the package root). */
  path: string
  /** One dropped-rule / load message. */
  message: string
}

/** Only these rule kinds may appear in a token-declaration sheet. */
function isRootCustomPropRule(rule: CSSStyleRule): boolean {
  const sel = rule.selectorText.replace(/\s+/g, '')
  // :root or :where(:root) (allow a leading :where wrapper). Nothing element/class-scoped.
  if (sel !== ':root' && sel !== ':where(:root)') return false
  // every declared property must be a custom property (`--x`).
  for (let i = 0; i < rule.style.length; i++) {
    if (!rule.style[i].startsWith('--')) return false
  }
  return true
}

/**
 * Validate a token sheet against the declarations-only allowlist and return the SAFE subset
 * (only permitted rules) plus a diagnostic per dropped rule. Uses the browser CSSOM to parse.
 * Permitted: `@property`, `:root`/`:where(:root)` blocks of only custom properties, and
 * `@media (prefers-color-scheme: ...)` wrappers around the same.
 *
 * REJECTED tokens are NOT detected here. This function only ever sees the rules that SURVIVED
 * parsing, so a refused `@property` is already gone by the time it runs. Detection needs the raw
 * text, which is why `loadTokenSheets` hands that text to `token-registration.ts` — the single
 * detector — before adopting the safe subset.
 */
export function validateTokenSheet(cssText: string): { safeCss: string; violations: string[] } {
  const parse = new CSSStyleSheet()
  parse.replaceSync(cssText)
  const kept: string[] = []
  const violations: string[] = []

  const consider = (rule: CSSRule, insideMedia: boolean): string | null => {
    if (rule instanceof CSSPropertyRule) return rule.cssText
    if (rule instanceof CSSStyleRule) {
      if (isRootCustomPropRule(rule)) return rule.cssText
      violations.push(`dropped style rule "${rule.selectorText}" (not a :root custom-property block)`)
      return null
    }
    if (!insideMedia && rule instanceof CSSMediaRule && /prefers-color-scheme/.test(rule.conditionText)) {
      const inner: string[] = []
      for (const r of rule.cssRules) {
        const k = consider(r, true)
        if (k) inner.push(k)
      }
      return inner.length ? `@media ${rule.conditionText} { ${inner.join(' ')} }` : null
    }
    violations.push(`dropped disallowed rule: ${rule.cssText.slice(0, 80)}`)
    return null
  }

  for (const rule of parse.cssRules) {
    const k = consider(rule, false)
    if (k) kept.push(k)
  }
  return { safeCss: kept.join('\n'), violations }
}

// The token sheets this module has adopted, so a re-run replaces ours without
// disturbing other adopted stylesheets. Keyed by content to dedup identical sheets
// (e.g. two projections referencing one shared token file).
const managed = new Map<string, CSSStyleSheet>()

/**
 * Eager-load + validate + adopt the token-declaration sheets of all discovered projections
 * that declare `customTokenEntry`. Idempotent: rebuilds the managed set each call.
 * Returns diagnostics for dropped rules / unreadable sheets (surface in the host UI).
 */
export async function loadTokenSheets(
  sources: TokenSheetSource[],
  files: FilesControl,
): Promise<TokenSheetDiagnostic[]> {
  const diagnostics: TokenSheetDiagnostic[] = []
  const wanted = new Map<string, CSSStyleSheet>() // content -> sheet
  clearTokenSheetSources() // rebuilt below, so a removed projection's sheet stops being reported

  for (const p of sources) {
    if (!p.customTokenEntry) continue
    for (const rel of p.customTokenEntry) {
      const abs = `${p.packageRoot}/${rel.replace(/^\.\//, '')}`
      let text: string
      try {
        const r = await files.read(abs)
        if (!r.ok || r.content === undefined) {
          diagnostics.push({ projection: p.typeName, path: rel, message: `could not read token sheet: ${r.error ?? 'not found'}` })
          continue
        }
        text = r.content
      } catch (e) {
        diagnostics.push({ projection: p.typeName, path: rel, message: `error reading token sheet: ${String(e)}` })
        continue
      }
      const { safeCss, violations } = validateTokenSheet(text)
      for (const v of violations) diagnostics.push({ projection: p.typeName, path: rel, message: v })
      if (!safeCss) continue
      if (wanted.has(safeCss)) continue // content-dedup
      // The raw text goes to the single detector BEFORE adoption: after it, the refused
      // declarations are already stripped and the evidence is gone. See token-registration.ts.
      recordTokenSheetSource(`${p.typeName} · ${rel}`, text)
      const existing = managed.get(safeCss)
      const sheet = existing ?? new CSSStyleSheet()
      if (!existing) sheet.replaceSync(safeCss)
      wanted.set(safeCss, sheet)
    }
  }

  // Swap our managed sheets in adoptedStyleSheets: drop the old ones, add the current set,
  // leave every other adopted sheet untouched.
  const ours = new Set(managed.values())
  const others = Array.from(document.adoptedStyleSheets).filter((s) => !ours.has(s))
  document.adoptedStyleSheets = [...others, ...wanted.values()]
  managed.clear()
  for (const [content, sheet] of wanted) managed.set(content, sheet)

  // Scan AFTER adoption, so the registered set reflects what the browser actually accepted.
  await scanTokenRegistration()

  return diagnostics
}
