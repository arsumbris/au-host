import { describe, it, expect } from 'vitest'
import { decideReveal, sameFile, type RevealState } from './reveal-arbitration'

// The behaviour under test is a RACE, and its failure mode is silent: a lost reveal looks exactly
// like a go-to-def that landed on the right file but the wrong line. Nothing in the app errors.
// So each case below names the wrong implementation it kills.

const loaded = (path: string): RevealState => ({ currentPath: path, awaitingRevealFor: null })
const loading = (path: string): RevealState => ({ currentPath: null, awaitingRevealFor: path })
const span = { from: 10, to: 20 }
const reveal = (path: string) => ({ mode: 'reveal-if-exists', path, range: span })

describe('sameFile', () => {
  it('matches identical paths', () => {
    expect(sameFile('a/b.md', 'a/b.md')).toBe(true)
  })

  it('matches an absolute path against a repo-relative one, either way round', () => {
    // The engine hands back absolute paths; a composition or an intent may carry a relative one.
    expect(sameFile('/repo/notes/a.md', 'notes/a.md')).toBe(true)
    expect(sameFile('notes/a.md', '/repo/notes/a.md')).toBe(true)
  })

  it('is ANCHORED on a slash, so a sibling directory does not match', () => {
    // Kills a naive `a.endsWith(b) || b.endsWith(a)`, which would say these are the same file.
    expect(sameFile('/repo/other-notes/a.md', 'notes/a.md')).toBe(false)
  })

  it('does not match a shared basename in unrelated trees', () => {
    expect(sameFile('/x/index.ts', '/y/index.ts')).toBe(false)
  })
})

describe('decideReveal — the file is already loaded', () => {
  it('reveals a span in our own file', () => {
    expect(decideReveal(reveal('a/b.md'), loaded('a/b.md'))).toEqual({ kind: 'reveal', span })
  })

  it('flashes without a span', () => {
    expect(decideReveal({ mode: 'reveal-if-exists', path: 'a/b.md' }, loaded('a/b.md'))).toEqual({ kind: 'flash' })
  })

  it('flashes but does NOT scroll under show-if-visible, even carrying a span', () => {
    // Kills an implementation that reads the range and ignores the mode: `show-if-visible` means
    // "mark where already on screen", so hijacking the viewport would be wrong.
    expect(decideReveal({ mode: 'show-if-visible', path: 'a/b.md', range: span }, loaded('a/b.md'))).toEqual({ kind: 'flash' })
  })

  it('ignores a highlight for a different file', () => {
    expect(decideReveal(reveal('other.md'), loaded('a/b.md'))).toEqual({ kind: 'ignore' })
  })

  it('matches our file across the absolute/relative split rather than by strict equality', () => {
    // Equivalent path spellings must reveal the requested range in the existing editor.
    expect(decideReveal(reveal('notes/a.md'), loaded('/repo/notes/a.md'))).toEqual({ kind: 'reveal', span })
  })
})

describe('decideReveal — the file is still loading (the mount race)', () => {
  it('PARKS a reveal aimed at the file being loaded', () => {
    // The whole reason this module exists: the container fires the highlight right after mounting
    // us, and our file load is an async engine read, so this signal normally arrives first.
    expect(decideReveal(reveal('a/b.md'), loading('a/b.md'))).toEqual({ kind: 'park', span })
  })

  it('parks across the absolute/relative split too', () => {
    expect(decideReveal(reveal('notes/a.md'), loading('/repo/notes/a.md'))).toEqual({ kind: 'park', span })
  })

  it('does NOT park a highlight for a file we are not loading', () => {
    // Kills a single unconditional slot: parking any stray reveal would leave a dead span sitting
    // in it, to be applied to whatever file happens to finish loading next.
    expect(decideReveal(reveal('elsewhere.md'), loading('a/b.md'))).toEqual({ kind: 'ignore' })
  })

  it('does NOT park a span-less highlight', () => {
    // Nothing to apply later, and parking it would clear a real parked span.
    expect(decideReveal({ mode: 'reveal-if-exists', path: 'a/b.md' }, loading('a/b.md'))).toEqual({ kind: 'ignore' })
  })

  it('does NOT park a show-if-visible signal', () => {
    expect(decideReveal({ mode: 'show-if-visible', path: 'a/b.md', range: span }, loading('a/b.md'))).toEqual({ kind: 'ignore' })
  })

  it('never parks once the file is loaded — a loaded match reveals NOW', () => {
    // Kills an ordering inversion (parking checked before the loaded check), which would defer a
    // reveal that should happen immediately, and then never apply it because no load follows.
    expect(decideReveal(reveal('a/b.md'), { currentPath: 'a/b.md', awaitingRevealFor: 'a/b.md' })).toEqual({
      kind: 'reveal',
      span,
    })
  })
})

describe('decideReveal — malformed signals', () => {
  it('ignores a signal with no path', () => {
    expect(decideReveal({ mode: 'reveal-if-exists', range: span }, loaded('a/b.md'))).toEqual({ kind: 'ignore' })
  })

  it('ignores a half-formed range rather than revealing a partial span', () => {
    // Kills a `range?.from ?? 0` style default, which would scroll to the top of the file and read
    // as "go-to-def went to the wrong place" instead of "did nothing".
    const state = loaded('a/b.md')
    expect(decideReveal({ mode: 'reveal-if-exists', path: 'a/b.md', range: { from: 10 } }, state)).toEqual({ kind: 'flash' })
    expect(decideReveal({ mode: 'reveal-if-exists', path: 'a/b.md', range: { to: 20 } }, state)).toEqual({ kind: 'flash' })
  })

  it('treats a zero-offset span as real, not as absent', () => {
    // Kills a truthiness check on `from` — byte 0 is the first byte of the file, a legitimate target.
    expect(decideReveal({ mode: 'reveal-if-exists', path: 'a/b.md', range: { from: 0, to: 0 } }, loaded('a/b.md'))).toEqual({
      kind: 'reveal',
      span: { from: 0, to: 0 },
    })
  })

  it('ignores an absent mode', () => {
    expect(decideReveal({ path: 'a/b.md', range: span }, loading('a/b.md'))).toEqual({ kind: 'ignore' })
  })
})
