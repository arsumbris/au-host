// First-party `range` vocabulary package (NOT the SDK).
//
// `Range` / `TextRange` are generated from `./type/*.type.yaml` (`pnpm gen:types`);
// the narrowing helpers are authored. A range is a sub-region of some content. The
// base is an open extension point; each medium pins its own subtype. The SDK never
// interprets these — they ride the payload-opaque view-state channel, and consumers
// narrow via `type`.
//

import type { Range, TextRange } from './generated'

export type { Range, TextRange } from './generated'

export function isTextRange(range: Range): range is TextRange {
  return range.type === 'text-range'
}
