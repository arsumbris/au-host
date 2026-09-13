/**
 * Detect declared tokens the browser did not register.
 * Invalid @property rules disappear from the CSSOM, so detection compares the stylesheet source
 * with registered CSSPropertyRule names. The host owns this comparison and exposes its findings
 * through MountHost.tokens. The browser decides validity, including syntax-dependent rules.
 *
 * packages/style/scripts/check-initial-values.ts validates first-party declarations at build time;
 * this runtime check also covers dynamically loaded stylesheets.
 */

/** A token a stylesheet declared that the browser refused to register. */
export interface RejectedToken {
  /** The custom-property name, e.g. `--au-color-bg`. */
  name: string
  /** Where it was declared — a filename, a package-relative path, or `inline <style>`. */
  source: string
}

/**
 * The host's view of token registration, exposed to projections so a surface can REPORT it.
 * Read-only and advisory: a rejected token degrades the look, it never blocks a mount.
 */
export interface TokenDiagnostics {
  /** Tokens declared somewhere the host can see, which the browser refused. Empty is the norm. */
  rejected(): readonly RejectedToken[]
  /**
   * Stylesheets whose source text the host could NOT recover, so their declarations were never
   * checked. Surfaced rather than hidden: a report that silently covers less than it appears to is
   * the failure mode this whole mechanism exists to prevent.
   */
  unreadableSheets(): number
  /** Fires when the set changes (a re-discovery, a projection loading its sheet). */
  subscribe(listener: () => void): () => void
}

/**
 * Every `@property --x` NAME a source text declares, whether or not it survived parsing.
 *
 * Comments are blanked first, so an `@property` shown as an EXAMPLE in prose (as several of this
 * repo's own token files do) is never counted as a declaration.
 */
export function declaredPropertyNames(cssText: string): string[] {
  return [...cssText.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/@property\s+(--[\w-]+)/g)].map((m) => m[1])
}

/**
 * The diff: names this text DECLARES that are absent from `registered`.
 *
 * `registered` is whatever the browser actually accepted — from `CSSPropertyRule`s, or from a
 * `getComputedStyle` probe. The caller supplies it, because where it comes from differs by site
 * and the RULE must not.
 */
export function rejectedTokenNames(cssText: string, registered: Iterable<string>): string[] {
  const ok = registered instanceof Set ? registered : new Set(registered)
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of declaredPropertyNames(cssText)) {
    if (ok.has(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}
