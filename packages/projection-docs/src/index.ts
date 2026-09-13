import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode } from '@arsumbris/code-syntax'
import type { MountHost } from '@arsumbris/au-host-sdk'
import { parseWikilinkInner, readResolveTarget, readResolveAnchor, readResolveBlockId } from '@arsumbris/au-host-sdk/engine-reads'
import { fileSelection } from '@arsumbris/selection'
import { openIntent } from '@arsumbris/intent'

interface Node { type: string; value?: string; url?: string; children?: Node[] }
function wikilinks() {
  return (tree: unknown): void => {
    function visit(node: Node): void {
      if (!node.children || ['link', 'code', 'inlineCode'].includes(node.type)) return
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) { visit(child); return [child] }
        const result: Node[] = []; let end = 0
        for (const match of child.value.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          if (match.index > end) result.push({ type: 'text', value: child.value.slice(end, match.index) })
          const [target, ...alias] = match[1]!.split('|')
          result.push({ type: 'link', url: `au-doc-reference:${encodeURIComponent(target!)}`, children: [{ type: 'text', value: alias.join('|') || target! }] })
          end = match.index + match[0].length
        }
        if (end < child.value.length) result.push({ type: 'text', value: child.value.slice(end) })
        return result
      })
    }
    visit(tree as Node)
  }
}
const STYLE = `
.au-doc { color:var(--au-ink-2); font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); overflow-wrap:anywhere; white-space:normal; }
.au-doc.au-doc p { margin:0 0 var(--au-space-3); white-space:normal; }
.au-doc p:last-child { margin-bottom:0; }
.au-doc h1,.au-doc h2,.au-doc h3,.au-doc h4,.au-doc h5,.au-doc h6 { font-size:var(--au-t-sm); line-height:var(--au-lh-base); color:var(--au-ink-1); margin:var(--au-space-3) 0 var(--au-space-2); }
.au-doc ul,.au-doc ol { padding-left:var(--au-space-5); margin:var(--au-space-2) 0; }
.au-doc pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:var(--au-space-2) 0; }
.au-doc code { font:var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono); background:var(--au-accent-soft); border-radius:var(--au-radius-xs); padding:0 var(--au-space-0-5); }
.au-doc button { border:0; background:none; padding:0; color:var(--au-color-accent); font:inherit; text-align:left; cursor:pointer; text-decoration:underline; overflow-wrap:anywhere; }
.au-doc button:focus-visible { outline:2px solid var(--au-focus-outer); outline-offset:2px; }
.au-doc .au-doc-message { color:var(--au-ink-3); margin-top:var(--au-space-2); }
.au-doc blockquote { margin:var(--au-space-3) 0; padding-left:var(--au-space-3); border-left:2px solid var(--au-line-2); }
.au-doc table { width:100%; table-layout:fixed; border-collapse:collapse; }
.au-doc th,.au-doc td { padding:var(--au-space-2); border-bottom:1px solid var(--au-line-1); }
.au-doc .au-syntax-name { color:var(--au-code-property); }.au-doc .au-syntax-string { color:var(--au-code-string); }.au-doc .au-syntax-value { color:var(--au-code-number); }.au-doc .au-syntax-type { color:var(--au-code-type); }.au-doc .au-syntax-punctuation { color:var(--au-code-punctuation); }.au-doc .au-syntax-function { color:var(--au-code-function); }.au-doc .au-syntax-variable { color:var(--au-code-variable); }.au-doc .au-syntax-keyword { color:var(--au-code-keyword); }.au-doc .au-syntax-comment { color:var(--au-code-comment); }
`

/** Read-only documentation composition. The engine resolves links; no viewer policy lives here. */
export function mountDocumentation(element: HTMLElement, text: string, host: MountHost, source?: string): () => void {
  let alive = true
  const style = host.styles?.inject(STYLE, element)
  const target = document.createElement('div')
  element.append(target)
  const root = createRoot(target)
  function Documentation() {
    const [message, setMessage] = useState('')
    const [pending, setPending] = useState(false)
    async function open(href: string) {
      if (pending) return
      setPending(true); setMessage('Opening reference…')
      try {
        if (/^https?:|^mailto:/i.test(href)) {
          if (!host.shell) throw Error('External links are unavailable here.')
          await host.shell.openExternal(href)
        } else {
          const ref = href.startsWith('au-doc-reference:') ? decodeURIComponent(href.slice(17)) : href
          const parsed = parseWikilinkInner(ref)
          if (!parsed.ok) throw Error('This reference could not be parsed.')
          const p = parsed.parts
          if (p.commit || p.field) throw Error('Pinned and field references are not supported in this documentation view yet.')
          if (!source && !p.repo) throw Error('This documentation has no source context for resolving a local reference.')
          const target = p.repo ? `${p.target}::${p.repo}` : p.target
          const result = p.block_id ? await readResolveBlockId(host.engine, target, p.block_id.id, source)
            : p.anchor ? await readResolveAnchor(host.engine, target, p.anchor, source)
            : await readResolveTarget(host.engine, target, source)
          if (!alive) return
          if ('ok' in result) throw Error(result.error)
          if (!result.ready || !result.result) throw Error(`Reference not found: ${ref}`)
          const value = result.result
          const path = 'path' in value ? value.source?.file ?? value.path : value.file_path
          if (!path) throw Error('The reference has no openable source.')
          const span = 'path' in value ? value.source?.span : value.span
          const range = span ? { type:'text-range', from:span.start, to:span.end } : undefined
          host.intent.fire(openIntent(fileSelection(path, range)))
        }
        if (alive) setMessage('')
      } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : 'Could not open reference.') }
      finally { if (alive) setPending(false) }
    }
    return h('div', { className:'au-doc' }, h(Markdown, {
      remarkPlugins:[remarkGfm, wikilinks], skipHtml:true,
      urlTransform: url => /^(au-doc-reference:|https?:|mailto:)/i.test(url) || !/^[a-z][a-z\d+.-]*:/i.test(url) ? url : '',
      components: {
        a: ({href, children}) => h('button', { type:'button', disabled:pending || !href, onClick:()=>void open(href || '') }, children),
        img: ({alt}) => h('span', {}, alt || 'Image'),
        code: ({className, children}) => { const lang=className?.match(/language-(\S+)/)?.[1]; return h('code', {}, ...(lang ? highlightCode(String(children),lang).map((part,index)=>h('span',{key:index,className:part.className},part.text)) : [children])) },
      }, children:text,
    }), message ? h('div', {className:'au-doc-message',role:'status'}, pending ? h('au-spinner',{size:'sm',label:'Opening reference'}) : null, message) : null)
  }
  root.render(h(Documentation))
  return () => { alive=false; root.unmount(); target.remove(); style?.() }
}
