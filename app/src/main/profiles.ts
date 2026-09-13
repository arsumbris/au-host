// Agent-launch profiles: real `agent-profile` INSTANCES at `<entry>/operations/agent-profile/<name>.yaml`.

// A profile is a saved ad-hoc launch selection — injected skills + always-on inject context + the
// session's visible tools + the native-tool allowlist. It rides the entry ROOT's `operations/` folder (entry == root == home, the same
// place traces land), so profiles are git-trackable + shareable alongside the workspace, with a
// user-chosen name as the filename.

// ENGINE-MEDIATED, not direct fs. Every write goes through the governed mutation channel
// (`write_file` / `delete_file`) and the listing is an `instances_of('agent-profile')` read, so a
// profile is a first-class typed node: it validates against its type-def, and a deleted skill or
// tool surfaces as a broken-ref diagnostic. The `agent-profile`
// type is owned by `au-mcp-sdk` (`agent-profile::au-mcp-sdk`), so a workspace DECLARES `au-mcp-sdk`
// as a dep, which is what makes the claim legal (the peer gate).

// VALUES ARE TYPED REFS, not the runtime identities the launch consumes:
//   skills  `[[example-skill::example-package]]`  (instance-ref to an mcp.skill file)
//   tools   `[[mcp.tool.read_file::au-mcp]]`         (def-ref to an mcp.tool subtype)
//   inject  `[[orientation::hello-world-inject]]`    (instance-ref to an mcp.inject file)
// This module does NOT do that mapping for those axes. The RENDERER does, because only it holds the
// skill + inject manifests and the discovered tool list needed to resolve an owner — and guessing an
// owner is a real hazard (`au_guide` lives in au-mcp-type-knowledge, not au-mcp). So the `skills` /
// `tools` / `inject` arriving here are ALREADY wikilinks, and this module only serialises them.
// Adapter DTOs retain the launcher's bare type key. Persisted references use the owner
// reported by subtype discovery, never a provider-name or folder-name guess.

import * as path from 'node:path'

import { parseWikilink } from '@arsumbris/au-engine-sdk/wikilink'
import { readPreviewMutation, readSubtypes } from '@arsumbris/au-engine-sdk/reads'
import { stringify as stringifyYaml } from 'yaml'

import type { EngineConnections } from './engine-connections'
import type { AgentProfileData, ProfileSaveResult } from '../shared/daemon-api'

/** `<entry>/operations/agent-profile/`. */
function profilesDir(entry: string): string {
  return path.join(entry, 'operations', 'agent-profile')
}

/** The instance file for a profile name. */
function profileFile(entry: string, name: string): string {
  return path.join(profilesDir(entry), `${name}.yaml`)
}

