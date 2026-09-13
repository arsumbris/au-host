/*
 * check-token-floors.ts — every NON-COLOUR `var(--au-*, floor)` states the token's own initial-value.
 *
 * WHY THIS EXISTS. A `var()` floor is what renders when the token does not resolve — a component set
 * running WITHOUT `@arsumbris/style`, which is precisely the third-party case the framework exists to
 * serve. Today the floors are hand-typed, so they drift from the registry silently: the tokens are
 * `@property`-registered and therefore always resolve in-app, which makes every wrong floor INERT
 * here and LIVE there. Nothing catches it — a wrong floor is valid CSS and invisible to typecheck.
 *
 * THE SPLIT, and why it is not "all floors must match". For example, a colour floor can use
 * `var(--au-ink-3, #8a8a8a)` against a `#a09c92` token, deliberately: a COLOUR floor is a LEGIBILITY
 * stand-in for a bare render, where "some readable grey" is the whole requirement. Colour mismatches are reported except reviewed ink-parity owners declared below.
 *
 * A NON-COLOUR floor has no such argument. A 120ms floor under a 160ms duration token is not a sane
 * bare-render default, it is a stale number; and a 1.4 floor under a 16px line-height token is a RATIO
 * standing in for a LENGTH, so a bare render lays out structurally differently rather than just looking
 * duller. Those must equal the registered initial-value, and this gate fails on them.
 *
 * This file is excluded from its own scan — the examples above are prose, not call sites.
 *
 * IT HOME: `packages/style` owns the token contract, so the rule about that contract lives here, and
 * it rides `typecheck` for the same reason `check-initial-values.ts` does — that is the one command
 * `pnpm -r typecheck` guarantees to run.
 *
 * USAGE
 *   node --experimental-transform-types scripts/check-token-floors.ts            # gate (default)
 *   node --experimental-transform-types scripts/check-token-floors.ts --report   # list everything, never fail
 *   node --experimental-transform-types scripts/check-token-floors.ts --fix      # rewrite non-colour floors
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STYLE = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO = path.resolve(STYLE, '..', '..')

const argv = new Set(process.argv.slice(2))
const FIX = argv.has('--fix')
const REPORT = argv.has('--report')

// Reviewed picker/action owners use the registry's base ink palette when rendered without tokens.
// Extend this list only after reviewing the component's bare-render context.
const INK_PARITY_OWNERS = new Set([
  'picker-style', 'au-select', 'au-workspace-switcher', 'au-command-palette',
  'au-hovercard', 'au-button', 'au-icon-button', 'au-combobox', 'au-stepper', 'au-number-input', 'au-banner', 'au-toast', 'au-slider',
].map(name => `packages/au-component-set/src/${name}.ts`).concat([
  'app/src/renderer/src/projections/chooser-surface.ts',
  'app/src/renderer/src/projections/confirm-surface.ts',
]))

/** name -> { syntax, initial } for every registered token. */
function registry(): Map<string, { syntax: string; initial: string }> {
  const out = new Map<string, { syntax: string; initial: string }>()
  for (const f of ['tokens.css', 'ext.css']) {
    const src = readFileSync(path.join(STYLE, f), 'utf8')
    const re = /@property\s+(--au-[a-z0-9-]+)\s*\{([^}]*)\}/g
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const body = m[2]
      const syn = /syntax:\s*"([^"]*)"/.exec(body)?.[1] ?? '*'
      // Font stacks quote family names. A single-quoted value inserted into a single-quoted JS string
      // terminates it, so normalise to double quotes — equally valid CSS, and inert inside a JS string.
      const init = /initial-value:\s*([^;]+);/.exec(body)?.[1]?.trim().replace(/'/g, '"')
      if (init !== undefined) out.set(m[1], { syntax: syn, initial: init })
    }
  }
  return out
}

const SCAN_ROOTS = ['packages', 'projections', 'app/src']
const SCAN_EXT = new Set(['.ts', '.tsx', '.css'])
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'out', 'build', 'gallery'])

function* files(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP_DIR.has(e)) continue
    const p = path.join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) yield* files(p)
    else if (SCAN_ext(p)) yield p
  }
}
const SCAN_ext = (p: string) => SCAN_EXT.has(path.extname(p))

/**
 * Blank every comment to spaces, preserving offsets so --fix still edits the right bytes. A `var()`
 * written in prose is an EXAMPLE, not a call site: rewriting one turns an explanation into nonsense.
 */
