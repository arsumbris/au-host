// Validate a boot-gate selection without a daemon, using main-process filesystem access.
// A valid entry is a directory carrying `.arsumbris/repo.yaml`; file entries are rejected.
// A directory without a repo is a recoverable `notARepo` state, separate from other problems,
// so the gate can offer to scaffold it.

import { statSync } from 'node:fs'
import { join } from 'node:path'

import type { GateInspection } from '../shared/daemon-api'

/** The marker that makes a directory a repo, hence a valid daemon entry. */
const REPO_MARKER = join('.arsumbris', 'repo.yaml')

function statSafe(p: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(p)
  } catch {
    return undefined
  }
}

/** Does this directory carry `.arsumbris/repo.yaml`? */
export function isFolderRepo(dir: string): boolean {
  return statSafe(join(dir, REPO_MARKER))?.isFile() ?? false
}

export function inspectGate(target: string): GateInspection {
  const t = (target ?? '').trim()
  const problems: string[] = []

  if (!t) return { root: '', ok: false, notARepo: false, problems: ['select a workspace folder'] }

  const st = statSafe(t)
  if (!st) {
    problems.push(`folder not found: ${t}`)
    return { root: t, ok: false, notARepo: false, problems }
  }

  if (!st.isDirectory()) {
    // A file cannot serve as a workspace entry; explain that a folder-repo is required.
    problems.push(
      'that is a file — pick the FOLDER. The daemon enters on a folder-repo (a directory with .arsumbris/repo.yaml); a *.au-workspace.yaml file entry is no longer accepted.',
    )
    return { root: t, ok: false, notARepo: false, problems }
  }

  // A directory that is not yet a repo: recoverable, so it is its own state, not a problem.
  if (!isFolderRepo(t)) {
    return { root: t, ok: false, notARepo: true, problems: [] }
  }

  // Entry == root == home: the entry folder IS the engine root, no derivation.
  return { root: t, ok: true, notARepo: false, problems }
}
