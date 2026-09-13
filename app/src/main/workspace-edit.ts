// Add / remove / declare workspace members in the SCHEMA-16 FOLDER-REPO on-disk model.
//
// Two committed files, all raw fs (the mutation channel can't write `.arsumbris/`, and these are
// engine config — same rationale as gate-create.ts):
//   <entry>/.arsumbris/workspace.yaml — the composition: `edit:` + `discover:` name lists.
//   <member>/.arsumbris/repo.yaml — a member's identity + deps (au.engine.repo): `name` + `deps`.
//
// The two files have two LIFETIMES, and that is why membership never touches `repo.yaml`:
//   - `workspace.yaml` is per-WORKSPACE composition, read only when its folder is the entry.
//   - `repo.yaml deps` is a repo's INTRINSIC type-dependencies, folded into its closure-hash (=
//     identity) and travelling with the repo. Adding a workspace member must not change what a repo IS.
// So addMember/removeMember edit `workspace.yaml`; only declarePeer touches a `repo.yaml`.
//
// Member LOCATION is NOT written here — it is device-global (`~/.arsumbris/au-engine/config/repos.yaml`), written
// via the daemon `register` mutation (`engine.register`). So a full "add a local member" is:
// addMember (this file) + register (the caller).

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import { parseDocument, YAMLMap, YAMLSeq, Scalar } from 'yaml'

import type { WorkspaceEditResult, WorkspaceMemberListRole } from '../shared/daemon-api'

/**
 * The entry folder's composition file is `<entry>/.arsumbris/workspace.yaml`.
 * The entry must be a repo. Its workspace file is optional and is created on first edit;
 * a single-repo workspace can omit it until another member is added.
 */
function findWorkspace(entry: string): { entryName: string; wsPath: string } | { error: string } {
  const repoPath = path.join(entry, '.arsumbris', 'repo.yaml')
  if (!existsSync(repoPath)) {
    return { error: `${entry} is not a folder-repo (no .arsumbris/repo.yaml) — scaffold it before editing members` }
  }
  let entryName: string
  try {
    const doc = parseDocument(readFileSync(repoPath, 'utf8'))
    const n = doc.get('name')
    if (typeof n !== 'string') return { error: `${repoPath} declares no name` }
    entryName = n
  } catch (e) {
    return { error: `cannot read ${repoPath}: ${(e as Error).message}` }
  }
  return { entryName, wsPath: path.join(entry, '.arsumbris', 'workspace.yaml') }
}

/**
 * Parse the entry's `workspace.yaml`, creating an in-memory one when absent.
 *
 * A created file MUST list the entry repo in `edit:` — a `workspace.yaml` that omits its own
 * containing repo is a hard engine error (`workspace-omits-containing-repo`). So we seed it here
 * rather than writing a file the engine would immediately reject.
 */
function loadWorkspaceDoc(wsPath: string, entryName: string): ReturnType<typeof parseDocument> {
  if (existsSync(wsPath)) return parseDocument(readFileSync(wsPath, 'utf8'))
  const doc = parseDocument('')
  const edit = new YAMLSeq()
  edit.add(entryName)
  doc.set('edit', edit)
  return doc
}

/** A repo we can mount: a directory carrying a package.json, a type/ dir, or .arsumbris/. */
function looksLikeRepo(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false
  } catch {
    return false
  }
  return existsSync(path.join(dir, 'package.json')) || existsSync(path.join(dir, 'type')) || existsSync(path.join(dir, '.arsumbris'))
}

function ensureSeq(doc: ReturnType<typeof parseDocument>, key: string): YAMLSeq {
  const node = doc.get(key)
  if (node instanceof YAMLSeq) return node
  const seq = new YAMLSeq()
  doc.set(key, seq)
  return seq
}

/** The bare string values already in an `edit:` / `discover:` seq. */
function stringItems(seq: unknown): string[] {
  if (!(seq instanceof YAMLSeq)) return []
  return seq.items
    .map((it) => (it instanceof Scalar ? it.value : it))
    .filter((v): v is string => typeof v === 'string')
}

/** The `name`s already declared in a map-seq (`deps:` entries). */
function declaredNames(seq: unknown): string[] {
  if (!(seq instanceof YAMLSeq)) return []
  return seq.items.map((it) => (it instanceof YAMLMap ? (it.get('name') as string | undefined) : undefined)).filter((n): n is string => typeof n === 'string')
}

