// Which disposition does THIS group open a file with?

// Resolve the open disposition as a pure function of the fired intent and the
// group's authored default. Explicit intent modes take precedence.

// THE RULE, in precedence order:
//   1. an EXPLICIT mode on the intent — the firer knew, because a GESTURE said so. A double-click
//      means "keep this"; a cmd-click means "pin what I am previewing, peek the next".
//   2. the group's AUTHORED `defaultOpenMode` — the firer had no opinion, so the container decides.
//      Per-instance, so a reference panel and a working editor can differ.
//   3. `transient` — what tabs already did, so an unconfigured group is unchanged.




/** The dispositions an `open-intent` may carry. `preview-pin` is a GESTURE verb. */
export type OpenMode = 'transient' | 'permanent' | 'preview-pin'

/** What a group may be AUTHORED to default to — a SUBSET, because `preview-pin` is meaningless
 *  as a standing default ("pin the current preview" needs a current preview and a gesture). */
export type DefaultOpenMode = 'transient' | 'permanent'

/**
 * Resolve the disposition for one open.
 *
 * @param intentMode  the mode the intent carried, or `undefined` when the firer had no opinion.
 * @param authored    the group's `defaultOpenMode`, or `undefined` when unconfigured.
 */
export function resolveOpenMode(intentMode: OpenMode | undefined, authored: DefaultOpenMode | undefined): OpenMode {
  return intentMode ?? authored ?? 'transient'
}
