// Helpers for engine semantic tokens: disk-state spans addressed by byte offsets.
// The field-to-kind map supports type-aware coloring while typing. Resolved tokens also provide
// facts the live syntax layer cannot determine, such as broken wikilinks.

import type { WireSemanticToken, WireShape } from '@arsumbris/au-engine-sdk/reads'

/** The colorable kinds a value can have. */
export type FieldKind = 'string' | 'number' | 'bool' | 'enum' | 'ref'

/** Classify the engine's parsed value shape into a colorable kind. */
export function shapeKind(shape: WireShape): FieldKind {
  switch (shape.kind) {
    case 'primitive':
      if (shape.name === 'Boolean') return 'bool'
      if (shape.name === 'Number') return 'number'
      if (shape.name === 'Url') return 'ref'
      return 'string' // String, Date, DateTime
    case 'enum':
      return 'enum'
    case 'reference':
    case 'record':
    case 'inline-or-reference':
    case 'compound-reference':
      return 'ref'
    case 'list':
      return shapeKind(shape.inner)
    case 'refined':
      // `Base{predicate}` — classify by the refined base, same as the bare primitive (schema 27).
      if (shape.base === 'Number') return 'number'
      if (shape.base === 'Url') return 'ref'
      return 'string' // String, Date, DateTime (Boolean/Url are never refined)
    default:
      return 'string' // union, intersection, unknown
  }
}

/** A compact human label for a parsed shape, for the debug inspector. */
export function shapeLabel(shape: WireShape): string {
  switch (shape.kind) {
    case 'primitive':
      return shape.name
    case 'enum':
      return `enum[${shape.members.join(', ')}]`
    case 'reference':
      return `${shape.name}*`
    case 'record':
      return shape.name
    case 'inline-or-reference':
      return `${shape.name}&`
    case 'list':
      return `${shapeLabel(shape.inner)}[]`
    case 'union':
      return shape.branches.map(shapeLabel).join(' | ')
    case 'intersection':
      return shape.branches.map(shapeLabel).join(' & ')
    case 'refined': {
      // `Base{predicate}` — reconstruct the predicate for the debug inspector (schema 27).
      const r = shape.refinement
      if (r.pattern !== undefined) return `${shape.base}{/${r.pattern}/}`
      const parts: string[] = []
      if (r.lower) parts.push(`>${r.lower.inclusive ? '=' : ''}${r.lower.value}`)
      if (r.upper) parts.push(`<${r.upper.inclusive ? '=' : ''}${r.upper.value}`)
      if (r.integer) parts.push('integer')
      return `${shape.base}{${parts.join(' & ')}}`
    }
    default:
      return shape.kind
  }
}

/** A compact human label for an engine semantic token, for the debug inspector. */
export function tokenLabel(token: WireSemanticToken): string {
  switch (token.kind) {
    case 'field-value':
      return `field-value ${token.field}: ${shapeLabel(token.value_type)}`
    case 'wikilink-resolved':
      return `wikilink-resolved → ${token.target}`
    case 'wikilink-broken':
      return `wikilink-broken ${token.target}`
    case 'type-claim':
      return `type-claim ${token.name}`
    case 'typed-block':
      return `typed-block ${token.field}`
    case 'block-id':
      return `block-id ${token.id}`
    case 'anchor':
      return `anchor ${token.text}`
    // type-def-file kinds (the engine tokenizes type-def files too).
    case 'field-shape':
      return `field-shape ${token.field}: ${token.value_type ? shapeLabel(token.value_type) : '?'}`
    case 'type-ref':
      return `type-ref ${token.name}`
    case 'shape-builtin':
      return `shape-builtin ${token.name}`
    case 'enum-member':
      return `enum-member ${token.value}`
    default:
      return (token as { kind: string }).kind
  }
}

/** Fallback for the live guess when the engine has no type for a field. */
export function naiveKind(value: string): FieldKind {
  const v = value.trim()
  if (/^(true|false)$/i.test(v)) return 'bool'
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number'
  return 'string'
}

/** The leading `--- ... ---` frontmatter region as absolute offsets, or null. */
export function frontmatterRegion(text: string): { start: number; end: number } | null {
  const firstNL = text.indexOf('\n')
  if (firstNL === -1 || text.slice(0, firstNL).trim() !== '---') return null
  const close = /\n---[ \t]*(?:\n|$)/.exec(text)
  if (!close) return null
  return { start: firstNL + 1, end: close.index + 1 }
}

function utf8Len(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/**
 * Map an engine UTF-8 byte offset to a CodeMirror UTF-16 position. Built once per
 * fetch from the buffer text (valid while buffer == disk). ASCII maps 1:1.
 */
export function makeByteToChar(text: string): (byte: number) => number {
  const byteAt = [0]
  const charAt = [0]
  let b = 0
  let c = 0
  for (const ch of text) {
    b += utf8Len(ch.codePointAt(0) ?? 0)
    c += ch.length
    byteAt.push(b)
    charAt.push(c)
  }
  const totalBytes = b
  const totalChars = c
  return (byte: number): number => {
    if (byte >= totalBytes) return totalChars
    if (byte <= 0) return 0
    let lo = 0
    let hi = byteAt.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (byteAt[mid] <= byte) lo = mid
      else hi = mid - 1
    }
    return charAt[lo]
  }
}
