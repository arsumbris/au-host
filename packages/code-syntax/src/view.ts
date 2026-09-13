import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { foldGutter, syntaxHighlighting } from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { languageForFence } from './index'
import { auEditorTheme, auHighlightStyle } from './view-theme'
import { findReplace } from './find-replace'
export { auEditorTheme, auHighlightStyle } from './view-theme'
export { findReplace, openFind, openWithReplace } from './find-replace'

export interface SourceViewSnapshot { anchor: number; head: number; top: number; left: number; first?: number; offset?: number }

/** Shared viewport-rendered source presentation. Find/selection stay local to this view. */
export function mountSourceView(parent: HTMLElement, options: {
  source: string; language: string; numbered?: boolean
  snapshot?: SourceViewSnapshot
  onSnapshot?: (snapshot: SourceViewSnapshot) => void
}): () => void {
  let lastSnapshot = options.snapshot
  const snapshotKey = {}
  const remember = (view: EditorView) => view.requestMeasure({
    key: snapshotKey,
    read: current => {
      if (!current.scrollDOM.clientHeight) return null
      const rect = current.scrollDOM.getBoundingClientRect()
      const first = current.posAtCoords({ x: rect.left + rect.width / 2, y: rect.top + 1 }, false) ?? current.viewport.from
      const { anchor, head } = current.state.selection.main
      const offset = rect.top - (current.coordsAtPos(first)?.top ?? rect.top)
      return { first, offset, anchor, head, top: current.scrollDOM.scrollTop, left: current.scrollDOM.scrollLeft }
    },
    write: snapshot => {
      if (snapshot) { lastSnapshot = snapshot; options.onSnapshot?.(snapshot) }
    },
  })
  const language = languageForFence(options.language)
  const state = EditorState.create({
    doc: options.source,
    extensions: [
      EditorState.readOnly.of(true), EditorView.editable.of(false),
      EditorView.contentAttributes.of({ 'aria-label': 'Read-only source', 'aria-readonly': 'true', role: 'textbox', 'aria-multiline': 'true', tabindex: '0' }),
      auEditorTheme, syntaxHighlighting(auHighlightStyle),
      language ?? [], options.numbered ? lineNumbers() : [], foldGutter(), drawSelection(),
      EditorView.updateListener.of(update => { if (update.selectionSet) remember(update.view) }),
      EditorView.domEventHandlers({ scroll: (_event, view) => { remember(view) } }),
      EditorView.lineWrapping, findReplace(), keymap.of([...searchKeymap, ...defaultKeymap]),
      EditorView.theme({
        '&': { height: '100%', minWidth: '0' },
        '.cm-scroller': { overflow: 'auto' },
        '&.cm-focused': { outline: '1px solid var(--au-line-2)', outlineOffset: '-1px' },
      }),
    ],
  })
  // AU slots contain light DOM; the inferred assigned-slot root hides CM styles.
  const view = new EditorView({ state, parent, root: (parent.getRootNode() instanceof Document || parent.getRootNode() instanceof ShadowRoot)
      ? parent.getRootNode() as Document | ShadowRoot : parent.ownerDocument })
  const saved = options.snapshot
  if (saved) {
    const clamp = (pos: number) => Math.max(0, Math.min(view.state.doc.length, Number.isFinite(pos) ? pos : 0))
    view.dispatch({ selection: { anchor: clamp(saved.anchor), head: clamp(saved.head) }, effects: saved.first === undefined ? [] : EditorView.scrollIntoView(clamp(saved.first), { y: 'start', yMargin: -(saved.offset ?? 0) }) })

  }
  return () => {
    if (lastSnapshot) options.onSnapshot?.(lastSnapshot)
    view.destroy()
  }
}
