import { displayFilePath } from '@arsumbris/au-host-sdk'
import { languageDefinitionForPath } from '@arsumbris/code-syntax'
// aup-reader — a markdown READER pane-projection built on the framework-neutral `<au-*>` component set.
//
// A PURE FIRER/HANDLER of open-intent, carrying NO routing logic. It renders whatever file its state
// points at (seeded from `host.config`, read via `host.files.read`). A wikilink Mod-click FIRES an
// open-intent and does nothing locally; the reader navigates only when it RECEIVES open — by default it
// is the focused capable handler, so it claims its OWN fire ("open here" is pure routing), and every
// other outcome (open elsewhere via a wire-only opt-out, drive a wired peer, sync to `[self, peer]`)
// is a COMPOSITION routing decision, never a mode in the reader.
// Also a DRAG SOURCE — a `[[wikilink]]` drags out as a `link-selection` (packages/selection).
//
// Encapsulation: a self-contained package speaking ONLY the host-sdk (mount contract + capability
// surface) and the neutral `<au-*>` component vocabulary — no host internals, no engine coupling beyond
// the sanctioned `host.files`. Markdown rendering uses react-markdown with remark-gfm and custom
// plugins, components and a URL transform. The `<au-*>` components self-style from tokens in their
// own shadow; only this reader's scoped `.au-md`
// prose sheet is injected via `host.styles.inject` at mount and removed on unmount.