/** A safe filename stem from a user-chosen name (no traversal / separators, length-capped). */
function safeName(name: string): string {
  return name
    .trim()
    .replace(/[/\\:]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim()
}

const HEADER =
  '# Agent-launch profile — a real `agent-profile` instance, engine-validated.\n' +
  '# Values are TYPED REFS (skills: mcp.skill instance-refs, tools: mcp.tool def-refs, inject:\n' +
  '# mcp.inject instance-refs); the host maps each to its runtime name at launch. Saved by au-host;\n' +
  '# the launch picker reads it back.\n'

/**
 * Write the ad-hoc selection as a named profile instance. An existing name is overwritten, but
 * GUARDED: we read the current bytes for their hash and pass it as `expectedHash`, so a profile
 * edited by hand (or by an agent) since we last read it is REJECTED rather than clobbered. A new
 * file has no hash to guard on, which the channel accepts as a create.
 *
 * `data.skills` / `data.tools` must already be wikilinks — see the module note.
 */
export async function saveProfile(
  engine: EngineConnections,
  entry: string,
  name: string,
  data: Omit<AgentProfileData, 'name'>,
): Promise<ProfileSaveResult> {
  const clean = safeName(name)
  if (!clean) return { ok: false, error: 'a profile needs a name' }

  // Both capability axes are OPEN: the KEY'S PRESENCE is the restriction, so an absent field and
  // an empty list are DIFFERENT profiles and must round-trip as such. Absent = every skill / tool;
  // `[]` = none. Hence `!== undefined` on both, never a length test.

  const doc: Record<string, unknown> = { type: 'agent-profile::au-mcp-sdk' }
  if (data.skills !== undefined) doc.skills = data.skills
  if (data.tools !== undefined) doc.tools = data.tools
  // Inject is OPEN too, but with a DIVERGENT absent meaning (the role-scoped default set, not all).
  // The persistence contract is the same three-state one: an absent key is a different profile from
  // an empty list, so write the key iff the field is present. `!== undefined`, never a length test.
  if (data.inject !== undefined) doc.inject = data.inject
  // The native-tool allowlist is OPEN like `tools` (absent = all native, `[]` = none, list = those),
  // so the same three-state persistence: write the key iff present, never a length test.
  if (data.nativeToolAllowlist !== undefined) doc.nativeToolAllowlist = data.nativeToolAllowlist
  // `hooks` (`type<mcp.hook>*[]`) is a def-ref list, three-state OPEN like `tools` (absent = every
  // hook, `[]` = only the critical ones, a subset = those + critical). Values arrive as wikilinks
  // from the renderer (`[[mcp.hook.x::owner]]`), so this only serialises them — same as `tools`.
  if (data.hooks !== undefined) doc.hooks = data.hooks
  // `hookConfig` (`mcp.hook&[+]`) is typed CONFIG: inline-or-ref mcp.hook INSTANCES whose fields ARE
  // the config, a SEPARATE axis from `hooks` (this configures, it does not select). Present-or-absent
  // (absent = inherit): the renderer sends the parsed array or undefined. Unlike the ref axes its
  // elements are inline RECORD OBJECTS, so it is written raw, never mapped to/from wikilinks.
  if (data.hookConfig !== undefined) doc.hookConfig = data.hookConfig
  // Qualify against the actual discovered owner; absent selection remains Ask at start.
  if (data.adapter) {
    const discovered = await readSubtypes(await engine.wireReader(entry), 'mcp.adapter')
    if (!('ready' in discovered) || !discovered.ready || !discovered.result)
      return { ok: false, error: 'The workspace is not ready to resolve the selected adapter.' }
    const matches = discovered.result.subtypes.filter(def => def.name === data.adapter)
    const owners = [...new Set(matches.map(def => def.repo))]
    if (owners.length !== 1 || !owners[0])
      return { ok: false, error: 'The selected adapter does not have one discovered repository owner. Refresh adapters before saving.' }
    doc.adapter = `[[${data.adapter}::${owners[0]}]]`
  }

  const file = data.path ?? profileFile(entry, clean)
  const content = HEADER + stringifyYaml(doc)
  const preview = await readPreviewMutation(await engine.wireReader(entry), {
    op: 'write_file', path: file, content,
  })
  if ('ok' in preview || !preview.ready)
    return { ok: false, error: 'The workspace is not ready to validate this profile. Retry when the engine is ready.' }
  if ('reject' in preview.result)
    return { ok: false, error: preview.result.reject.message }
  const target = preview.result.target
  const errors = target.diagnostics.filter((item) => item.severity === 'error')
  if (errors.length)
    return { ok: false, error: errors.map((item) => item.message).join('\n') }
  if (!target.identities.some((identity) => identity.name === 'agent-profile' && identity.repo === 'au-mcp-sdk'))
    return { ok: false, error: 'This location is not discoverable as a session profile. Check workspace scope and the profile type dependency before saving.' }
  // Read-before-write: an absent file yields no hash, which is the create path.
  const current = await engine.readFile(entry, file)
  const expectedHash = current.ok ? current.hash : undefined

  const result = await engine.writeFile(entry, file, content, expectedHash)
  if (!result.ok) {
    return {
      ok: false,
      error: result.conflict
        ? `"${clean}" changed on disk since it was read — reload before overwriting`
        : (result.error ?? 'profile write failed'),
    }
  }
  return { ok: true, name: clean }
}

/**
 * List the saved profiles, via `instances_of('agent-profile')` — so this returns what the ENGINE
 * recognises as a profile, not whatever files happen to sit in the folder. A hand-authored profile
 * elsewhere in the workspace is therefore listed too, and a malformed one is simply not an
 * instance and does not appear.
 *
 * Values come back as authored (wikilinks); the renderer maps them to runtime names.
 */
export async function listProfiles(engine: EngineConnections, entry: string): Promise<AgentProfileData[]> {
  const read = await engine.read(entry, { read: 'instances_of', type: 'agent-profile' })
  if (!read.ok || !read.ready) return []

  // UNWRAP THE ENVELOPE. `EngineConnections.read` hands back the RAW frame result, which is keyed
  // by the read name — `{ instances_of: [...] }`, not a bare array. The SDK's `readInstancesOf`
  // helper does this unwrapping for you; the raw read does not. Testing `Array.isArray(result)`
  // here would silently yield an empty list and make delete assertions pass vacuously
  // (nothing would be listed, so nothing could be verified as gone).
  const envelope = read.result as { instances_of?: unknown } | null
  const matches = envelope?.instances_of
  if (!Array.isArray(matches)) return []

  const out: AgentProfileData[] = []
  for (const match of matches as Array<{ path?: unknown; fields?: unknown }>) {
    if (typeof match.path !== 'string') continue
    const fields = (match.fields ?? {}) as Record<string, unknown>
    // A non-array (or absent) key reads as undefined = unrestricted; an array reads as the
    // exhaustive list, `[]` included. The two must stay distinct, per the OPEN model above.
    const refs = (value: unknown): string[] | undefined =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined
    // The `adapter` def-ref's on-disk value is a wikilink to the type-def (`[[mcp.adapter.cc]]`); the
    // DTO carries the bare type name, so parse it back, dropping any `::repo` qualifier. A missing or
    // non-wikilink value = no pin.
    const adapterName = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined
      const parsed = parseWikilink(value)
      return parsed.ok ? parsed.parts.target : undefined
    }
    out.push({
      name: path.basename(match.path).replace(/\.ya?ml$/, ''),
      path: match.path,
      adapter: adapterName(fields.adapter),
      skills: refs(fields.skills),
      tools: refs(fields.tools),
      inject: refs(fields.inject),
      nativeToolAllowlist: refs(fields.nativeToolAllowlist),
      // `hooks` is a def-ref list like `tools` — read back as the wikilink array.
      hooks: refs(fields.hooks),
      // `hookConfig` holds inline RECORD objects, not refs, so `refs()` (string-only) would drop
      // them. Read it back as the raw array the renderer re-stringifies into its config textarea.
      hookConfig: Array.isArray(fields.hookConfig) ? (fields.hookConfig as unknown[]) : undefined,
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * Delete a saved profile. `filePath` (from the listing) is preferred, since a profile may live
 * outside the conventional folder; the name-derived path is the fallback.
 */
export async function deleteProfile(
  engine: EngineConnections,
  entry: string,
  name: string,
  filePath?: string,
): Promise<{ ok: boolean; error?: string }> {
  const file = filePath ?? profileFile(entry, safeName(name))
  const result = await engine.deleteFile(entry, file)
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'profile delete failed' }
}
