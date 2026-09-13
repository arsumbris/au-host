// Content builders for the host's preview overlay surface (`host.preview`). Each returns a
// `FillFn` the surface hosts (the host owns the chrome, this builds the CONTENT). Shared by the
// editor + the type-list + future consumers (backlinks rows, an inline references preview, a canvas).
// - previewLink / previewType: the rich PREVIEW (a file's frontmatter + context + body), engine-
//   syntax-highlighted (`highlight.ts`) with line numbers on the context.
// - compact: the lightweight token info (type / field / wikilink), the cross-member type read.
// Engine-driven, but DOM-only output — the surface stays pure chrome.


import type { WireReader, WireSemanticToken } from '@arsumbris/au-engine-sdk/reads'
import {
  readReferencesIn,
  readContent,
  readInstancesOf,
  readResolveAnchor,
  readResolveBlockId,
  readResolveTarget,
  readSemanticTokens,
  readType,
  readTypeClosure,
} from '@arsumbris/au-engine-sdk/reads'
import { sameType } from '@arsumbris/type-query'

import { renderHighlighted, semanticRanges, syntaxRanges } from './highlight'
import { makeByteToChar, shapeLabel } from './semantic'

/** A caller-supplied content builder for the host preview surface: populate `card`; `isCurrent`
 *  goes false once the show is superseded/hidden (so an async fill can bail). */
export type FillFn = (card: HTMLElement, isCurrent: () => boolean) => void | Promise<void>

function basename(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i < 0 ? t : t.slice(i + 1)
}

/** Frontmatter / body offsets + the `type:` claim, for the preview header + sections. */
function frontmatter(text: string): { fmFrom: number; fmTo: number; bodyFrom: number; types: string | null } {
  if (!text.startsWith('---')) return { fmFrom: 0, fmTo: 0, bodyFrom: 0, types: null }
  const close = /\n---[ \t]*(\n|$)/.exec(text)
  if (!close) return { fmFrom: 0, fmTo: 0, bodyFrom: 0, types: null }
  const firstNL = text.indexOf('\n')
  const fmFrom = firstNL < 0 ? 0 : firstNL + 1
  const fmTo = close.index
  const bodyFrom = close.index + close[0].length
  const fm = text.slice(fmFrom, fmTo)
  const m = /^type:[ \t]*(.*)$/m.exec(fm)
  let types: string | null = null
  if (m) {
    const inline = m[1].trim().replace(/^\[|\]$/g, '').trim()
    if (inline) types = inline
    else {
      const items = [...fm.matchAll(/^[ \t]*-[ \t]*([A-Za-z][\w.-]*)/gm)].map((x) => x[1])
      if (items.length) types = items.join(', ')
    }
  }
  return { fmFrom, fmTo, bodyFrom, types }
}

/** Char range (excluding the trailing newline) of each line. */
function lineRanges(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let start = 0
  for (const line of text.split('\n')) {
    out.push({ start, end: start + line.length })
    start += line.length + 1
  }
  return out
}

const el = (cls: string): HTMLElement => {
  const d = document.createElement('div')
  d.className = cls
  return d
}

function muted(card: HTMLElement, text: string, cls = 'au-pcard-muted'): void {
  const d = el(cls)
  d.textContent = text
  card.appendChild(d)
}

function header(card: HTMLElement, name: string, types: string | null): void {
  const h = el('au-pcard-header')
  const n = el('au-pcard-name')
  n.textContent = name
  h.appendChild(n)
  if (types) {
    const t = el('au-pcard-types')
    t.textContent = types
    h.appendChild(t)
  }
  card.appendChild(h)
}

function section(card: HTMLElement, label: string, build: (s: HTMLElement) => void): void {
  const s = el('au-pcard-section')
  const l = el('au-pcard-label')
  l.textContent = label
  s.appendChild(l)
  build(s)
  card.appendChild(s)
}

const BODY_CHAR_CAP = 4000

