import { describe, it, expect } from 'vitest'
import { completionContext, frontmatterContext, wikilinkContext } from './completion-context'

// The forms are the engine's, per au-references' parse_wikilink and the
// wikilink-zoo guide: `name ::repo @commit #anchor ^block-id :field`.

describe('wikilinkContext', () => {
  it('returns null outside a link', () => {
    expect(wikilinkContext('just some prose')).toBeNull()
    expect(wikilinkContext('a [[closed]] link, then prose')).toBeNull()
  })

  it('does not cross a newline', () => {
    expect(wikilinkContext('[[open\nnext line')).toBeNull()
  })

  it('completes a bare target', () => {
    expect(wikilinkContext('see [[note')).toMatchObject({ slot: 'target', parts: { target: '' }, query: 'note' })
  })

  it('completes an empty target right after the brackets', () => {
    expect(wikilinkContext('see [[')).toMatchObject({ slot: 'target', query: '' })
  })

  it('completes a path-bearing target', () => {
    expect(wikilinkContext('[[content/refs/run')).toMatchObject({ slot: 'target', query: 'content/refs/run' })
  })

  // Qualified claims: the peer gate makes qualified claims normal,
  // and a parser that bails on `::` silently offers nothing.
  it('completes the ::repo qualifier', () => {
    expect(wikilinkContext('[[note::xr-ba')).toMatchObject({
      slot: 'repo',
      parts: { target: 'note', repo: null },
      query: 'xr-ba',
    })
  })

  it('keeps the repo once a later fragment opens', () => {
    expect(wikilinkContext('[[note::xr-base#Head')).toMatchObject({
      slot: 'anchor',
      parts: { target: 'note', repo: 'xr-base' },
      query: 'Head',
    })
  })

  it('completes the @commit pin, which binds to ::', () => {
    expect(wikilinkContext('[[note::xr-base@ab12')).toMatchObject({
      slot: 'commit',
      parts: { target: 'note', repo: 'xr-base' },
      query: 'ab12',
    })
  })

  it('treats a bare @ as literal filename text, not a commit', () => {
    expect(wikilinkContext('[[my@file')).toMatchObject({ slot: 'target', parts: { target: '' }, query: 'my@file' })
  })

  it('completes an anchor', () => {
    expect(wikilinkContext('[[note#Some Head')).toMatchObject({ slot: 'anchor', parts: { target: 'note' }, query: 'Some Head' })
  })

  it('completes a local anchor with an empty name', () => {
    expect(wikilinkContext('[[#Head')).toMatchObject({ slot: 'anchor', parts: { target: '' }, query: 'Head' })
  })

  it('completes a navigational block-id', () => {
    expect(wikilinkContext('[[note^blk')).toMatchObject({ slot: 'block', parts: { target: 'note' }, referent: false, query: 'blk' })
  })

  // One caret changes what the link contributes, so the mode must survive.
  it('completes a block-referent block-id and reports the doubled sigil', () => {
    expect(wikilinkContext('[[note^^blk')).toMatchObject({ slot: 'block', referent: true, query: 'blk' })
  })

  it('completes a local block-id', () => {
    expect(wikilinkContext('[[^scaling')).toMatchObject({ slot: 'block', parts: { target: '' }, query: 'scaling' })
  })

  it('completes a local block-referent', () => {
    expect(wikilinkContext('[[^^scaling')).toMatchObject({
      slot: 'block',
      parts: { target: '' },
      referent: true,
      query: 'scaling',
    })
  })

  it('completes a block-id after a local anchor', () => {
    expect(wikilinkContext('[[#head^blk')).toMatchObject({ slot: 'block', parts: { target: '' }, query: 'blk' })
  })

  it('completes a :field contribution', () => {
    expect(wikilinkContext('[[note:conf')).toMatchObject({ slot: 'field', parts: { target: 'note' }, query: 'conf' })
  })

  it('completes :field after a block-id', () => {
    expect(wikilinkContext('[[note^blk:conf')).toMatchObject({ slot: 'field', query: 'conf' })
  })

  // A heading is navigational, so it can never source a contribution: with a
  // `#head` and no block, every `:` is heading text.
  it('keeps a colon inside heading text in the anchor', () => {
    expect(wikilinkContext('[[note#Head: subtitle')).toMatchObject({ slot: 'anchor', query: 'Head: subtitle' })
  })

  it('completes a block-id after an anchor, the canonical order', () => {
    expect(wikilinkContext('[[note#head^blk')).toMatchObject({ slot: 'block', query: 'blk' })
  })

  it('refuses a malformed link rather than guessing', () => {
    expect(wikilinkContext('[[note^blk#head')).toBeNull() // `^` before `#` is reversed
    expect(wikilinkContext('[[note#head::repo')).toBeNull() // repo qualifier out of order
    expect(wikilinkContext('[[a::b::c')).toBeNull() // at most one ::repo
  })

  // The SDK settles validity by probe-filling the active slot and parsing the
  // whole link, so its grammar checks apply here for free.
  it('rejects a link the SDK refuses', () => {
    expect(wikilinkContext('[[note::b/c#head')).toBeNull() // ::repo breaks the identifier regex
    expect(wikilinkContext('[[note::1bad#head')).toBeNull() // a repo name must start with a letter
  })

  // Whole-link validation catches both of these: each has a prefix that parses fine ON ITS OWN.
  it('refuses a repo qualifier with no target', () => {
    expect(wikilinkContext('[[::xr-ba')).toBeNull() // `[[::repo]]` is empty-target, it resolves to nothing
  })

  it('refuses a field placed before an anchor', () => {
    expect(wikilinkContext('[[note:f#head')).toBeNull() // field-out-of-order, though `note:f` parses
  })

  // The inverse: prefix-only validation would have refused this one wrongly.
  it('completes a this-repo commit pin, whose bare prefix is empty-repo', () => {
    expect(wikilinkContext('[[note::@ab')).toMatchObject({
      slot: 'commit',
      parts: { target: 'note', repo: null },
      query: 'ab',
    })
  })

  // Mid-typing, though, an as-yet-invalid repo is just an unfinished one.
  it('still completes a repo whose typed text is not yet valid', () => {
    expect(wikilinkContext('[[note::b/c')).toMatchObject({ slot: 'repo', query: 'b/c' })
  })

  // There is no alias form in this system — the grammar is
  // `name ::repo @commit #anchor ^block-id :field` and stops there. So `|` is
  // ordinary target text, not a delimiter to split on.
  it('treats a pipe as literal target text, since there is no alias form', () => {
    expect(wikilinkContext('[[a|b')).toMatchObject({ slot: 'target', parts: { target: '' }, query: 'a|b' })
  })

  it('picks the innermost open link', () => {
    expect(wikilinkContext('[[done]] then [[nex')).toMatchObject({ slot: 'target', query: 'nex' })
  })
})

