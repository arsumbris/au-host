import { readInstancesOf, type WireInstanceMatch, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import type { MountHost } from '@arsumbris/au-host-sdk'
type Files = MountHost['files']

/** A discovered theme: where its instance lives + its name + its style file paths. */
export interface DiscoveredTheme {
  /** Absolute path of the `.theme.yaml` instance. */
  path: string
  /** The instance's directory — style paths resolve relative to it. */
  dir: string
  /** The theme's display name (the `name` field, else the file basename). */
  name: string
  /** Relative style-file paths from the instance's `styles` field. */
  styles: string[]
}

const THEME_TYPE = 'theme'

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.theme\.(ya?ml)$/i, '')
const dirname = (p: string): string => p.slice(0, p.lastIndexOf('/'))

/** Relative theme paths remain within their declaring directory. */
export function checkContained(rel: string, scope: string): { ok: true; rel: string } | { ok: false; error: string } {
  const clean = rel.trim().replace(/^\.\//, '')
  if (!clean) return { ok: false, error: 'path is empty' }
  if (clean.startsWith('/')) return { ok: false, error: `path must be relative to ${scope} (no leading /)` }
  if (clean.split('/').some((seg) => seg === '..')) return { ok: false, error: `path must not escape ${scope} (no ..)` }
  return { ok: true, rel: clean }
}

/** Resolve one `styles` entry against its instance's own directory, refusing anything that escapes it. */
export function resolveStyleRel(
  dir: string,
  rel: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const checked = checkContained(rel, "the theme's folder")
  return checked.ok ? { ok: true, path: `${dir}/${checked.rel}` } : checked
}
/** Discover every `theme` instance across the workspace (through the engine instance query). */
export async function discoverThemes(reader: WireReader): Promise<DiscoveredTheme[]> {
  // A theme is a FILE (CSS discovered as an instance) — file-origin only.
  const result = await readInstancesOf(reader, THEME_TYPE, { origins: ['file'] })
  if (!('ready' in result) || !result.ready) return []
  const out: DiscoveredTheme[] = []
  const seen = new Set<string>() // schema-6 match records can repeat an instance under several identities
  for (const inst of result.result as WireInstanceMatch[]) {
    if (seen.has(inst.path)) continue
    seen.add(inst.path)
    const fields = inst.fields ?? {}
    const name = typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : basename(inst.path)
    const styles = Array.isArray(fields.styles) ? (fields.styles.filter((s) => typeof s === 'string') as string[]) : []
    out.push({ path: inst.path, dir: dirname(inst.path), name, styles })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * Read + concatenate a theme's style file(s) into one CSS string.
 *
 * Returns the refusals ALONGSIDE the CSS rather than dropping them. A refused entry means the
 * theme is rendering incompletely, which is invisible in the result — a silently swallowed
 * refusal in a security path would hide that failure. The caller surfaces them.
 */
export async function readThemeCss(
  files: Pick<Files, 'read'>,
  theme: DiscoveredTheme,
): Promise<{ css: string; refused: { rel: string; error: string }[] }> {
  const parts: string[] = []
  const refused: { rel: string; error: string }[] = []
  for (const rel of theme.styles) {
    const resolved = resolveStyleRel(theme.dir, rel)
    if (!resolved.ok) {
      refused.push({ rel, error: resolved.error })
      continue
    }
    const res = await files.read(resolved.path)
    if (res.ok && res.content) parts.push(res.content)
    else refused.push({ rel, error: res.error ?? 'could not be read' })
  }
  return { css: parts.join('\n'), refused }
}