import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react'
import { defineProjection, type Intent, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {sourceLocations, closestSourceElement} from './source-locations'
import { splitFrontmatter } from './frontmatter-source'
import { fileSelection, isFileSelection, linkSelection, openContent, type Selection } from '@arsumbris/selection'
import { openIntent, promoteIntent, isOpenIntent } from '@arsumbris/intent'
import { makeHoverContent } from '@arsumbris/preview-content'
import { readResolveTarget, readResolveAnchor, readResolveBlockId, subscribeChanges } from '@arsumbris/au-host-sdk/engine-reads'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { AuViewerSwitch } from '@arsumbris/au-component-catalog/react' // + JSX types for the <au-*> intrinsic elements
import {bindDocumentToolbar} from '@arsumbris/style/document-scroll'
import readerCss from './reader.css?inline'
import documentControlsCss from '@arsumbris/style/document-controls.css?inline'
import { Frontmatter } from './frontmatter'
import { YamlDocument } from './yaml-document'
import { MarkdownImage } from './markdown-image'
import { CodeBlock } from './code-block'
import { viewerSwitchSets, runViewerSwitch } from '@arsumbris/container-core'

const fill = {
  height: '100%',
  width: '100%',
  minHeight: 0,
  overflow: 'hidden',
} as const

/** The reader's config shape — the optional file it renders, seeded from its own pool record. */
function configFile(host: MountHost): string | null {
  const cfg = host.config as { file?: unknown } | undefined
  return typeof cfg?.file === 'string' ? cfg.file : null
}

/** GFM alignment uses existing component options; authored center also flows through host style. */
function alignOf(style: unknown): 'start' | 'end' | undefined {
  const ta = (style as { textAlign?: string } | undefined)?.textAlign
  if (ta === 'right') return 'end'
  if (ta === 'left') return 'start'
  return undefined
}

/** Render a frontmatter value as shaped chips, routed by SHAPE. A nested map has no chip dialect of
 *  its own, so it degrades to one muted JSON <au-pill>. Callers wrap the return in `.au-md__meta-val`,
 *  which lays a Tag row out as a wrapping flex line. */
function metaValue(v: unknown, nav: Nav): ReactNode {
  if (Array.isArray(v)) return v.map((x, i) => <au-tag key={i}>{renderInlineWikilinks(String(x), nav)}</au-tag>)
  if (v && typeof v === 'object') return <au-pill muted>{JSON.stringify(v)}</au-pill>
  return <au-pill>{renderInlineWikilinks(String(v), nav)}</au-pill>
}

// ── wikilink drag source ─────────────────────────────────────────────────────────────────────────
// A `[[wikilink]]` is not CommonMark, so remark leaves it whole inside a single `text` node (verified:
// it is NOT split into `[` + linkReference + `]`, and it never appears inside `code`/`inlineCode`,
// whose content is a leaf `value`, not text children). So a text-node pass is a correct, code-safe
// place to lift wikilinks out: `remarkWikilinks` rewrites each `[[…]]` into a `link` node carrying our
// own `wikilink:` scheme, and the `a` renderer below turns that into a draggable reference.

/** URL scheme `remarkWikilinks` stamps on a `[[wikilink]]` so the `a` renderer can tell a wikilink
 *  from a real anchor. A carrier for the reference text, never navigated. */
const WIKILINK_SCHEME = 'wikilink:'

/** DataTransfer MIME the drag SOURCE writes the serialized `Selection` under. NATIVE HTML5 DnD is the
 *  only drag channel a leaf projection owns without adding a container-kit dep to a leaf. The drop
 *  side is an OPEN HAND-OFF: container-kit needs a native-DnD → drag-store bridge that reads this MIME
 *  into `DragState.content` (the same slot file-tree-kit fills via `startDrag({ content })`), after
 *  which a wikilink dropped on a pane resolves + opens exactly as a dragged file does. */
const SELECTION_DRAG_MIME = 'application/x-au-selection+json'

/** Minimal mdast node shape this plugin reads/writes — avoids a hard `@types/mdast` dependency for the
 *  four fields it touches. */
interface MdNode {
  type: string
  value?: string
  url?: string
  title?: string | null
  children?: MdNode[]
}

/** Split one `text` node on `[[…]]`, emitting `link` nodes (our `wikilink:` scheme) for the matches and
 *  `text` for the gaps. A trailing `|alias` is display-only: the alias is the shown TEXT, the part
 *  before it is the reference the drag carries. An empty reference stays literal text. */
function splitWikilinks(node: MdNode): MdNode[] {
  const value = node.value ?? ''
  if (!value.includes('[[')) return [node]
  const re = /\[\[([^\]]+)\]\]/g
  const out: MdNode[] = []
  let last = 0
  for (let m = re.exec(value); m; m = re.exec(value)) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    const inner = m[1]
    const pipe = inner.indexOf('|')
    const ref = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    const display = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim()
    if (ref)
      out.push({
        type: 'link',
        url: WIKILINK_SCHEME + encodeURIComponent(ref),
        title: null,
        children: [{ type: 'text', value: display || ref }],
      })
    else out.push({ type: 'text', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

/** Walk the mdast tree, rewriting `[[wikilink]]` text into `wikilink:`-scheme link nodes. Skips the
 *  children of existing `link`/`linkReference` nodes (a nested link is invalid, and a real anchor's
 *  label is not a wikilink); `code`/`inlineCode` carry no text children, so they are never touched. */
function transformWikilinks(node: MdNode): void {
  if (!node.children) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text') {
      next.push(...splitWikilinks(child))
    } else {
      if (child.type !== 'link' && child.type !== 'linkReference') transformWikilinks(child)
      next.push(child)
    }
  }
  node.children = next
}

function remarkWikilinks() {
  return (tree: MdNode): void => transformWikilinks(tree)
}

// ── link interactivity: Mod-hover peek + Mod-click navigate ────────────────────────────────────────
// Editor PARITY, via the same mechanism the editor uses: `host.preview` (the overlay peek),
// `@arsumbris/preview-content`'s `makeHoverContent` (the peek body), and the engine link resolver
// (`readResolveTarget` / `Anchor` / `BlockId`). A prose wikilink and a frontmatter `type:` chip both
// resolve through ONE path; `readResolveTarget` also resolves a `[[type]]` to its type-def, so types
// come nearly free. Distinct from the wikilink DRAG source above (drag ≠ cmd-click on the same span).

/** A cmd/ctrl gesture is what turns a rendered reference into a peek/navigate action — matching the
 *  editor, and leaving a plain click or a drag untouched. */
function modifierLabel(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
}

function isMod(e: ReactMouseEvent): boolean {
  return e.metaKey || e.ctrlKey
}

/** Split a wikilink reference (its `|alias` already stripped) into target, `#anchor`, `^block-id`. */
function parseRef(ref: string): { target: string; anchor?: string; blockId?: string } {
  let rest = ref.trim()
  let blockId: string | undefined
  let anchor: string | undefined
  const caret = rest.indexOf('^')
  if (caret >= 0) {
    blockId = rest.slice(caret).replace(/^\^+/, '').trim() || undefined
    rest = rest.slice(0, caret)
  }
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    anchor = rest.slice(hash + 1).trim() || undefined
    rest = rest.slice(0, hash)
  }
  return { target: rest.trim(), anchor, blockId }
}

