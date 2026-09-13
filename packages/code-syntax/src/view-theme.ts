import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const auHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--au-ink-1)', fontWeight: 'var(--au-w-strong)' },
  { tag: t.heading2, color: 'var(--au-ink-1)', fontWeight: 'var(--au-w-strong)' },
  { tag: [t.heading, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--au-ink-1)', fontWeight: 'var(--au-w-strong)' },
  { tag: t.strong, fontWeight: 'var(--au-w-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--au-color-accent)' },
  { tag: t.monospace, color: 'var(--au-code-string)' },
  { tag: t.quote, color: 'var(--au-code-comment)' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--au-code-comment)' },
  // structure punctuation (yaml brackets/braces/separators, list markers) — muted.
  { tag: [t.squareBracket, t.brace, t.separator, t.punctuation, t.operator], color: 'var(--au-code-punctuation)' },
  // YAML frontmatter:
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--au-code-property)' },
  { tag: t.string, color: 'var(--au-code-string)' },
  { tag: t.variableName, color: 'var(--au-code-variable)' },
  { tag: [t.number, t.atom], color: 'var(--au-code-number)' },
  { tag: [t.keyword, t.modifier, t.meta], color: 'var(--au-code-keyword)' },
  { tag: [t.bool, t.null, t.labelName, t.typeName, t.className], color: 'var(--au-code-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--au-code-function)' },
  { tag: [t.tagName, t.attributeName], color: 'var(--au-code-type)' },
  { tag: t.comment, color: 'var(--au-code-comment)', fontStyle: 'italic' },
])

