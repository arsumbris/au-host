import { describe, expect, it } from 'vitest'

import { declaredPropertyNames, rejectedTokenNames } from '../src/index.ts'

// TOKEN REGISTRATION — the rule for "declared, but the browser refused it".
//
// The defect is an ABSENCE, not a bad value. A registered custom property whose `initial-value` is
// not computationally independent under a non-universal `syntax` makes the whole `@property` rule
// invalid; an invalid at-rule is dropped at parse time and never becomes a `CSSPropertyRule`. So
// enumerating the CSSOM shows only the SUCCESSES, and the only way to see the failure is to read
// the source text and diff it against what registered.
//
// This suite covers the RULE. That a browser really does drop the rule — the premise the rule rests
// on — also needs verification in Chromium; this unit suite does not establish browser registration.
//
// The load-bearing property here is what the rule does NOT do: it never asks "is this unit
// relative". It compares against the browser's own verdict, which is why it cannot rot as CSS grows
// and why it stays silent on a relative unit under `syntax: "*"` (legal, and it registers).

describe('declaredPropertyNames', () => {
  it('finds every @property declaration', () => {
    const css = `
      @property --au-a { syntax: "<time>"; inherits: true; initial-value: 1ms; }
      @property --au-b { syntax: "*"; inherits: true; initial-value: x; }
    `
    expect(declaredPropertyNames(css)).toEqual(['--au-a', '--au-b'])
  })

  it('does NOT count an @property shown as an example inside a comment', () => {
    // This repo's own token files document the syntax in prose. Counting those would report a
    // permanent phantom rejection for a token that was never declared — a false alarm, which is
    // worse than no check at all.
    const css = `
      /* e.g. @property --au-ghost { syntax: "<length>"; initial-value: 4rem; } */
      @property --au-real { syntax: "<length>"; inherits: true; initial-value: 4px; }
    `
    expect(declaredPropertyNames(css)).toEqual(['--au-real'])
  })

  it('spans a multi-line comment, so a commented-out BLOCK is fully ignored', () => {
    const css = `
      /*
        @property --au-x { syntax: "*"; initial-value: a; }
        @property --au-y { syntax: "*"; initial-value: b; }
      */
      @property --au-z { syntax: "*"; inherits: true; initial-value: c; }
    `
    expect(declaredPropertyNames(css)).toEqual(['--au-z'])
  })

  it('tolerates arbitrary whitespace between the at-rule and the name', () => {
    expect(declaredPropertyNames('@property\n  --au-w { syntax: "*"; }')).toEqual(['--au-w'])
  })
})

describe('rejectedTokenNames', () => {
  const css = `
    @property --au-ok  { syntax: "<time>";   inherits: true; initial-value: 1ms; }
    @property --au-bad { syntax: "<length>"; inherits: true; initial-value: 4rem; }
  `

  it('reports a declared token the browser did not register', () => {
    expect(rejectedTokenNames(css, ['--au-ok'])).toEqual(['--au-bad'])
  })

  it('reports nothing when everything registered', () => {
    expect(rejectedTokenNames(css, ['--au-ok', '--au-bad'])).toEqual([])
  })

  it('reports EVERY declared token when nothing registered at all', () => {
    // The whole-sheet-failed case. Reporting one and hiding the rest would send the author
    // chasing a single token when the sheet never applied.
    expect(rejectedTokenNames(css, [])).toEqual(['--au-ok', '--au-bad'])
  })

  it('never reports a relative unit that DID register — the syntax:"*" case', () => {
    // The rule must not reimplement the spec. Under `syntax: "*"` an arbitrary token stream is
    // legal, so `4rem` registers fine; this repo's four `--au-ls-*` tokens depend on it. A gate
    // that flagged those would be a false alarm, which is worse than no gate.
    const star = '@property --au-ls-x { syntax: "*"; inherits: true; initial-value: 0.02em; }'
    expect(rejectedTokenNames(star, ['--au-ls-x'])).toEqual([])
  })

  it('deduplicates a name declared twice', () => {
    const twice = `
      @property --au-dup { syntax: "*"; inherits: true; initial-value: a; }
      @property --au-dup { syntax: "*"; inherits: true; initial-value: b; }
    `
    expect(rejectedTokenNames(twice, [])).toEqual(['--au-dup'])
  })

  it('accepts a Set as well as an array, without rebuilding it', () => {
    expect(rejectedTokenNames(css, new Set(['--au-ok', '--au-bad']))).toEqual([])
  })

  it('is empty for a sheet declaring no tokens at all', () => {
    expect(rejectedTokenNames(':root { color: red }', [])).toEqual([])
  })
})
