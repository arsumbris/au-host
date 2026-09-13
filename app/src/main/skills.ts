// The skills-manifest hook (main process).
//
// Reads the CC adapter's `bin/gen-skills.ts --manifest` over the workspace: PRINT the discovered
// `mcp.skill` instances as JSON (writes nothing). Drives the launch picker (what to render) + the
// visible-by-absence surface (skipped skills with reasons). Skill MATERIALIZATION (the actual
// `--plugin-dir` set) happens inside the adapter's `launch.ts` at launch time (see `agent-launch.ts`).
//
// Contract with the adapter entrypoint (owned by the au-mcp family):
// - STDOUT: the manifest JSON.
// - STDERR: diagnostics (skipped-skill reasons, GC sweeps).
// - exit 1: failure (e.g. the engine daemon is not up on the entry).
// - exit 2: a missing --workspace.
//
// The entrypoint reads the engine type graph, so the engine daemon must be up on the workspace;
// the caller ensures that. A failure DEGRADES to an empty manifest rather than throwing.
//
// The CLI path is by-PATH (`node <nodeArgs> <adapter>/bin/gen-skills.ts`), NOT a bin — the adapter
// is a private package with no bin field, mirroring how the mcp-server shim is launched. node + its
// args + the adapter dir come from the tool-paths config.

import { spawn } from 'node:child_process'
import * as path from 'node:path'

import type { DiscoveredAdapter, SkillManifest } from '../shared/daemon-api'
import { loadToolPaths } from './tool-paths'

interface RunResult {
  /** Non-empty when the spawn itself failed (bad node/adapter path). */
  spawnError?: string
  out: string
  err: string
  code: number | null
}

/** Run the resolved adapter's gen-skills entrypoint with the given trailing args. Never throws. */
function run(adapter: DiscoveredAdapter, extraArgs: string[], onLog?: (line: string) => void): Promise<RunResult> {
  const { paths } = loadToolPaths()
  const entry = path.join(adapter.dir, adapter.runtime.skillsEntry)
  const args = [...paths.nodeArgs, entry, ...extraArgs]

  return new Promise<RunResult>((resolve) => {
    let out = ''
    let err = ''
    const child = spawn(paths.node, args, { cwd: adapter.dir, env: process.env })
    child.on('error', (e) => resolve({ spawnError: `failed to spawn gen-skills (${paths.node}): ${e.message}`, out: '', err: '', code: null }))
    child.stdout.on('data', (c) => {
      out += c.toString('utf8')
    })
    child.stderr.on('data', (c) => {
      const s = c.toString('utf8')
      err += s
      if (onLog) for (const line of s.split('\n')) if (line.trim().length > 0) onLog(`gen-skills: ${line}`)
    })
    child.on('exit', (code) => resolve({ out, err, code }))
  })
}

// Skill MATERIALIZATION (the `--plugin-dir` set) now happens inside the adapter's `launch.ts`
// (see `agent-launch.ts`), so au-host only reads the discovery MANIFEST for the picker here.

const EMPTY_MANIFEST: SkillManifest = { skills: [], skipped: [] }

/**
 * Read the discovered-skills MANIFEST for the launch picker (`gen-skills --manifest`).
 * Degrades to an empty manifest (never throws): a spawn failure, non-zero exit, or malformed
 * JSON all come back as `{ skills: [], skipped: [] }` so the picker renders "no skills".
 */
export async function skillManifest(workspace: string, adapter: DiscoveredAdapter, onLog?: (line: string) => void): Promise<SkillManifest> {
  const r = await run(adapter, ['--workspace', workspace, '--manifest'], onLog)
  if (r.spawnError || r.code !== 0) return EMPTY_MANIFEST
  try {
    const parsed = JSON.parse(r.out.trim() || '{}') as Partial<SkillManifest>
    return { skills: parsed.skills ?? [], skipped: parsed.skipped ?? [] }
  } catch {
    return EMPTY_MANIFEST
  }
}
