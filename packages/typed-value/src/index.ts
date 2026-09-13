// `@arsumbris/typed-value` — the recursive typed-value editor's framework-agnostic core.

// A shared substrate package (parallel to `range` / `selection`): it takes the engine's
// typed-value vocabulary (`WireShape`) in and produces a `ResolvedShape` the editor
// renders, validates a value against it, and normalizes the value per consumer. It is
// DOM-free and framework-agnostic, so the command palette (renderer), the agent
// intent-as-tool bridge (au-mcp, node), and any author-an-instance flow share ONE core.

// It deps `@arsumbris/au-engine-sdk` DIRECTLY for the read vocabulary (`/reads`), not
// the host-sdk `engine-reads` seam: this package must also be dep-able by au-mcp, which
// must never dep the host mount contract. au-engine-sdk stays the one served shared-dep,
// so a renderer bundle still resolves to a single instance.


// Design: a recursive typed-value editor over WireShape, a DOM-free core plus a presentational element shared by palette agents and authoring.

export type {
  ResolvedShape,
  ResolvedField,
  ResolvedRecordChoice,
  ResolvedDefRef,
  TypedValue,
  NormalizeTarget,
  EditorOption,
  ResolveOptions,
  ValueDiagnostic,
} from './contracts'

export { resolve, makeReaderPort, type TypeGraphPort } from './resolve'
export { validate } from './validate'
export { normalize, type NormalizeResult } from './normalize'
