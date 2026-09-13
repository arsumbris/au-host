import { type Extension, Prec } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

const selectedText = Decoration.mark({ class: 'au-selected-text' })

/** Colour only visible selected text; CodeMirror retains selection, cursor and IME ownership. */
function selectedRanges(view: EditorView): DecorationSet {
  const marks = []
  for (const range of view.state.selection.ranges) {
    if (range.empty) continue
    for (const visible of view.visibleRanges) {
      const from = Math.max(range.from, visible.from)
      const to = Math.min(range.to, visible.to)
      if (from < to) marks.push(selectedText.range(from, to))
    }
  }
  return Decoration.set(marks, true)
}

const foreground = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = selectedRanges(view) }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = selectedRanges(update.view)
    }
  }
}, { decorations: value => value.decorations })

export const selectionTheme = EditorView.theme({
  '.cm-selectionBackground': { backgroundColor: 'var(--au-selection-bg) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--au-selection-bg) !important' },
  // No !important here: drawSelection suppresses native backgrounds to avoid two washes.
  // Without drawSelection, native selection still receives the same foreground/background pair.
  '.cm-content::selection, .cm-content ::selection': {
    backgroundColor: 'var(--au-selection-bg)',
    color: 'var(--au-selection-fg)',
  },
  '.au-selected-text, .au-selected-text *': {
    color: 'var(--au-selection-fg) !important',
  },
  // Selection wins over search washes only where the ranges overlap. The low-precedence
  // outer mark splits nested search spans, preserving the unselected part of a match.
  '.au-selected-text .cm-searchMatch, .au-selected-text .cm-selectionMatch': {
    backgroundColor: 'transparent !important',
  },
})

export const selectionPresentation: Extension = [selectionTheme, Prec.lowest(foreground)]