/** Remove a bare string from a seq, if present. */
function removeString(seq: unknown, value: string): boolean {
  if (!(seq instanceof YAMLSeq)) return false
  const idx = seq.items.findIndex((it) => (it instanceof Scalar ? it.value : it) === value)
  if (idx < 0) return false
  seq.delete(idx)
  return true
}

const NAME_RE = /^[A-Za-z0-9._-]+$/

/** Path to a member's `.arsumbris/repo.yaml`. */
function repoYamlPath(memberRoot: string): string {
  return path.join(memberRoot, '.arsumbris', 'repo.yaml')
}

/**
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
 * Add a member: list `name` in the entry's `workspace.yaml` and give the member a `repo.yaml` identity.
 * Its device-global LOCATION is registered separately by the caller (`engine.register(name, memberPath)`).
 *
 * `role` picks the LIST — it IS the member's role in this workspace:
 *  - `edit`     (default) an authoring surface, mounted live at HEAD.
 *  - `discover` mounted so type-discovery composes its parts, pinned, NOT editable.
 * A member has ONE role: listing a name in both is a hard engine error
 * (`workspace-member-role-conflict`), so an existing membership in the other list is refused here.
 */
export function addMember(
  entry: string,
  member: { name: string; memberPath: string; role?: WorkspaceMemberListRole; description?: string },
): WorkspaceEditResult {
  const ws = findWorkspace(entry)
  if ('error' in ws) return { ok: false, error: ws.error }
  const { name, memberPath, description } = member
  const role: WorkspaceMemberListRole = member.role ?? 'edit'
  if (!NAME_RE.test(name)) return { ok: false, error: `invalid member name '${name}'` }
  if (!existsSync(memberPath)) return { ok: false, error: `path does not exist: ${memberPath}` }
  if (!looksLikeRepo(memberPath)) return { ok: false, error: `${memberPath} is not a repo (no package.json / type/ / .arsumbris/)` }

  const doc = loadWorkspaceDoc(ws.wsPath, ws.entryName)
  const other: WorkspaceMemberListRole = role === 'edit' ? 'discover' : 'edit'
  // `an edit` / `a discover` — the article is user-facing copy in an error dialog.
  const article = (r: WorkspaceMemberListRole): string => (r === 'edit' ? 'an' : 'a')
  if (stringItems(doc.get(role)).includes(name)) return { ok: false, error: `'${name}' is already ${article(role)} '${role}' member` }
  if (stringItems(doc.get(other)).includes(name)) {
    return { ok: false, error: `'${name}' is already ${article(other)} '${other}' member — a member has one role; remove it first` }
  }

  ensureSeq(doc, role).add(name)
  try {
    mkdirSync(path.dirname(ws.wsPath), { recursive: true })
    writeFileSync(ws.wsPath, doc.toString())
  } catch (e) {
    return { ok: false, error: `write failed: ${(e as Error).message}` }
  }
  // Seed the member's own identity so it mounts as a proper repo (best-effort — it is already
  // listed; a scaffold failure doesn't undo that).
  scaffoldRegistry(memberPath, name, description)
  return { ok: true }
}

/**
 * Declare `peerName` as a cross-repo dependency of the member rooted at `memberRoot`, by editing (or
 * creating) that member's `.arsumbris/repo.yaml` `deps:` list.
 * Clears an `undeclared-peer` diagnostic. A `remote` (for
 * standalone fetch) is recorded when supplied. Idempotent.
 */
export function declarePeer(memberRoot: string, memberName: string, peerName: string, remote?: string): WorkspaceEditResult {
  if (!NAME_RE.test(peerName)) return { ok: false, error: `invalid peer name '${peerName}'` }
  const regPath = repoYamlPath(memberRoot)
  const doc = existsSync(regPath) ? parseDocument(readFileSync(regPath, 'utf8')) : parseDocument('')
  if (typeof doc.get('name') !== 'string') doc.set('name', memberName)

  const deps = ensureSeq(doc, 'deps')
  if (declaredNames(deps).includes(peerName)) return { ok: true } // idempotent
  deps.add(doc.createNode(remote ? { name: peerName, remote } : { name: peerName }))

  try {
    mkdirSync(path.dirname(regPath), { recursive: true })
    writeFileSync(regPath, doc.toString())
  } catch (e) {
    return { ok: false, error: `write failed: ${(e as Error).message}` }
  }
  return { ok: true }
}

