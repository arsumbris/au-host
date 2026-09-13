// Detect registered CSS custom properties that the browser rejects at parse time.
// An invalid `@property` rule is absent from the CSSOM, so detection needs the original stylesheet text.
// The host reads declaration sheets before adoption and can compare source declarations with accepted
// rules. Report rejected registrations so a consumer can distinguish a missing token from its own CSS error.

import { rejectedTokenNames } from '@arsumbris/au-host-sdk'
import type { RejectedToken, TokenDiagnostics } from '@arsumbris/au-host-sdk'

/** Source text the host holds for sheets the DOM cannot give text for (constructed + adopted). */
const recorded = new Map<string, string>() // label -> css text

let rejected: RejectedToken[] = []
let unreadable = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of [...listeners]) {
    try {
      l()
    } catch {
      // a broken listener must not stop the others, nor the scan that triggered them
    }
  }
}

/**
 * Record the raw text of a sheet the host is about to adopt, keyed by a human label (the owning
 * projection + its token-sheet path). Called by `loadTokenSheets` BEFORE the safe subset is
 * adopted — after adoption the rejected declarations are already gone, so this is the only moment
 * the text and the verdict coexist.
 */
export function recordTokenSheetSource(label: string, cssText: string): void {
  recorded.set(label, cssText)
}

/** Drop every recorded source (a re-discovery rebuilds the set). */
export function clearTokenSheetSources(): void {
  recorded.clear()
}

/** Every `--au-*` the browser DID register, read off the live CSSOM. */
function registeredNames(): Set<string> {
  const out = new Set<string>()
  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin
    }
    for (const rule of rules) if (rule instanceof CSSPropertyRule) out.add(rule.name)
  }
  return out
}

/**
 * Re-scan and publish. Idempotent; call after the token sheets are adopted and whenever the
 * discovered set changes.
 *
 * Covers two populations, which is the point of doing it in one place:
 * - the DOCUMENT's own sheets (our bundled `tokens.css`), text recovered from the owner node or
 *   fetched from the href.
 * - the RECORDED projection sheets, whose text the DOM cannot supply.
 */
export async function scanTokenRegistration(): Promise<void> {
  const registered = registeredNames()
  const found: RejectedToken[] = []
  const seen = new Set<string>()
  let missed = 0

  const take = (names: string[], source: string): void => {
    for (const name of names) {
      if (seen.has(name)) continue
      seen.add(name)
      found.push({ name, source })
    }
  }

  for (const sheet of document.styleSheets) {
    let text: string | null = null
    try {
      const owner = sheet.ownerNode
      if (owner instanceof HTMLStyleElement) text = owner.textContent
      else if (sheet.href) text = await (await fetch(sheet.href)).text()
    } catch {
      text = null
    }
    if (text === null) {
      // Counted, never hidden: a report that silently covers less than it appears to is the exact
      // failure mode this mechanism exists to prevent.
      missed++
      continue
    }
    take(rejectedTokenNames(text, registered), sheet.href ? sheet.href.slice(sheet.href.lastIndexOf('/') + 1) : 'inline <style>')
  }

  for (const [label, text] of recorded) take(rejectedTokenNames(text, registered), label)

  rejected = found
  unreadable = missed
  emit()
}

/** The read-only view published on `MountHost.tokens`. */
export const tokenDiagnostics: TokenDiagnostics = {
  rejected: () => rejected,
  unreadableSheets: () => unreadable,
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
