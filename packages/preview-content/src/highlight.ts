// Render file text as syntax-highlighted DOM. Engine semantic tokens supply type-aware spans
// for values, wikilinks, type claims and block ids. The shared reader/editor parser supplies local
// syntax for the source language. Hover previews use this for frontmatter, context and body text.

import type { WireSemanticToken } from '@arsumbris/au-engine-sdk/reads'

import { highlightSource } from '@arsumbris/code-syntax'

import { shapeKind, type FieldKind } from './semantic'

export interface HRange {
  from: number
  to: number
  cls: string
  /** For a resolved wikilink: the target file path, surfaced as `data-preview-path` on the span
   *  so the host preview surface can spawn a NESTED preview when cmd+hovered inside a card. */
  path?: string
}

function valClass(kind: FieldKind): string {
  switch (kind) {
    case 'number':
      return 'au-tok-val-number'
    case 'bool':
      return 'au-tok-val-bool'
    case 'ref':
      return 'au-tok-val-ref'
    case 'enum':
    case 'string':
    default:
      return 'au-tok-val-string'
  }
}

/** Type-aware spans from the engine semantic tokens (byte spans → char via `byteToChar`). */
export function semanticRanges(tokens: readonly WireSemanticToken[], byteToChar: (b: number) => number): HRange[] {
  const out: HRange[] = []
  for (const t of tokens) {
    const from = byteToChar(t.range.start)
    const to = byteToChar(t.range.end)
    if (from >= to) continue
    switch (t.kind) {
      case 'field-value':
        out.push({ from, to, cls: valClass(shapeKind(t.value_type)) })
        break
      case 'type-claim':
        out.push({ from, to, cls: 'au-tok-val-ref' })
        break
      case 'wikilink-resolved':
        out.push({ from, to, cls: 'au-tok-wikilink', path: t.resolved })
        break
      case 'wikilink-broken':
        out.push({ from, to, cls: 'au-tok-broken-wikilink' })
        break
      case 'block-id':
        out.push({ from, to, cls: 'au-tok-blockid' })
        break
      // type-def-file kinds: a `type-ref` (navigable type name in a shape / sealed branch / parent
      // claim) colors like a reference; a `shape-builtin` keyword + an `enum-member` literal get
      // their own tints. `field-shape` is a CONTAINER over the whole shape — its leaves (the above)
      // color it, so the container itself adds no range.
      case 'type-ref':
        out.push({ from, to, cls: 'au-tok-val-ref' })
        break
      case 'shape-builtin':
        out.push({ from, to, cls: 'au-tok-builtin' })
        break
      case 'enum-member':
        out.push({ from, to, cls: 'au-tok-val-string' })
        break
      // typed-block / anchor / field-shape: structural/containers, left to the leaves + syntax pass.
    }
  }
  return out
}

/** Commodity syntax uses Reader/Editor path discovery and parser roles. Semantic ranges win. */
export function syntaxRanges(text: string, path = ''): HRange[] {
  let position = 0
  return highlightSource(text, path).flatMap(part => {
    const from = position
    position += part.text.length
    return part.className ? [{ from, to: position, cls: part.className }] : []
  })
}

/** Render `text[from..to)` into a fragment, applying `ranges` (later ranges win per char). A
 *  resolved-wikilink range also tags its span with `data-preview-path` (for nested previews). */
export function renderHighlighted(text: string, from: number, to: number, ranges: readonly HRange[]): DocumentFragment {
  const len = Math.max(0, to - from)
  const cls = new Array<string | null>(len).fill(null)
  const pth = new Array<string | null>(len).fill(null)
  for (const r of ranges) {
    const a = Math.max(from, r.from) - from
    const b = Math.min(to, r.to) - from
    for (let i = a; i < b; i++) {
      if (i < 0 || i >= len) continue
      cls[i] = r.cls
      pth[i] = r.path ?? null // a later range may clear/replace the path with the cls
    }
  }
  const frag = document.createDocumentFragment()
  let i = 0
  while (i < len) {
    const c = cls[i]
    const p = pth[i]
    let j = i + 1
    while (j < len && cls[j] === c && pth[j] === p) j++ // group by (class, path)
    const chunk = text.slice(from + i, from + j)
    if (c) {
      const s = document.createElement('span')
      s.className = c
      if (p) s.dataset.previewPath = p
      s.textContent = chunk
      frag.appendChild(s)
    } else {
      frag.appendChild(document.createTextNode(chunk))
    }
    i = j
  }
  return frag
}