export const auEditorTheme = EditorView.theme({
  '&': { fontSize: 'var(--au-t-sm)', color: 'var(--au-ink-2)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--au-font-mono)', lineHeight: 'var(--au-lh-base)', scrollbarWidth: 'thin' },
  '.cm-content': { padding: 'var(--au-space-4) 0 var(--au-space-8)', caretColor: 'var(--au-ink-1)' },
  '.cm-line': { padding: '0 var(--au-space-4) 0 var(--au-space-2)' },
  '.cm-gutterElement': { paddingInline: 'var(--au-space-2)' },
  '.cm-lineNumbers': { minWidth: 'var(--au-space-8)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--au-ink-1) 3%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--au-ink-1)' },
  // The line-number GUTTER. CM's base theme paints it a light-theme grey (the "white number rail");
  // make it transparent so the dark pane card shows through, matching the (transparent) content, and
  // colour the numbers with muted ink. The active-line number reads a step brighter.
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--au-ink-4, var(--au-color-muted))', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { color: 'var(--au-ink-4, var(--au-color-muted))' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--au-ink-2, var(--au-color-text))' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--au-ink-4, var(--au-color-muted))' },
  '.cm-tooltip': {
    background: 'var(--au-elev-5-fill)',
    color: 'var(--au-ink-2)',
    border: '1px solid var(--au-line-2)',
    borderRadius: 'var(--au-radius-panel)',
    boxShadow: 'var(--au-sh-pop)',
    fontFamily: 'var(--au-font-sans)',
  },
  '.cm-tooltip.cm-tooltip-arrow:before': {
    borderTopColor: 'var(--au-line-2)',
    borderBottomColor: 'var(--au-line-2)',
  },
  '.cm-tooltip.cm-tooltip-arrow:after': {
    borderTopColor: 'var(--au-elev-5-fill)',
    borderBottomColor: 'var(--au-elev-5-fill)',
  },
  // DIAGNOSTIC squiggles. CM's lint default paints a light-theme SVG underline; a token-driven
  // `text-decoration: wavy` re-themes with the rest of the app and needs no asset.
  '.cm-lintRange': { backgroundImage: 'none', textDecoration: 'underline wavy', textDecorationThickness: '1px', textUnderlineOffset: '3px' },
  '.cm-lintRange-error': { textDecorationColor: 'var(--au-color-danger)' },
  '.cm-lintRange-warning': { textDecorationColor: 'var(--au-color-warn)' },
  '.cm-lintRange-info': { textDecorationColor: 'var(--au-color-accent)' },
  '.cm-lintRange-hint': { textDecorationColor: 'var(--au-color-muted)' },
  // The tooltip BODY. `.cm-tooltip` above already gives it the surface/border; these size the
  // content and colour the severity stripe CM draws down the left of each entry.
  '.cm-tooltip-lint': { padding: '0' },
  '.cm-diagnostic': {
    font: 'var(--au-t-xs)/var(--au-lh-base) var(--au-font-sans)',
    padding: 'var(--au-space-2) var(--au-space-3)',
    maxWidth: '420px',
    lineHeight: 'var(--au-lh-base)',
    whiteSpace: 'pre-wrap', // the `fix` rides on its own line
    borderLeftWidth: '3px',
  },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--au-color-danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--au-color-warn)' },
  '.cm-diagnostic-info': { borderLeftColor: 'var(--au-color-accent)' },
  '.cm-diagnostic-hint': { borderLeftColor: 'var(--au-color-muted)' },
  '.cm-lintRange-active': { backgroundColor: 'var(--au-chrome-active)' },
  '.cm-lintPoint-error:after': { borderBottomColor: 'var(--au-color-danger)' },
  '.cm-lintPoint-warning:after': { borderBottomColor: 'var(--au-color-warn)' },
  '.cm-lintPoint-info:after': { borderBottomColor: 'var(--au-color-accent)' },
  '.cm-lintPoint-hint:after': { borderBottomColor: 'var(--au-ink-4)' },
  // Panel selection and keyboard focus are separate channels, as in shared list controls.
  '.cm-panel.cm-panel-lint': { padding: 'var(--au-space-1)' },
  '.cm-panel.cm-panel-lint ul': { marginRight: 'var(--au-space-8)' },
  '.cm-panel.cm-panel-lint ul .cm-diagnostic': { maxWidth: 'none', marginLeft: '0' },
  '.cm-panel.cm-panel-lint ul [aria-selected="true"], .cm-panel.cm-panel-lint ul:focus [aria-selected="true"]': {
    backgroundColor: 'var(--au-chrome-active)', color: 'var(--au-ink-1)',
  },
  '.cm-panel.cm-panel-lint ul:focus': { outline: 'none' },
  '.cm-panel.cm-panel-lint ul:focus-visible [aria-selected="true"]': {
    outline: '1px solid var(--au-focus-outer)', outlineOffset: '-1px',
  },
  '.cm-diagnosticAction': {
    backgroundColor: 'transparent', color: 'var(--au-ink-2)',
    border: '1px solid var(--au-line-2)', borderRadius: 'var(--au-radius-sm)',
    padding: 'var(--au-space-0-5) var(--au-space-1)', marginLeft: 'var(--au-space-2)',
  },
  '.cm-panel.cm-panel-lint [name=close]': {
    top: 'var(--au-space-1)', right: 'var(--au-space-1)',
    width: 'var(--au-space-6)', height: 'var(--au-space-6)',
    borderRadius: 'var(--au-radius-sm)', background: 'transparent', color: 'var(--au-ink-3)',
    cursor: 'pointer',
  },
  '.cm-diagnosticAction:hover, .cm-panel.cm-panel-lint [name=close]:hover': {
    backgroundColor: 'var(--au-chrome-hover)', color: 'var(--au-ink-1)',
  },
  '.cm-diagnosticAction:active, .cm-panel.cm-panel-lint [name=close]:active': {
    backgroundColor: 'var(--au-chrome-active)', color: 'var(--au-ink-1)',
  },
  '.cm-diagnosticAction:focus-visible, .cm-panel.cm-panel-lint [name=close]:focus-visible': {
    outline: '1px solid var(--au-focus-outer)', outlineOffset: '-1px',
  },
  '@media (forced-colors: active)': {
    '.cm-panel.cm-panel-lint ul:focus-visible [aria-selected="true"], .cm-diagnosticAction:focus-visible, .cm-panel.cm-panel-lint [name=close]:focus-visible': { outlineColor: 'Highlight' },
  },
  // The diagnostic CODE (passed as `source`), muted beside the message.
  '.cm-diagnosticSource': { color: 'var(--au-ink-4)', opacity: '1', fontSize: 'var(--au-t-2xs)' },
  // COMPLETION menu. `.cm-tooltip` above already gives it the surface / border;
  // these re-theme the rows, which CM otherwise paints from its light base.
  '.cm-tooltip.cm-tooltip-autocomplete': { padding: '0' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    font: 'var(--au-t-xs)/var(--au-lh-xs) var(--au-font-mono)',
    maxHeight: '18em',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: 'var(--au-space-1) var(--au-space-2)', lineHeight: 'var(--au-lh-xs)' },
  // Selection is a chrome wash; primary ink remains readable across theme palettes.
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected="true"]': {
    background: 'var(--au-chrome-active)',
    color: 'var(--au-ink-1)',
  },
  // The matched substring, so the query stands out inside each label.
  '.cm-completionLabel': { color: 'inherit' },
  '.cm-completionMatchedText': {
    color: 'var(--au-color-accent)',
    textDecoration: 'none',
    fontWeight: 'var(--au-w-strong)',
  },
  '[aria-selected="true"] .cm-completionMatchedText': { color: 'inherit', textDecoration: 'underline' },
  // The right-hand detail: a field's shape, a file's path, a member's role.
  '.cm-completionDetail': {
    color: 'var(--au-color-muted)',
    fontStyle: 'normal',
    marginLeft: 'var(--au-space-3)',
    fontSize: 'var(--au-t-2xs)',
  },
  '[aria-selected="true"] .cm-completionDetail': { color: 'inherit' },
  // The `#:` docstring panel, which rides beside the menu as its own tooltip.
  '.cm-tooltip.cm-completionInfo': {
    background: 'var(--au-elev-5-fill)',
    color: 'var(--au-ink-2)',
    border: '1px solid var(--au-line-2)',
    borderRadius: 'var(--au-radius-panel)',
    padding: 'var(--au-space-1) var(--au-space-2)',
    lineHeight: 'var(--au-lh-base)',
  },
  // The inert status row: a reason, not a candidate. Muted and italic so
  // it never reads as something to accept. Tagged by `optionClass`, since CM
  // exposes no attribute for a completion's `type` on the row itself.
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li.au-completion-status': {
    color: 'var(--au-color-muted)',
    fontStyle: 'italic',
    cursor: 'default',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li.au-completion-status[aria-selected="true"]': {
    background: 'transparent',
    color: 'var(--au-color-muted)',
  },
  // The find/replace panel CONTAINER + the match decorations — all on the --au-* ladder (CM's default
  // is a light-theme white box). The find-replace module (findReplaceTheme) themes its own `.au-find-*`
  // chrome; this themes the shared `.cm-panels` shell it sits in + the highlight decorations it reuses.
  '.cm-panels': {
    backgroundColor: 'var(--au-color-surface-1)',
    color: 'var(--au-ink-2)',
    borderTop: '1px solid var(--au-line-2, var(--au-color-border))',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--au-accent-signal) 22%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--au-accent-signal) 40%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--au-ink-1) 12%, transparent)' },
})