export interface HoverContent {
  previewLink(target: { target: string; blockId?: string; anchor?: string; from?: string | null }): FillFn
  /** Preview an already-resolved FILE path directly (no resolution), optionally with a context
   *  line. The nested-preview entry (a `data-preview-path` span spawns `previewPath(path)`), and
   *  the backlinks-row entry (`previewPath(source, refLine)`). */
  previewPath(path: string, line?: number): FillFn
  previewType(name: string): FillFn
  /** Preview a FIELD declared on an instance: walk the claimed types' closure to the type-def that
   *  DECLARES `field`, then show its shape, declaring type, required flag, and its `#:` docstring. */
  previewField(field: string, claims: string[]): FillFn
  /** A find-all-references LIST (not a file preview): the backlinks into `file` (optionally only
   *  those targeting `blockId`), each row `source:line`. A row click calls `onOpen`; a row also
   *  carries `data-preview-path` so cmd+hover nests a preview of the source. */
  previewReferences(file: string, opts?: { blockId?: string; onOpen?: (path: string, line?: number, span?: {start: number; end: number}) => void }): FillFn
  /** A find-all-INSTANCES list (the type-claim inline preview): `instances_of(type)`, each row a
   *  `basename · claim`. A row click calls `onOpen`; a row carries `data-preview-path` so cmd+hover
   *  nests a preview of the instance file. */
  previewInstances(type: string, opts?: { onOpen?: (path: string) => void }): FillFn
  compact(token: WireSemanticToken): FillFn
}

