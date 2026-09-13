// Named-theme discovery and authoring for the theming pane.
// Named themes are discovered from the workspace type graph.


import { readTypes, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import type { MountHost } from '@arsumbris/au-host-sdk'

type Files = MountHost['files']

import { checkContained, resolveStyleRel, type DiscoveredTheme } from '@arsumbris/au-component-catalog/theme-library'
export { discoverThemes, readThemeCss, resolveStyleRel } from '@arsumbris/au-component-catalog/theme-library'
export type { DiscoveredTheme } from '@arsumbris/au-component-catalog/theme-library'
const THEME_TYPE = 'theme'

/** A filesystem-safe slug for a theme name (the CSS/instance basename). */
export const slug = (name: string): string =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme'

/** Parse a theme's `:root { --au-*: v }` CSS into an override map (browser CSSOM; robust to junk). */
export function parseThemeCss(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSStyleRule && /(^|,)\s*:root\s*$/.test(rule.selectorText)) {
        const style = rule.style
        for (let i = 0; i < style.length; i++) {
          const prop = style[i]
          if (prop.startsWith('--au-')) out[prop] = style.getPropertyValue(prop).trim()
        }
      }
    }
  } catch {
    // malformed CSS — ignore
  }
  return out
}

/** Build the `:root { }` CSS block for an override set. */
export function buildThemeCss(name: string, overrides: Record<string, string>): string {
  const lines = Object.entries(overrides)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${k}: ${v};`)
  return `/* theme: ${name} — authored via the au-host theming pane */\n:root {\n${lines.join('\n')}\n}\n`
}

/**
 * Resolve the `theme` type's fully-qualified `name::repo` claim, so the written instance TYPES
 * wherever it lands. A bare name resolves REPO-LOCAL only: a theme lives in the content entry but
 * `theme` is owned by ANOTHER member (`style`), so a bare `type: theme` never types the file and the
 * saved theme vanishes from discovery. Falls back to the bare
 * name on an unready/unknown read (best-effort, mirrors `qualifyComposition`'s unknown-owner path).
 */
export async function qualifiedThemeType(reader: WireReader): Promise<string> {
  const r = await readTypes(reader, { summary: true })
  if (!('ready' in r) || !r.ready) return THEME_TYPE
  const t = r.result.find((x) => x.name === THEME_TYPE)
  return t ? `${THEME_TYPE}::${t.repo}` : THEME_TYPE
}

/** Build the thin `theme` instance YAML ( a `type: theme::<owner>` record). `typeName` is
 *  the qualified claim from `qualifiedThemeType`; defaults to the bare name only as a fallback. */
export function buildThemeInstance(name: string, styleRelPaths: string[], typeName: string = THEME_TYPE): string {
  const styles = styleRelPaths.map((p) => `  - ${p}`).join('\n')
  return `type: ${typeName}\nname: ${JSON.stringify(name)}\nstyles:\n${styles}\n`
}

/**
 * Resolve a chosen member root + a member-RELATIVE path (no extension) into the pair of
 * absolute file paths + the instance-relative CSS ref. Rejects a path that would escape
 * the member (absolute, or containing a `..` segment) — the member root is the guardrail.
 */
export function resolveThemePaths(
  memberRoot: string,
  relPath: string,
): { ok: true; cssPath: string; instancePath: string; cssRel: string } | { ok: false; error: string } {
  const checked = checkContained(relPath.trim().replace(/\/+$/, ''), 'the member')
  if (!checked.ok) return { ok: false, error: checked.error }
  const rel = checked.rel
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  const root = memberRoot.replace(/\/+$/, '')
  return {
    ok: true,
    cssPath: `${root}/${rel}.theme.css`,
    instancePath: `${root}/${rel}.theme.yaml`,
    cssRel: `./${base}.theme.css`,
  }
}

/**
 * Delete a discovered theme: its `.theme.yaml` instance plus every sibling style file. A style entry
 * that escapes the theme's own directory resolves to nothing and is SKIPPED (the same containment
 * rule `readThemeCss` applies), so delete can never reach outside the theme's folder. A style-file
 * failure is non-fatal: the instance is already gone, so the theme no longer discovers.
 */
export async function deleteTheme(
  files: Pick<Files, 'delete'>,
  theme: DiscoveredTheme,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const instRes = await files.delete(theme.path)
  if (!instRes.ok) return { ok: false, error: instRes.error ?? `could not delete ${theme.path}` }
  for (const rel of theme.styles) {
    const resolved = resolveStyleRel(theme.dir, rel)
    if (!resolved.ok) continue // escapes the folder → never existed as a sibling → skip
    await files.delete(resolved.path).catch(() => undefined)
  }
  return { ok: true }
}

/**
 * Write the current override set as a NEW named theme: a `.theme.css` + a sibling `.theme.yaml`
 * instance at the resolved paths. The instance's `styles` points at the sibling CSS.
 */
export async function writeTheme(
  files: Pick<Files, 'write'>,
  paths: { cssPath: string; instancePath: string; cssRel: string },
  name: string,
  overrides: Record<string, string>,
  typeName: string = THEME_TYPE,
): Promise<{ ok: true; cssPath: string; instancePath: string } | { ok: false; error: string }> {
  const cssRes = await files.write(paths.cssPath, buildThemeCss(name, overrides))
  if (!cssRes.ok) return { ok: false, error: cssRes.error ?? `could not write ${paths.cssPath}` }
  const instRes = await files.write(paths.instancePath, buildThemeInstance(name, [paths.cssRel], typeName))
  if (!instRes.ok) return { ok: false, error: instRes.error ?? `could not write ${paths.instancePath}` }
  return { ok: true, cssPath: paths.cssPath, instancePath: paths.instancePath }
}