/** ONE interactive `[[wikilink]]` span — the shared renderer for prose links (the `a` renderer) and for
 *  wikilinks embedded in frontmatter string values. Mod-hover peeks, Mod-click navigates (via `nav`),
 *  and it is a DRAG SOURCE (a `link-selection`, `text/plain` fallback), exactly like the prose form. */
function wikilinkSpan(ref: string, display: ReactNode, nav: Nav, key?: number | string): ReactNode {
  return (
    <span
      key={key}
      className="au-md__wikilink"
      draggable
      data-wikilink={ref}
      title={`${ref} · ${modifierLabel()} hover to preview · ${modifierLabel()} click to open`}
      onMouseEnter={(e) => nav.wikiHover(e, ref)}
      onMouseLeave={(e) => nav.leave(e)}
      onClick={(e) => nav.wikiClick(e, ref)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData(SELECTION_DRAG_MIME, JSON.stringify(linkSelection(ref)))
        e.dataTransfer.setData('text/plain', `[[${ref}]]`)
      }}
    >
      {display}
    </span>
  )
}

/** Render a string, turning each `[[wikilink]]` inside it into an interactive `wikilinkSpan` and
 *  keeping the text between as plain text. Returns the bare string when it holds no wikilink, so a
 *  plain value stays plain. A trailing `|alias` shows the alias and drags the reference. */
function renderInlineWikilinks(s: string, nav: Nav): ReactNode {
  if (!s.includes('[[')) return s
  const re = /\[\[([^\]]+)\]\]/g
  const parts: ReactNode[] = []
  let last = 0
  let i = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) parts.push(s.slice(last, m.index))
    const inner = m[1] ?? ''
    const pipe = inner.indexOf('|')
    const ref = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    const display = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim()
    parts.push(ref ? wikilinkSpan(ref, display || ref, nav, i++) : m[0])
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push(s.slice(last))
  return <>{parts}</>
}

interface Nav {
  modifier(held: boolean): void
  dismiss(): void
  wikiHover(e: ReactMouseEvent, ref: string): void
  wikiClick(e: ReactMouseEvent, ref: string): void
  typeHover(e: ReactMouseEvent, name: string): void
  typeClick(e: ReactMouseEvent, name: string): void
  urlClick(e: ReactMouseEvent, href: string): void
  leave(e: ReactMouseEvent): void
}

/** Build the peek/navigate handlers, closed over the host and the open file (the resolution origin).
 *  Reused by the prose `a` renderer and the frontmatter `type` chips. `open` is a PURE FIRE: it fires an
 *  open-intent and does NOTHING locally. The reader navigates only when it RECEIVES open — by default it
 *  is the focused capable handler, so it CLAIMS ITS OWN fire ("open here"), and all other routing
 *  (elsewhere via a wire-only opt-out, a wired peer, sync) lives in the composition, never in the reader.
 */