export function makeHoverContent(engine: WireReader): HoverContent {
  // Read + render a file preview (frontmatter / context-around-line / body), engine-highlighted.
  async function renderPreview(card: HTMLElement, path: string, line: number | undefined, isCurrent: () => boolean): Promise<void> {
    const [read, tokRes] = await Promise.all([readContent(engine, path), readSemanticTokens(engine, path)])
    if (!isCurrent()) return
    const text = 'ready' in read && read.ready && read.result ? read.result.text ?? '' : ''
    const tokens: WireSemanticToken[] = 'ready' in tokRes && tokRes.ready && tokRes.result ? tokRes.result : []
    const byteToChar = makeByteToChar(text)
    const ranges = [...syntaxRanges(text, path), ...semanticRanges(tokens, byteToChar)] // semantic wins (last)
    card.replaceChildren()
    const { fmFrom, fmTo, bodyFrom, types } = frontmatter(text)
    header(card, basename(path), types)
    card.dataset.previewFile = path

    if (fmTo > fmFrom) {
      section(card, 'frontmatter', (s) => {
        const pre = el('au-pcard-pre')
        pre.appendChild(renderHighlighted(text, fmFrom, fmTo, ranges))
        s.appendChild(pre)
      })
    }

    if (line != null && line >= 1) {
      const lines = lineRanges(text)
      const idx = line - 1
      const from = Math.max(0, idx - 2)
      const to = Math.min(lines.length - 1, idx + 2)
      section(card, 'context', (s) => {
        const code = el('au-pcard-code')
        for (let i = from; i <= to; i++) {
          const g = el('au-pcard-gutter' + (i === idx ? ' target' : ''))
          g.textContent = String(i + 1)
          const ln = el('au-pcard-codeline' + (i === idx ? ' target' : ''))
          ln.appendChild(renderHighlighted(text, lines[i].start, lines[i].end, ranges))
          code.append(g, ln)
        }
        s.appendChild(code)
      })
    }

    const bodyText = text.slice(bodyFrom)
    if (bodyText.trim()) {
      section(card, 'body', (s) => {
        const pre = el('au-pcard-pre')
        pre.appendChild(renderHighlighted(text, bodyFrom, Math.min(text.length, bodyFrom + BODY_CHAR_CAP), ranges))
        s.appendChild(pre)
      })
    }
    if (fmTo <= fmFrom && !bodyText.trim() && line == null) muted(card, '(empty)')
  }

  return {
    previewLink(t) {
      return async (card, isCurrent) => {
        muted(card, `loading ${t.target || '…'}…`)
        let path: string | undefined
        let line: number | undefined
        try {
          // `from` (the file the link appears in) is the origin: it scopes resolution to that
          // source's repo, so a bare target resolves member-local and a `::repo` target resolves
          // cross-repo (the embedded `::repo` rides on `target` untouched).
          const origin = t.from ?? undefined
          if (t.blockId) {
            const o = await readResolveBlockId(engine, t.target, t.blockId, origin)
            if ('ready' in o && o.ready && o.result) (path = o.result.file_path), (line = o.result.span.line_col?.start.line)
          } else if (t.anchor) {
            const o = await readResolveAnchor(engine, t.target, t.anchor, origin)
            if ('ready' in o && o.ready && o.result) (path = o.result.file_path), (line = o.result.span.line_col?.start.line)
          } else {
            const o = await readResolveTarget(engine, t.target, origin)
            if ('ready' in o && o.ready && o.result) path = o.result.path
          }
        } catch {
          /* unresolved */
        }
        if (!isCurrent()) return
        if (!path) {
          card.replaceChildren()
          muted(card, `couldn't resolve ${t.target}${t.blockId ? '^' + t.blockId : t.anchor ? '#' + t.anchor : ''}`, 'au-pcard-error')
          return
        }
        await renderPreview(card, path, line, isCurrent)
      }
    },

    previewPath(path, line) {
      return async (card, isCurrent) => {
        muted(card, `loading ${basename(path)}…`)
        if (!isCurrent()) return
        await renderPreview(card, path, line, isCurrent)
      }
    },

    previewReferences(file, opts) {
      return async (card, isCurrent) => {
        muted(card, `references to ${basename(file)}…`)
        const out = await readReferencesIn(engine, file)
        if (!isCurrent()) return
        card.replaceChildren()
        const links = 'ready' in out && out.ready && out.result ? out.result : []
        // schema 7: a backlink's TARGET `block_id` is `{ id, referent }` (reference
        // surface). Match the id; the `^`/`^^` mode is irrelevant to "refs to this block".
        const refs = opts?.blockId ? links.filter((b) => b.block_id?.id === opts.blockId) : links
        header(card, basename(file), opts?.blockId ? `^${opts.blockId}` : null)
        if (refs.length === 0) {
          muted(card, 'no references')
          return
        }
        section(card, `${refs.length} reference${refs.length === 1 ? '' : 's'}`, (s) => {
          for (const b of refs) {
            const line = b.line_col?.start.line
            const row = el('au-pcard-ref')
            row.dataset.previewPath = b.source // cmd+hover a row nests a preview of the source
            const name = el('au-pcard-ref-name')
            name.textContent = `${basename(b.source)}${line != null ? `:${line}` : ''}`
            row.appendChild(name)
            if (b.slot) {
              const slot = el('au-pcard-ref-slot')
              slot.textContent = b.slot
              row.appendChild(slot)
            }
            row.addEventListener('click', () => opts?.onOpen?.(b.source, line, {start: b.span_start, end: b.span_end}))
            s.appendChild(row)
          }
        })
      }
    },

    previewInstances(type, opts) {
      return async (card, isCurrent) => {
        muted(card, `instances of ${type}…`)
        const out = await readInstancesOf(engine, type, { origins: ['file'] })
        if (!isCurrent()) return
        card.replaceChildren()
        // schema-6 `instances_of` returns MATCH RECORDS, so a bare-type query can repeat an instance
        // under several identity hashes. This is a per-instance list, so dedupe by path.
        const raw = 'ready' in out && out.ready && out.result ? out.result : []
        const seen = new Set<string>()
        const insts = raw.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)))
        header(card, type, 'instances')
        if (insts.length === 0) {
          muted(card, 'no instances')
          return
        }
        // A `::repo`-qualified claim keeps its scope in schema-6; compare by type IDENTITY so the
        // queried type is excluded from the "others" hint whether or not either side is qualified.
        section(card, `${insts.length} instance${insts.length === 1 ? '' : 's'}`, (s) => {
          for (const inst of insts) {
            const row = el('au-pcard-ref')
            row.dataset.previewPath = inst.path // cmd+hover a row nests a preview of the instance
            const name = el('au-pcard-ref-name')
            name.textContent = basename(inst.path)
            row.appendChild(name)
            // the claimed types beyond the queried one, as the row's "slot"-style hint.
            const others = inst.claim.filter((c) => !sameType(c, type))
            if (others.length > 0) {
              const slot = el('au-pcard-ref-slot')
              slot.textContent = others.join(', ')
              row.appendChild(slot)
            }
            row.addEventListener('click', () => opts?.onOpen?.(inst.path))
            s.appendChild(row)
          }
        })
      }
    },

    previewType(name) {
      return async (card, isCurrent) => {
        muted(card, `loading type ${name}…`)
        // Schema 14: a type has ONE owner, and the `type` read carries its
        // definition location (`source.file` + `span`). The authored name (bare | `name::repo`)
        // resolves to that owner (bare = workspace-unique, `::repo` scopes to a repo's identity).
        const o = await readType(engine, name)
        if (!isCurrent()) return
        const t = 'ready' in o && o.ready && o.result ? o.result : undefined
        if (!t) {
          card.replaceChildren()
          muted(card, `no type-def for ${name}`, 'au-pcard-error')
          return
        }
        await renderPreview(card, t.source.file, t.source.span.line_col?.start.line, isCurrent)
      }
    },

    previewField(field, claims) {
      return async (card, isCurrent) => {
        muted(card, `resolving field ${field}…`)
        // The engine's type_closure read returns each claim's effective fields, including inherited fields,
        // with the declaring type in origin. A bare claim searches all mounted identities; name::repo scopes
        // the lookup to one identity. The engine resolves mixin collisions and auto-unification.
        for (const claim of claims) {
          const o = await readTypeClosure(engine, claim)
          if (!isCurrent()) return
          if (!('ready' in o) || !o.ready) continue
          const f = o.result.flatMap((e) => e.fields).find((x) => x.name === field)
          if (!f) continue
          card.replaceChildren()
          const h = el('au-pcard-header')
          const nm = el('au-pcard-name')
          nm.textContent = `${f.name}${f.required ? '' : '?'}: ${f.shape}`
          h.appendChild(nm)
          card.appendChild(h)
          const body = el('au-pcard-section')
          const sub = (text: string, cls = 'au-pcard-sub'): void => {
            const d = el(cls)
            d.textContent = text
            body.appendChild(d)
          }
          if (f.doc) sub(f.doc, 'au-pcard-doc')
          sub(`declared on ${f.origin.name}${f.required ? ' · required' : ' · optional'}`)
          card.appendChild(body)
          return
        }
        card.replaceChildren()
        muted(card, `no declaration for field '${field}'`, 'au-pcard-error')
      }
    },

    compact(token) {
      return (card, isCurrent) => {
        const h = el('au-pcard-header')
        card.appendChild(h)
        const body = el('au-pcard-section')
        const addSub = (text: string, cls = 'au-pcard-sub'): void => {
          const d = el(cls)
          d.textContent = text
          body.appendChild(d)
        }
        switch (token.kind) {
          // a type-CLAIM (instance / parent claim) and a type-REF (a type name in a type-def's
          // shape / sealed branch) both name a type-def — same enriched hover.
          case 'type-claim':
          case 'type-ref': {
            const kw = document.createTextNode('type ')
            const nm = el('au-pcard-name')
            nm.textContent = token.name
            h.append(kw, nm)
            card.appendChild(body)
            // The token name may be `name::repo`; the `type` read takes the authored form verbatim.
            void readType(engine, token.name).then((o) => {
              if (!isCurrent()) return
              // The engine emits a `type-claim` token even for a name that does NOT resolve, so this branch is reachable and must SAY something. Bailing
              // silently left a bare `type <name>` header — indistinguishable from a resolved type
              // with no parents, docs, or fields, which is the worst possible reading.
              if (!('ready' in o) || !o.ready) return // daemon not ready: absence of an answer, not an answer
              if (!o.result) {
                addSub('does not resolve to a type-def', 'au-pcard-sub au-pcard-error-text')
                // The overwhelmingly common cause: a PEER's type named bare. Crossing into another
                // repo's types needs the `::repo` qualifier AND that repo declared as a dep.
                if (!token.name.includes('::')) {
                  addSub("if it belongs to another repo, qualify it as 'name::repo' and declare that repo as a dep")
                }
                return
              }
              const t = o.result
              if (t.parents.length) nm.textContent = `${t.name} : ${t.parents.join(', ')}`
              if (t.doc) addSub(t.doc, 'au-pcard-doc')
              if (t.fields.length) addSub(`fields: ${t.fields.map((f) => f.name).join(', ')}`)
            })
            break
          }
          case 'field-value':
            h.textContent = `${token.field}: ${shapeLabel(token.value_type)}`
            break
          case 'wikilink-resolved':
            h.textContent = `→ ${token.resolved}`
            break
          case 'wikilink-broken':
            h.textContent = `broken link: ${token.target}`
            break
          case 'typed-block':
            h.textContent = `typed block (${token.field})`
            break
          case 'block-id':
            h.textContent = `block id ^${token.id}`
            break
          case 'anchor':
            h.textContent = `heading: ${token.text}`
            break
          // type-def-file kinds.
          case 'field-shape':
            h.textContent = `${token.field}: ${token.value_type ? shapeLabel(token.value_type) : '?'}`
            break
          case 'shape-builtin':
            h.textContent = `builtin ${token.name}`
            break
          case 'enum-member':
            h.textContent = `enum value: ${token.value}`
            break
        }
      }
    },
  }
}
