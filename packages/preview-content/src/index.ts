// @arsumbris/preview-content — the shared CONTENT unit for the host preview overlay surface.

// Renders engine-highlighted typed-file content (frontmatter / context / body) + compact token
// info as `FillFn`s the host `host.preview` surface hosts. The host owns the chrome; this owns the
// content. Consumed by the editor, the type-list, and future consumers (backlinks, inline references preview,
// a canvas). Also re-exports the engine-token + highlight helpers the editor's live highlighting
// shares.

export { makeHoverContent, type HoverContent, type FillFn } from './content'
export { renderHighlighted, semanticRanges, syntaxRanges, type HRange } from './highlight'
export {
  type FieldKind,
  shapeKind,
  shapeLabel,
  tokenLabel,
  naiveKind,
  frontmatterRegion,
  makeByteToChar,
} from './semantic'
