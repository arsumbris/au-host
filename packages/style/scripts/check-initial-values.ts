/*
 * Check computational independence of typed @property initial values.
 * An environment-dependent initial value prevents registration; consumers then fall back
 * to the property's CSS initial value. This check runs in the style package's typecheck.
 *
 * Universal syntax ("*") accepts arbitrary token streams and is excluded from this check.
 * Typed syntax rejects var() and relative units: font, viewport, container and percentage.
 * Absolute units, numbers, angles, times, colours and absolute calc() expressions are allowed.
 *
 * Scans first-party CSS, pruning dependencies and build/worktree output (see PRUNE).
 * Pass explicit file paths to restrict the scan. Third-party and user styles require runtime
 * registration checks because they do not pass through this build.
 *
 * Run: pnpm --filter @arsumbris/style typecheck
 *      node --experimental-transform-types scripts/check-initial-values.ts [file.css ...]
 * Exits nonzero when a typed @property has a dependent initial value.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..') // scripts → style → packages → repo root

// ANSI, matching check-contrast.ts's reporting palette.
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

// Directories that never hold first-party SOURCE token declarations — pruned from the walk. `out`
// is electron-vite's app build output and `dist` the projection/package lib output; both inline a
// MINIFIED concatenation of every token file (base+ext+component css), which would (a) re-scan the
// same tokens as duplicates and (b) let a stale bundle mask a source change. The gate checks source.
const PRUNE = new Set(['node_modules', 'dist', 'out', '.git', '.claude', 'coverage', '.next'])

/** Recursively collect *.css under `dir`, skipping PRUNE directories. */
function collectCss(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // unreadable dir (permissions, races) — skip rather than crash the gate
  }
  for (const name of entries) {
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue // a concurrent delete can race the walk in this shared tree
    }
    if (st.isDirectory()) {
      if (!PRUNE.has(name)) collectCss(full, out)
    } else if (name.endsWith('.css')) {
      out.push(full)
    }
  }
}

// Relative units, LONGEST-FIRST so the alternation prefers `rem` over `em`, `svmin` over `vmin`, etc.
// (Correctness does not depend on order — the unit must start at the char after the number — but
// longest-first keeps the REPORTED unit the specific one.)
const REL_UNITS = [
  'rcap', 'svmin', 'svmax', 'lvmin', 'lvmax', 'dvmin', 'dvmax', 'cqmin', 'cqmax',
  'vmin', 'vmax', 'rlh', 'rex', 'rch', 'ric',
  'rem', 'cap', 'svw', 'svh', 'svi', 'svb', 'lvw', 'lvh', 'lvi', 'lvb',
  'dvw', 'dvh', 'dvi', 'dvb', 'cqw', 'cqh', 'cqi', 'cqb',
  'em', 'ex', 'ch', 'ic', 'lh', 'vw', 'vh', 'vi', 'vb',
]

// A number (optionally signed/decimal) immediately followed by a relative unit, unit-boundary after.
// The leading lookbehind excludes letters/digits/underscore so we don't read a unit out of the middle
// of an identifier, while still allowing a preceding `-`, `.`, `(`, space, comma, etc.
const RELATIVE_RE = new RegExp(
  `(?<![A-Za-z0-9_])\\d*\\.?\\d+(?:${REL_UNITS.join('|')})\\b`,
  'i',
)
// A number immediately followed by `%`.
const PERCENT_RE = /(?<![A-Za-z0-9_])\d*\.?\d+%/
// A var() reference anywhere in the value.
const VAR_RE = /var\s*\(/i

interface Violation {
  file: string
  name: string
  syntax: string
  initial: string
  reason: string
}

interface ScanResult {
  typed: number // @property with a non-universal syntax (the ones the rule governs)
  universal: number // @property under syntax:"*" (unrestricted — reported only as context)
  violations: Violation[]
}

/**
 * Parse every `@property --name { ... }` block from a stylesheet in ONE pass: tally typed vs
 * universal declarations and collect the typed ones whose initial-value is computationally
 * dependent. Blocks contain no nested braces, so `[^{}]*` captures a whole body across newlines
 * (handles both the single-line token files and multi-line authoring).
 */
function scan(file: string): ScanResult {
  const css = readFileSync(file, 'utf8')
  const rel = relative(REPO, file)
  const res: ScanResult = { typed: 0, universal: 0, violations: [] }
  const blockRe = /@property\s+(--[\w-]+)\s*\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(css)) !== null) {
    const name = m[1]
    const body = m[2]

    const syntaxMatch = body.match(/syntax\s*:\s*(['"])([\s\S]*?)\1/)
    // No syntax → the @property is invalid and never registers regardless of its initial; that is a
    // different (and self-evident) defect. This gate is about SILENT non-registration, so skip it.
    if (!syntaxMatch) continue
    const syntax = syntaxMatch[2].trim()
    if (syntax === '*') {
      res.universal++ // universal syntax: initial is an arbitrary token stream — legal, not checked.
      continue
    }
    res.typed++

    const initMatch = body.match(/initial-value\s*:\s*([^;}]+)/)
    // A typed @property also requires an initial-value; declarations without one are invalid.
    if (!initMatch) continue
    const initial = initMatch[1].trim()

    let reason = ''
    if (VAR_RE.test(initial)) reason = 'contains var() — the registry rejects var() initials'
    else if (PERCENT_RE.test(initial)) reason = 'uses a percentage (environment-dependent)'
    else {
      const rm = initial.match(RELATIVE_RE)
      if (rm) reason = `uses relative unit "${rm[0]}" (environment-dependent)`
    }
    if (reason) res.violations.push({ file: rel, name, syntax, initial, reason })
  }
  return res
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
const argFiles = process.argv.slice(2)
let files: string[]
if (argFiles.length > 0) {
  files = argFiles.map((f) => (f.startsWith('/') ? f : join(process.cwd(), f)))
} else {
  files = []
  collectCss(REPO, files)
  files.sort()
}

let typedCount = 0
let universalCount = 0
const violations: Violation[] = []
for (const f of files) {
  const res = scan(f)
  typedCount += res.typed
  universalCount += res.universal
  violations.push(...res.violations)
}

if (violations.length > 0) {
  console.log(`${RED}${BOLD}FAIL${RESET} — ${violations.length} @property initial-value(s) are computationally dependent:\n`)
  for (const v of violations) {
    console.log(`  ${RED}✕${RESET} ${BOLD}${v.name}${RESET}  ${DIM}(syntax: "${v.syntax}")${RESET}`)
    console.log(`      initial-value: ${v.initial}`)
    console.log(`      ${YELLOW}${v.reason}${RESET}`)
    console.log(`      ${DIM}${v.file}${RESET}`)
  }
  console.log(`\n  ${DIM}Such an initial invalidates the whole @property — the token never registers and every`)
  console.log(`  var() on it falls back silently. Use an absolute value (px/number/colour), or move the`)
  console.log(`  derivation into a :root rule and keep the initial independent.${RESET}`)
  process.exit(1)
}

console.log(
  `${GREEN}${BOLD}PASS${RESET} — ${typedCount} typed @property initial(s) are computationally independent ` +
    `${DIM}(+${universalCount} under syntax:"*", unrestricted; ${files.length} file(s) scanned)${RESET}`,
)
