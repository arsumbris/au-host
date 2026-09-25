// Add / remove / re-role / enable / disable workspace members and declare peers, in the folder-repo model.
//
// Two files, two LIFETIMES, which is why membership never touches `repo.yaml`:
//   - `<entry>/.arsumbris/workspace.yaml` is per-WORKSPACE composition (`edit:` / `discover:` / `disabled:`).
//   - `<member>/.arsumbris/repo.yaml` is a repo's identity and INTRINSIC `deps`, folded into its closure-hash
//     (= identity) and travelling with the repo. Adding a workspace member must not change what a repo IS.
// So the member verbs edit `workspace.yaml`; only declarePeer touches a `repo.yaml`.
//
// Every edit goes through the engine's governed composition verbs: a byte-splice that keeps comments and
// order, one git commit per mutation, the standard mutation frame. A verb with no `root` authors the
// served entry's `workspace.yaml`, and the engine refuses to take the entry repo out of its own `edit:`.
// The verbs are not idempotent: the engine refuses a no-op (a name already listed, already in the target
// role, already disabled, or not disabled) with nothing written. Only `scaffoldRegistry` writes a file
// itself (see it).
//
// Member LOCATION is NOT written here. It is device-global (`~/.arsumbris/au-engine/config/repos.yaml`),
// written via the daemon `register` mutation, so a full "add a local member" is addMember + register.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import type { DaemonClient, TypedMutate } from '@arsumbris/au-engine-sdk'
import { parseDocument } from 'yaml'

import type { FileWriteResult, WorkspaceEditResult, WorkspaceMemberListRole } from '../shared/daemon-api'

/** Run one governed mutation against the daemon serving `entry` (`EngineConnections.mutate`). */
export type Mutate = (entry: string, run: (client: DaemonClient) => Promise<TypedMutate>) => Promise<FileWriteResult>

const result = (r: FileWriteResult): WorkspaceEditResult => (r.ok ? { ok: true } : { ok: false, error: r.error })

/** A repo we can mount: a directory carrying a package.json, a type/ dir, or .arsumbris/. */
function looksLikeRepo(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false
  } catch {
    return false
  }
  return existsSync(path.join(dir, 'package.json')) || existsSync(path.join(dir, 'type')) || existsSync(path.join(dir, '.arsumbris'))
}

const NAME_RE = /^[A-Za-z0-9._-]+$/

/** Path to a member's `.arsumbris/repo.yaml`. */
function repoYamlPath(memberRoot: string): string {
  return path.join(memberRoot, '.arsumbris', 'repo.yaml')
}

/**
 * STANDIN [[message - 260925104814 - composition verbs author the wrong member without a root, a disabled-overlay verb, and daemonless setup commands::au-engine]]:
 * the engine owns the `repo.yaml` format, so a daemonless "make this folder a repo" command should write it.
 *
 * Give a member a `repo.yaml` identity (`name`, optional `description`) when it has none.
 * This makes a device-registry-located member identity-verifiable. An existing name is left untouched.
 */
export function scaffoldRegistry(memberRoot: string, memberName: string, description?: string): WorkspaceEditResult {
  if (!NAME_RE.test(memberName)) return { ok: false, error: `invalid member name '${memberName}'` }
  const regPath = repoYamlPath(memberRoot)
  const doc = existsSync(regPath) ? parseDocument(readFileSync(regPath, 'utf8')) : parseDocument('')
  if (typeof doc.get('name') === 'string') return { ok: true } // already self-describing
  doc.set('name', memberName)
  if (description) doc.set('description', description)
  try {
    mkdirSync(path.dirname(regPath), { recursive: true })
    writeFileSync(regPath, doc.toString())
  } catch (e) {
    return { ok: false, error: `write failed: ${(e as Error).message}` }
  }
  return { ok: true }
}

/**
 * Add a member: give it a `repo.yaml` identity, then list `name` in the entry's `workspace.yaml`.
 * Identity comes first, so a member is never listed without a repo to mount; a failed scaffold aborts
 * the add with nothing listed. Its device-global LOCATION is registered separately by the caller
 * (`engine.register(name, memberPath)`).
 *
 * `role` picks the LIST, which IS the member's role in this workspace:
 *  - `edit`     (default) an authoring surface, mounted live at HEAD.
 *  - `discover` mounted so type-discovery composes its parts, pinned, NOT editable.
 * The engine refuses a name already listed (a member has one role) and creates `workspace.yaml`
 * self-complete when it is absent.
 */
export async function addMember(
  mutate: Mutate,
  entry: string,
  member: { name: string; memberPath: string; role?: WorkspaceMemberListRole; description?: string },
): Promise<WorkspaceEditResult> {
  const { name, memberPath, description } = member
  if (!existsSync(memberPath)) return { ok: false, error: `path does not exist: ${memberPath}` }
  if (!looksLikeRepo(memberPath)) return { ok: false, error: `${memberPath} is not a repo (no package.json / type/ / .arsumbris/)` }
  const identity = scaffoldRegistry(memberPath, name, description)
  if (!identity.ok) return { ok: false, error: `${name} was not added: ${identity.error}` }
  return result(await mutate(entry, (client) => client.addWorkspaceMember(name, member.role ?? 'edit')))
}

/**
 * Declare `peerName` as a cross-repo dependency of the member rooted at `memberRoot` (its `repo.yaml`
 * `deps:`), which clears an `undeclared-peer` diagnostic. A `remote` is recorded when supplied. The new
 * peer stays `peer-unmounted` until it is resolved. The engine authors editable members only (the entry
 * or an `edit:` member) and refuses a peer already declared.
 */
export async function declarePeer(mutate: Mutate, entry: string, memberRoot: string, peerName: string, remote?: string): Promise<WorkspaceEditResult> {
  return result(await mutate(entry, (client) => client.addRepoDependency(peerName, { root: memberRoot, ...(remote ? { remote } : {}) })))
}

/**
 * Change a member's ROLE by moving its name between the entry's `edit:` and `discover:` lists. The engine
 * keeps the entry repo in `edit:` and refuses a member already in the target role. A `dep` lives in a
 * member's own `repo.yaml`, not here.
 */
export async function setMemberRole(mutate: Mutate, entry: string, name: string, role: WorkspaceMemberListRole): Promise<WorkspaceEditResult> {
  return result(await mutate(entry, (client) => client.setWorkspaceMemberRole(name, role)))
}

/**
 * Enable / disable a declared member via the entry `workspace.yaml`'s `disabled:` OVERLAY list. A member
 * stays declared in `edit:` / `discover:` (its role remembered) but, while disabled, mounts nothing. The
 * engine refuses the entry repo, an undeclared name, a duplicate disable, and re-enabling a name that is
 * not disabled. Re-enabling the last one leaves `disabled: []`.
 */
export async function setMemberDisabled(mutate: Mutate, entry: string, name: string, disabled: boolean): Promise<WorkspaceEditResult> {
  return result(await mutate(entry, (client) => client.setWorkspaceMemberDisabled(name, disabled)))
}

/** Remove a member from whichever of the entry's lists hold it, `disabled:` included. Its device-global
 *  location entry (`repos.yaml`) is left in place: it is shared across workspaces, not this workspace's to
 *  clear. The engine refuses removing the entry repo. */
export async function removeMember(mutate: Mutate, entry: string, name: string): Promise<WorkspaceEditResult> {
  return result(await mutate(entry, (client) => client.removeWorkspaceMember(name)))
}