function makeNav(host: MountHost, currentPath: string | null): Nav {
  const content = makeHoverContent(host.engine)
  const origin = currentPath
    ? (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(currentPath) ? currentPath : `${host.entry.path.replace(/[\\/]+$/, '')}/${currentPath}`)
    : undefined
  let hovered: { element: HTMLElement; show: () => void } | null = null
  let shownKey: string | null = null
  const show = (key: string, element: HTMLElement, fill: ReturnType<typeof content.previewPath>): void => {
    if (!host.preview || !element.isConnected) return
    host.preview.show(key, element.getBoundingClientRect(), fill, content.previewPath, p => open(fileSelection(p)))
    shownKey = key
  }
  const track = (event: ReactMouseEvent, preview: (element: HTMLElement) => void): void => {
    const element = event.currentTarget as HTMLElement
    hovered = { element, show: () => preview(element) }
    element.dataset.referenceActive = String(isMod(event))
    if (isMod(event)) hovered.show()
  }
  const dismiss = (): void => {
    if (shownKey && host.preview?.isShowing(shownKey)) host.preview.hide()
    shownKey = null
  }
  const open = (target: ReturnType<typeof fileSelection>): void => {
    dismiss()
    if (hovered) delete hovered.element.dataset.referenceActive
    hovered = null
    host.intent?.fire(promoteIntent())
    host.intent?.fire(openIntent(target, 'permanent')) // fire only — the reader navigates on RECEIVING open.
  }
  const resolve = async (target: string, anchor?: string, blockId?: string): Promise<ReturnType<typeof fileSelection> | null> => {
    const out = blockId
      ? await readResolveBlockId(host.engine, target, blockId, origin)
      : anchor
        ? await readResolveAnchor(host.engine, target, anchor, origin)
        : await readResolveTarget(host.engine, target, origin)
    if (!('ready' in out) || !out.ready || !out.result) return null
    const r = out.result as { path?: string; file_path?: string; span?: {start: number; end: number}; source?: { file: string; span?: {start: number; end: number} } | null }
    // A type-def target carries an openable `source` container; a file target is `path`/`file_path`.
    const path = r.source ? r.source.file : (r.file_path ?? r.path)
    const span = r.source?.span ?? r.span
    const range = span ? {type: 'text-range', from: span.start, to: span.end} : undefined
    return path ? fileSelection(path, range) : null
  }
  return {
    modifier(held) {
      if (!hovered?.element.isConnected || !hovered.element.checkVisibility()) return
      hovered.element.dataset.referenceActive = String(held)
      if (held) hovered.show()
    },
    dismiss,
    wikiHover(e, ref) {
      const { target, anchor, blockId } = parseRef(ref)
      track(e, element => show(`pv:${currentPath}:${ref}`, element, content.previewLink({ target, anchor, blockId, from: currentPath })))
    },
    async wikiClick(e, ref) {
      if (!isMod(e)) return
      e.preventDefault()
      e.stopPropagation()
      const { target, anchor, blockId } = parseRef(ref)
      const p = await resolve(target, anchor, blockId)
      if (p) open(p)
    },
    typeHover(e, name) {
      track(e, element => show(`pv:type:${currentPath}:${name}`, element, content.previewLink({ target: name, from: currentPath })))
    },
    async typeClick(e, name) {
      e.preventDefault()
      e.stopPropagation()
      const p = await resolve(name) // a bare type name resolves to its type-def
      if (p) open(p)
    },
    urlClick(e, href) {
      if (!isMod(e)) return
      e.preventDefault()
      void host.shell?.openExternal(href)
    },
    leave(e) {
      if (hovered) delete hovered.element.dataset.referenceActive
      hovered = null
      // Sticky peek: dismiss only when the pointer is not over the preview card, so it can be reached.
      if (host.preview && !host.preview.isOver(e.clientX, e.clientY)) host.preview.hide()
    },
  }
}

/** Pass our `wikilink:` scheme through untouched; everything else goes through react-markdown's default
 *  URL sanitiser. Without this the default strips the unknown scheme to '' and the `a` renderer can no
 *  longer distinguish a wikilink from a plain anchor. */
function wikilinkUrlTransform(url: string): string {
  return url.startsWith(WIKILINK_SCHEME) ? url : defaultUrlTransform(url)
}

