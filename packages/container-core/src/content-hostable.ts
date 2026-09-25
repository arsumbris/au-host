// Whether dragged CONTENT could become a pane. A content drag offers a container's drop zones only when
// it could: a folder, say, is content only a folder destination takes, so no pane shows a zone for it.
// A content destination's own `accepts` is separate and unaffected. The host installs the one predicate
// it alone can answer (it owns the selection vocabulary); with none installed, all content could.

import type { DragContent } from './types.ts'

export type ContentHostable = (content: DragContent) => boolean

let hostable: ContentHostable | null = null

/** Install the predicate (`null` clears it, on host teardown). Mirrors `setContentResolver`. */
export function setContentHostable(predicate: ContentHostable | null): void {
  hostable = predicate
}

/** Whether a container zone is offered for this content. */
export function isContentHostable(content: DragContent): boolean {
  return hostable ? hostable(content) : true
}