/**
 * Change a member's ROLE by moving its name between the entry's `edit:` and `discover:` lists.
 * Only these two roles are workspace.yaml-listed and movable — the entry repo is pinned to `edit:`, and
 * a `dep` lives in a member's own `repo.yaml`, not here. Idempotent when already in the target list.
 */
export function setMemberRole(entry: string, name: string, role: WorkspaceMemberListRole): WorkspaceEditResult {
  const ws = findWorkspace(entry)
  if ('error' in ws) return { ok: false, error: ws.error }
  if (name === ws.entryName) {
    return { ok: false, error: `'${name}' is the entry repo — it must stay an 'edit' member` }
  }
  if (!existsSync(ws.wsPath)) return { ok: false, error: `'${name}' is not a declared member (no workspace.yaml)` }
  const doc = parseDocument(readFileSync(ws.wsPath, 'utf8'))
  const other: WorkspaceMemberListRole = role === 'edit' ? 'discover' : 'edit'
  if (stringItems(doc.get(role)).includes(name)) return { ok: true } // already this role, idempotent
  const article = (r: WorkspaceMemberListRole): string => (r === 'edit' ? 'an' : 'a')
  if (!removeString(doc.get(other), name)) {
    return { ok: false, error: `'${name}' is not ${article(other)} '${other}' member` }
  }
  ensureSeq(doc, role).add(name)
  try {
    writeFileSync(ws.wsPath, doc.toString())
  } catch (e) {
    return { ok: false, error: `write failed: ${(e as Error).message}` }
  }
  return { ok: true }
}

/**
 * Enable / disable a declared member via the entry `workspace.yaml`'s `disabled:` OVERLAY list — a member
 * stays declared in `edit:` / `discover:` (its role remembered) but, while disabled, mounts nothing. Add
 * the name to disable, remove it to re-enable. The member must already be a declared edit/discover member
 * (a `disabled:` entry naming no declared member is the engine's `disabled-member-not-declared` warning).
 * The entry repo cannot be disabled. Idempotent.
 */
export function setMemberDisabled(entry: string, name: string, disabled: boolean): WorkspaceEditResult {
  const ws = findWorkspace(entry)
  if ('error' in ws) return { ok: false, error: ws.error }
  if (name === ws.entryName) return { ok: false, error: `'${name}' is the entry repo — it cannot be disabled` }
  if (!existsSync(ws.wsPath)) return { ok: false, error: `'${name}' is not a declared member (no workspace.yaml)` }
  const doc = parseDocument(readFileSync(ws.wsPath, 'utf8'))
  const declared = stringItems(doc.get('edit')).includes(name) || stringItems(doc.get('discover')).includes(name)
  if (!declared) return { ok: false, error: `'${name}' is not a declared edit/discover member` }
  if (disabled) {
    const list = ensureSeq(doc, 'disabled')
    if (stringItems(list).includes(name)) return { ok: true } // idempotent
    list.add(name)
  } else {
    if (!removeString(doc.get('disabled'), name)) return { ok: true } // already enabled
    const rest = doc.get('disabled')
    if (rest instanceof YAMLSeq && rest.items.length === 0) doc.delete('disabled') // don't leave an empty overlay
  }
  try {
    writeFileSync(ws.wsPath, doc.toString())
  } catch (e) {
    return { ok: false, error: `write failed: ${(e as Error).message}` }
  }
  return { ok: true }
}

/** Remove a member: drop it from whichever of the entry's `edit:` / `discover:` lists holds it. Its
 *  device-global location entry (`repos.yaml`) is left in place — it is shared across workspaces, not
 *  this workspace's to clear. Refuses to remove the entry repo itself, which must stay in `edit:`. */
export function removeMember(entry: string, name: string): WorkspaceEditResult {
  const ws = findWorkspace(entry)
  if ('error' in ws) return { ok: false, error: ws.error }
  if (name === ws.entryName) {
    return { ok: false, error: `'${name}' is the entry repo — a workspace.yaml must list its own repo in edit:` }
  }
  if (!existsSync(ws.wsPath)) return { ok: false, error: `'${name}' is not a declared member (no workspace.yaml)` }
  const doc = parseDocument(readFileSync(ws.wsPath, 'utf8'))
  const dropped = removeString(doc.get('edit'), name) || removeString(doc.get('discover'), name)
  if (!dropped) return { ok: false, error: `'${name}' is not a declared member` }
  try {
    writeFileSync(ws.wsPath, doc.toString())
  } catch (e) {
    return { ok: false, error: `write failed: ${(e as Error).message}` }
  }
  return { ok: true }
}
