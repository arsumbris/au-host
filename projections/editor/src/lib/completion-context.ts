/**
 * What the caret is completing: a parser over the text BEFORE the caret.
 *
 * It answers only "what slot is the caret in, and what has been typed into it",
 * never "what are the candidates". Candidates are semantic and belong to the
 * engine.
 *
 * The wikilink GRAMMAR is not ours. `@arsumbris/au-host-sdk/engine-reads` owns both the
 * parser and the caret question, so nothing here re-walks a delimiter rule. What
 * stays is the surface concern the SDK deliberately does not take: finding the open
 * `[[` in a buffer. The frontmatter half is ours; the engine has no counterpart.
 *
 * No DOM, no CodeMirror, no daemon client. The one dependency is the SDK's pure,
 * renderer-safe grammar module.
 */

import { wikilinkCaretContext, type WikilinkCaretContext } from '@arsumbris/au-host-sdk/engine-reads'

export type { WikilinkSlot } from '@arsumbris/au-host-sdk/engine-reads'

// ── wikilink ─────────────────────────────────────────────────────────────

/**
 * The SDK's caret context, tagged so it discriminates against the frontmatter one.
 *
 * Carries `parts` (the COMPLETED prefix, with the active slot null, or `''` for
 * `target`), `referent` (the `^^` sigil of the block-id BEING typed), and `query`.
 */
export interface WikilinkContext extends WikilinkCaretContext {
  kind: 'wikilink'
}

/**
 * The open `[[…` at the caret, or null when there is none.
 *
 * A link is "open" when the nearest preceding `[[` is not closed by `]]` and
 * carries no newline — wikilinks are single-line. That bracket scan is a buffer
 * concern, so it stays here; everything past it is the SDK's.
 *
 * Null for a malformed link. The SDK settles that by reassembling the link with
 * the unfinished slot probe-filled and parsing THAT, so a completion answer can
 * never disagree with the validator about what resolves.
 */
export function wikilinkContext(before: string): WikilinkContext | null {
  const open = before.lastIndexOf('[[')
  if (open < 0) return null
  const inner = before.slice(open + 2)
  if (inner.includes(']]') || inner.includes('\n')) return null

  const at = wikilinkCaretContext(inner)
  return at === null ? null : { kind: 'wikilink', ...at }
}

// ── frontmatter ──────────────────────────────────────────────────────────

/**
 * Where in the `---` block the caret sits.
 *
 * `nested` is the honest "we cannot know": the caret is inside an inline record,
 * whose fields belong to that record's own type, not the block's claim. A source
 * declines rather than offering the outer type's fields.
 */
export type FrontmatterSlot = 'type' | 'key' | 'value' | 'nested'

export interface FrontmatterContext {
  kind: 'frontmatter'
  slot: FrontmatterSlot
  /** The `type:` claim. A list for a sealed-variant family; empty when unclaimed. */
  claim: string[]
  /** Top-level keys already present before the caret, `type` excluded. */
  usedKeys: string[]
  /** The key whose value is being completed; `''` for slot `key`. */
  field: string
  /** True when the caret is on a `- ` element rather than the key's own line. */
  listItem: boolean
  /** True when the value opens with a quote, which insertion must not duplicate. */
  quoted: boolean
  query: string
}

const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/
const NESTED_KEY = /^[ \t]+[A-Za-z_][A-Za-z0-9_-]*:/
const LIST_ITEM = /^([ \t]*)-[ \t]*(.*)$/
const PARTIAL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*)?$/

/**
 * The frontmatter position at the caret, or null when the caret is not inside
 * an open `---` block.
 *
 * `before` is the document text from the file start, so the block is recognised
 * by the leading `---` and closed by the next one.
 */
export function frontmatterContext(before: string): FrontmatterContext | null {
  if (!before.startsWith('---\n')) return null
  const lines = before.split('\n')
  const current = lines[lines.length - 1]

  const claim: string[] = []
  const usedKeys: string[] = []
  let owner = '' // the top-level key a list element would belong to
  let typeIsList = false
  let nestedSinceKey = false

  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i]
    if (line.trim() === '---') return null // the caret is past the block

    const kv = TOP_LEVEL_KEY.exec(line)
    if (kv) {
      const [, key, inline] = kv
      owner = key
      nestedSinceKey = false
      if (key === 'type') {
        typeIsList = inline === ''
        if (inline !== '') claim.push(...inlineClaims(inline))
      } else {
        usedKeys.push(key)
      }
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item && !nestedSinceKey) {
      if (owner === 'type' && typeIsList) claim.push(unquote(item[2]).text)
      continue
    }
    if (NESTED_KEY.test(line)) nestedSinceKey = true
  }

  const base = { kind: 'frontmatter' as const, claim, usedKeys }

  const item = LIST_ITEM.exec(current)
  if (item) {
    if (nestedSinceKey) return { ...base, slot: 'nested', field: owner, listItem: true, quoted: false, query: '' }
    const { text, quoted } = unquote(item[2])
    const slot = owner === 'type' ? 'type' : 'value'
    return { ...base, slot, field: owner, listItem: true, quoted, query: text }
  }

  const kv = TOP_LEVEL_KEY.exec(current)
  if (kv) {
    const slot = kv[1] === 'type' ? 'type' : 'value'
    // Inside an open inline flow sequence the caret is on ONE member, so the query
    // is the text after the last comma — not the whole `[a, b` run. The members
    // already typed are claims, and the caller has collected them.
    const raw = kv[2]
    const open = raw.trimStart().startsWith('[')
    const member = open ? raw.slice(raw.lastIndexOf(raw.includes(',') ? ',' : '[') + 1) : raw
    const { text, quoted } = unquote(member)
    if (open) claim.push(...inlineClaims(raw).slice(0, -1))
    return { ...base, slot, field: kv[1], listItem: false, quoted, query: text }
  }

  if (/^[ \t]/.test(current)) {
    return { ...base, slot: 'nested', field: owner, listItem: false, quoted: false, query: '' }
  }

  const partial = PARTIAL_KEY.exec(current)
  if (partial) return { ...base, slot: 'key', field: '', listItem: false, quoted: false, query: partial[1] ?? '' }

  return null
}

// ── entry ────────────────────────────────────────────────────────────────

export type CompletionContext = WikilinkContext | FrontmatterContext

/**
 * The caret's completion context, or null where none is meaningful (prose).
 *
 * A wikilink wins wherever it is open, including inside a frontmatter value —
 * `assumptions:\n  - "[[…` is a reference position, not a plain scalar.
 */
export function completionContext(before: string): CompletionContext | null {
  return wikilinkContext(before) ?? frontmatterContext(before)
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Read claims from an inline type value: a bare name or a YAML flow sequence.
 * Block sequences are handled by the caller's line walk. An unfinished flow
 * sequence still contributes the claims already typed into it. */
function inlineClaims(inline: string): string[] {
  const text = inline.trim()
  if (!text.startsWith('[')) return [text]
  return text
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    // A completed member may be quoted on BOTH sides, unlike the half-typed value
    // `unquote` serves, so strip a matched pair.
    .map((c) => c.trim().replace(/^(["'])(.*)\1$/, '$2').replace(/^["']/, '').trim())
    .filter((c) => c !== '')
}

/** Strip a leading YAML quote, reporting whether one was there. */
function unquote(raw: string): { text: string; quoted: boolean } {
  const text = raw.trimStart()
  if (text.startsWith('"') || text.startsWith("'")) return { text: text.slice(1), quoted: true }
  return { text, quoted: false }
}