describe('frontmatterContext', () => {
  it('returns null without a leading block', () => {
    expect(frontmatterContext('# A heading\n\nprose')).toBeNull()
  })

  it('returns null once the block has closed', () => {
    expect(frontmatterContext('---\ntype: gadget\n---\n\nbody prose he')).toBeNull()
  })

  it('completes a fresh key and reports the claim and used keys', () => {
    const ctx = frontmatterContext('---\ntype: decision.pending\ndescription: "x"\nrat')
    expect(ctx).toMatchObject({
      slot: 'key',
      claim: ['decision.pending'],
      usedKeys: ['description'],
      query: 'rat',
    })
  })

  it('completes an empty fresh key line', () => {
    expect(frontmatterContext('---\ntype: gadget\n')).toMatchObject({ slot: 'key', query: '' })
  })

  it('completes the type claim itself', () => {
    expect(frontmatterContext('---\ntype: gad')).toMatchObject({ slot: 'type', field: 'type', query: 'gad' })
  })

  // The peer gate again: an unqualified peer claim is the error to prevent.
  it('completes a repo-qualified type claim', () => {
    expect(frontmatterContext('---\ntype: widget::xr-ba')).toMatchObject({ slot: 'type', query: 'widget::xr-ba' })
  })

  it('completes a field value', () => {
    expect(frontmatterContext('---\ntype: assumption\nconfidence: lo')).toMatchObject({
      slot: 'value',
      field: 'confidence',
      listItem: false,
      query: 'lo',
    })
  })

  it('reports a quoted value so insertion does not double the quote', () => {
    expect(frontmatterContext('---\ntype: assumption\ndescription: "part')).toMatchObject({
      slot: 'value',
      quoted: true,
      query: 'part',
    })
  })

  // Sealed-variant families claim a list of leaves.
  it('reads a list-form type claim', () => {
    const ctx = frontmatterContext('---\ntype:\n  - signal.ok\n  - phase.alpha\nchannel: "ops"\nlat')
    expect(ctx).toMatchObject({ slot: 'key', claim: ['signal.ok', 'phase.alpha'], usedKeys: ['channel'] })
  })

  it('completes another leaf of a list-form type claim', () => {
    expect(frontmatterContext('---\ntype:\n  - signal.ok\n  - phase.al')).toMatchObject({
      slot: 'type',
      listItem: true,
      query: 'phase.al',
    })
  })

  it('completes a list element as a value of its owning key', () => {
    const ctx = frontmatterContext('---\ntype: decision.decided\nassumptions:\n  - "[[clock]]"\n  - ')
    expect(ctx).toMatchObject({ slot: 'value', field: 'assumptions', listItem: true, query: '' })
  })

  // An inline record's keys belong to that record's own type, not the block's
  // claim, so offering the outer type's fields would be wrong.
  it('declines inside an inline record', () => {
    const ctx = frontmatterContext('---\ntype: citation\nsupport:\n  description: "x"\n  conf')
    expect(ctx).toMatchObject({ slot: 'nested' })
  })

  it('excludes type from the used keys', () => {
    const ctx = frontmatterContext('---\ntype: gadget\nlabel: my-gadget\n')
    expect(ctx?.usedKeys).toEqual(['label'])
  })
})

