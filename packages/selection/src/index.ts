// First-party `selection` vocabulary package (NOT the SDK).
//
// `Selection` / `FileSelection` are generated from `./type/*.type.yaml`
// (`pnpm gen:types`); the narrowing helper + constructor are authored. `Range` is
// borrowed from `@arsumbris/range` (vendored type-def, imported here). A selection is
// what a view has picked: a target plus an optional sub-region. The base is an open
// extension point; the SDK never interprets these — they ride the payload-opaque
// view-state channel, and consumers narrow via `type`, falling back via is-a.
//

import type { Range } from '@arsumbris/range'

import type { FileSelection, LinkSelection, Selection } from './generated'

export type { FileSelection, LinkSelection, Selection } from './generated'

export function isFileSelection(selection: Selection): selection is FileSelection {
  return selection.type === 'file-selection'
}

/** Construct a whole-file selection. */
export function fileSelection(path: string, range?: Range): FileSelection {
  return range ? { type: 'file-selection', path, range } : { type: 'file-selection', path }
}

export function isLinkSelection(selection: Selection): selection is LinkSelection {
  return selection.type === 'link-selection'
}

/** Construct a wikilink selection — `target` is the reference TEXT a reader dragged out (the
 *  `[[…]]` inner minus its `|alias`), NOT a resolved path. The drop side resolves it, the same
 *  way a file-selection's viewer is resolved at drop. See the link-selection type-def. */
export function linkSelection(target: string, range?: Range): LinkSelection {
  return range ? { type: 'link-selection', target, range } : { type: 'link-selection', target }
}

/**
 * A stable identity STRING for a selection, keyed on WHAT it addresses, ignoring the sub-region
 * (`range`) and the contribution-site address (`^`). Two selections addressing the same file — one
 * with a cursor range, one without — share an identity, so a host that keys by it (e.g. the
 * open-surfaces index) treats them as one content and never churns on an intra-content navigation.
 * The vocabulary owns this function so a declarer and a querier compute the same string.
 */
export function selectionIdentity(selection: Selection): string {
  if (isFileSelection(selection)) return `file:${selection.path}`
  if (isLinkSelection(selection)) return `link:${selection.target}`
  // an unknown / custom kind: a stable, range- and block-id-free structural key.
  const { range: _range, ['^']: _block, ...rest } = selection as Record<string, unknown>
  return `selection:${JSON.stringify(rest)}`
}

/**
 * Pair a selection with its identity for a host open-content declaration. The result is structurally
 * an `OpenContent` (`{ identity, payload }`) without this package depending on the host SDK: the host
 * matches by `identity` and never reads the opaque `payload`, and a consumer casts the payload back to
 * a `Selection`.
 */
export function openContent(selection: Selection): { identity: string; payload: Selection } {
  return { identity: selectionIdentity(selection), payload: selection }
}