function makeComponents(nav: Nav, host: MountHost, path: string | null): Components {
  return {
  // Unwrap <pre> — the fenced-code branch below renders the whole block through <au-code-block>.
  pre: ({ children }) => <>{children}</>,
  code({ className, children }) {
    const text = String(children ?? '')
    const isBlock = /language-/.test(className ?? '') || text.includes('\n')
    if (!isBlock) return <code className="au-md__code">{children}</code>
    const lang = /language-([^\s]+)/.exec(className ?? '')?.[1]
    return (
      <span className="au-md__block">
        <CodeBlock code={text.replace(/\n$/, '')} language={lang} />
      </span>
    )
  },
  a: ({ href, children }) => {
    // Mod-hover previews and Mod-click navigates through `nav`; an ordinary click does nothing.
  // The shared link renderer also supports dragging the reference.
    if (typeof href === 'string' && href.startsWith(WIKILINK_SCHEME)) {
      const target = decodeURIComponent(href.slice(WIKILINK_SCHEME.length))
      // Drag as a `link-selection`, with a `text/plain` wikilink fallback.
      return wikilinkSpan(target, children, nav)
    }
    // A real URL: Mod-click opens it externally through the host shell; a plain click follows the
    // anchor (target=_blank) as before.
    return (
      <a
        className="au-md__a"
        title={`Open external link · ${modifierLabel()} click`}
        href={typeof href === 'string' ? href : undefined}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => { if (typeof href === 'string') nav.urlClick(e, href) }}
      >
        {children}
      </a>
    )
  },
  hr: () => <au-divider></au-divider>,
  img: ({ src, alt }) => (
    <MarkdownImage source={typeof src === 'string' ? src : ''} alt={alt ?? ''} path={path} host={host} />
  ),
  table: ({ children }) => (
    <span className="au-md__block">
      <au-table>{children}</au-table>
    </span>
  ),
  thead: ({ children }) => <au-table-head>{children}</au-table-head>,
  tbody: ({ children }) => <au-table-body>{children}</au-table-body>,
  tr: ({ children }) => <au-table-row>{children}</au-table-row>,
  th: ({ children, style }) => <au-table-header-cell align={alignOf(style)} style={style}>{children}</au-table-header-cell>,
  td: ({ children, style }) => <au-table-cell align={alignOf(style)} style={style}>{children}</au-table-cell>,
  }
}

/** Strip `[[ ]]`, a `|display`, a `#anchor`, and a `::repo` qualifier from a `type` value → the bare
 *  type name the engine resolves (a type claim is usually a bare name, sometimes a `[[wikilink]]`). */
function bareType(v: unknown): string {
  return typeof v === 'string' ? (v.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0]?.trim() ?? '') : ''
}

/** Type controls open the resolved definition; modifier-hover previews it. */
function typeChips(v: unknown, nav: Nav): ReactNode {
  const names = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : []
  if (!names.length) return metaValue(v, nav)
  return names.map((n, i) => {
    const bare = bareType(n)
    return (
      <button
        type="button"
        aria-label={`Open ${bare} type definition`}
        title={`Open type definition · ${modifierLabel()} hover to preview`}
        key={i}
        className="au-md__typechip"
        onMouseEnter={(e) => { if (bare) nav.typeHover(e, bare) }}
        onMouseLeave={(e) => nav.leave(e)}
        onClick={(e) => { if (bare) nav.typeClick(e, bare) }}
      >
        {n}<svg className="au-type-link-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 9 9 3M3 3h6v6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    )
  })
}


type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; content: string }
  | { status: 'error'; error: string }

function fileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}
/** Markdown renders as prose; other text files use CodeBlock.
 * This extension check must agree with `isProsePath` in container-kit and the
 * viewer eligibility declared by `opens-meta`. The leaf projection does not
 * depend on container-kit, so each consumer performs its own classification. */
function isMarkdownPath(path: string | null): boolean {
  if (!path) return true
  return /^(md|markdown|mdx)$/.test(extOf(path))
}