function maskComments(src: string): string {
  const out = src.split('')
  const blank = (a: number, b: number) => {
    for (let i = a; i < b && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '
  }
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      blank(i, stop)
      i = stop - 1
    } else if (src[i] === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      blank(i, stop)
      i = stop - 1
    }
  }
  return out.join('')
}

/** Match `var(--au-x, <floor>)` with a balanced, possibly nested, floor. Comments are masked out. */
function scan(raw: string, onHit: (name: string, floor: string, start: number, end: number) => void): void {
  const src = maskComments(raw)
  const re = /var\(\s*(--au-[a-z0-9-]+)\s*,/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1
    let i = m.index + m[0].length
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
    }
    if (depth !== 0) continue
    const floorStart = m.index + m[0].length
    const floorEnd = i - 1
    onHit(m[1], src.slice(floorStart, floorEnd).trim(), floorStart, floorEnd)
  }
}

const norm = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase()
const isColour = (syntax: string) => syntax.includes('<color>')

const reg = registry()
const bad: { file: string; name: string; floor: string; want: string }[] = []
const colour: { file: string; name: string; floor: string; want: string }[] = []
let scanned = 0
let hits = 0

for (const root of SCAN_ROOTS) {
  for (const f of files(path.join(REPO, root))) {
    // Skip this tool and the token files themselves: both discuss `var()` in PROSE, and neither is a
    // consumer. Rewriting an explanatory example turns documentation into nonsense.
    if (f === fileURLToPath(import.meta.url)) continue
    if (path.dirname(f) === STYLE) continue
    const src = readFileSync(f, 'utf8')
    if (!src.includes('var(--au-')) continue
    scanned++
    let next = src
    const edits: { s: number; e: number; v: string }[] = []
    scan(src, (name, floor, s, e) => {
      const t = reg.get(name)
      if (!t) return
      hits++
      if (norm(floor) === norm(t.initial)) return
      const rel = path.relative(REPO, f)
      if (isColour(t.syntax)) colour.push({ file: rel, name, floor, want: t.initial })
      else {
        bad.push({ file: rel, name, floor, want: t.initial })
        edits.push({ s, e, v: t.initial })
      }
    })
    if (FIX && edits.length) {
      for (const ed of edits.reverse()) next = next.slice(0, ed.s) + ed.v + next.slice(ed.e)
      writeFileSync(f, next)
    }
  }
}

const byTok = (rows: typeof bad) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(`${r.name}, ${r.floor}  ->  ${r.want}`, (m.get(`${r.name}, ${r.floor}  ->  ${r.want}`) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

console.log(`scanned ${scanned} files, ${hits} tokenised floors, ${reg.size} registered tokens`)
console.log(`\nNON-COLOUR mismatches: ${bad.length}${FIX ? ' (rewritten)' : ''}`)
for (const [k, n] of byTok(bad).slice(0, 14)) console.log(`  ${String(n).padStart(4)}x  ${k}`)
console.log(`\ncolour mismatches (advisory outside reviewed ink owners): ${colour.length}`)
for (const [k, n] of byTok(colour).slice(0, 6)) console.log(`  ${String(n).padStart(4)}x  ${k}`)

if (REPORT) {
  console.log('\nMismatches by consumer (colour rows remain advisory unless their ink owner is reviewed):')
  for (const row of [...bad, ...colour]) {
    console.log(`${row.file}: ${row.name} fallback ${row.floor} -> ${row.want}`)
  }
}

if (!FIX && !REPORT && bad.length) {
  console.error(`\nFAIL — ${bad.length} non-colour floor(s) disagree with the registry. Run with --fix.`)
  process.exit(1)
}
console.log(bad.length === 0 ? '\nPASS — every non-colour floor matches its token.' : '')

const inkDrift = colour.filter(row => INK_PARITY_OWNERS.has(row.file) && /^--au-ink-[1-5]$/.test(row.name))
if (!REPORT && inkDrift.length) {
  for (const row of inkDrift) console.error(`${row.file}: ${row.name} fallback ${row.floor} must match ${row.want}`)
  console.error('FAIL — reviewed shared ink fallbacks drifted from their registered palette.')
  process.exitCode = 1
} else if (!inkDrift.length) console.log('PASS — reviewed picker/action ink fallbacks match the registry.')
