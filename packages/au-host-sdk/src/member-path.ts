// Which workspace member owns a path.
//
// A host path is absolute, or relative to the workspace ENTRY (the engine resolves a relative path
// against it). Member roots are absolute. So a relative path is placed under the entry before it is
// compared, and both sides are compared in one normalized form: forward slashes, `.` / `..` resolved,
// no trailing slash, case-folded on a Windows drive or UNC path.

const isWindowsPath = (p: string): boolean => /^[a-z]:\//i.test(p) || p.startsWith('//')

/** Forward slashes, `.` and `..` resolved lexically, no trailing slash. */
function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const lead = slashed.startsWith('//') ? '//' : slashed.startsWith('/') ? '/' : ''
  const out: string[] = []
  for (const part of slashed.slice(lead.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return lead + out.join('/')
}

/** The absolute form of a host path: as is when absolute, else under the entry. Undefined when unplaceable. */
export function absoluteHostPath(path: string, entryPath?: string): string | undefined {
  const slashed = path.replace(/\\/g, '/')
  if (slashed.startsWith('/') || isWindowsPath(slashed)) return normalizePath(slashed)
  return entryPath ? normalizePath(`${entryPath.replace(/\\/g, '/')}/${slashed}`) : undefined
}

/**
 * The member that OWNS a host path: the member whose root is the path itself or an ancestor directory
 * of it, the deepest such root when members nest. `undefined` when no member contains it, or the path is
 * relative and no `entryPath` is given to place it.
 *
 * A root owns only whole path segments, so `/a/foo` never owns `/a/foobar`. The one answer every view
 * uses for "which repo is this file in", which is also the repo a bare type name written in it resolves in.
 *
 * Structural, so it accepts either a `WorkspaceMember` or a raw `WireMember`.
 */
export function memberOfPath<M extends { root: string }>(
  members: readonly M[],
  path: string,
  entryPath?: string,
): M | undefined {
  const absolute = absoluteHostPath(path, entryPath)
  if (absolute === undefined) return undefined
  const fold = isWindowsPath(absolute) ? (v: string) => v.toLowerCase() : (v: string) => v
  const target = fold(absolute)
  let owner: M | undefined
  let depth = -1
  for (const m of members) {
    const root = fold(normalizePath(m.root))
    const within = target === root || target.startsWith(root.endsWith('/') ? root : `${root}/`)
    if (within && root.length > depth) {
      owner = m
      depth = root.length
    }
  }
  return owner
}