function ReaderKit({ host }: { host: MountHost }): ReactNode {
  // The shown file. SEEDED from config (a tabs container writes the tab's file + remounts, re-seeding
  // this), then swapped in place by the open-intent handler below — no container remount needed. The
  // reader carries NO local navigation: a click FIRES open, and the file changes only when open is
  // RECEIVED (self-delivery for "open here", or a peer/composition routing it here). See the handler.
  const [path, setPath] = useState<string | null>(() => configFile(host))
  const rootRef = useRef<HTMLDivElement>(null)
  const [switchError, setSwitchError] = useState('')
  const [switching, setSwitching] = useState(false)
  // The two switch groups, folded from meta: rendering VIEWERS (opens-meta) and non-viewer file-CONSUMERS
  // (handles open-intent), the reader itself excluded. Labels the switch before any click.
  const switchSets = useMemo(
    () => (path && host.instanceId ? viewerSwitchSets(host, path) : { viewers: [], openers: [] }),
    [path, host],
  )
  // The primary switches viewers; More exposes other file-consumers. Both save the scroll first,
  // then the shared helper resolves that group and swaps in place. The reader names no other projection.
  const runSwitch = (group: 'viewers' | 'openers'): void => {
    if (!path || !host.instanceId || switching) return
    setSwitching(true)
    setSwitchError('')
    const area = rootRef.current?.querySelector('au-scroll-area') as (HTMLElement & { scrollElement?: HTMLElement }) | null
    host.viewStore?.set(area?.scrollElement?.scrollTop ?? 0, `reader.scroll:${path}`)
    void runViewerSwitch(host, path, group)
      .then(outcome => {
        if (outcome.kind === 'none') setSwitchError(group === 'viewers' ? 'No other viewer is available for this file.' : 'No other way to open this file.')
        else if (outcome.kind === 'refused') setSwitchError('This pane cannot change its viewer.')
      })
      .catch(error => setSwitchError(error instanceof Error ? error.message : String(error)))
      .finally(() => setSwitching(false))
  }

  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const loadedPath = useRef<string | null>(null)
  const [reveal, setReveal] = useState<{path: string; from: number} | null>(null)
  useEffect(() => host.intent?.handle('ui-intent-highlight', {
    claim: () => true,
    commit: (event: Intent) => {
      const target = (event as {target?: {path?: string; range?: {from?: number}}}).target
      if (target?.path === path && typeof target.range?.from === 'number') setReveal({path, from: target.range.from})
    },
  }), [host, path])
  // HANDLE open-intent: whoever routing delivers an open to sets the shown file. That is the reader's OWN
  // click (self-delivery: it is the focused capable handler → claims its own fire = "open here"), a wired
  // peer, or an "Open with" pick. Set the file WITHOUT re-firing (reflecting an inbound open, not
  // originating one). Claims (returns true) so the responder chain stops here.
  useEffect(() => {
    return host.intent?.handle('open-intent', {
      claim: (intent: Intent) => {
        if (!isOpenIntent(intent)) return false
        const target = intent.target
        return !!(target && typeof target === 'object' && isFileSelection(target as Selection))
      },
      commit: (intent: Intent) => {
        if (!isOpenIntent(intent)) return
        const target = intent.target
        if (!(target && typeof target === 'object' && isFileSelection(target as Selection))) return
        const next = (target as Selection & { path: string }).path
        const range = (target as {range?: {from?: number}}).range
        setReveal(typeof range?.from === 'number' ? {path: next, from: range.from} : null)
        setPath(next) // show the new file immediately (also covers a no-pool host, where onOwnConfigChange is absent)
        // Rewrite our OWN record's `file` so it tracks the shown file, like the editor does on navigation. The
        // container labels a tab from the record's `file` (`fileOf`), so without this a follow-in-place updates
        // the content but leaves the tab name on the old file. Also restores reopen-where-you-left-off. The
        // self-echo lands on `onOwnConfigChange` below → `setPath(next)`, which is idempotent (no loop), and
        // `contentKey` is identity-only so it reflects in place (no remount). Config is `file`-only, so this
        // replacement is complete.
        host.saveConfig({ file: next })
      },
    })
  }, [host])
  // REFLECT-IN-PLACE (the opt-in): the open-intent handler above covers an open ROUTED to us, but a tabs
  // preview-swap reuses our pane and rewrites our RECORD directly (`ensureRecord`), no intent — so without
  // this the record change would remount us. Registering `onOwnConfigChange` makes our `contentKey`
  // identity-only, so a file swap reflects IN PLACE: show the new `config.file`. Idempotent (`setPath` bails
  // on an unchanged path). Guarded `?.` — a no-pool host omits it and we keep the safe remount fallback.
  useEffect(() => {
    return host.onOwnConfigChange?.((config) => {
      const f = (config as { file?: unknown } | undefined)?.file
      setPath(typeof f === 'string' ? f : null)
    })
  }, [host])
  // Peek/navigate handlers, rebuilt when the open file (the resolution origin) changes. A click FIRES
  // open only; navigation happens via the open-intent handler above (self-delivery for "open here").
  const nav = useMemo(() => makeNav(host, path), [host, path])
  useEffect(() => {
    const modifier = (event: KeyboardEvent): void => {
      if (event.key === 'Meta' || event.key === 'Control') nav.modifier(event.metaKey || event.ctrlKey)
    }
    const blur = (): void => { nav.modifier(false); nav.dismiss() }
    window.addEventListener('keydown', modifier)
    window.addEventListener('keyup', modifier)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', modifier)
      window.removeEventListener('keyup', modifier)
      window.removeEventListener('blur', blur)
      nav.dismiss()
    }
  }, [nav])
  const components = useMemo(() => makeComponents(nav, host, path), [nav, host, path])

  // SELF-TITLING. The enclosing container (tabs/bento/sandwich) watches `pane-title` and labels the
  // tab/masthead with the DOCUMENT instead of the projection type name, so a reader tab reads
  // "README.md", not "aup-reader". Null when nothing is open → the container falls back to its own
  // default label. `open-file` carries the full path so a graph / map projection can highlight the
  // nodes currently open (it `watchAll`s that slice).
  useEffect(() => {
    const name = path ? (path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? null) : null
    host.viewState?.publish('pane-title', name)
    host.viewState?.publish('open-file', path)
    if (path) host.selection?.publish(fileSelection(path))
  }, [host, path])

  // Declare this surface's shown file into the host open-surfaces index — so it appears beside the
  // editor in a file-tree "open editors" section, a switcher, or a command palette. Content-less when
  // nothing is open; the host dedupes by the path identity.
  useEffect(() => {
    host.openSurfaces?.setContent(path ? [openContent(fileSelection(path))] : [])
  }, [host, path])

  // Load the current path via the governed host file channel (never raw fs).
  useEffect(() => {
    if (!path) {
      setState({ status: 'idle' })
      return
    }
    let live = true
    let revision = 0
    setState({ status: 'loading' })
    const refresh = async (): Promise<void> => {
      const current = ++revision
      try {
        const result = await host.files.read(path)
        if (!live || current !== revision) return
        if (result.ok && typeof result.content === 'string') {
          const content = result.content
          loadedPath.current = path
          setState(previous => previous.status === 'ok' && previous.content === content ? previous : { status: 'ok', content })
        } else setState({ status: 'error', error: result.error ?? 'Could not read this file.' })
      } catch (error) {
        if (live && current === revision) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
    void refresh()
    const off = subscribeChanges(host.engine, event => {
      if (event.kind === 'change') void refresh()
    })
    return () => { live = false; off() }
  }, [path, host])

  const parsed = useMemo(
    () => (state.status === 'ok' && isMarkdownPath(path) ? splitFrontmatter(state.content) : null),
    [state, path],
  )

  useEffect(() => {
    if (state.status !== 'ok' || !path) return
    let releaseToolbar: (() => void) | undefined
    let scroller: HTMLElement | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastOffset: number | undefined
    const save = (): void => {
      if (lastOffset !== undefined) host.viewStore?.set(lastOffset, `reader.scroll:${path}`)
    }
    const onScroll = (): void => {
      if (!scroller?.checkVisibility()) return
      lastOffset = scroller.scrollTop
      clearTimeout(timer)
      timer = setTimeout(save, 200)
    }
    let cancelled = false
    const frame = requestAnimationFrame(async () => {
      await customElements.whenDefined('au-scroll-area')
      if (cancelled) return
      const area = rootRef.current?.querySelector('au-scroll-area') as (HTMLElement & { scrollElement?: HTMLElement }) | null
      await (area as HTMLElement & {updateComplete?: Promise<unknown>} | null)?.updateComplete
      if (cancelled) return
      scroller = area?.scrollElement
      if (scroller && rootRef.current) releaseToolbar = bindDocumentToolbar(rootRef.current, scroller)
      const offset = host.viewStore?.get(`reader.scroll:${path}`)
      if (scroller && typeof offset === 'number') scroller.scrollTop = offset
      scroller?.addEventListener('scroll', onScroll, { passive: true })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      scroller?.removeEventListener('scroll', onScroll)
      releaseToolbar?.()
      save()
    }
  }, [path, state.status, host])

  useEffect(() => {
    if (!reveal || reveal.path !== path || loadedPath.current !== path || state.status !== 'ok') return
    const frame = requestAnimationFrame(() => {
      if (!rootRef.current) return
      const target = closestSourceElement(rootRef.current, reveal.from)
      target?.scrollIntoView({block: 'center', behavior: 'instant'})
      if (target) setReveal(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [reveal, path, state])

  let body: ReactNode
  if (state.status === 'idle') {
    body = (
      <div className="au-reader__status">
        <au-empty-state label="No document open" hint="Pick a file in the tree to read it here."></au-empty-state>
      </div>
    )
  } else if (state.status === 'loading') {
    body = (
      <div className="au-reader__status">
        <au-spinner></au-spinner>
      </div>
    )
  } else if (state.status === 'error') {
    body = (
      <div className="au-reader__status">
        <au-empty-state label="Couldn’t open the file" hint={state.error}></au-empty-state>
      </div>
    )
  } else if (!isMarkdownPath(path)) {
    // Source files retain their authored text alongside any structured preview.
    const lang = languageDefinitionForPath(path ?? '')?.id ?? (extOf(path ?? '') || undefined)
    body = (
      <au-scroll-area axis="y" style={{ height: '100%' }}>
        <div className="au-md au-reader-source">
          {lang === 'yaml' ? <YamlDocument source={state.content} host={host} path={path} renderText={text => renderInlineWikilinks(text, nav)} renderType={claim => typeChips(claim, nav)} /> : <CodeBlock code={state.content} language={lang} numbered host={host} path={path} />}
        </div>
      </au-scroll-area>
    )
  } else {
    body = (
      <au-scroll-area axis="y" style={{ height: '100%' }}>
        <div className="au-md">

          {parsed?.data ? <Frontmatter data={parsed.data} host={host} path={path} renderText={(text) => renderInlineWikilinks(text, nav)} renderType={(claim) => typeChips(claim, nav)} /> : null}
          {parsed?.invalid && <section className="au-reader-invalid" aria-label="Invalid document properties">
            <p role="status"><strong>Properties could not be read:</strong> {parsed.invalid.message.replace(/\.$/, '')}. Edit the source to correct them.</p>
            <CodeBlock code={parsed.invalid.source} language="yaml" />
          </section>}
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkWikilinks]}
            rehypePlugins={[sourceLocations(state.content, state.content.length - (parsed?.body.length ?? 0))]}
            urlTransform={wikilinkUrlTransform}
            components={components}
          >
            {parsed?.body ?? ''}
          </ReactMarkdown>
        </div>
      </au-scroll-area>
    )
  }

  return (
    <div ref={rootRef} onFocusCapture={() => { if (path) host.selection?.publish(fileSelection(path)) }} onPointerDownCapture={() => { if (path) host.selection?.publish(fileSelection(path)) }} className="au-app au-reader au-document-view" data-surface="inherit" style={fill} data-file={path ? fileName(path) : undefined}>
      {path && <div className="au-reader-toolbar au-document-toolbar">
        <span className="au-reader-location" title={displayFilePath(path, host.workspace.members)}>{displayFilePath(path, host.workspace.members)}</span>
        {host.instanceId && (switchSets.viewers.length > 0 || switchSets.openers.length > 0) && (
          <AuViewerSwitch
            aria-busy={switching}
            primaryLabel={switchSets.viewers.length === 1 ? switchSets.viewers[0].label : 'Open with'}
            hasMore={switchSets.viewers.length > 0 && switchSets.openers.length > 0}
            onAuActivate={() => runSwitch(switchSets.viewers.length ? 'viewers' : 'openers')}
            onAuMore={() => runSwitch('openers')}
          />
        )}
      </div>}
      {switchError && <div role="status" className="au-reader-switch-error">{switchError}</div>}
      {body}
    </div>
  )
}

function mount(container: HTMLElement, host: MountHost): () => void {
  container.classList.add('au-app')
  // The container owns the surface; this pane must not paint its own canvas over the card.
  container.dataset.surface = 'inherit'
  // The reader's own prose CSS, scoped to this pane by the host (the prescribed `host.styles.inject`,
  // `@scope`-wrapped, CSP-exempt) — never a raw global `<style>`. The `<au-*>` components self-style
  // from tokens in their own shadow, so no component stylesheet is injected here any more.
  const disposeStyles = host.styles?.inject(readerCss + documentControlsCss, container)

  // Keep React's child tree intact if the host detaches its projection slot before cleanup.
  const content = document.createElement('div')
  content.style.height = '100%'
  container.appendChild(content)
  const root = createRoot(content)
  root.render(<ReaderKit host={host} />)

  return () => {
    root.unmount()
    content.remove()
    disposeStyles?.()
    container.classList.remove('au-app')
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