describe('completionContext', () => {
  it('offers nothing in prose', () => {
    expect(completionContext('---\ntype: gadget\n---\n\nplain body prose')).toBeNull()
  })

  // A reference-shaped list slot is the highest-value wikilink position, and it
  // sits inside frontmatter, so the wikilink check cannot be region-gated.
  it('prefers an open wikilink inside a frontmatter value', () => {
    const ctx = completionContext('---\ntype: decision.decided\nassumptions:\n  - "[[clo')
    expect(ctx).toMatchObject({ kind: 'wikilink', slot: 'target', query: 'clo' })
  })

  it('falls back to frontmatter when no link is open', () => {
    expect(completionContext('---\ntype: decision.decided\nassum')).toMatchObject({ kind: 'frontmatter', slot: 'key' })
  })

  it('offers a wikilink in body prose', () => {
    expect(completionContext('---\ntype: gadget\n---\n\nas seen in [[oth')).toMatchObject({
      kind: 'wikilink',
      query: 'oth',
    })
  })
})

// Inline YAML flow-sequence claims contribute every claimed type to completion.
describe('frontmatterContext — inline flow-sequence claims', () => {
  it('splits an inline claim list into separate claims', () => {
    const ctx = frontmatterContext('---\ntype: [person, quality]\nname: "Alice"\nga')
    expect(ctx).toMatchObject({ slot: 'key', claim: ['person', 'quality'], query: 'ga' })
  })

  it('still reads the single bare form', () => {
    expect(frontmatterContext('---\ntype: gadget\nla')).toMatchObject({ claim: ['gadget'] })
  })

  it('still reads the block form', () => {
    const ctx = frontmatterContext('---\ntype:\n  - signal.ok\n  - phase.alpha\nch')
    expect(ctx).toMatchObject({ claim: ['signal.ok', 'phase.alpha'] })
  })

  it('strips quotes from inline members', () => {
    expect(frontmatterContext('---\ntype: ["person", \'quality\']\nga')).toMatchObject({
      claim: ['person', 'quality'],
    })
  })

  // Mid-typing the sequence is unclosed. The members already typed are claims;
  // the one under the caret is the query.
  it('completes a member of an open inline sequence', () => {
    const ctx = frontmatterContext('---\ntype: [person, qual')
    expect(ctx).toMatchObject({ slot: 'type', claim: ['person'], query: 'qual' })
  })

  it('completes the first member of an open inline sequence', () => {
    expect(frontmatterContext('---\ntype: [per')).toMatchObject({ slot: 'type', claim: [], query: 'per' })
  })

  it('reads the effective fields of an inline-claimed file as a value position too', () => {
    const ctx = frontmatterContext('---\ntype: [person, quality]\nname: "Al')
    expect(ctx).toMatchObject({ slot: 'value', field: 'name', claim: ['person', 'quality'], query: 'Al' })
  })
})
