// The launcher's target selection: which engine ENTRY the host opens against.
//
// ONE kind of entry: a folder-repo — a DIRECTORY carrying `.arsumbris/repo.yaml`. The daemon is
// pointed at that folder, and it IS the workspace root and home (entry == root == home). Its optional
// `.arsumbris/workspace.yaml` composes the other members (`edit:` authored live, `discover:` pinned).
// A directory that is not yet a repo is not a dead end: the launcher offers to scaffold one.
//
// The in-code default entry is supplied by the APP (a dev convenience), not hardcoded here — the
// launcher package carries no machine-specific path. See the `Launcher` `defaultEntry` prop.

export interface GateSelection {
  /** Absolute path to the selected folder-repo entry (the directory the daemon is pointed at). */
  entry: string
}

/** The engine ENTRY the daemon serves for a selection. Entry == root, so this is just the path. */
export function gateRoot(selection: GateSelection): string {
  return selection.entry.trim()
}
