// Enumerate workspace members through the engine's `members` read. Each member supplies its name,
// absolute root, and scattered status, so content-only members are included alongside projection packages.

import { readMembers, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import type { WorkspaceMember } from '@arsumbris/au-host-sdk'

// Re-export the SDK-owned `WorkspaceMember` contract for renderer consumers.
export type { WorkspaceMember }

/** Enumerate the workspace's members via the engine `members` read (name-sorted). */
export async function discoverMembers(reader: WireReader): Promise<WorkspaceMember[]> {
  const result = await readMembers(reader)
  if (!('ready' in result) || !result.ready || !result.result) return []
  // Map wire `repo` to host `name`. `editable` expresses the authoring role; `local` distinguishes
  // a live tree from a cached snapshot. `isAuthoringMember` controls display and `isWritableMember`
  // controls save targeting.
  return result.result.map((m) => ({
    name: m.repo,
    root: m.root,
    scattered: m.scattered,
    editable: m.editable,
    local: m.local,
    role: m.role,
  }))
}
