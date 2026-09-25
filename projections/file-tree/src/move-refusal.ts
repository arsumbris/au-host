// Whether a dragged or picked file / folder can move into a folder. One rule for the drop target (which then
// offers no Move at all) and the move itself (the backstop for the folder picker).

import type { ContentDropVerdict } from '@arsumbris/container-kit'
import { isFileSelection, isFolderSelection, type Selection } from '@arsumbris/selection'

/** Why `selection` cannot move into `dir`: `already-there` when `dir` is its own folder, `into-itself` when a
 *  folder would move into itself or a descendant. `null` when the move is possible. Paths are absolute. */
export function moveRefusal(selection: Selection, dir: string): 'already-there' | 'into-itself' | null {
  if (!isFileSelection(selection) && !isFolderSelection(selection)) return null
  const path = selection.path
  if (path.slice(0, path.lastIndexOf('/')) === dir) return 'already-there'
  if (isFolderSelection(selection) && (dir === path || dir.startsWith(`${path}/`))) return 'into-itself'
  return null
}

/** A folder destination's drop verdict: a file or folder it can take is `accept`, one it cannot (already
 *  there, or a folder into itself) is `refuse`, so nothing further out is offered in its place. Any other
 *  content is not a move at all, so it `pass`es. */
export function moveVerdict(selection: Selection, dir: string): ContentDropVerdict {
  if (!isFileSelection(selection) && !isFolderSelection(selection)) return 'pass'
  return moveRefusal(selection, dir) === null ? 'accept' : 'refuse'
}

/** Where a path reported by a move preview sits NOW. The engine reports a file inside the moved folder at its
 *  destination path (`to/...`), which does not exist yet; everything else is already current. */
export function currentPath(reported: string, from: string, to: string): string {
  return reported === to || reported.startsWith(`${to}/`) ? from + reported.slice(to.length) : reported
}

/** Why `name` cannot be a file or folder name, or null when it can. */
export function nameProblem(name: string): string | null {
  if (!name) return 'a name cannot be empty'
  if (name.includes('/')) return 'a name cannot contain “/”'
  if (name === '.' || name === '..') return `“${name}” is not a usable name`
  return null
}

/** An expanded-folder set after `from` moved to `to`: each path at or under `from` follows it, so a moved
 *  folder keeps its open subfolders and no dead path lingers. */
export function followMove(expanded: ReadonlySet<string>, from: string, to: string): Set<string> {
  return new Set([...expanded].map((p) => currentPath(p, to, from)))
}
